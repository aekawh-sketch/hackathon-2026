// Миниатюра плана для списка площадок: контуры помещений нижнего этажа, округлённые и урезанные по размеру.
import type { MapDocument, UnitKind, Vec2 } from './types.ts';

export interface PlanOutline {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  units: { kind: UnitKind; polygon: Vec2[] }[];
}

/**
 * Контуры помещений нижнего этажа для превью. Ограничения по числу помещений и вершин держат
 * ответ списка площадок лёгким, даже если план большой. null — на плане ещё ничего нет.
 */
export function planOutline(doc: MapDocument, maxUnits = 150, maxPoints = 40): PlanOutline | null {
  const level = [...doc.levels].sort((a, b) => a.ordinal - b.ordinal)[0]?.id;
  if (!level) return null;
  const units = doc.units
    .filter((u) => u.level === level)
    .slice(0, maxUnits)
    .map((u) => {
      const step = Math.ceil(u.polygon.length / maxPoints);
      const pts = step > 1 ? u.polygon.filter((_, i) => i % step === 0) : u.polygon;
      return { kind: u.kind, polygon: pts.map((p) => [round1(p[0]), round1(p[1])] as Vec2) };
    });
  if (units.length === 0) return null;
  const all = units.flatMap((u) => u.polygon);
  return {
    bounds: {
      minX: Math.min(...all.map((p) => p[0])),
      minY: Math.min(...all.map((p) => p[1])),
      maxX: Math.max(...all.map((p) => p[0])),
      maxY: Math.max(...all.map((p) => p[1])),
    },
    units,
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10 + 0;
}
