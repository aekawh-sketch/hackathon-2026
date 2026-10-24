// Геометрия съёмки фотосферы — ТЗ 5.4. Ориентация телефона — кватернион, углы Эйлера только для показа.

export interface CaptureTarget {
  id: string;
  /** Азимут относительно первого кадра, −180…180. */
  yaw: number;
  /** Наклон: +90 — зенит, −90 — надир. */
  pitch: number;
}

/** Кватернион [x, y, z, w] — поворот из системы камеры в мировую. */
export type Quat = [number, number, number, number];
export type Vec3 = [number, number, number];

/** Единичный вектор направления по yaw/pitch (мир: x — вправо, y — вперёд, z — вверх). */
export function directionFromAngles(yawDeg: number, pitchDeg: number): Vec3 {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  return [Math.cos(pitch) * Math.sin(yaw), Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch)];
}

export function rotateVector(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // v' = q * v * q^-1, развёрнуто для скорости
  const ix = w * vx + y * vz - z * vy;
  const iy = w * vy + z * vx - x * vz;
  const iz = w * vz + x * vy - y * vx;
  const iw = -x * vx - y * vy - z * vz;
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

/** Угол между направлениями в градусах. Работает у полюсов и через 0°/360°, в отличие от разности углов. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return (Math.acos(dot) * 180) / Math.PI;
}

/**
 * Расстановка целей съёмки полной сферы по полю зрения кадра и перекрытию (ТЗ 5.4, п. 67).
 *
 * @param hfov  горизонтальное поле зрения сохраняемого кадра, градусы (телефон вертикально ≈ 53°)
 * @param vfov  вертикальное поле зрения, градусы (≈ 67°)
 * @param overlap доля перекрытия соседних кадров, 0.3…0.4
 * @returns цели от горизонта к полюсам; последней — надир
 */
export function planCaptureTargets(hfov: number, vfov: number, overlap: number): CaptureTarget[] {
  // TODO: расставить ряды и число кадров в каждом ряду.
  throw new Error(`planCaptureTargets не реализована (hfov=${hfov}, vfov=${vfov}, overlap=${overlap})`);
}
