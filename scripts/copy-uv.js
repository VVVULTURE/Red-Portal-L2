/**
 * copy-uv.js
 * Copies Ultraviolet's built dist files into public/uv/ so Vite serves them
 * as static assets (service worker must be at a real URL, not bundled).
 * Run automatically via `npm run copy-uv` before dev or build.
 */

const { copyFileSync, mkdirSync, readdirSync, existsSync } = require('fs');
const { join } = require('path');

const uvDist = join(
  __dirname, '..', 'node_modules',
  '@titaniumnetwork-group', 'ultraviolet', 'dist'
);
const dest = join(__dirname, '..', 'public', 'uv');

if (!existsSync(uvDist)) {
  console.error(
    '\n[copy-uv] ERROR: @titaniumnetwork-group/ultraviolet not found.\n' +
    '  Run `npm install` first.\n'
  );
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

const files = readdirSync(uvDist);
files.forEach(file => {
  copyFileSync(join(uvDist, file), join(dest, file));
  console.log(`[copy-uv] ✓ ${file}`);
});

console.log(`[copy-uv] Ultraviolet files ready → public/uv/\n`);
