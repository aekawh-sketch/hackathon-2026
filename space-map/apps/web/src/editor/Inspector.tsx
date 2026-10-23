// Свойства выбранного: помещение, место или дверь. Без выбора — сводка по площадке.
import {
  addDoor,
  deleteOpening,
  deletePlace,
  deleteUnit,
  duplicateUnit,
  isAxisRect,
  neighbours,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  rebuildGraph,
  resizeRect,
  UNIT_KIND_NAMES,
  updatePlace,
  updateUnit,
  type MapDocument,
  type Opening,
  type Place,
  type Unit,
  type UnitKind,
} from '@space-map/map-core';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { UNIT_FILL } from '../plan/style.ts';
import { CategoryBadge, Icon } from '../ui/icons.tsx';
import type { Selection } from './EditorCanvas.tsx';

export interface InspectorProps {
  doc: MapDocument;
  level: string;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onCommit: (doc: MapDocument, select?: Selection) => void;
  onToast: (message: string) => void;
}

export function Inspector(props: InspectorProps) {
  const { doc, selection } = props;
  if (selection?.kind === 'unit') {
    const unit = doc.units.find((u) => u.id === selection.id);
    if (unit) return <UnitPanel {...props} unit={unit} />;
  }
  if (selection?.kind === 'place') {
    const place = doc.places.find((p) => p.id === selection.id);
    if (place) return <PlacePanel {...props} place={place} />;
  }
  if (selection?.kind === 'opening') {
    const opening = doc.openings.find((o) => o.id === selection.id);
    if (opening) return <OpeningPanel {...props} opening={opening} />;
  }
  return <Overview {...props} />;
}

// ── Сводка ──

function Overview({ doc, level, onSelect, onCommit }: InspectorProps) {
  const units = doc.units.filter((u) => u.level === level);
  const area = units.reduce((s, u) => s + polygonArea(u.polygon), 0);
  return (
    <div className="insp">
      <Section title="Площадка">
        <TextField label="Название" value={doc.venue.name} onCommit={(name) => onCommit({ ...doc, venue: { ...doc.venue, name } })} />
        <div className="stat-grid">
          <Stat value={units.length} label="помещений" />
          <Stat value={doc.places.filter((p) => p.level === level).length} label="мест" />
          <Stat value={doc.openings.filter((o) => o.level === level).length} label="проходов" />
          <Stat value={`${Math.round(area)}`} label="м² всего" />
        </div>
      </Section>
      <Section title="Помещения">
        <ul className="insp-list">
          {units.map((u) => (
            <li key={u.id}>
              <button type="button" className="insp-row" onClick={() => onSelect({ kind: 'unit', id: u.id })}>
                <span className="swatch" style={{ background: UNIT_FILL[u.kind] }} />
                <span className="insp-row-text">
                  <strong>{u.name}</strong>
                  <small>{UNIT_KIND_NAMES[u.kind]}</small>
                </span>
                <span className="insp-row-meta">{fmt(polygonArea(u.polygon))} м²</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Как редактировать">
        <ul className="tips">
          <li>
            <Icon name="square" size={16} /> <b>Комната</b> — протяните прямоугольник на свободном месте. Дверь к соседнему коридору поставится сама.
          </li>
          <li>
            <Icon name="cursor" size={16} /> <b>Выбор</b> — тяните помещение, чтобы сдвинуть, или белые угловые ручки, чтобы изменить размер.
          </li>
          <li>
            <Icon name="pin" size={16} /> <b>Место</b> — нажмите внутри помещения. <Icon name="doorAdd" size={16} /> <b>Дверь</b> — на общую стену.
          </li>
          <li>
            <Icon name="eye" size={16} /> Изменения сразу видны на <Link to="/m/demo">карте посетителя</Link> в этом браузере.
          </li>
        </ul>
      </Section>
    </div>
  );
}

// ── Помещение ──

function UnitPanel({ doc, unit, onSelect, onCommit, onToast }: InspectorProps & { unit: Unit }) {
  const rect = isAxisRect(unit.polygon);
  const b = polygonBounds(unit.polygon);
  const doors = doc.openings.filter((o) => (o.units as readonly string[]).includes(unit.id));
  const connected = new Set(doors.flatMap((o) => [...o.units]));
  const near = neighbours(doc, unit.id);
  const inside = doc.places.filter((p) => p.level === unit.level && pointInPolygon(p.pos, unit.polygon));
  const name = (id: string) => doc.units.find((u) => u.id === id)?.name ?? '—';

  return (
    <div className="insp">
      <PanelHead icon={<span className="swatch lg" style={{ background: UNIT_FILL[unit.kind] }} />} kicker="Помещение" title={unit.name} onClose={() => onSelect(null)} />
      <Section>
        <TextField label="Название" value={unit.name} onCommit={(v) => onCommit(updateUnit(doc, unit.id, { name: v }), { kind: 'unit', id: unit.id })} />
        <label className="field">
          <span>Тип</span>
          <select value={unit.kind} onChange={(e) => onCommit(updateUnit(doc, unit.id, { kind: e.target.value as UnitKind }), { kind: 'unit', id: unit.id })}>
            {Object.entries(UNIT_KIND_NAMES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <Toggle
          label="Можно пройти"
          hint="Маршруты строятся только через проходимые помещения"
          checked={unit.walkable}
          onChange={(walkable) => onCommit(updateUnit(doc, unit.id, { walkable }), { kind: 'unit', id: unit.id })}
        />
      </Section>
      <Section title="Размер">
        {rect ? (
          <div className="field-row">
            <NumberField
              label="Ширина, м"
              value={b.maxX - b.minX}
              onCommit={(w) => {
                const next = resizeRect(doc, unit.id, w, b.maxY - b.minY);
                if (next === doc) onToast('Не меньше 1 м');
                else onCommit(next, { kind: 'unit', id: unit.id });
              }}
            />
            <NumberField
              label="Глубина, м"
              value={b.maxY - b.minY}
              onCommit={(h) => {
                const next = resizeRect(doc, unit.id, b.maxX - b.minX, h);
                if (next === doc) onToast('Не меньше 1 м');
                else onCommit(next, { kind: 'unit', id: unit.id });
              }}
            />
          </div>
        ) : null}
        <p className="insp-note">
          Площадь <b>{fmt(polygonArea(unit.polygon))} м²</b>
          {rect ? ' · левый нижний угол на месте' : ' · форму меняйте ручками на плане'}
        </p>
      </Section>
      <Section title="Двери и проходы">
        {doors.length === 0 && <p className="insp-note warn">Нет ни одной двери — сюда не построится маршрут.</p>}
        <ul className="insp-list">
          {doors.map((o) => (
            <li key={o.id} className="insp-row static">
              <Icon name="doorAdd" size={18} />
              <span className="insp-row-text">
                <strong>{o.kind === 'entrance' ? 'Вход с улицы' : name(o.units.find((u) => u !== unit.id) ?? '')}</strong>
                <small>{o.kind === 'door' ? 'Дверь' : o.kind === 'passage' ? 'Проход' : 'Вход'}</small>
              </span>
              <button type="button" className="icon-btn ghost sm" aria-label="Выбрать" onClick={() => onSelect({ kind: 'opening', id: o.id })}>
                <Icon name="cursor" size={16} />
              </button>
              <button
                type="button"
                className="icon-btn ghost sm danger"
                aria-label="Убрать дверь"
                onClick={() => onCommit(rebuildGraph(deleteOpening(doc, o.id), unit.level), { kind: 'unit', id: unit.id })}
              >
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
        {near.filter((n) => !connected.has(n.id)).length > 0 && (
          <div className="chip-row">
            {near
              .filter((n) => !connected.has(n.id))
              .map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="chip"
                  onClick={() => {
                    const next = addDoor(doc, unit.id, n.id);
                    onCommit(rebuildGraph(next, unit.level), { kind: 'unit', id: unit.id });
                    onToast(`Дверь в «${n.name}» добавлена`);
                  }}
                >
                  <Icon name="plus" size={14} /> {n.name}
                </button>
              ))}
          </div>
        )}
      </Section>
      {inside.length > 0 && (
        <Section title="Места внутри">
          <ul className="insp-list">
            {inside.map((p) => {
              const cat = doc.categories.find((c) => c.id === p.category);
              return (
                <li key={p.id}>
                  <button type="button" className="insp-row" onClick={() => onSelect({ kind: 'place', id: p.id })}>
                    <CategoryBadge icon={cat?.icon ?? ''} color={cat?.color ?? '#4A5568'} size={28} />
                    <span className="insp-row-text">
                      <strong>{p.name}</strong>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      <div className="insp-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            const copy = duplicateUnit(doc, unit.id);
            if (!copy) return onToast('Рядом нет свободного места для копии');
            onCommit(copy.doc, { kind: 'unit', id: copy.id });
            onToast('Копия поставлена рядом');
          }}
        >
          <Icon name="copy" size={18} /> Дублировать
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            onCommit(deleteUnit(doc, unit.id), null);
            onToast(`«${unit.name}» удалено`);
          }}
        >
          <Icon name="trash" size={18} /> Удалить
        </button>
      </div>
    </div>
  );
}

// ── Место ──

function PlacePanel({ doc, place, onSelect, onCommit, onToast }: InspectorProps & { place: Place }) {
  const cat = doc.categories.find((c) => c.id === place.category);
  const patch = (p: Parameters<typeof updatePlace>[2]) => onCommit(updatePlace(doc, place.id, p), { kind: 'place', id: place.id });
  return (
    <div className="insp">
      <PanelHead icon={<CategoryBadge icon={cat?.icon ?? ''} color={cat?.color ?? '#4A5568'} size={36} />} kicker="Место" title={place.name} onClose={() => onSelect(null)} />
      <Section>
        <TextField label="Название" value={place.name} onCommit={(name) => patch({ name })} />
        <label className="field">
          <span>Категория</span>
          <select value={place.category} onChange={(e) => patch({ category: e.target.value })}>
            {doc.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="field-row">
          <TextField label="Номер" value={place.number ?? ''} placeholder="—" onCommit={(v) => patch({ number: v.trim() || null })} />
          <TextField label="Часы работы" value={place.hours ?? ''} placeholder="10:00–18:00" onCommit={(v) => patch({ hours: v.trim() || null })} />
        </div>
        <TextField label="Описание" multiline value={place.description} onCommit={(description) => patch({ description })} />
        <Toggle label="Скрыть от посетителей" checked={place.hidden} onChange={(hidden) => patch({ hidden })} />
        <p className="insp-note">Чтобы передвинуть место, перетащите его значок на плане.</p>
      </Section>
      <div className="insp-actions">
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            onCommit(rebuildGraph(deletePlace(doc, place.id), place.level), null);
            onToast(`«${place.name}» удалено`);
          }}
        >
          <Icon name="trash" size={18} /> Удалить место
        </button>
      </div>
    </div>
  );
}

// ── Дверь ──

function OpeningPanel({ doc, opening, onSelect, onCommit }: InspectorProps & { opening: Opening }) {
  const names = opening.units.map((id) => doc.units.find((u) => u.id === id)?.name ?? '—');
  const len = Math.hypot(opening.segment[1][0] - opening.segment[0][0], opening.segment[1][1] - opening.segment[0][1]);
  return (
    <div className="insp">
      <PanelHead icon={<span className="swatch lg door"><Icon name="doorAdd" size={18} /></span>} kicker={opening.kind === 'entrance' ? 'Вход' : 'Проход'} title={names.join(' ↔ ')} onClose={() => onSelect(null)} />
      <Section>
        {opening.kind !== 'entrance' && (
          <label className="field">
            <span>Вид</span>
            <select
              value={opening.kind}
              onChange={(e) =>
                onCommit({ ...doc, openings: doc.openings.map((o) => (o.id === opening.id ? { ...o, kind: e.target.value as Opening['kind'] } : o)) }, { kind: 'opening', id: opening.id })
              }
            >
              <option value="door">Дверь</option>
              <option value="passage">Проход без двери</option>
            </select>
          </label>
        )}
        <p className="insp-note">Ширина {fmt(len)} м</p>
      </Section>
      <div className="insp-actions">
        <button type="button" className="btn btn-danger" onClick={() => onCommit(rebuildGraph(deleteOpening(doc, opening.id), opening.level), null)}>
          <Icon name="trash" size={18} /> Убрать
        </button>
      </div>
    </div>
  );
}

// ── Поля ──

function PanelHead({ icon, kicker, title, onClose }: { icon: ReactNode; kicker: string; title: string; onClose: () => void }) {
  return (
    <div className="insp-head">
      {icon}
      <div className="insp-head-text">
        <small>{kicker}</small>
        <strong>{title}</strong>
      </div>
      <button type="button" className="icon-btn ghost" aria-label="Снять выбор" onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  );
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="insp-section">
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="stat-tile">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

/** Поле правится локально и уходит в историю один раз — по Enter или потере фокуса. */
function TextField(props: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const commit = () => {
    if (draft !== props.value) props.onCommit(draft);
  };
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.multiline ? (
        <textarea rows={3} value={draft} placeholder={props.placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
      ) : (
        <input
          value={draft}
          placeholder={props.placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setDraft(props.value);
          }}
        />
      )}
    </label>
  );
}

function NumberField(props: { label: string; value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(fmt(props.value));
  useEffect(() => setDraft(fmt(props.value)), [props.value]);
  const commit = () => {
    const v = Number(draft.replace(',', '.'));
    if (Number.isFinite(v) && Math.abs(v - props.value) > 1e-6) props.onCommit(Math.round(v * 2) / 2);
    else setDraft(fmt(props.value));
  };
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span className="toggle-text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden />
    </label>
  );
}

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString('ru-RU');
}
