// Маршруты по явному графу — ТЗ 5.8, 5.9. Граф — источник истины, стены сами проходимость не создают.
import { distance, hasLineOfSight } from './geometry.ts';
import type { MapDocument, NavEdge, NavNode, Vec2 } from './types.ts';

export interface RouteOptions {
  /** Посетитель не видит рёбер «только для персонала». */
  includeStaff?: boolean;
}

export type RouteResult =
  | { ok: true; nodes: string[]; edges: string[]; length: number }
  | { ok: false; reason: 'same_point' | 'not_found' | 'unknown_node' };

interface Adjacent {
  node: string;
  edge: NavEdge;
}

export class NavGraph {
  readonly nodes = new Map<string, NavNode>();
  private readonly adjacency = new Map<string, Adjacent[]>();

  constructor(doc: MapDocument, options: RouteOptions = {}) {
    for (const n of doc.graph.nodes) {
      this.nodes.set(n.id, n);
      this.adjacency.set(n.id, []);
    }
    for (const e of doc.graph.edges) {
      if (e.access === 'blocked' || (e.access === 'staff' && !options.includeStaff)) continue;
      if (!(e.weight > 0)) continue;
      const from = this.adjacency.get(e.from);
      const to = this.adjacency.get(e.to);
      if (!from || !to) continue;
      from.push({ node: e.to, edge: e });
      to.push({ node: e.from, edge: e });
    }
  }

  neighbours(id: string): Adjacent[] {
    return this.adjacency.get(id) ?? [];
  }

  private heuristic(a: string, b: string): number {
    const na = this.nodes.get(a)!;
    const nb = this.nodes.get(b)!;
    // На разных этажах эвристика 0: A* превращается в Дейкстру, но остаётся точным.
    return na.level === nb.level ? distance(na.pos, nb.pos) : 0;
  }

  /** A* от узла до узла. Эвристика допустима, только если вес ребра не меньше длины по прямой — так строит редактор. */
  route(from: string, to: string): RouteResult {
    if (!this.nodes.has(from) || !this.nodes.has(to)) return { ok: false, reason: 'unknown_node' };
    if (from === to) return { ok: false, reason: 'same_point' };
    return this.search(from, (id) => id === to, (id) => this.heuristic(id, to));
  }

  /** Дейкстра до ближайшей из нескольких целей — «ближайший туалет» по пути, а не по прямой. */
  nearest(from: string, targets: Iterable<string>): RouteResult {
    if (!this.nodes.has(from)) return { ok: false, reason: 'unknown_node' };
    const goal = new Set(targets);
    if (goal.has(from)) return { ok: false, reason: 'same_point' };
    return this.search(from, (id) => goal.has(id), () => 0);
  }

  private search(from: string, isGoal: (id: string) => boolean, h: (id: string) => number): RouteResult {
    const g = new Map<string, number>([[from, 0]]);
    const came = new Map<string, Adjacent>();
    const open = new MinHeap();
    open.push(from, h(from));
    const closed = new Set<string>();

    while (open.size > 0) {
      const current = open.pop()!;
      if (closed.has(current)) continue;
      if (isGoal(current)) return this.reconstruct(from, current, came, g.get(current)!);
      closed.add(current);
      for (const adj of this.neighbours(current)) {
        if (closed.has(adj.node)) continue;
        const tentative = g.get(current)! + adj.edge.weight;
        if (tentative < (g.get(adj.node) ?? Infinity)) {
          g.set(adj.node, tentative);
          came.set(adj.node, { node: current, edge: adj.edge });
          open.push(adj.node, tentative + h(adj.node));
        }
      }
    }
    return { ok: false, reason: 'not_found' };
  }

  private reconstruct(from: string, to: string, came: Map<string, Adjacent>, length: number): RouteResult {
    const nodes = [to];
    const edges: string[] = [];
    let cur = to;
    while (cur !== from) {
      const step = came.get(cur)!;
      edges.push(step.edge.id);
      nodes.push(step.node);
      cur = step.node;
    }
    return { ok: true, nodes: nodes.reverse(), edges: edges.reverse(), length };
  }
}

/**
 * Узел для произвольной точки плана: ближайший на прямой видимости (не через стену).
 * Если видимых нет — null: привязка через стену некорректна (ТЗ 5.3).
 */
export function nearestVisibleNode(doc: MapDocument, level: string, pos: Vec2): NavNode | null {
  let best: NavNode | null = null;
  let bestD = Infinity;
  for (const n of doc.graph.nodes) {
    if (n.level !== level) continue;
    const d = distance(n.pos, pos);
    if (d < bestD && hasLineOfSight(doc, level, pos, n.pos)) {
      best = n;
      bestD = d;
    }
  }
  return best;
}

/** Линия маршрута на плане: точки узлов по порядку. */
export function routePolyline(graph: NavGraph, nodeIds: string[]): Vec2[] {
  return nodeIds.map((id) => graph.nodes.get(id)!.pos);
}

class MinHeap {
  private items: { id: string; priority: number }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(id: string, priority: number): void {
    this.items.push({ id, priority });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent]!.priority <= this.items[i]!.priority) break;
      [this.items[parent], this.items[i]] = [this.items[i]!, this.items[parent]!];
      i = parent;
    }
  }

  pop(): string | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let min = i;
        if (l < this.items.length && this.items[l]!.priority < this.items[min]!.priority) min = l;
        if (r < this.items.length && this.items[r]!.priority < this.items[min]!.priority) min = r;
        if (min === i) break;
        [this.items[min], this.items[i]] = [this.items[i]!, this.items[min]!];
        i = min;
      }
    }
    return top?.id;
  }
}
