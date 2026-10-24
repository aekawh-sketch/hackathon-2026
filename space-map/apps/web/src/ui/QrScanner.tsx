// Сканер QR-кода проекта на телефоне: компьютер показывает код (редактор → кнопка с QR-кодом), телефон его читает
// и открывает этот проект здесь — в приложении для Android или в браузере. Камера — getUserMedia, распознаёт jsQR:
// работает везде, где странице дают камеру. Отдельный чанк — открывается по кнопке.
import jsQR from 'jsqr';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from './icons.tsx';

/** Путь кабинета на этом же сайте из прочитанного кода; чужие ссылки и любой другой текст — null. */
export function projectPath(text: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  return url.origin === origin && url.pathname.startsWith('/app/') ? url.pathname + url.search : null;
}

type CameraState = 'starting' | 'scanning' | 'denied' | 'unavailable';

/** Кадр уменьшаем до этой стороны: код с экрана читается и так, а телефон не греется. */
const FRAME_MAX = 640;
const SCAN_EVERY_MS = 150;

export default function QrScanner({ onClose }: { onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const navigate = useNavigate();
  const [camera, setCamera] = useState<CameraState>('starting');
  const [foreign, setForeign] = useState(false);
  // Камера запускается один раз: новые onClose/navigate на каждом рендере родителя её не перезапускают.
  const done = useRef({ onClose, navigate });
  done.current = { onClose, navigate };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let last = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const scan = (t: number) => {
      if (stopped) return;
      raf = requestAnimationFrame(scan);
      const v = video.current;
      if (!ctx || !v || v.readyState < v.HAVE_CURRENT_DATA || !v.videoWidth || t - last < SCAN_EVERY_MS) return;
      last = t;
      const k = Math.min(1, FRAME_MAX / Math.max(v.videoWidth, v.videoHeight));
      const w = Math.round(v.videoWidth * k);
      const h = Math.round(v.videoHeight * k);
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(v, 0, 0, w, h);
      const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      if (!code) return;
      const path = projectPath(code.data, location.origin);
      if (!path) {
        setForeign(true);
        return;
      }
      stopped = true;
      done.current.onClose();
      done.current.navigate(path);
    };

    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('unavailable');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        const v = video.current!;
        v.srcObject = s;
        void v.play().catch(() => {});
        setCamera('scanning');
        raf = requestAnimationFrame(scan);
      })
      .catch((err: unknown) => setCamera(err instanceof DOMException && err.name === 'NotAllowedError' ? 'denied' : 'unavailable'));

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="qr-scan" role="dialog" aria-modal="true" aria-label="Сканировать QR-код проекта">
      <video ref={video} className="qr-scan-video" playsInline muted autoPlay />
      <div className="qr-scan-frame" aria-hidden />
      <button type="button" className="icon-btn qr-scan-close" aria-label="Закрыть" onClick={onClose}>
        <Icon name="close" />
      </button>
      <div className="qr-scan-text">
        {camera === 'denied' ? (
          <p>Нет доступа к камере. Разрешите камеру для этого сайта или приложения в настройках телефона и откройте сканер снова.</p>
        ) : camera === 'unavailable' ? (
          <p>Камера недоступна. Откройте ссылку на проект вручную — её можно скопировать в окне QR-кода на компьютере.</p>
        ) : foreign ? (
          <p>Это не код проекта. Наведите на QR-код из редактора на компьютере.</p>
        ) : (
          <p>Наведите камеру на QR-код на экране компьютера: редактор → кнопка с QR-кодом рядом с «Отменить».</p>
        )}
      </div>
    </div>
  );
}
