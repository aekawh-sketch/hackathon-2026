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

interface Drag {
  startX: number;
  startY: number;
  startH: number;
  /** Прокрутка содержимого в начале жеста — выше «во весь экран» палец листает содержимое. */
  startScroll: number;
  /** Жест начат на содержимом, а не на ручке. */
  fromBody: boolean;
  /** Палец сдвинулся по вертикали — шторка едет; до этого жест может оказаться нажатием или прокруткой вбок. */
  active: boolean;
  pointerId: number;
  /** Положения пальца за последние ~100 мс — скорость взмаха. */
  samples: { y: number; t: number }[];
  h: number;
}

/** Быстрее этого (px/мс) — взмах: шторка уходит к следующей высоте по направлению, а не к ближайшей. */
const FLING = 0.35;
/** С какого сдвига (px) касание становится перетаскиванием. */
const SLOP = 6;

export function Sheet({ mode, onModeChange, desktop, peekHeight = 164, topGap = 76, header, children, onHeight, label, className = '' }: SheetProps) {
  const vh = useViewportHeight();
  const sheetRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentH, setContentH] = useState(0);

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

  useEffect(() => {
    onHeight?.(desktop ? 0 : target);
  }, [desktop, target]);

  // Жест живёт вне React: высота меняется прямо в DOM раз в кадр, без перерисовки панели на каждое движение пальца.
  const live = useRef({ mode, target, full, auto, peekHeight, onModeChange });
  live.current = { mode, target, full, auto, peekHeight, onModeChange };
  const drag = useRef<Drag | null>(null);
  const frame = useRef(0);
  const clickBlockedUntil = useRef(0);

  /** Высоты, к которым шторка прилипает; «по содержимому» — только если она заметно отличается от соседних. */
  const snaps = (): [SheetMode, number][] => {
    const l = live.current;
    const list: [SheetMode, number][] = [['peek', l.peekHeight]];
    if (l.auto - l.peekHeight > 40 && l.full - l.auto > 40) list.push(['auto', l.auto]);
    list.push(['full', l.full]);
    return list;
  };

  const begin = (x: number, y: number, pointerId: number, fromBody: boolean) => {
    drag.current = { startX: x, startY: y, startH: 0, startScroll: 0, fromBody, active: false, pointerId, samples: [{ y, t: performance.now() }], h: 0 };
  };

  const activate = (d: Drag) => {
    const el = sheetRef.current;
    if (!el) return;
    d.active = true;
    // Ловим шторку там, где она сейчас, — даже посреди анимации.
    d.startH = el.getBoundingClientRect().height;
    d.h = d.startH;
    d.startScroll = bodyRef.current?.scrollTop ?? 0;
    el.classList.add('is-dragging');
    el.style.height = `${d.startH}px`;
  };

  const move = (d: Drag, y: number) => {
    const { full, peekHeight } = live.current;
    const t = performance.now();
    d.samples.push({ y, t });
    while (d.samples.length > 2 && t - d.samples[0]!.t > 100) d.samples.shift();
    let h = d.startH - (y - d.startY);
    if (h > full) {
      if (d.fromBody && bodyRef.current) {
        // Шторка уже во весь экран — дальше палец листает содержимое.
        bodyRef.current.scrollTop = d.startScroll + (h - full);
        h = full;
      } else {
        h = full + (h - full) * 0.2;
      }
    } else if (h < peekHeight) {
      h = peekHeight - (peekHeight - h) * 0.35;
    }
    d.h = h;
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (drag.current && sheetRef.current) sheetRef.current.style.height = `${drag.current.h}px`;
      });
    }
  };

  const finish = (d: Drag) => {
    drag.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    const el = sheetRef.current;
    if (!d.active || !el) return;
    clickBlockedUntil.current = performance.now() + 350;
    const first = d.samples[0]!;
    const last = d.samples[d.samples.length - 1]!;
    const v = last.t - first.t > 10 ? (last.y - first.y) / (last.t - first.t) : 0; // > 0 — вниз
    const list = snaps();
    const h = Math.min(d.h, live.current.full);
    let next: [SheetMode, number] | undefined;
    if (v < -FLING) next = list.find(([, sh]) => sh > h + 8);
    else if (v > FLING) next = [...list].reverse().find(([, sh]) => sh < h - 8);
    next ??= list.reduce((best, cur) => (Math.abs(cur[1] - h) < Math.abs(best[1] - h) ? cur : best));
    el.classList.remove('is-dragging');
    // Высоту ставим сами: если режим не сменится, React её не тронет, а шторка должна доехать до места.
    el.style.height = `${next[1]}px`;
    if (next[0] !== live.current.mode) live.current.onModeChange(next[0]);
  };

  /** Нажатие на ручку: свёрнута → по содержимому → во весь экран → свёрнута. */
  const toggle = () => {
    const l = live.current;
    const hasAuto = snaps().some(([m]) => m === 'auto');
    const next: SheetMode = l.target >= l.full - 40 ? 'peek' : l.mode === 'peek' && hasAuto ? 'auto' : 'full';
    if (next !== l.mode) l.onModeChange(next);
  };

  // Шапка: ручка и инструменты. Тянуть можно с любого места, в том числе с кнопки — нажатием это станет,
  // только если палец не сдвинулся. Сдвиг вбок — прокрутка инструментов.
  const tapToggles = useRef(false);
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (desktop || e.button > 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select')) return;
    tapToggles.current = !t.closest('button, a, [role="toolbar"]');
    begin(e.clientX, e.clientY, e.pointerId, false);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.fromBody || d.pointerId !== e.pointerId) return;
    if (!d.active) {
      const dx = Math.abs(e.clientX - d.startX);
      const dy = Math.abs(e.clientY - d.startY);
      if (dx > SLOP && dx > dy) {
        drag.current = null;
        return;
      }
      if (dy < SLOP) return;
      activate(d);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    move(d, e.clientY);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.fromBody || d.pointerId !== e.pointerId) return;
    if (!d.active && e.type === 'pointerup' && tapToggles.current) {
      drag.current = null;
      toggle();
      return;
    }
    finish(d);
  };

  // Содержимое: вниз от самого верха — шторка сворачивается, вверх, пока она не во весь экран, — разворачивается,
  // иначе обычная прокрутка. Слушаем touch-события: только в них можно на лету отменить прокрутку (preventDefault).
  useEffect(() => {
    const body = bodyRef.current;
    if (desktop || !body) return;
    let decided: 'sheet' | 'native' | null = null;
    const onStart = (e: TouchEvent) => {
      decided = null;
      if (e.touches.length !== 1 || (e.target as Element).closest('input, textarea, select, [data-sheet-no-drag]')) {
        decided = 'native';
        return;
      }
      const p = e.touches[0]!;
      begin(p.clientX, p.clientY, -1, true);
    };
    const onTouchMove = (e: TouchEvent) => {
      const d = drag.current;
      const p = e.touches[0];
      if (decided === 'native' || !d || !d.fromBody || !p) return;
      if (!decided) {
        const dx = p.clientX - d.startX;
        const dy = p.clientY - d.startY;
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        const l = live.current;
        const sheetMoves = Math.abs(dy) > Math.abs(dx) && ((dy > 0 && body.scrollTop <= 0) || (dy < 0 && l.target < l.full - 2));
        decided = sheetMoves ? 'sheet' : 'native';
        if (!sheetMoves) {
          drag.current = null;
          return;
        }
        activate(d);
      }
      if (e.cancelable) e.preventDefault();
      move(d, p.clientY);
    };
    const onEnd = () => {
      const d = drag.current;
      if (d?.fromBody) finish(d);
      decided = null;
    };
    body.addEventListener('touchstart', onStart, { passive: true });
    body.addEventListener('touchmove', onTouchMove, { passive: false });
    body.addEventListener('touchend', onEnd);
    body.addEventListener('touchcancel', onEnd);
    return () => {
      body.removeEventListener('touchstart', onStart);
      body.removeEventListener('touchmove', onTouchMove);
      body.removeEventListener('touchend', onEnd);
      body.removeEventListener('touchcancel', onEnd);
    };
  }, [desktop]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

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
      ref={sheetRef}
      className={`sheet ${className}`}
      style={{ height: target }}
      aria-label={label}
      onClickCapture={(e) => {
        // Палец тянул шторку и отпустил над кнопкой — это не нажатие.
        if (performance.now() < clickBlockedUntil.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div className="sheet-grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="sheet-handle" aria-hidden />
        {header}
      </div>
      <div className="sheet-body" ref={bodyRef}>
        <div ref={contentRef}>{children}</div>
      </div>
    </section>
  );
}
