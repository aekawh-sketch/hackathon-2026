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
  // Куда уйти после входа. Гостя — сразу в редактор его площадки: иначе перенаправление «вошёл — в кабинет»
  // срабатывает после navigate() и уводит на «Мои площадки».
  const after = useRef<string | null>(null);
  if (user) return <Navigate to={after.current ?? next} replace />;

  // Одна кнопка — и сразу редактор: своя копия демо-площадки, без email и пароля.
  const tryAsGuest = async () => {
    setBusy(true);
    setError(null);
    try {
      const { user: guest, venueId, shared } = await auth.guest();
      // Общий доступ: можно править любую площадку — пришёл с «Редактировать план» на карте, туда и ведём.
      after.current = shared && next.startsWith('/app/venues/') ? next : `/app/venues/${venueId}`;
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

        <button type="button" className="btn btn-primary auth-guest" disabled={busy} onClick={() => void tryAsGuest()}>
          <Icon name="edit" size={18} /> Открыть редактор без регистрации
        </button>
        <p className="hint auth-guest-hint">
          Своя копия демо-площадки: рисуйте, ставьте места и двери, публикуйте. Без регистрации площадки видны только в этом браузере —
          уже начали на другом устройстве? Сохраните там аккаунт («Мои площадки» → «Сохранить аккаунт») и войдите здесь по почте.
        </p>

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
        <p className="hint auth-foot">
          Посетителям вход не нужен. <Link to="/m/demo">Открыть демо-карту</Link>
        </p>
      </form>
    </div>
  );
}
