import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card narrow" onSubmit={submit}>
      <h1>Ingresar</h1>
      <label>Correo<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
      <label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {error && <p className="alert error">{error}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
      <p className="muted">¿No tienes cuenta? <Link to="/registro">Regístrate</Link></p>
    </form>
  );
}
