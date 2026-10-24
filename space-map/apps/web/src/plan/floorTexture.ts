// 2D-план этажа в canvas — текстура пола в 3D: та же схема, что на плане (заливки помещений, сетка, зоны,
// двери с дугой открывания, подписи), только в цветах пола 3D — светлые цвета плана под светом выцветают в белое.
import { doorLeaves, doorStyleOf, type MapDocument, type Vec2 } from '@space-map/map-core';
import { LABEL, OBSTACLE_FILL, OBSTACLE_STROKE, PLAN_BG, UNIT_FLOOR_3D, WALL } from './style.ts';

export interface FloorPlan {
  canvas: HTMLCanvasElement;
  /** Какой прямоугольник плана (м) покрывает canvas: левый нижний угол и размер. */
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/** Пикселей на метр: подписи читаются, а текстура большого зала не выходит за 4096 px — предел многих телефонов. */
const PX_PER_M = 64;
const MAX_SIDE = 4096;
const PAD = 0.5;
const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function drawFloorPlan(doc: MapDocument, level: string): FloorPlan | null {
  const units = doc.units.filter((u) => u.level === level);
  if (!units.length) return null;
  const pts = units.flatMap((u) => u.polygon);
  const minX = Math.min(...pts.map((p) => p[0])) - PAD;
  const minY = Math.min(...pts.map((p) => p[1])) - PAD;
  const maxX = Math.max(...pts.map((p) => p[0])) + PAD;
  const maxY = Math.max(...pts.map((p) => p[1])) + PAD;
  const width = maxX - minX;
  const height = maxY - minY;
  const ppm = Math.min(PX_PER_M, MAX_SIDE / Math.max(width, height));

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * ppm);
  canvas.height = Math.ceil(height * ppm);
  const ctx = canvas.getContext('2d')!;
  // Рисуем в метрах плана: y плана смотрит вверх, у canvas — вниз.
  const toPlan = () => ctx.setTransform(ppm, 0, 0, -ppm, -minX * ppm, maxY * ppm);
  const toPixels = () => ctx.setTransform(1, 0, 0, 1, 0, 0);
  const px = (p: Vec2): Vec2 => [(p[0] - minX) * ppm, (maxY - p[1]) * ppm];
  const path = (poly: Vec2[]) => {
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };

  toPlan();
  ctx.fillStyle = PLAN_BG;
  ctx.fillRect(minX, minY, width, height);

  // Помещения по порядку документа, вырез — сразу поверх своего: вложенная комната дальше закрасит свой пол.
  for (const u of units) {
    path(u.polygon);
    ctx.fillStyle = UNIT_FLOOR_3D[u.kind];
    ctx.fill();
    for (const h of u.holes ?? []) {
      path(h);
      ctx.fillStyle = PLAN_BG;
      ctx.fill();
    }
  }

  // Сетка 1 м точками, как фон 2D-плана, — по ней на полу видно масштаб.
  ctx.fillStyle = 'rgba(31, 42, 61, 0.16)';
  const dot = 0.035;
  for (let x = Math.ceil(minX); x <= maxX; x++) for (let y = Math.ceil(minY); y <= maxY; y++) ctx.fillRect(x - dot, y - dot, dot * 2, dot * 2);

  for (const o of doc.obstacles) {
    if (o.level !== level) continue;
    path(o.polygon);
    ctx.fillStyle = OBSTACLE_FILL;
    ctx.fill();
    ctx.strokeStyle = OBSTACLE_STROKE;
    ctx.lineWidth = 1 / ppm;
    ctx.stroke();
  }

  // Зоны: заливка цветом категории и пунктирная граница; «дорожка» — серой линией без заливки.
  const categories = new Map(doc.categories.map((c) => [c.id, c]));
  const zones = doc.places.filter((p) => p.level === level && !p.hidden && p.polygon);
  for (const z of zones) {
    const color = categories.get(z.category)?.color ?? '#4A5568';
    const track = z.category === 'track';
    path(z.polygon!);
    if (!track) {
      ctx.globalAlpha = 0.26;
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.globalAlpha = track ? 0.75 : 0.9;
    ctx.strokeStyle = track ? '#8993A1' : color;
    ctx.lineWidth = 0.05;
    ctx.setLineDash([0.25, 0.2]);
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Двери: полотно от петли и пунктирная дуга открывания, как на архитектурном плане.
  ctx.strokeStyle = WALL;
  ctx.lineCap = 'round';
  for (const o of doc.openings) {
    if (o.level !== level) continue;
    const style = doorStyleOf(doc, o);
    if (!style) continue;
    for (const leaf of doorLeaves(o, style)) {
      const start = Math.atan2(leaf.closedTip[1] - leaf.hinge[1], leaf.closedTip[0] - leaf.hinge[0]);
      let sweep = leaf.angle - start;
      if (sweep > Math.PI) sweep -= 2 * Math.PI;
      if (sweep < -Math.PI) sweep += 2 * Math.PI;
      if (Math.abs(sweep) > 0.02) {
        ctx.beginPath();
        ctx.arc(leaf.hinge[0], leaf.hinge[1], leaf.length, start, start + sweep, sweep < 0);
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 0.025;
        ctx.setLineDash([0.08, 0.08]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.moveTo(leaf.hinge[0], leaf.hinge[1]);
      ctx.lineTo(leaf.openTip[0], leaf.openTip[1]);
      ctx.lineWidth = 0.05;
      ctx.stroke();
    }
  }

  // Подписи — в пикселях, иначе текст встал бы вверх ногами.
  toPixels();
  const fit = (text: string, max: number) => {
    if (ctx.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
    return `${t}…`;
  };
  // Названия помещений — в левом верхнем углу, как на плане: середина остаётся местам.
  ctx.fillStyle = LABEL;
  ctx.textBaseline = 'top';
  ctx.font = `700 ${Math.round(0.42 * ppm)}px ${FONT}`;
  ctx.letterSpacing = `${Math.round(0.03 * ppm)}px`;
  for (const u of units) {
    const left = Math.min(...u.polygon.map((p) => p[0]));
    const right = Math.max(...u.polygon.map((p) => p[0]));
    const top = Math.max(...u.polygon.map((p) => p[1]));
    const room = (right - left - 0.7) * ppm;
    if (room < 1.5 * ppm) continue;
    const [x, y] = px([left + 0.35, top - 0.3]);
    ctx.fillText(fit(u.name.toUpperCase(), room), x, y);
  }
  ctx.letterSpacing = '0px';
  // Названия зон — по центру, с белой обводкой, если влезают.
  ctx.font = `700 ${Math.round(0.36 * ppm)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const z of zones) {
    const xs = z.polygon!.map((p) => p[0]);
    const room = (Math.max(...xs) - Math.min(...xs) - 0.3) * ppm;
    if (room < 1.2 * ppm) continue;
    const text = fit(z.name, room);
    const [x, y] = px(z.pos);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 0.12 * ppm;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = '#273247';
    ctx.fillText(text, x, y);
  }
  return { canvas, minX, minY, width, height };
}
