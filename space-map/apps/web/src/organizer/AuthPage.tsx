// Вход и регистрация организатора (ТЗ 6.1, 8.1).
import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { ApiError, auth } from '../api.ts';
import { Icon } from '../ui/icons.tsx';
import { useSession } from './session.tsx';

export default function AuthPage() {
  const { user, setUser } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Только свои пути внутри кабинета — не уводим по ссылке на чужой сайт.
  const next = params.get('next')?.startsWith('/app') ? params.get('next')! : '/app';
  // Куда уйти после входа гостем: задаём до setUser — перенаправление «вошёл» ниже срабатывает сразу.
  const after = useRef<string | null>(null);
  if (user) return <Navigate to={after.current ?? next} replace />;

  // Одна кнопка — и сразу «Все площадки», без email и пароля.
  const tryAsGuest = async () => {
    setBusy(true);
    setError(null);
    try {
      const { user: guest, shared } = await auth.guest();
      // Пришёл с «Редактировать план» на карте (общий доступ) — в редактор этой карты, иначе — к списку площадок.
      after.current = shared && next.startsWith('/app/venues/') ? next : '/app';
      setUser(guest);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось открыть редактор. Попробуйте ещё раз.');
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = mode === 'login' ? await auth.login(email, password) : await auth.register(name, email, password);
      setUser(u);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <Icon name="building" size={20} />
          </span>
          <div className="brand-text">
            <h1 className="brand-title">Карта пространства</h1>
            <p className="brand-sub">Кабинет организатора</p>
          </div>
        </div>

        <div className="auth-quick">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void tryAsGuest()}>
            <Icon name="edit" size={18} /> Открыть редактор без регистрации
          </button>
          <Link className="btn btn-secondary" to="/m/demo">
            <Icon name="eye" size={18} /> Посмотреть как посетитель
          </Link>
        </div>
        <p className="hint auth-guest-hint">Без почты и пароля. Аккаунт можно сохранить потом — в «Моих площадках».</p>

        <div className="auth-divider" role="separator">
          <span>или войдите</span>
        </div>

        <div className="segmented auth-tabs" role="tablist" aria-label="Вход или регистрация">
          <button type="button" role="tab" aria-selected={mode === 'login'} aria-pressed={mode === 'login'} onClick={() => setMode('login')}>
            Вход
          </button>
          <button type="button" role="tab" aria-selected={mode === 'register'} aria-pressed={mode === 'register'} onClick={() => setMode('register')}>
            Регистрация
          </button>
        </div>

        {mode === 'register' && (
          <label className="field">
            <span>Имя</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={100} />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label className="field">
          <span>Пароль{mode === 'register' ? ' (от 8 символов)' : ''}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 8 : undefined}
            required
          />
        </label>

        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-secondary auth-submit" disabled={busy}>
          {busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
        </button>
      </form>
    </div>
  );
}
