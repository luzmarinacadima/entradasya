// Validación del token JWT emitido por auth.
// Cada servicio valida el token POR SU CUENTA con el secreto compartido,
// sin llamar a auth en cada petición (sección 4.2 del PDF).
// Implementación estándar HS256 (compatible con jwt.io) sin dependencias.

import crypto from 'node:crypto';
import { env } from './config.js';

const b64url = (value) => Buffer.from(value).toString('base64url');

export function signToken(payload, secret, expiresInSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds }));
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('token mal formado');
  const [header, body, signature] = parts;
  let parsedHeader;
  try {
    parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString());
  } catch {
    throw new Error('token mal formado');
  }
  if (parsedHeader.alg !== 'HS256') throw new Error('algoritmo no permitido');
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new Error('firma inválida');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    throw new Error('token mal formado');
  }
  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('token expirado');
  }
  return payload;
}

function readBearer(req) {
  const match = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

// Exige token válido y, opcionalmente, uno de los roles indicados.
export function requireAuth(...roles) {
  return (req, res, next) => {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: 'Debes iniciar sesión (falta el token)' });
    try {
      req.user = verifyToken(token, env('JWT_SECRET'));
    } catch (err) {
      return res.status(401).json({ error: `Token inválido: ${err.message}` });
    }
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Esta acción es solo para: ${roles.join(', ')}` });
    }
    next();
  };
}

// Si viene token válido lo usa; si no, sigue como anónimo.
export function optionalAuth(req, _res, next) {
  const token = readBearer(req);
  if (token) {
    try {
      req.user = verifyToken(token, env('JWT_SECRET'));
    } catch {
      req.user = undefined;
    }
  }
  next();
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

// Rutas internas (servicio a servicio): exigen el token interno compartido.
// Además, Nginx no expone estas rutas hacia afuera.
export function requireInternal(req, res, next) {
  if (!safeEqual(req.headers['x-internal-token'], env('INTERNAL_TOKEN'))) {
    return res.status(403).json({ error: 'Ruta interna: solo otros servicios pueden llamarla' });
  }
  next();
}
