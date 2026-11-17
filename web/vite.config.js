import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo, Vite hace el papel de Nginx: /api/<servicio>/... -> http://localhost:<puerto>/...
// payments y notifications NO se exponen (son internos).
const SERVICES = {
  auth: process.env.AUTH_URL || 'http://localhost:3001',
  events: process.env.EVENTS_URL || 'http://localhost:3002',
  orders: process.env.ORDERS_URL || 'http://localhost:3003',
  tickets: process.env.TICKETS_URL || 'http://localhost:3005',
  checkin: process.env.CHECKIN_URL || 'http://localhost:3007',
};

const proxy = Object.fromEntries(
  Object.entries(SERVICES).map(([name, target]) => [
    `/api/${name}`,
    {
      target,
      changeOrigin: true,
      rewrite: (p) => {
        const rest = p.slice(`/api/${name}`.length);
        return rest.startsWith('/') ? rest : `/${rest}`;
      },
    },
  ]),
);

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
});
