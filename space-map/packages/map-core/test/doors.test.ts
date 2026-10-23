import { describe, expect, it } from 'vitest';
import {
  centerOpening,
  demoVenue,
  distance,
  doorLeaves,
  doorStyleOf,
  dragOpeningEdge,
  fillOpening,
  openingSpan,
  placeDoor,
  setDoorType,
  setOpeningWidth,
  slideOpening,
  updateDoorStyle,
  validateReferences,
  type MapDocument,
  type Opening,
  type Vec2,
} from '../src/index.ts';

/** Две комнаты 6×4 рядом: общая стена x = 6, y 0…4. Без дверей. */
function twoRooms(): MapDocument {
  const doc = demoVenue();
  return {
    ...doc,
    units: [
      { id: 'a', level: 'L1', kind: 'corridor', name: 'Коридор', walkable: true, polygon: [[0, 0], [6, 0], [6, 4], [0, 4]] },
      { id: 'b', level: 'L1', kind: 'room', name: 'Кабинет', walkable: true, polygon: [[6, 0], [10, 0], [10, 4], [6, 4]] },
    ],
    obstacles: [],
    openings: [],
    graph: { nodes: [], edges: [] },
    places: [],
    panoramas: [],
    anchors: [],
  };
}

const width = (o: Opening) => distance(o.segment[0], o.segment[1]);
const mid = (o: Opening): Vec2 => [(o.segment[0][0] + o.segment[1][0]) / 2, (o.segment[0][1] + o.segment[1][1]) / 2];
const door = (doc: MapDocument, id: string) => doc.openings.find((o) => o.id === id)!;

describe('постановка двери', () => {
  it('встаёт по центру общей стены, куда бы ни нажали', () => {
    const r = placeDoor(twoRooms(), 'a', 'b', [6, 0.5])!;
    const o = door(r.doc, r.id);
    expect(mid(o)[0]).toBeCloseTo(6);
    expect(mid(o)[1]).toBeCloseTo(2);
    expect(width(o)).toBeCloseTo(0.9);
    expect(validateReferences(r.doc)).toEqual([]);
  });

  it('вторая дверь центруется в оставшемся свободном куске, а не поверх первой', () => {
    const first = placeDoor(twoRooms(), 'a', 'b', [6, 2])!;
    const second = placeDoor(first.doc, 'a', 'b', [6, 3.8])!;
    const o1 = door(second.doc, first.id);
    const o2 = door(second.doc, second.id);
    expect(mid(o2)[1]).toBeGreaterThan(Math.max(o1.segment[0][1], o1.segment[1][1]));
  });

  it('двустворчатая шире; на короткой стене дверь сужается под стену', () => {
    const double = placeDoor(twoRooms(), 'a', 'b', [6, 2], { type: 'double', openAngle: 90 })!;
    expect(width(door(double.doc, double.id))).toBeCloseTo(1.6);
    const doc = twoRooms();
    doc.units[1]!.polygon = [[6, 0], [10, 0], [10, 1], [6, 1]]; // общая стена 1 м
    const narrow = placeDoor(doc, 'a', 'b', [6, 0.5], { type: 'double', openAngle: 90 })!;
    expect(width(door(narrow.doc, narrow.id))).toBeCloseTo(1 - 2 * 0.15);
  });

  it('открывается в меньшее помещение, тип и угол из настроек', () => {
    const r = placeDoor(twoRooms(), 'a', 'b', [6, 2], { type: 'single', openAngle: 45 })!;
    const o = door(r.doc, r.id);
    expect(o.door?.openAngle).toBe(45);
    const [leaf] = doorLeaves(o, doorStyleOf(r.doc, o)!);
    expect(leaf!.openTip[0]).toBeGreaterThan(6); // створка уходит в кабинет (x > 6)
  });

  it('проём без двери — без створок', () => {
    const r = placeDoor(twoRooms(), 'a', 'b', [6, 2], { type: 'passage', openAngle: 90 })!;
    const o = door(r.doc, r.id);
    expect(o.kind).toBe('passage');
    expect(doorStyleOf(r.doc, o)).toBeNull();
  });
});

describe('растягивание вдоль стены', () => {
  const placed = () => {
    const r = placeDoor(twoRooms(), 'a', 'b', [6, 2])!;
    return { doc: r.doc, id: r.id };
  };

  it('тянем за край: другой край на месте, дверь не выходит за угол', () => {
    const { doc, id } = placed();
    const span = openingSpan(doc, id)!;
    const stretched = dragOpeningEdge(doc, id, 1, [6, 9]); // далеко за стену
    const s = openingSpan(stretched, id)!;
    expect(s.t1).toBeCloseTo(4 - 0.15);
    expect(Math.min(s.t0, span.t0)).toBeCloseTo(span.t0);
  });

  it('сжать меньше минимума нельзя', () => {
    const { doc, id } = placed();
    const o = door(doc, id);
    const squeezed = dragOpeningEdge(doc, id, 1, o.segment[0]);
    expect(width(door(squeezed, id))).toBeCloseTo(0.6);
  });

  it('сдвиг упирается в угол; «на всю стену» и «по центру»', () => {
    const { doc, id } = placed();
    const slid = slideOpening(doc, id, -10);
    expect(openingSpan(slid, id)!.t0).toBeCloseTo(0.15);
    expect(width(door(slid, id))).toBeCloseTo(0.9);
    const centered = centerOpening(slid, id);
    expect(mid(door(centered, id))[1]).toBeCloseTo(2);
    const filled = fillOpening(centered, id);
    expect(width(door(filled, id))).toBeCloseTo(4 - 0.3);
    expect(width(door(setOpeningWidth(filled, id, 1.2), id))).toBeCloseTo(1.2);
  });

  it('не налезает на соседнюю дверь', () => {
    const first = placeDoor(twoRooms(), 'a', 'b', [6, 0.5])!;
    const second = placeDoor(first.doc, 'a', 'b', [6, 3.8])!;
    const pushed = dragOpeningEdge(second.doc, second.id, 0, [6, 0]);
    const pushed2 = dragOpeningEdge(pushed, second.id, 1, [6, 0]);
    const a = openingSpan(pushed2, first.id)!;
    const b = openingSpan(pushed2, second.id)!;
    expect(Math.max(a.t0, b.t0)).toBeGreaterThanOrEqual(Math.min(a.t1, b.t1) + 0.15 - 1e-6);
  });
});

describe('створки', () => {
  it('закрытая дверь лежит в проёме, распахнутая — поперёк стены', () => {
    const r = placeDoor(twoRooms(), 'a', 'b', [6, 2])!;
    const closed = updateDoorStyle(r.doc, r.id, { openAngle: 0 });
    const o = door(closed, r.id);
    const [leaf] = doorLeaves(o, doorStyleOf(closed, o)!);
    expect(leaf!.openTip[0]).toBeCloseTo(6);
    const open = door(updateDoorStyle(r.doc, r.id, { openAngle: 90 }), r.id);
    const [l2] = doorLeaves(open, open.door!);
    expect(l2!.openTip[0]).toBeCloseTo(6 + 0.9);
  });

  it('двустворчатая — две створки по половине ширины от каждого косяка', () => {
    const r = placeDoor(twoRooms(), 'a', 'b', [6, 2], { type: 'double', openAngle: 90 })!;
    const o = door(r.doc, r.id);
    const leaves = doorLeaves(o, o.door!);
    expect(leaves).toHaveLength(2);
    expect(leaves[0]!.length).toBeCloseTo(0.8);
    expect(distance(leaves[0]!.hinge, leaves[1]!.hinge)).toBeCloseTo(1.6);
  });

  it('смена типа: дверь → проём → дверь сохраняет настройки', () => {
    const r = placeDoor(twoRooms(), 'a', 'b', [6, 2], { type: 'single', openAngle: 30 })!;
    const passage = setDoorType(r.doc, r.id, 'passage');
    expect(door(passage, r.id).kind).toBe('passage');
    const double = setDoorType(r.doc, r.id, 'double');
    expect(door(double, r.id).door).toMatchObject({ leaves: 2, openAngle: 30 });
  });

  it('у старых дверей без настроек — значения по умолчанию', () => {
    const doc = demoVenue();
    const o = doc.openings.find((x) => x.id === 'd-a')!;
    expect(doorStyleOf(doc, o)).toMatchObject({ leaves: 1, openAngle: 90 });
  });
});
