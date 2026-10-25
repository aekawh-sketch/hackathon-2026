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

/**
 * QR-код картинкой PNG — распечатать у входа или отправить в чат: чёрный на белом, модуль [scale] пикселей,
 * под кодом — подпись (название карты), чтобы на распечатке было понятно, куда он ведёт.
 */
export function qrPng(text: string, caption = '', scale = 12): Promise<Blob> {
  const { d, size } = qrPath(text);
  const side = size * scale;
  const captionHeight = caption ? scale * 4 : 0;
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side + captionHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Холст недоступен'));
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = '#000';
  ctx.fill(new Path2D(d));
  ctx.restore();
  if (caption) {
    ctx.fillStyle = '#000';
    ctx.font = `600 ${scale * 2}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // Длинное название сжимается до ширины кода, а не вылезает за край.
    ctx.fillText(caption, side / 2, side - scale, side - scale * 8);
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG не собрался'))), 'image/png'));
}
