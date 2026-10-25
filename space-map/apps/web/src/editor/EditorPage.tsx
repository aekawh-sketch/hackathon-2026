// Редактор площадки: помещения, места, двери и точки съёмки панорам.
// Площадка организатора хранится на сервере (автосохранение с ревизией, ТЗ 7.2);
// демо без сервера (`/app/editor`) — в браузере, и `/m/demo` в этом же браузере видит изменения, если API недоступен.
import {
  addPanoramaAtPoint,
  setPlacePanorama,
  capturePointForPlace,
  captureRoute,
  DEFAULT_DOOR_PRESET,
  deleteHole,
  deleteOpening,
  deletePlace,
  deleteUnit,
  rebuildGraph,
  refreshCapturePoints,
  refreshPanoramaMarkers,
  removeCapturePoint,
  sortedLevels,
  translateUnit,
  overlappingUnits,
  validateReferences,
  type DoorPreset,
  type MapDocument,
  type ShotPanorama,
} from '@space-map/map-core';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, builtInDemo, venuesApi, type VenueSummary } from '../api.ts';
import { clearEditedDemo, loadEditedDemo, saveEditedDemo } from '../demoStore.ts';
import { PublishDialog } from '../organizer/PublishDialog.tsx';
import { useSession } from '../organizer/session.tsx';
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';
import { Icon, type IconName } from '../ui/icons.tsx';
import { Sheet, useMediaQuery, type SheetMode } from '../ui/Sheet.tsx';
import { setTheme, ThemeToggle, useTheme } from '../ui/theme.tsx';
import { Tour, type TourStep } from '../ui/Tour.tsx';
import { LevelSwitch } from '../ui/LevelSwitch.tsx';
import { AddLevelDialog, type UnderlayApi } from './FloorsPanel.tsx';
import { EditorCanvas, holeRef, type Selection, type Tool } from './EditorCanvas.tsx';
import { Inspector } from './Inspector.tsx';
import { useHistory } from './useHistory.ts';
import { cancelText, captureNativeSphere, hasNativeCapture } from '../capture/native.ts';
import { PanoramaPreview } from './PanoramaPreview.tsx';
import { useServerSave, type SaveStatus } from './useServerSave.ts';

const Model3DView = lazy(() => import('../three/Model3DView.tsx'));
const CaptureGuide = lazy(() => import('../capture/CaptureGuide.tsx'));
const PhoneQrDialog = lazy(() => import('./PhoneQrDialog.tsx'));
const QrScanner = lazy(() => import('../ui/QrScanner.tsx'));

// `short` — короткая подпись для узких экранов; панель инструментов прокручивается при нехватке места.
const TOOLS: { id: Tool; icon: IconName; label: string; short?: string; key: string }[] = [
  { id: 'select', icon: 'cursor', label: 'Выбор', key: 'V' },
  { id: 'room', icon: 'square', label: 'Комната', key: 'R' },
  { id: 'zone', icon: 'zone', label: 'Зона', key: 'A' },
  { id: 'place', icon: 'pin', label: 'Место', key: 'P' },
  { id: 'door', icon: 'doorAdd', label: 'Дверь', key: 'D' },
  { id: 'wall', icon: 'wall', label: 'Стена', key: 'W' },
  { id: 'hole', icon: 'hole', label: 'Вырез', key: 'H' },
  { id: 'shot', icon: 'camera', label: 'Съёмка', key: 'C' },
];

const TOOL_HINT: Record<Tool, string> = {
  select: 'Нажмите на помещение, место или дверь. Тяните, чтобы сдвинуть.',
  room: 'Протяните прямоугольник на свободном месте или внутри зала',
  zone: 'Выберите категорию и протяните прямоугольник внутри помещения',
  place: 'Нажмите внутри помещения, чтобы поставить место',
  door: 'Нажмите на стену: общая стена — дверь между помещениями, наружная — вход с улицы',
  wall: 'Проведите линию — получится стена. От стены до стены — делит комнату на две',
  hole: 'Протяните прямоугольник внутри комнаты: колонна, шахта или перегородка',
  shot: 'Точки панорам рассчитаны по плану. Нажмите в помещении — своя точка; тяните точку, чтобы сдвинуть',
  underlay: 'Тяните картинку плана, чтобы совместить её с рисунком. Закончили — «Готово» в панели',
};

/** Обучение по кнопке «?»: по очереди каждая кнопка редактора и что она делает. Кнопок не на этом экране — пропуск. */
const TOUR: TourStep[] = [
  { target: '[data-tour="tool-select"]', title: 'Выбор', text: 'Нажмите на комнату, место или дверь — откроются её свойства. Тяните, чтобы сдвинуть.' },
  { target: '[data-tour="tool-room"]', title: 'Комната', text: 'Протяните прямоугольник — получится комната или коридор. Можно и внутри зала.' },
  { target: '[data-tour="tool-zone"]', title: 'Зона', text: 'Участок помещения со своей категорией: фудкорт, зона партнёров. Категорию выберите в панели.' },
  { target: '[data-tour="tool-place"]', title: 'Место', text: 'Нажмите внутри помещения — встанет место: стенд, стойка, вход, Wi-Fi. Название и описание — в свойствах.' },
  { target: '[data-tour="tool-door"]', title: 'Дверь', text: 'Нажмите на общую стену двух помещений — встанет дверь. На наружной стене — вход с улицы.' },
  { target: '[data-tour="tool-wall"]', title: 'Стена', text: 'Проведите линию — получится стена. От стены до стены — комната делится на две.' },
  { target: '[data-tour="tool-hole"]', title: 'Вырез', text: 'Колонна, шахта или атриум: протяните прямоугольник внутри комнаты — маршрут его обойдёт.' },
  { target: '[data-tour="tool-shot"]', title: 'Съёмка', text: 'Точки панорам считаются сами. Нажмите в помещении — своя точка. В точке снимите фотосферу с телефона.' },
  { target: '[data-tour="undo"]', title: 'Отменить и повторить', text: 'Последняя правка — назад и вперёд. Всё сохраняется само.' },
  { target: '[data-tour="theme"]', title: 'Тема', text: 'Светлая или тёмная — как удобнее глазам.' },
  { target: '[data-tour="qr"]', title: 'На телефон', text: 'QR-код проекта: наведите камеру телефона — проект откроется там, удобно снимать панорамы.' },
  { target: '[data-tour="view"]', title: 'План и 3D', text: 'Посмотрите площадку объёмно — так её увидит посетитель.' },
  { target: '[data-tour="levels"]', title: 'Этажи', text: 'Переключайте этажи и добавляйте новые — пустые или копией плана. Лестницы и лифты друг над другом соединяют этажи в маршрутах.' },
  { target: '[data-tour="menu-layers"]', title: 'Сетка маршрутов', text: 'Показать линии, по которым строятся маршруты посетителей.' },
  { target: '[data-tour="menu-camera"]', title: 'Точки съёмки', text: 'Показать или скрыть точки панорам на плане.' },
  { target: '[data-tour="menu-chart"]', title: 'Статистика', text: 'Сколько раз открывали карту, какие места смотрели, куда строили маршруты и что не нашли поиском.' },
  { target: '[data-tour="menu-download"]', title: 'Скачать карту', text: 'Вся карта одним файлом — для копии или переноса.' },
  { target: '[data-tour="menu-upload"]', title: 'Загрузить карту', text: 'Открыть карту из такого файла.' },
  { target: '[data-tour="visitor"]', title: 'Карта посетителя', text: 'Как карту увидят по ссылке.' },
  { target: '[data-tour="publish"]', title: 'Публикация', text: 'Ссылка на карту и код для сайта. Правки обновляют карту по той же ссылке.' },
  { target: '[data-tour="more"]', title: 'Ещё', text: '3D, сетка маршрутов, точки съёмки, тема, сканер QR, загрузка и выгрузка карты, публикация.' },
  { target: '[data-tour="inspector"]', title: 'Свойства', text: 'Свойства выбранного. Без выбора — сводка площадки: название, помещения, категории.' },
  { target: '.sheet', title: 'Шторка', text: 'Свойства выбранного. Тяните вверх и вниз; без выбора — сводка площадки.' },
  { target: '[data-tour="help"]', title: 'Обучение', text: 'Пройти ещё раз — эта кнопка.' },
];

/** Есть ли выбранный объект в документе. */
function selectionExists(doc: MapDocument, s: NonNullable<Selection>): boolean {
  switch (s.kind) {
    case 'unit':
      return doc.units.some((u) => u.id === s.id);
    case 'place':
      return doc.places.some((p) => p.id === s.id);
    case 'hole': {
      const { unitId, index } = holeRef(s.id);
      return !!doc.units.find((u) => u.id === unitId)?.holes?.[index];
    }
    case 'shot':
      return !!doc.capturePoints?.some((p) => p.id === s.id && p.origin !== 'removed');
    case 'opening':
      return doc.openings.some((o) => o.id === s.id);
  }
}

/** Демо без сервера: правки живут в этом браузере. */
export default function EditorPage() {
  return <Editor initial={() => loadEditedDemo() ?? builtInDemo()} />;
}

/** Площадка организатора: черновик с сервера, автосохранение с ревизией. */
export function ServerEditorPage() {
  const { id = '' } = useParams();
  const [state, setState] = useState<
    { venue: VenueSummary; doc: MapDocument; revision: number } | { error: string; notMine: boolean } | null
  >(null);
  const { user, logout } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    setState(null);
    Promise.all([venuesApi.get(id), venuesApi.draft(id)])
      .then(([venue, draft]) => setState({ venue, doc: draft.doc, revision: draft.revision }))
      .catch((err) =>
        setState({
          error: err instanceof ApiError ? err.message : 'Не удалось открыть площадку',
          // Чужая площадка и несуществующая для сервера неотличимы (404) — так он не раскрывает чужие площадки.
          notMine: err instanceof ApiError && err.status === 404,
        }),
      );
  }, [id]);

  const switchAccount = async () => {
    if (!(await logout())) return;
    navigate(`/app/login?next=${encodeURIComponent(`/app/venues/${id}`)}`, { replace: true });
  };

  if (!state) {
    return (
      <div className="screen-message">
        <div className="loader" aria-label="Загрузка площадки" />
      </div>
    );
  }
  if ('error' in state) {
    if (state.notMine) {
      return (
        <div className="screen-message">
          <div className="access-card">
            <Icon name="edit" size={28} />
            <h2>Эту площадку редактирует другой аккаунт</h2>
            {user?.isGuest ? (
              <p>
                Вы вошли без регистрации — в этом браузере свой гостевой аккаунт, и площадки с другого устройства ему не видны. На устройстве,
                где площадку создавали, откройте «Мои площадки» → «Сохранить аккаунт», а здесь войдите по той же почте. Если в этом браузере есть
                свои гостевые площадки, сначала сохраните аккаунт и здесь — после выхода к ним не вернуться.
              </p>
            ) : (
              <p>
                Вы вошли как {user?.email}, а площадка принадлежит другому аккаунту — или её удалили. Войдите под аккаунтом владельца.
              </p>
            )}
            <button type="button" className="btn btn-primary btn-block" onClick={() => void switchAccount()}>
              Войти под другим аккаунтом
            </button>
            <Link to="/app" className="btn btn-secondary btn-block">
              К моим площадкам
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div className="screen-message">
        <div>
          <p>{state.error}</p>
          <Link to="/app" className="btn btn-secondary">
            К моим площадкам
          </Link>
        </div>
      </div>
    );
  }
  return <Editor key={id} initial={() => state.doc} server={{ venue: state.venue, revision: state.revision }} />;
}

function saveStatusText(s: SaveStatus): ReactNode {
  switch (s.kind) {
    case 'pending':
    case 'saving':
      return 'Сохраняем…';
    case 'saved':
      return (
        <>
          <Icon name="check" size={13} /> {s.publishedVersion !== null ? 'Сохранено и опубликовано' : 'Сохранено'}
        </>
      );
    case 'error':
      return s.message;
    case 'conflict':
      return 'Карту изменили в другом окне';
    default:
      return null;
  }
}

interface EditorProps {
  initial: () => MapDocument;
  /** Есть — площадка на сервере; нет — демо в браузере. */
  server?: { venue: VenueSummary; revision: number };
}

function Editor({ initial, server }: EditorProps) {
  const desktop = useMediaQuery('(min-width: 900px)');
  const navigate = useNavigate();
  // План съёмки считается сразу: у карт, сохранённых до него, точек ещё нет.
  const history = useHistory<MapDocument>(() => refreshCapturePoints(initial()));
  const { doc } = history;
  const [venue, setVenue] = useState<VenueSummary | null>(server?.venue ?? null);
  const [publishOpen, setPublishOpen] = useState(false);
  // Чужое сохранение (правят несколько человек — владелец и администраторы, телефон снимает панорамы): показываем новый документ,
  // история — с него: «Отменить» не должна откатить чужую правку.
  const remote = useServerSave(server?.venue.id ?? null, server?.revision ?? 0, doc, (theirs, by, merged) => {
    history.reset(theirs);
    const who = by ? `: ${by}` : ' из другого окна';
    showToast(merged ? `Ваши правки объединены с изменениями${who}` : `Подтянули изменения${who}`);
  });
  const levels = sortedLevels(doc);
  const [levelId, setLevelId] = useState(() => levels[0]?.id ?? 'L1');
  // Этаж удалили (или его убрала чужая правка) — показываем нижний.
  const level = doc.levels.some((l) => l.id === levelId) ? levelId : (levels[0]?.id ?? 'L1');
  const [addLevelOpen, setAddLevelOpen] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [areaCategory, setAreaCategory] = useState(() => doc.categories.find((c) => c.id === 'food')?.id ?? doc.categories[0]?.id ?? '');
  const activeAreaCategory = doc.categories.some((c) => c.id === areaCategory) ? areaCategory : doc.categories[0]?.id ?? '';
  // Настройки новой двери: тип и насколько открыта — применяются в момент постановки.
  const [doorPreset, setDoorPreset] = useState<DoorPreset>(DEFAULT_DOOR_PRESET);
  const [selection, setSelection] = useState<Selection>(null);
  const [view, setView] = useState<'plan' | '3d'>('plan');
  const [showGraph, setShowGraph] = useState(false);
  const [showShots, setShowShots] = useState(true);
  // Инструмент «Съёмка» работает с точками — включаем их показ.
  useEffect(() => {
    if (tool === 'shot') setShowShots(true);
  }, [tool]);
  /** Экран камеры с маршрутом съёмки: с какой точки (null — от входа). */
  const [guide, setGuide] = useState<{ from: string | null } | null>(null);
  /** Открытая на весь экран панорама. */
  // Открытая панорама и куда смотреть: у места — на само место.
  const [preview, setPreview] = useState<{ id: string; yaw: number } | null>(null);
  const openPreview = (id: string, yaw?: number) => setPreview({ id, yaw: yaw ?? 0 });
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  const [saved, setSaved] = useState<'saved' | 'error' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>('peek');
  const [sheetHeight, setSheetHeight] = useState(0);
  const [tourOpen, setTourOpen] = useState(false);
  const theme = useTheme();
  // Высота шапки на телефоне: длинное название площадки встаёт в две строки — план и подсказка сдвигаются под неё.
  const topRef = useRef<HTMLElement>(null);
  const [topHeight, setTopHeight] = useState(64);
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTopHeight(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [fitKey, setFitKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const firstSave = useRef(true);

  const showToast = useCallback((text: string) => setToast({ text, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // Демо: автосохранение в браузер после каждой правки (и после отмены). Площадку сохраняет useServerSave.
  useEffect(() => {
    if (server) return;
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    setSaved(saveEditedDemo(doc) ? 'saved' : 'error');
  }, [doc]);

  const commit = useCallback(
    (next: MapDocument, select?: Selection) => {
      const withMarkers = refreshPanoramaMarkers(refreshCapturePoints(next));
      history.commit(withMarkers);
      if (select !== undefined) setSelection(select);
    },
    [history.commit],
  );

  /** Выбрать объект. На телефоне шторка показывает его свойства; keepSheet — выбор по ходу перетаскивания, шторку не трогаем. */
  const select = (s: Selection, opts?: { keepSheet?: boolean }) => {
    setSelection(s);
    if (!desktop && !opts?.keepSheet) setSheetMode(s ? 'auto' : 'peek');
  };

  // Выбор пропал после отмены — снимаем.
  useEffect(() => {
    if (selection && !selectionExists(doc, selection)) setSelection(null);
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
            : selection.kind === 'hole'
              ? deleteHole(doc, holeRef(selection.id).unitId, holeRef(selection.id).index)
              : selection.kind === 'shot'
              ? removeCapturePoint(doc, selection.id)
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
      history.reset(refreshCapturePoints(next));
      if (!server) setSaved(saveEditedDemo(next) ? 'saved' : 'error');
      setSelection(null);
      setFitKey((k) => k + 1);
      showToast('Карта загружена из файла');
    } catch {
      showToast('Не удалось прочитать файл');
    }
  };

  const reset = () => {
    clearEditedDemo();
    history.reset(refreshCapturePoints(builtInDemo()));
    setSelection(null);
    setConfirmReset(false);
    setSaved(null);
    setFitKey((k) => k + 1);
    showToast('Демо-площадка восстановлена');
  };

  const toolbar = (
    <div className={`tool-bar ${desktop ? 'vertical' : ''}`} role="toolbar" aria-label="Инструменты">
      {/* На телефоне «?» — первым в панели: в шапке место занято названием площадки. */}
      {!desktop && (
        <button type="button" className="tool-btn" data-tour="help" onClick={() => setTourOpen(true)}>
          <Icon name="help" size={21} />
          <span>Помощь</span>
        </button>
      )}
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          data-tour={`tool-${t.id}`}
          className="tool-btn"
          aria-pressed={tool === t.id}
          title={`${t.label} (${t.key})`}
          onClick={() => {
            setTool(t.id);
            if (view === '3d') setView('plan');
          }}
        >
          <Icon name={t.icon} size={21} />
          <span>{desktop ? t.label : (t.short ?? t.label)}</span>
        </button>
      ))}
    </div>
  );

  const insets = desktop ? { top: 76, left: 96, right: 372, bottom: 0 } : { top: topHeight, bottom: sheetHeight };

  // Порядок съёмки: номера точек на плане и пунктир маршрута между ними.
  const shotPlan = useMemo(() => {
    const route = captureRoute(doc, level);
    const labels = new Map(route.order.map((id, i) => [id, String(i + 1)]));
    return { labels, legs: route.legs.map((l) => l.line) };
  }, [doc, level]);
  const openGuide = (from: string | null) => setGuide({ from });

  // Снятая или загруженная панорама — на план. Загрузка идёт долго, поэтому берём свежий документ, а не тот, что был при нажатии.
  const docRef = useRef(doc);
  docRef.current = doc;
  // Снято или загружено из карточки места (placeId) — это панорама места: её покажут в его карточке.
  const placePanorama = (shot: ShotPanorama, placeId: string | null = null) => {
    const added = addPanoramaAtPoint(docRef.current, shot);
    commit(placeId && added.doc.places.some((p) => p.id === placeId) ? setPlacePanorama(added.doc, placeId, added.id) : added.doc);
    showToast(shot.heading === null ? 'Панорама встала в точку. Метки и переходы в ней появятся, когда будет задано её направление' : 'Фотосфера сохранена и встала в точку');
  };
  const panoFileRef = useRef<HTMLInputElement>(null);
  const uploadFor = useRef<string | null>(null);
  const uploadPlace = useRef<string | null>(null);
  const uploadPanoramaFor = (pointId: string, placeId: string | null = null) => {
    uploadFor.current = pointId;
    uploadPlace.current = placeId;
    panoFileRef.current?.click();
  };
  // В приложении для Android — встроенная съёмка: снимок сразу уходит на сервер и встаёт в точку.
  const shootPanoramaFor = async (pointId: string, placeId: string | null = null) => {
    uploadFor.current = pointId;
    uploadPlace.current = placeId;
    try {
      const blob = await captureNativeSphere();
      await uploadPanorama(new File([blob], 'sphere.jpg', { type: blob.type || 'image/jpeg' }));
    } catch (err) {
      showToast(cancelText(err));
    }
  };
  // Фотосфера из карточки места: точка съёмки у места — неснятая рядом или новая своя.
  const pointForPlace = (placeId: string): string | null => {
    const r = capturePointForPlace(docRef.current, placeId);
    if (!r) {
      showToast('Место должно стоять внутри помещения, куда пускают посетителей');
      return null;
    }
    if (r.doc !== docRef.current) {
      docRef.current = r.doc;
      commit(r.doc);
    }
    return r.pointId;
  };
  const shootForPlace = (placeId: string) => {
    const pointId = pointForPlace(placeId);
    if (pointId) void shootPanoramaFor(pointId, placeId);
  };
  const uploadForPlace = (placeId: string) => {
    const pointId = pointForPlace(placeId);
    if (pointId) uploadPanoramaFor(pointId, placeId);
  };
  const uploadPanorama = async (file: File) => {
    const point = docRef.current.capturePoints?.find((p) => p.id === uploadFor.current);
    const placeId = uploadPlace.current;
    if (!server || !point) return;
    showToast('Загружаем панораму…');
    try {
      const asset = await venuesApi.uploadPanorama(server.venue.id, file);
      placePanorama({ pointId: point.id, pano: asset.id, level: point.level, pos: point.pos, heading: null, cameraHeight: 1.5 }, placeId);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Не удалось загрузить панораму');
    }
  };

  // phoneOnly — только в меню «Ещё» на телефоне: на компьютере для этого есть своя кнопка в шапке.
  const menuItems: { icon: IconName; label: string; onClick: () => void; pressed?: boolean; danger?: boolean; phoneOnly?: boolean }[] = [
    // На телефоне сканер и тема — в «Ещё»: в шапке место нужно названию площадки.
    ...(desktop
      ? []
      : [
          { icon: 'qr' as IconName, label: 'Сканировать QR-код проекта', onClick: () => setScanOpen(true) },
          { icon: (theme === 'dark' ? 'sun' : 'moon') as IconName, label: theme === 'dark' ? 'Светлая тема' : 'Тёмная тема', onClick: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
        ]),
    ...(desktop ? [] : [{ icon: (view === 'plan' ? 'cube' : 'map') as IconName, label: view === 'plan' ? 'Показать в 3D' : 'Вернуться к плану', onClick: () => setView(view === 'plan' ? '3d' : 'plan') }]),
    { icon: 'layers', label: 'Сетка маршрутов', onClick: () => setShowGraph((g) => !g), pressed: showGraph },
    {
      icon: 'camera',
      label: 'Точки съёмки',
      // Спрятали точки — инструмент «Съёмка» и выбранная точка без них не нужны.
      onClick: () => {
        if (showShots) {
          if (tool === 'shot') setTool('select');
          if (selection?.kind === 'shot') setSelection(null);
        }
        setShowShots(!showShots);
      },
      pressed: showShots,
    },
    ...(server ? [{ icon: 'chart' as IconName, label: 'Статистика просмотров', onClick: () => navigate(`/app/venues/${server.venue.id}/stats`) }] : []),
    { icon: 'download', label: 'Скачать карту (JSON)', onClick: download },
    { icon: 'upload', label: 'Загрузить карту из файла', onClick: () => fileRef.current?.click() },
    ...(server
      ? [{ icon: 'external' as IconName, label: venue?.publishedVersion !== null ? 'Ссылка и код для сайта' : 'Опубликовать', onClick: () => setPublishOpen(true), phoneOnly: true }]
      : [{ icon: 'reset' as IconName, label: 'Сбросить демо', onClick: () => setConfirmReset(true), danger: true }]),
  ];

  const visitorUrl = venue ? `/m/${venue.slug}` : '/m/demo';

  const changeLevel = (id: string) => {
    setLevelId(id);
    setSelection(null);
    if (tool === 'underlay') setTool('select');
  };
  const serverId = server?.venue.id ?? null;
  const underlayApi = useMemo<UnderlayApi | undefined>(
    () => (serverId ? { upload: (file) => venuesApi.uploadUnderlay(serverId, file), src: (asset) => venuesApi.underlayUrl(serverId, asset) } : undefined),
    [serverId],
  );
  const floorProps = {
    onLevel: changeLevel,
    onAddLevel: () => setAddLevelOpen(true),
    underlayApi,
    underlayMoving: tool === 'underlay',
    onUnderlayMove: (on: boolean) => {
      setSelection(null);
      setTool(on ? 'underlay' : 'select');
      if (on && view === '3d') setView('plan');
    },
  };

  const resolveConflict = async (keep: 'mine' | 'theirs') => {
    try {
      const theirs = await remote.resolveConflict(keep);
      if (theirs) {
        history.reset(refreshCapturePoints(theirs));
        setSelection(null);
        showToast('Загружена версия из другого окна');
      }
    } catch {
      showToast('Нет связи с сервером — попробуйте ещё раз');
    }
  };

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
            areaCategory={activeAreaCategory}
            doorPreset={doorPreset}
            insets={insets}
            fitKey={fitKey}
            showShots={showShots}
            shotLabels={shotPlan.labels}
            shotRoute={shotPlan.legs}
            onSelect={select}
            onCommit={(next, s) => {
              // Новый объект — показываем его свойства. Сдвиг или размер уже существующего — шторку не трогаем:
              // свернули её, чтобы видеть план, — пусть так и остаётся.
              const created = !!s && !selectionExists(doc, s);
              commit(next, s);
              if (created && !desktop) setSheetMode('auto');
            }}
            onToolDone={() => setTool('select')}
            onToast={showToast}
            underlaySrc={underlayApi?.src}
          />
        ) : (
          <ErrorBoundary fallback={<div className="screen-message">Не удалось загрузить 3D.</div>}>
            <Suspense fallback={<div className="screen-message"><div className="loader" /></div>}>
              <Model3DView doc={doc} level={level} insets={insets} selectedPlace={selection?.kind === 'place' ? selection.id : null} showPanoramas={showShots} />
            </Suspense>
          </ErrorBoundary>
        )}
        {view === 'plan' && <div className="tool-hint" style={desktop ? { left: 112, top: 88 } : { top: topHeight + 6 }}>{TOOL_HINT[tool]}</div>}
        <LevelSwitch levels={levels} value={level} onChange={changeLevel} onAdd={() => setAddLevelOpen(true)} style={desktop ? { left: 112, bottom: 24 } : { left: 12, top: topHeight + 64 }} />
      </main>

      <header className="editor-top" ref={topRef}>
        <Link
          to={server ? '/app' : '/m/demo'}
          className="icon-btn"
          aria-label={server ? 'К моим площадкам' : 'К карте посетителя'}
          title={server ? 'К моим площадкам' : 'К карте посетителя'}
        >
          <Icon name="back" />
        </Link>
        <div className="editor-title">
          <strong>{server ? (venue?.name ?? doc.venue.name) : desktop ? 'Редактор площадки' : 'Редактор'}</strong>
          <small className={server && (remote.status.kind === 'error' || remote.status.kind === 'conflict') ? 'save-problem' : undefined}>
            {server ? (
              // На телефоне шапка узкая — статус коротко, без ссылки.
              (saveStatusText(remote.status) ??
                (venue?.publishedVersion !== null ? (desktop ? `Опубликована · /m/${venue?.slug}` : 'Опубликована') : desktop ? 'Черновик — ещё не опубликована' : 'Черновик'))
            ) : saved === 'saved' ? (
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
          {desktop && (
            <button type="button" className="icon-btn" data-tour="help" aria-label="Обучение" title="Обучение — что за что отвечает" onClick={() => setTourOpen(true)}>
              <Icon name="help" />
            </button>
          )}
          <button type="button" className="icon-btn" data-tour="undo" aria-label="Отменить" title="Отменить (⌘Z)" disabled={!history.canUndo} onClick={history.undo}>
            <Icon name="undo" />
          </button>
          <button type="button" className="icon-btn" aria-label="Повторить" title="Повторить (⇧⌘Z)" disabled={!history.canRedo} onClick={history.redo}>
            <Icon name="redo" />
          </button>
          {desktop && <ThemeToggle tour="theme" />}
          {/* Компьютер показывает QR-код проекта, телефон его сканирует. */}
          {desktop ? (
            server && (
              <button type="button" className="icon-btn" data-tour="qr" aria-label="Открыть на телефоне" title="Открыть на телефоне — QR-код" onClick={() => setQrOpen(true)}>
                <Icon name="qr" />
              </button>
            )
          ) : null}
          {desktop && (
          <div className="segmented compact" role="group" aria-label="Вид" data-tour="view">
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
            menuItems.filter((m) => !m.danger && !m.phoneOnly).map((m) => (
              <button key={m.label} type="button" className="icon-btn" data-tour={`menu-${m.icon}`} title={m.label} aria-label={m.label} aria-pressed={m.pressed} onClick={m.onClick}>
                <Icon name={m.icon} />
              </button>
            ))}
          {desktop && server ? (
            <>
              {venue?.publishedVersion !== null && (
                <a href={visitorUrl} target="_blank" rel="noreferrer" className="btn btn-ghost" data-tour="visitor">
                  <Icon name="eye" size={18} /> Карта посетителя
                </a>
              )}
              <button type="button" className="btn btn-primary" data-tour="publish" onClick={() => setPublishOpen(true)}>
                <Icon name="external" size={18} /> {venue?.publishedVersion !== null ? 'Ссылка и код' : 'Опубликовать'}
              </button>
            </>
          ) : desktop ? (
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
              <button type="button" className="icon-btn" data-tour="more" aria-label="Ещё" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
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
          <aside className="inspector" aria-label="Свойства" data-tour="inspector">
            <Inspector doc={doc} level={level} selection={selection} onSelect={select} onCommit={commit} onToast={showToast} tool={tool} areaCategory={activeAreaCategory} onAreaCategory={setAreaCategory} doorPreset={doorPreset} onDoorPreset={setDoorPreset} onExitTool={() => setTool('select')} shotLabels={shotPlan.labels} onOpenGuide={openGuide} onUploadPanorama={server ? uploadPanoramaFor : undefined} onShootPanorama={server && hasNativeCapture() ? (id) => void shootPanoramaFor(id) : undefined} onShootForPlace={server && hasNativeCapture() ? shootForPlace : undefined} onUploadForPlace={server ? uploadForPlace : undefined} onOpenPanorama={openPreview} {...floorProps} />
          </aside>
        </>
      ) : (
        <Sheet mode={sheetMode} onModeChange={setSheetMode} desktop={false} peekHeight={118} topGap={64} onHeight={setSheetHeight} label="Инструменты и свойства" header={toolbar}>
          <Inspector doc={doc} level={level} selection={selection} onSelect={select} onCommit={commit} onToast={showToast} tool={tool} areaCategory={activeAreaCategory} onAreaCategory={setAreaCategory} doorPreset={doorPreset} onDoorPreset={setDoorPreset} onExitTool={() => setTool('select')} shotLabels={shotPlan.labels} onOpenGuide={openGuide} onUploadPanorama={server ? uploadPanoramaFor : undefined} onShootPanorama={server && hasNativeCapture() ? (id) => void shootPanoramaFor(id) : undefined} onShootForPlace={server && hasNativeCapture() ? shootForPlace : undefined} onUploadForPlace={server ? uploadForPlace : undefined} onOpenPanorama={openPreview} {...floorProps} />
        </Sheet>
      )}

      <input
        ref={panoFileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void uploadPanorama(f);
          e.target.value = '';
        }}
      />
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

      {tourOpen && <Tour steps={TOUR} onClose={() => setTourOpen(false)} />}

      {addLevelOpen && <AddLevelDialog doc={doc} level={level} onCommit={(next) => commit(next)} onLevel={changeLevel} onClose={() => setAddLevelOpen(false)} />}

      {toast && (
        <div key={toast.id} className="toast" role="status" style={!desktop ? { bottom: sheetHeight + 16 } : undefined}>
          {toast.text}
        </div>
      )}

      {preview && <PanoramaPreview key={preview.id} doc={doc} panoId={preview.id} initialYaw={preview.yaw} onCommit={(next) => commit(next)} onClose={() => setPreview(null)} />}

      {guide && (
        <ErrorBoundary fallback={<div className="screen-message">Не удалось открыть камеру.</div>}>
          <Suspense fallback={<div className="screen-message"><div className="loader" /></div>}>
            <CaptureGuide doc={doc} level={level} startId={guide.from} venueId={server?.venue.id ?? null} onPanorama={placePanorama} onClose={() => setGuide(null)} />
          </Suspense>
        </ErrorBoundary>
      )}

      {publishOpen && venue && (
        <PublishDialog
          venue={venue}
          onClose={() => setPublishOpen(false)}
          onPublished={setVenue}
        />
      )}

      {qrOpen && server && (
        <ErrorBoundary
          fallback={
            <Modal onClose={() => setQrOpen(false)}>
              <h2>Не удалось открыть QR-код</h2>
              <p>Похоже, пропала связь. Обновите страницу и попробуйте ещё раз.</p>
            </Modal>
          }
        >
          <Suspense fallback={null}>
            <PhoneQrDialog venueId={server.venue.id} onClose={() => setQrOpen(false)} />
          </Suspense>
        </ErrorBoundary>
      )}

      {scanOpen && (
        <ErrorBoundary
          fallback={
            <Modal onClose={() => setScanOpen(false)}>
              <h2>Не удалось открыть сканер</h2>
              <p>Похоже, пропала связь. Обновите страницу и попробуйте ещё раз.</p>
            </Modal>
          }
        >
          <Suspense fallback={null}>
            <QrScanner onClose={() => setScanOpen(false)} />
          </Suspense>
        </ErrorBoundary>
      )}

      {remote.status.kind === 'conflict' && (
        <Modal onClose={() => {}}>
          <h2>Карту изменили в другом окне</h2>
          <p>
            {remote.status.updatedBy ? `${remote.status.updatedBy} сохранил(а) свою версию.` : 'Кто-то сохранил свою версию.'} Ваши последние
            правки пока не сохранены. Чью версию оставить?
          </p>
          <div className="row end">
            <button type="button" className="btn btn-ghost" onClick={() => void resolveConflict('theirs')}>
              Взять версию из другого окна
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void resolveConflict('mine')}>
              Оставить мою
            </button>
          </div>
        </Modal>
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

/** Горячие клавиши работают и в русской раскладке: м → V, к → R, з → P, в → D, ы → S, р → H, с → C. */
function layoutKey(key: string): string | undefined {
  return ({ м: 'V', к: 'R', з: 'P', в: 'D', ц: 'W', р: 'H', с: 'C' } as Record<string, string>)[key.toLowerCase()];
}
