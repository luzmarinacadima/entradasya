// orders: compras y coordinación del flujo (sección 4.4 y sección 5 del PDF).
// Llama, en orden, a events -> payments -> tickets -> notifications.

import { createApp, healthRoute, finish, listen, HttpError, parseId } from './lib/server.js';
import { query, initSchemaWithRetry, dbHealthy } from './lib/db.js';
import { requireAuth } from './lib/auth.js';
import { env, intEnv } from './lib/config.js';
import { callService } from './lib/http.js';
import { log } from './lib/logger.js';

process.env.SERVICE_NAME ||= 'orders';

const MAX_PER_ORDER = 6;
const EVENTS_URL = env('EVENTS_URL', 'http://localhost:3002');
const PAYMENTS_URL = env('PAYMENTS_URL', 'http://localhost:3004');
const TICKETS_URL = env('TICKETS_URL', 'http://localhost:3005');
const NOTIFICATIONS_URL = env('NOTIFICATIONS_URL', 'http://localhost:3006');
const PUBLIC_URL = env('PUBLIC_URL', 'http://localhost:5173');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL,
  user_email     TEXT NOT NULL,
  user_name      TEXT,
  event_id       INTEGER NOT NULL,
  event_name     TEXT,
  event_date     TIMESTAMPTZ,
  venue          TEXT,
  sector_id      INTEGER NOT NULL,
  sector_name    TEXT,
  quantity       INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND ${MAX_PER_ORDER}),
  unit_price     NUMERIC(10,2) NOT NULL,
  total          NUMERIC(10,2) NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','pagada','rechazada','cancelada')),
  status_reason  TEXT,
  payment_id     INTEGER,
  tickets_issued BOOLEAN NOT NULL DEFAULT false,
  email_sent     BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);`;

const mapOrder = (o) => ({
  id: o.id,
  status: o.status,
  status_reason: o.status_reason,
  event_id: o.event_id,
  event_name: o.event_name,
  event_date: o.event_date,
  venue: o.venue,
  sector_id: o.sector_id,
  sector_name: o.sector_name,
  quantity: o.quantity,
  unit_price: Number(o.unit_price),
  total: Number(o.total),
  payment_id: o.payment_id,
  tickets_issued: o.tickets_issued,
  email_sent: o.email_sent,
  created_at: o.created_at,
  updated_at: o.updated_at,
});

async function updateOrder(id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows } = await query(`UPDATE orders SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`, [
    id,
    ...keys.map((k) => fields[k]),
  ]);
  return rows[0];
}

async function releaseSeats(order) {
  try {
    const r = await callService('events', `${EVENTS_URL}/internal/release`, {
      method: 'POST',
      body: { sector_id: order.sector_id, quantity: order.quantity },
    });
    if (!r.ok) log.error('events no liberó los cupos', { order_id: order.id, status: r.status, data: r.data });
  } catch (err) {
    log.error('No se pudieron liberar los cupos (liberar a mano)', { order_id: order.id, error: err.message });
  }
}

// Pasos 4 y 5: generar entradas y enviar correo.
// Si el correo falla, la compra sigue siendo válida.
async function issueTicketsAndNotify(order) {
  let tickets = [];
  try {
    const r = await callService('tickets', `${TICKETS_URL}/internal/generate`, {
      method: 'POST',
      body: {
        order_id: order.id,
        user_id: order.user_id,
        user_email: order.user_email,
        event_id: order.event_id,
        event_name: order.event_name,
        event_date: order.event_date,
        venue: order.venue,
        sector_name: order.sector_name,
        unit_price: Number(order.unit_price),
        quantity: order.quantity,
      },
      timeoutMs: intEnv('TICKETS_TIMEOUT_MS', 15000), // generar PDFs tarda más
    });
    if (r.ok) {
      tickets = r.data.tickets || [];
      order = await updateOrder(order.id, { tickets_issued: true });
    } else {
      log.error('tickets respondió con error', { order_id: order.id, status: r.status, data: r.data });
    }
  } catch (err) {
    log.error('No se generaron las entradas; el cliente puede reintentar', { order_id: order.id, error: err.message });
  }

  if (order.tickets_issued && !order.email_sent) {
    try {
      const r = await callService('notifications', `${NOTIFICATIONS_URL}/purchase`, {
        method: 'POST',
        body: {
          to: order.user_email,
          name: order.user_name,
          order_id: order.id,
          event_name: order.event_name,
          event_date: order.event_date,
          venue: order.venue,
          sector_name: order.sector_name,
          quantity: order.quantity,
          total: Number(order.total),
          tickets: tickets.map((t) => t.code),
          tickets_url: `${PUBLIC_URL}/mis-entradas`,
        },
      });
      if (r.ok) order = await updateOrder(order.id, { email_sent: true });
      else log.warn('notifications no envió el correo (la compra sigue válida)', { order_id: order.id, status: r.status });
    } catch (err) {
      log.warn('notifications no disponible: la compra sigue válida', { order_id: order.id, error: err.message });
    }
  }
  return { order, tickets };
}

const app = createApp();
healthRoute(app, { database: dbHealthy });

// POST /  { event_id, sector_id, quantity, card_number }
app.post('/', requireAuth('cliente'), async (req, res) => {
  const eventId = Number(req.body?.event_id);
  const sectorId = Number(req.body?.sector_id);
  const quantity = Number(req.body?.quantity);
  const card = String(req.body?.card_number || '').replace(/[\s-]/g, '');

  if (!Number.isInteger(eventId) || !Number.isInteger(sectorId)) throw new HttpError(400, 'event_id y sector_id son obligatorios');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PER_ORDER) {
    throw new HttpError(400, `La cantidad debe ser entre 1 y ${MAX_PER_ORDER} entradas por compra`);
  }
  if (!/^\d{12,19}$/.test(card)) throw new HttpError(400, 'Número de tarjeta inválido (12 a 19 dígitos)');

  // Datos del evento (precio, nombre) pedidos a events por HTTP
  const ev = await callService('events', `${EVENTS_URL}/${eventId}`);
  if (ev.status === 404) throw new HttpError(404, 'Evento no encontrado');
  if (!ev.ok) throw new HttpError(502, 'events respondió con error');
  const event = ev.data.event;
  if (event.status !== 'publicado') throw new HttpError(409, 'Este evento no está a la venta');
  const sector = event.sectors.find((s) => s.id === sectorId);
  if (!sector) throw new HttpError(404, 'El sector no pertenece a este evento');

  // Paso 1: orden en estado pendiente
  const total = Number((sector.price * quantity).toFixed(2));
  const { rows } = await query(
    `INSERT INTO orders (user_id, user_email, user_name, event_id, event_name, event_date, venue,
                         sector_id, sector_name, quantity, unit_price, total)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [req.user.id, req.user.email, req.user.name, event.id, event.name, event.event_date, event.venue,
      sector.id, sector.name, quantity, sector.price, total],
  );
  let order = rows[0];
  log.info('Orden creada (pendiente)', { order_id: order.id, user_id: req.user.id, quantity, total });

  // Paso 2: reservar cupos en events
  let reserve;
  try {
    reserve = await callService('events', `${EVENTS_URL}/internal/reserve`, {
      method: 'POST',
      body: { sector_id: sector.id, quantity },
    });
  } catch (err) {
    order = await updateOrder(order.id, { status: 'cancelada', status_reason: 'No se pudo reservar (events no disponible)' });
    throw err;
  }
  if (!reserve.ok) {
    const reason = reserve.status === 409 ? 'Agotado' : 'No se pudo reservar';
    order = await updateOrder(order.id, { status: 'cancelada', status_reason: reserve.data?.error || reason });
    return res.status(409).json({ error: reserve.data?.error || reason, order: mapOrder(order) });
  }

  // Paso 3: cobrar en payments
  let payment;
  try {
    payment = await callService('payments', `${PAYMENTS_URL}/`, {
      method: 'POST',
      body: { order_id: order.id, amount: total, card_number: card },
    });
  } catch (err) {
    await releaseSeats(order);
    order = await updateOrder(order.id, { status: 'rechazada', status_reason: 'No se pudo cobrar (payments no disponible)' });
    throw err;
  }
  const tx = payment.data?.transaction;
  if (!payment.ok || !tx || tx.status !== 'aprobado') {
    await releaseSeats(order);
    order = await updateOrder(order.id, {
      status: 'rechazada',
      status_reason: tx?.reason || payment.data?.error || 'Pago rechazado',
      payment_id: tx?.id ?? null,
    });
    log.warn('Pago rechazado, cupos liberados', { order_id: order.id });
    return res.status(402).json({ error: 'Pago rechazado', order: mapOrder(order) });
  }
  order = await updateOrder(order.id, { status: 'pagada', status_reason: null, payment_id: tx.id });
  log.info('Orden pagada', { order_id: order.id, payment_id: tx.id });

  // Pasos 4 y 5
  const result = await issueTicketsAndNotify(order);
  res.status(201).json({ order: mapOrder(result.order), tickets: result.tickets });
});

// GET /mine -> historial de compras del cliente
app.get('/mine', requireAuth(), async (req, res) => {
  const { rows } = await query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ orders: rows.map(mapOrder) });
});

async function loadOwnOrder(req) {
  const id = parseId(req.params.id);
  const { rows } = id ? await query('SELECT * FROM orders WHERE id = $1', [id]) : { rows: [] };
  if (!rows[0] || rows[0].user_id !== req.user.id) throw new HttpError(404, 'Orden no encontrada');
  return rows[0];
}

// GET /:id
app.get('/:id', requireAuth(), async (req, res) => {
  res.json({ order: mapOrder(await loadOwnOrder(req)) });
});

// POST /:id/retry -> reintenta generar entradas y enviar el correo de una orden pagada
app.post('/:id/retry', requireAuth(), async (req, res) => {
  const order = await loadOwnOrder(req);
  if (order.status !== 'pagada') throw new HttpError(409, 'Solo se puede reintentar una orden pagada');
  const result = await issueTicketsAndNotify(order);
  res.json({ order: mapOrder(result.order), tickets: result.tickets });
});

finish(app);
listen(app, intEnv('PORT', 3003));
initSchemaWithRetry(SCHEMA);
