export const DEFAULT_BOT_URL = 'https://t.me/crowdship_p2p_bot';

export function botLink(base: string, action = '') {
  let url: URL;
  try {
    url = new URL(base);
    if (url.protocol !== 'https:' || url.hostname !== 't.me' || !/^\/[A-Za-z0-9_]{5,32}$/.test(url.pathname)) throw Error();
  } catch { url = new URL(DEFAULT_BOT_URL); }
  url.search = '';
  url.hash = '';
  if (/^(?:(?:parcel|trip)_[1-9]\d*|post_parcel|post_trip|deals|support)$/.test(action)) url.searchParams.set('start', action);
  return url.toString();
}
