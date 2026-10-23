// Редактор демо-площадки: помещения, места и двери. Пока нет сервера — сохраняет в браузер,
// и карта посетителя `/m/demo` в этом же браузере сразу показывает изменения.
import { deleteOpening, deletePlace, deleteUnit, rebuildGraph, refreshPanoramaMarkers, translateUnit, overlappingUnits, validateReferences, type MapDocument } from '@space-map/map-core';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { builtInDemo } from '../api.ts';
import { clearEditedDemo, loadEditedDemo, saveEditedDemo } from '../demoStore.ts';
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';
import { Icon, type IconName } from '../ui/icons.tsx';
import { Sheet, useMediaQuery, type SheetMode } from '../ui/Sheet.tsx';
import { EditorCanvas, type Selection, type Tool } from './EditorCanvas.tsx';
import { Inspector } from './Inspector.tsx';
import { useHistory } from './useHistory.ts';

const Model3DView = lazy(() => import('../three/Model3DView.tsx'));

const TOOLS: { id: Tool; icon: IconName; label: string; key: string }[] = [
  { id: 'select', icon: 'cursor', label: 'Выбор', key: 'V' },
  { id: 'room', icon: 'square', label: 'Комната', key: 'R' },
  { id: 'place', icon: 'pin', label: 'Место', key: 'P' },
  { id: 'door', icon: 'doorAdd', label: 'Дверь', key: 'D' },
];

const TOOL_HINT: Record<Tool, string> = {
  select: 'Нажмите на помещение, место или дверь. Тяните, чтобы сдвинуть.',
  room: 'Протяните прямоугольник на свободном месте плана',
  place: 'Нажмите внутри помещения, чтобы поставить место',
  door: 'Нажмите на общую стену двух помещений',
};

export default function EditorPage() {
  const desktop = useMediaQuery('(min-width: 900px)');
  const history = useHistory<MapDocument>(() => loadEditedDemo() ?? builtInDemo());
  const { doc } = history;
  const level = doc.levels[0]?.id ?? 'L1';
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<Selection>(null);
  const [view, setView] = useState<'plan' | '3d'>('plan');
  const [showGraph, setShowGraph] = useState(false);
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  const [saved, setSaved] = useState<'saved' | 'error' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>('peek');
  const [sheetHeight, setSheetHeight] = useState(0);
  const [fitKey, setFitKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const firstSave = useRef(true);

  const showToast = useCallback((text: string) => setToast({ text, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // Автосохранение в браузер после каждой правки (и после отмены).
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    setSaved(saveEditedDemo(doc) ? 'saved' : 'error');
  }, [doc]);

  const commit = useCallback(
    (next: MapDocument, select?: Selection) => {
      const withMarkers = refreshPanoramaMarkers(next);
      history.commit(withMarkers);
      if (select !== undefined) setSelection(select);
    },
    [history.commit],
  );

  const select = (s: Selection) => {
    setSelection(s);
    if (!desktop) setSheetMode(s ? 'auto' : 'peek');
  };

  // Выбор пропал после отмены — снимаем.
  useEffect(() => {
    if (!selection) return;
    const exists =
      selection.kind === 'unit'
        ? doc.units.some((u) => u.id === selection.id)
        : selection.kind === 'place'
          ? doc.places.some((p) => p.id === selection.id)
          : doc.openings.some((o) => o.id === selection.id);
    if (!exists) setSelection(null);
  }, [doc, selection]);

  // Клавиши: инструменты, отмена, удаление, стрелки.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        history.redo();
        return;
      }
      if (mod) return;
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase() || x.key === layoutKey(e.key));
      if (t) return setTool(t.id);
      if (e.key === 'Escape') {
        setTool('select');
        setSelection(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault();
        const next =
          selection.kind === 'unit'
            ? deleteUnit(doc, selection.id)
            : selection.kind === 'place'
              ? rebuildGraph(deletePlace(doc, selection.id), level)
              : rebuildGraph(deleteOpening(doc, selection.id), level);
        commit(next, null);
        return;
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-0.5, 0], ArrowRight: [0.5, 0], ArrowUp: [0, 0.5], ArrowDown: [0, -0.5] };
      const delta = arrows[e.key];
      if (delta && selection?.kind === 'unit') {
        e.preventDefault();
        const next = translateUnit(doc, selection.id, delta);
        const unit = next.units.find((u) => u.id === selection.id);
        if (unit && overlappingUnits(next, level, unit.polygon, unit.id).length === 0) commit(next, selection);
        else showToast('Помещения не должны пересекаться');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history.undo, history.redo, doc, selection, commit, level]);

  const download = () => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'demo-venue.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMenu(false);
  };

  const importFile = async (file: File) => {
    try {
      const next = JSON.parse(await file.text()) as MapDocument;
      const issues = next?.schema === 2 ? validateReferences(next) : [{ path: '', message: 'не карта' }];
      if (issues.length > 0) return showToast('Файл не похож на карту площадки');
      history.reset(next);
      setSaved(saveEditedDemo(next) ? 'saved' : 'error');
      setSelection(null);
      setFitKey((k) => k + 1);
      showToast('Карта загружена из файла');
    } catch {
      showToast('Не удалось прочитать файл');
    }
  };

  const reset = () => {
    clearEditedDemo();
    history.reset(builtInDemo());
    setSelection(null);
    setConfirmReset(false);
    setSaved(null);
    setFitKey((k) => k + 1);
    showToast('Демо-площадка восстановлена');
  };

  const toolbar = (
    <div className={`tool-bar ${desktop ? 'vertical' : ''}`} role="toolbar" aria-label="Инструменты">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          className="tool-btn"
          aria-pressed={tool === t.id}
          title={`${t.label} (${t.key})`}
          onClick={() => {
            setTool(t.id);
            if (view === '3d') setView('plan');
          }}
        >
          <Icon name={t.icon} size={21} />
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );

  const insets = desktop ? { top: 76, left: 96, right: 372, bottom: 0 } : { top: 64, bottom: sheetHeight };

  const menuItems: { icon: IconName; label: string; onClick: () => void; pressed?: boolean; danger?: boolean }[] = [
    ...(desktop ? [] : [{ icon: (view === 'plan' ? 'cube' : 'map') as IconName, label: view === 'plan' ? 'Показать в 3D' : 'Вернуться к плану', onClick: () => setView(view === 'plan' ? '3d' : 'plan') }]),
    { icon: 'layers', label: 'Сетка маршрутов', onClick: () => setShowGraph((g) => !g), pressed: showGraph },
    { icon: 'download', label: 'Скачать карту (JSON)', onClick: download },
    { icon: 'external', label: 'Загрузить карту из файла', onClick: () => fileRef.current?.click() },
    { icon: 'reset', label: 'Сбросить демо', onClick: () => setConfirmReset(true), danger: true },
  ];

  return (
    <div className={`editor ${desktop ? 'is-desktop' : 'is-mobile'}`}>
      <main className="editor-stage">
        {view === 'plan' ? (
          <EditorCanvas
            doc={doc}
            level={level}
            tool={tool}
            selection={selection}
            showGraph={showGraph}
            placeCategory={doc.categories.find((c) => c.id === 'room')?.id ?? doc.categories[0]?.id ?? ''}
            insets={insets}
            fitKey={fitKey}
            onSelect={select}
            onCommit={(next, s) => {
              commit(next, s);
              if (s && !desktop) setSheetMode('auto');
            }}
            onToolDone={() => setTool('select')}
            onToast={showToast}
          />
        ) : (
          <ErrorBoundary fallback={<div className="screen-message">Не удалось загрузить 3D.</div>}>
            <Suspense fallback={<div className="screen-message"><div className="loader" /></div>}>
              <Model3DView doc={doc} level={level} insets={insets} selectedPlace={selection?.kind === 'place' ? selection.id : null} />
            </Suspense>
          </ErrorBoundary>
        )}
        {view === 'plan' && <div className="tool-hint" style={desktop ? { left: 112, top: 88 } : { top: 70 }}>{TOOL_HINT[tool]}</div>}
      </main>

      <header className="editor-top">
        <Link to="/m/demo" className="icon-btn" aria-label="К карте посетителя" title="К карте посетителя">
          <Icon name="back" />
        </Link>
        <div className="editor-title">
          <strong>{desktop ? 'Редактор площадки' : 'Редактор'}</strong>
          <small>
            {saved === 'saved' ? (
              <>
                <Icon name="check" size={13} /> Сохранено в браузере
              </>
            ) : saved === 'error' ? (
              'Не удалось сохранить'
            ) : (
              doc.venue.name
            )}
          </small>
        </div>
        <div className="editor-top-actions">
          <button type="button" className="icon-btn" aria-label="Отменить" title="Отменить (⌘Z)" disabled={!history.canUndo} onClick={history.undo}>
            <Icon name="undo" />
          </button>
          <button type="button" className="icon-btn" aria-label="Повторить" title="Повторить (⇧⌘Z)" disabled={!history.canRedo} onClick={history.redo}>
            <Icon name="redo" />
          </button>
          {desktop && (
          <div className="segmented compact" role="group" aria-label="Вид">
            <button type="button" aria-pressed={view === 'plan'} onClick={() => setView('plan')}>
              <Icon name="map" size={17} />
              {desktop && <span>План</span>}
            </button>
            <button type="button" aria-pressed={view === '3d'} onClick={() => setView('3d')}>
              <Icon name="cube" size={17} />
              {desktop && <span>3D</span>}
            </button>
          </div>
          )}
          {desktop &&
            menuItems.filter((m) => !m.danger).map((m) => (
              <button key={m.label} type="button" className="icon-btn" title={m.label} aria-label={m.label} aria-pressed={m.pressed} onClick={m.onClick}>
                <Icon name={m.icon} />
              </button>
            ))}
          {desktop ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(true)}>
                Сбросить
              </button>
              <Link to="/m/demo" className="btn btn-primary">
                <Icon name="eye" size={18} /> Карта посетителя
              </Link>
            </>
          ) : (
            <div className="menu-wrap">
              <button type="button" className="icon-btn" aria-label="Ещё" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                <Icon name="more" />
              </button>
              {menu && (
                <>
                  <div className="menu-scrim" onClick={() => setMenu(false)} />
                  <div className="menu" role="menu">
                    {menuItems.map((m) => (
                      <button
                        key={m.label}
                        type="button"
                        role="menuitem"
                        className={`menu-item ${m.danger ? 'danger' : ''}`}
                        aria-pressed={m.pressed}
                        onClick={() => {
                          m.onClick();
                          setMenu(false);
                        }}
                      >
                        <Icon name={m.icon} size={18} />
                        {m.label}
                        {m.pressed !== undefined && <span className={`menu-check ${m.pressed ? 'on' : ''}`}><Icon name="check" size={16} /></span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {desktop ? (
        <>
          <div className="tool-rail">{toolbar}</div>
          <aside className="inspector" aria-label="Свойства">
            <Inspector doc={doc} level={level} selection={selection} onSelect={select} onCommit={commit} onToast={showToast} />
          </aside>
        </>
      ) : (
        <Sheet mode={sheetMode} onModeChange={setSheetMode} desktop={false} peekHeight={118} topGap={64} onHeight={setSheetHeight} label="Инструменты и свойства" header={toolbar}>
          <Inspector doc={doc} level={level} selection={selection} onSelect={select} onCommit={commit} onToast={showToast} />
        </Sheet>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = '';
        }}
      />

      {toast && (
        <div key={toast.id} className="toast" role="status" style={!desktop ? { bottom: sheetHeight + 16 } : undefined}>
          {toast.text}
        </div>
      )}

      {confirmReset && (
        <Modal onClose={() => setConfirmReset(false)}>
          <h2>Сбросить изменения?</h2>
          <p>Демо-площадка вернётся к исходному виду. Ваши комнаты и места из этого браузера пропадут.</p>
          <div className="row end">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(false)}>
              Отмена
            </button>
            <button type="button" className="btn btn-danger" onClick={reset}>
              Сбросить
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/** Горячие клавиши работают и в русской раскладке: м → V, к → R, з → P, в → D. */
function layoutKey(key: string): string | undefined {
  return ({ м: 'V', к: 'R', з: 'P', в: 'D' } as Record<string, string>)[key.toLowerCase()];
}
