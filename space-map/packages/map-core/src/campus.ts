// Пример площадки из нескольких зданий: территория (двор), два корпуса внутри неё, у корпусов по два этажа,
// этажи соединены лестницами. Собирается теми же функциями, что и правка в редакторе, — заодно проверка, что так можно.
import { placeDoor, placeEntrance } from './doors.ts';
import { addPlace, createRoom, rectPolygon } from './edit.ts';
import { addLevel } from './levels.ts';
import { refreshCapturePoints } from './capturePoints.ts';
import type { MapDocument, UnitKind, Vec2 } from './types.ts';

export function campusVenue(): MapDocument {
  let doc: MapDocument = {
    schema: 2,
    venue: { id: 'campus', name: 'Кампус: два корпуса и двор', planNorth: 0, scaleClass: 'scaled' },
    categories: [
      { id: 'entrance', name: 'Вход', icon: 'door', color: '#2F9E44', synonyms: ['ворота', 'проходная'] },
      { id: 'class', name: 'Аудитория', icon: 'room', color: '#3B5BDB', synonyms: ['кабинет', 'класс'] },
      { id: 'food', name: 'Питание', icon: 'coffee', color: '#E8590C', synonyms: ['столовая', 'кафе', 'буфет'] },
      { id: 'wc', name: 'WC', icon: 'wc', color: '#1098AD', synonyms: ['туалет'] },
      { id: 'sport', name: 'Спорт', icon: 'hall', color: '#C2255C', synonyms: ['спортзал'] },
      { id: 'library', name: 'Библиотека', icon: 'info', color: '#7048E8', synonyms: ['читальный зал', 'книги'] },
      { id: 'parking', name: 'Парковка', icon: 'pin', color: '#495057', synonyms: ['стоянка', 'авто'] },
    ],
    levels: [{ id: 'L1', name: '1 этаж', ordinal: 0, underlay: null }],
    units: [],
    obstacles: [],
    openings: [],
    graph: { nodes: [], edges: [] },
    places: [],
    panoramas: [],
    anchors: [],
    settings: { markerRange: 20, linkRange: 15 },
  };

  const ids = new Map<string, string>();
  const room = (key: string, level: string, a: Vec2, b: Vec2, kind: UnitKind, name: string) => {
    const r = createRoom(doc, level, rectPolygon(a, b), { kind, name });
    doc = r.doc;
    ids.set(key, r.id);
  };
  const door = (a: string, b: string, at: Vec2, type: 'single' | 'double' | 'passage' = 'single') => {
    const r = placeDoor(doc, ids.get(a)!, ids.get(b)!, at, { type, openAngle: 90 });
    if (r) doc = r.doc;
  };
  const place = (level: string, at: Vec2, category: string, name: string) => {
    doc = addPlace(doc, level, at, category, name).doc;
  };

  // ── 1 этаж: двор и оба корпуса внутри него ──
  room('yard', 'L1', [0, 0], [64, 42], 'outdoor', 'Двор');

  // Корпус А: коридор с запада на восток, аудитории по сторонам, лестница у восточного торца.
  room('a-corr', 'L1', [6, 10], [28, 13], 'corridor', 'Корпус А · коридор');
  room('a-101', 'L1', [6, 13], [14, 19], 'room', 'Аудитория 101');
  room('a-102', 'L1', [14, 13], [23, 19], 'room', 'Аудитория 102');
  room('a-st', 'L1', [23, 13], [28, 19], 'stairs', 'Лестница А');
  room('a-103', 'L1', [6, 5], [15, 10], 'room', 'Аудитория 103');
  room('a-wc', 'L1', [15, 5], [19, 10], 'restroom', 'WC');
  room('a-food', 'L1', [19, 5], [28, 10], 'hall', 'Столовая');
  for (const [k, at] of [['a-101', [10, 13]], ['a-102', [18, 13]], ['a-st', [25, 13]], ['a-103', [10, 10]], ['a-wc', [17, 10]], ['a-food', [24, 10]]] as [string, Vec2][]) door('a-corr', k, at);
  door('a-corr', 'yard', [6, 11.5], 'double');

  // Корпус Б: холл со входом со двора, спортзал, библиотека, лестница.
  room('b-hall', 'L1', [38, 20], [48, 27], 'lobby', 'Корпус Б · холл');
  room('b-st', 'L1', [48, 20], [52, 27], 'stairs', 'Лестница Б');
  room('b-lib', 'L1', [52, 20], [58, 27], 'room', 'Библиотека');
  room('b-gym', 'L1', [38, 27], [58, 37], 'hall', 'Спортзал');
  door('b-hall', 'b-st', [48, 23.5]);
  door('b-hall', 'b-gym', [43, 27], 'double');
  door('b-lib', 'b-gym', [55, 27]);
  door('b-hall', 'yard', [43, 20], 'double');

  // Ворота на улицу — с юга двора.
  const gate = placeEntrance(doc, ids.get('yard')!, [32, 0], { type: 'passage', openAngle: 90 });
  if (gate) doc = gate.doc;

  place('L1', [32, 2], 'entrance', 'Главные ворота');
  place('L1', [4, 11.5], 'entrance', 'Вход в корпус А');
  place('L1', [43, 18], 'entrance', 'Вход в корпус Б');
  place('L1', [56, 8], 'parking', 'Парковка');
  place('L1', [10, 16], 'class', 'Аудитория 101');
  place('L1', [18.5, 16], 'class', 'Аудитория 102');
  place('L1', [10.5, 7.5], 'class', 'Аудитория 103');
  place('L1', [17, 7.5], 'wc', 'WC');
  place('L1', [23.5, 7.5], 'food', 'Столовая');
  place('L1', [48, 32], 'sport', 'Спортзал');
  place('L1', [55, 23.5], 'library', 'Абонемент');

  // ── 2 этаж: только корпуса; лестницы — над лестницами первого этажа ──
  const l2 = addLevel(doc, { name: '2 этаж' });
  doc = l2.doc;
  room('a2-corr', l2.id, [6, 10], [28, 13], 'corridor', 'Корпус А · коридор 2 этажа');
  room('a2-201', l2.id, [6, 13], [14, 19], 'room', 'Аудитория 201');
  room('a2-202', l2.id, [14, 13], [23, 19], 'room', 'Аудитория 202');
  room('a2-st', l2.id, [23, 13], [28, 19], 'stairs', 'Лестница А');
  room('a2-203', l2.id, [6, 5], [28, 10], 'hall', 'Актовый зал');
  for (const [k, at] of [['a2-201', [10, 13]], ['a2-202', [18, 13]], ['a2-st', [25, 13]], ['a2-203', [17, 10]]] as [string, Vec2][]) door('a2-corr', k, at);
  room('b2-hall', l2.id, [38, 20], [48, 27], 'lobby', 'Корпус Б · холл 2 этажа');
  room('b2-st', l2.id, [48, 20], [52, 27], 'stairs', 'Лестница Б');
  room('b2-read', l2.id, [38, 27], [58, 37], 'hall', 'Читальный зал');
  door('b2-hall', 'b2-st', [48, 23.5]);
  door('b2-hall', 'b2-read', [43, 27], 'double');

  place(l2.id, [10, 16], 'class', 'Аудитория 201');
  place(l2.id, [18.5, 16], 'class', 'Аудитория 202');
  place(l2.id, [17, 7.5], 'sport', 'Актовый зал');
  place(l2.id, [48, 32], 'library', 'Читальный зал');

  return refreshCapturePoints(doc);
}
