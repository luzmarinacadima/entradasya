import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, money } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function OrgSales() {
  const { id } = useParams();
  const { token } = useAuth();
  const [sales, setSales] = useState(null);
  const [checkins, setCheckins] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/events/${id}/sales`, { token }).then(setSales).catch((e) => setError(e.message));
    api(`/checkin/stats/${id}`, { token }).then(setCheckins).catch(() => setCheckins({ total: '—' }));
  }, [id, token]);

  if (error) return <p className="alert error">{error}</p>;
  if (!sales) return <p className="muted">Cargando…</p>;

  return (
    <>
      <Link to="/organizador">← Mis eventos</Link>
      <h1>Ventas: {sales.name}</h1>
      <div className="stats">
        <div><span>Entradas vendidas</span><b>{sales.totals.sold} / {sales.totals.capacity}</b></div>
        <div><span>Ingresos</span><b>{money(sales.totals.revenue)}</b></div>
        <div><span>Personas que ingresaron</span><b>{checkins?.total ?? '…'}</b></div>
      </div>
      <table className="table">
        <thead><tr><th>Sector</th><th>Precio</th><th>Vendidas</th><th>Disponibles</th><th>Ingresos</th></tr></thead>
        <tbody>
          {sales.sectors.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{money(s.price)}</td>
              <td>{s.sold} / {s.capacity}</td>
              <td>{s.available}</td>
              <td>{money(s.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
