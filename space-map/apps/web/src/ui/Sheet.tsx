// Шторка поверх карты: на телефоне выдвигается снизу и тянется пальцем (свёрнута / по содержимому / во весь экран),
// на широком экране — плавающая панель слева.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

export type SheetMode = 'peek' | 'auto' | 'full';

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

function useViewportHeight(): number {
  const [h, setH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800));
  useEffect(() => {
    const on = () => setH(window.visualViewport?.height ?? window.innerHeight);
    on();
    window.addEventListener('resize', on);
    window.visualViewport?.addEventListener('resize', on);
    return () => {
      window.removeEventListener('resize', on);
      window.visualViewport?.removeEventListener('resize', on);
    };
  }, []);
  return h;
}

export interface SheetProps {
  mode: SheetMode;
  onModeChange: (mode: SheetMode) => void;
  /** Широкий экран — панель слева без жестов. */
  desktop: boolean;
  /** Высота свёрнутой шторки, px. */
  peekHeight?: number;
  /** Отступ сверху во весь экран (под шапкой). */
  topGap?: number;
  header?: ReactNode;
  children: ReactNode;
  /** Видимая высота шторки (телефон) — чтобы карта вписывалась над ней. */
  onHeight?: (px: number) => void;
  label: string;
  className?: string;
}

export function Sheet({ mode, onModeChange, desktop, peekHeight = 164, topGap = 76, header, children, onHeight, label, className = '' }: SheetProps) {
  const vh = useViewportHeight();
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentH, setContentH] = useState(0);
  const [drag, setDrag] = useState<{ startY: number; startH: number; h: number; moved: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContentH(el.scrollHeight));
    ro.observe(el);
    setContentH(el.scrollHeight);
    return () => ro.disconnect();
  }, [desktop]);

  const full = Math.max(vh - topGap, peekHeight + 40);
  const grab = 30; // ручка и отступы над содержимым
  const auto = Math.min(Math.max(contentH + grab + 22, peekHeight), Math.round(vh * 0.66), full);
  const target = mode === 'peek' ? peekHeight : mode === 'full' ? full : auto;
  const height = drag ? drag.h : target;

  useEffect(() => {
    onHeight?.(desktop ? 0 : drag ? drag.startH : target);
  }, [desktop, target, drag === null]);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (desktop) return;
    if ((e.target as HTMLElement).closest('button, input, textarea, select, a')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ startY: e.clientY, startH: target, h: target, moved: false });
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    const h = Math.min(full, Math.max(88, drag.startH - dy));
    setDrag({ ...drag, h, moved: drag.moved || Math.abs(dy) > 6 });
  };
  const onUp = () => {
    if (!drag) return;
    const snaps: [SheetMode, number][] = [
      ['peek', peekHeight],
      ['auto', auto],
      ['full', full],
    ];
    let next: SheetMode;
    if (!drag.moved) {
      next = mode === 'peek' ? 'auto' : mode === 'full' ? 'peek' : auto >= full - 4 ? 'peek' : 'full';
    } else {
      next = snaps.reduce((best, cur) => (Math.abs(cur[1] - drag.h) < Math.abs(best[1] - drag.h) ? cur : best))[0];
    }
    setDrag(null);
    if (next !== mode) onModeChange(next);
  };

  if (desktop) {
    return (
      <aside className={`panel ${className}`} aria-label={label}>
        {header}
        <div className="panel-body" ref={contentRef}>
          {children}
        </div>
      </aside>
    );
  }

  return (
    <section
      className={`sheet ${drag ? 'is-dragging' : ''} ${className}`}
      style={{ height }}
      aria-label={label}
    >
      <div className="sheet-grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="sheet-handle" aria-hidden />
        {header}
      </div>
      <div className="sheet-body">
        <div ref={contentRef}>{children}</div>
      </div>
    </section>
  );
}
