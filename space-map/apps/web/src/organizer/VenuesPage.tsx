// Мои площадки (ТЗ 8.1): создать, открыть редактор, опубликовать, ссылка и код для сайта.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError, auth, venuesApi, type User, type VenueSummary } from '../api.ts';
import { Icon } from '../ui/icons.tsx';
import { APP_APK_URL, hasNativeCapture } from '../capture/native.ts';
import { PublishDialog } from './PublishDialog.tsx';
import { useSession } from './session.tsx';

export default function VenuesPage() {
  const { user, setUser, logout } = useSession();
  const [claimed, setClaimed] = useState(false);
  const [openAccess, setOpenAccess] = useState(false);
  const navigate = useNavigate();
  const [venues, setVenues] = useState<VenueSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState<VenueSummary | null>(null);

  useEffect(() => {
    venuesApi
      .list()
      .then((r) => {
        setVenues(r.venues);
        setOpenAccess(!!r.openAccess);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Не удалось загрузить площадки'));
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const venue = await venuesApi.create(name.trim());
      navigate(`/app/venues/${venue.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось создать площадку');
      setCreating(false);
    }
  };

  const updated = (v: VenueSummary) => {
    setVenues((list) => list?.map((x) => (x.id === v.id ? v : x)) ?? null);
    setPublishing(v);
  };

  return (
    <div className="org-page">
      <header className="org-top">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <Icon name="building" size={20} />
          </span>
          <div className="brand-text">
            <h1 className="brand-title">{openAccess ? 'Все площадки' : 'Мои площадки'}</h1>
            <p className="brand-sub">{user?.name}</p>
          </div>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => void logout().then(() => navigate('/app/login'))}>
          Выйти
        </button>
      </header>

      <main className="org-main">
        <form className="org-create" onSubmit={create}>
          <label className="field">
            <span>Новая площадка</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Отель «Север» или Выставка ИННОПРОМ" maxLength={120} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={creating || !name.trim()}>
            <Icon name="plus" size={18} /> {creating ? 'Создаём…' : 'Создать'}
          </button>
        </form>

        {error && <p className="notice">{error}</p>}

        {openAccess && (
          <p className="guest-note is-open">
            <Icon name="eye" size={16} /> Общий доступ на время: все вошедшие видят и правят все площадки команды.
          </p>
        )}

        {user?.isGuest && !openAccess && (
          <GuestClaim
            onClaimed={(u) => {
              setUser(u);
              setClaimed(true);
            }}
          />
        )}
        {claimed && user && !user.isGuest && (
          <p className="guest-note is-ok">
            <Icon name="check" size={16} /> Аккаунт сохранён. На телефоне или другом компьютере войдите как {user.email} — площадки будут там.
          </p>
        )}

        {venues === null && !error && <div className="loader" aria-label="Загрузка" />}
        {venues?.length === 0 && (
          <p className="hint org-empty">
            Площадок пока нет. Создайте первую — нарисуете план, поставите места и добавите панорамы.
          </p>
        )}

        <ul className="venue-list">
          {venues?.map((v) => (
            <li key={v.id} className="venue-card">
              <div className="venue-card-main">
                <strong>{v.name}</strong>
                <span className={`pill ${v.publishedVersion !== null ? 'pill-ok' : ''}`}>
                  {v.publishedVersion !== null ? `Опубликована · версия ${v.publishedVersion}` : 'Черновик'}
                </span>
                <small className="hint">/m/{v.slug}</small>
              </div>
              <div className="venue-card-actions">
                <Link className="btn btn-primary" to={`/app/venues/${v.id}`}>
                  <Icon name="edit" size={17} /> Редактировать
                </Link>
                <button type="button" className="btn btn-secondary" onClick={() => setPublishing(v)}>
                  <Icon name="external" size={17} /> {v.publishedVersion !== null ? 'Ссылка и код' : 'Опубликовать'}
                </button>
                {v.publishedVersion !== null && (
                  <a className="btn btn-ghost" href={`/m/${v.slug}`} target="_blank" rel="noreferrer">
                    <Icon name="eye" size={17} /> Карта
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>

        <p className="hint org-foot">
          <Link to="/app/editor">Попробовать редактор без сохранения на сервер</Link>
        </p>
        {!hasNativeCapture() && (
          <p className="hint org-foot">
            <a href={APP_APK_URL}>Приложение для Android</a> — тот же кабинет и встроенная съёмка фотосфер.
          </p>
        )}
      </main>

      {publishing && <PublishDialog venue={publishing} onClose={() => setPublishing(null)} onPublished={updated} />}
    </div>
  );
}

/**
 * Гость видит свои площадки только в этом браузере: пароля у него нет, с другого устройства не войти.
 * «Сохранить аккаунт» добавляет почту и пароль тому же пользователю — площадки остаются при нём.
 */
function GuestClaim({ onClaimed }: { onClaimed: (user: User) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onClaimed(await auth.claim(name.trim(), email.trim(), password));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить аккаунт');
      setBusy(false);
    }
  };

  return (
    <div className="guest-note">
      <p>
        Вы вошли без регистрации: эти площадки видны <b>только в этом браузере</b>. Чтобы открыть их с телефона или другого компьютера,
        сохраните аккаунт — площадки останутся при вас.
      </p>
      {!open ? (
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
          <Icon name="check" size={17} /> Сохранить аккаунт
        </button>
      ) : (
        <form className="guest-claim" onSubmit={submit}>
          <label className="field">
            <span>Имя</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={100} />
          </label>
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          <label className="field">
            <span>Пароль — от 8 символов</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
          </label>
          {error && <p className="notice">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </form>
      )}
    </div>
  );
}
