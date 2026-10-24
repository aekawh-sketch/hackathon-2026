// Светлая и тёмная тема всего сайта: выбор человека хранится в браузере, без выбора — как в системе.
// Тема — атрибут data-theme у <html> (цвета интерфейса в styles.css) и палитра плана (plan/style.ts).
import { useSyncExternalStore } from 'react';
import { setPlanTheme } from '../plan/style.ts';
import { Icon } from './icons.tsx';

export type Theme = 'light' | 'dark';

const KEY = 'space-map:theme';
const listeners = new Set<() => void>();
let current: Theme = 'light';

const system = () => (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function apply() {
  current = stored() ?? system();
  document.documentElement.dataset.theme = current;
  setPlanTheme(current === 'dark');
  // Полоса браузера на телефоне — в цвет фона.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', current === 'dark' ? '#0d131d' : '#e9edf3');
  for (const l of listeners) l();
}

/** До первой отрисовки: страница сразу в нужной теме, без вспышки светлой. */
export function initTheme() {
  apply();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!stored()) apply();
  });
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Хранилище закрыто (приватный режим) — тема продержится до перезагрузки.
  }
  apply();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/** Текущая тема; компонент перерисуется при её смене (план, 3D, миниатюры берут из неё палитру). */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => current, () => 'light');
}

/** Кнопка-переключатель: солнце — включить светлую, луна — тёмную. labeled — с подписью (кнопка-строка). */
export function ThemeToggle({ className = 'icon-btn', labeled = false, tour }: { className?: string; labeled?: boolean; tour?: string }) {
  const theme = useTheme();
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? 'Тёмная тема' : 'Светлая тема';
  return (
    <button type="button" className={className} data-tour={tour} aria-label={labeled ? undefined : label} title={label} onClick={() => setTheme(next)}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={labeled ? 18 : 20} />
      {labeled && label}
    </button>
  );
}
