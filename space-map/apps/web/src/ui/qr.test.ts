import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { qrPath } from './qr.ts';
import { projectPath } from './QrScanner.tsx';

/** Растр из пути, как его нарисует браузер: каждый модуль — scale×scale пикселей. */
function rasterize({ d, size }: { d: string; size: number }, scale = 4) {
  const w = size * scale;
  const rgba = new Uint8ClampedArray(w * w * 4).fill(255);
  for (const [, x, y, len] of d.matchAll(/M(\d+) (\d+)h(\d+)v1H\d+z/g)) {
    for (let py = +y! * scale; py < (+y! + 1) * scale; py++) {
      for (let px = +x! * scale; px < (+x! + +len!) * scale; px++) rgba.fill(0, (py * w + px) * 4, (py * w + px) * 4 + 3);
    }
  }
  return { rgba, w };
}

describe('QR-код проекта', () => {
  it('камера читает из него ровно ссылку на проект', () => {
    const url = 'https://193-233-88-64.sslip.io/app/venues/0b9c2f4e-7a1d-4e3b-9c55-2f1a8d6e4b70';
    const { rgba, w } = rasterize(qrPath(url));
    expect(jsQR(rgba, w, w)?.data).toBe(url);
  });

  it('путь состоит только из прямоугольников модулей, вокруг — белая рамка', () => {
    const { d, size } = qrPath('https://example.org/app/venues/1');
    expect(d).toMatch(/^(M\d+ \d+h\d+v1H\d+z)+$/);
    const xs = [...d.matchAll(/M(\d+) (\d+)h(\d+)/g)].map(([, x, y, len]) => [+x!, +y!, +x! + +len!]);
    expect(Math.min(...xs.map(([x]) => x!))).toBe(4);
    expect(Math.min(...xs.map(([, y]) => y!))).toBe(4);
    expect(Math.max(...xs.map(([, , end]) => end!))).toBe(size - 4);
  });
});

describe('сканер на телефоне', () => {
  const site = 'https://193-233-88-64.sslip.io';

  it('открывает только проекты и карты своего сайта', () => {
    expect(projectPath(`${site}/app/venues/abc`, site)).toBe('/app/venues/abc');
    expect(projectPath(`${site}/app/venues/abc?x=1`, site)).toBe('/app/venues/abc?x=1');
    expect(projectPath('https://evil.example/app/venues/abc', site)).toBeNull();
    // Опубликованная карта своего сайта — тоже: гость сканирует код у входа.
    expect(projectPath(`${site}/m/demo`, site)).toBe('/m/demo');
    expect(projectPath('https://evil.example/m/demo', site)).toBeNull();
    expect(projectPath('просто текст', site)).toBeNull();
  });

  it('читает тот же код, что показывает компьютер', () => {
    const url = `${site}/app/venues/0b9c2f4e-7a1d-4e3b-9c55-2f1a8d6e4b70`;
    const { rgba, w } = rasterize(qrPath(url));
    expect(projectPath(jsQR(rgba, w, w, { inversionAttempts: 'dontInvert' })!.data, site)).toBe('/app/venues/0b9c2f4e-7a1d-4e3b-9c55-2f1a8d6e4b70');
  });
});
