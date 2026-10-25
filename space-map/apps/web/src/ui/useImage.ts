import { useEffect, useState } from 'react';

/** Картинка по адресу: null, пока не загрузилась или не удалось. */
export function useImage(src: string | null): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    setImage(null);
    if (!src) return;
    let alive = true;
    const img = new Image();
    img.onload = () => alive && setImage(img);
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src]);
  return image;
}

/** Та же картинка в негативе — подложка в тёмной теме: светлые линии на тёмном. */
export function invertedCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = 255 - px[i]!;
    px[i + 1] = 255 - px[i + 1]!;
    px[i + 2] = 255 - px[i + 2]!;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/** Яркость пикселей картинки 0…255 — для распознавания плана. */
export function grayPixels(img: HTMLImageElement): { gray: Uint8Array; width: number; height: number } {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const gray = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (px[i]! * 77 + px[i + 1]! * 150 + px[i + 2]! * 29) >> 8;
  return { gray, width: canvas.width, height: canvas.height };
}
