import express from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const publicDirectory = fileURLToPath(new URL('./public/', import.meta.url));

function browserConfig(env) {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return null;

  try {
    const parsed = new URL(url);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname !== '/') return null;
  } catch {
    return null;
  }

  // Never release a server key, even if it is pasted into the public variable.
  if (key === env.SUPABASE_SECRET_KEY?.trim()) return null;
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    const parts = key.split('.');
    if (parts.length !== 3) return null;
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (payload.role !== 'anon') return null;
    } catch {
      return null;
    }
  }

  return { supabaseUrl: url.replace(/\/$/, ''), supabasePublishableKey: key };
}

export function createApp(env = process.env) {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    });
    next();
  });

  app.get('/api/config', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const config = browserConfig(env);
    if (!config) return res.status(503).json({ error: 'Service is not configured yet.' });
    return res.json(config);
  });

  // No business or platform API exists until its authenticated phase is built.
  app.use('/api', (_req, res) => {
    res.set('Cache-Control', 'no-store').status(404).json({ error: 'Not found.' });
  });

  app.get(['/master-login', '/master-login.html'], (_req, res) => {
    res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
    res.sendFile(path.join(publicDirectory, 'master-login.html'));
  });

  // Only public/ is served. Source files, docs, attachments and .env stay private.
  app.use(express.static(publicDirectory, { dotfiles: 'deny', etag: false }));
  app.use((_req, res) => res.status(404).type('text').send('Page not found.'));
  app.use((_error, _req, res, _next) => {
    if (!res.headersSent) res.status(500).json({ error: 'Unable to complete the request.' });
  });
  return app;
}

const app = createApp();
export default app;

// Vercel imports the default export; direct Node execution starts the local server.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Webnox OS is listening on port ${port}.`));
}
