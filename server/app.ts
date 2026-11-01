import express from 'express';
import { requestId, milliseconds, backendTimings, type HealthLogger } from './healthDiagnostics.ts';

/** Python owns Telegram authentication, business rules, and all persistent data. */
export function createApp(apiUrl: string, healthLog: HealthLogger = record => console.log(JSON.stringify(record))) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use('/api', async (req, res) => {
    if (!['GET', 'POST'].includes(req.method)) { res.status(405).json({ error: 'Метод не поддерживается.' }); return; }
    const health = req.method === 'GET' && req.originalUrl.split('?')[0] === '/api/health';
    const started = performance.now();
    const id = health ? requestId(req.get('X-Request-ID')) : '';
    let headersMs: number | null = null;
    let errorKind: string | null = null;
    let db: Record<string, number> = {};
    if (health) {
      res.setHeader('X-Request-ID', id);
      let recorded = false;
      const record = (aborted: boolean) => {
        if (recorded) return;
        recorded = true;
        // A strict allowlist: never record URL/query, headers, request or response bodies.
        healthLog({ event: 'health_proxy', at: new Date().toISOString(), request_id: id,
          status: aborted ? 499 : res.statusCode, client_aborted: aborted,
          total_ms: milliseconds(started), upstream_headers_ms: headersMs, ...db, error_kind: errorKind });
      };
      res.on('finish', () => record(false));
      res.on('close', () => { if (!res.writableFinished) record(true); });
    }
    try {
      const upstream = await fetch(new URL(req.originalUrl, apiUrl), {
        method: req.method,
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': req.get('X-Telegram-Init-Data') || '', ...(health ? {'X-Request-ID': id} : {}) },
        body: req.method === 'POST' ? JSON.stringify(req.body ?? {}) : undefined,
        signal: AbortSignal.timeout(15000), redirect: 'error'
      });
      if (health) {
        headersMs = milliseconds(started);
        db = backendTimings(upstream.headers.get('Server-Timing'));
        const timing = Object.entries(db).map(([key, value]) => `${key.replace(/_ms$/, '')};dur=${value}`).join(', ');
        res.setHeader('Server-Timing', `proxy_headers;dur=${headersMs}${timing ? ', ' + timing : ''}`);
      }
      res.setHeader('Cache-Control', 'no-store');
      res.status(upstream.status).type('application/json').send(await upstream.text());
    } catch (error) {
      errorKind = error instanceof Error && /^[A-Za-z]+$/.test(error.name) ? error.name : 'UpstreamError';
      res.status(503).json({ error: 'Бот временно недоступен. Попробуйте позже.' });
    }
  });
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status || 500).json({ error: 'Некорректный запрос.' });
  });
  return app;
}
