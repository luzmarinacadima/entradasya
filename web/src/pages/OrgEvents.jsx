import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import { useAuth } from '../auth.jsx';

const BADGE = { publicado: 'green', borrador: 'yellow', cancelado: 'gray' };

export default function OrgEvents() {
  const { token } = useAuth();
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');

  const load = () => api('/events/mine', { token }).then((d) => setEvents(d.events)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeStatus(ev, status) {
    if (status === 'cancelado' && !window.confirm(`¿Cancelar "${ev.name}"? No se puede deshacer.`)) return;
    try {
      await api(`/events/${ev.id}/status`, { method: 'PATCH', token, body: { status } });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (!events && !error) return <p className="muted">Cargando…</p>;

  return (
    <>
      <div className="row between">
        <h1>Mis eventos</h1>
        <Link to="/organizador/nuevo" className="btn">+ Crear evento</Link>
      </div>
      {error && <p className="alert error">{error}</p>}
      {events?.length === 0 && <p className="muted">Aún no creaste eventos.</p>}
      {events?.length > 0 && (
        <table className="table">
          <thead><tr><th>Evento</th><th>Fecha</th><th>Estado</th><th>Vendidas</th><th>Acciones</th></tr></thead>
          <tbody>
            {events.map((ev) => {
              const sold = ev.sectors.reduce((a, s) => a + s.sold, 0);
              const cap = ev.sectors.reduce((a, s) => a + s.capacity, 0);
              return (
                <tr key={ev.id}>
                  <td><b>{ev.name}</b><div className="muted small">{ev.venue}</div></td>
                  <td className="small">{fmtDate(ev.event_date)}</td>
                  <td><span className={`badge ${BADGE[ev.status]}`}>{ev.status}</span></td>
                  <td>{sold} / {cap}</td>
                  <td className="actions">
                    <Link to={`/organizador/eventos/${ev.id}/ventas`}>Ventas</Link>
                    {ev.status !== 'cancelado' && <Link to={`/organizador/eventos/${ev.id}/editar`}>Editar</Link>}
                    {ev.status === 'borrador' && <button className="btn small" onClick={() => changeStatus(ev, 'publicado')}>Publicar</button>}
                    {ev.status !== 'cancelado' && <button className="link danger" onClick={() => changeStatus(ev, 'cancelado')}>Cancelar</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
