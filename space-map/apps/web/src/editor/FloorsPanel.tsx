// Этажи площадки и готовый план картинкой (подложка): загрузить, подогнать масштаб, распознать комнаты.
import {
  addLevel,
  applyRecognizedPlan,
  deleteLevel,
  moveLevel,
  renameLevel,
  setUnderlay,
  sortedLevels,
  type MapDocument,
  type RecognizedPlan,
  type Underlay,
} from '@space-map/map-core';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, type UnderlayAsset } from '../api.ts';
import { levelBounds } from '../plan/viewport.ts';
import { ConfirmDialog } from '../ui/ConfirmDialog.tsx';
import { Icon } from '../ui/icons.tsx';
import { grayPixels, useImage } from '../ui/useImage.ts';
import { NumberField, Section, TextField } from './Inspector.tsx';

export interface UnderlayApi {
  upload: (file: File) => Promise<UnderlayAsset>;
  src: (asset: string) => string;
}

// ── Этажи ──

export function FloorsSection({ doc, level, onLevel, onCommit, onAdd }: { doc: MapDocument; level: string; onLevel: (id: string) => void; onCommit: (doc: MapDocument) => void; onAdd: () => void }) {
  const levels = sortedLevels(doc);
  const current = doc.levels.find((l) => l.id === level);
  const index = levels.findIndex((l) => l.id === level);
  const [confirm, setConfirm] = useState(false);
  if (!current) return null;
  const units = doc.units.filter((u) => u.level === level).length;
  const places = doc.places.filter((p) => p.level === level).length;
  return (
    <Section title={levels.length > 1 ? `Этажи · ${levels.length}` : 'Этажи'}>
      {levels.length > 1 && (
        <div className="level-chips" role="group" aria-label="Этаж">
          {[...levels].reverse().map((l) => (
            <button key={l.id} type="button" className="chip" aria-pressed={l.id === level} onClick={() => onLevel(l.id)}>
              {l.name || 'Без названия'}
            </button>
          ))}
        </div>
      )}
      <TextField label="Название этажа" value={current.name} onCommit={(name) => onCommit(renameLevel(doc, level, name))} />
      <div className="row wrap">
        <button type="button" className="btn btn-secondary" onClick={onAdd}>
          <Icon name="plus" size={17} /> Добавить этаж
        </button>
        {levels.length > 1 && (
          <>
            <button type="button" className="icon-btn" aria-label="Выше" title="Поменять с этажом выше" disabled={index === levels.length - 1} onClick={() => onCommit(moveLevel(doc, level, 1))}>
              <Icon name="chevronUp" />
            </button>
            <button type="button" className="icon-btn" aria-label="Ниже" title="Поменять с этажом ниже" disabled={index === 0} onClick={() => onCommit(moveLevel(doc, level, -1))}>
              <Icon name="chevronDown" />
            </button>
            <button type="button" className="icon-btn danger" aria-label="Удалить этаж" title="Удалить этаж" onClick={() => setConfirm(true)}>
              <Icon name="trash" />
            </button>
          </>
        )}
      </div>
      {levels.length > 1 && <p className="hint">Лестницы и лифты, стоящие друг над другом на соседних этажах, соединяют этажи в маршрутах.</p>}
      {confirm && (
        <ConfirmDialog
          title={`Удалить «${current.name}»?`}
          confirmLabel="Удалить этаж"
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            const next = deleteLevel(doc, level);
            onLevel(sortedLevels(next)[Math.max(0, index - 1)]!.id);
            onCommit(next);
          }}
        >
          <p>Удалятся помещения ({units}), места ({places}), двери и панорамы этого этажа.</p>
          <p className="hint">Передумаете — «Отменить» вверху.</p>
        </ConfirmDialog>
      )}
    </Section>
  );
}

/** Новый этаж: пустой или копия плана текущего (стены у этажей одного здания обычно те же), выше всех или подвал. */
export function AddLevelDialog({ doc, level, onCommit, onLevel, onClose }: { doc: MapDocument; level: string; onCommit: (doc: MapDocument) => void; onLevel: (id: string) => void; onClose: () => void }) {
  const current = doc.levels.find((l) => l.id === level);
  const hasPlan = doc.units.some((u) => u.level === level);
  const [copy, setCopy] = useState(hasPlan);
  const [below, setBelow] = useState(false);
  const [name, setName] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const add = () => {
    const r = addLevel(doc, { name, below, copyFrom: copy ? level : undefined });
    onCommit(r.doc);
    onLevel(r.id);
    onClose();
  };
  return createPortal(
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Новый этаж" onClick={(e) => e.stopPropagation()}>
        <h2>Новый этаж</h2>
        <label className="field">
          <span>Название</span>
          <input value={name} placeholder={below ? 'Например, «Цокольный»' : 'Например, «2 этаж»'} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <div className="segmented" role="group" aria-label="План этажа">
          <button type="button" aria-pressed={!copy} onClick={() => setCopy(false)}>
            Пустой
          </button>
          <button type="button" aria-pressed={copy} disabled={!hasPlan} onClick={() => setCopy(true)}>
            Копия «{current?.name}»
          </button>
        </div>
        <div className="segmented" role="group" aria-label="Где">
          <button type="button" aria-pressed={!below} onClick={() => setBelow(false)}>
            Выше всех
          </button>
          <button type="button" aria-pressed={below} onClick={() => setBelow(true)}>
            Ниже всех
          </button>
        </div>
        <p className="hint">{copy ? 'Скопируются помещения и двери — останется поправить отличия. Места и панорамы не копируются.' : 'Нарисуйте план с нуля или загрузите его картинкой.'}</p>
        <div className="row end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="btn btn-primary" onClick={add}>
            Добавить
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Готовый план картинкой ──

export function UnderlaySection({
  doc,
  level,
  api,
  moving,
  onMove,
  onCommit,
  onToast,
}: {
  doc: MapDocument;
  level: string;
  /** Нет — демо без сервера: картинку некуда загрузить. */
  api?: UnderlayApi;
  moving: boolean;
  onMove: (on: boolean) => void;
  onCommit: (doc: MapDocument) => void;
  onToast: (message: string) => void;
}) {
  const underlay = doc.levels.find((l) => l.id === level)?.underlay ?? null;
  const image = useImage(api && underlay ? api.src(underlay.asset) : null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'recognize' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const hasPlan = doc.units.some((u) => u.level === level);

  if (!api) {
    return (
      <Section title="Готовый план">
        <p className="hint">Загрузить план картинкой и распознать комнаты можно в площадке из кабинета.</p>
      </Section>
    );
  }

  const upload = async (file: File) => {
    setBusy('upload');
    try {
      const asset = await api.upload(file);
      // Масштаб на глаз: картинка по ширине нарисованного плана, без плана — 40 м. Точнее — полем «Ширина».
      const b = levelBounds(doc, level);
      const widthM = hasPlan ? Math.max(5, b.maxX - b.minX) : 40;
      const pxPerM = asset.width / widthM;
      const next: Underlay = { asset: asset.asset, pxPerM, origin: hasPlan ? [b.minX, b.maxY] : [0, asset.height / pxPerM], rotation: 0, opacity: 0.6 };
      onCommit(setUnderlay(doc, level, next));
      onToast('План загружен. Укажите его ширину в метрах, затем — «Распознать комнаты» или обведите вручную');
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Не удалось загрузить картинку');
    } finally {
      setBusy(null);
    }
  };

  const recognize = async () => {
    if (!underlay || !image) return;
    setBusy('recognize');
    try {
      const pixels = grayPixels(image);
      const plan = await new Promise<RecognizedPlan>((resolve, reject) => {
        const worker = new Worker(new URL('./recognize.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent<{ ok: true; plan: RecognizedPlan } | { ok: false; message: string }>) => {
          worker.terminate();
          if (e.data.ok) resolve(e.data.plan);
          else reject(new Error(e.data.message));
        };
        worker.onerror = (e) => {
          worker.terminate();
          reject(new Error(e.message));
        };
        worker.postMessage({ ...pixels, pxPerM: underlay.pxPerM }, [pixels.gray.buffer]);
      });
      if (plan.rooms.length === 0) {
        onToast('Комнаты не нашлись. Проверьте ширину плана в метрах: от неё зависит, что считать дверью');
        return;
      }
      const r = applyRecognizedPlan(doc, level, plan, underlay.origin);
      onCommit(r.doc);
      onToast(`Распознано: помещений — ${r.rooms}, дверей — ${r.doors}. Проверьте и поправьте, что не так`);
    } catch {
      onToast('Не удалось распознать план');
    } finally {
      setBusy(null);
    }
  };

  const widthM = underlay && image ? image.naturalWidth / underlay.pxPerM : null;
  const heightM = underlay && image ? image.naturalHeight / underlay.pxPerM : null;
  const patch = (p: Partial<Underlay>) => underlay && onCommit(setUnderlay(doc, level, { ...underlay, ...p }));

  return (
    <Section title="Готовый план">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = '';
        }}
      />
      {!underlay ? (
        <>
          <p className="hint">Картинка поэтажного плана: обведите комнаты поверх неё или распознайте их автоматически.</p>
          <button type="button" className="btn btn-secondary insp-wide" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
            <Icon name="image" size={18} /> {busy === 'upload' ? 'Загружаем…' : 'Загрузить план картинкой'}
          </button>
        </>
      ) : (
        <>
          {widthM !== null && heightM !== null ? (
            <>
              <NumberField label="Ширина плана, м — реальная, по размерам на плане" value={widthM} step={0.1} onCommit={(w) => w > 0 && patch({ pxPerM: image!.naturalWidth / w })} />
              <p className="insp-meta">
                Высота — {heightM.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} м · картинка {image!.naturalWidth} × {image!.naturalHeight} px
              </p>
            </>
          ) : (
            <p className="hint">Загружаем картинку…</p>
          )}
          <label className="field">
            <span>Прозрачность · {Math.round((1 - underlay.opacity) * 100)}%</span>
            <input type="range" min={0.15} max={1} step={0.05} value={underlay.opacity} onChange={(e) => patch({ opacity: Number(e.target.value) })} />
          </label>
          <button type="button" className="btn btn-primary insp-wide" disabled={busy !== null || !image} onClick={() => (hasPlan ? setConfirm(true) : void recognize())}>
            <Icon name="sparkle" size={18} /> {busy === 'recognize' ? 'Распознаём…' : 'Распознать комнаты и двери'}
          </button>
          <div className="row wrap">
            <button type="button" className={`btn ${moving ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={moving} onClick={() => onMove(!moving)}>
              <Icon name="move" size={17} /> {moving ? 'Готово' : 'Сдвинуть'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={17} /> Другая
            </button>
            <button
              type="button"
              className="btn btn-ghost danger"
              onClick={() => {
                onMove(false);
                onCommit(setUnderlay(doc, level, null));
              }}
            >
              Убрать
            </button>
          </div>
          <p className="hint">Распознавание ищет тёмные линии стен и разрывы в них до 1 м — это двери. Узкие коридоры (меньше 1 м) и двустворчатые двери стоит проверить.</p>
        </>
      )}
      {confirm && (
        <ConfirmDialog title="Заменить план этажа?" confirmLabel="Распознать и заменить" onCancel={() => setConfirm(false)} onConfirm={() => void recognize()}>
          <p>Помещения и двери этажа заменятся распознанными с картинки. Места и панорамы останутся на своих местах.</p>
          <p className="hint">Передумаете — «Отменить» вверху.</p>
        </ConfirmDialog>
      )}
    </Section>
  );
}
