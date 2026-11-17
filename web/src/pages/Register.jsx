import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'cliente' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await register(form);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card narrow" onSubmit={submit}>
      <h1>Crear cuenta</h1>
      <label>Nombre<input value={form.name} onChange={set('name')} required minLength={2} autoFocus /></label>
      <label>Correo<input type="email" value={form.email} onChange={set('email')} required /></label>
      <label>Contraseña<input type="password" value={form.password} onChange={set('password')} required minLength={6} /></label>
      <label>
        Tipo de cuenta
        <select value={form.role} onChange={set('role')}>
          <option value="cliente">Cliente (comprar entradas)</option>
          <option value="organizador">Organizador (publicar eventos)</option>
          <option value="portero">Portero (controlar ingresos)</option>
        </select>
      </label>
      {error && <p className="alert error">{error}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Creando…' : 'Crear cuenta'}</button>
    </form>
  );
}
