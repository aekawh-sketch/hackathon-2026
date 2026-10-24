// Съёмка фотосферы по ориентации камеры (ТЗ 5.4, п. 67). В AR (ARCore) поворот камеры для каждого кадра
// известен точно, поэтому кадр сразу ложится на сферу по этому повороту — без поиска общих точек между кадрами
// («склеено по датчикам», ТЗ 5.5). Готовность — по доле покрытой сферы, а не по числу снятых целей.
// Мир — как у WebXR: x вправо, y вверх, −z вперёд. Камера смотрит вдоль своей −z, x — вправо, y — вверх по кадру.
import { rotateVector, type Quat, type Vec3 } from './capture.ts';

/**
 * Направление пикселя равнопромежуточной панорамы: центр (u = 0,5) — вперёд (−z), u растёт вправо по часовой,
 * v = 0 — зенит. Так же, как yaw и pitch в просмотрщике панорам.
 */
export function equirectDirection(u: number, v: number): Vec3 {
  const lon = (u - 0.5) * 2 * Math.PI;
  const lat = (0.5 - v) * Math.PI;
  return [Math.sin(lon) * Math.cos(lat), Math.sin(lat), -Math.cos(lon) * Math.cos(lat)];
}

/** Кадр камеры: поворот «камера → мир» и половины поля зрения тангенсами (tan(hfov/2), tan(vfov/2)). */
export interface CameraFrustum {
  q: Quat;
  tanX: number;
  tanY: number;
}

/** Где направление попадает в кадр: координаты −1…1 по ширине и высоте или null — вне кадра или за камерой. */
export function directionInFrame(f: CameraFrustum, dir: Vec3, margin = 1): [number, number] | null {
  const [x, y, z] = rotateVector([-f.q[0], -f.q[1], -f.q[2], f.q[3]], dir);
  if (z >= -1e-6) return null;
  const nx = x / -z / (f.tanX * margin);
  const ny = y / -z / (f.tanY * margin);
  return Math.abs(nx) <= 1 && Math.abs(ny) <= 1 ? [nx, ny] : null;
}

/**
 * Какая часть сферы уже снята — сетка ячеек по долготе и широте с весом по площади (у полюсов ячейки мельче).
 * Низ ниже `minLat` не требуем: там ноги снимающего, его по ТЗ снимают отдельным кадром с шага в сторону.
 */
export class SphereCoverage {
  readonly covered: Uint8Array;
  private readonly dirs: Vec3[] = [];
  private readonly area: number[] = [];
  private readonly needed: boolean[] = [];
  private total = 0;
  private done = 0;

  constructor(
    readonly cols = 72,
    readonly rows = 36,
    readonly minLat = -70,
  ) {
    this.covered = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = (r + 0.5) / rows;
        const lat = 90 - v * 180;
        this.dirs.push(equirectDirection((c + 0.5) / cols, v));
        const a = Math.cos((lat * Math.PI) / 180);
        this.area.push(a);
        const need = lat >= minLat;
        this.needed.push(need);
        if (need) this.total += a;
      }
    }
  }

  /** Доля ещё не снятого среди того, что сейчас в кадре: больше — тем полезнее снимать. Края кадра не считаем. */
  gain(f: CameraFrustum, margin = 0.85): number {
    let seen = 0;
    let fresh = 0;
    this.dirs.forEach((d, i) => {
      if (!this.needed[i] || !directionInFrame(f, d, margin)) return;
      seen += this.area[i]!;
      if (!this.covered[i]) fresh += this.area[i]!;
    });
    return seen > 0 ? fresh / seen : 0;
  }

  /** Отметить кадр снятым. */
  mark(f: CameraFrustum, margin = 0.85): void {
    this.dirs.forEach((d, i) => {
      if (this.covered[i] || !directionInFrame(f, d, margin)) return;
      this.covered[i] = 1;
      if (this.needed[i]) this.done += this.area[i]!;
    });
  }

  /** Доля нужной части сферы, которая уже снята, по площади, 0…1. */
  get fraction(): number {
    return this.total > 0 ? this.done / this.total : 1;
  }

  /** Ближайшее к взгляду неснятое направление — куда повернуть телефон; null — всё снято. */
  nearestMissing(forward: Vec3): Vec3 | null {
    let best: Vec3 | null = null;
    let bestDot = -Infinity;
    this.dirs.forEach((d, i) => {
      if (this.covered[i] || !this.needed[i]) return;
      const dot = d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2];
      if (dot > bestDot) {
        bestDot = dot;
        best = d;
      }
    });
    return best;
  }

  /** Снято ли направление. */
  coveredAt(dir: Vec3): boolean {
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const lat = Math.asin(Math.max(-1, Math.min(1, dir[1] / len)));
    const lon = Math.atan2(dir[0], -dir[2]);
    const c = Math.min(this.cols - 1, Math.floor(((lon / (2 * Math.PI) + 0.5) * this.cols + this.cols) % this.cols));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * this.rows)));
    return this.covered[r * this.cols + c] === 1;
  }

  reset(): void {
    this.covered.fill(0);
    this.done = 0;
  }
}
