// Публикация: постоянная ссылка и код для сайта (ТЗ 5.11). Ссылка не меняется при правках.
import { useEffect, useState } from 'react';
import { ApiError, venuesApi, type VenueSummary } from '../api.ts';
import { Icon } from '../ui/icons.tsx';

export function PublishDialog({ venue, onClose, onPublished }: { venue: VenueSummary; onClose: () => void; onPublished: (v: VenueSummary) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const url = `${location.origin}/m/${venue.slug}`;
  const iframe = `<iframe src="${url}" width="100%" height="600" style="border:0;border-radius:12px" allow="fullscreen; gyroscope; accelerometer" loading="lazy" title="${escapeAttr(venue.name)}"></iframe>`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      const { version } = await venuesApi.publish(venue.id);
      onPublished({ ...venue, publishedVersion: version });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось опубликовать');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setError('Не удалось скопировать — выделите текст и скопируйте вручную');
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal publish-modal" role="dialog" aria-modal="true" aria-label="Публикация" onClick={(e) => e.stopPropagation()}>
        <h2>{venue.publishedVersion === null ? 'Опубликовать карту' : 'Карта опубликована'}</h2>
        {venue.publishedVersion === null ? (
          <>
            <p>После публикации карту можно открыть по ссылке без входа. Дальше каждое сохранение в редакторе сразу обновляет её — ссылка остаётся той же.</p>
            {error && <p className="notice">{error}</p>}
            <div className="row end">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Позже
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={publish}>
                {busy ? 'Публикуем…' : 'Опубликовать'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="hint">Версия {venue.publishedVersion}. Правки в редакторе обновляют карту по этой же ссылке.</p>
            <label className="field">
              <span>Ссылка для посетителей</span>
              <div className="copy-row">
                <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="btn btn-secondary" onClick={() => copy(url, 'url')}>
                  <Icon name={copied === 'url' ? 'check' : 'copy'} size={17} /> {copied === 'url' ? 'Скопировано' : 'Копировать'}
                </button>
              </div>
            </label>
            <label className="field">
              <span>Код для сайта</span>
              <textarea readOnly rows={4} value={iframe} onFocus={(e) => e.currentTarget.select()} />
            </label>
            {error && <p className="notice">{error}</p>}
            <div className="row end">
              <button type="button" className="btn btn-secondary" onClick={() => copy(iframe, 'iframe')}>
                <Icon name={copied === 'iframe' ? 'check' : 'copy'} size={17} /> {copied === 'iframe' ? 'Скопировано' : 'Копировать код'}
              </button>
              <a className="btn btn-primary" href={url} target="_blank" rel="noreferrer">
                <Icon name="external" size={17} /> Открыть карту
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
