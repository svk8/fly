import express from 'express';

/** Python owns Telegram authentication, business rules, and all persistent data. */
export function createApp(apiUrl: string) {
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
    try {
      const upstream = await fetch(new URL(req.originalUrl, apiUrl), {
        method: req.method,
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': req.get('X-Telegram-Init-Data') || '' },
        body: req.method === 'POST' ? JSON.stringify(req.body ?? {}) : undefined,
        signal: AbortSignal.timeout(15000), redirect: 'error'
      });
      res.setHeader('Cache-Control', 'no-store');
      res.status(upstream.status).type('application/json').send(await upstream.text());
    } catch {
      res.status(503).json({ error: 'Бот временно недоступен. Попробуйте позже.' });
    }
  });
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status || 500).json({ error: 'Некорректный запрос.' });
  });
  return app;
}
