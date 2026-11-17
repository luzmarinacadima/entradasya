// Logs en consola con fecha, nivel y mensaje (requisito técnico 6).
// Formato: 2026-11-16T21:00:00.000Z INFO  [events] Mensaje {"dato":1}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function write(level, message, meta) {
  const min = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;
  if (LEVELS[level] < min) return;
  const service = process.env.SERVICE_NAME || 'servicio';
  const extra = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${service}] ${message}${extra}`;
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg, meta) => write('debug', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
};

// Middleware de Express: registra cada petición al terminar.
export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/health') return; // no llenar los logs con los chequeos de salud
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    write(level, `${req.method} ${req.originalUrl} -> ${res.statusCode}`, { ms: Date.now() - start });
  });
  next();
}
