/** Every API call carries Telegram-signed data; no browser demo identity can write. */
export async function apiFetch(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('X-Telegram-Init-Data', (window as any).Telegram?.WebApp?.initData || '');
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Не удалось выполнить запрос.');
  }
  return response;
}
