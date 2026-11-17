// tickets: genera y valida entradas (sección 4.6 del PDF).
// Una entrada por asiento, código único, PDF con QR guardado en una carpeta local.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { createApp, healthRoute, finish, listen, HttpError, parseId } from './lib/server.js';
import { query, initSchemaWithRetry, dbHealthy } from './lib/db.js';
import { requireAuth, requireInternal } from './lib/auth.js';
import { env, intEnv } from './lib/config.js';
import { log } from './lib/logger.js';

process.env.SERVICE_NAME ||= 'tickets';

const TICKETS_DIR = path.resolve(env('TICKETS_DIR', './data/tickets'));
const TIMEZONE = env('EVENT_TIMEZONE', 'America/La_Paz');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para no confundir
const CODE_REGEX = /^EY-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tickets (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  order_id    INTEGER NOT NULL,
  seat_number INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  user_email  TEXT,
  event_id    INTEGER NOT NULL,
  event_name  TEXT NOT NULL,
  event_date  TIMESTAMPTZ,
  venue       TEXT,
  sector_name TEXT,
  unit_price  NUMERIC(10,2),
  status      TEXT NOT NULL DEFAULT 'valida' CHECK (status IN ('valida','anulada')),
  pdf_file    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, seat_number)
);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_order ON tickets(order_id);`;

function newCode() {
  const bytes = crypto.randomBytes(8);
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `EY-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

const formatDate = (d) =>
  d ? new Date(d).toLocaleString('es-BO', { timeZone: TIMEZONE, dateStyle: 'full', timeStyle: 'short' }) : '—';

const mapTicket = (t) => ({
  id: t.id,
  code: t.code,
  order_id: t.order_id,
  seat_number: t.seat_number,
  event_id: t.event_id,
  event_name: t.event_name,
  event_date: t.event_date,
  venue: t.venue,
  sector_name: t.sector_name,
  unit_price: t.unit_price === null ? null : Number(t.unit_price),
  status: t.status,
  created_at: t.created_at,
  download_url: `/api/tickets/${t.code}/pdf`,
});

// Crea el PDF de una entrada con su QR y lo guarda en TICKETS_DIR.
async function createPdf(t) {
  const file = path.join(TICKETS_DIR, `${t.code}.pdf`);
  const qr = await QRCode.toBuffer(t.code, { width: 360, margin: 1, errorCorrectionLevel: 'M' });
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 40, info: { Title: `Entrada ${t.code}` } });
    const out = fs.createWriteStream(file);
    out.on('finish', resolve);
    out.on('error', reject);
    doc.on('error', reject);
    doc.pipe(out);

    const w = doc.page.width;
    doc.rect(0, 0, w, 70).fill('#b91c1c');
    doc.fillColor('#ffffff').fontSize(24).font('Helvetica-Bold').text('EntradasYa', 40, 22);
    doc.moveDown(2).fillColor('#111827');
    doc.fontSize(18).font('Helvetica-Bold').text(t.event_name, 40, 95, { width: w - 80 });
    doc.moveDown(0.5).fontSize(11).font('Helvetica');
    doc.text(`Fecha: ${formatDate(t.event_date)}`);
    doc.text(`Lugar: ${t.venue || '—'}`);
    doc.text(`Sector: ${t.sector_name || '—'}   ·   Asiento ${t.seat_number}`);
    if (t.unit_price !== null && t.unit_price !== undefined) doc.text(`Precio: Bs ${Number(t.unit_price).toFixed(2)}`);
    doc.text(`Orden N.º ${t.order_id}`);

    const qrSize = 190;
    const qrY = doc.y + 20;
    doc.image(qr, (w - qrSize) / 2, qrY, { width: qrSize });
    doc.font('Helvetica-Bold').fontSize(16).text(t.code, 40, qrY + qrSize + 10, { width: w - 80, align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
      .text('Presenta este código QR en la puerta. Válido para un solo ingreso.', { width: w - 80, align: 'center' });
    doc.end();
  });
  return path.basename(file);
}

const app = createApp();
healthRoute(app, {
  database: dbHealthy,
  tickets_dir: async () => {
    await fsp.access(TICKETS_DIR, fs.constants.W_OK);
    return true;
  },
});

// ---------- Rutas internas ----------

// POST /internal/generate (desde orders). Idempotente por (order_id, seat_number).
app.post('/internal/generate', requireInternal, async (req, res) => {
  const b = req.body || {};
  const orderId = Number(b.order_id);
  const quantity = Number(b.quantity);
  if (!Number.isInteger(orderId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 6) {
    throw new HttpError(400, 'order_id y quantity (1-6) son obligatorios');
  }
  if (!b.event_id || !b.event_name || !b.user_id) throw new HttpError(400, 'Faltan datos del evento o del usuario');

  for (let seat = 1; seat <= quantity; seat++) {
    const { rows: exists } = await query('SELECT 1 FROM tickets WHERE order_id = $1 AND seat_number = $2', [orderId, seat]);
    if (exists.length) continue;
    for (let attempt = 0; attempt < 5; attempt++) {
      const ticket = {
        code: newCode(),
        order_id: orderId,
        seat_number: seat,
        event_name: b.event_name,
        event_date: b.event_date,
        venue: b.venue,
        sector_name: b.sector_name,
        unit_price: b.unit_price,
      };
      const pdfFile = await createPdf(ticket);
      try {
        await query(
          `INSERT INTO tickets (code, order_id, seat_number, user_id, user_email, event_id, event_name,
                                event_date, venue, sector_name, unit_price, pdf_file)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [ticket.code, orderId, seat, b.user_id, b.user_email ?? null, b.event_id, b.event_name,
            b.event_date ?? null, b.venue ?? null, b.sector_name ?? null, b.unit_price ?? null, pdfFile],
        );
        break;
      } catch (err) {
        await fsp.rm(path.join(TICKETS_DIR, pdfFile), { force: true });
        if (err.code === '23505' && String(err.constraint || '').includes('code')) continue; // código repetido: otro
        if (err.code === '23505') break; // ese asiento ya se generó en paralelo
        throw err;
      }
    }
  }

  const { rows } = await query('SELECT * FROM tickets WHERE order_id = $1 ORDER BY seat_number', [orderId]);
  log.info('Entradas emitidas', { order_id: orderId, cantidad: rows.length });
  res.status(201).json({ tickets: rows.map(mapTicket) });
});

// GET /internal/validate/:code (desde checkin): ¿existe?, ¿de qué evento?, ¿es válida?
app.get('/internal/validate/:code', requireInternal, async (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const { rows } = CODE_REGEX.test(code) ? await query('SELECT * FROM tickets WHERE code = $1', [code]) : { rows: [] };
  if (!rows[0]) return res.json({ exists: false, code });
  const t = rows[0];
  res.json({
    exists: true,
    code: t.code,
    event_id: t.event_id,
    event_name: t.event_name,
    sector_name: t.sector_name,
    seat_number: t.seat_number,
    order_id: t.order_id,
    status: t.status,
    valid: t.status === 'valida', // solo se emiten entradas de órdenes pagadas
  });
});

// ---------- Rutas para el cliente ----------

// GET /mine -> entradas del usuario
app.get('/mine', requireAuth(), async (req, res) => {
  const { rows } = await query('SELECT * FROM tickets WHERE user_id = $1 ORDER BY created_at DESC, seat_number', [req.user.id]);
  res.json({ tickets: rows.map(mapTicket) });
});

// GET /order/:orderId -> entradas de una orden del usuario
app.get('/order/:orderId', requireAuth(), async (req, res) => {
  const orderId = parseId(req.params.orderId);
  const { rows } = orderId
    ? await query('SELECT * FROM tickets WHERE order_id = $1 AND user_id = $2 ORDER BY seat_number', [orderId, req.user.id])
    : { rows: [] };
  res.json({ tickets: rows.map(mapTicket) });
});

// GET /:code/pdf -> descarga del PDF (solo el dueño)
app.get('/:code/pdf', requireAuth(), async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  if (!CODE_REGEX.test(code)) throw new HttpError(404, 'Entrada no encontrada');
  const { rows } = await query('SELECT * FROM tickets WHERE code = $1 AND user_id = $2', [code, req.user.id]);
  if (!rows[0]) throw new HttpError(404, 'Entrada no encontrada');
  let file = path.join(TICKETS_DIR, rows[0].pdf_file || `${code}.pdf`);
  if (!fs.existsSync(file)) {
    log.warn('PDF no encontrado en disco, se regenera', { code });
    file = path.join(TICKETS_DIR, await createPdf(rows[0]));
  }
  res.download(file, `entrada-${code}.pdf`);
});

await fsp.mkdir(TICKETS_DIR, { recursive: true });
log.info('Carpeta de PDFs', { TICKETS_DIR });
finish(app);
listen(app, intEnv('PORT', 3005));
initSchemaWithRetry(SCHEMA);
