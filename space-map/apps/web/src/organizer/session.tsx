// Сервер определяет сессию; отсутствие сети не означает, что пользователь вышел.
import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ApiError, auth, SESSION_EXPIRED, type User } from '../api.ts';

interface SessionState {
  user: User | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setUser: (u: User | null) => void;
  logout: () => Promise<boolean>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, updateUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const setUser = useCallback((u: User | null) => {
    generation.current += 1;
    updateUser(u);
    setError(null);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await auth.me();
      if (request !== generation.current) return;
      updateUser(next);
      setError(null);
    } catch (err) {
      if (request !== generation.current) return;
      if (err instanceof ApiError && err.status === 401) {
        updateUser(null);
        setError(null);
      } else {
        setError('Не удалось проверить вход. Проверьте соединение и попробуйте ещё раз.');
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const expired = () => setUser(null);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    window.addEventListener('online', visible);
    window.addEventListener(SESSION_EXPIRED, expired);
    return () => {
      generation.current += 1;
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
      window.removeEventListener('online', visible);
      window.removeEventListener(SESSION_EXPIRED, expired);
    };
  }, [refresh, setUser]);

  const logout = useCallback(async () => {
    // Проверка /me, начатая до выхода, не должна вернуть старого пользователя.
    generation.current += 1;
    try {
      await auth.logout();
      setUser(null);
      return true;
    } catch {
      setError('Не удалось выйти. Проверьте соединение и нажмите «Выйти» ещё раз.');
      return false;
    }
  }, [setUser]);

  return (
    <SessionContext.Provider value={{ user, loading, error, refresh, setUser, logout }}>
      {user && error && <p className="notice" role="alert">{error}</p>}
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession вне SessionProvider');
  return s;
}

export function SessionCheck() {
  const { loading, error, refresh } = useSession();
  return (
    <div className="screen-message">
      {loading ? <div className="loader" aria-label="Проверяем вход" /> : (
        <div className="access-card">
          <p role="alert">{error}</p>
          <button type="button" className="btn btn-primary" onClick={() => void refresh()}>Повторить</button>
        </div>
      )}
    </div>
  );
}

export function RequireUser({ children }: { children: ReactNode }) {
  const { user, loading, error } = useSession();
  const location = useLocation();
  if (loading || (!user && error)) return <SessionCheck />;
  if (!user) return <Navigate to={`/app/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`} replace />;
  return <Fragment key={user.id}>{children}</Fragment>;
}
