// auth: usuarios, roles e inicio de sesión con JWT (sección 4.2 del PDF).
// No llama a ningún servicio: los demás confían en el token que emite.

import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { createApp, healthRoute, finish, listen, HttpError } from './lib/server.js';
import { query, initSchemaWithRetry, dbHealthy } from './lib/db.js';
import { signToken, requireAuth } from './lib/auth.js';
import { env, intEnv, boolEnv } from './lib/config.js';

process.env.SERVICE_NAME ||= 'auth';

const scrypt = promisify(crypto.scrypt);
const ROLES = ['cliente', 'organizador', 'portero'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('cliente','organizador','portero')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

// Contraseñas cifradas con scrypt + sal aleatoria: nunca en texto plano.
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function checkPassword(password, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(keyHex, 'hex');
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, created_at: u.created_at });

const issueToken = (u) =>
  signToken(
    { sub: String(u.id), id: u.id, name: u.name, email: u.email, role: u.role },
    env('JWT_SECRET'),
    intEnv('JWT_EXPIRES_IN_S', 28800),
  );

const app = createApp();
healthRoute(app, { database: dbHealthy });

// POST /register  { name, email, password, role? }
app.post('/register', async (req, res) => {
  const { name, email, password, role = 'cliente' } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!name || String(name).trim().length < 2) throw new HttpError(400, 'El nombre es obligatorio');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new HttpError(400, 'El correo no es válido');
  if (!password || String(password).length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres');
  if (!ROLES.includes(role)) throw new HttpError(400, `Rol inválido. Roles: ${ROLES.join(', ')}`);
  if (role !== 'cliente' && !boolEnv('ALLOW_ROLE_SIGNUP', true)) {
    throw new HttpError(403, 'Solo se permite registrarse como cliente');
  }

  try {
    const { rows } = await query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *',
      [String(name).trim(), cleanEmail, await hashPassword(String(password)), role],
    );
    const user = rows[0];
    res.status(201).json({ user: publicUser(user), token: issueToken(user) });
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'Ese correo ya está registrado');
    throw err;
  }
});

// POST /login  { email, password }  ->  { token, user }
app.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [String(email || '').trim().toLowerCase()]);
  const user = rows[0];
  if (!user || !(await checkPassword(String(password || ''), user.password_hash))) {
    throw new HttpError(401, 'Correo o contraseña incorrectos');
  }
  res.json({ user: publicUser(user), token: issueToken(user) });
});

// GET /me  (con token)
app.get('/me', requireAuth(), async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) throw new HttpError(404, 'Usuario no encontrado');
  res.json({ user: publicUser(rows[0]) });
});

finish(app);
listen(app, intEnv('PORT', 3001));
initSchemaWithRetry(SCHEMA);
