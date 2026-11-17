// Piezas comunes de Express: app base, chequeo de salud, errores y arranque.

import express from 'express';
import { log, requestLogger } from './logger.js';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true); // detrás de Nginx
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);
  return app;
}

/**
 * Chequeo de salud (requisito técnico 5).
 * Responde 200 si el servicio funciona Y puede atender (p. ej. tiene base de datos);
 * 503 si alguna dependencia propia falla.
 */
export function healthRoute(app, checks = {}) {
  app.get('/health', async (_req, res) => {
    const results = {};
    let healthy = true;
    for (const [name, check] of Object.entries(checks)) {
      try {
        results[name] = (await check()) ? 'ok' : 'error';
      } catch {
        results[name] = 'error';
      }
      if (results[name] !== 'ok') healthy = false;
    }
    res.status(healthy ? 200 : 503).json({
      service: process.env.SERVICE_NAME,
      status: healthy ? 'ok' : 'degradado',
      checks: results,
      uptime_s: Math.round(process.uptime()),
      time: new Date().toISOString(),
    });
  });
}

export function finish(app) {
  app.use((req, res) => res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'El cuerpo no es un JSON válido' });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err.status === 503 && err.service) return res.status(503).json({ error: err.message });
    log.error('Error no controlado', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Error interno del servidor' });
  });
}

export function listen(app, port) {
  const server = app.listen(port, () => log.info(`Servicio escuchando en el puerto ${port}`));
  const shutdown = (signal) => {
    log.info(`Señal ${signal} recibida, cerrando el servicio`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => log.error('Promesa rechazada sin manejar', { error: String(err) }));
  return server;
}

// Validaciones pequeñas reutilizables
export const isPositiveInt = (v) => Number.isInteger(v) && v > 0;
export function parseId(value) {
  const s = String(value ?? '');
  return /^\d+$/.test(s) ? Number(s) : null;
}
