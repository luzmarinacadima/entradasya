// Lectura de configuración desde variables de entorno (requisito técnico 1).
// Nada de puertos, contraseñas ni URLs va escrito en el código.

export function env(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (fallback === undefined) {
      throw new Error(`Falta la variable de entorno obligatoria ${name}`);
    }
    return fallback;
  }
  return value;
}

export function intEnv(name, fallback) {
  const raw = env(name, fallback === undefined ? undefined : String(fallback));
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`La variable ${name} debe ser un número (valor: ${raw})`);
  return n;
}

export function boolEnv(name, fallback) {
  const raw = env(name, fallback === undefined ? undefined : String(fallback));
  return ['1', 'true', 'si', 'sí', 'yes'].includes(raw.toLowerCase());
}
