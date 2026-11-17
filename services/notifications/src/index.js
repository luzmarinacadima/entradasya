// notifications: envía los correos del sistema (sección 4.7 del PDF).
// En la v1 los correos van a Mailpit (SMTP de pruebas). No tiene base de datos:
// solo deja registro en sus logs. Servicio interno.

import nodemailer from 'nodemailer';
import { createApp, healthRoute, finish, listen, HttpError } from './lib/server.js';
import { requireInternal } from './lib/auth.js';
import { env, intEnv, boolEnv } from './lib/config.js';
import { log } from './lib/logger.js';

process.env.SERVICE_NAME ||= 'notifications';

const FROM = env('MAIL_FROM', 'EntradasYa <no-reply@entradasya.local>');
const TIMEZONE = env('EVENT_TIMEZONE', 'America/La_Paz');

const transporter = nodemailer.createTransport({
  host: env('SMTP_HOST', 'localhost'),
  port: intEnv('SMTP_PORT', 1025),
  secure: boolEnv('SMTP_SECURE', false),
  ignoreTLS: boolEnv('SMTP_IGNORE_TLS', true),
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  connectionTimeout: intEnv('SMTP_TIMEOUT_MS', 5000),
  greetingTimeout: intEnv('SMTP_TIMEOUT_MS', 5000),
  socketTimeout: intEnv('SMTP_TIMEOUT_MS', 5000),
});

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const formatDate = (d) =>
  d ? new Date(d).toLocaleString('es-BO', { timeZone: TIMEZONE, dateStyle: 'full', timeStyle: 'short' }) : '';

async function send({ to, subject, html, text, kind }) {
  const info = await transporter.sendMail({ from: FROM, to, subject, html, text });
  log.info(`Correo enviado (${kind})`, { to, subject, messageId: info.messageId });
  return info;
}

const app = createApp();
healthRoute(app, {
  smtp: () =>
    Promise.race([
      transporter.verify(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]),
});

// POST /purchase -> correo de confirmación de compra con enlace a las entradas
app.post('/purchase', requireInternal, async (req, res) => {
  const b = req.body || {};
  if (!b.to || !b.order_id) throw new HttpError(400, 'to y order_id son obligatorios');
  const codes = Array.isArray(b.tickets) ? b.tickets : [];
  const subject = `Tu compra en EntradasYa: ${b.event_name} (orden #${b.order_id})`;
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
    <div style="background:#b91c1c;color:#fff;padding:16px 20px;font-size:22px;font-weight:bold">EntradasYa</div>
    <div style="padding:20px;border:1px solid #e5e7eb">
      <p>Hola ${escapeHtml(b.name || '')},</p>
      <p>¡Tu compra fue confirmada! Estos son los datos:</p>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:4px 0;color:#6b7280">Evento</td><td><b>${escapeHtml(b.event_name)}</b></td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Fecha</td><td>${escapeHtml(formatDate(b.event_date))}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Lugar</td><td>${escapeHtml(b.venue)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Sector</td><td>${escapeHtml(b.sector_name)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Entradas</td><td>${escapeHtml(b.quantity)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Total</td><td>Bs ${Number(b.total || 0).toFixed(2)}</td></tr>
      </table>
      <p>Códigos de tus entradas:</p>
      <ul>${codes.map((c) => `<li style="font-family:monospace;font-size:15px">${escapeHtml(c)}</li>`).join('')}</ul>
      <p style="text-align:center;margin:24px 0">
        <a href="${escapeHtml(b.tickets_url)}" style="background:#b91c1c;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px">
          Descargar mis entradas (PDF con QR)
        </a>
      </p>
      <p style="color:#6b7280;font-size:12px">Cada entrada es válida para un solo ingreso.</p>
    </div>
  </div>`;
  const text = `Hola ${b.name || ''}, tu compra #${b.order_id} para ${b.event_name} fue confirmada.\n` +
    `Entradas: ${codes.join(', ')}\nDescárgalas en: ${b.tickets_url}`;

  try {
    const info = await send({ to: b.to, subject, html, text, kind: 'compra' });
    res.status(202).json({ sent: true, messageId: info.messageId });
  } catch (err) {
    log.error('No se pudo enviar el correo de compra', { to: b.to, order_id: b.order_id, error: err.message });
    throw new HttpError(502, 'No se pudo enviar el correo (SMTP no disponible)');
  }
});

// POST /welcome -> correo de bienvenida (opcional)
app.post('/welcome', requireInternal, async (req, res) => {
  const { to, name } = req.body || {};
  if (!to) throw new HttpError(400, 'to es obligatorio');
  try {
    const info = await send({
      to,
      subject: 'Bienvenido a EntradasYa',
      html: `<p>Hola ${escapeHtml(name || '')}, ¡bienvenido a <b>EntradasYa</b>!</p>`,
      text: `Hola ${name || ''}, ¡bienvenido a EntradasYa!`,
      kind: 'bienvenida',
    });
    res.status(202).json({ sent: true, messageId: info.messageId });
  } catch (err) {
    log.error('No se pudo enviar el correo de bienvenida', { to, error: err.message });
    throw new HttpError(502, 'No se pudo enviar el correo (SMTP no disponible)');
  }
});

finish(app);
listen(app, intEnv('PORT', 3006));
