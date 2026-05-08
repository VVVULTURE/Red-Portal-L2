import './style.css';
import { games, testingGames, proxies } from './games.js';

// ── Color bands for game cards (cycles through) ──────────────────────
const BANDS = [
  '#FF1C1C', '#FF6820', '#FFB300',
  '#20FF8A', '#00D4FF', '#9B20FF', '#FF2099',
];

// ── Game card emoji icons ─────────────────────────────────────────────
function getIcon(name) {
  const n = name.toLowerCase();
  if (n.includes('geo') || n.includes('dash'))  return '🔷';
  if (n.includes('slope'))                        return '🔺';
  if (n.includes('cookie'))                       return '🍪';
  if (n.includes('among'))                        return '🪐';
  if (n.includes('drift') || n.includes('car'))   return '🚗';
  if (n.includes('subway') || n.includes('surf')) return '🛹';
  if (n.includes('mine') || n.includes('craft'))  return '⛏️';
  if (n.includes('shell') || n.includes('egg'))   return '🥚';
  if (n.includes('friday') || n.includes('fnf'))  return '🎤';
  if (n.includes('tunnel'))                       return '🌀';
  if (n.includes('boom'))                         return '💥';
  if (n.includes('ball') || n.includes('core'))   return '⚽';
  if (n.includes('bow'))                          return '🏹';
  if (n.includes('gta') || n.includes('city'))    return '🚔';
  if (n.includes('game') || n.includes('no'))     return '🎮';
  if (n.includes('1v1'))                          return '⚔️';
  return '🎯';
}

// ── Render game grid ─────────────────────────────────────────────────
function renderGrid(containerId, list) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  grid.innerHTML = '';

  if (!list.length) {
    grid.innerHTML = '<p class="empty-msg">No games yet — add some in src/games.js</p>';
    return;
  }

  list.forEach((game, i) => {
    const band = BANDS[i % BANDS.length];
    const card = document.createElement('a');
    card.className = 'game-card';
    card.href = game.url;
    card.target = '_blank';
    card.rel = 'noopener';
    // Store name + url for the modal
    card.dataset.name = game.name;
    card.dataset.url  = game.url;
    card.style.setProperty('--band', band);
    card.style.animationDelay = `${i * 30}ms`;
    card.innerHTML = `
      <div class="card-band"></div>
      <div class="card-body">
        <div class="card-icon">${getIcon(game.name)}</div>
        <span class="card-name">${game.name}</span>
      </div>`;
    grid.appendChild(card);
  });
}

// ── Search / filter ──────────────────────────────────────────────────
function initSearch() {
  const input = document.getElementById('gameSearch');
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll('#gamesGrid .game-card').forEach(card => {
      const name = card.querySelector('.card-name').textContent.toLowerCase();
      card.style.display = name.includes(q) ? '' : 'none';
    });
    const visible = [...document.querySelectorAll('#gamesGrid .game-card')]
      .filter(c => c.style.display !== 'none');
    const empty = document.querySelector('#gamesGrid .empty-msg');
    if (q && !visible.length) {
      if (!empty) {
        const msg = document.createElement('p');
        msg.className = 'empty-msg';
        msg.textContent = `No games matching "${q}"`;
        document.getElementById('gamesGrid').appendChild(msg);
      }
    } else if (empty) empty.remove();
  });
}

// ── Toast notifications ──────────────────────────────────────────────
function toast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = message;
  container.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 350);
  }, 3500);
}

// ── Loading page injected into popup immediately ─────────────────────
const LOADING_PAGE = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Loading…</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#06070E;display:flex;flex-direction:column;align-items:center;
       justify-content:center;min-height:100vh;gap:1.25rem;
       font-family:'Chakra Petch',monospace;color:#FF1C1C;}
  .ring{width:52px;height:52px;border:3px solid rgba(255,28,28,.18);
        border-top-color:#FF1C1C;border-radius:50%;
        animation:spin .75s linear infinite;}
  @keyframes spin{to{transform:rotate(360deg)}}
  p{font-size:.78rem;letter-spacing:.18em;color:#505070;text-transform:uppercase;}
</style></head>
<body><div class="ring"></div><p>Loading game…</p></body></html>`;

// ── Direct fetch open (original approach) ────────────────────────────
function openGame(url) {
  if (!url) { toast('No URL set for this game.', 'error'); return; }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const win = window.open('about:blank', '_blank');
  if (!win) {
    toast('Popup blocked — please allow popups for this site.', 'error');
    return;
  }

  win.document.open();
  win.document.write(LOADING_PAGE);
  win.document.close();

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 12_000);

  fetch(url, { signal: controller.signal })
    .then(res => {
      clearTimeout(tid);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
    .then(html => {
      const base  = url.replace(/([^/]*)(\?.*)?$/, '');
      const fixed = html.replace(/<head([^>]*)>/i, (m, a) => `<head${a}><base href="${base}">`);
      const blob  = new Blob([fixed], { type: 'text/html' });
      if (!win.closed) win.location.href = URL.createObjectURL(blob);
    })
    .catch(() => {
      clearTimeout(tid);
      // No silent fallback — the modal already gave the user the choice.
      // If fetch fails, close the loading popup and toast an error.
      if (!win.closed) win.close();
      toast('Fetch failed — try opening via Proxy instead.', 'error');
    });
}

// ── Ultraviolet proxy open ───────────────────────────────────────────
//
// Registers the UV service worker (if not already active), encodes the
// target URL with XOR, then opens /uv/service/<encoded> in a new tab.
// The SW intercepts that navigation and tunnels it through /api/bare/
// (our Vercel serverless function) so the browser never sees a CORS error.
//
async function openViaProxy(url) {
  if (!url) { toast('No URL for this game.', 'error'); return; }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  // UV scripts must have loaded
  if (typeof __uv$config === 'undefined') {
    toast('Proxy unavailable — UV files not found. Run npm run copy-uv.', 'error');
    return;
  }

  if (!('serviceWorker' in navigator)) {
    toast('Your browser does not support service workers.', 'error');
    return;
  }

  // Open the popup SYNC (tied to the click event) so browsers don't block it
  const win = window.open('about:blank', '_blank');
  if (!win) {
    toast('Popup blocked — please allow popups for this site.', 'error');
    return;
  }

  win.document.open();
  win.document.write(LOADING_PAGE);
  win.document.close();

  try {
    // Register SW if not yet controlling this page
    if (!navigator.serviceWorker.controller) {
      await navigator.serviceWorker.register('/uv/uv.sw.js', {
        scope: '/uv/service/',
      });

      // Wait until the SW is active and controlling
      await new Promise(resolve => {
        if (navigator.serviceWorker.controller) return resolve();
        navigator.serviceWorker.addEventListener(
          'controllerchange', resolve, { once: true }
        );
        // Timeout fallback — proceed anyway after 3 s
        setTimeout(resolve, 3000);
      });
    }

    const encoded  = __uv$config.encodeUrl(url);
    const proxyUrl = __uv$config.prefix + encoded;

    if (!win.closed) win.location.href = proxyUrl;
  } catch (err) {
    console.error('[proxy]', err);
    if (!win.closed) win.close();
    toast('Proxy error — ' + err.message, 'error');
  }
}

// ── Game open modal ──────────────────────────────────────────────────
//
// Shows a choice dialog instead of immediately opening the game.
// The user picks "Fetch" (client-side blob) or "Proxy" (Ultraviolet SW).
//
function showOpenModal(game) {
  // Remove any existing modal
  document.getElementById('openModal')?.remove();

  const proxyAvailable = typeof __uv$config !== 'undefined';

  const overlay = document.createElement('div');
  overlay.id = 'openModal';
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Open ${game.name}`);

  overlay.innerHTML = `
    <div class="modal" id="openModalBox">
      <button class="modal-close" id="modalClose" aria-label="Close">✕</button>

      <div class="modal-icon">${getIcon(game.name)}</div>
      <h3 class="modal-title">${game.name}</h3>
      <p class="modal-sub">How would you like to open this game?</p>

      <div class="modal-actions">

        <button class="modal-opt" id="btnModalFetch">
          <span class="modal-opt-left">
            <span class="modal-opt-icon">🔗</span>
            <span class="modal-opt-text">
              <strong>Fetch &amp; Open</strong>
              <span class="modal-opt-desc">Grabs the page directly — fast, but may fail on CORS-locked sites</span>
            </span>
          </span>
          <span class="modal-opt-arrow">›</span>
        </button>

        <button class="modal-opt modal-opt-proxy${proxyAvailable ? '' : ' modal-opt-disabled'}"
                id="btnModalProxy"
                ${proxyAvailable ? '' : 'disabled title="UV files not found — run npm run copy-uv"'}>
          <span class="modal-opt-left">
            <span class="modal-opt-icon">🔒</span>
            <span class="modal-opt-text">
              <strong>Open via Proxy</strong>
              <span class="modal-opt-desc">${
                proxyAvailable
                  ? 'Routes through Ultraviolet — works on CORS-blocked games'
                  : 'Ultraviolet not found — run npm run copy-uv first'
              }</span>
            </span>
          </span>
          <span class="modal-opt-arrow">›</span>
        </button>

      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Animate in
  requestAnimationFrame(() =>
    requestAnimationFrame(() => overlay.classList.add('show'))
  );

  // Close helpers
  const close = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 260);
  };

  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('modalClose').addEventListener('click', close);

  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });

  // Button actions
  document.getElementById('btnModalFetch').addEventListener('click', () => {
    close();
    openGame(game.url);
  });

  document.getElementById('btnModalProxy').addEventListener('click', () => {
    if (!proxyAvailable) return;
    close();
    openViaProxy(game.url);
  });
}

// ── Navigation ───────────────────────────────────────────────────────
function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));
  const section = document.getElementById(id);
  if (section) section.classList.add('active');
  const link = document.querySelector(`.nav-link[data-section="${id}"]`);
  if (link) link.classList.add('active');
}

// ── HTML Executor ────────────────────────────────────────────────────
function executeTyped() {
  const html   = document.getElementById('htmlInput').value;
  const status = document.getElementById('execTypedStatus');
  if (!html.trim()) { status.textContent = 'Enter some HTML to execute.'; return; }
  const blob = new Blob([html], { type: 'text/html' });
  window.open(URL.createObjectURL(blob), '_blank');
  status.textContent = 'Opened in new tab.';
  setTimeout(() => { status.textContent = ''; }, 3000);
}

function executeFile() {
  const status = document.getElementById('execFileStatus');
  const input  = document.getElementById('fileInput');
  const file   = input?.files[0];
  if (!file) { status.textContent = 'Select a file first.'; return; }
  const reader = new FileReader();
  reader.onload = e => {
    const blob = new Blob([e.target.result], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
    status.textContent = 'File opened in new tab.';
    setTimeout(() => { status.textContent = ''; }, 3000);
    input.value = '';
  };
  reader.onerror = () => { status.textContent = 'Failed to read file.'; };
  reader.readAsText(file);
}

// ── Website Fetcher ──────────────────────────────────────────────────
function fetchSite() {
  const input  = document.getElementById('urlInput');
  const status = document.getElementById('fetchStatus');
  let url = input.value.trim();
  if (!url) { status.textContent = 'Enter a URL.'; return; }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const win = window.open('about:blank', '_blank');
  if (!win) {
    status.textContent = 'Popup blocked! Allow popups to use the fetcher.';
    return;
  }
  win.document.open();
  win.document.write(LOADING_PAGE);
  win.document.close();

  status.textContent = `Fetching ${url}…`;
  input.value = '';

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 15_000);

  fetch(url, { signal: controller.signal })
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text(); })
    .then(html => {
      const base  = url.replace(/([^/]*)(\?.*)?$/, '');
      const fixed = html.replace(/<head([^>]*)>/i, (m, a) => `<head${a}><base href="${base}">`);
      const blob  = new Blob([fixed], { type: 'text/html' });
      if (!win.closed) win.location.href = URL.createObjectURL(blob);
      status.textContent = 'Opened!';
    })
    .catch(() => {
      if (!win.closed) win.location.href = url;
      status.textContent = 'Fetch blocked — navigated directly instead.';
    })
    .finally(() => setTimeout(() => { status.textContent = ''; }, 4000));
}

// ── Service worker pre-registration (improves proxy first-launch speed) ─
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (typeof __uv$config === 'undefined') return; // UV not available
  try {
    await navigator.serviceWorker.register('/uv/uv.sw.js', {
      scope: '/uv/service/',
    });
  } catch (e) {
    // Non-fatal — SW will be registered on demand when proxy is used
    console.warn('[Red Portal] UV SW pre-registration skipped:', e.message);
  }
}

// ── Boot ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Render game grids
  renderGrid('gamesGrid',     games);
  renderGrid('preLaunchGrid', testingGames);
  renderGrid('proxiesGrid',   proxies);

  // Search
  initSearch();

  // Nav
  document.getElementById('mainNav').addEventListener('click', e => {
    const link = e.target.closest('.nav-link[data-section]');
    if (!link) return;
    e.preventDefault();
    showSection(link.dataset.section);
  });

  // Game grid click → show modal instead of opening immediately
  ['gamesGrid', 'preLaunchGrid', 'proxiesGrid'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      const card = e.target.closest('.game-card');
      if (!card) return;
      e.preventDefault();
      showOpenModal({ name: card.dataset.name, url: card.dataset.url });
    });
  });

  // Executor
  document.getElementById('btnRunHtml')?.addEventListener('click', executeTyped);
  document.getElementById('btnOpenFile')?.addEventListener('click', executeFile);

  // Fetcher
  document.getElementById('btnFetchSite')?.addEventListener('click', fetchSite);
  document.getElementById('urlInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') fetchSite();
  });

  // Google Form
  document.getElementById('btnOpenForm')?.addEventListener('click', () => {
    window.open(
      'https://docs.google.com/forms/d/e/1FAIpQLScaYcFE6kxkrrnx09OX8QLJZluyDLUeH65pDbRa-I2DapeQ7A/viewform?usp=dialog',
      '_blank'
    );
  });

  // Pre-register UV service worker so first proxy click is instant
  registerServiceWorker();
});
