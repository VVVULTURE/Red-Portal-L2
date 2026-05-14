'use strict';

/**
 * Red Portal — Node.js / Express Proxy Server
 *
 * Direct port of the Cloudflare Worker.  Drop this in a Koyeb (or any
 * Node ≥ 18) service alongside the public/ folder.
 *
 * Proxy endpoint  : GET|POST  /?url=https://example.com   (same path as the CF worker)
 * WebSocket proxy : WS        /?url=wss://example.com
 * Static files    : everything else → served from ./public/
 *
 * Env vars
 *   PORT   – port to listen on (Koyeb sets this automatically)
 */

const express      = require('express');
const http         = require('http');
const path         = require('path');
const { Readable } = require('stream');
const { WebSocket, WebSocketServer } = require('ws');
const cheerio      = require('cheerio');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 8000;

// ── CORS headers ──────────────────────────────────────────────────────────────

function applyCors(res) {
    res.setHeader('access-control-allow-origin',  '*');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS, HEAD');
    res.setHeader('access-control-allow-headers', '*');
    res.setHeader('x-frame-options',              'ALLOWALL');
    res.setHeader('content-security-policy',      '');
    res.setHeader('cache-control',                'public, max-age=60');
}

// ── URL rewriter helpers ──────────────────────────────────────────────────────

/**
 * Returns a rewriter function scoped to a specific target + workerBase pair.
 * Mirrors the rw() closure in buildRewriter() from the CF worker.
 */
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
// Identical logic to buildShim() in the CF worker — the injected JS is the same.

function buildShim(target, workerBase) {
    const W    = JSON.stringify(workerBase);
    const BASE = JSON.stringify(target);

    const code = `(function(){
        var W=${W},BASE=${BASE},_bu=new URL(BASE),_nl=null;

        /* Navigate the iframe (real HTTP request) to a proxied URL */
        function navTo(u){
            try{
                var a=new URL(String(u),BASE).href;
                var p=W+'?url='+encodeURIComponent(a);
                if(_nl){ _nl.call(window.location,p); return; }
                /* _nl wasn't captured (sandboxed iframe) — ask parent to drive the
                   navigation instead.  The old fallback that re-read the descriptor
                   here caused infinite recursion because the shim had already
                   overwritten location.href's setter. */
                window.parent.postMessage({type:'rpNav',url:a},'*');
            }catch(e){}
        }

        /* Route any URL through the worker */
        function px(u){
            if(!u||typeof u!=='string')return u;
            u=u.trim();
            if(/^(data:|blob:|javascript:|#|mailto:|tel:)/.test(u))return u;
            try{
                var a=new URL(u,BASE).href;
                return a.startsWith(W)?a:W+'?url='+encodeURIComponent(a);
            }catch(e){return u;}
        }

        /* ── Spoof window.location ──────────────────────────────────────────────── */
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

        /* ── fetch ── */
        var _fe=window.fetch;
        window.fetch=function(r,o){
            if(typeof r==='string') r=px(r);
            else if(r&&typeof r==='object'&&r.url){try{r=new Request(px(r.url),r);}catch(e){}}
            return _fe.call(window,r,o);
        };

        /* ── XMLHttpRequest ── */
        var _xo=XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open=function(m,u){
            return _xo.apply(this,[m,px(u)].concat(Array.prototype.slice.call(arguments,2)));
        };

        /* ── WebSocket ──────────────────────────────────────────────────────────── */
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

        /* ── window.open ── */
        window.open=function(u){ navTo(u||''); return null; };

        /* ── Block runtime target=_blank ────────────────────────────────────────── */
        var _sa=Element.prototype.setAttribute;
        Element.prototype.setAttribute=function(name,val){
            if(name==='target'&&/^(_blank|_top|_parent)$/i.test(String(val))) return;
            return _sa.call(this,name,val);
        };

        /* ── Form handling ──────────────────────────────────────────────────────── */
        function doForm(f){
            var action=f.getAttribute('action')||BASE;
            try{ action=new URL(action,BASE).href; }catch(e){}
            /* Unwrap a worker URL if the HTMLRewriter already proxied the action */
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

        /* ── history.pushState / replaceState ───────────────────────────────────── */
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

// ── HTML rewriter (cheerio replaces Cloudflare's HTMLRewriter) ────────────────

function rewriteHtml(html, target, workerBase) {
    const rw = makeRw(target, workerBase);

    // decodeEntities:false preserves the original encoding of special chars
    const $ = cheerio.load(html, { decodeEntities: false });

    // Inject shim as the first child of <head> so it runs before any page JS
    $('head').prepend(buildShim(target, workerBase));

    // Asset URLs
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

    // Navigation links — rewrite href, strip target
    $('a[href]').each((_, el) => {
        $(el).attr('href', rw($(el).attr('href')));
        $(el).removeAttr('target');
    });

    // Forms — only strip target (doForm in the shim handles action proxying)
    $('form').removeAttr('target');

    // <base target="_blank"> would silently make every link open a new tab
    $('base').removeAttr('target');

    // Strip CSP (it would block our proxied resources)
    $('meta[http-equiv="Content-Security-Policy"]').remove();

    // Rewrite meta-refresh redirects
    $('meta[http-equiv="refresh"]').each((_, el) => {
        const c = $(el).attr('content') || '';
        const m = c.match(/^(\d+;\s*url=)(.+)$/i);
        if (m) $(el).attr('content', m[1] + rw(m[2]));
    });

    return $.html();
}

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

    wss.handleUpgrade(req, socket, head, clientWs => {
        // Convert http(s) → ws(s) in case the shim sent an http URL
        const wsTarget = target.replace(/^http/, 'ws');

        let upstream;
        try {
            upstream = new WebSocket(wsTarget);
        } catch (err) {
            clientWs.close(1011, 'upstream connect failed');
            return;
        }

        upstream.on('open', () => {
            // client → upstream
            clientWs.on('message', data => { try { upstream.send(data); } catch {} });
            clientWs.on('close',  (code, reason) => { try { upstream.close(code, reason); } catch {} });

            // upstream → client
            upstream.on('message', data => { try { clientWs.send(data); } catch {} });
            upstream.on('close',  (code, reason) => { try { clientWs.close(code, reason); } catch {} });
            upstream.on('error',  ()             => { try { clientWs.close(1011, 'upstream error'); } catch {} });
        });

        upstream.on('error', () => {
            try { clientWs.close(1011, 'upstream connect error'); } catch {}
        });
    });
});

// ── Global wildcard CORS ──────────────────────────────────────────────────────
// Applied to every response — static files, proxy responses, and error pages —
// so the server can be fetched from any origin.

app.use((req, res, next) => {
    applyCors(res);
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ── HTTP proxy middleware ─────────────────────────────────────────────────────

app.use(async (req, res, next) => {
    // Only intercept requests that carry a ?url= param; everything else
    // falls through to the static file middleware below.
    const rawUrl = `http://localhost${req.url}`;
    const target = new URL(rawUrl).searchParams.get('url');
    if (!target) return next();

    // Derive the workerBase from the incoming request so the shim bakes
    // in the correct URL even when running behind Koyeb's reverse proxy.
    const proto      = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
    const host       = req.headers['x-forwarded-host'] || req.headers.host;
    const workerBase = `${proto}://${host}`;   // e.g. https://my-app.koyeb.app

    // Buffer the request body so we can forward it (streams are single-read)
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
                'Referer':          target,   // full URL, not just origin (fixes Startpage AJAX tabs)
                'DNT':              '1',
                'Upgrade-Insecure-Requests': '1',
            },
            body:     body || undefined,
            redirect: 'follow',
        });
    } catch (err) {
        return res.status(502).type('text/plain').send('Proxy fetch failed: ' + err.message);
    }

    // Use the final URL after redirects as BASE so SPA navigation resolves correctly
    const finalTarget = upstream.url || target;
    const ct          = upstream.headers.get('content-type') || 'text/html';

    res.status(upstream.status);
    res.setHeader('content-type', ct);

    if (ct.includes('text/html')) {
        const html      = await upstream.text();
        const rewritten = rewriteHtml(html, finalTarget, workerBase);
        return res.send(rewritten);
    }

    // Non-HTML (images, JS, CSS, fonts …) — stream straight through
    Readable.fromWeb(upstream.body).pipe(res);
});

// ── Static files (the frontend HTML + assets) ─────────────────────────────────
// Anything without a ?url= param lands here.

app.use(express.static(path.join(__dirname, 'public')));

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
    console.log(`Red Portal proxy listening on port ${PORT}`);
});
