// events: catálogo de eventos, sectores y cupos (sección 4.3 del PDF).
// No llama a ningún servicio; solo responde. orders le pide reservar/liberar cupos.

import { createApp, healthRoute, finish, listen, HttpError, parseId } from './lib/server.js';
import { query, withTransaction, initSchemaWithRetry, dbHealthy } from './lib/db.js';
import { requireAuth, optionalAuth, requireInternal } from './lib/auth.js';
import { intEnv } from './lib/config.js';
import { log } from './lib/logger.js';

process.env.SERVICE_NAME ||= 'events';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id             SERIAL PRIMARY KEY,
  organizer_id   INTEGER NOT NULL,
  organizer_name TEXT,
  name           TEXT NOT NULL,
  event_date     TIMESTAMPTZ NOT NULL,
  venue          TEXT NOT NULL,
  image_url      TEXT,
  description    TEXT,
  status         TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador','publicado','cancelado')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sectors (
  id        SERIAL PRIMARY KEY,
  event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  price     NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  capacity  INTEGER NOT NULL CHECK (capacity > 0),
  available INTEGER NOT NULL CHECK (available >= 0 AND available <= capacity)
);
CREATE INDEX IF NOT EXISTS idx_sectors_event ON sectors(event_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);`;

const STATUS_TRANSITIONS = {
  borrador: ['publicado', 'cancelado'],
  publicado: ['cancelado'],
  cancelado: [],
};

const mapSector = (s) => ({
  id: s.id,
  name: s.name,
  price: Number(s.price),
  capacity: s.capacity,
  available: s.available,
  sold: s.capacity - s.available,
});

const mapEvent = (e, sectors = []) => ({
  id: e.id,
  organizer_id: e.organizer_id,
  organizer_name: e.organizer_name,
  name: e.name,
  event_date: e.event_date,
  venue: e.venue,
  image_url: e.image_url,
  description: e.description,
  status: e.status,
  created_at: e.created_at,
  updated_at: e.updated_at,
  sectors: sectors.map(mapSector),
});

async function loadEvents(whereSql, params) {
  const { rows: events } = await query(`SELECT * FROM events ${whereSql} ORDER BY event_date ASC`, params);
  if (!events.length) return [];
  const { rows: sectors } = await query('SELECT * FROM sectors WHERE event_id = ANY($1) ORDER BY price ASC, id ASC', [
    events.map((e) => e.id),
  ]);
  return events.map((e) => mapEvent(e, sectors.filter((s) => s.event_id === e.id)));
}

async function loadEvent(id) {
  const [event] = await loadEvents('WHERE id = $1', [id]);
  return event || null;
}

async function loadOwnedEvent(req) {
  const id = parseId(req.params.id);
  const event = id && (await loadEvent(id));
  if (!event) throw new HttpError(404, 'Evento no encontrado');
  if (event.organizer_id !== req.user.id) throw new HttpError(403, 'Este evento pertenece a otro organizador');
  return event;
}

function validateEventFields(body, { partial = false } = {}) {
  const out = {};
  const { name, event_date, venue, image_url, description } = body;
  if (!partial || name !== undefined) {
    if (!name || String(name).trim().length < 3) throw new HttpError(400, 'El nombre del evento es obligatorio (mín. 3 caracteres)');
    out.name = String(name).trim();
  }
  if (!partial || event_date !== undefined) {
    const d = new Date(event_date);
    if (!event_date || Number.isNaN(d.getTime())) throw new HttpError(400, 'La fecha del evento no es válida (usa ISO, ej. 2026-12-20T20:00:00-04:00)');
    out.event_date = d.toISOString();
  }
  if (!partial || venue !== undefined) {
    if (!venue || String(venue).trim().length < 2) throw new HttpError(400, 'El lugar es obligatorio');
    out.venue = String(venue).trim();
  }
  if (image_url !== undefined) out.image_url = image_url ? String(image_url).trim() : null;
  if (description !== undefined) out.description = description ? String(description).trim() : null;
  return out;
}

function validateSectors(sectors) {
  if (!Array.isArray(sectors) || sectors.length === 0) {
    throw new HttpError(400, 'El evento necesita al menos un sector (ej. General, Preferencia, VIP)');
  }
  return sectors.map((s, i) => {
    const name = String(s?.name || '').trim();
    const price = Number(s?.price);
    const capacity = Number(s?.capacity);
    if (!name) throw new HttpError(400, `Sector ${i + 1}: falta el nombre`);
    if (!Number.isFinite(price) || price < 0) throw new HttpError(400, `Sector ${name}: precio inválido`);
    if (!Number.isInteger(capacity) || capacity <= 0) throw new HttpError(400, `Sector ${name}: el cupo debe ser un entero mayor a 0`);
    return { name, price, capacity };
  });
}

async function insertSectors(client, eventId, sectors) {
  for (const s of sectors) {
    await client.query('INSERT INTO sectors (event_id, name, price, capacity, available) VALUES ($1, $2, $3, $4, $4)', [
      eventId,
      s.name,
      s.price,
      s.capacity,
    ]);
  }
}

const app = createApp();
healthRoute(app, { database: dbHealthy });

// ---------- Rutas internas (solo orders) ----------

// POST /internal/reserve { sector_id, quantity }
// Reserva atómica: nunca se vende más que el cupo disponible.
app.post('/internal/reserve', requireInternal, async (req, res) => {
  const sectorId = Number(req.body?.sector_id);
  const quantity = Number(req.body?.quantity);
  if (!Number.isInteger(sectorId) || !Number.isInteger(quantity) || quantity <= 0) {
    throw new HttpError(400, 'sector_id y quantity son obligatorios');
  }
  const { rows } = await query(
    `UPDATE sectors s SET available = s.available - $2
       FROM events e
      WHERE s.id = $1 AND e.id = s.event_id AND e.status = 'publicado' AND s.available >= $2
      RETURNING s.*`,
    [sectorId, quantity],
  );
  if (rows[0]) {
    log.info('Cupos reservados', { sector_id: sectorId, quantity, quedan: rows[0].available });
    return res.json({ reserved: true, sector: mapSector(rows[0]) });
  }
  const { rows: found } = await query(
    'SELECT s.*, e.status AS event_status FROM sectors s JOIN events e ON e.id = s.event_id WHERE s.id = $1',
    [sectorId],
  );
  if (!found[0]) throw new HttpError(404, 'Sector no encontrado');
  if (found[0].event_status !== 'publicado') throw new HttpError(409, 'El evento no está a la venta', { reserved: false });
  log.warn('Reserva rechazada: sin cupo', { sector_id: sectorId, pedidos: quantity, disponibles: found[0].available });
  throw new HttpError(409, 'Agotado', { reserved: false, available: found[0].available });
});

// POST /internal/release { sector_id, quantity }  (pago rechazado / compra fallida)
app.post('/internal/release', requireInternal, async (req, res) => {
  const sectorId = Number(req.body?.sector_id);
  const quantity = Number(req.body?.quantity);
  if (!Number.isInteger(sectorId) || !Number.isInteger(quantity) || quantity <= 0) {
    throw new HttpError(400, 'sector_id y quantity son obligatorios');
  }
  const { rows } = await query(
    'UPDATE sectors SET available = LEAST(capacity, available + $2) WHERE id = $1 RETURNING *',
    [sectorId, quantity],
  );
  if (!rows[0]) throw new HttpError(404, 'Sector no encontrado');
  log.info('Cupos liberados', { sector_id: sectorId, quantity, disponibles: rows[0].available });
  res.json({ released: true, sector: mapSector(rows[0]) });
});

// ---------- Rutas públicas / organizador ----------

// GET /  -> cartelera: solo eventos publicados
app.get('/', async (_req, res) => {
  res.json({ events: await loadEvents("WHERE status = 'publicado'", []) });
});

// GET /mine -> eventos del organizador (todos los estados)
app.get('/mine', requireAuth('organizador'), async (req, res) => {
  res.json({ events: await loadEvents('WHERE organizer_id = $1', [req.user.id]) });
});

// GET /:id -> detalle. Borradores y cancelados solo los ve su organizador
// (o un servicio interno, p. ej. orders).
app.get('/:id', optionalAuth, async (req, res) => {
  const id = parseId(req.params.id);
  const event = id && (await loadEvent(id));
  if (!event) throw new HttpError(404, 'Evento no encontrado');
  const isOwner = req.user && req.user.id === event.organizer_id;
  const isInternal = req.headers['x-internal-token'] && req.headers['x-internal-token'] === process.env.INTERNAL_TOKEN;
  if (event.status !== 'publicado' && !isOwner && !isInternal) throw new HttpError(404, 'Evento no encontrado');
  res.json({ event });
});

// POST /  { name, event_date, venue, image_url?, description?, sectors: [{name, price, capacity}] }
app.post('/', requireAuth('organizador'), async (req, res) => {
  const fields = validateEventFields(req.body || {});
  const sectors = validateSectors(req.body?.sectors);
  const id = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO events (organizer_id, organizer_name, name, event_date, venue, image_url, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [req.user.id, req.user.name, fields.name, fields.event_date, fields.venue, fields.image_url ?? null, fields.description ?? null],
    );
    await insertSectors(client, rows[0].id, sectors);
    return rows[0].id;
  });
  log.info('Evento creado', { event_id: id, organizer_id: req.user.id });
  res.status(201).json({ event: await loadEvent(id) });
});

// PUT /:id  -> editar datos. Los sectores solo se pueden reemplazar en borrador.
app.put('/:id', requireAuth('organizador'), async (req, res) => {
  const event = await loadOwnedEvent(req);
  if (event.status === 'cancelado') throw new HttpError(409, 'Un evento cancelado no se puede editar');
  const fields = validateEventFields(req.body || {}, { partial: true });
  const newSectors = req.body?.sectors !== undefined ? validateSectors(req.body.sectors) : null;
  if (newSectors && event.status !== 'borrador') {
    throw new HttpError(409, 'Los sectores solo se pueden cambiar mientras el evento está en borrador');
  }
  await withTransaction(async (client) => {
    const keys = Object.keys(fields);
    if (keys.length) {
      const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
      await client.query(`UPDATE events SET ${sets}, updated_at = now() WHERE id = $1`, [event.id, ...keys.map((k) => fields[k])]);
    }
    if (newSectors) {
      await client.query('DELETE FROM sectors WHERE event_id = $1', [event.id]);
      await insertSectors(client, event.id, newSectors);
    }
  });
  res.json({ event: await loadEvent(event.id) });
});

// PATCH /:id/status { status: 'publicado' | 'cancelado' }
app.patch('/:id/status', requireAuth('organizador'), async (req, res) => {
  const event = await loadOwnedEvent(req);
  const next = req.body?.status;
  if (!STATUS_TRANSITIONS[event.status].includes(next)) {
    throw new HttpError(409, `No se puede pasar de "${event.status}" a "${next}"`);
  }
  await query('UPDATE events SET status = $2, updated_at = now() WHERE id = $1', [event.id, next]);
  log.info('Estado de evento cambiado', { event_id: event.id, de: event.status, a: next });
  res.json({ event: await loadEvent(event.id) });
});

// GET /:id/sales -> ventas e ingresos por sector (solo el organizador dueño)
app.get('/:id/sales', requireAuth('organizador'), async (req, res) => {
  const event = await loadOwnedEvent(req);
  const sectors = event.sectors.map((s) => ({ ...s, revenue: Number((s.sold * s.price).toFixed(2)) }));
  res.json({
    event_id: event.id,
    name: event.name,
    status: event.status,
    sectors,
    totals: {
      capacity: sectors.reduce((a, s) => a + s.capacity, 0),
      sold: sectors.reduce((a, s) => a + s.sold, 0),
      revenue: Number(sectors.reduce((a, s) => a + s.revenue, 0).toFixed(2)),
    },
  });
});

finish(app);
listen(app, intEnv('PORT', 3002));
initSchemaWithRetry(SCHEMA);
