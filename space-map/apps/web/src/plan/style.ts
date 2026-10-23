// Оформление схемы: светлый «архитектурный» план, мягкие заливки по типу помещения, тёмные стены.
// У каждой категории своя иконка — цвет не единственный признак (ТЗ 5.12).
import type { UnitKind } from '@space-map/map-core';

export const UNIT_FILL: Record<UnitKind, string> = {
  room: '#EEF0FF',
  corridor: '#FFFFFF',
  hall: '#E6EFFF',
  lobby: '#F7F9FC',
  stairs: '#F0EBFB',
  elevator: '#F0EBFB',
  restroom: '#E6F6F4',
  service: '#ECEEF2',
  outdoor: '#E9F7EE',
};

/** Цвет пола в 3D — чуть насыщеннее, чтобы читался под светом. */
export const UNIT_FLOOR_3D: Record<UnitKind, string> = {
  room: '#DCE1FF',
  corridor: '#F4F6FA',
  hall: '#D3E2FF',
  lobby: '#EDF1F7',
  stairs: '#E4DAF7',
  elevator: '#E4DAF7',
  restroom: '#CFEDE9',
  service: '#DDE1E8',
  outdoor: '#D5EEDD',
};

export const PLAN_BG = '#E9EDF3';
export const WALL = '#1F2A3D';
export const WALL_WIDTH = 2.5;
export const DOOR = '#FFFFFF';
export const ENTRANCE = '#12A150';
export const OBSTACLE_FILL = '#D7DEE8';
export const OBSTACLE_STROKE = '#A9B4C4';
export const LABEL = '#4A5568';
export const ROUTE = '#2F5BEA';
export const ROUTE_CASING = '#FFFFFF';
export const PANORAMA = '#0AA2C0';
export const SELECTED = '#FF7A1A';
export const FROM = '#12A150';
