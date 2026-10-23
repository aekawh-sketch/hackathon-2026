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
}

export const DEFAULT_SETTINGS: MapSettings = { markerRange: 20, linkRange: 15 };
