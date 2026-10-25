// Демо-площадка, изменённая в редакторе, живёт в браузере, пока нет сервера:
// редактор пишет сюда, карта посетителя `/m/demo` читает отсюда.
import { validateReferences, type MapDocument } from '@space-map/map-core';

// v3 — опубликованная карта манежа, версия 69; прежние правки браузера сохраняются под старым ключом.
const KEY = 'space-map:demo-doc:v3';

export function loadEditedDemo(): MapDocument | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw) as MapDocument;
    if (doc?.schema !== 2 || !Array.isArray(doc.units) || validateReferences(doc).length > 0) return null;
    return doc;
  } catch {
    return null;
  }
}

export function saveEditedDemo(doc: MapDocument): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}

export function clearEditedDemo(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // хранилище недоступно (приватный режим) — нечего чистить
  }
}
