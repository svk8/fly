import * as Sentry from '@sentry/react';

export function sanitizeEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  delete event.request;
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;
  const scrub = (value: unknown): unknown => {
    if (typeof value === 'string') return value
      .replace(/\d{6,12}:[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
      .replace(/(tgWebAppData|initData|authorization|cookie)([=:]\s*)[^\s&]+/gi, '$1$2[redacted]');
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['vars', 'data', 'headers', 'cookies', 'query_string'].includes(key))
      .map(([key, item]) => [key, scrub(item)]));
    return value;
  };
  return scrub(event) as Sentry.ErrorEvent;
}

export async function initMonitoring() {
  try {
    const response = await fetch('/api/client-config', { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return;
    const config = await response.json();
    if (!config.dsn) return;
    Sentry.init({ dsn: config.dsn, environment: config.environment, release: config.release,
      sendDefaultPii: false, tracesSampleRate: 0, beforeSend: sanitizeEvent });
  } catch {
    // Error reporting is optional: an unavailable monitoring service must not block the UI.
  }
}

export { ErrorBoundary } from '@sentry/react';
