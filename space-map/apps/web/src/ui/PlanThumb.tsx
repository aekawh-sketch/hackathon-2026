// Миниатюра плана для карточек площадок (кабинет и каталог «Все карты»).
import type { PlanOutline } from '@space-map/map-core';
import { UNIT_FILL, WALL } from '../plan/style.ts';
import { useTheme } from './theme.tsx';

/** Миниатюра плана: контуры помещений с заливкой по типу, как на карте. */
export function PlanThumb({ outline }: { outline: PlanOutline }) {
  useTheme();
  const { minX, minY, maxX, maxY } = outline.bounds;
  const pad = Math.max(maxX - minX, maxY - minY) * 0.06 + 0.2;
  const vb = `${minX - pad} ${-(maxY + pad)} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
  return (
    <svg className="plan-thumb" viewBox={vb} preserveAspectRatio="xMidYMid meet" role="img" aria-label="План площадки">
      {/* План: y вверх, SVG: y вниз — отражаем по вертикали. */}
      <g transform="scale(1,-1)">
        {outline.units.map((u, i) => (
          <polygon key={i} points={u.polygon.map((p) => p.join(',')).join(' ')} fill={UNIT_FILL[u.kind]} stroke={WALL} strokeWidth={0.12} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
  );
}
