import { useEffect, useState } from 'react';
import { api, money, fmtDate } from '../api.js';
import { useAuth } from '../auth.jsx';

const STATUS_BADGE = { pagada: 'green', pendiente: 'yellow', rechazada: 'red', cancelada: 'gray' };

export default function MisCompras() {
  const { token } = useAuth();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => api('/orders/mine', { token }).then((d) => setOrders(d.orders)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function retry(id) {
    setMsg('');
    try {
      await api(`/orders/${id}/retry`, { method: 'POST', token });
      setMsg(`Orden #${id}: reintento realizado.`);
    } catch (e) {
      setMsg(e.message);
    }
    load();
  }

  if (error) return <p className="alert error">{error}</p>;
  if (!orders) return <p className="muted">Cargando…</p>;

  return (
    <>
      <h1>Mis compras</h1>
      {msg && <p className="alert">{msg}</p>}
      {orders.length === 0 && <p className="muted">Aún no hiciste compras.</p>}
      {orders.length > 0 && (
        <table className="table">
          <thead>
            <tr><th>#</th><th>Evento</th><th>Sector</th><th>Cant.</th><th>Total</th><th>Estado</th><th>Fecha</th><th></th></tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>{o.id}</td>
                <td>{o.event_name}</td>
                <td>{o.sector_name}</td>
                <td>{o.quantity}</td>
                <td>{money(o.total)}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[o.status]}`}>{o.status}</span>
                  {o.status_reason && <div className="muted small">{o.status_reason}</div>}
                </td>
                <td className="small">{fmtDate(o.created_at)}</td>
                <td>
                  {o.status === 'pagada' && (!o.tickets_issued || !o.email_sent) && (
                    <button className="btn small" onClick={() => retry(o.id)}>
                      {!o.tickets_issued ? 'Emitir entradas' : 'Reenviar correo'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
