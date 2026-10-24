// Обучение по шагам: подсвечивает кнопку и рядом показывает, за что она отвечает; «Понятно» — следующая.
// Кнопки находит по data-tour; тех, что на этом экране нет (телефон, другой режим), — пропускает.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface TourStep {
  /** CSS-селектор кнопки, обычно `[data-tour="…"]`. */
  target: string;
  title: string;
  text: string;
}

const visible = (el: Element | null): el is HTMLElement => {
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
};

export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  // Шаги, у которых есть кнопка на экране, — один раз при запуске.
  const [list] = useState(() => steps.filter((s) => visible(document.querySelector(s.target))));
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const step = list[index];
  const last = index === list.length - 1;

  const next = () => (last ? onClose() : setIndex((i) => i + 1));

  useEffect(() => {
    if (!list.length) onClose();
  }, [list.length, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'Enter' || e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Кнопка может ехать (шторка, прокрутка панели инструментов) — меряем её каждый кадр, пока идёт шаг.
  useEffect(() => {
    if (!step) return;
    const el = document.querySelector(step.target);
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    let frame = 0;
    let prev = '';
    const measure = () => {
      const target = document.querySelector(step.target);
      if (visible(target)) {
        const r = target.getBoundingClientRect();
        const key = `${Math.round(r.left)}:${Math.round(r.top)}:${Math.round(r.width)}:${Math.round(r.height)}`;
        if (key !== prev) {
          prev = key;
          setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
        }
      }
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [step]);

  // Подсказка — под кнопкой, а если внизу тесно — над ней; не вылезает за края экрана.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip || !rect) return;
    const { width, height } = tip.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const gap = 14;
    const below = rect.top + rect.height + gap;
    const top = below + height + 12 <= vh ? below : Math.max(12, rect.top - gap - height);
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), vw - width - 12);
    setTipPos({ left, top });
  }, [rect, index]);

  if (!step) return null;
  const pad = 6;
  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-label="Обучение">
      {rect && <div className="tour-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />}
      <div key={index} ref={tipRef} className="tour-tip" style={tipPos ?? { visibility: 'hidden' }}>
        <p className="tour-count">
          {index + 1} из {list.length}
        </p>
        <h3>{step.title}</h3>
        <p>{step.text}</p>
        <div className="row end">
          {!last && (
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Пропустить
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={next} autoFocus>
            {last ? 'Готово' : 'Понятно'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
