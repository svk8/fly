import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeEvent } from '../src/monitoring.ts';

test('browser monitoring strips Telegram authorization, request data and breadcrumbs', () => {
  const token = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678';
  const event: any = { request: { data: 'parcel content', headers: { authorization: 'secret' } },
    user: { id: 1 }, extra: { initData: 'secret' }, breadcrumbs: [{ message: 'private message' }],
    exception: { values: [{ type: 'Error', value: `https://api.telegram.org/bot${token}/sendMessage initData=secret`,
      stacktrace: { frames: [{ filename: 'https://example.com/app.js?tgWebAppData=secret', vars: { token } }] } }] } };
  const clean = sanitizeEvent(event);
  const encoded = JSON.stringify(clean);
  assert.ok(!encoded.includes(token));
  assert.ok(!encoded.includes('parcel content'));
  assert.ok(!encoded.includes('private message'));
  assert.ok(!encoded.includes('secret'));
  assert.equal(clean.exception?.values?.[0].type, 'Error');
});
