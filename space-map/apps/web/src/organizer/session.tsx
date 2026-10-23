// Сессия организатора: кто вошёл. Кабинет без входа отправляет на страницу входа.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ApiError, auth, type User } from '../api.ts';

interface SessionState {
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    auth
      .me()
      .then(setUser)
      .catch((err: unknown) => {
        if (!(err instanceof ApiError && err.status === 401)) console.warn(err);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const logout = useCallback(async () => {
    await auth.logout().catch(() => {});
    setUser(null);
  }, []);

  return <SessionContext.Provider value={{ user, loading, setUser, logout }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession вне SessionProvider');
  return s;
}

export function RequireUser({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const location = useLocation();
  if (loading) {
    return (
      <div className="screen-message">
        <div className="loader" aria-label="Проверяем вход" />
      </div>
    );
  }
  if (!user) return <Navigate to={`/app/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children}</>;
}
