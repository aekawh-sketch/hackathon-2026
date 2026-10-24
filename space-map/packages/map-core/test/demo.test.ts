import { describe, expect, it } from 'vitest';
import { demoVenue, NavGraph, validateReferences } from '../src/index.ts';

describe('сохранённое демо манежа', () => {
  it('имеет целые ссылки и привязки панорам к снятым точкам', () => {
    const doc = demoVenue();
    expect(doc.venue.id).toBe('demo');
    expect(validateReferences(doc)).toEqual([]);
    expect(doc.panoramas.length).toBeGreaterThan(0);
    for (const panorama of doc.panoramas) {
      expect(panorama.pano).toMatch(/^demo-manezh-/);
      const point = doc.capturePoints?.find((p) => p.panorama === panorama.id);
      expect(point?.pos).toEqual(panorama.pos);
      expect(point?.level).toBe(panorama.level);
    }
  });

  it('не переносит правки редактора в новый экземпляр демо', () => {
    const original = demoVenue();
    const edited = demoVenue();
    edited.units[0]!.polygon[0]![0] += 100;
    edited.panoramas[0]!.pos[0] += 100;
    edited.capturePoints!.splice(0, 1);
    expect(demoVenue()).toEqual(original);
  });

  it('позволяет дойти от входа до каждого открытого места', () => {
    const doc = demoVenue();
    const entrance = doc.places.find((p) => p.category === 'entrance');
    if (!entrance?.node) throw new Error('У входа нет точки маршрута');
    const graph = new NavGraph(doc);
    for (const place of doc.places) {
      if (place.hidden || place.node === entrance.node) continue;
      expect(place.node, place.name).not.toBeNull();
      expect(graph.route(entrance.node, place.node!).ok, place.name).toBe(true);
    }
  });
});
