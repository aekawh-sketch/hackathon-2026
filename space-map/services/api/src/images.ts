// Обработка загруженных изображений (ТЗ 4.2, 6.4): тип — по содержимому, лимит пикселей до декодирования,
// перекодирование. Публичные файлы уходят без метаданных (GPS и т. п.).
import sharp, { type Metadata } from 'sharp';
import { ApiError } from './errors.ts';

const ALLOWED = new Set(['jpeg', 'png', 'webp', 'heif']);

export const PANO_MAX_PIXELS = 140_000_000;
export const FRAME_MAX_PIXELS = 50_000_000;

export interface ImageInfo {
  width: number;
  height: number;
  format: string;
}

export async function inspectImage(data: Buffer, maxPixels: number): Promise<ImageInfo> {
  let meta: Metadata;
  try {
    meta = await sharp(data, { limitInputPixels: maxPixels }).metadata();
  } catch {
    throw new ApiError(422, 'bad_image', 'Файл не похож на изображение или слишком большой');
  }
  if (!meta.format || !ALLOWED.has(meta.format) || !meta.width || !meta.height) {
    throw new ApiError(422, 'bad_image', 'Нужен JPEG, PNG, WebP или HEIC');
  }
  // Ширина и высота с учётом поворота из EXIF.
  const rotated = (meta.orientation ?? 1) >= 5;
  return { width: rotated ? meta.height : meta.width, height: rotated ? meta.width : meta.height, format: meta.format };
}

/** Готовая панорама 2:1 → pano.jpg (до 4096 × 2048) и preview.jpg (1024 × 512), без метаданных. */
export async function processPanorama(data: Buffer, maxWidth = 4096): Promise<{ pano: Buffer; preview: Buffer; width: number; height: number }> {
  const info = await inspectImage(data, PANO_MAX_PIXELS);
  const ratio = info.width / info.height;
  if (Math.abs(ratio - 2) > 0.04) {
    throw new ApiError(422, 'not_equirectangular', `Нужна сферическая панорама с пропорцией 2:1, а у файла ${info.width} × ${info.height}`);
  }
  const width = Math.min(maxWidth, info.width - (info.width % 2));
  const base = sharp(data, { limitInputPixels: PANO_MAX_PIXELS }).rotate();
  const [pano, preview] = await Promise.all([
    base.clone().resize(width, width / 2, { fit: 'fill' }).jpeg({ quality: 84, mozjpeg: true }).toBuffer(),
    base.clone().resize(1024, 512, { fit: 'fill' }).jpeg({ quality: 70, mozjpeg: true }).toBuffer(),
  ]);
  return { pano, preview, width, height: width / 2 };
}

/**
 * Кадр съёмки для склейки: поворот по EXIF применён, EXIF оставлен — по фокусному расстоянию Hugin считает поле зрения.
 * Кадры лежат только в закрытой части хранилища и наружу не отдаются.
 */
export async function processFrame(data: Buffer): Promise<{ jpeg: Buffer; width: number; height: number }> {
  const info = await inspectImage(data, FRAME_MAX_PIXELS);
  const jpeg = await sharp(data, { limitInputPixels: FRAME_MAX_PIXELS }).rotate().keepExif().jpeg({ quality: 92 }).toBuffer();
  return { jpeg, width: info.width, height: info.height };
}
