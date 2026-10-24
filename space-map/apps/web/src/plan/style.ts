// Оформление схемы: светлый «архитектурный» план, мягкие заливки по типу помещения, тёмные стены.
// В тёмной теме — та же схема наоборот: тёмные полы, светлые стены. У каждой категории своя иконка —
// цвет не единственный признак (ТЗ 5.12).
//
// Цвета — изменяемые экспорты: `setPlanTheme` подменяет их все разом, а рисующие компоненты подписаны
// на тему (`useTheme`) и перерисовываются. Так план, 3D и миниатюры не тянут палитру через пропсы.
import type { UnitKind } from '@space-map/map-core';

interface Palette {
  unitFill: Record<UnitKind, string>;
  unitFloor3d: Record<UnitKind, string>;
  planBg: string;
  wall: string;
  door: string;
  entrance: string;
  obstacleFill: string;
  obstacleStroke: string;
  label: string;
  route: string;
  routeCasing: string;
  panorama: string;
  capture: string;
  selected: string;
  from: string;
  /** 3D: фон и туман, «стол» под макетом, сетка на нём, стены (грани и срез сверху), мебель. */
  scene3d: { bg: string; ground: string; grid: string; gridMinor: string; wallSide: string; wallCap: string; block: string };
}

const LIGHT: Palette = {
  unitFill: {
    room: '#EEF0FF',
    corridor: '#FFFFFF',
    hall: '#E6EFFF',
    lobby: '#F7F9FC',
    stairs: '#F0EBFB',
    elevator: '#F0EBFB',
    restroom: '#E6F6F4',
    service: '#ECEEF2',
    outdoor: '#E9F7EE',
  },
  // Цвет пола в 3D — чуть насыщеннее, чтобы читался под светом.
  unitFloor3d: {
    room: '#DCE1FF',
    corridor: '#F4F6FA',
    hall: '#D3E2FF',
    lobby: '#EDF1F7',
    stairs: '#E4DAF7',
    elevator: '#E4DAF7',
    restroom: '#CFEDE9',
    service: '#DDE1E8',
    outdoor: '#D5EEDD',
  },
  planBg: '#E9EDF3',
  wall: '#1F2A3D',
  door: '#FFFFFF',
  entrance: '#12A150',
  obstacleFill: '#D7DEE8',
  obstacleStroke: '#A9B4C4',
  label: '#4A5568',
  route: '#2F5BEA',
  routeCasing: '#FFFFFF',
  panorama: '#0AA2C0',
  capture: '#7C3AED',
  selected: '#FF7A1A',
  from: '#12A150',
  scene3d: { bg: '#E9EDF3', ground: '#DDE3EB', grid: '#C9D1DC', gridMinor: '#D3DAE3', wallSide: '#F8FAFD', wallCap: '#253047', block: '#C7D0DD' },
};

const DARK: Palette = {
  unitFill: {
    room: '#1F2742',
    corridor: '#192131',
    hall: '#1C2B47',
    lobby: '#1B2232',
    stairs: '#2A2442',
    elevator: '#2A2442',
    restroom: '#173230',
    service: '#232834',
    outdoor: '#183323',
  },
  unitFloor3d: {
    room: '#2E3963',
    corridor: '#283247',
    hall: '#2A3E68',
    lobby: '#2A3346',
    stairs: '#3C3463',
    elevator: '#3C3463',
    restroom: '#22474A',
    service: '#333A4A',
    outdoor: '#244A33',
  },
  planBg: '#0F1521',
  wall: '#C3CEDF',
  door: '#2B3A57',
  entrance: '#2FBF6A',
  obstacleFill: '#2B3446',
  obstacleStroke: '#4A5770',
  label: '#AEB9CB',
  route: '#6B8CFF',
  routeCasing: '#0F1521',
  panorama: '#2BC0DD',
  capture: '#9C72FF',
  selected: '#FF8A3D',
  from: '#2FBF6A',
  scene3d: { bg: '#0F1521', ground: '#141C2A', grid: '#283246', gridMinor: '#1D2535', wallSide: '#56637C', wallCap: '#C3CEDF', block: '#3A4559' },
};

export let UNIT_FILL = LIGHT.unitFill;
export let UNIT_FLOOR_3D = LIGHT.unitFloor3d;
export let PLAN_BG = LIGHT.planBg;
export let WALL = LIGHT.wall;
export const WALL_WIDTH = 2.5;
export let DOOR = LIGHT.door;
export let ENTRANCE = LIGHT.entrance;
export let OBSTACLE_FILL = LIGHT.obstacleFill;
export let OBSTACLE_STROKE = LIGHT.obstacleStroke;
export let LABEL = LIGHT.label;
export let ROUTE = LIGHT.route;
export let ROUTE_CASING = LIGHT.routeCasing;
export let PANORAMA = LIGHT.panorama;
/** Точки и маршрут съёмки — отдельный цвет, чтобы не путать с маршрутом посетителя. */
export let CAPTURE = LIGHT.capture;
export let SELECTED = LIGHT.selected;
export let FROM = LIGHT.from;
export let SCENE_3D = LIGHT.scene3d;

/** Палитра плана под тему сайта (`ui/theme.tsx`). */
export function setPlanTheme(dark: boolean) {
  const p = dark ? DARK : LIGHT;
  UNIT_FILL = p.unitFill;
  UNIT_FLOOR_3D = p.unitFloor3d;
  PLAN_BG = p.planBg;
  WALL = p.wall;
  DOOR = p.door;
  ENTRANCE = p.entrance;
  OBSTACLE_FILL = p.obstacleFill;
  OBSTACLE_STROKE = p.obstacleStroke;
  LABEL = p.label;
  ROUTE = p.route;
  ROUTE_CASING = p.routeCasing;
  PANORAMA = p.panorama;
  CAPTURE = p.capture;
  SELECTED = p.selected;
  FROM = p.from;
  SCENE_3D = p.scene3d;
}
