import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createApp } from '../server/app.ts';

const listen = (server: Server) => new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port)));
const close = (server: Server) => new Promise<void>((resolve, reject) => { server.close(e => e ? reject(e) : resolve()); server.closeAllConnections(); });
test('web proxy preserves signed authorization, body and Python status; backend failure is explicit', async () => {
  let received: any;
  const backend = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = { url: req.url, auth: req.headers['x-telegram-init-data'], body: Buffer.concat(chunks).toString() };
    res.writeHead(req.url === '/api/health' ? 200 : 403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url === '/api/health' ? { status: 'ok' } : { error: 'Нет доступа.' }));
  });
  const backendPort = await listen(backend);
  const webServer = createServer(createApp(`http://127.0.0.1:${backendPort}`));
  const webPort = await listen(webServer);
  try {
    const response = await fetch(`http://127.0.0.1:${webPort}/api/deals`, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Telegram-Init-Data': 'signed-test-data'
    }, body: JSON.stringify({ listingType: 'parcel', listingId: 1 }) });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'Нет доступа.');
    assert.deepEqual(received, { url: '/api/deals', auth: 'signed-test-data', body: '{"listingType":"parcel","listingId":1}' });
    assert.equal((await fetch(`http://127.0.0.1:${webPort}/api/health`)).status, 200);
    await close(backend);
    assert.equal((await fetch(`http://127.0.0.1:${webPort}/api/health`)).status, 503);
  } finally {
    if (backend.listening) await close(backend);
    await close(webServer);
  }
});
