// Prueba de punta a punta de los criterios de aceptación (sección 11 del PDF).
//
//   npm run smoke                                  -> contra los servicios locales (puertos 3001..3007)
//   GATEWAY=http://IP_DEL_SERVIDOR npm run smoke   -> contra Nginx en el servidor (/api/...)
//   (en Windows CMD:  set GATEWAY=http://IP && npm run smoke)
//
// Para probar "la compra se completa aunque notifications esté apagado":
// detén notifications y vuelve a correr la prueba: la compra debe salir "pagada" con email_sent=false.

const stopOnError = (err) => {
  console.log(`\n\x1b[31mLa prueba se detuvo: ${err.message}\x1b[0m`);
  console.log('Revisa los errores de arriba (normalmente un servicio no tiene base de datos o no está corriendo).\n');
  process.exit(1);
};
process.on('uncaughtException', stopOnError);
process.on('unhandledRejection', stopOnError);

const GATEWAY = process.env.GATEWAY?.replace(/\/$/, '');
const PORTS = { auth: 3001, events: 3002, orders: 3003, payments: 3004, tickets: 3005, notifications: 3006, checkin: 3007 };
const base = (svc) => (GATEWAY ? `${GATEWAY}/api/${svc}` : `http://localhost:${PORTS[svc]}`);

let passed = 0;
let failed = 0;
const ok = (cond, msg, extra) => {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗ ${msg}\x1b[0m`, extra !== undefined ? JSON.stringify(extra) : '');
  }
};

async function call(svc, path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${base(svc)}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, data, type };
}

const run = Date.now().toString(36);
const user = (role) => ({ name: `Prueba ${role}`, email: `${role}.${run}@test.com`, password: 'secreto123', role });

console.log(`\nEntradasYa · prueba de punta a punta (${GATEWAY ? `gateway ${GATEWAY}` : 'servicios locales'})\n`);

console.log('1. Chequeos de salud');
const healthServices = GATEWAY ? ['auth', 'events', 'orders', 'tickets', 'checkin'] : Object.keys(PORTS);
for (const svc of healthServices) {
  try {
    const r = await call(svc, '/health');
    ok(r.status === 200, `${svc} /health -> ${r.status} ${JSON.stringify(r.data.checks || {})}`);
  } catch (e) {
    ok(false, `${svc} no responde (${e.message})`);
  }
}

console.log('\n2. Registro de usuarios (auth)');
const org = await call('auth', '/register', { method: 'POST', body: user('organizador') });
const cli = await call('auth', '/register', { method: 'POST', body: user('cliente') });
const por = await call('auth', '/register', { method: 'POST', body: user('portero') });
ok(org.status === 201 && cli.status === 201 && por.status === 201, 'organizador, cliente y portero registrados');
const login = await call('auth', '/login', { method: 'POST', body: { email: user('cliente').email, password: 'secreto123' } });
ok(login.status === 200 && login.data.token, 'inicio de sesión devuelve un JWT');
const bad = await call('auth', '/login', { method: 'POST', body: { email: user('cliente').email, password: 'mal' } });
ok(bad.status === 401, 'contraseña incorrecta -> 401');
const T = { org: org.data.token, cli: cli.data.token, por: por.data.token };

console.log('\n3. Eventos (events)');
const date = new Date(Date.now() + 7 * 864e5).toISOString();
const ev1 = await call('events', '/', {
  method: 'POST',
  token: T.org,
  body: { name: `Concierto de prueba ${run}`, event_date: date, venue: 'Coliseo', sectors: [{ name: 'General', price: 50, capacity: 3 }] },
});
const ev2 = await call('events', '/', {
  method: 'POST',
  token: T.org,
  body: { name: `Otro evento ${run}`, event_date: date, venue: 'Teatro', sectors: [{ name: 'Única', price: 10, capacity: 5 }] },
});
ok(ev1.status === 201 && ev1.data.event.status === 'borrador', 'evento creado en borrador');
const notListed = await call('events', '/');
ok(!notListed.data.events.some((e) => e.id === ev1.data.event.id), 'un borrador NO aparece en la cartelera');
const pub1 = await call('events', `/${ev1.data.event.id}/status`, { method: 'PATCH', token: T.org, body: { status: 'publicado' } });
await call('events', `/${ev2.data.event.id}/status`, { method: 'PATCH', token: T.org, body: { status: 'publicado' } });
ok(pub1.status === 200, 'evento publicado');
const forbidden = await call('events', '/', { method: 'POST', token: T.cli, body: {} });
ok(forbidden.status === 403, 'un cliente no puede crear eventos -> 403');
const E1 = ev1.data.event.id;
const S1 = ev1.data.event.sectors[0].id;
const E2 = ev2.data.event.id;

console.log('\n4. Compra (orders -> events -> payments -> tickets -> notifications)');
const buy = await call('orders', '/', { method: 'POST', token: T.cli, body: { event_id: E1, sector_id: S1, quantity: 2, card_number: '4111111111111111' } });
ok(buy.status === 201 && buy.data.order.status === 'pagada', 'compra de 2 entradas -> pagada', buy.data);
ok(buy.data.tickets?.length === 2, 'se generaron 2 entradas con código único');
ok(buy.data.order?.email_sent === true, `correo de confirmación enviado (email_sent=${buy.data.order?.email_sent}; false si notifications/Mailpit están apagados)`);
const tooMany = await call('orders', '/', { method: 'POST', token: T.cli, body: { event_id: E1, sector_id: S1, quantity: 7, card_number: '4111111111111111' } });
ok(tooMany.status === 400, 'más de 6 entradas por compra -> 400');

console.log('\n5. Casos de error');
const rejected = await call('orders', '/', { method: 'POST', token: T.cli, body: { event_id: E1, sector_id: S1, quantity: 1, card_number: '4111111111110000' } });
ok(rejected.status === 402 && rejected.data.order.status === 'rechazada', 'tarjeta terminada en 0000 -> pago rechazado');
const afterReject = await call('events', `/${E1}`);
ok(afterReject.data.event.sectors[0].available === 1, `el pago rechazado liberó los cupos (disponibles: ${afterReject.data.event.sectors[0].available}, esperado 1)`);
const soldOut = await call('orders', '/', { method: 'POST', token: T.cli, body: { event_id: E1, sector_id: S1, quantity: 2, card_number: '4111111111111111' } });
ok(soldOut.status === 409 && soldOut.data.error === 'Agotado', 'pedir más del cupo disponible -> "Agotado"');
const history = await call('orders', '/mine', { token: T.cli });
ok(history.data.orders?.length === 3, 'historial de compras del cliente (3 órdenes)');

console.log('\n6. Entradas (tickets)');
const mine = await call('tickets', '/mine', { token: T.cli });
ok(mine.data.tickets?.length === 2, 'el cliente ve sus 2 entradas');
const code = mine.data.tickets?.[0]?.code;
const pdf = await call('tickets', `/${code}/pdf`, { token: T.cli });
ok(pdf.status === 200 && pdf.type.includes('pdf'), `descarga del PDF con QR (${pdf.type})`);
const pdfOther = await call('tickets', `/${code}/pdf`, { token: T.org });
ok(pdfOther.status === 404, 'otro usuario no puede descargar la entrada');

console.log('\n7. Ingreso al evento (checkin -> tickets)');
const in1 = await call('checkin', '/', { method: 'POST', token: T.por, body: { code, event_id: E1 } });
ok(in1.status === 201 && in1.data.allowed === true, 'primer escaneo -> INGRESO PERMITIDO');
const in2 = await call('checkin', '/', { method: 'POST', token: T.por, body: { code, event_id: E1 } });
ok(in2.status === 409 && in2.data.reason === 'Entrada ya utilizada' && in2.data.first_checkin_at, 'segundo escaneo -> rechazado "Entrada ya utilizada" con la hora del primer ingreso');
const other = await call('checkin', '/', { method: 'POST', token: T.por, body: { code: mine.data.tickets[1].code, event_id: E2 } });
ok(other.status === 422 && other.data.reason === 'Entrada de otro evento', 'entrada de otro evento -> rechazada');
const invalid = await call('checkin', '/', { method: 'POST', token: T.por, body: { code: 'EY-NOEX-ISTE', event_id: E1 } });
ok(invalid.status === 404 && invalid.data.reason === 'Código inválido', 'código inexistente -> "Código inválido"');
const stats = await call('checkin', `/stats/${E1}`, { token: T.por });
ok(stats.data.total === 1, `personas que ingresaron al evento: ${stats.data.total}`);

console.log('\n8. Ventas del organizador');
const sales = await call('events', `/${E1}/sales`, { token: T.org });
ok(sales.data.totals?.sold === 2 && sales.data.totals?.revenue === 100, `vendidas ${sales.data.totals?.sold}, ingresos Bs ${sales.data.totals?.revenue}`);

console.log(`\nResultado: ${passed} correctas, ${failed} con error\n`);
process.exit(failed ? 1 : 0);
