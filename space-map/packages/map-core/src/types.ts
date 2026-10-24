// Документ карты — ТЗ 10.2. Координаты в метрах: x вправо, y вверх.

export type Vec2 = [number, number];

export type ScaleClass = 'scaled' | 'schematic';

export interface VenueInfo {
  id: string;
  name: string;
  /** Азимут «верха» плана относительно севера, градусы по часовой. */
  planNorth: number | null;
  scaleClass: ScaleClass;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  synonyms: string[];
}

export interface Underlay {
  asset: string;
  pxPerM: number;
  origin: Vec2;
  rotation: number;
  opacity: number;
}

export interface Level {
  id: string;
  name: string;
  ordinal: number;
  underlay: Underlay | null;
}

export type UnitKind =
  | 'room'
  | 'corridor'
  | 'hall'
  | 'lobby'
  | 'stairs'
  | 'elevator'
  | 'restroom'
  | 'service'
  | 'outdoor';

export interface Unit {
  id: string;
  /** Родительское помещение, из которого выделена эта вложенная комната. */
  parent?: string;
  level: string;
  kind: UnitKind;
  name: string;
  walkable: boolean;
  polygon: Vec2[];
  /** Вырезы внутри помещения: колонна, шахта, атриум; узкий вырез — перегородка. Вокруг — стены, пройти нельзя. */
  holes?: Vec2[][];
}

export interface Obstacle {
  id: string;
  level: string;
  kind: 'booth' | 'column' | 'counter' | 'other';
  polygon: Vec2[];
}

export interface Opening {
  id: string;
  level: string;
  kind: 'door' | 'passage' | 'entrance';
  segment: [Vec2, Vec2];
  units: [string, string] | [string];
  /** Створки двери. Нет — значения по умолчанию (`doorStyleOf`); у проёма без двери не используется. */
  door?: DoorStyle;
}

/** Как устроена и нарисована дверь: на плане — полотно и дуга открывания, в 3D — полотно под углом. */
export interface DoorStyle {
  /** 1 — обычная дверь, 2 — двустворчатая. */
  leaves: 1 | 2;
  /** Куда открывается: 1 — влево от направления segment[0] → segment[1], −1 — вправо. */
  swing: 1 | -1;
  /** Петли одностворчатой двери: у segment[0] или у segment[1]. */
  hinge: 'start' | 'end';
  /** Насколько открыта: 0 — закрыта, 90 — распахнута. Градусы. */
  openAngle: number;
}

export interface NavNode {
  id: string;
  level: string;
  pos: Vec2;
  origin: 'manual' | 'auto';
}

export type EdgeAccess = 'public' | 'staff' | 'blocked';

export interface NavEdge {
  id: string;
  from: string;
  to: string;
  /** Метры для scaleClass = 'scaled', условные единицы плана — для схемы. */
  weight: number;
  access: EdgeAccess;
}

export interface Place {
  id: string;
  level: string;
  pos: Vec2;
  node: string | null;
  polygon: Vec2[] | null;
  name: string;
  category: string;
  number: string | null;
  description: string;
  photos: string[];
  hours: string | null;
  hidden: boolean;
  /**
   * Своя панорама места — снятая или загруженная из его карточки (ID размещения в `panoramas`).
   * null — своей нет, карточка без панорамы. Поля нет — место сделано до привязки: панорама подбирается сама.
   */
  panorama?: string | null;
}

export type SuggestionStatus = 'suggested' | 'accepted';

export interface PanoramaMarker {
  place: string;
  yaw: number;
  pitch: number;
  status: SuggestionStatus;
}

export interface CustomMarker {
  id: string;
  yaw: number;
  pitch: number;
  title: string;
  text: string;
}

export interface PanoramaLink {
  to: string;
  yaw: number;
  status: SuggestionStatus;
  /**
   * Стрелку поставил организатор — нажатием в панораме на проход. Такой yaw привязан к снимку, а не к плану:
   * при повороте панорамы и пересчёте подсказок он не меняется.
   */
  manual?: boolean;
}

/**
 * Точка, поставленная организатором в панораме: «вот здесь на снимке — эта дверь или это место плана».
 * Привязана к снимку. По таким точкам считается направление панорамы, а место с точкой стоит в панораме ровно на ней.
 */
export interface PanoramaPin {
  yaw: number;
  pitch: number;
  kind: 'door' | 'place';
  /** Где это на плане — на момент, когда поставили точку. */
  pos: Vec2;
  /** Как назвать человеку: «Дверь в «Коридор»», «Стойка регистрации». */
  name: string;
  /** Место плана — у точек-мест. */
  place?: string;
}

export interface PanoramaPlacement {
  id: string;
  /** ID обработанной панорамы (таблица panoramas). */
  pano: string;
  level: string;
  pos: Vec2;
  node: string | null;
  /** Азимут на плане, куда смотрит центр панорамы (yaw = 0). null — ещё не ориентирована. */
  heading: number | null;
  cameraHeight: number;
  markers: PanoramaMarker[];
  customMarkers: CustomMarker[];
  links: PanoramaLink[];
  /** Точки, поставленные вручную («Установить точку» в осмотре панорамы). */
  pins?: PanoramaPin[];
}

/**
 * Точка съёмки фотосферы на плане (ТЗ 5.4, П1). Сервис сам предлагает точки по форме помещений и дверям,
 * организатор двигает их, добавляет свои и убирает лишние.
 */
export interface CapturePoint {
  id: string;
  level: string;
  pos: Vec2;
  /**
   * auto — рассчитана по плану и пересчитывается при каждой правке;
   * manual — поставлена или сдвинута организатором, расчёт её не трогает;
   * removed — организатор убрал рассчитанную точку: здесь снимать не нужно, расчёт её не вернёт.
   */
  origin: 'auto' | 'manual' | 'removed';
  /** Панорама, снятая в этой точке; null — ещё не снята. */
  panorama: string | null;
}

export interface Anchor {
  id: string;
  level: string;
  pos: Vec2;
  /** Куда смотрит человек, стоящий перед QR, — азимут на плане. */
  facing: number;
  code: string;
}

export interface MapSettings {
  markerRange: number;
  linkRange: number;
}

export interface MapDocument {
  schema: 2;
  venue: VenueInfo;
  categories: Category[];
  levels: Level[];
  units: Unit[];
  obstacles: Obstacle[];
  openings: Opening[];
  graph: { nodes: NavNode[]; edges: NavEdge[] };
  places: Place[];
  panoramas: PanoramaPlacement[];
  anchors: Anchor[];
  settings: MapSettings;
  /** План съёмки. Нет у карт, сохранённых до него, — тогда считается при первой правке. */
  capturePoints?: CapturePoint[];
}

export const DEFAULT_SETTINGS: MapSettings = { markerRange: 20, linkRange: 15 };
