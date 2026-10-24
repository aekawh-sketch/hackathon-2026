// Демо-площадка — план хакатона «Осень 2026» в манеже ДГТУ по схеме организаторов.
// Размеры условные: на схеме нет масштаба. Основной зал остаётся единым открытым пространством,
// цветные области — зоны события, а не стены; служебный блок примыкает к манежу снизу.
import type { MapDocument, NavEdge, NavNode, Vec2 } from './types.ts';
import { distance } from './geometry.ts';

const L = 'L1';

const nodes: [string, Vec2][] = [
  ['n-entrance', [20.5, 0.25]],
  ['n-track-east', [34.5, 11]],
  ['n-participants', [21, 11]],
  ['n-partners', [8.5, 11]],
  ['n-stage', [21, 16.1]],
  ['n-rest', [38.4, 16]],
  ['n-services', [20.5, 5.4]],
  ['n-wardrobe', [15.5, 4.5]],
  ['n-wc-west', [18.2, 4.5]],
  ['n-registration', [21, 4.5]],
  ['n-wc-east', [24, 4.5]],
  ['n-food-west', [17, 1.5]],
  ['n-food-east', [24, 1.5]],
];

const edges: [string, string][] = [
  ['n-entrance', 'n-registration'],
  ['n-track-east', 'n-participants'],
  ['n-participants', 'n-partners'],
  ['n-participants', 'n-stage'],
  ['n-track-east', 'n-rest'],
  ['n-participants', 'n-services'],
  ['n-services', 'n-wardrobe'],
  ['n-services', 'n-wc-west'],
  ['n-services', 'n-registration'],
  ['n-services', 'n-wc-east'],
  ['n-wardrobe', 'n-food-west'],
  ['n-wc-east', 'n-food-east'],
];

/** Внешний контур беговой дорожки; область участников будет нарисована поверх её центра. */
const track: Vec2[] = [
  [21, 16.2], [29, 15.9], [34, 15.1], [37, 13.5], [38.5, 11], [37, 8.5],
  [34, 6.9], [29, 6.1], [21, 5.8], [13, 6.1], [8, 6.9], [5, 8.5],
  [3.5, 11], [5, 13.5], [8, 15.1], [13, 15.9],
];

export function demoVenue(): MapDocument {
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
    venue: { id: 'demo', name: 'Хакатон «Осень 2026» — Манеж ДГТУ', planNorth: null, scaleClass: 'schematic' },
    categories: [
      { id: 'entrance', name: 'Вход', icon: 'door', color: '#2F855A', synonyms: ['выход', 'вход в манеж'] },
      { id: 'food', name: 'Зона питания', icon: 'coffee', color: '#D6B91E', synonyms: ['еда', 'кофе', 'питание'] },
      { id: 'wardrobe', name: 'Гардероб', icon: 'room', color: '#C23BC5', synonyms: ['одежда', 'вещи'] },
      { id: 'wc', name: 'WC', icon: 'wc', color: '#A94D70', synonyms: ['туалет', 'уборная', 'санузел'] },
      { id: 'registration', name: 'Регистрация', icon: 'desk', color: '#B38319', synonyms: ['стойка', 'бейдж', 'регистрация участников'] },
      { id: 'stage', name: 'Сцена', icon: 'booth', color: '#B43832', synonyms: ['выступления', 'доклады'] },
      { id: 'participants', name: 'Зона участников', icon: 'hall', color: '#3937C9', synonyms: ['участники', 'рабочая зона'] },
      { id: 'partners', name: 'Зона партнёров', icon: 'booth', color: '#54A83C', synonyms: ['партнёры', 'стенды'] },
      { id: 'rest', name: 'Зона отдыха', icon: 'info', color: '#4EB8D1', synonyms: ['отдых', 'лаунж'] },
      { id: 'track', name: 'Беговая дорожка', icon: 'walk', color: '#7A8492', synonyms: ['дорожка', 'манеж'] },
    ],
    levels: [{ id: L, name: 'Манеж', ordinal: 0, underlay: null }],
    units: [
      { id: 'u-manezh', level: L, kind: 'hall', name: 'Манеж', walkable: true, polygon: [[0, 6], [42, 6], [42, 17], [0, 17]] },
      { id: 'u-services', level: L, kind: 'lobby', name: 'Служебная зона', walkable: true, polygon: [[14, 0], [27, 0], [27, 6], [14, 6]] },
    ],
    obstacles: [],
    openings: [
      { id: 'd-entrance', level: L, kind: 'entrance', segment: [[19.6, 0], [21.4, 0]], units: ['u-services'] },
      { id: 'd-services', level: L, kind: 'passage', segment: [[18, 6], [23, 6]], units: ['u-manezh', 'u-services'] },
    ],
    graph: { nodes: graphNodes, edges: graphEdges },
    places: [
      area('p-track', [34.5, 11], 'n-track-east', 'Беговая дорожка', 'track', 'Овальная дорожка манежа.', track),
      area('p-participants', [21, 11], 'n-participants', 'Зона участников', 'participants', 'Рабочая зона участников внутри беговой дорожки.', [[11, 8.5], [31, 8.5], [31, 13.5], [11, 13.5]]),
      area('p-partners', [8.5, 11], 'n-partners', 'Зона партнёров', 'partners', 'Партнёрские стенды вдоль левой стороны дорожки.', [[7.4, 6.6], [9.7, 6.6], [9.7, 15.8], [7.4, 15.8]]),
      area('p-stage', [21, 16.1], 'n-stage', 'Сцена', 'stage', 'Сцена у верхней стороны манежа.', [[18.6, 15.6], [23.4, 15.6], [23.4, 16.7], [18.6, 16.7]]),
      area('p-rest', [38.4, 16], 'n-rest', 'Зона отдыха', 'rest', 'Зона отдыха у правой верхней стороны манежа.', [[35.2, 15.4], [41.8, 15.4], [41.8, 16.8], [35.2, 16.8]]),
      area('p-wardrobe', [15.5, 4.5], 'n-wardrobe', 'Гардероб', 'wardrobe', 'Гардероб в служебной части манежа.', [[14.3, 3.3], [16.7, 3.3], [16.7, 5.7], [14.3, 5.7]]),
      area('p-wc-west', [18.2, 4.5], 'n-wc-west', 'WC', 'wc', 'Туалет в служебной части манежа.', [[16.9, 3.3], [19.4, 3.3], [19.4, 5.7], [16.9, 5.7]]),
      area('p-registration', [21, 4.5], 'n-registration', 'Регистрация', 'registration', 'Регистрация участников и получение бейджей.', [[19.7, 3.3], [22.3, 3.3], [22.3, 5.7], [19.7, 5.7]]),
      area('p-wc-east', [24, 4.5], 'n-wc-east', 'WC', 'wc', 'Туалет в служебной части манежа.', [[22.6, 3.3], [25.1, 3.3], [25.1, 5.7], [22.6, 5.7]]),
      area('p-food-west', [17, 1.5], 'n-food-west', 'Зона питания', 'food', 'Зона питания с левой стороны служебного блока.', [[14.3, 0.4], [19.8, 0.4], [19.8, 2.8], [14.3, 2.8]]),
      area('p-food-east', [24, 1.5], 'n-food-east', 'Зона питания', 'food', 'Зона питания с правой стороны служебного блока.', [[20.2, 0.4], [26.7, 0.4], [26.7, 2.8], [20.2, 2.8]]),
      place('p-entrance', [20.5, 0.25], 'n-entrance', 'Вход и выход', 'entrance', 'Вход и выход со стороны служебного блока, между зонами питания.'),
    ],
    panoramas: [],
    anchors: [{ id: 'q-entrance', level: L, pos: [20.5, 0.25], facing: 0, code: 'ENTRANCE' }],
    settings: { markerRange: 30, linkRange: 15 },
  };
}

function place(id: string, pos: Vec2, node: string, name: string, category: string, description: string) {
  return { id, level: L, pos, node, polygon: null, name, category, number: null, description, photos: [], hours: null, hidden: false };
}

function area(id: string, pos: Vec2, node: string, name: string, category: string, description: string, polygon: Vec2[]) {
  return { ...place(id, pos, node, name, category, description), polygon };
}
