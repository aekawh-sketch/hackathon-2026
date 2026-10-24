// Подтверждение необратимого на вид действия (удалить место, панораму, убрать точку съёмки).
// Окно выносится в body: шторка и панель свойств прокручиваются и могут обрезать или сдвинуть fixed-слой.
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return createPortal(
    <div className="modal-scrim" onClick={onCancel}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="modal-text">{children}</div>
        <div className="row end">
          <button type="button" className="btn btn-ghost" onClick={onCancel} autoFocus>
            Отмена
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              onConfirm();
              onCancel();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
