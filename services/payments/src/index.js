// payments: pasarela de pago SIMULADA (sección 4.5 del PDF). No usa dinero real.
// Servicio interno: solo orders puede llamarlo (token interno + Nginx no lo expone).

import { createApp, healthRoute, finish, listen, HttpError, parseId } from './lib/server.js';
import { query, initSchemaWithRetry, dbHealthy } from './lib/db.js';
import { requireInternal } from './lib/auth.js';
import { env, intEnv } from './lib/config.js';
import { log } from './lib/logger.js';

process.env.SERVICE_NAME ||= 'payments';

// Regla fija: una tarjeta que termina en este sufijo se rechaza.
const REJECT_SUFFIX = env('REJECT_CARD_SUFFIX', '0000');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS transactions (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER NOT NULL UNIQUE,
  amount     NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  card_last4 TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('aprobado','rechazado')),
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

const mapTx = (t) => ({
  id: t.id,
  order_id: t.order_id,
  amount: Number(t.amount),
  card_last4: t.card_last4,
  status: t.status,
  reason: t.reason,
  created_at: t.created_at,
});

const app = createApp();
healthRoute(app, { database: dbHealthy });

// POST /  { order_id, amount, card_number }
// Idempotente: la UNIQUE(order_id) garantiza que nunca se cobra dos veces la misma orden.
app.post('/', requireInternal, async (req, res) => {
  const orderId = Number(req.body?.order_id);
  const amount = Number(req.body?.amount);
  const card = String(req.body?.card_number || '').replace(/\D/g, '');
  if (!Number.isInteger(orderId) || orderId <= 0) throw new HttpError(400, 'order_id es obligatorio');
  if (!Number.isFinite(amount) || amount < 0) throw new HttpError(400, 'amount inválido');
  if (card.length < 12) throw new HttpError(400, 'card_number inválido');

  const approved = !card.endsWith(REJECT_SUFFIX);
  const status = approved ? 'aprobado' : 'rechazado';
  const reason = approved ? null : `Tarjeta rechazada (termina en ${REJECT_SUFFIX})`;

  const { rows } = await query(
    `INSERT INTO transactions (order_id, amount, card_last4, status, reason)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (order_id) DO NOTHING RETURNING *`,
    [orderId, amount, card.slice(-4), status, reason],
  );

  if (!rows[0]) {
    // Solicitud repetida: devolvemos la transacción original sin cobrar otra vez.
    const { rows: existing } = await query('SELECT * FROM transactions WHERE order_id = $1', [orderId]);
    log.warn('Cobro repetido ignorado (idempotencia)', { order_id: orderId });
    return res.status(200).json({ transaction: mapTx(existing[0]), duplicate: true });
  }

  log.info('Transacción registrada', { order_id: orderId, amount, status });
  res.status(201).json({ transaction: mapTx(rows[0]), duplicate: false });
});

// GET /order/:orderId
app.get('/order/:orderId', requireInternal, async (req, res) => {
  const orderId = parseId(req.params.orderId);
  const { rows } = orderId ? await query('SELECT * FROM transactions WHERE order_id = $1', [orderId]) : { rows: [] };
  if (!rows[0]) throw new HttpError(404, 'No hay transacción para esa orden');
  res.json({ transaction: mapTx(rows[0]) });
});

finish(app);
listen(app, intEnv('PORT', 3004));
initSchemaWithRetry(SCHEMA);
