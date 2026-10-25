// Статистика просмотров площадки для организатора: сколько раз открывали карту, какие места смотрели,
// куда строили маршруты и что искали, но не нашли. Данные — счётчики по дням, без сведений о посетителях.
import { panoramaPointName, unitAt, type MapDocument } from '@space-map/map-core';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, venuesApi, type StatKind, type VenueStats, type VenueSummary } from '../api.ts';
import { Icon } from '../ui/icons.tsx';
import { ThemeToggle } from '../ui/theme.tsx';

type Metric = Exclude<StatKind, 'search_miss'>;

const METRICS: { id: Metric; label: string; chart: string; unit: [string, string, string] }[] = [
  { id: 'open', label: 'Открытий карты', chart: 'Открытия карты по дням', unit: ['открытие', 'открытия', 'открытий'] },
  { id: 'place', label: 'Карточек мест', chart: 'Просмотры карточек мест по дням', unit: ['карточка', 'карточки', 'карточек'] },
  { id: 'route', label: 'Маршрутов', chart: 'Построенные маршруты по дням', unit: ['маршрут', 'маршрута', 'маршрутов'] },
  { id: 'panorama', label: 'Панорам', chart: 'Просмотры панорам по дням', unit: ['панорама', 'панорамы', 'панорам'] },
];

const PERIODS = [7, 30, 90] as const;

export default function StatsPage() {
  const { id = '' } = useParams();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [metric, setMetric] = useState<Metric>('open');
  const [data, setData] = useState<{ venue: VenueSummary; doc: MapDocument; stats: VenueStats } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    Promise.all([venuesApi.get(id), venuesApi.draft(id), venuesApi.stats(id, days)])
      .then(([venue, draft, stats]) => alive && setData({ venue, doc: draft.doc, stats }))
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : 'Не удалось загрузить статистику'));
    return () => {
      alive = false;
    };
  }, [id, days]);

  const series = useMemo(() => (data ? dailySeries(data.stats) : []), [data]);
  const totals = useMemo(() => {
    const t: Record<Metric, number> = { open: 0, place: 0, route: 0, panorama: 0 };
    for (const d of series) for (const m of METRICS) t[m.id] += d[m.id];
    return t;
  }, [series]);

  if (error)
    return (
      <div className="screen-message">
        <div className="empty-state">
          <Icon name="chart" size={32} />
          <p>{error}</p>
          <Link to="/app" className="btn btn-secondary">
            К площадкам
          </Link>
        </div>
      </div>
    );

  const doc = data?.doc;
  const placeName = (pid: string) => (pid ? (doc?.places.find((p) => p.id === pid)?.name ?? 'Удалённое место') : 'Точка на карте');
  const panoName = (pid: string) => {
    if (!doc) return pid;
    const pano = doc.panoramas.find((p) => p.id === pid);
    if (!pano) return 'Удалённая панорама';
    return panoramaPointName(doc, pid) ?? unitAt(doc, pano.level, pano.pos)?.name ?? 'Панорама';
  };
  const current = METRICS.find((m) => m.id === metric)!;
  const empty = data && Object.values(totals).every((v) => v === 0) && data.stats.misses.length === 0;

  return (
    <div className="org-page stats-page">
      <header className="org-top">
        <div className="brand">
          <Link to="/app" className="icon-btn" aria-label="К площадкам" title="К площадкам">
            <Icon name="back" />
          </Link>
          <div className="brand-text">
            <h1 className="brand-title">Статистика</h1>
            <p className="brand-sub">{data?.venue.name ?? ' '}</p>
          </div>
        </div>
        <div className="org-top-actions">
          <ThemeToggle />
        </div>
      </header>

      <main className="org-main">
        <div className="stats-filters">
          <div className="segmented" role="group" aria-label="Период">
            {PERIODS.map((p) => (
              <button key={p} type="button" aria-pressed={days === p} onClick={() => setDays(p)}>
                {p} дней
              </button>
            ))}
          </div>
          {data && (
            <Link to={`/app/venues/${data.venue.id}`} className="btn btn-ghost">
              <Icon name="edit" size={17} /> Редактор
            </Link>
          )}
        </div>

        {!data ? (
          <div className="loader" aria-label="Загрузка" />
        ) : (
          <>
            {data.venue.publishedVersion === null && <p className="notice">Карта не опубликована — посетители её пока не видят, считать нечего.</p>}
            {empty && data.venue.publishedVersion !== null && (
              <p className="hint stats-empty">За этот период карту ещё не открывали. Поделитесь ссылкой или QR-кодом — просмотры появятся здесь.</p>
            )}

            <div className="stat-tiles" role="group" aria-label="Показатель для графика">
              {METRICS.map((m) => (
                <button key={m.id} type="button" className="stat-tile" aria-pressed={metric === m.id} onClick={() => setMetric(m.id)}>
                  <span className="stat-tile-label">{m.label}</span>
                  <span className="stat-tile-value">{compact(totals[m.id])}</span>
                </button>
              ))}
            </div>

            <section className="stats-card">
              <h2>{current.chart}</h2>
              <ColumnChart series={series} metric={metric} unit={current.unit} />
              <details className="stats-table">
                <summary>Таблица по дням</summary>
                <table>
                  <thead>
                    <tr>
                      <th>День</th>
                      {METRICS.map((m) => (
                        <th key={m.id}>{m.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...series].reverse().map((d) => (
                      <tr key={d.day}>
                        <td>{dayLabel(d.day)}</td>
                        {METRICS.map((m) => (
                          <td key={m.id}>{d[m.id]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </section>

            <div className="stats-grid">
              <TopList title="Популярные места" hint="Открывали карточку" rows={data.stats.places.map((r) => ({ name: placeName(r.target), count: r.count }))} />
              <TopList title="Куда строят маршруты" hint="Место назначения" rows={data.stats.routes.map((r) => ({ name: placeName(r.target), count: r.count }))} />
              <TopList title="Смотрят в панорамах" hint="Точка съёмки" rows={data.stats.panoramas.map((r) => ({ name: panoName(r.target), count: r.count }))} />
              <TopList
                title="Искали и не нашли"
                hint="Стоит добавить такие места или слова для поиска"
                rows={data.stats.misses.map((r) => ({ name: `«${r.target}»`, count: r.count }))}
              />
            </div>
            <p className="hint org-foot">Считаются только просмотры опубликованной карты. Открытие карты — один раз за посещение; ни cookies, ни сведений о посетителях не хранится.</p>
          </>
        )}
      </main>
    </div>
  );
}

interface DayRow extends Record<Metric, number> {
  day: string;
}

/** Каждый день периода, включая дни без просмотров. */
function dailySeries(stats: VenueStats): DayRow[] {
  const end = new Date(`${stats.today}T00:00:00Z`);
  const rows: DayRow[] = [];
  for (let i = stats.days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    rows.push({ day: d, open: 0, place: 0, route: 0, panorama: 0 });
  }
  const byDay = new Map(rows.map((r) => [r.day, r]));
  for (const d of stats.daily) {
    const row = byDay.get(d.day);
    if (row && d.kind !== 'search_miss') row[d.kind] += d.count;
  }
  return rows;
}

/** Столбцы по дням: одна величина, одна краска; подсказка при наведении или касании. */
function ColumnChart({ series, metric, unit }: { series: DayRow[]; metric: Metric; unit: [string, string, string] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const height = 180;
  const left = 34;
  const bottom = 22;
  const top = 8;
  const plotW = Math.max(0, width - left);
  const plotH = height - bottom - top;
  const max = niceMax(Math.max(0, ...series.map((d) => d[metric])));
  const band = series.length ? plotW / series.length : 0;
  const barW = Math.max(2, Math.min(24, band - 2));
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const labels = series.length > 1 ? [0, Math.floor((series.length - 1) / 2), series.length - 1] : [0];
  const active = hover !== null ? series[hover] : null;

  return (
    <div className="column-chart" ref={ref} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Столбцы по дням, максимум ${Math.max(0, ...series.map((d) => d[metric]))}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={left - 6} y={y(t) + 4} textAnchor="end" className="chart-tick">
                {compact(t)}
              </text>
            </g>
          ))}
          {series.map((d, i) => {
            const v = d[metric];
            const h = top + plotH - y(v);
            const x = left + i * band + (band - barW) / 2;
            return (
              <g key={d.day}>
                {v > 0 && <path d={columnPath(x, y(v), barW, h)} className={`chart-bar ${hover === i ? 'is-hover' : ''}`} />}
                {/* Цель наведения — вся полоса дня: в тонкий столбец не попасть ни мышью, ни пальцем. */}
                <rect x={left + i * band} y={top} width={band} height={plotH} fill="transparent" onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
              </g>
            );
          })}
          {labels.map((i) => (
            <text key={i} x={left + i * band + band / 2} y={height - 6} textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'} className="chart-tick">
              {dayLabel(series[i]!.day)}
            </text>
          ))}
        </svg>
      )}
      {active && hover !== null && (
        <div className="chart-tip" role="status" style={{ left: Math.min(Math.max(left + hover * band + band / 2, 70), width - 70), top: y(active[metric]) - 8 }}>
          <strong>{dayLabel(active.day)}</strong>
          <span>
            {active[metric]} {plural(active[metric], unit)}
          </span>
        </div>
      )}
    </div>
  );
}

/** Столбец со скруглённым верхом 4 px и прямым основанием. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function TopList({ title, hint, rows }: { title: string; hint: string; rows: { name: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="stats-card">
      <h2>{title}</h2>
      <p className="hint">{hint}</p>
      {rows.length === 0 ? (
        <p className="hint stats-none">Пока пусто</p>
      ) : (
        <ol className="top-list">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`}>
              <span className="top-name">{r.name}</span>
              <span className="top-bar-track" aria-hidden>
                <span className="top-bar" style={{ width: `${(r.count / max) * 100}%` }} />
              </span>
              <span className="top-count">{r.count}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Верх шкалы: круглое чётное число — тогда и середина шкалы целая. */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 4, 5, 10]) if (m * p >= v && (m * p) % 2 === 0) return m * p;
  return 10 * p;
}

function compact(v: number): string {
  if (v >= 10_000) return `${Math.round(v / 1000)} тыс.`;
  if (v >= 1000) return `${(v / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} тыс.`;
  return Math.round(v).toLocaleString('ru-RU');
}

function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');
}

function plural(n: number, [one, few, many]: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
