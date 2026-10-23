import { describe, expect, it } from 'vitest';
import { fitBounds, screenToWorld, worldToScreen, zoomAt, type Viewport } from './viewport.ts';

describe('viewport', () => {
  const v: Viewport = { scale: 25, x: 40, y: 300 };

  it('план → экран → план обратимо', () => {
    const p: [number, number] = [12.34, -5.6];
    const back = screenToWorld(v, worldToScreen(v, p));
    expect(back[0]).toBeCloseTo(p[0]);
    expect(back[1]).toBeCloseTo(p[1]);
  });

  it('y плана вверх, y экрана вниз', () => {
    expect(worldToScreen(v, [0, 1])[1]).toBeLessThan(worldToScreen(v, [0, 0])[1]);
  });

  it('зум оставляет точку под пальцем на месте', () => {
    const at: [number, number] = [200, 150];
    const before = screenToWorld(v, at);
    const after = screenToWorld(zoomAt(v, at, 1.7), at);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  it('«показать всё» вписывает план в экран', () => {
    const fit = fitBounds({ minX: 0, minY: 0, maxX: 30, maxY: 14 }, 390, 600, 20);
    const [x0, y0] = worldToScreen(fit, [0, 14]);
    const [x1, y1] = worldToScreen(fit, [30, 0]);
    expect(x0).toBeGreaterThanOrEqual(19.9);
    expect(x1).toBeLessThanOrEqual(370.1);
    expect(y0).toBeGreaterThanOrEqual(0);
    expect(y1).toBeLessThanOrEqual(600);
  });
});
