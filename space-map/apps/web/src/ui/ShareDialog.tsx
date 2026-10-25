// «Поделиться картой» для посетителя: ссылка, QR-код, картинка кода и системное «Поделиться». Отдельный чанк вместе
// с кодировщиком QR — карта и каталог его не качают, пока окно не открыли.
import { useEffect, useState } from 'react';
import { Icon } from './icons.tsx';
import ShareQr from './ShareQr.tsx';

export default function ShareDialog({ url, title, fileName, onClose }: { url: string; title: string; fileName: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Не удалось скопировать — выделите ссылку и скопируйте вручную');
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal publish-modal" role="dialog" aria-modal="true" aria-label="Поделиться картой" onClick={(e) => e.stopPropagation()}>
        <h2>Поделиться картой</h2>
        <p className="hint">{title}</p>
        <label className="field">
          <span>Ссылка</span>
          <div className="copy-row">
            <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn btn-secondary" onClick={() => void copy()}>
              <Icon name={copied ? 'check' : 'copy'} size={17} /> {copied ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
        </label>
        <ShareQr url={url} title={title} fileName={fileName} closed={false} />
        {error && <p className="notice">{error}</p>}
        <div className="row end">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
