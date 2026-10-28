import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './server/app.ts';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const app = createApp(process.env.BOT_API_URL || 'http://127.0.0.1:8000');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const server = app.listen(port, '0.0.0.0', () => console.log(`FlyParcel web listening on port ${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  setTimeout(() => process.exit(1), 10000).unref();
  server.close(() => process.exit(0));
  server.closeIdleConnections();
});
