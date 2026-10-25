// QR-код опубликованной карты: гость наводит телефон — и карта открыта. Распечатать у входа, показать на экране,
// отправить в чат. Отдельный чанк вместе с кодировщиком: окно публикации его не качает, пока карта не опубликована.
import { useMemo, useState } from 'react';
import { Icon } from './icons.tsx';
import { qrPath, qrPng } from './qr.ts';

export default function ShareQr({ url, title, fileName, closed }: { url: string; title: string; fileName: string; closed: boolean }) {
  const qr = useMemo(() => qrPath(url), [url]);
  const [error, setError] = useState<string | null>(null);
  // Системное «Поделиться» есть в браузерах телефона и Safari; на компьютере в Chrome его обычно нет.
  const canShare = typeof navigator.share === 'function';

  const download = async () => {
    setError(null);
    try {
      const href = URL.createObjectURL(await qrPng(url, title));
      const a = document.createElement('a');
      a.href = href;
      a.download = `qr-${fileName}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      setError('Не удалось сохранить картинку — сделайте снимок экрана с кодом');
    }
  };

  const share = async () => {
    setError(null);
    try {
      const file = new File([await qrPng(url, title)], `qr-${fileName}.png`, { type: 'image/png' });
      // Мессенджеры на телефоне принимают картинку — шлём код вместе со ссылкой; где файлы нельзя — только ссылку.
      await navigator.share(navigator.canShare?.({ files: [file] }) ? { title, text: `${title}: ${url}`, files: [file] } : { title, url });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) setError('Не удалось поделиться — скопируйте ссылку выше');
    }
  };

  return (
    <div className="share-qr">
      <svg className="share-qr-code" viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" role="img" aria-label="QR-код ссылки на карту">
        <rect width={qr.size} height={qr.size} fill="#fff" />
        <path d={qr.d} fill="#000" />
      </svg>
      <div className="share-qr-side">
        <p>
          <b>QR-код карты.</b> Наведите камеру телефона — карта откроется без входа и установки. Код можно распечатать у входа или отправить в чат.
        </p>
        {closed && <p className="hint">Карта закрыта: по коду её откроют только вы и администраторы.</p>}
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={() => void download()}>
            <Icon name="download" size={17} /> Скачать PNG
          </button>
          {canShare && (
            <button type="button" className="btn btn-secondary" onClick={() => void share()}>
              <Icon name="share" size={17} /> Поделиться
            </button>
          )}
        </div>
        {error && <p className="notice">{error}</p>}
      </div>
    </div>
  );
}
