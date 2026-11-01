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

test('health diagnostics correlate stages without logging credentials or request payloads', async () => {
  const records: Array<Record<string, unknown>> = [];
  let forwardedId = '';
  const backend = createServer((req, res) => {
    forwardedId = String(req.headers['x-request-id'] || '');
    res.setHeader('Server-Timing', 'db_pool;dur=1.2, db_query;dur=0.3, backend;dur=2');
    res.end('{"status":"ok"}');
  });
  const backendPort = await listen(backend);
  const webServer = createServer(createApp(`http://127.0.0.1:${backendPort}`, record => records.push(record)));
  const port = await listen(webServer);
  try {
    const id = '8ce3ff7f-36d3-4599-8553-e21c3c457a98';
    const response = await fetch(`http://127.0.0.1:${port}/api/health?initData=private-query`, {
      headers: {'X-Request-ID': id, 'X-Telegram-Init-Data': 'private-auth', 'Cookie': 'private-cookie'}
    });
    await response.text();
    assert.equal(response.headers.get('X-Request-ID'), id);
    assert.ok(response.headers.get('Server-Timing')?.includes('db_query;dur=0.3'));
    assert.equal(forwardedId, id);
    assert.equal(records.length, 1);
    assert.equal(records[0].event, 'health_proxy');
    assert.equal(records[0].db_pool_ms, 1.2);
    assert.equal(records[0].db_query_ms, 0.3);
    assert.equal(records[0].status, 200);
    assert.ok(!JSON.stringify(records).includes('private-'));
    await (await fetch(`http://127.0.0.1:${port}/api/parcels`)).text();
    assert.equal(records.length, 1);
    await close(backend);
    const failure = await fetch(`http://127.0.0.1:${port}/api/health`);
    await failure.text();
    assert.equal(failure.status, 503);
    assert.equal(records[1].status, 503);
    assert.ok(records[1].error_kind);
  } finally {
    if (backend.listening) await close(backend);
    await close(webServer);
  }
});
