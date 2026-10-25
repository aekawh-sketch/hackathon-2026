import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui/icons.tsx';
import { FloorSettings, ProjectSettings, type InspectorProps } from './Inspector.tsx';

export function EditorSettingsDialog({ kind, onClose, inspector }: { kind: 'project' | 'floor'; onClose: () => void; inspector: InspectorProps }) {
  const ref = useRef<HTMLDivElement>(null);
  const title = kind === 'project' ? 'Настройки площадки' : 'Настройки этажа';
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (ref.current?.querySelector<HTMLElement>('input, select') ?? ref.current?.querySelector<HTMLElement>('button'))?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelectorAll('[role="dialog"][aria-modal="true"]').length > 1) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const controls = [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, a[href]') ?? [])].filter((el) => el.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (!document.querySelector('[role="dialog"][aria-modal="true"]')) previous?.focus();
    };
  }, [onClose]);
  return createPortal(<div className="modal-scrim" onClick={onClose}>
    <div ref={ref} className="modal editor-settings-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
      <div className="editor-settings-head"><h2>{title}</h2><button type="button" className="icon-btn" aria-label="Закрыть настройки" onClick={onClose}><Icon name="close" /></button></div>
      {kind === 'project' ? <ProjectSettings {...inspector} onSelect={(selection) => { inspector.onExitTool(); inspector.onSelect(selection); onClose(); }} /> : <FloorSettings {...inspector} />}
    </div>
  </div>, document.body);
}
