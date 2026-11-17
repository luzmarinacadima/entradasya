// Llamadas a otros servicios: solo HTTP + JSON (requisito técnico 3)
// y SIEMPRE con tiempo máximo de espera (requisito técnico 4).

import { intEnv } from './config.js';
import { log } from './logger.js';

export class ServiceUnavailableError extends Error {
  constructor(service, reason) {
    super(`El servicio ${service} no está disponible (${reason})`);
    this.service = service;
    this.status = 503;
  }
}

/**
 * Llama a otro servicio y devuelve { status, ok, data }.
 * Si el servicio no responde o tarda más que el límite, lanza ServiceUnavailableError.
 */
export async function callService(service, url, { method = 'GET', body, headers = {}, timeoutMs } = {}) {
  const limit = timeoutMs ?? intEnv('HTTP_TIMEOUT_MS', 5000);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        'X-Internal-Token': process.env.INTERNAL_TOKEN || '',
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(limit),
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    log.debug(`Llamada a ${service}`, { method, url, status: res.status, ms: Date.now() - started });
    return { status: res.status, ok: res.ok, data };
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `sin respuesta en ${limit} ms` : err.message;
    log.warn(`Fallo al llamar a ${service}`, { method, url, reason });
    throw new ServiceUnavailableError(service, reason);
  }
}
