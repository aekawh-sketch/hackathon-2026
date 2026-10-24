// Целостность ссылок внутри документа (п. 69) и каскадное удаление.
import type { MapDocument } from './types.ts';
import { pointInPolygon } from './geometry.ts';

export interface Issue {
  path: string;
  message: string;
}

/** Висящие ссылки и дубли ID. Пустой список — документ можно сохранять. */
export function validateReferences(doc: MapDocument): Issue[] {
  const issues: Issue[] = [];
  const levels = idSet(doc.levels, 'levels', issues);
  const units = idSet(doc.units, 'units', issues);
  const nodes = idSet(doc.graph.nodes, 'graph.nodes', issues);
  const places = idSet(doc.places, 'places', issues);
  const panoramas = idSet(doc.panoramas, 'panoramas', issues);
  const categories = idSet(doc.categories, 'categories', issues);
  idSet(doc.graph.edges, 'graph.edges', issues);
  idSet(doc.openings, 'openings', issues);
  idSet(doc.anchors, 'anchors', issues);

  const need = (ok: boolean, path: string, message: string) => {
    if (!ok) issues.push({ path, message });
  };

  doc.units.forEach((u, i) => {
    need(levels.has(u.level), `units[${i}].level`, `нет этажа ${u.level}`);
    need(u.polygon.length >= 3, `units[${i}].polygon`, 'меньше трёх вершин');
    if (u.parent) {
      const parent = doc.units.find((candidate) => candidate.id === u.parent);
      need(units.has(u.parent), `units[${i}].parent`, `нет родительского помещения ${u.parent}`);
      if (parent) {
        need(parent.level === u.level, `units[${i}].parent`, 'родитель находится на другом этаже');
        need(u.polygon.every((p) => pointInPolygon(p, parent.polygon)), `units[${i}].parent`, 'комната выходит за границы родителя');
      }
    }
    u.holes?.forEach((h, j) => need(h.length >= 3, `units[${i}].holes[${j}]`, 'меньше трёх вершин'));
  });
  doc.obstacles.forEach((o, i) => need(levels.has(o.level), `obstacles[${i}].level`, `нет этажа ${o.level}`));
  doc.openings.forEach((o, i) => {
    need(levels.has(o.level), `openings[${i}].level`, `нет этажа ${o.level}`);
    o.units.forEach((u, j) => need(units.has(u), `openings[${i}].units[${j}]`, `нет помещения ${u}`));
  });
  doc.graph.nodes.forEach((n, i) => need(levels.has(n.level), `graph.nodes[${i}].level`, `нет этажа ${n.level}`));
  doc.graph.edges.forEach((e, i) => {
    need(nodes.has(e.from), `graph.edges[${i}].from`, `нет узла ${e.from}`);
    need(nodes.has(e.to), `graph.edges[${i}].to`, `нет узла ${e.to}`);
    need(e.from !== e.to, `graph.edges[${i}]`, 'ребро в тот же узел');
    need(e.weight > 0, `graph.edges[${i}].weight`, 'вес должен быть больше нуля');
  });
  doc.places.forEach((p, i) => {
    need(levels.has(p.level), `places[${i}].level`, `нет этажа ${p.level}`);
    need(categories.has(p.category), `places[${i}].category`, `нет категории ${p.category}`);
    if (p.node !== null) need(nodes.has(p.node), `places[${i}].node`, `нет узла ${p.node}`);
  });
  doc.panoramas.forEach((pa, i) => {
    need(levels.has(pa.level), `panoramas[${i}].level`, `нет этажа ${pa.level}`);
    if (pa.node !== null) need(nodes.has(pa.node), `panoramas[${i}].node`, `нет узла ${pa.node}`);
    pa.markers.forEach((m, j) => need(places.has(m.place), `panoramas[${i}].markers[${j}]`, `нет места ${m.place}`));
    pa.links.forEach((l, j) => {
      need(panoramas.has(l.to), `panoramas[${i}].links[${j}]`, `нет панорамы ${l.to}`);
      need(l.to !== pa.id, `panoramas[${i}].links[${j}]`, 'переход в саму себя');
    });
  });
  doc.anchors.forEach((a, i) => need(levels.has(a.level), `anchors[${i}].level`, `нет этажа ${a.level}`));
  idSet(doc.capturePoints ?? [], 'capturePoints', issues);
  (doc.capturePoints ?? []).forEach((c, i) => {
    need(levels.has(c.level), `capturePoints[${i}].level`, `нет этажа ${c.level}`);
    if (c.panorama !== null) need(panoramas.has(c.panorama), `capturePoints[${i}].panorama`, `нет панорамы ${c.panorama}`);
  });
  return issues;
}

function idSet(items: { id: string }[], path: string, issues: Issue[]): Set<string> {
  const set = new Set<string>();
  for (const { id } of items) {
    if (set.has(id)) issues.push({ path, message: `повторяется ID ${id}` });
    set.add(id);
  }
  return set;
}

/** Удалить место вместе с его метками во всех панорамах. */
export function deletePlace(doc: MapDocument, id: string): MapDocument {
  return {
    ...doc,
    places: doc.places.filter((p) => p.id !== id),
    panoramas: doc.panoramas.map((pa) => ({ ...pa, markers: pa.markers.filter((m) => m.place !== id) })),
  };
}

/** Удалить панораму вместе с переходами, которые в неё ведут. Точка съёмки снова ждёт съёмки. */
export function deletePanorama(doc: MapDocument, id: string): MapDocument {
  return {
    ...doc,
    panoramas: doc.panoramas
      .filter((pa) => pa.id !== id)
      .map((pa) => ({ ...pa, links: pa.links.filter((l) => l.to !== id) })),
    ...(doc.capturePoints ? { capturePoints: doc.capturePoints.map((c) => (c.panorama === id ? { ...c, panorama: null } : c)) } : {}),
  };
}

/** Удалить узел, его рёбра и привязки мест и панорам к нему. */
export function deleteNode(doc: MapDocument, id: string): MapDocument {
  return {
    ...doc,
    graph: {
      nodes: doc.graph.nodes.filter((n) => n.id !== id),
      edges: doc.graph.edges.filter((e) => e.from !== id && e.to !== id),
    },
    places: doc.places.map((p) => (p.node === id ? { ...p, node: null } : p)),
    panoramas: doc.panoramas.map((pa) => (pa.node === id ? { ...pa, node: null } : pa)),
  };
}
