// Свойства выбранного: помещение, место, дверь или точка съёмки. Без выбора — сводка по площадке.
import {
  panoramaForPlace,
  activeCapturePoints,
  captureMinutes,
  pendingCapturePoints,
  removeCapturePoint,
  restoreRemovedCapturePoints,
  unitAt,
  type CapturePoint,
  centerOpening,
  deleteHole,
  pointInUnit,
  rectPolygon,
  setHolePolygon,
  deleteOpening,
  doorLeaves,
  doorStyleOf,
  doorTypeOf,
  fillOpening,
  openingSides,
  placeDoor,
  setDoorType,
  setOpeningWidth,
  updateDoorStyle,
  type DoorPreset,
  type DoorStyle,
  type DoorType,
  deletePanorama,
  deletePlace,
  deleteUnit,
  duplicateUnit,
  isAxisRect,
  neighbours,
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
  type PlacePanorama,
  type Unit,
  type UnitKind,
} from '@space-map/map-core';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { panoramaUrls } from '../api.ts';
import { APP_APK_URL, isAndroid } from '../capture/native.ts';
import { UNIT_FILL } from '../plan/style.ts';
import { ConfirmDialog } from '../ui/ConfirmDialog.tsx';
import { CategoryBadge, Icon } from '../ui/icons.tsx';
import { holeRef, type Selection, type Tool } from './EditorCanvas.tsx';

export interface InspectorProps {
  doc: MapDocument;
  level: string;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onCommit: (doc: MapDocument, select?: Selection) => void;
  onToast: (message: string) => void;
  tool: Tool;
  areaCategory: string;
  onAreaCategory: (category: string) => void;
  /** Настройки новой двери — показываются, пока выбран инструмент «Дверь». */
  doorPreset: DoorPreset;
  onDoorPreset: (p: DoorPreset) => void;
  onExitTool: () => void;
  /** Номера точек съёмки в порядке обхода. */
  shotLabels: Map<string, string>;
  /** Открыть подсказку маршрута съёмки на камере — с точки или с начала маршрута. */
  onOpenGuide: (pointId: string | null) => void;
  /** Загрузить готовую панораму в точку; нет — площадка без сервера (демо). */
  onUploadPanorama?: (pointId: string) => void;
  /** Снять фотосферу встроенной съёмкой приложения; нет — не в приложении или демо без сервера. */
  onShootPanorama?: (pointId: string) => void;
  /** То же из карточки места: точка съёмки у места создаётся сама. */
  onShootForPlace?: (placeId: string) => void;
  onUploadForPlace?: (placeId: string) => void;
  /** Открыть панораму на весь экран — проверить, как она снята и повёрнута. */
  /** Открыть панораму; yaw — куда смотреть (у места — на само место). */
  onOpenPanorama: (panoId: string, yaw?: number) => void;
}

export function Inspector(props: InspectorProps) {
  const { doc, selection } = props;
  if (props.tool === 'zone') return <ZoneToolPanel {...props} />;
  if (!selection && props.tool === 'door') return <DoorPresetPanel {...props} />;
  if (selection?.kind === 'unit') {
    const unit = doc.units.find((u) => u.id === selection.id);
    if (unit) return <UnitPanel {...props} unit={unit} />;
  }
  if (selection?.kind === 'place') {
    const place = doc.places.find((p) => p.id === selection.id);
    if (place) return <PlacePanel {...props} place={place} />;
  }
  if (selection?.kind === 'hole') {
    const ref = holeRef(selection.id);
    const unit = doc.units.find((u) => u.id === ref.unitId);
    if (unit?.holes?.[ref.index]) return <HolePanel {...props} unit={unit} index={ref.index} />;
  }
  if (selection?.kind === 'opening') {
    const opening = doc.openings.find((o) => o.id === selection.id);
    if (opening) return <OpeningPanel {...props} opening={opening} />;
  }
  if (selection?.kind === 'shot') {
    const point = doc.capturePoints?.find((p) => p.id === selection.id && p.origin !== 'removed');
    if (point) return <ShotPanel {...props} point={point} />;
  }
  if (!selection && props.tool === 'shot') return <CapturePlan {...props} />;
  return <Overview {...props} />;
}

// ── Сводка ──

function Overview(props: InspectorProps) {
  const { doc, level, onSelect, onCommit } = props;
  const units = doc.units.filter((u) => u.level === level);
  const area = units.reduce((s, u) => s + unitArea(doc, u), 0);
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
      <CaptureSummary {...props} />
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
                <span className="insp-row-meta">{fmt(unitArea(doc, u))} м²</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Как редактировать">
        <ul className="tips">
          <li>
            <Icon name="square" size={16} /> <b>Комната</b> — протяните прямоугольник на свободном месте или внутри зала; для вложенной комнаты дверь можно поставить на её стене.
          </li>
          <li>
            <Icon name="cursor" size={16} /> <b>Выбор</b> — тяните помещение, чтобы сдвинуть, или белые угловые ручки, чтобы изменить размер.
          </li>
          <li>
            <Icon name="pin" size={16} /> <b>Место</b> — нажмите внутри помещения. <Icon name="doorAdd" size={16} /> <b>Дверь</b> — на общую стену.
          </li>
          <li>
            <Icon name="zone" size={16} /> <b>Зона</b> — выберите категорию и протяните прямоугольник внутри помещения; затем тяните за середину или белые углы.
          </li>
          <li>
            <Icon name="camera" size={16} /> <b>Съёмка</b> — точки панорам считаются сами по форме комнат и дверям. Можно добавить свою, сдвинуть или убрать.
          </li>
          <li>
            <Icon name="eye" size={16} /> Изменения сразу видны на <Link to="/m/demo">карте посетителя</Link> в этом браузере.
          </li>
        </ul>
      </Section>
    </div>
  );
}

// ── Съёмка панорам ──

/** Сколько снимать: число точек, время, кнопка маршрута съёмки. */
function CaptureSummary({ doc, level, onCommit, onOpenGuide }: InspectorProps) {
  const active = activeCapturePoints(doc, level);
  const pending = pendingCapturePoints(doc, level);
  const removed = (doc.capturePoints ?? []).filter((p) => p.level === level && p.origin === 'removed').length;
  const shot = doc.panoramas.filter((p) => p.level === level).length;
  return (
    <Section title="Съёмка панорам">
      <div className="stat-grid">
        <Stat value={pending.length} label={plural(pending.length, 'точка снять', 'точки снять', 'точек снять')} />
        <Stat value={`≈ ${captureMinutes(doc, level)}`} label="минут съёмки" />
        <Stat value={shot} label={plural(shot, 'панорама есть', 'панорамы есть', 'панорам есть')} />
        <Stat value={active.filter((p) => p.origin === 'manual').length} label="своих точек" />
      </div>
      {pending.length > 0 && (
        <button type="button" className="btn btn-primary insp-wide" onClick={() => onOpenGuide(null)}>
          <Icon name="route" size={18} /> Маршрут съёмки с камерой
        </button>
      )}
      {removed > 0 && (
        <button type="button" className="btn btn-secondary insp-wide" onClick={() => onCommit(restoreRemovedCapturePoints(doc, level))}>
          <Icon name="reset" size={17} /> Вернуть убранные точки · {removed}
        </button>
      )}
      <p className="insp-note">
        Точки считаются по плану: панорамы закрывают пол каждого помещения, а у дверей стоят так, чтобы соседние панорамы видели друг друга —
        тогда прогулка по маршруту идёт без разрывов. Мебели и стёкол план не знает — проверьте точки на месте.
      </p>
    </Section>
  );
}

/** Панель инструмента «Съёмка»: сводка и подсказки. */
function CapturePlan(props: InspectorProps) {
  return (
    <div className="insp">
      <PanelHead icon={<span className="swatch lg shot"><Icon name="camera" size={18} /></span>} kicker="Инструмент «Съёмка»" title="Точки панорам" onClose={props.onExitTool} />
      <CaptureSummary {...props} />
      <Section title="Как править">
        <ul className="tips">
          <li>
            <Icon name="plus" size={16} /> Нажмите внутри помещения — появится своя точка. Рассчитанные рядом пересчитаются.
          </li>
          <li>
            <Icon name="hand" size={16} /> Тяните точку, чтобы сдвинуть: она станет своей и больше не будет двигаться сама.
          </li>
          <li>
            <Icon name="trash" size={16} /> Лишнюю точку выберите и уберите — расчёт не поставит её снова.
          </li>
        </ul>
      </Section>
    </div>
  );
}

function ZoneToolPanel({ doc, areaCategory, onAreaCategory, onExitTool }: InspectorProps) {
  const category = doc.categories.find((c) => c.id === areaCategory) ?? doc.categories[0];
  return (
    <div className="insp">
      <PanelHead icon={<CategoryBadge icon={category?.icon ?? 'zone'} color={category?.color ?? '#4A5568'} size={36} />} kicker="Инструмент «Зона»" title="Новая зона" onClose={onExitTool} />
      <Section title="Категория">
        {doc.categories.length > 0 ? (
          <label className="field">
            <span>Тип зоны</span>
            <select value={category?.id ?? ''} onChange={(e) => onAreaCategory(e.target.value)}>
              {doc.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        ) : <p className="insp-note">Добавьте категорию места, прежде чем рисовать зоны.</p>}
        <p className="insp-note">Протяните прямоугольник внутри помещения. Границы помещения, цвет и категория зоны сохранятся вместе с картой. Выберите зону инструментом «Выбор»: тяните за середину, чтобы переместить, или за угол, чтобы изменить размер.</p>
      </Section>
    </div>
  );
}

function ShotPanel({ doc, point, shotLabels, onSelect, onCommit, onToast, onOpenGuide, onUploadPanorama, onShootPanorama, onOpenPanorama }: InspectorProps & { point: CapturePoint }) {
  const room = unitAt(doc, point.level, point.pos)?.name ?? 'вне помещения';
  const label = shotLabels.get(point.id);
  const pano = point.panorama ? doc.panoramas.find((p) => p.id === point.panorama) : undefined;
  const [confirm, setConfirm] = useState<'point' | 'pano' | null>(null);
  return (
    <div className="insp">
      {confirm === 'point' && (
        <ConfirmDialog
          title={label ? `Убрать точку № ${label}?` : 'Убрать точку съёмки?'}
          confirmLabel="Убрать точку"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            onCommit(removeCapturePoint(doc, point.id), null);
            onToast(point.origin === 'auto' ? 'Точка убрана — расчёт не вернёт её сам' : 'Точка удалена');
          }}
        >
          <p>
            {point.origin === 'auto' && !pano
              ? 'Точку поставил расчёт — он больше не поставит её на это место. Вернуть: «Вернуть убранные точки» в сводке «Съёмка панорам».'
              : 'Точка удалится с плана.'}
            {pano ? ' Снятая здесь панорама останется на карте.' : ''}
          </p>
          <p className="hint">Передумаете — «Отменить» вверху.</p>
        </ConfirmDialog>
      )}
      {confirm === 'pano' && pano && (
        <ConfirmDialog
          title="Удалить панораму?"
          confirmLabel="Удалить панораму"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            onCommit(rebuildGraph(deletePanorama(doc, pano.id), pano.level), { kind: 'shot', id: point.id });
            onToast('Панорама удалена — точка снова ждёт съёмки');
          }}
        >
          <p>Панорама уберётся с карты: из карточек мест и из переходов соседних панорам. Точка съёмки останется — её можно снять заново.</p>
          <p className="hint">Передумаете — «Отменить» вверху.</p>
        </ConfirmDialog>
      )}
      <PanelHead
        icon={<span className="swatch lg shot"><Icon name="camera" size={18} /></span>}
        kicker={point.origin === 'auto' ? 'Точка съёмки · рассчитана' : 'Точка съёмки · своя'}
        title={label ? `№ ${label} · ${room}` : room}
        onClose={() => onSelect(null)}
      />
      {pano && (
        <button type="button" className="pano-preview" onClick={() => onOpenPanorama(pano.id)} aria-label="Открыть панораму">
          <img src={panoramaUrls(pano).preview} alt="" loading="lazy" decoding="async" />
          <span className="pano-preview-label">
            <Icon name="pano" size={17} /> Открыть панораму
          </span>
        </button>
      )}
      <Section>
        <p className="insp-note">
          {pano
            ? 'Панорама в этой точке уже снята.'
            : point.origin === 'auto'
              ? 'Сервис поставил точку по форме помещения и дверям. Сдвиньте её, если мешает мебель или стекло, — она станет своей.'
              : 'Точку поставили вручную: расчёт её не двигает и ставит остальные точки вокруг неё.'}
        </p>
        <p className="insp-note">
          Встаньте в точку, держите телефон на уровне глаз и поворачивайтесь вокруг камеры. Координаты: {fmt(point.pos[0])}; {fmt(point.pos[1])} м.
        </p>
      </Section>
      <div className="insp-actions shot-actions">
        {pano && (
          <button type="button" className="btn btn-primary" onClick={() => onOpenPanorama(pano.id)}>
            <Icon name="pano" size={18} /> Открыть панораму
          </button>
        )}
        {!pano && (
          <button type="button" className="btn btn-primary" onClick={() => onOpenGuide(point.id)}>
            <Icon name="route" size={18} /> Маршрут с камерой отсюда
          </button>
        )}
        {!pano && onShootPanorama && (
          <button type="button" className="btn btn-success" onClick={() => onShootPanorama(point.id)}>
            <Icon name="camera" size={18} /> Снять фотосферу
          </button>
        )}
        {!pano && !onShootPanorama && isAndroid() && (
          <a className="btn btn-secondary" href={APP_APK_URL}>
            <Icon name="download" size={18} /> Скачать приложение для съёмки
          </a>
        )}
        {!pano && onUploadPanorama && (
          <button type="button" className="btn btn-secondary" onClick={() => onUploadPanorama(point.id)}>
            <Icon name="pano" size={18} /> Загрузить готовую панораму
          </button>
        )}
        {pano && (
          <button type="button" className="btn btn-secondary btn-danger-text" onClick={() => setConfirm('pano')}>
            <Icon name="trash" size={18} /> Удалить панораму
          </button>
        )}
        <button type="button" className="btn btn-danger" onClick={() => setConfirm('point')}>
          <Icon name="trash" size={18} /> Убрать точку
        </button>
      </div>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// ── Помещение ──

function UnitPanel({ doc, unit, onSelect, onCommit, onToast }: InspectorProps & { unit: Unit }) {
  const rect = isAxisRect(unit.polygon);
  const b = polygonBounds(unit.polygon);
  const doors = doc.openings.filter((o) => (o.units as readonly string[]).includes(unit.id));
  const connected = new Set(doors.flatMap((o) => [...o.units]));
  const near = neighbours(doc, unit.id);
  const inside = doc.places.filter((p) => p.level === unit.level && pointInUnit(p.pos, unit));
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
          Площадь <b>{fmt(unitArea(doc, unit))} м²</b>
          {rect ? ' · левый нижний угол на месте' : ' · форму меняйте ручками на плане'}
        </p>
        {(unit.holes?.length ?? 0) > 0 && (
          <ul className="insp-list">
            {unit.holes!.map((h, i) => {
              const hb = polygonBounds(h);
              return (
                <li key={i}>
                  <button type="button" className="insp-row" onClick={() => onSelect({ kind: 'hole', id: `${unit.id}#${i}` })}>
                    <Icon name="hole" size={18} />
                    <span className="insp-row-text">
                      <strong>Вырез {i + 1}</strong>
                      <small>
                        {fmt(hb.maxX - hb.minX)} × {fmt(hb.maxY - hb.minY)} м
                      </small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
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
                    const placed = placeDoor(doc, unit.id, n.id);
                    if (!placed) return onToast('На общей стене нет места для двери');
                    onCommit(rebuildGraph(placed.doc, unit.level), { kind: 'unit', id: unit.id });
                    onToast(`Дверь в «${n.name}» добавлена по центру стены`);
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

const PLACE_PANO_REASON: Record<PlacePanorama['reason'], string> = {
  marker: 'Место отмечено в этой панораме.',
  node: 'Панорама снята у самого места.',
  room: 'Ближайшая панорама в этом помещении.',
  visible: 'Место видно из этой панорамы.',
};

function PlacePanel({ doc, place, onSelect, onCommit, onToast, onOpenPanorama, onShootForPlace, onUploadForPlace }: InspectorProps & { place: Place }) {
  const cat = doc.categories.find((c) => c.id === place.category);
  const placePano = panoramaForPlace(doc, place);
  const patch = (p: Parameters<typeof updatePlace>[2]) => onCommit(updatePlace(doc, place.id, p), { kind: 'place', id: place.id });
  const [confirm, setConfirm] = useState<'place' | 'pano' | null>(null);
  // Панорама снята не у самого места — её же показывают и другим местам рядом.
  const sharedPano = placePano?.reason === 'room' || placePano?.reason === 'visible';
  return (
    <div className="insp">
      {confirm === 'place' && (
        <ConfirmDialog
          title={`Удалить место «${place.name}»?`}
          confirmLabel="Удалить место"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            onCommit(rebuildGraph(deletePlace(doc, place.id), place.level), null);
            onToast(`«${place.name}» удалено`);
          }}
        >
          <p>Место пропадёт с плана, из поиска и из меток в панорамах.{placePano ? ' Сама панорама останется на карте.' : ''}</p>
          <p className="hint">Передумаете — «Отменить» вверху.</p>
        </ConfirmDialog>
      )}
      {confirm === 'pano' && placePano && (
        <ConfirmDialog
          title="Удалить панораму?"
          confirmLabel="Удалить панораму"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            onCommit(rebuildGraph(deletePanorama(doc, placePano.panorama.id), placePano.panorama.level), { kind: 'place', id: place.id });
            onToast('Панорама удалена, место осталось');
          }}
        >
          <p>
            Место «{place.name}» останется — пропадёт только панорама: из его карточки
            {sharedPano ? ', из карточек других мест рядом (она снята не у самого места)' : ''} и из переходов соседних панорам.
          </p>
          <p className="hint">Передумаете — «Отменить» вверху.</p>
        </ConfirmDialog>
      )}
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
      <Section title="Панорама">
        {placePano ? (
          <>
            <button
              type="button"
              className="pano-preview"
              onClick={() => onOpenPanorama(placePano.panorama.id, placePano.yaw ?? undefined)}
              aria-label={`Открыть панораму: ${place.name}`}
            >
              <img src={panoramaUrls(placePano.panorama).preview} alt="" loading="lazy" decoding="async" />
              <span className="pano-preview-label">
                <Icon name="pano" size={17} /> Открыть панораму
              </span>
            </button>
            <p className="insp-note">{PLACE_PANO_REASON[placePano.reason]} Посетитель увидит эту панораму в карточке места.</p>
            <button type="button" className="btn btn-secondary btn-danger-text insp-wide" onClick={() => setConfirm('pano')}>
              <Icon name="trash" size={17} /> Удалить панораму
            </button>
          </>
        ) : (
          <>
            <p className="insp-note">Панорамы у места пока нет. Снимите фотосферу прямо здесь — она появится в карточке места у посетителей.</p>
            <div className="insp-stack">
              {onShootForPlace ? (
                <button type="button" className="btn btn-success" onClick={() => onShootForPlace(place.id)}>
                  <Icon name="camera" size={18} /> Снять фотосферу
                </button>
              ) : (
                onUploadForPlace &&
                isAndroid() && (
                  <a className="btn btn-secondary" href={APP_APK_URL}>
                    <Icon name="download" size={18} /> Скачать приложение для съёмки
                  </a>
                )
              )}
              {onUploadForPlace && (
                <button type="button" className="btn btn-secondary" onClick={() => onUploadForPlace(place.id)}>
                  <Icon name="pano" size={18} /> Загрузить готовую панораму
                </button>
              )}
              {!onUploadForPlace && <p className="insp-note">Снимать и загружать панорамы можно в площадке из кабинета.</p>}
            </div>
          </>
        )}
      </Section>
      <div className="insp-actions">
        <button type="button" className="btn btn-danger" onClick={() => setConfirm('place')}>
          <Icon name="trash" size={18} /> Удалить место
        </button>
      </div>
    </div>
  );
}

// ── Вырез ──

function HolePanel({ doc, unit, index, onSelect, onCommit, onToast }: InspectorProps & { unit: Unit; index: number }) {
  const hole = unit.holes![index]!;
  const b = polygonBounds(hole);
  const select = { kind: 'hole' as const, id: `${unit.id}#${index}` };
  const resize = (w: number, h: number) => {
    const r = setHolePolygon(doc, unit.id, index, rectPolygon([b.minX, b.minY], [b.minX + w, b.minY + h]));
    if (r.ok) onCommit(r.doc, select);
    else onToast(r.message);
  };
  return (
    <div className="insp">
      <PanelHead icon={<span className="swatch lg hole-swatch"><Icon name="hole" size={18} /></span>} kicker="Вырез" title={`в «${unit.name}»`} onClose={() => onSelect({ kind: 'unit', id: unit.id })} />
      <Section title="Размер">
        {isAxisRect(hole) && (
          <div className="field-row">
            <NumberField label="Ширина, м" value={b.maxX - b.minX} step={0.1} onCommit={(w) => resize(w, b.maxY - b.minY)} />
            <NumberField label="Глубина, м" value={b.maxY - b.minY} step={0.1} onCommit={(h) => resize(b.maxX - b.minX, h)} />
          </div>
        )}
        <p className="insp-note">
          Внутри выреза нет помещения: пройти нельзя, место не поставить, маршрут обходит его. Узкий вырез (10–20 см) работает как
          перегородка. Тяните вырез на плане, чтобы сдвинуть.
        </p>
      </Section>
      <div className="insp-actions">
        <button type="button" className="btn btn-danger" onClick={() => onCommit(deleteHole(doc, unit.id, index), { kind: 'unit', id: unit.id })}>
          <Icon name="trash" size={18} /> Убрать вырез
        </button>
      </div>
    </div>
  );
}

// ── Дверь ──

const DOOR_TYPES: { value: DoorType; label: string }[] = [
  { value: 'single', label: 'Дверь' },
  { value: 'double', label: 'Двустворчатая' },
  { value: 'passage', label: 'Проём' },
];

const DOOR_ANGLES: { value: number; label: string }[] = [
  { value: 90, label: 'Открыта' },
  { value: 45, label: 'Приоткрыта' },
  { value: 0, label: 'Закрыта' },
];

const nearestAngle = (deg: number) => DOOR_ANGLES.reduce((a, b) => (Math.abs(b.value - deg) < Math.abs(a.value - deg) ? b : a)).value;

/** Настройки новой двери: пока выбран инструмент «Дверь», каждая новая дверь ставится такой. */
function DoorPresetPanel({ doorPreset, onDoorPreset, onExitTool }: InspectorProps) {
  const style: DoorStyle | null =
    doorPreset.type === 'passage' ? null : { leaves: doorPreset.type === 'double' ? 2 : 1, swing: 1, hinge: 'start', openAngle: doorPreset.openAngle };
  return (
    <div className="insp">
      <PanelHead icon={<span className="swatch lg door"><Icon name="doorAdd" size={18} /></span>} kicker="Инструмент «Дверь»" title="Новая дверь" onClose={onExitTool} />
      <Section>
        <DoorGlyph style={style} width={doorPreset.type === 'double' ? 1.6 : doorPreset.type === 'passage' ? 1.2 : 0.9} />
        <Choice label="Тип" value={doorPreset.type} options={DOOR_TYPES} onChange={(type) => onDoorPreset({ ...doorPreset, type })} />
        {doorPreset.type !== 'passage' && (
          <Choice label="Створка" value={doorPreset.openAngle} options={DOOR_ANGLES} onChange={(openAngle) => onDoorPreset({ ...doorPreset, openAngle })} />
        )}
        <p className="insp-note">
          Нажмите на общую стену двух помещений — дверь встанет по центру свободной части стены и откроется в меньшее помещение. Потом края можно тянуть.
        </p>
      </Section>
    </div>
  );
}

function OpeningPanel({ doc, opening, onSelect, onCommit, onToast }: InspectorProps & { opening: Opening }) {
  const names = opening.units.map((id) => doc.units.find((u) => u.id === id)?.name ?? '—');
  const len = Math.hypot(opening.segment[1][0] - opening.segment[0][0], opening.segment[1][1] - opening.segment[0][1]);
  const type = doorTypeOf(opening);
  const style = doorStyleOf(doc, opening);
  const sides = openingSides(doc, opening);
  const select = { kind: 'opening' as const, id: opening.id };
  // Середина и ширина двери влияют на узлы маршрута — граф строим заново.
  const commit = (next: MapDocument) => {
    if (next === doc) return onToast('Здесь больше нет места — дверь упёрлась в угол или соседнюю дверь');
    onCommit(rebuildGraph(next, opening.level), select);
  };
  return (
    <div className="insp">
      <PanelHead
        icon={<span className="swatch lg door"><Icon name="doorAdd" size={18} /></span>}
        kicker={opening.kind === 'entrance' ? 'Вход с улицы' : type === 'passage' ? 'Проём' : 'Дверь'}
        title={names.join(' ↔ ')}
        onClose={() => onSelect(null)}
      />
      <Section>
        <DoorGlyph style={style} width={len} />
        <Choice label="Тип" value={type} options={DOOR_TYPES} onChange={(t) => commit(setDoorType(doc, opening.id, t))} />
        {style && (
          <>
            <Choice label="Створка" value={nearestAngle(style.openAngle)} options={DOOR_ANGLES} onChange={(openAngle) => commit(updateDoorStyle(doc, opening.id, { openAngle }))} />
            <Choice
              label="Открывается"
              value={style.swing}
              options={sides.map((s) => ({ value: s.side, label: s.unit ? `в «${s.unit.name}»` : 'наружу' }))}
              onChange={(swing) => commit(updateDoorStyle(doc, opening.id, { swing }))}
            />
            {style.leaves === 1 && (
              <button
                type="button"
                className="btn btn-secondary insp-wide"
                onClick={() => commit(updateDoorStyle(doc, opening.id, { hinge: style.hinge === 'start' ? 'end' : 'start' }))}
              >
                <Icon name="swap" size={17} /> Петли с другой стороны
              </button>
            )}
          </>
        )}
      </Section>
      <Section title="Ширина">
        <NumberField label="Ширина, м" value={len} step={0.05} digits={2} onCommit={(w) => commit(setOpeningWidth(doc, opening.id, w))} />
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={() => commit(centerOpening(doc, opening.id))}>
            По центру стены
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => commit(fillOpening(doc, opening.id))}>
            На всю стену
          </button>
        </div>
        <p className="insp-note">Тяните круглые ручки на краях двери, чтобы растянуть её, или саму дверь — чтобы сдвинуть вдоль стены.</p>
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

/** Число с шагом step (по умолчанию 0,5 м — размеры помещений), digits — знаков после запятой на экране. */
function NumberField(props: { label: string; value: number; onCommit: (v: number) => void; step?: number; digits?: number }) {
  const step = props.step ?? 0.5;
  const show = (n: number) => fmt(n, props.digits);
  const [draft, setDraft] = useState(show(props.value));
  useEffect(() => setDraft(show(props.value)), [props.value]);
  const commit = () => {
    const v = Number(draft.replace(',', '.'));
    if (Number.isFinite(v) && Math.abs(v - props.value) > 1e-6) props.onCommit(Math.round(v / step) * step);
    else setDraft(show(props.value));
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

/** Несколько вариантов в одну строку — быстрее выпадающего списка на телефоне. */
function Choice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="segmented insp-seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => o.value !== value && onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Рисунок двери, как она выглядит на плане: стена, проём, створки и дуга открывания. */
function DoorGlyph({ style, width }: { style: DoorStyle | null; width: number }) {
  const W = 220;
  const H = 96;
  const k = Math.min(70 / Math.max(width, 0.3), 90); // пикселей на метр
  const half = (width * k) / 2;
  const cx = W / 2;
  const wallY = 66;
  // Створки считаем тем же кодом, что и план: проём вдоль оси x, открывается «вверх» на рисунке.
  const opening: Opening = { id: 'glyph', level: '', kind: style ? 'door' : 'passage', segment: [[-width / 2, 0], [width / 2, 0]], units: ['a'] };
  const leaves = style ? doorLeaves(opening, style) : [];
  const toSvg = (p: [number, number]) => [cx + p[0] * k, wallY - p[1] * k] as const;
  return (
    <svg className="door-glyph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={style ? 'Вид двери на плане' : 'Проём без двери'}>
      <line x1={8} y1={wallY} x2={cx - half} y2={wallY} className="dg-wall" />
      <line x1={cx + half} y1={wallY} x2={W - 8} y2={wallY} className="dg-wall" />
      <line x1={cx - half} y1={wallY - 6} x2={cx - half} y2={wallY + 6} className="dg-jamb" />
      <line x1={cx + half} y1={wallY - 6} x2={cx + half} y2={wallY + 6} className="dg-jamb" />
      {leaves.map((leaf, i) => {
        const [hx, hy] = toSvg(leaf.hinge);
        const [ox, oy] = toSvg(leaf.openTip);
        const [cxs, cys] = toSvg(leaf.closedTip);
        const r = leaf.length * k;
        const sweepFlag = (leaf.closedTip[0] - leaf.hinge[0]) * (leaf.openTip[1] - leaf.hinge[1]) > 0 ? 0 : 1;
        return (
          <g key={i}>
            {style!.openAngle > 1 && <path d={`M ${cxs} ${cys} A ${r} ${r} 0 0 ${sweepFlag} ${ox} ${oy}`} className="dg-arc" />}
            <line x1={hx} y1={hy} x2={ox} y2={oy} className="dg-leaf" />
          </g>
        );
      })}
      <text x={cx} y={H - 6} textAnchor="middle" className="dg-label">
        {fmt(width, 2)} м
      </text>
    </svg>
  );
}

function fmt(n: number, digits = 1): string {
  const k = 10 ** digits;
  return (Math.round(n * k) / k).toLocaleString('ru-RU');
}

function unitArea(doc: MapDocument, unit: Unit): number {
  const childArea = doc.units.filter((candidate) => candidate.parent === unit.id).reduce((sum, child) => sum + polygonArea(child.polygon), 0);
  return Math.max(0, polygonArea(unit.polygon) - childArea);
}
