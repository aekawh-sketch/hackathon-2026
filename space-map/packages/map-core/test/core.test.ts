import { businessCentreFixture } from './fixtures/businessCentre.ts';
import { describe, expect, it } from 'vitest';
import {
  angleBetween,
  azimuth,
  buildModel3D,
  deleteNode,
  deletePanorama,
  deletePlace,
  directionFromAngles,
  hasLineOfSight,
  headingFromCorrespondence,
  NavGraph,
  normalize180,
  projectToPanorama,
  rotateVector,
  searchPlaces,
  suggestLinks,
  suggestMarkers,
  validateReferences,
  walkthrough,
  type MapDocument,
  type Quat,
} from '../src/index.ts';

describe('геометрия', () => {
  it('азимут по часовой от верха плана', () => {
    expect(azimuth([0, 0], [0, 1])).toBeCloseTo(0);
    expect(azimuth([0, 0], [1, 0])).toBeCloseTo(90);
    expect(azimuth([0, 0], [0, -1])).toBeCloseTo(180);
    expect(azimuth([0, 0], [-1, 0])).toBeCloseTo(270);
  });

  it('нормализация угла через 0/360', () => {
    expect(normalize180(350)).toBeCloseTo(-10);
    expect(normalize180(-190)).toBeCloseTo(170);
  });

  it('стена закрывает видимость, дверь — нет', () => {
    const doc = businessCentreFixture();
    expect(hasLineOfSight(doc, 'L1', [5, 5.5], [20, 5.5])).toBe(true); // холл → коридор через проход
    expect(hasLineOfSight(doc, 'L1', [5, 5.5], [24, 10.5])).toBe(false); // холл → зал «Север» сквозь стену
    expect(hasLineOfSight(doc, 'L1', [24.75, 5.5], [24.75, 10])).toBe(true); // коридор → зал через дверь
  });
});

describe('маршрут', () => {
  const doc = businessCentreFixture();
  const graph = new NavGraph(doc);

  it('идёт по графу через коридор, а не сквозь стену', () => {
    const r = graph.route('n-entrance', 'n-b');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nodes).toEqual(['n-entrance', 'n-lobby', 'n-lobby-door', 'n-c1', 'n-c2', 'n-c3', 'n-c4', 'n-door-b', 'n-b']);
    // Обход по коридору длиннее прямой линии сквозь стены (≈ 21,2 м).
    expect(r.length).toBeCloseTo(29.53, 1);
  });

  it('то же начало и конец — «вы уже на месте»', () => {
    expect(graph.route('n-a', 'n-a')).toEqual({ ok: false, reason: 'same_point' });
  });

  it('несвязанные части — «маршрут не найден»', () => {
    const cut: MapDocument = { ...doc, graph: { ...doc.graph, edges: doc.graph.edges.filter((e) => e.id !== 'e5') } };
    expect(new NavGraph(cut).route('n-entrance', 'n-b')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('заблокированное ребро и ребро для персонала посетителю не доступны', () => {
    const staff: MapDocument = {
      ...doc,
      graph: { ...doc.graph, edges: doc.graph.edges.map((e) => (e.id === 'e5' ? { ...e, access: 'staff' } : e)) },
    };
    expect(new NavGraph(staff).route('n-entrance', 'n-b').ok).toBe(false);
    expect(new NavGraph(staff, { includeStaff: true }).route('n-entrance', 'n-b').ok).toBe(true);
  });

  it('ближайший объект — по пути, а не по прямой', () => {
    // Из переговорной «А» зал «Север» ближе по прямой (10 м против 13 м), но по пути ближе вход (18 м против 21 м).
    const r = graph.nearest('n-a', ['n-b', 'n-entrance']);
    expect(r.ok && r.nodes[r.nodes.length - 1]).toBe('n-entrance');
  });
});

describe('панорамы', () => {
  it('heading по одной двери', () => {
    // Дверь видна в панораме под yaw 30°, на плане она строго справа (азимут 90°) → центр панорамы смотрит на 60°.
    expect(headingFromCorrespondence([0, 0], [5, 0], 30)).toBeCloseTo(60);
  });

  it('проекция места: yaw от heading, pitch от высоты', () => {
    const doc = businessCentreFixture();
    const pano = doc.panoramas.find((p) => p.id === 'pa-lobby')!;
    const p = projectToPanorama(doc, pano, 'L1', [5, 9.5])!;
    expect(p.yaw).toBeCloseTo(0);
    expect(p.pitch).toBeCloseTo((Math.atan2(1.2 - 1.5, 4) * 180) / Math.PI);
  });

  it('подсказки меток: за стеной нет, рядом есть', () => {
    const doc = businessCentreFixture();
    const corridor = doc.panoramas.find((p) => p.id === 'pa-corridor')!;
    const ids = suggestMarkers(doc, corridor).map((m) => m.place);
    expect(ids).not.toContain('p-booth-14'); // в выставочном зале за стеной
    const lobby = suggestMarkers(doc, doc.panoramas.find((p) => p.id === 'pa-lobby')!).map((m) => m.place);
    expect(lobby).toEqual(expect.arrayContaining(['p-desk', 'p-coffee', 'p-wifi']));
    expect(lobby).not.toContain('p-hall-b');
  });

  it('для схемы подсказки выключены', () => {
    const doc = businessCentreFixture();
    doc.venue.scaleClass = 'schematic';
    expect(suggestMarkers(doc, doc.panoramas[0]!)).toEqual([]);
  });

  it('подсказки переходов не предлагают уже связанные', () => {
    const doc = businessCentreFixture();
    expect(suggestLinks(doc, doc.panoramas.find((p) => p.id === 'pa-lobby')!)).toEqual([]);
  });

  it('прогулка: три панорамы по маршруту подряд', () => {
    const doc = businessCentreFixture();
    const graph = new NavGraph(doc);
    const r = graph.route('n-lobby', 'n-b');
    if (!r.ok) throw new Error('нет маршрута');
    const w = walkthrough(doc, graph, r.nodes);
    expect(w.segments).toEqual([['pa-lobby', 'pa-corridor', 'pa-hall-b']]);
    expect(w.complete).toBe(true);
  });

  it('прогулка: без перехода — разрыв, а не прыжок', () => {
    const doc = businessCentreFixture();
    for (const pa of doc.panoramas) pa.links = pa.links.filter((l) => !(l.to === 'pa-hall-b' || pa.id === 'pa-hall-b'));
    const graph = new NavGraph(doc);
    const r = graph.route('n-lobby', 'n-b');
    if (!r.ok) throw new Error('нет маршрута');
    const w = walkthrough(doc, graph, r.nodes);
    expect(w.segments).toEqual([['pa-lobby', 'pa-corridor'], ['pa-hall-b']]);
    expect(w.complete).toBe(false);
  });
});

describe('целостность', () => {
  it('демо-площадка без висящих ссылок', () => {
    expect(validateReferences(businessCentreFixture())).toEqual([]);
  });

  it('удаление не оставляет висящих ссылок', () => {
    let doc = businessCentreFixture();
    doc.panoramas[0]!.markers.push({ place: 'p-desk', yaw: 10, pitch: 0, status: 'accepted' });
    doc = deletePlace(doc, 'p-desk');
    doc = deletePanorama(doc, 'pa-corridor');
    doc = deleteNode(doc, 'n-c3');
    expect(validateReferences(doc)).toEqual([]);
  });

  it('висящая ссылка находится', () => {
    const doc = businessCentreFixture();
    doc.places[0]!.node = 'nope';
    expect(validateReferences(doc)).toHaveLength(1);
  });
});

describe('поиск', () => {
  it('по названию, синониму категории и номеру', () => {
    const doc = businessCentreFixture();
    expect(searchPlaces(doc, 'кофе')[0]!.id).toBe('p-coffee');
    expect(searchPlaces(doc, 'уборная')[0]!.id).toBe('p-wc');
    expect(searchPlaces(doc, '14')[0]!.id).toBe('p-booth-14');
    expect(searchPlaces(doc, 'ЗАЛ «СЕВЕР»')[0]!.id).toBe('p-hall-b');
  });
});

describe('съёмка: направления', () => {
  it('угол между направлениями через 0°/360° и у зенита', () => {
    expect(angleBetween(directionFromAngles(359, 0), directionFromAngles(1, 0))).toBeCloseTo(2);
    expect(angleBetween(directionFromAngles(0, 89), directionFromAngles(180, 89))).toBeCloseTo(2);
  });

  it('поворот кватернионом на 90° вокруг вертикали', () => {
    const s = Math.SQRT1_2;
    const q: Quat = [0, 0, s, s];
    const v = rotateVector(q, [0, 1, 0]);
    expect(v[0]).toBeCloseTo(-1);
    expect(v[1]).toBeCloseTo(0);
  });
});

describe('3D-модель', () => {
  it('общие стены склеены, в дверях проёмы', () => {
    const model = buildModel3D(businessCentreFixture(), 'L1');
    // Нижняя граница коридора y = 4 общая с туалетом и залом: стены там не дублируются.
    const onY4 = model.walls.filter((w) => Math.abs(w.a[1] - 4) < 1e-6 && Math.abs(w.b[1] - 4) < 1e-6);
    const covered = onY4.reduce((s, w) => s + Math.abs(w.b[0] - w.a[0]), 0);
    // Длина 20 м минус двери туалета (1 м) и зала (1,5 м).
    expect(covered).toBeCloseTo(17.5);
    expect(model.floors).toHaveLength(6);
    expect(model.blocks).toHaveLength(2);
  });
});
