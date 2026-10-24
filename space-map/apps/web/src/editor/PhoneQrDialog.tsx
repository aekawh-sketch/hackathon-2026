// QR-код проекта: навести телефон — и этот же проект открывается в редакторе, работа продолжается там
// (снимать фотосферы, ставить места на месте). Отдельный чанк вместе с кодировщиком QR: редактор его не качает,
// пока окно не открыли. В коде только адрес — без входа по нему ничего не открыть.
import { useEffect, useMemo, useState } from 'react';
import { venuesApi } from '../api.ts';
import { useSession } from '../organizer/session.tsx';
import { Icon } from '../ui/icons.tsx';
import { qrPath } from '../ui/qr.ts';

export default function PhoneQrDialog({ venueId, onClose }: { venueId: string; onClose: () => void }) {
  const { user } = useSession();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Гостю подсказка зависит от стенда: при общем доступе гость на телефоне тоже попадёт в проект, без него — нет.
  const [openAccess, setOpenAccess] = useState<boolean | null>(null);
  useEffect(() => {
    if (user?.isGuest) void venuesApi.list().then((r) => setOpenAccess(!!r.openAccess), () => setOpenAccess(null));
  }, [user?.isGuest]);

  const url = `${location.origin}/app/venues/${venueId}`;
  const qr = useMemo(() => qrPath(url), [url]);
  // С телефона адрес компьютера «localhost» ведёт на сам телефон.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

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
      <div className="modal phone-qr-modal" role="dialog" aria-modal="true" aria-label="Открыть на телефоне" onClick={(e) => e.stopPropagation()}>
        <h2>Открыть на телефоне</h2>
        <p>Наведите камеру телефона на код — откроется этот проект.</p>
        <svg className="phone-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" role="img" aria-label="QR-код ссылки на проект">
          <rect width={qr.size} height={qr.size} fill="#fff" />
          <path d={qr.d} fill="#000" />
        </svg>
        {local && <p className="notice">Адрес {location.host} с телефона не откроется — откройте редактор по адресу компьютера в сети или на стенде.</p>}
        {user?.isGuest && openAccess !== null && (
          <p className="hint">
            {openAccess
              ? 'На телефоне войдите тоже без регистрации — проект откроется.'
              : 'Вход без регистрации — только в этом браузере: сохраните аккаунт в «Моих площадках» и войдите на телефоне по почте.'}
          </p>
        )}
        <label className="field">
          <span>Ссылка</span>
          <div className="copy-row">
            <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn btn-secondary" onClick={() => void copy()}>
              <Icon name={copied ? 'check' : 'copy'} size={17} /> {copied ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
        </label>
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
