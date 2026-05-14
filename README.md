# Red Portal — Koyeb Deployment

## Project structure

```
red-portal/
├── server.js          ← proxy server (replaces the CF Worker)
├── package.json
└── public/
    └── index.html     ← your frontend (replace DEFAULT_WORKER before deploying)
    └── assets/        ← put logo.png and any other assets here
```

## 1. Update the default worker URL

In `public/index.html`, find this line and replace with your actual Koyeb URL
(you can get it from the Koyeb dashboard after the first deploy):

```js
const DEFAULT_WORKER = 'https://YOUR-APP-NAME.koyeb.app';
```

The proxy endpoint is at the root — same URL format as the old CF Worker:
`https://YOUR-APP-NAME.koyeb.app/?url=https://example.com`

## 2. Push to GitHub / GitLab

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/you/red-portal.git
git push -u origin main
```

## 3. Create a Koyeb service

1. Go to https://app.koyeb.com → **Create Service**
2. Choose **Web Service** → connect your repo
3. Set:
   - **Build command**: `npm install`
   - **Run command**:   `npm start`
   - **Port**:          `8000`   (or leave blank — Koyeb reads $PORT automatically)
4. Deploy — Koyeb assigns a URL like `https://your-app-xyz.koyeb.app`
5. Paste that URL into `DEFAULT_WORKER` in `index.html` and redeploy

## How it works

```
Browser
  │
  ├─ GET  https://your-app.koyeb.app/              → serves public/index.html
  ├─ GET  https://your-app.koyeb.app/?url=https://startpage.com  → proxies startpage
  └─ WS   wss://your-app.koyeb.app/?url=wss://game.server        → proxies WebSocket
```

The server detects a `?url=` query param to decide between proxying and static file serving,
so the HTML frontend and the proxy live on the same origin with no CORS issues.
