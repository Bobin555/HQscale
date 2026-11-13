// Local test server: serves the app and the training results API, keeping records in
// .dev-data/attempts.json. For trying the admin dashboard before Azure exists.
//   npm run dev            → http://localhost:8787  (admin dashboard: /admin.html)
// No sign-in here: learners type their name (records are marked unverified) and the dashboard
// is open to anyone on this computer. Set DEV_USER="Name <email>" and DEV_ROLES="admin" to
// pretend to be signed in, as on Azure.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, readPrincipal } from '../api/src/attempts-core.js';
import { FileStore } from '../api/src/stores.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8787);
const store = new FileStore(join(root, '.dev-data', 'attempts.json'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.webmanifest': 'application/manifest+json' };

// Optional pretend sign-in, shaped like Azure Static Web Apps' x-ms-client-principal.
const devPrincipal = (() => {
  const m = (process.env.DEV_USER || '').match(/^\s*(.*?)\s*<(.+)>\s*$/);
  if (!m) return null;
  const p = { userId: `dev-${m[2]}`, userDetails: m[2], userRoles: ['anonymous', 'authenticated', ...(process.env.DEV_ROLES || '').split(',').filter(Boolean)], claims: [{ typ: 'name', val: m[1] }] };
  return { header: Buffer.from(JSON.stringify(p)).toString('base64'), me: { clientPrincipal: { identityProvider: 'dev', userId: p.userId, userDetails: p.userDetails, userRoles: p.userRoles } } };
})();

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/.auth/me') return send(res, 200, devPrincipal ? devPrincipal.me : { clientPrincipal: null });
    const api = url.pathname.match(/^\/api\/(health|attempts)$/);
    if (api) {
      let body = null;
      if (req.method === 'POST') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { body = null; }
      }
      const r = await handle(
        { method: req.method, route: api[1], query: Object.fromEntries(url.searchParams), body, principal: readPrincipal(devPrincipal?.header) },
        { store, allowAnonymous: !devPrincipal, openAdmin: !devPrincipal },
      );
      return send(res, r.status, r.body);
    }
    // Static files (no directory escapes).
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path.endsWith('/')) path += 'index.html';
    const file = join(root, path);
    if (!file.startsWith(root) || file.includes(`${root}/.dev-data`)) return send(res, 404, 'Not found', 'text/plain');
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, await readFile(file), types[extname(file).toLowerCase()] || 'application/octet-stream');
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}).listen(port, () => {
  console.log(`HQscale test server: http://localhost:${port}   admin dashboard: http://localhost:${port}/admin.html`);
  console.log(devPrincipal ? `Signed in as ${process.env.DEV_USER} (roles: ${process.env.DEV_ROLES || 'none'})` : 'No sign-in: learners type their name; the dashboard is open on this computer.');
});
