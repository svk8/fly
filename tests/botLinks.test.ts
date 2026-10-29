import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botLink, DEFAULT_BOT_URL } from '../src/botLinks.ts';

test('public actions link to the correct bot and keep the selected listing', () => {
  assert.equal(botLink(DEFAULT_BOT_URL, 'parcel_42'), DEFAULT_BOT_URL + '?start=parcel_42');
  assert.equal(botLink(DEFAULT_BOT_URL, 'trip_7'), DEFAULT_BOT_URL + '?start=trip_7');
  assert.equal(botLink(DEFAULT_BOT_URL, 'post_trip'), DEFAULT_BOT_URL + '?start=post_trip');
  assert.equal(botLink(DEFAULT_BOT_URL, 'deals'), DEFAULT_BOT_URL + '?start=deals');
  assert.equal(botLink('https://malicious.example', 'parcel_42'), DEFAULT_BOT_URL + '?start=parcel_42');
  assert.equal(botLink(DEFAULT_BOT_URL, 'parcel_0'), DEFAULT_BOT_URL);
  assert.equal(botLink(DEFAULT_BOT_URL, '../invalid'), DEFAULT_BOT_URL);
});
