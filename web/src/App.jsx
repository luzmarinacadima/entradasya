import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Cartelera from './pages/Cartelera.jsx';
import EventDetail from './pages/EventDetail.jsx';
import MisCompras from './pages/MisCompras.jsx';
import MisEntradas from './pages/MisEntradas.jsx';
import OrgEvents from './pages/OrgEvents.jsx';
import OrgEventForm from './pages/OrgEventForm.jsx';
import OrgSales from './pages/OrgSales.jsx';
import Portero from './pages/Portero.jsx';

function Protected({ roles, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function Home() {
  const { user } = useAuth();
  if (user?.role === 'organizador') return <Navigate to="/organizador" replace />;
  if (user?.role === 'portero') return <Navigate to="/portero" replace />;
  return <Cartelera />;
}

export default function App() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <header className="topbar">
        <NavLink to="/" className="brand">🎟️ EntradasYa</NavLink>
        <nav>
          {(!user || user.role === 'cliente') && <NavLink to="/" end>Cartelera</NavLink>}
          {user?.role === 'cliente' && (
            <>
              <NavLink to="/mis-compras">Mis compras</NavLink>
              <NavLink to="/mis-entradas">Mis entradas</NavLink>
            </>
          )}
          {user?.role === 'organizador' && (
            <>
              <NavLink to="/organizador" end>Mis eventos</NavLink>
              <NavLink to="/organizador/nuevo">Crear evento</NavLink>
            </>
          )}
          {user?.role === 'portero' && <NavLink to="/portero">Control de ingreso</NavLink>}
        </nav>
        <div className="session">
          {user ? (
            <>
              <span className="who">{user.name} <small>({user.role})</small></span>
              <button className="link" onClick={() => { logout(); navigate('/'); }}>Salir</button>
            </>
          ) : (
            <>
              <NavLink to="/login">Ingresar</NavLink>
              <NavLink to="/registro" className="btn small">Crear cuenta</NavLink>
            </>
          )}
        </div>
      </header>

      <main className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/registro" element={<Register />} />
          <Route path="/eventos/:id" element={<EventDetail />} />
          <Route path="/mis-compras" element={<Protected roles={['cliente']}><MisCompras /></Protected>} />
          <Route path="/mis-entradas" element={<Protected roles={['cliente']}><MisEntradas /></Protected>} />
          <Route path="/organizador" element={<Protected roles={['organizador']}><OrgEvents /></Protected>} />
          <Route path="/organizador/nuevo" element={<Protected roles={['organizador']}><OrgEventForm /></Protected>} />
          <Route path="/organizador/eventos/:id/editar" element={<Protected roles={['organizador']}><OrgEventForm /></Protected>} />
          <Route path="/organizador/eventos/:id/ventas" element={<Protected roles={['organizador']}><OrgSales /></Protected>} />
          <Route path="/portero" element={<Protected roles={['portero', 'organizador']}><Portero /></Protected>} />
          <Route path="*" element={<p>Página no encontrada.</p>} />
        </Routes>
      </main>
      <footer className="footer">EntradasYa v1 · Contenedores y Orquestación</footer>
    </>
  );
}
