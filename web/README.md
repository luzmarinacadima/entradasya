# web

Interfaz única (React + Vite) para los tres tipos de usuario:

- **Cliente:** registro e inicio de sesión, cartelera, detalle del evento, compra, mis compras y mis entradas (descarga del PDF con QR).
- **Organizador:** crear y editar eventos con sectores (precio y cupo), publicar o cancelar, y ver ventas, ingresos y personas que ingresaron.
- **Portero:** elegir el evento, escanear el QR con la cámara (si el navegador soporta `BarcodeDetector`, p. ej. Chrome en Android) o escribir el código, y ver en grande si el ingreso se **permite** o se **rechaza** con el motivo.

- **Datos que guarda:** ninguno (solo la sesión en el navegador). Muestra la información de los demás servicios.
- **Se comunica con:** todos los servicios, siempre a través de `/api/<servicio>` (Nginx en el servidor, el proxy de Vite en local).

## Requisitos

- Node.js 22.9 o superior
- Los servicios backend corriendo (ver el README de la raíz)

## Variables de entorno

La web no tiene secretos. En desarrollo, el proxy de Vite usa estas variables opcionales para saber dónde están los servicios:

| Variable | Valor por defecto |
|---|---|
| `AUTH_URL` | `http://localhost:3001` |
| `EVENTS_URL` | `http://localhost:3002` |
| `ORDERS_URL` | `http://localhost:3003` |
| `TICKETS_URL` | `http://localhost:3005` |
| `CHECKIN_URL` | `http://localhost:3007` |

`payments` y `notifications` no se exponen: son internos.

## Cómo ejecutarlo

```bash
npm install            # desde la raíz del repositorio
npm run dev -w web     # http://localhost:5173
npm run build -w web   # genera web/dist (lo que sirve Nginx en el servidor)
```
