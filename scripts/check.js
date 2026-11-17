// Revisión rápida para el pipeline: sintaxis de todos los .js de los servicios
// y que cada servicio tenga README, .env.example y /health.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let errors = 0;

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (f === 'node_modules') return [];
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

for (const name of readdirSync(path.join(root, 'services'))) {
  const before = errors;
  const dir = path.join(root, 'services', name);
  for (const f of ['README.md', '.env.example', 'package.json', 'src/index.js']) {
    if (!existsSync(path.join(dir, f))) {
      console.error(`✗ ${name}: falta ${f}`);
      errors++;
    }
  }
  const index = readFileSync(path.join(dir, 'src/index.js'), 'utf8');
  if (!index.includes('healthRoute(')) {
    console.error(`✗ ${name}: no define /health`);
    errors++;
  }
  for (const file of walk(path.join(dir, 'src'))) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (e) {
      console.error(`✗ Error de sintaxis en ${path.relative(root, file)}\n${e.stderr}`);
      errors++;
    }
  }
  if (errors === before) console.log(`✓ ${name}`);
}

if (errors) {
  console.error(`\n${errors} problema(s) encontrado(s)`);
  process.exit(1);
}
console.log('\nTodo en orden');
