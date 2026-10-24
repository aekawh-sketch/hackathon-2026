// Демо-площадка, изменённая в редакторе, живёт в браузере, пока нет сервера:
// редактор пишет сюда, карта посетителя `/m/demo` читает отсюда.
import { validateReferences, type MapDocument } from '@space-map/map-core';

// v2 starts from the new hackathon venue model; retain any previous v1 browser edits untouched.
const KEY = 'space-map:demo-doc:v2';

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
