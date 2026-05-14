'use strict';

/**
 * Red Portal — Node.js / Express Proxy Server
 *
 * Drop-in replacement for the Cloudflare Worker, deployable on Koyeb.
 *
 * Proxy endpoint  : GET|POST  /[SECRET]?url=https://example.com
 * WebSocket proxy : WS        /[SECRET]?url=wss://example.com
 * Static files    : GET /  → public/index.html (DEFAULT_WORKER injected at serve time)
 *                   GET /* → public/* (other assets)
 *
 * Env vars
 *   PORT          – port to listen on (Koyeb sets this automatically)
 *   PROXY_SECRET  – optional secret path segment; when set, any proxy request
 *                   that doesn't include it as the first path segment gets 403.
 *                   Leave unset (or empty) for open access during development.
 *
 * How the secret works
 *   PROXY_SECRET=abc123 means:
 *     - allowed:  GET  /abc123?url=https://example.com
 *     - forbidden: GET /?url=https://example.com   → 403
 *     - forbidden: GET /wrong?url=https://example.com → 403
 *   The HTML is served with DEFAULT_WORKER already set to https://host/abc123,
 *   so the shim bakes that path into every URL it generates — no extra logic needed.
 */

const express      = require('express');
const http         = require('http');
const path         = require('path');
const fs           = require('fs');
const { Readable } = require('stream');
const { WebSocket, WebSocketServer } = require('ws');
const cheerio      = require('cheerio');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 8000;

// Secret path segment.  Set PROXY_SECRET=somethingRandom on Koyeb.
const PROXY_SECRET = (process.env.PROXY_SECRET || '').trim();

// Cache the HTML template — only read from disk once
const HTML_TEMPLATE = fs.readFileSync(
    path.join(__dirname, 'public', 'index.html'), 'utf8'
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function applyCors(res) {
    res.setHeader('access-control-allow-origin',  '*');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS, HEAD');
    res.setHeader('access-control-allow-headers', '*');
    res.setHeader('x-frame-options',              'ALLOWALL');
    res.setHeader('content-security-policy',      '');
    res.setHeader('cache-control',                'public, max-age=60');
}

/** Derive the full worker base URL from an incoming request, including the secret path. */
function getWorkerBase(req) {
    const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
    const host  = req.headers['x-forwarded-host']  || req.headers.host;
    return PROXY_SECRET
        ? `${proto}://${host}/${PROXY_SECRET}`
        : `${proto}://${host}`;
}

// ── URL rewriter helpers ──────────────────────────────────────────────────────

function makeRw(target, workerBase) {
    return function rw(v) {
        if (!v) return v;
        v = v.trim();
        if (/^(data:|blob:|javascript:|mailto:|tel:|#)/.test(v)) return v;
        try {
            const abs = new URL(v, target).href;
            return abs.startsWith(workerBase)
                ? abs
                : `${workerBase}?url=${encodeURIComponent(abs)}`;
        } catch {
            return v;
        }
    };
}

function rwSrcset(v, rw) {
    if (!v) return v;
    return v.split(',').map(part => {
        const pieces = part.trim().split(/\s+/);
        pieces[0] = rw(pieces[0]);
        return pieces.join(' ');
    }).join(', ');
}

// ── Shim builder ──────────────────────────────────────────────────────────────

function buildShim(target, workerBase) {
    const W    = JSON.stringify(workerBase);
    const BASE = JSON.stringify(target);

    const code = `(function(){
        var W=${W},BASE=${BASE},_bu=new URL(BASE),_nl=null;

        function navTo(u){
            try{
                var a=new URL(String(u),BASE).href;
                var p=W+'?url='+encodeURIComponent(a);
                if(_nl){ _nl.call(window.location,p); return; }
                window.parent.postMessage({type:'rpNav',url:a},'*');
            }catch(e){}
        }

        function px(u){
            if(!u||typeof u!=='string')return u;
            u=u.trim();
            if(/^(data:|blob:|javascript:|#|mailto:|tel:)/.test(u))return u;
            try{
                var a=new URL(u,BASE).href;
                return a.startsWith(W)?a:W+'?url='+encodeURIComponent(a);
            }catch(e){return u;}
        }

        try{
            var _lp=Object.getPrototypeOf(window.location);
            var _hd=Object.getOwnPropertyDescriptor(_lp,'href');
            _nl=_hd&&_hd.set;
            var PROPS=[
                ['href',     function(){return BASE;}],
                ['origin',   function(){return _bu.origin;}],
                ['protocol', function(){return _bu.protocol;}],
                ['host',     function(){return _bu.host;}],
                ['hostname', function(){return _bu.hostname;}],
                ['port',     function(){return _bu.port;}],
                ['pathname', function(){return _bu.pathname;}],
                ['search',   function(){return _bu.search;}],
                ['hash',     function(){return _bu.hash;}],
            ];
            PROPS.forEach(function(pair){
                try{
                    var desc={get:pair[1],configurable:true};
                    if(pair[0]==='href') desc.set=function(v){navTo(v);};
                    Object.defineProperty(_lp,pair[0],desc);
                }catch(e){}
            });
            _lp.assign =function(v){navTo(v);};
            _lp.replace =function(v){navTo(v);};
        }catch(e){}

        var _fe=window.fetch;
        window.fetch=function(r,o){
            if(typeof r==='string') r=px(r);
            else if(r&&typeof r==='object'&&r.url){try{r=new Request(px(r.url),r);}catch(e){}}
            return _fe.call(window,r,o);
        };

        var _xo=XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open=function(m,u){
            return _xo.apply(this,[m,px(u)].concat(Array.prototype.slice.call(arguments,2)));
        };

        var _WS=window.WebSocket;
        window.WebSocket=function(url,protocols){
            var ws=url;
            try{
                var u=new URL(String(url),BASE);
                if(/^https?:$/.test(u.protocol)) u.protocol=u.protocol.replace('http','ws');
                ws=u.href;
            }catch(e){}
            var workerWs=W.replace(/^http/,'ws')+'?url='+encodeURIComponent(ws);
            return protocols ? new _WS(workerWs,protocols) : new _WS(workerWs);
        };
        window.WebSocket.prototype=_WS.prototype;
        window.WebSocket.CONNECTING=_WS.CONNECTING;
        window.WebSocket.OPEN=_WS.OPEN;
        window.WebSocket.CLOSING=_WS.CLOSING;
        window.WebSocket.CLOSED=_WS.CLOSED;

        window.open=function(u){ navTo(u||''); return null; };

        var _sa=Element.prototype.setAttribute;
        Element.prototype.setAttribute=function(name,val){
            if(name==='target'&&/^(_blank|_top|_parent)$/i.test(String(val))) return;
            return _sa.call(this,name,val);
        };

        function doForm(f){
            var action=f.getAttribute('action')||BASE;
            try{ action=new URL(action,BASE).href; }catch(e){}
            try{
                var au=new URL(action);
                if(au.origin+au.pathname===new URL(W).origin+new URL(W).pathname && au.searchParams.get('url')){
                    action=au.searchParams.get('url');
                }
            }catch(e){}
            var qs=new URLSearchParams(new FormData(f)).toString();
            navTo(action+(qs?'?'+qs:''));
        }
        HTMLFormElement.prototype.submit=function(){ doForm(this); };
        document.addEventListener('submit',function(e){ e.preventDefault(); doForm(e.target); },true);

        ['pushState','replaceState'].forEach(function(m){
            var orig=history[m];
            history[m]=function(s,t,u){
                orig.apply(history,arguments);
                if(u){
                    try{
                        _bu=new URL(u,BASE); BASE=_bu.href;
                        window.parent.postMessage({type:'rpUrlChange',url:BASE},'*');
                    }catch(e){}
                }
            };
        });

        window.parent.postMessage({type:'rpUrl',url:BASE},'*');
        window.addEventListener('load',function(){
            window.parent.postMessage({type:'rpUrl',url:BASE},'*');
        });

    })()`;

    return `<script data-rp>${code}<\/script>`;
}

// ── HTML rewriter ─────────────────────────────────────────────────────────────

function rewriteHtml(html, target, workerBase) {
    const rw = makeRw(target, workerBase);
    const $  = cheerio.load(html, { decodeEntities: false });

    $('head').prepend(buildShim(target, workerBase));

    const rwAttr = (sel, attr) =>
        $(sel).each((_, el) => $(el).attr(attr, rw($(el).attr(attr))));

    rwAttr('script[src]',   'src');
    rwAttr('link[href]',    'href');
    rwAttr('img[src]',      'src');
    rwAttr('video[src]',    'src');
    rwAttr('video[poster]', 'poster');
    rwAttr('audio[src]',    'src');
    rwAttr('iframe[src]',   'src');
    rwAttr('source[src]',   'src');

    $('img[srcset], source[srcset]').each((_, el) => {
        $(el).attr('srcset', rwSrcset($(el).attr('srcset'), rw));
    });

    $('a[href]').each((_, el) => {
        $(el).attr('href', rw($(el).attr('href')));
        $(el).removeAttr('target');
    });

    $('form').removeAttr('target');
    $('base').removeAttr('target');
    $('meta[http-equiv="Content-Security-Policy"]').remove();

    $('meta[http-equiv="refresh"]').each((_, el) => {
        const c = $(el).attr('content') || '';
        const m = c.match(/^(\d+;\s*url=)(.+)$/i);
        if (m) $(el).attr('content', m[1] + rw(m[2]));
    });

    return $.html();
}

// ── Global wildcard CORS ──────────────────────────────────────────────────────

app.use((req, res, next) => {
    applyCors(res);
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ── Frontend — serve index.html with DEFAULT_WORKER injected ──────────────────
// Must come BEFORE the proxy middleware so GET / is never treated as a proxy request.

app.get('/', (req, res) => {
    const workerBase = getWorkerBase(req);
    // Overwrite DEFAULT_WORKER (whatever URL is hardcoded in the file) with the
    // correct value for this deployment, including the secret path if set.
    const html = HTML_TEMPLATE.replace(
        /const DEFAULT_WORKER\s*=\s*['"][^'"]*['"]/,
        `const DEFAULT_WORKER = ${JSON.stringify(workerBase)}`
    );
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(html);
});

// ── Secret gate + HTTP proxy ──────────────────────────────────────────────────
// Registered as a single middleware so the gate is always checked before the
// upstream fetch is attempted.

app.use(async (req, res, next) => {
    const rawUrl = `http://localhost${req.url}`;
    const target = new URL(rawUrl).searchParams.get('url');
    if (!target) return next();   // not a proxy request → static files below

    // ── Secret check ──────────────────────────────────────────────────────────
    if (PROXY_SECRET) {
        // req.path for /abc123?url=... is '/abc123'
        const pathSecret = req.path.replace(/^\//, '').split('/')[0];
        if (pathSecret !== PROXY_SECRET) {
            return res.status(403).type('text/plain').send('Forbidden');
        }
    }

    // ── Proxy ─────────────────────────────────────────────────────────────────
    const workerBase = getWorkerBase(req);

    let body;
    if (!['GET', 'HEAD'].includes(req.method)) {
        body = await new Promise((resolve, reject) => {
            const chunks = [];
            req.on('data',  c   => chunks.push(c));
            req.on('end',   ()  => resolve(Buffer.concat(chunks)));
            req.on('error', err => reject(err));
        });
    }

    let upstream;
    try {
        upstream = await fetch(target, {
            method: req.method,
            headers: {
                'User-Agent':
                    req.headers['user-agent'] ||
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept':
                    req.headers['accept'] ||
                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language':  'en-US,en;q=0.9',
                'Accept-Encoding':  'gzip, deflate, br',
                'Referer':          target,
                'DNT':              '1',
                'Upgrade-Insecure-Requests': '1',
            },
            body:     body || undefined,
            redirect: 'follow',
        });
    } catch (err) {
        return res.status(502).type('text/plain').send('Proxy fetch failed: ' + err.message);
    }

    const finalTarget = upstream.url || target;
    const ct          = upstream.headers.get('content-type') || 'text/html';

    res.status(upstream.status);
    res.setHeader('content-type', ct);

    if (ct.includes('text/html')) {
        const html      = await upstream.text();
        const rewritten = rewriteHtml(html, finalTarget, workerBase);
        return res.send(rewritten);
    }

    Readable.fromWeb(upstream.body).pipe(res);
});

// ── Static files ──────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

// ── WebSocket proxy ───────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
    const rawUrl = `http://localhost${req.url}`;
    const target = new URL(rawUrl).searchParams.get('url');

    if (!target) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
    }

    // Secret check for WebSocket upgrades
    if (PROXY_SECRET) {
        const pathSecret = req.url.split('?')[0].replace(/^\//, '').split('/')[0];
        if (pathSecret !== PROXY_SECRET) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
        }
    }

    wss.handleUpgrade(req, socket, head, clientWs => {
        const wsTarget = target.replace(/^http/, 'ws');
        let upstream;
        try {
            upstream = new WebSocket(wsTarget);
        } catch (err) {
            clientWs.close(1011, 'upstream connect failed');
            return;
        }

        upstream.on('open', () => {
            clientWs.on('message', data => { try { upstream.send(data); } catch {} });
            clientWs.on('close',  (code, reason) => { try { upstream.close(code, reason); } catch {} });
            upstream.on('message', data => { try { clientWs.send(data); } catch {} });
            upstream.on('close',  (code, reason) => { try { clientWs.close(code, reason); } catch {} });
            upstream.on('error',  ()             => { try { clientWs.close(1011, 'upstream error'); } catch {} });
        });

        upstream.on('error', () => {
            try { clientWs.close(1011, 'upstream connect error'); } catch {}
        });
    });
});

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
    console.log(`Red Portal proxy listening on port ${PORT}`);
    if (PROXY_SECRET) {
        console.log(`Secret path active — proxy endpoint: /${PROXY_SECRET}?url=...`);
    } else {
        console.log('No PROXY_SECRET set — proxy is open (fine for local dev)');
    }
});
