import { useEffect, useState } from 'react';
import { api, downloadFile, fmtDate } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function MisEntradas() {
  const { token } = useAuth();
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/tickets/mine', { token }).then((d) => setTickets(d.tickets)).catch((e) => setError(e.message));
  }, [token]);

  async function download(t) {
    try {
      await downloadFile(`/tickets/${t.code}/pdf`, token, `entrada-${t.code}.pdf`);
    } catch (e) {
      setError(e.message);
    }
  }

  if (error) return <p className="alert error">{error}</p>;
  if (!tickets) return <p className="muted">Cargando…</p>;

  return (
    <>
      <h1>Mis entradas</h1>
      {tickets.length === 0 && <p className="muted">Todavía no tienes entradas.</p>}
      <div className="grid">
        {tickets.map((t) => (
          <div key={t.code} className="ticket">
            <h3>{t.event_name}</h3>
            <p className="muted small">{fmtDate(t.event_date)} · {t.venue}</p>
            <p>{t.sector_name} · asiento {t.seat_number} · orden #{t.order_id}</p>
            <p className="code">{t.code}</p>
            <button className="btn small" onClick={() => download(t)}>Descargar PDF con QR</button>
          </div>
        ))}
      </div>
    </>
  );
}
