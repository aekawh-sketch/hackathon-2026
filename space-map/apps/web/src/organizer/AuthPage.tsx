// Вход и регистрация организатора (ТЗ 6.1, 8.1).
import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { ApiError, auth } from '../api.ts';
import { Icon } from '../ui/icons.tsx';
import { ThemeToggle } from '../ui/theme.tsx';
import { registrationError } from './registration.ts';
import { authDestination } from './authRedirect.ts';
import { SessionCheck, useSession } from './session.tsx';

export default function AuthPage() {
  const { user, loading, error: sessionError, setUser } = useSession();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Только свои пути внутри кабинета — не уводим по ссылке на чужой сайт.
  const next = authDestination(params.get('next'));
  // Куда уйти после входа гостем: задаём до setUser — перенаправление «вошёл» ниже срабатывает сразу.
  const after = useRef<string | null>(null);
  if (loading || (!user && sessionError)) return <SessionCheck />;
  if (user) return <Navigate to={after.current ?? next} replace />;

  // Гость сразу открывает свою копию в редакторе.
  const tryAsGuest = async () => {
    setBusy(true);
    setError(null);
    try {
      const { user: guest, venueId } = await auth.guest();
      // Не теряем результат гостевого входа: открываем созданную площадку.
      after.current = `/app/venues/${venueId}`;
      setUser(guest);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось открыть редактор. Попробуйте ещё раз.');
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'login' && (!email.trim() || !password)) { setError('Укажите email и пароль.'); return; }
    if (mode === 'register') {
      const invalid = registrationError(name, email, password, confirmation);
      if (invalid) { setError(invalid); return; }
    }
    setBusy(true);
    setError(null);
    try {
      const u = mode === 'login' ? await auth.login(email.trim(), password) : await auth.register(name.trim(), email.trim(), password);
      after.current = next;
      setUser(u);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit} noValidate>
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <Icon name="building" size={20} />
          </span>
          <div className="brand-text">
            <h1 className="brand-title">Карта пространства</h1>
            <p className="brand-sub">Кабинет организатора</p>
          </div>
          <ThemeToggle className="icon-btn auth-theme" />
        </div>

        <div className="auth-quick">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void tryAsGuest()}>
            <Icon name="edit" size={18} /> Открыть редактор без регистрации
          </button>
          <Link className="btn btn-secondary" to="/m/demo">
            <Icon name="eye" size={18} /> Посмотреть демо-карту
          </Link>
        </div>
        <p className="hint auth-guest-hint">Откроется ваша копия демо-карты с 12 панорамами. Сохраните аккаунт в «Моих площадках», чтобы вернуться с другого устройства.</p>

        <div className="auth-divider" role="separator">
          <span>или войдите</span>
        </div>

        <div className="segmented auth-tabs" role="tablist" aria-label="Вход или регистрация">
          <button type="button" role="tab" aria-selected={mode === 'login'} aria-pressed={mode === 'login'} disabled={busy} onClick={() => { setMode('login'); setError(null); }}>
            Вход
          </button>
          <button type="button" role="tab" aria-selected={mode === 'register'} aria-pressed={mode === 'register'} disabled={busy} onClick={() => { setMode('register'); setError(null); }}>
            Регистрация
          </button>
        </div>

        {mode === 'register' && (
          <>
            <label className="field">
              <span>Имя</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={100} />
            </label>
          </>
        )}
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required maxLength={200} />
        </label>
        <label className="field">
          <span>Пароль{mode === 'register' ? ' (от 8 символов)' : ''}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            maxLength={200}
            minLength={mode === 'register' ? 8 : undefined}
            required
          />
        </label>

        {mode === 'register' && (
          <label className="field">
            <span>Повторите пароль</span>
            <input type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="new-password" required maxLength={200} />
          </label>
        )}

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
