# Red Portal v2

A Vite-powered games portal with a dark cyberpunk aesthetic and Ultraviolet proxy support.

## Quick Start

```bash
npm install          # installs deps and copies UV files automatically
npm run dev          # start dev server at localhost:5173
npm run build        # build for production → dist/
npm run preview      # preview the production build locally
```

> `npm install` triggers a `postinstall` hook that copies Ultraviolet's built
> files into `public/uv/`. You can also run it manually: `npm run copy-uv`.

## Deploy to Vercel

1. Push your repo to GitHub
2. Import it in [vercel.com](https://vercel.com)
3. Vercel auto-detects the config from `vercel.json` — no extra settings needed
4. The bare server runs as a serverless function at `/api/bare/`

## Game Open Modal

Clicking any game card now shows a choice dialog:

| Option | How it works |
|--------|-------------|
| 🔗 **Fetch & Open** | Client-side fetch → blob URL (fast, may fail on strict CORS) |
| 🔒 **Open via Proxy** | Ultraviolet service worker → bare server (works around CORS) |

### Proxy notes
- The UV service worker is pre-registered on page load so the first proxy click is instant.
- The bare server (`/api/bare/`) runs as a Vercel serverless function.
- Vercel hobby plan has a **10 s timeout** and **no WebSocket support**. Most single-player games work fine; real-time multiplayer games using WebSockets may not load through the proxy.

## Adding Games

Edit **`src/games.js`** — three arrays:

| Array          | Tab shown        |
|----------------|------------------|
| `games`        | 🎮 Games         |
| `testingGames` | 🧪 Testing       |
| `proxies`      | 🔓 Proxies       |

```js
export const games = [
  { name: 'My Game', url: 'https://my-game.vercel.app/' },
  // ...
];
```

## Project Structure

```
red-portal/
├── api/
│   └── bare/
│       └── [...path].js   ← Ultraviolet bare server (Vercel function)
├── public/
│   └── uv/                ← UV static files (auto-copied from node_modules)
│       ├── uv.bundle.js
│       ├── uv.handler.js
│       ├── uv.sw.js
│       └── uv.config.js   ← proxy prefix + codec config
├── scripts/
│   └── copy-uv.js         ← copies UV dist files to public/uv/
├── src/
│   ├── games.js           ← add/remove games here
│   ├── main.js
│   └── style.css
├── index.html
├── package.json
├── vercel.json
└── vite.config.js
```
