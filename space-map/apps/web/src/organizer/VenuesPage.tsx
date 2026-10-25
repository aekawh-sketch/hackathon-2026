// Мои площадки (ТЗ 8.1): создать, найти, открыть редактор, опубликовать, ссылка и код для сайта,
// а в меню карточки — переименовать, дублировать, снять с публикации, скачать план, удалить.
import type { PanoramaPlacement, PlanOutline } from '@space-map/map-core';
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router';
import { ApiError, auth, panoramaUrls, venuesApi, type User, type VenueListItem, type VenueSummary } from '../api.ts';
import { APP_APK_URL, hasNativeCapture } from '../capture/native.ts';
import { UNIT_FILL, WALL } from '../plan/style.ts';
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';
import { Icon, type IconName } from '../ui/icons.tsx';
import { useMediaQuery } from '../ui/Sheet.tsx';
import { PublishDialog } from './PublishDialog.tsx';
import { useSession } from './session.tsx';

// Телефон сканирует QR-код проекта с экрана компьютера и сразу открывает его.
const QrScanner = lazy(() => import('../ui/QrScanner.tsx'));

type Filter = 'all' | 'published' | 'draft';
type Sort = 'edited' | 'name';

export default function VenuesPage() {
  const { user, setUser, logout } = useSession();
  const [claimed, setClaimed] = useState(false);
  const phone = !useMediaQuery('(min-width: 900px)');
  const admin = user?.role === 'admin';
  const [scanOpen, setScanOpen] = useState(false);
  const navigate = useNavigate();
  const [venues, setVenues] = useState<VenueListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState<VenueSummary | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('edited');
  const [renaming, setRenaming] = useState<VenueListItem | null>(null);
  const [deleting, setDeleting] = useState<VenueListItem | null>(null);
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);

  const showToast = (text: string) => setToast({ text, id: Date.now() });
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const reload = () =>
    venuesApi
      .list()
      .then((r) => {
        setVenues(r.venues);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Не удалось загрузить площадки'));

  useEffect(() => {
    void reload();
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replaceAll('ё', 'е');
    const list = (venues ?? []).filter((v) => {
      if (filter === 'published' && v.publishedVersion === null) return false;
      if (filter === 'draft' && v.publishedVersion !== null) return false;
      return !q || `${v.name} ${v.slug}`.toLowerCase().replaceAll('ё', 'е').includes(q);
    });
    return sort === 'name'
      ? [...list].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      : [...list].sort((a, b) => Date.parse(b.editedAt) - Date.parse(a.editedAt));
  }, [venues, query, filter, sort]);

  const counts = useMemo(
    () => ({
      all: venues?.length ?? 0,
      published: venues?.filter((v) => v.publishedVersion !== null).length ?? 0,
      draft: venues?.filter((v) => v.publishedVersion === null).length ?? 0,
    }),
    [venues],
  );

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

  const patchItem = (v: VenueSummary) => setVenues((list) => list?.map((x) => (x.id === v.id ? { ...x, ...v } : x)) ?? null);

  // Действия меню: ошибку показываем тостом, список обновляем с сервера — там счётчики и обложки.
  const run = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      showToast(done);
      await reload();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Не получилось. Попробуйте ещё раз.');
    }
  };

  const copyLink = async (v: VenueListItem) => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/m/${v.slug}`);
      showToast(v.publishedVersion !== null ? 'Ссылка скопирована' : 'Ссылка скопирована — откроется после публикации');
    } catch {
      showToast(`Скопируйте вручную: ${location.origin}/m/${v.slug}`);
    }
  };

  const downloadJson = async (v: VenueListItem) => {
    try {
      const { doc } = await venuesApi.draft(v.id);
      const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${v.slug}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Не удалось скачать план');
    }
  };

  return (
    <div className="org-page">
      <header className="org-top">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <Icon name="building" size={20} />
          </span>
          <div className="brand-text">
            <h1 className="brand-title">{admin ? 'Все площадки' : 'Мои площадки'}</h1>
            <p className="brand-sub">{user?.name}</p>
          </div>
        </div>
        <div className="org-top-actions">
          {phone && (
            <button type="button" className="btn btn-secondary" onClick={() => setScanOpen(true)}>
              <Icon name="qr" size={18} /> Сканировать
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => void logout().then(() => navigate('/app/login'))}>
            Выйти
          </button>
        </div>
      </header>
      {scanOpen && (
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <QrScanner onClose={() => setScanOpen(false)} />
          </Suspense>
        </ErrorBoundary>
      )}

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

        {user && !user.isGuest && !admin && (
          <AdminCodeEntry
            onDone={(u) => {
              setUser(u);
              void reload();
              showToast('Теперь вы администратор — видны все площадки');
            }}
          />
        )}

        {user?.isGuest && (
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

        {venues && venues.length > 0 && (
          <div className="venue-toolbar">
            <label className="search-field venue-search">
              <Icon name="search" size={18} />
              <input type="search" placeholder="Найти площадку по названию или ссылке" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск площадки" />
            </label>
            <div className="segmented" role="group" aria-label="Какие площадки показать">
              {(
                [
                  ['all', 'Все'],
                  ['published', 'Опубликованные'],
                  ['draft', 'Черновики'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                  {label} <small className="seg-count">{counts[id]}</small>
                </button>
              ))}
            </div>
            <label className="venue-sort">
              <span className="sr-only">Порядок</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Порядок">
                <option value="edited">Сначала недавние</option>
                <option value="name">По названию</option>
              </select>
            </label>
          </div>
        )}

        {venues === null && !error && <div className="loader" aria-label="Загрузка" />}
        {venues?.length === 0 && (
          <p className="hint org-empty">Площадок пока нет. Создайте первую — нарисуете план, поставите места и добавите панорамы.</p>
        )}
        {venues && venues.length > 0 && shown.length === 0 && <p className="hint org-empty">Ничего не нашлось. Измените поиск или фильтр.</p>}

        <ul className="venue-list">
          {shown.map((v) => (
            <li key={v.id} className="venue-card">
              <Link to={`/app/venues/${v.id}`} className="venue-thumb" aria-label={`Открыть «${v.name}» в редакторе`}>
                {v.coverPano ? (
                  <img src={panoramaUrls({ pano: v.coverPano } as PanoramaPlacement).preview} alt="" loading="lazy" decoding="async" />
                ) : v.thumb ? (
                  <PlanThumb outline={v.thumb} />
                ) : (
                  <span className="venue-thumb-empty">
                    <Icon name="map" size={26} />
                    План пуст
                  </span>
                )}
                {v.coverPano && v.thumb && (
                  <span className="venue-thumb-plan" aria-hidden>
                    <PlanThumb outline={v.thumb} />
                  </span>
                )}
              </Link>

              <div className="venue-card-body">
                <div className="venue-card-head">
                  <div className="venue-card-main">
                    <strong>{v.name}</strong>
                    <span className={`pill ${v.publishedVersion !== null ? 'pill-ok' : ''}`}>
                      {v.publishedVersion !== null ? `Опубликована · версия ${v.publishedVersion}` : 'Черновик'}
                    </span>
                  </div>
                    <CardMenu
                      items={[
                        { icon: 'edit', label: 'Переименовать', onClick: () => setRenaming(v) },
                        { icon: 'copy', label: 'Копировать ссылку', onClick: () => void copyLink(v) },
                        { icon: 'plus', label: 'Дублировать', onClick: () => void run(() => venuesApi.duplicate(v.id), `Копия «${v.name}» создана`) },
                        ...(v.publishedVersion !== null
                          ? [{ icon: 'eye' as IconName, label: 'Снять с публикации', onClick: () => void run(() => venuesApi.unpublish(v.id), 'Снята с публикации — ссылка больше не открывается') }]
                          : []),
                        { icon: 'download', label: 'Скачать план (JSON)', onClick: () => void downloadJson(v) },
                        ...(v.canDelete ? [{ icon: 'trash' as IconName, label: 'Удалить площадку', onClick: () => setDeleting(v), danger: true }] : []),
                      ]}
                    />
                </div>
                <p className="venue-meta">
                  <span>/m/{v.slug}</span>
                  <span>
                    {plural(v.stats.units, 'помещение', 'помещения', 'помещений')} · {plural(v.stats.places, 'место', 'места', 'мест')} ·{' '}
                    {plural(v.stats.panoramas, 'панорама', 'панорамы', 'панорам')}
                  </span>
                  <span title={new Date(v.editedAt).toLocaleString('ru-RU')}>изменена {ago(v.editedAt)}</span>
                  {v.ownerName && <span>создал(а): {v.ownerName}</span>}
                </p>
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

      {publishing && (
        <PublishDialog
          venue={publishing}
          onClose={() => setPublishing(null)}
          onPublished={(v) => {
            patchItem(v);
            setPublishing(v);
          }}
        />
      )}

      {renaming && (
        <RenameDialog
          venue={renaming}
          onClose={() => setRenaming(null)}
          onSaved={(v) => {
            patchItem(v);
            setRenaming(null);
            showToast('Название сохранено');
          }}
        />
      )}

      {deleting && (
        <DeleteDialog
          venue={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setVenues((list) => list?.filter((x) => x.id !== deleting.id) ?? null);
            showToast(`«${deleting.name}» удалена`);
            setDeleting(null);
          }}
        />
      )}

      {toast && (
        <div key={toast.id} className="toast" role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}

/** Миниатюра плана: контуры помещений с заливкой по типу, как на карте. */
function PlanThumb({ outline }: { outline: PlanOutline }) {
  const { minX, minY, maxX, maxY } = outline.bounds;
  const pad = Math.max(maxX - minX, maxY - minY) * 0.06 + 0.2;
  const vb = `${minX - pad} ${-(maxY + pad)} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
  return (
    <svg className="plan-thumb" viewBox={vb} preserveAspectRatio="xMidYMid meet" role="img" aria-label="План площадки">
      {/* План: y вверх, SVG: y вниз — отражаем по вертикали. */}
      <g transform="scale(1,-1)">
        {outline.units.map((u, i) => (
          <polygon key={i} points={u.polygon.map((p) => p.join(',')).join(' ')} fill={UNIT_FILL[u.kind]} stroke={WALL} strokeWidth={0.12} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
  );
}

/**
 * Меню «⋯» карточки. Выносится в body и ставится по кнопке в пределах экрана: кнопка бывает у любого края,
 * а меню, привязанное к ней внутри карточки, уезжало за край на телефоне.
 */
function CardMenu({ items }: { items: { icon: IconName; label: string; onClick: () => void; danger?: boolean }[] }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = () => {
    setAnchor(null);
    setPos(null);
  };

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const pad = 12;
    const gap = 6;
    const { width, height } = menu.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(anchor.right - width, pad), vw - width - pad);
    // Снизу не помещается — открываем вверх.
    const top = anchor.bottom + gap + height + pad <= vh ? anchor.bottom + gap : Math.max(pad, anchor.top - gap - height);
    setPos({ left: Math.max(pad, left), top });
  }, [anchor]);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    // Страницу прокрутили или повернули экран — меню больше не у кнопки.
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [anchor]);

  return (
    <div className="menu-wrap venue-menu">
      <button
        ref={btnRef}
        type="button"
        className="icon-btn"
        aria-label="Ещё действия"
        aria-expanded={!!anchor}
        onClick={() => (anchor ? close() : setAnchor(btnRef.current?.getBoundingClientRect() ?? null))}
      >
        <Icon name="more" />
      </button>
      {anchor &&
        createPortal(
          <>
            <div className="menu-scrim" onClick={close} />
            <div ref={menuRef} className="menu menu-floating" role="menu" style={pos ?? { visibility: 'hidden' }}>
              {items.map((m) => (
                <button
                  key={m.label}
                  type="button"
                  role="menuitem"
                  className={`menu-item ${m.danger ? 'danger' : ''}`}
                  onClick={() => {
                    close();
                    m.onClick();
                  }}
                >
                  <Icon name={m.icon} size={18} />
                  {m.label}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function RenameDialog({ venue, onClose, onSaved }: { venue: VenueListItem; onClose: () => void; onSaved: (v: VenueSummary) => void }) {
  const [value, setValue] = useState(venue.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() || value.trim() === venue.name) return onClose();
    setBusy(true);
    try {
      onSaved(await venuesApi.update(venue.id, { name: value.trim() }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось переименовать');
      setBusy(false);
    }
  };
  return (
    <Dialog title="Переименовать площадку" onClose={onClose}>
      <form onSubmit={save}>
        <label className="field">
          <span>Название</span>
          <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} autoFocus />
        </label>
        <p className="hint">Ссылка /m/{venue.slug} не изменится.</p>
        {error && <p className="notice">{error}</p>}
        <div className="row end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
            Сохранить
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Удаление навсегда — отдельным окном с объяснением, что пропадёт. */
function DeleteDialog({ venue, onClose, onDeleted }: { venue: VenueListItem; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    try {
      await venuesApi.remove(venue.id, venue.name);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось удалить');
      setBusy(false);
    }
  };
  return (
    <Dialog title="Удалить площадку?" onClose={onClose}>
      <p>
        <b>«{venue.name}»</b> удалится навсегда: план, места и панорамы
        {venue.publishedVersion !== null ? <>, карта по ссылке /m/{venue.slug} перестанет открываться</> : null}. Вернуть будет нельзя.
      </p>
      {venue.slug === 'demo' && (
        <p className="notice">Это общая демо-карта стенда: её видят по ссылке /m/demo, в неё попадают гости. После удаления гости будут получать личные копии.</p>
      )}
      {!venue.isOwner && venue.ownerName && (
        <p>
          Автор — <b>{venue.ownerName}</b>.
        </p>
      )}
      {error && <p className="notice">{error}</p>}
      <div className="row end">
        <button type="button" className="btn btn-ghost" onClick={onClose} autoFocus>
          Отмена
        </button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void remove()}>
          <Icon name="trash" size={17} /> {busy ? 'Удаляем…' : 'Удалить навсегда'}
        </button>
      </div>
    </Dialog>
  );
}

const relative = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });

/** «5 минут назад», «вчера», «3 дня назад»; старше месяца — дата. */
function ago(iso: string): string {
  const diff = (Date.parse(iso) - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'только что';
  if (abs < 3600) return relative.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(diff / 3600), 'hour');
  if (abs < 30 * 86_400) return relative.format(Math.round(diff / 86_400), 'day');
  return new Date(iso).toLocaleDateString('ru-RU');
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${word}`;
}

/**
 * Гость видит свои площадки только в этом браузере: пароля у него нет, с другого устройства не войти.
 * «Сохранить аккаунт» добавляет почту и пароль тому же пользователю — площадки остаются при нём.
 */
/** Уже зарегистрированный пользователь становится администратором по коду от владельца сервиса. */
function AdminCodeEntry({ onDone }: { onDone: (user: User) => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await auth.adminCode(code));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось проверить код');
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost admin-code-open" onClick={() => setOpen(true)}>
        Есть код администратора?
      </button>
    );
  }
  return (
    <form className="admin-code" onSubmit={submit}>
      <label className="field">
        <span>Код администратора — администратор видит и правит все площадки</span>
        <div className="copy-row">
          <input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" required maxLength={200} autoFocus />
          <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>
            {busy ? 'Проверяем…' : 'Ввести'}
          </button>
        </div>
      </label>
      {error && <p className="notice">{error}</p>}
    </form>
  );
}

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
