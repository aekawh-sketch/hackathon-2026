// Переключатель этажей поверх карты: сверху — верхний этаж, как кнопки лифта.
import type { CSSProperties } from 'react';
import type { Level } from '@space-map/map-core';
import { Icon } from './icons.tsx';

/** Короткая подпись на кнопке: номер этажа или первые буквы названия; полное название — в подсказке. */
export function levelShort(level: Level): string {
  const n = level.name.match(/-?\d+/);
  if (n) return n[0];
  const name = level.name.trim();
  if (name.length <= 6) return name || String(level.ordinal + 1);
  return `${name.slice(0, 3)}.`;
}

export function LevelSwitch({
  levels,
  value,
  onChange,
  onAdd,
  style,
}: {
  /** Снизу вверх. */
  levels: Level[];
  value: string;
  onChange: (id: string) => void;
  /** Есть — кнопка «+» (редактор). */
  onAdd?: () => void;
  style?: CSSProperties;
}) {
  return (
    <div className="level-switch" role="group" aria-label="Этажи" style={style} onPointerDown={(e) => e.stopPropagation()} data-tour="levels">
      {onAdd && (
        <button type="button" className="level-btn" aria-label="Добавить этаж" title="Добавить этаж" onClick={onAdd}>
          <Icon name="plus" size={17} />
        </button>
      )}
      {[...levels].reverse().map((l) => (
        <button key={l.id} type="button" className="level-btn" aria-pressed={l.id === value} aria-label={l.name} title={l.name} onClick={() => onChange(l.id)}>
          {levelShort(l)}
        </button>
      ))}
    </div>
  );
}
