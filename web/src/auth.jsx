import { createContext, useContext, useState, useCallback } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);
const KEY = 'entradasya_session';

function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    const payload = JSON.parse(atob(session.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp * 1000 < Date.now()) return null; // token vencido
    return session;
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  } catch {
    /* almacenamiento no disponible: la sesión vive solo en memoria */
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(loadSession);

  const apply = (data) => {
    const s = { token: data.token, user: data.user };
    saveSession(s);
    setSession(s);
    return s.user;
  };

  const login = useCallback(async (email, password) => apply(await api('/auth/login', { method: 'POST', body: { email, password } })), []);
  const register = useCallback(async (form) => apply(await api('/auth/register', { method: 'POST', body: form })), []);
  const logout = useCallback(() => {
    saveSession(null);
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user: session?.user, token: session?.token, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
