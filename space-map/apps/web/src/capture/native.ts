// Приложение «Карта пространства» для Android (apps/android): этот же сайт в WebView плюс встроенная съёмка
// фотосферы (модуль из 360-photo-app, MIT): по гироскопу, без ARCore, с уточнением склейки по картинке.
// Мост: страница вызывает `SpaceMapAndroid.capturePhotoSphere(id)`, приложение отвечает `window.__spaceMapNative(id, …)`,
// а сам снимок отдаёт по адресу на этом же домене — его забираем обычным fetch.

interface AndroidBridge {
  capturePhotoSphere(requestId: string): void;
  version(): string;
}

type NativeResult = { url: string; width: number; height: number } | { cancelled: true; reason?: string };

declare global {
  interface Window {
    SpaceMapAndroid?: AndroidBridge;
    __spaceMapNative?: (requestId: string, result: NativeResult) => void;
  }
}

/** Где скачать приложение: APK лежит на стенде рядом с сайтом. */
export const APP_APK_URL = '/downloads/space-map.apk';

/** Страница открыта в приложении — съёмка фотосферы встроена. */
export function hasNativeCapture(): boolean {
  return typeof window !== 'undefined' && typeof window.SpaceMapAndroid?.capturePhotoSphere === 'function';
}

export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/** Съёмку отменили: `user` — закрыли экран, `camera` — нет права на камеру, `busy` — уже идёт другая. */
export class NativeCaptureCancelled extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

const waiting = new Map<string, (result: NativeResult) => void>();

/** Снять фотосферу в приложении: JPEG 2:1. Направления в нём нет — его задают по двери. */
export async function captureNativeSphere(): Promise<Blob> {
  const bridge = window.SpaceMapAndroid;
  if (!bridge) throw new Error('Съёмка доступна только в приложении');
  window.__spaceMapNative ??= (id, result) => {
    waiting.get(id)?.(result);
    waiting.delete(id);
  };
  const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const result = await new Promise<NativeResult>((resolve) => {
    waiting.set(id, resolve);
    bridge.capturePhotoSphere(id);
  });
  if ('cancelled' in result) throw new NativeCaptureCancelled(result.reason ?? 'user');
  const res = await fetch(result.url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Приложение не отдало снимок');
  return res.blob();
}

/** Что сказать человеку, если съёмка не состоялась. */
export function cancelText(err: unknown): string {
  if (err instanceof NativeCaptureCancelled) {
    if (err.reason === 'camera') return 'Без доступа к камере не снять — разрешите его приложению в настройках.';
    if (err.reason === 'busy') return 'Съёмка уже идёт.';
    return 'Съёмка отменена.';
  }
  return err instanceof Error ? err.message : 'Съёмка не удалась.';
}
