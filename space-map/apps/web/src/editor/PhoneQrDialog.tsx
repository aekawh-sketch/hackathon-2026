// QR-код проекта: навести телефон — и этот же проект открывается в редакторе, работа продолжается там
// (снимать фотосферы, ставить места на месте). Отдельный чанк вместе с кодировщиком QR: редактор его не качает,
// пока окно не открыли. В коде только адрес — без входа по нему ничего не открыть.
import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../organizer/session.tsx';
import { Icon } from '../ui/icons.tsx';
import { qrPath } from '../ui/qr.ts';

export default function PhoneQrDialog({ venueId, onClose }: { venueId: string; onClose: () => void }) {
  const { user } = useSession();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <h2>Продолжить на телефоне</h2>
        <p>На телефоне в приложении нажмите «Сканировать» в «Моих площадках» или кнопку с QR-кодом в редакторе и наведите на код — откроется этот проект. Подойдёт и обычная камера телефона. Если на телефоне ещё не входили, войдите: проект откроется сразу после входа.</p>
        <svg className="phone-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" role="img" aria-label="QR-код ссылки на проект">
          <rect width={qr.size} height={qr.size} fill="#fff" />
          <path d={qr.d} fill="#000" />
        </svg>
        <p className="hint">С обычной камеры проект откроется в приложении «Карта пространства», если оно стоит, — там же снимаются фотосферы.</p>
        {local && <p className="notice">Редактор открыт по адресу {location.host} — с телефона он не откроется. Откройте редактор по адресу компьютера в сети или на стенде.</p>}
        {user?.isGuest && (
          <p className="guest-note">
            Вы вошли без регистрации — такой вход есть только в этом браузере. Если на телефоне проект не откроется, сохраните аккаунт в «Моих площадках» и войдите на телефоне по той же почте.
          </p>
        )}
        <label className="field">
          <span>Ссылка на проект</span>
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
