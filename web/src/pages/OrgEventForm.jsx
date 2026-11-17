import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, toLocalInput } from '../api.js';
import { useAuth } from '../auth.jsx';

const DEFAULT_SECTORS = [
  { name: 'General', price: 50, capacity: 100 },
  { name: 'Preferencia', price: 100, capacity: 50 },
  { name: 'VIP', price: 200, capacity: 20 },
];

export default function OrgEventForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { token } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', event_date: '', venue: '', image_url: '', description: '' });
  const [sectors, setSectors] = useState(DEFAULT_SECTORS);
  const [status, setStatus] = useState('borrador');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) return;
    api(`/events/${id}`, { token })
      .then(({ event }) => {
        setForm({
          name: event.name,
          event_date: toLocalInput(event.event_date),
          venue: event.venue,
          image_url: event.image_url || '',
          description: event.description || '',
        });
        setSectors(event.sectors.map(({ name, price, capacity }) => ({ name, price, capacity })));
        setStatus(event.status);
      })
      .catch((e) => setError(e.message));
  }, [editing, id, token]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setSector = (i, k) => (e) => setSectors(sectors.map((s, j) => (j === i ? { ...s, [k]: e.target.value } : s)));
  const sectorsLocked = editing && status !== 'borrador';

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = {
      ...form,
      event_date: new Date(form.event_date).toISOString(),
      ...(sectorsLocked ? {} : { sectors: sectors.map((s) => ({ name: s.name, price: Number(s.price), capacity: Number(s.capacity) })) }),
    };
    try {
      if (editing) await api(`/events/${id}`, { method: 'PUT', token, body });
      else await api('/events/', { method: 'POST', token, body });
      navigate('/organizador');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h1>{editing ? 'Editar evento' : 'Crear evento'}</h1>
      <label>Nombre<input value={form.name} onChange={set('name')} required minLength={3} /></label>
      <div className="row">
        <label>Fecha y hora<input type="datetime-local" value={form.event_date} onChange={set('event_date')} required /></label>
        <label>Lugar<input value={form.venue} onChange={set('venue')} required /></label>
      </div>
      <label>Imagen (URL, opcional)<input value={form.image_url} onChange={set('image_url')} placeholder="https://…" /></label>
      <label>Descripción<textarea rows={3} value={form.description} onChange={set('description')} /></label>

      <h2>Sectores</h2>
      {sectorsLocked && <p className="muted small">El evento ya está publicado: los sectores no se pueden modificar.</p>}
      {sectors.map((s, i) => (
        <div className="row sector" key={i}>
          <label>Nombre<input value={s.name} onChange={setSector(i, 'name')} required disabled={sectorsLocked} /></label>
          <label>Precio (Bs)<input type="number" min={0} step="0.01" value={s.price} onChange={setSector(i, 'price')} required disabled={sectorsLocked} /></label>
          <label>Cupo<input type="number" min={1} value={s.capacity} onChange={setSector(i, 'capacity')} required disabled={sectorsLocked} /></label>
          {!sectorsLocked && sectors.length > 1 && (
            <button type="button" className="link danger" onClick={() => setSectors(sectors.filter((_, j) => j !== i))}>Quitar</button>
          )}
        </div>
      ))}
      {!sectorsLocked && (
        <button type="button" className="btn secondary small" onClick={() => setSectors([...sectors, { name: '', price: 0, capacity: 10 }])}>
          + Agregar sector
        </button>
      )}

      {error && <p className="alert error">{error}</p>}
      <div className="row">
        <button className="btn" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        {!editing && <span className="muted small">Se guarda como borrador; luego lo publicas desde "Mis eventos".</span>}
      </div>
    </form>
  );
}
