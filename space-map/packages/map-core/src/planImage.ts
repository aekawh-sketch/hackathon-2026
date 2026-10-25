// Готовый план картинкой: подложка в редакторе и распознавание комнат, стен и дверей по ней.
// Распознавание работает на сетке пикселей: тёмное — стены, светлое — пол, узкий разрыв в стене — дверь.
import { openingSpan, placeDoor, placeEntrance, setOpeningSpan } from './doors.ts';
import { newId, rebuildGraph, UNIT_KIND_NAMES } from './edit.ts';
import { refreshCapturePoints } from './capturePoints.ts';
import { polygonArea } from './geometry.ts';
import type { MapDocument, Underlay, Unit, UnitKind, Vec2 } from './types.ts';

// ── Подложка ──

/** Подложка этажа: картинка плана под рисунком. null — убрать. */
export function setUnderlay(doc: MapDocument, level: string, underlay: Underlay | null): MapDocument {
  return { ...doc, levels: doc.levels.map((l) => (l.id === level ? { ...l, underlay } : l)) };
}

/** Точка плана для пикселя подложки (u вправо, v вниз от левого верхнего угла картинки). */
export function underlayToPlan(underlay: Underlay, u: number, v: number): Vec2 {
  const x = u / underlay.pxPerM;
  const y = -v / underlay.pxPerM;
  const a = (underlay.rotation * Math.PI) / 180;
  return [underlay.origin[0] + x * Math.cos(a) + y * Math.sin(a), underlay.origin[1] - x * Math.sin(a) + y * Math.cos(a)];
}

// ── Распознавание ──

export interface PlanImage {
  /** Яркость пикселей 0…255, построчно сверху вниз. */
  gray: ArrayLike<number>;
  width: number;
  height: number;
  /** Сколько пикселей картинки в метре. */
  pxPerM: number;
}

export interface RecognizeOptions {
  /** Разрывы в стенах до этой ширины — двери, они разделяют комнаты. Метры. */
  doorWidth?: number;
  /** Меньшие комнаты отходят соседям. М². */
  minRoomArea?: number;
  /** Порог яркости стены 0…255; без него — по гистограмме картинки. */
  threshold?: number;
}

export interface RecognizedRoom {
  /** Метры от левого верхнего угла картинки: x вправо, y вверх (то есть y ≤ 0). */
  polygon: Vec2[];
  holes: Vec2[][];
  kind: 'room' | 'corridor';
  /** Комната внутри другой (индекс в rooms): её контур — вырез родителя. */
  parent?: number;
}

export interface RecognizedDoor {
  /** Индексы комнат; одна — вход снаружи. */
  rooms: [number, number] | [number];
  at: Vec2;
  width: number;
}

export interface RecognizedPlan {
  rooms: RecognizedRoom[];
  doors: RecognizedDoor[];
  threshold: number;
}

/** Рабочее разрешение: ≈3 см на пиксель — стена 10 см остаётся толще линии двери, а сетка — небольшой. */
const WORK_PX_PER_M = 30;
/** Больше — дольше секунды-двух в браузере; огромный план считается чуть грубее. */
const MAX_WORK_PIXELS = 4_000_000;
const OUTSIDE = 0;
const UNSET = -1;

export function recognizePlan(image: PlanImage, options: RecognizeOptions = {}): RecognizedPlan {
  const doorWidth = options.doorWidth ?? 1;
  const minRoomArea = options.minRoomArea ?? 1.5;

  // 1. Уменьшаем до рабочего масштаба по самому тёмному пикселю блока: тонкие линии стен не пропадают.
  let k = Math.max(1, Math.round(image.pxPerM / WORK_PX_PER_M));
  while ((image.width / k) * (image.height / k) > MAX_WORK_PIXELS) k++;
  const w = Math.ceil(image.width / k);
  const h = Math.ceil(image.height / k);
  const ppm = image.pxPerM / k;
  const gray = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < image.height; y++) {
    const row = ((y / k) | 0) * w;
    for (let x = 0; x < image.width; x++) {
      const i = row + ((x / k) | 0);
      const g = image.gray[y * image.width + x]!;
      if (g < gray[i]!) gray[i] = g;
    }
  }

  // 2. Стены — всё темнее порога. Мелкие тёмные пятна (буквы, номера, значки) — не стены.
  const threshold = options.threshold ?? Math.min(otsu(gray), 150);
  const wall = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) wall[i] = gray[i]! < threshold ? 1 : 0;
  removeSpecks(wall, w, h, 1.2 * ppm);
  // Стена, нарисованная контуром (две линии), — сплошная: узкие замкнутые просветы закрашиваем.
  fillThinGaps(wall, chamfer(wall, w, h), w, h, 0.12 * ppm * 3);
  // Тонкие линии — дуги дверей, мебель, размерные линии — не стены. Если тонкими нарисованы и сами стены
  // (схема), очистка съела бы большую часть линий — тогда её не делаем.
  const opened = openThin(wall, w, h);
  if (count(opened) > 0.5 * count(wall)) {
    wall.set(opened);
    removeSpecks(wall, w, h, 1.2 * ppm);
  }

  // 3. Расстояние до ближайшей стены (фаска 3-4: 3 — шаг вбок, 4 — по диагонали).
  const dist = chamfer(wall, w, h);

  // 4. Ядра комнат — пол дальше половины двери от стен: двери их не соединяют.
  // Широкий вход с улицы ядро комнаты всё же соединяет с улицей — такую часть делим по более строгому порогу.
  const label = new Int32Array(w * h).fill(UNSET);
  const minCore = (0.4 * ppm) ** 2;
  let rooms = 1;
  let candidate = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) candidate[p] = wall[p] ? 0 : 1;
  const depths = [doorWidth / 2, 0.8, 1.1, 1.5].filter((t, i) => i === 0 || t > doorWidth / 2);
  for (const depth of depths) {
    const limit = depth * ppm * 3;
    const outside = new Uint8Array(w * h);
    for (const part of components(w, h, (p) => candidate[p] === 1 && dist[p]! > limit)) {
      if (part.border) {
        for (const p of part.pixels) outside[p] = 1;
      } else if (part.pixels.length >= minCore) {
        const id = rooms++;
        for (const p of part.pixels) label[p] = id;
      }
    }
    candidate = outside;
  }
  for (let p = 0; p < w * h; p++) if (candidate[p]) label[p] = OUTSIDE;
  // Пол у края картинки — снаружи здания.
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (!wall[y * w + x]) label[y * w + x] = OUTSIDE;
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (!wall[y * w + x]) label[y * w + x] = OUTSIDE;
  const coreLimit = 1.6 * ppm * 3;

  // 5. Заливка пола от ядер по убыванию расстояния до стен: фронты встречаются в самом узком месте — в проёме двери.
  const buckets: number[][] = Array.from({ length: Math.ceil(coreLimit) + 2 }, () => []);
  const top = buckets.length - 1;
  const push = (p: number, level: number) => buckets[Math.min(top, level)]!.push(p);
  for (let p = 0; p < w * h; p++) {
    if (label[p]! < 0) continue;
    const x = p % w;
    const y = (p / w) | 0;
    for (const q of neighbours4(p, x, y, w, h)) {
      if (!wall[q] && label[q] === UNSET) {
        push(p, dist[p]!);
        break;
      }
    }
  }
  const reached = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) if (label[p]! >= 0) reached[p] = 1;
  for (let level = top; level >= 0; level--) {
    const bucket = buckets[level]!;
    while (bucket.length) {
      const p = bucket.pop()!;
      const x = p % w;
      const y = (p / w) | 0;
      for (const q of neighbours4(p, x, y, w, h)) {
        if (wall[q] || label[q] !== UNSET) continue;
        label[q] = label[p]!;
        reached[q] = 1;
        push(q, Math.min(level, dist[q]!));
      }
    }
  }

  // 6. Остальное (стены и недоступный пол) — ближайшей комнате: границы комнат ложатся на середину стен.
  let front: number[] = [];
  for (let p = 0; p < w * h; p++) if (label[p]! >= 0) front.push(p);
  while (front.length) {
    const next: number[] = [];
    for (const p of front) {
      const x = p % w;
      const y = (p / w) | 0;
      for (const q of neighbours4(p, x, y, w, h)) {
        if (label[q] !== UNSET) continue;
        label[q] = label[p]!;
        next.push(q);
      }
    }
    front = next;
  }
  for (let p = 0; p < w * h; p++) if (label[p] === UNSET) label[p] = OUTSIDE;

  // 7. Мелкие комнаты и пустоты внутри мебели отходят соседу с самой длинной общей границей.
  const contactMin = 0.2 * ppm * 3;
  const area = new Map<number, number>();
  for (let p = 0; p < w * h; p++) area.set(label[p]!, (area.get(label[p]!) ?? 0) + 1);
  const remap = new Map<number, number>();
  const find = (l: number): number => {
    let r = l;
    while (remap.has(r)) r = remap.get(r)!;
    return r;
  };
  for (let pass = 0; pass < 3; pass++) {
    const borders = new Map<number, Map<number, number>>();
    const doorsOf = new Map<number, Set<number>>();
    scanPairs(w, h, (p, q) => {
      const a = find(label[p]!);
      const b = find(label[q]!);
      if (a === b) return;
      addCount(borders, a, b);
      addCount(borders, b, a);
      if (reached[p] && reached[q] && Math.min(dist[p]!, dist[q]!) >= contactMin) {
        addSet(doorsOf, a, b);
        addSet(doorsOf, b, a);
      }
    });
    let changed = false;
    for (const [l, size] of [...area].sort((x, y) => x[1] - y[1])) {
      if (l === OUTSIDE || find(l) !== l) continue;
      const near = borders.get(l);
      if (!near || near.size === 0) continue;
      const m2 = size / ppm ** 2;
      const doorless = !doorsOf.get(l)?.size;
      const sole = near.size === 1 && !near.has(OUTSIDE);
      if (m2 >= minRoomArea && !(doorless && sole && m2 < 6)) continue;
      let best = -1;
      let bestLen = -1;
      for (const [n, len] of near) {
        const target = find(n);
        if (target === l) continue;
        if (len > bestLen) {
          best = target;
          bestLen = len;
        }
      }
      if (best < 0) continue;
      remap.set(l, best);
      area.set(best, (area.get(best) ?? 0) + size);
      changed = true;
    }
    if (!changed) break;
  }
  for (let p = 0; p < w * h; p++) label[p] = find(label[p]!);

  // 8. Контуры: внешний и вырезы каждой комнаты, в пикселях.
  const ids = [...new Set(label)].filter((l) => l !== OUTSIDE).sort((a, b) => a - b);
  const rings = new Map<number, { outer: Vec2[]; holes: Vec2[][] }>();
  for (const id of ids) {
    const loops = traceLoops(label, w, h, id);
    if (loops.length === 0) continue;
    loops.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
    rings.set(id, { outer: loops[0]!, holes: loops.slice(1).filter((l) => Math.abs(polygonArea(l)) >= minCore) });
  }

  // 9. Упрощение: лесенка пикселей → отрезки; стены, близкие к вертикали и горизонтали, выпрямляются
  // и сводятся к общим координатам — у соседних комнат общая стена совпадает точно.
  const eps = Math.max(1.5, 0.08 * ppm);
  const all: Vec2[][] = [];
  for (const r of rings.values()) {
    r.outer = squareCorners(douglasPeucker(compress(r.outer), eps), 0.5 * ppm);
    r.holes = r.holes.map((hole) => squareCorners(douglasPeucker(compress(hole), eps), 0.5 * ppm));
    all.push(r.outer, ...r.holes);
  }
  const snapped = orthogonalize(all, 0.25 * ppm);
  let cursor = 0;
  const toMeters = (ring: Vec2[]): Vec2[] => ring.map(([x, y]) => [round2(x / ppm), round2(-y / ppm)]);
  const result: RecognizedRoom[] = [];
  const index = new Map<number, number>();
  for (const id of ids) {
    const r = rings.get(id);
    if (!r) continue;
    const outer = cleanRing(snapped[cursor++]!);
    const holes = r.holes.map(() => cleanRing(snapped[cursor++]!)).filter((ring) => ring.length >= 3);
    if (outer.length < 3) continue;
    const polygon = toMeters(outer);
    const m2 = Math.abs(polygonArea(polygon));
    if (m2 < minRoomArea / 2) continue;
    const perimeter = polygon.reduce((s, p, i) => s + Math.hypot(polygon[(i + 1) % polygon.length]![0] - p[0], polygon[(i + 1) % polygon.length]![1] - p[1]), 0);
    const corridor = (2 * m2) / perimeter < 2.2 && (perimeter * perimeter) / m2 > 24;
    index.set(id, result.length);
    result.push({ polygon, holes: holes.map(toMeters), kind: corridor ? 'corridor' : 'room' });
  }

  // 10. Вложенные комнаты: контур лежит внутри выреза другой.
  for (const [id, i] of index) {
    const sample = firstPixel(label, w, id);
    if (sample < 0) continue;
    const pt: Vec2 = [(sample % w) + 0.5, -((sample / w) | 0) - 0.5].map((v) => v / ppm) as Vec2;
    let parent = -1;
    let parentSize = Infinity;
    for (let j = 0; j < result.length; j++) {
      if (j === i) continue;
      for (const hole of result[j]!.holes) {
        const size = Math.abs(polygonArea(hole));
        if (size < parentSize && inRing(pt, hole)) {
          parent = j;
          parentSize = size;
        }
      }
    }
    if (parent >= 0) result[i]!.parent = parent;
  }

  // 11. Двери — где пол одной комнаты касается пола другой (или улицы) не у самой стены.
  const contacts = new Map<string, Vec2[]>();
  scanPairs(w, h, (p, q) => {
    const a = label[p]!;
    const b = label[q]!;
    if (a === b || !reached[p] || !reached[q] || Math.min(dist[p]!, dist[q]!) < contactMin) return;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const list = contacts.get(key) ?? [];
    list.push([((p % w) + (q % w)) / 2 + 0.5, (((p / w) | 0) + ((q / w) | 0)) / 2 + 0.5]);
    contacts.set(key, list);
  });
  const doors: RecognizedDoor[] = [];
  for (const [key, points] of contacts) {
    const [a, b] = key.split(',').map(Number) as [number, number];
    const ia = a === OUTSIDE ? undefined : index.get(a);
    const ib = index.get(b);
    if (ib === undefined || (a !== OUTSIDE && ia === undefined)) continue;
    for (const cluster of clusters(points, 2.5)) {
      const xs = cluster.map((p) => p[0]);
      const ys = cluster.map((p) => p[1]);
      const extent = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const width = extent / ppm + 2 * 0.2;
      if (width < 0.6) continue;
      const at: Vec2 = [round2(avg(xs) / ppm), round2(-avg(ys) / ppm)];
      doors.push({ rooms: ia === undefined ? [ib] : [ia, ib], at, width: round2(width) });
    }
  }
  return { rooms: result, doors, threshold };
}

/**
 * Распознанный план — в этаж: прежние помещения и двери этажа заменяются, места и панорамы остаются.
 * offset — точка плана, где лежит левый верхний угол картинки.
 */
export function applyRecognizedPlan(doc: MapDocument, level: string, plan: RecognizedPlan, offset: Vec2): { doc: MapDocument; rooms: number; doors: number } {
  const shift = (ring: Vec2[]): Vec2[] => ring.map(([x, y]) => [round2(x + offset[0]), round2(y + offset[1])]);
  let next: MapDocument = { ...doc, units: doc.units.filter((u) => u.level !== level), openings: doc.openings.filter((o) => o.level !== level) };
  const ids: string[] = [];
  const counts = new Map<UnitKind, number>();
  const units: Unit[] = [];
  for (const room of plan.rooms) {
    const id = newId({ ...next, units: [...next.units, ...units] }, 'u');
    const n = (counts.get(room.kind) ?? 0) + 1;
    counts.set(room.kind, n);
    ids.push(id);
    units.push({ id, level, kind: room.kind, name: `${UNIT_KIND_NAMES[room.kind]} ${n}`, walkable: true, polygon: shift(room.polygon), ...(room.holes.length ? { holes: room.holes.map(shift) } : {}) });
  }
  plan.rooms.forEach((room, i) => {
    if (room.parent !== undefined) units[i] = { ...units[i]!, parent: ids[room.parent]! };
  });
  next = { ...next, units: [...next.units, ...units] };

  let doors = 0;
  for (const door of plan.doors) {
    const at: Vec2 = [door.at[0] + offset[0], door.at[1] + offset[1]];
    const preset = { type: door.width >= 1.3 ? ('double' as const) : ('single' as const), openAngle: 90 };
    const placed = door.rooms.length === 2 ? placeDoor(next, ids[door.rooms[0]]!, ids[door.rooms[1]]!, at, preset) : placeEntrance(next, ids[door.rooms[0]]!, at, preset);
    if (!placed) continue;
    // Дверь встаёт по центру свободного участка стены — переносим туда, где она на картинке.
    const span = openingSpan(placed.doc, placed.id);
    let moved = placed.doc;
    if (span) {
      const [a, b] = span.wall;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const t = ((at[0] - a[0]) * (b[0] - a[0]) + (at[1] - a[1]) * (b[1] - a[1])) / len;
      const width = Math.min(1.8, Math.max(0.7, door.width));
      moved = setOpeningSpan(placed.doc, placed.id, t - width / 2, t + width / 2);
    }
    next = moved;
    doors++;
  }
  next = refreshCapturePoints(rebuildGraph(next, level));
  return { doc: next, rooms: units.length, doors };
}

// ── Сетка ──

function neighbours4(p: number, x: number, y: number, w: number, h: number): number[] {
  const out: number[] = [];
  if (x > 0) out.push(p - 1);
  if (x < w - 1) out.push(p + 1);
  if (y > 0) out.push(p - w);
  if (y < h - 1) out.push(p + w);
  return out;
}

/** Связные (по сторонам) области пикселей, где keep(p); border — касается края картинки. */
function components(w: number, h: number, keep: (p: number) => boolean): { pixels: number[]; border: boolean }[] {
  const seen = new Uint8Array(w * h);
  const out: { pixels: number[]; border: boolean }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !keep(start)) continue;
    const pixels: number[] = [];
    let border = false;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      pixels.push(p);
      const x = p % w;
      const y = (p / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      for (const q of neighbours4(p, x, y, w, h)) {
        if (seen[q] || !keep(q)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    out.push({ pixels, border });
  }
  return out;
}

/** Каждая пара соседних пикселей (вправо и вниз) — один раз. */
function scanPairs(w: number, h: number, visit: (p: number, q: number) => void): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (x < w - 1) visit(p, p + 1);
      if (y < h - 1) visit(p, p + w);
    }
  }
}

/** Порог Отсу: делит гистограмму яркости на два класса с наибольшим разбросом между ними. */
function otsu(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const g of gray) hist[g]!++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t + 1;
    }
  }
  return threshold;
}

/** Убирает тёмные пятна, которые целиком помещаются в квадрат size × size пикселей. */
function removeSpecks(wall: Uint8Array, w: number, h: number, size: number): void {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!wall[start] || seen[start]) continue;
    const pixels: number[] = [];
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      pixels.push(p);
      const x = p % w;
      const y = (p / w) | 0;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (wall[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    if (maxX - minX < size && maxY - minY < size) for (const p of pixels) wall[p] = 0;
  }
}

/** Закрашивает замкнутые участки пола, где ни одна точка не дальше maxDist от стены. */
function fillThinGaps(wall: Uint8Array, dist: Int32Array, w: number, h: number, maxDist: number): void {
  for (const part of components(w, h, (p) => !wall[p])) {
    if (part.border || part.pixels.some((p) => dist[p]! > maxDist)) continue;
    for (const p of part.pixels) wall[p] = 1;
  }
}

/** Морфологическое открытие 3 × 3: линии толщиной в 1–2 пикселя пропадают, толстые стены остаются. */
function openThin(wall: Uint8Array, w: number, h: number): Uint8Array {
  const eroded = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      eroded[p] = wall[p - w - 1]! & wall[p - w]! & wall[p - w + 1]! & wall[p - 1]! & wall[p]! & wall[p + 1]! & wall[p + w - 1]! & wall[p + w]! & wall[p + w + 1]!;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!eroded[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out[(y + dy) * w + x + dx] = 1;
    }
  }
  return out;
}

function count(mask: Uint8Array): number {
  let n = 0;
  for (const v of mask) n += v;
  return n;
}

/** Расстояние до стены в единицах фаски 3-4 (≈ 3 на пиксель). Край картинки стеной не считается. */
function chamfer(wall: Uint8Array, w: number, h: number): Int32Array {
  const big = 1 << 28;
  const d = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = wall[i] ? 0 : big;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let v = d[p]!;
      if (x > 0) v = Math.min(v, d[p - 1]! + 3);
      if (y > 0) {
        v = Math.min(v, d[p - w]! + 3);
        if (x > 0) v = Math.min(v, d[p - w - 1]! + 4);
        if (x < w - 1) v = Math.min(v, d[p - w + 1]! + 4);
      }
      d[p] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      let v = d[p]!;
      if (x < w - 1) v = Math.min(v, d[p + 1]! + 3);
      if (y < h - 1) {
        v = Math.min(v, d[p + w]! + 3);
        if (x < w - 1) v = Math.min(v, d[p + w + 1]! + 4);
        if (x > 0) v = Math.min(v, d[p + w - 1]! + 4);
      }
      d[p] = v;
    }
  }
  return d;
}

/**
 * Замкнутые контуры области по границам пикселей; область всегда справа по ходу (y вниз).
 * Внешний контур — самый большой по площади, остальные — вырезы.
 */
function traceLoops(label: Int32Array, w: number, h: number, id: number): Vec2[][] {
  const W = w + 1;
  const next = new Map<number, number[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const key = y0 * W + x0;
    const list = next.get(key);
    const end = y1 * W + x1;
    if (list) list.push(end);
    else next.set(key, [end]);
  };
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? OUTSIDE - 1 : label[y * w + x]!);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (label[y * w + x] !== id) continue;
      if (at(x, y - 1) !== id) add(x, y, x + 1, y);
      if (at(x + 1, y) !== id) add(x + 1, y, x + 1, y + 1);
      if (at(x, y + 1) !== id) add(x + 1, y + 1, x, y + 1);
      if (at(x - 1, y) !== id) add(x, y + 1, x, y);
    }
  }
  const loops: Vec2[][] = [];
  for (const [start, ends] of next) {
    while (ends.length) {
      const loop: Vec2[] = [];
      let from = start;
      let to = ends.pop()!;
      loop.push([from % W, (from / W) | 0]);
      let guard = 0;
      while (to !== start && guard++ < 4 * w * h) {
        loop.push([to % W, (to / W) | 0]);
        const options = next.get(to);
        if (!options || options.length === 0) break;
        // В точке касания двух углов поворачиваем к области (направо): углы не слипаются в один контур.
        let pick = 0;
        if (options.length > 1) {
          const dx = (to % W) - (from % W);
          const dy = ((to / W) | 0) - ((from / W) | 0);
          let bestTurn = -Infinity;
          options.forEach((o, i) => {
            const ex = (o % W) - (to % W);
            const ey = ((o / W) | 0) - ((to / W) | 0);
            const turn = dx * ey - dy * ex; // > 0 — направо при y вниз
            if (turn > bestTurn) {
              bestTurn = turn;
              pick = i;
            }
          });
        }
        from = to;
        to = options.splice(pick, 1)[0]!;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

/** Убирает точки посреди прямых участков. */
function compress(ring: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n]!;
    const b = ring[i]!;
    const c = ring[(i + 1) % n]!;
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
  }
  return out;
}

function douglasPeucker(ring: Vec2[], eps: number): Vec2[] {
  if (ring.length <= 4) return ring;
  // Замкнутый контур делим в самой дальней от первой точке.
  let far = 0;
  let farD = -1;
  ring.forEach((p, i) => {
    const d = (p[0] - ring[0]![0]) ** 2 + (p[1] - ring[0]![1]) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  });
  const first = simplifyChain(ring.slice(0, far + 1), eps);
  const second = simplifyChain([...ring.slice(far), ring[0]!], eps);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

function simplifyChain(points: Vec2[], eps: number): Vec2[] {
  if (points.length <= 2) return points;
  const a = points[0]!;
  const b = points[points.length - 1]!;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let index = 0;
  let maxD = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const d = len < 1e-9 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
    if (d > maxD) {
      maxD = d;
      index = i;
    }
  }
  if (maxD <= eps) return [a, b];
  return [...simplifyChain(points.slice(0, index + 1), eps).slice(0, -1), ...simplifyChain(points.slice(index), eps)];
}

const AXIS_TAN = Math.tan((12 * Math.PI) / 180);

function edgeKind(p: Vec2, q: Vec2): 'h' | 'v' | 'd' {
  const dx = Math.abs(q[0] - p[0]);
  const dy = Math.abs(q[1] - p[1]);
  return dy <= AXIS_TAN * dx ? 'h' : dx <= AXIS_TAN * dy ? 'v' : 'd';
}

/** Короткий скос между горизонтальной и вертикальной стеной — это угол комнаты (так делит угол стены заливка). */
function squareCorners(ring: Vec2[], maxCut: number): Vec2[] {
  let pts = ring;
  for (let changed = true; changed && pts.length > 4; ) {
    changed = false;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % n]!;
      if (edgeKind(a, b) !== 'd' || Math.hypot(b[0] - a[0], b[1] - a[1]) > maxCut) continue;
      const kp = edgeKind(pts[(i - 1 + n) % n]!, a);
      const kn = edgeKind(b, pts[(i + 2) % n]!);
      if (kp === kn || kp === 'd' || kn === 'd') continue;
      const corner: Vec2 = kp === 'h' ? [b[0], a[1]] : [a[0], b[1]];
      const next = pts.slice();
      if (i + 1 < n) next.splice(i, 2, corner);
      else {
        next.splice(i, 1, corner);
        next.splice(0, 1);
      }
      pts = next;
      changed = true;
      break;
    }
  }
  return pts;
}

/**
 * Почти вертикальные и почти горизонтальные стены — строго по осям, с общими координатами для всех контуров:
 * близкие значения (ближе tol) сводятся к одному, взвешенно по длине стен.
 */
function orthogonalize(rings: Vec2[][], tol: number): Vec2[][] {
  const kinds = rings.map((ring) => ring.map((p, i) => edgeKind(p, ring[(i + 1) % ring.length]!)));
  const ys: { v: number; wgt: number }[] = [];
  const xs: { v: number; wgt: number }[] = [];
  rings.forEach((ring, r) =>
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % ring.length]!;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (kinds[r]![i] === 'h') ys.push({ v: (p[1] + q[1]) / 2, wgt: len });
      if (kinds[r]![i] === 'v') xs.push({ v: (p[0] + q[0]) / 2, wgt: len });
    }),
  );
  const snapY = cluster1d(ys, tol);
  const snapX = cluster1d(xs, tol);
  return rings.map((ring, r) => {
    const out: Vec2[] = [];
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const p = ring[i]!;
      const prev = (i - 1 + n) % n;
      const kp = kinds[r]![prev]!;
      const kn = kinds[r]![i]!;
      const edgeY = (e: number) => snapY((ring[e]![1] + ring[(e + 1) % n]![1]) / 2);
      const edgeX = (e: number) => snapX((ring[e]![0] + ring[(e + 1) % n]![0]) / 2);
      if (kp === 'h' && kn === 'h') {
        out.push([p[0], edgeY(prev)], [p[0], edgeY(i)]);
      } else if (kp === 'v' && kn === 'v') {
        out.push([edgeX(prev), p[1]], [edgeX(i), p[1]]);
      } else {
        const x = kp === 'v' ? edgeX(prev) : kn === 'v' ? edgeX(i) : p[0];
        const y = kp === 'h' ? edgeY(prev) : kn === 'h' ? edgeY(i) : p[1];
        out.push([x, y]);
      }
    }
    return out;
  });
}

function cluster1d(values: { v: number; wgt: number }[], tol: number): (v: number) => number {
  const sorted = [...values].sort((a, b) => a.v - b.v);
  const groups: { from: number; to: number; mean: number }[] = [];
  let i = 0;
  while (i < sorted.length) {
    const from = sorted[i]!.v;
    let sum = 0;
    let wsum = 0;
    let to = from;
    while (i < sorted.length && sorted[i]!.v - from <= tol) {
      sum += sorted[i]!.v * Math.max(sorted[i]!.wgt, 1e-6);
      wsum += Math.max(sorted[i]!.wgt, 1e-6);
      to = sorted[i]!.v;
      i++;
    }
    groups.push({ from, to, mean: sum / wsum });
  }
  return (v) => groups.find((g) => v >= g.from - 1e-9 && v <= g.to + 1e-9)?.mean ?? v;
}

/** Без повторов, точек на прямой и «шипов» туда-обратно. */
function cleanRing(ring: Vec2[]): Vec2[] {
  let pts = ring.slice();
  for (let changed = true; changed && pts.length >= 3; ) {
    changed = false;
    const out: Vec2[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = out.length ? out[out.length - 1]! : pts[(i - 1 + n) % n]!;
      const b = pts[i]!;
      const c = pts[(i + 1) % n]!;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) {
        changed = true;
        continue;
      }
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cross) < 1e-6) {
        changed = true;
        continue;
      }
      out.push(b);
    }
    pts = out;
  }
  return pts;
}

function inRing(p: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function firstPixel(label: Int32Array, w: number, id: number): number {
  // Пиксель подальше от края области: середина строки, где область встречается впервые.
  const first = label.indexOf(id);
  if (first < 0) return -1;
  const y = (first / w) | 0;
  let x = first % w;
  while (x + 1 < w && label[y * w + x + 1] === id) x++;
  return y * w + Math.round((first % w + x) / 2);
}

/** Группы точек, где соседние ближе gap (связность по цепочке). */
function clusters(points: Vec2[], gap: number): Vec2[][] {
  const out: Vec2[][] = [];
  const left = points.slice();
  while (left.length) {
    const group = [left.pop()!];
    for (let i = 0; i < group.length; i++) {
      for (let j = left.length - 1; j >= 0; j--) {
        if (Math.hypot(left[j]![0] - group[i]![0], left[j]![1] - group[i]![1]) <= gap) group.push(left.splice(j, 1)[0]!);
      }
    }
    out.push(group);
  }
  return out;
}

function addCount(map: Map<number, Map<number, number>>, a: number, b: number): void {
  const inner = map.get(a) ?? new Map<number, number>();
  inner.set(b, (inner.get(b) ?? 0) + 1);
  map.set(a, inner);
}

function addSet(map: Map<number, Set<number>>, a: number, b: number): void {
  const inner = map.get(a) ?? new Set<number>();
  inner.add(b);
  map.set(a, inner);
}

function avg(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
