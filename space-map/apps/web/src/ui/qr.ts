// QR-код в SVG: кодирует uqr, рисуем сами — один путь вместо сотен квадратов.
import { encode } from 'uqr';

/** Тёмные модули QR одним путём SVG: подряд идущие в строке сливаются в один прямоугольник. Рамка — 4 модуля, как требует стандарт. */
export function qrPath(text: string): { d: string; size: number } {
  const { data, size } = encode(text, { ecc: 'M', border: 4 });
  let d = '';
  data.forEach((row, y) => {
    for (let x = 0; x < size; x++) {
      if (!row[x]) continue;
      const start = x;
      while (x + 1 < size && row[x + 1]) x++;
      d += `M${start} ${y}h${x - start + 1}v1H${start}z`;
    }
  });
  return { d, size };
}
