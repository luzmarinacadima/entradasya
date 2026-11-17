// Conexión a la base de datos PROPIA del servicio (requisito técnico 2).
// Cada servicio usa su propia base y su propio usuario; nunca lee la de otro.

import pg from 'pg';
import { env, intEnv } from './config.js';
import { log } from './logger.js';

export const pool = new pg.Pool({
  host: env('DB_HOST', 'localhost'),
  port: intEnv('DB_PORT', 5432),
  database: env('DB_NAME'),
  user: env('DB_USER'),
  password: env('DB_PASSWORD'),
  max: intEnv('DB_POOL_MAX', 10),
  connectionTimeoutMillis: intEnv('DB_CONNECT_TIMEOUT_MS', 3000),
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => log.error('Error inesperado en la conexión a PostgreSQL', { error: err.message }));

export const query = (text, params) => pool.query(text, params);

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

let schemaReady = false;
export const isSchemaReady = () => schemaReady;

// Crea las tablas si no existen. Si la base no responde, reintenta cada 5 s
// en lugar de tumbar el servicio: mientras tanto /health responde 503.
export async function initSchemaWithRetry(sql) {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query(sql);
      schemaReady = true;
      log.info('Base de datos lista (esquema verificado)', { database: process.env.DB_NAME });
      return;
    } catch (err) {
      log.error('No se pudo preparar la base de datos, reintentando en 5 s', { attempt, error: err.message });
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

export async function dbHealthy() {
  if (!schemaReady) return false;
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
