import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, money, fmtDate } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function EventDetail() {
  const { id } = useParams();
  const { user, token } = useAuth();
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');
  const [sectorId, setSectorId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [card, setCard] = useState('4111 1111 1111 1111');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const load = () =>
    api(`/events/${id}`, { token })
      .then((d) => {
        setEvent(d.event);
        setSectorId((prev) => prev || String(d.event.sectors.find((s) => s.available > 0)?.id || d.event.sectors[0]?.id || ''));
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function buy(e) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const d = await api('/orders/', {
        method: 'POST',
        token,
        body: { event_id: event.id, sector_id: Number(sectorId), quantity: Number(quantity), card_number: card },
      });
      setResult({ ok: true, order: d.order, tickets: d.tickets });
    } catch (err) {
      setResult({ ok: false, message: err.message, order: err.data?.order });
    } finally {
      setBusy(false);
      load();
    }
  }

  if (error) return <p className="alert error">{error}</p>;
  if (!event) return <p className="muted">Cargando…</p>;
  const sector = event.sectors.find((s) => String(s.id) === sectorId);

  return (
    <div className="detail">
      <div className="cover big" style={event.image_url ? { backgroundImage: `url(${event.image_url})` } : undefined}>
        {!event.image_url && <span>🎤</span>}
      </div>
      <h1>{event.name}</h1>
      <p className="muted">{fmtDate(event.event_date)} · {event.venue}</p>
      {event.description && <p>{event.description}</p>}

      <table className="table">
        <thead><tr><th>Sector</th><th>Precio</th><th>Disponibles</th></tr></thead>
        <tbody>
          {event.sectors.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{money(s.price)}</td>
              <td>{s.available === 0 ? <span className="badge red">Agotado</span> : s.available}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {!user && <p className="alert">Para comprar, <Link to="/login">inicia sesión</Link> como cliente.</p>}
      {user && user.role !== 'cliente' && <p className="alert">Solo las cuentas de cliente pueden comprar.</p>}
      {user?.role === 'cliente' && event.status === 'publicado' && (
        <form className="card" onSubmit={buy}>
          <h2>Comprar entradas</h2>
          <div className="row">
            <label>Sector
              <select value={sectorId} onChange={(e) => setSectorId(e.target.value)}>
                {event.sectors.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} — {money(s.price)}{s.available === 0 ? ' (agotado)' : ''}</option>
                ))}
              </select>
            </label>
            <label>Cantidad (máx. 6)
              <input type="number" min={1} max={6} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </label>
          </div>
          <label>Tarjeta (simulada)
            <input value={card} onChange={(e) => setCard(e.target.value)} inputMode="numeric" />
          </label>
          <p className="muted small">Pago de prueba: una tarjeta que termina en <b>0000</b> se rechaza.</p>
          <p>Total: <b>{money((sector?.price || 0) * Number(quantity || 0))}</b></p>
          <button className="btn" disabled={busy}>{busy ? 'Procesando…' : 'Confirmar compra'}</button>
        </form>
      )}

      {result?.ok && (
        <div className="alert success">
          <b>¡Compra confirmada!</b> Orden #{result.order.id}.{' '}
          {result.order.tickets_issued ? `Se emitieron ${result.tickets.length} entrada(s).` : 'Las entradas se están generando.'}{' '}
          {result.order.email_sent ? 'Te enviamos un correo de confirmación.' : 'No se pudo enviar el correo, pero tu compra es válida.'}{' '}
          <Link to="/mis-entradas">Ver mis entradas</Link>
        </div>
      )}
      {result && !result.ok && (
        <div className="alert error">
          <b>{result.message}</b>
          {result.order && <> — orden #{result.order.id} quedó <b>{result.order.status}</b>{result.order.status_reason ? ` (${result.order.status_reason})` : ''}.</>}
        </div>
      )}
    </div>
  );
}
