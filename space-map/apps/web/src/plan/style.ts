// Оформление схемы: светлый фон, контуры, у каждой категории своя иконка — цвет не единственный признак (ТЗ 5.12).
import type { UnitKind } from '@space-map/map-core';

export const UNIT_FILL: Record<UnitKind, string> = {
  room: '#F1F5F9',
  corridor: '#FFFFFF',
  hall: '#EEF2FF',
  lobby: '#F8FAFC',
  stairs: '#E2E8F0',
  elevator: '#E2E8F0',
  restroom: '#F0F9FF',
  service: '#E5E7EB',
  outdoor: '#ECFDF5',
};

export const WALL = '#334155';
export const ROUTE = '#1D4ED8';
export const ROUTE_CASING = '#FFFFFF';
export const PANORAMA = '#0EA5E9';
export const SELECTED = '#F59E0B';

const ICONS: Record<string, string> = {
  door: '🚪',
  desk: '🛎️',
  hall: '🎤',
  room: '💬',
  booth: '🏷️',
  wc: '🚻',
  coffee: '☕',
  wifi: '📶',
  elevator: '🛗',
  stairs: '🪜',
  info: 'ℹ️',
};

export function categoryIcon(icon: string): string {
  return ICONS[icon] ?? '📍';
}
