// «Все карты» — главная для посетителя: опубликованные открытые карты, с каждой карты можно вернуться сюда.
import type { PanoramaPlacement } from '@space-map/map-core';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { loadCatalog, panoramaUrls, type CatalogItem } from '../api.ts';
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';
import { Icon } from '../ui/icons.tsx';
import { PlanThumb } from '../ui/PlanThumb.tsx';
import { ThemeToggle } from '../ui/theme.tsx';

const ShareDialog = lazy(() => import('../ui/ShareDialog.tsx'));

export function CatalogPage() {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [sharing, setSharing] = useState<CatalogItem | null>(null);

  useEffect(() => {
    document.title = 'Все карты — Карта пространства';
    loadCatalog()
      .then(setItems)
      .catch(() => setFailed(true));
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((v) => !q || v.name.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <div className="org-page">
      <header className="org-top">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <Icon name="building" size={20} />
          </span>
          <div className="brand-text">
            <h1 className="brand-title">Все карты</h1>
            <p className="brand-sub">Карта пространства</p>
          </div>
        </div>
        <div className="org-top-actions">
          <ThemeToggle />
          <Link className="btn btn-ghost" to="/app" aria-label="Для организаторов" title="Для организаторов">
            <Icon name="edit" size={18} /> <span className="btn-label">Для организаторов</span>
          </Link>
        </div>
      </header>

      <main className="org-main">
        {items && items.length > 3 && (
          <label className="search-field catalog-search">
            <Icon name="search" size={18} />
            <input type="search" placeholder="Найти карту" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск карты" />
          </label>
        )}
        {items === null && !failed && <div className="loader" aria-label="Загрузка" />}
        {failed && (
          <p className="hint org-empty">
            Список карт не загрузился. <Link to="/m/demo">Открыть демо-карту</Link>
          </p>
        )}
        {items?.length === 0 && <p className="hint org-empty">Опубликованных карт пока нет.</p>}
        {items && items.length > 0 && shown.length === 0 && <p className="hint org-empty">Ничего не нашлось.</p>}

        <ul className="venue-list catalog-list">
          {shown.map((v) => (
            <li key={v.slug} className="venue-card">
              <Link to={`/m/${v.slug}`} className="venue-thumb" aria-label={`Открыть карту «${v.name}»`}>
                {v.coverPano ? (
                  <img src={panoramaUrls({ pano: v.coverPano } as PanoramaPlacement).preview} alt="" loading="lazy" decoding="async" />
                ) : v.thumb ? (
                  <PlanThumb outline={v.thumb} />
                ) : (
                  <span className="venue-thumb-empty">
                    <Icon name="map" size={26} />
                  </span>
                )}
                {v.coverPano && v.thumb && (
                  <span className="venue-thumb-plan" aria-hidden>
                    <PlanThumb outline={v.thumb} />
                  </span>
                )}
              </Link>
              <div className="venue-card-body">
                <div className="venue-card-main">
                  <strong>{v.name}</strong>
                </div>
                <p className="venue-meta">
                  <span>
                    {count(v.stats.places, 'место', 'места', 'мест')} · {count(v.stats.panoramas, 'панорама', 'панорамы', 'панорам')}
                  </span>
                </p>
                <div className="venue-card-actions">
                  <Link className="btn btn-primary" to={`/m/${v.slug}`}>
                    <Icon name="map" size={17} /> Открыть карту
                  </Link>
                  <button type="button" className="btn btn-secondary" onClick={() => setSharing(v)}>
                    <Icon name="share" size={17} /> Поделиться
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </main>

      {sharing && (
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <ShareDialog url={`${location.origin}/m/${sharing.slug}`} title={sharing.name} fileName={sharing.slug} onClose={() => setSharing(null)} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}

function count(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${word}`;
}
