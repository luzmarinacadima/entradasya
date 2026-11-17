import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money, fmtDate } from '../api.js';

export default function Cartelera() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/events/').then((d) => setEvents(d.events)).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="alert error">{error}</p>;
  if (!events) return <p className="muted">Cargando cartelera…</p>;

  return (
    <>
      <h1>Cartelera</h1>
      {events.length === 0 && <p className="muted">Todavía no hay eventos publicados.</p>}
      <div className="grid">
        {events.map((ev) => {
          const minPrice = Math.min(...ev.sectors.map((s) => s.price));
          const available = ev.sectors.reduce((a, s) => a + s.available, 0);
          return (
            <Link key={ev.id} to={`/eventos/${ev.id}`} className="event-card">
              <div className="cover" style={ev.image_url ? { backgroundImage: `url(${ev.image_url})` } : undefined}>
                {!ev.image_url && <span>🎤</span>}
              </div>
              <div className="body">
                <h3>{ev.name}</h3>
                <p className="muted">{fmtDate(ev.event_date)} · {ev.venue}</p>
                <p>
                  Desde <b>{money(minPrice)}</b>{' '}
                  {available === 0 ? <span className="badge red">Agotado</span> : <span className="badge green">{available} disponibles</span>}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
