// checkin: control de ingreso a los eventos (sección 4.8 y sección 6 del PDF).
// Recibe el código escaneado, pide a tickets que lo valide y registra el ingreso.

import { createApp, healthRoute, finish, listen, HttpError, parseId } from './lib/server.js';
import { query, initSchemaWithRetry, dbHealthy } from './lib/db.js';
import { requireAuth } from './lib/auth.js';
import { env, intEnv } from './lib/config.js';
import { callService } from './lib/http.js';
import { log } from './lib/logger.js';

process.env.SERVICE_NAME ||= 'checkin';

const TICKETS_URL = env('TICKETS_URL', 'http://localhost:3005');

// UNIQUE(ticket_code): una entrada solo puede registrar UN ingreso,
// incluso si dos porteros la escanean al mismo tiempo.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS checkins (
  id          SERIAL PRIMARY KEY,
  ticket_code TEXT NOT NULL UNIQUE,
  event_id    INTEGER NOT NULL,
  porter_id   INTEGER NOT NULL,
  porter_name TEXT,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checkins_event ON checkins(event_id);`;

const reject = (res, status, reason, extra = {}) => {
  log.warn('Ingreso rechazado', { reason, ...extra });
  return res.status(status).json({ allowed: false, reason, ...extra });
};

const app = createApp();
healthRoute(app, { database: dbHealthy });

// POST /  { code, event_id }  (portero)
app.post('/', requireAuth('portero', 'organizador'), async (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const eventId = Number(req.body?.event_id);
  if (!code) throw new HttpError(400, 'Escanea o escribe el código de la entrada');
  if (!Number.isInteger(eventId) || eventId <= 0) throw new HttpError(400, 'Selecciona el evento en el que estás trabajando');

  // Paso 2: tickets valida el código
  const r = await callService('tickets', `${TICKETS_URL}/internal/validate/${encodeURIComponent(code)}`);
  if (!r.ok) throw new HttpError(502, 'tickets respondió con error al validar');
  const t = r.data;

  if (!t.exists) return reject(res, 404, 'Código inválido', { code });
  if (t.event_id !== eventId) {
    return reject(res, 422, 'Entrada de otro evento', { code, ticket_event: t.event_name, ticket_event_id: t.event_id });
  }
  if (!t.valid) return reject(res, 422, 'Entrada no válida (anulada)', { code });

  // Paso 3: registrar el ingreso si no fue usada antes
  const { rows } = await query(
    `INSERT INTO checkins (ticket_code, event_id, porter_id, porter_name)
     VALUES ($1, $2, $3, $4) ON CONFLICT (ticket_code) DO NOTHING RETURNING *`,
    [code, eventId, req.user.id, req.user.name],
  );
  if (!rows[0]) {
    const { rows: prev } = await query('SELECT * FROM checkins WHERE ticket_code = $1', [code]);
    return reject(res, 409, 'Entrada ya utilizada', {
      code,
      first_checkin_at: prev[0]?.checked_at,
      first_porter: prev[0]?.porter_name,
    });
  }

  const { rows: count } = await query('SELECT COUNT(*)::int AS total FROM checkins WHERE event_id = $1', [eventId]);
  log.info('Ingreso permitido', { code, event_id: eventId, porter_id: req.user.id });
  res.status(201).json({
    allowed: true,
    reason: 'Ingreso permitido',
    code,
    sector_name: t.sector_name,
    seat_number: t.seat_number,
    checked_at: rows[0].checked_at,
    total_ingresos: count[0].total,
  });
});

// GET /stats -> cuántas personas ingresaron a cada evento
app.get('/stats', requireAuth('portero', 'organizador'), async (_req, res) => {
  const { rows } = await query(
    'SELECT event_id, COUNT(*)::int AS total, MAX(checked_at) AS last_checkin_at FROM checkins GROUP BY event_id ORDER BY event_id',
  );
  res.json({ events: rows });
});

// GET /stats/:eventId -> total y últimos ingresos de un evento
app.get('/stats/:eventId', requireAuth('portero', 'organizador'), async (req, res) => {
  const eventId = parseId(req.params.eventId);
  if (!eventId) throw new HttpError(400, 'eventId inválido');
  const { rows: total } = await query('SELECT COUNT(*)::int AS total FROM checkins WHERE event_id = $1', [eventId]);
  const { rows: last } = await query(
    'SELECT ticket_code, porter_name, checked_at FROM checkins WHERE event_id = $1 ORDER BY checked_at DESC LIMIT 10',
    [eventId],
  );
  res.json({ event_id: eventId, total: total[0].total, last_checkins: last });
});

finish(app);
listen(app, intEnv('PORT', 3007));
initSchemaWithRetry(SCHEMA);
