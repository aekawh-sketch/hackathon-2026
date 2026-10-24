// Фиксированная схема для проверок геометрии и маршрутов; не зависит от текущего демо.
// Демо-площадка — ТЗ 11.3: вход, коридор, комнаты, ≥ 5 мест, путь с обходом по коридору, 3 связанные панорамы.
// Схема в метрах: холл 0–10 × 0–10 со входом снизу; справа коридор 10–30 × 4–7;
// над коридором переговорная «А» (10–18) и зал «Север» (18–30); под ним туалет (10–14) и выставочный зал (14–30).
// В помещения за коридором можно попасть только через коридор — маршрут обходит стены.
import type { MapDocument, NavEdge, NavNode, Vec2 } from '../../src/types.ts';
import { distance } from '../../src/geometry.ts';

const L = 'L1';

const nodes: [string, Vec2][] = [
  ['n-entrance', [5, 0.8]],
  ['n-lobby', [5, 5.5]],
  ['n-lobby-door', [10, 5.5]],
  ['n-c1', [12, 5.5]],
  ['n-c2', [13.6, 5.5]],
  ['n-c3', [20.75, 5.5]],
  ['n-c4', [24.75, 5.5]],
  ['n-door-a', [13.6, 7]],
  ['n-door-b', [24.75, 7]],
  ['n-door-c', [20.75, 4]],
  ['n-door-wc', [11.5, 4]],
  ['n-a', [14, 10.5]],
  ['n-b', [24, 10.5]],
  ['n-c', [22, 2]],
  ['n-wc', [12, 2]],
];

const edges: [string, string][] = [
  ['n-entrance', 'n-lobby'],
  ['n-lobby', 'n-lobby-door'],
  ['n-lobby-door', 'n-c1'],
  ['n-c1', 'n-c2'],
  ['n-c2', 'n-c3'],
  ['n-c3', 'n-c4'],
  ['n-c1', 'n-door-wc'],
  ['n-door-wc', 'n-wc'],
  ['n-c2', 'n-door-a'],
  ['n-door-a', 'n-a'],
  ['n-c4', 'n-door-b'],
  ['n-door-b', 'n-b'],
  ['n-c3', 'n-door-c'],
  ['n-door-c', 'n-c'],
];

export function businessCentreFixture(): MapDocument {
  const graphNodes: NavNode[] = nodes.map(([id, pos]) => ({ id, level: L, pos, origin: 'manual' }));
  const byId = new Map(graphNodes.map((n) => [n.id, n]));
  const graphEdges: NavEdge[] = edges.map(([from, to], i) => ({
    id: `e${i + 1}`,
    from,
    to,
    weight: Math.round(distance(byId.get(from)!.pos, byId.get(to)!.pos) * 100) / 100,
    access: 'public',
  }));

  return {
    schema: 2,
    venue: { id: 'demo', name: 'Демо-площадка «Бизнес-центр»', planNorth: 0, scaleClass: 'scaled' },
    categories: [
      { id: 'entrance', name: 'Вход', icon: 'door', color: '#2F855A', synonyms: ['выход', 'вход'] },
      { id: 'desk', name: 'Стойка', icon: 'desk', color: '#B7791F', synonyms: ['регистрация', 'ресепшн', 'информация'] },
      { id: 'hall', name: 'Зал', icon: 'hall', color: '#2B6CB0', synonyms: ['конференц-зал', 'аудитория'] },
      { id: 'room', name: 'Переговорная', icon: 'room', color: '#6B46C1', synonyms: ['комната'] },
      { id: 'booth', name: 'Стенд', icon: 'booth', color: '#C53030', synonyms: ['экспонент'] },
      { id: 'wc', name: 'Туалет', icon: 'wc', color: '#4A5568', synonyms: ['уборная', 'wc', 'санузел'] },
      { id: 'food', name: 'Еда и кофе', icon: 'coffee', color: '#9C4221', synonyms: ['кофе', 'кафе', 'буфет'] },
      { id: 'wifi', name: 'Wi-Fi', icon: 'wifi', color: '#319795', synonyms: ['интернет', 'вайфай'] },
    ],
    levels: [{ id: L, name: '1 этаж', ordinal: 0, underlay: null }],
    units: [
      { id: 'u-lobby', level: L, kind: 'lobby', name: 'Холл', walkable: true, polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] },
      { id: 'u-corridor', level: L, kind: 'corridor', name: 'Коридор', walkable: true, polygon: [[10, 4], [30, 4], [30, 7], [10, 7]] },
      { id: 'u-a', level: L, kind: 'room', name: 'Переговорная «А»', walkable: true, polygon: [[10, 7], [18, 7], [18, 14], [10, 14]] },
      { id: 'u-b', level: L, kind: 'hall', name: 'Зал «Север»', walkable: true, polygon: [[18, 7], [30, 7], [30, 14], [18, 14]] },
      { id: 'u-c', level: L, kind: 'hall', name: 'Выставочный зал', walkable: true, polygon: [[14, 0], [30, 0], [30, 4], [14, 4]] },
      { id: 'u-wc', level: L, kind: 'restroom', name: 'Туалет', walkable: true, polygon: [[10, 0], [14, 0], [14, 4], [10, 4]] },
    ],
    obstacles: [
      { id: 'o-booth-14', level: L, kind: 'booth', polygon: [[24, 0.5], [27, 0.5], [27, 2.5], [24, 2.5]] },
      { id: 'o-desk', level: L, kind: 'counter', polygon: [[6.5, 7.5], [9, 7.5], [9, 8.5], [6.5, 8.5]] },
    ],
    openings: [
      { id: 'd-entrance', level: L, kind: 'entrance', segment: [[4, 0], [6, 0]], units: ['u-lobby'] },
      { id: 'd-lobby', level: L, kind: 'passage', segment: [[10, 4.5], [10, 6.5]], units: ['u-lobby', 'u-corridor'] },
      { id: 'd-a', level: L, kind: 'door', segment: [[13, 7], [14.2, 7]], units: ['u-corridor', 'u-a'] },
      { id: 'd-b', level: L, kind: 'door', segment: [[24, 7], [25.5, 7]], units: ['u-corridor', 'u-b'] },
      { id: 'd-c', level: L, kind: 'door', segment: [[20, 4], [21.5, 4]], units: ['u-corridor', 'u-c'] },
      { id: 'd-wc', level: L, kind: 'door', segment: [[11, 4], [12, 4]], units: ['u-corridor', 'u-wc'] },
    ],
    graph: { nodes: graphNodes, edges: graphEdges },
    places: [
      place('p-entrance', [5, 0.8], 'n-entrance', 'Главный вход', 'entrance', 'Вход с улицы. Гардероб справа.'),
      place('p-desk', [7.75, 7], 'n-lobby', 'Стойка регистрации', 'desk', 'Бейджи, программа, вопросы организаторам.'),
      place('p-coffee', [2, 8.5], 'n-lobby', 'Кофе-поинт', 'food', 'Кофе и вода весь день.'),
      place('p-wifi', [2, 2], 'n-lobby', 'Wi-Fi', 'wifi', 'Сеть «Event-Guest», пароль на стойке регистрации.'),
      place('p-room-a', [14, 10.5], 'n-a', 'Переговорная «А»', 'room', 'На 8 человек, экран и маркерная доска.'),
      place('p-hall-b', [24, 10.5], 'n-b', 'Зал «Север»', 'hall', 'Главный зал докладов, 120 мест.'),
      place('p-expo', [20, 2], 'n-c', 'Выставочный зал', 'hall', 'Стенды партнёров.'),
      { ...place('p-booth-14', [25.5, 2.6], 'n-c', 'Стенд 14 — ТТК', 'booth', 'Демо сервиса «Карта пространства».'), number: '14' },
      place('p-wc', [12, 2], 'n-wc', 'Туалет', 'wc', ''),
    ],
    panoramas: [
      panorama('pa-lobby', 'demo-lobby', [5, 5.5], 'n-lobby', [{ to: 'pa-corridor', yaw: 90 }]),
      panorama('pa-corridor', 'demo-corridor', [20.75, 5.5], 'n-c3', [
        { to: 'pa-lobby', yaw: -90 },
        { to: 'pa-hall-b', yaw: 25 },
      ]),
      panorama('pa-hall-b', 'demo-hall', [24, 10.5], 'n-b', [{ to: 'pa-corridor', yaw: -160 }]),
    ],
    anchors: [{ id: 'q-entrance', level: L, pos: [5, 0.8], facing: 0, code: 'ENTRANCE' }],
    settings: { markerRange: 20, linkRange: 15 },
  };
}

function place(id: string, pos: Vec2, node: string, name: string, category: string, description: string) {
  return { id, level: L, pos, node, polygon: null, name, category, number: null, description, photos: [], hours: null, hidden: false };
}

function panorama(id: string, pano: string, pos: Vec2, node: string, links: { to: string; yaw: number }[]) {
  return {
    id,
    pano,
    level: L,
    pos,
    node,
    heading: 0,
    cameraHeight: 1.5,
    markers: [],
    customMarkers: [],
    links: links.map((l) => ({ ...l, status: 'accepted' as const })),
  };
}
