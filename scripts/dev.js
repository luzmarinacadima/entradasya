// Arranca los 7 servicios y la web en una sola terminal (desarrollo local).
//   npm run dev              -> servicios + web
//   npm run dev:services     -> solo servicios
// Si un servicio no tiene .env, lo crea copiando su .env.example.

import { spawn } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVICES = ['auth', 'events', 'orders', 'payments', 'tickets', 'notifications', 'checkin'];
const COLORS = [31, 32, 33, 34, 35, 36, 91, 92];
const withWeb = !process.argv.includes('--no-web');
const children = [];

function run(name, cmd, args, cwd, color) {
  const child = spawn(cmd, args, { cwd, env: process.env });
  const prefix = `\x1b[${color}m${name.padEnd(13)}\x1b[0m|`;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) out.write(`${prefix} ${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => console.log(`${prefix} terminó (código ${code})`));
  children.push(child);
}

SERVICES.forEach((name, i) => {
  const dir = path.join(root, 'services', name);
  const envFile = path.join(dir, '.env');
  if (!existsSync(envFile)) {
    copyFileSync(path.join(dir, '.env.example'), envFile);
    console.log(`[dev] Creado services/${name}/.env desde .env.example`);
  }
  run(name, process.execPath, ['--env-file=.env', '--watch', 'src/index.js'], dir, COLORS[i]);
});

if (withWeb) {
  try {
    const require = createRequire(path.join(root, 'web', 'package.json'));
    const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
    run('web', process.execPath, [viteBin], path.join(root, 'web'), COLORS[7]);
  } catch {
    console.log('[dev] No se encontró Vite. Ejecuta primero "npm install" en la raíz.');
  }
}

console.log('\n[dev] Web: http://localhost:5173   Mailpit: http://localhost:8025   (Ctrl+C para detener todo)\n');

const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
