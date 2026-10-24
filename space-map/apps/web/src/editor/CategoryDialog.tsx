// Своя категория мест и зон: название, значок и цвет. Новая — сразу ставится месту или зоне, у которой её завели.
import { addCategory, deleteCategory, updateCategory, type Category, type MapDocument } from '@space-map/map-core';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CategoryBadge } from '../ui/icons.tsx';

/** Значки, которыми удобно обозначать места на площадке. */
const ICONS = ['pin', 'info', 'door', 'desk', 'booth', 'hall', 'room', 'coffee', 'wc', 'wifi', 'stairs', 'elevator', 'camera', 'sparkle', 'building', 'walk'];
/** Цвета различаются и по светлоте, чтобы не полагаться на один оттенок. */
const COLORS = ['#2F5BEA', '#3937C9', '#7C3AED', '#C23BC5', '#B43832', '#E07A1F', '#B38319', '#2F855A', '#0E9F8E', '#4EB8D1', '#5B6475', '#1F2A3D'];

export function CategoryDialog({
  doc,
  category,
  onCommit,
  onClose,
}: {
  doc: MapDocument;
  /** Нет — создать новую. */
  category?: Category;
  /** Документ после правки; id — новой или изменённой категории. */
  onCommit: (doc: MapDocument, id: string | null) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? 'pin');
  const [color, setColor] = useState(category?.color ?? COLORS[0]!);
  const usedBy = category ? doc.places.filter((p) => p.category === category.id).length : 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    if (!name.trim()) return;
    if (category) onCommit(updateCategory(doc, category.id, { name, icon, color }), category.id);
    else {
      const r = addCategory(doc, { name, icon, color });
      onCommit(r.doc, r.id);
    }
    onClose();
  };

  return createPortal(
    <div className="modal-scrim" onClick={onClose}>
      <form
        className="modal category-modal"
        role="dialog"
        aria-modal="true"
        aria-label={category ? 'Категория' : 'Новая категория'}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="category-modal-head">
          <CategoryBadge icon={icon} color={color} size={44} />
          <h2>{category ? 'Категория' : 'Новая категория'}</h2>
        </div>
        <label className="field">
          <span>Название</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Фудкорт" maxLength={120} autoFocus />
        </label>
        <div className="field">
          <span>Значок</span>
          <div className="category-icons" role="radiogroup" aria-label="Значок">
            {ICONS.map((i) => (
              <button key={i} type="button" role="radio" aria-checked={icon === i} className="category-pick" onClick={() => setIcon(i)}>
                <CategoryBadge icon={i} color={icon === i ? color : '#8A94A6'} size={34} />
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Цвет</span>
          <div className="category-colors" role="radiogroup" aria-label="Цвет">
            {COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} className="category-color" style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <div className="row end">
          {category && (
            <button
              type="button"
              className="btn btn-ghost btn-danger-text"
              disabled={usedBy > 0}
              title={usedBy > 0 ? 'Сначала смените категорию у этих мест' : undefined}
              onClick={() => {
                onCommit(deleteCategory(doc, category.id), null);
                onClose();
              }}
            >
              {usedBy > 0 ? `Используется: ${usedBy}` : 'Удалить'}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            {category ? 'Сохранить' : 'Добавить'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
