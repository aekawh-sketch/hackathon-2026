// Маршруты по явному графу — ТЗ 5.8, 5.9. Граф — источник истины, стены сами проходимость не создают.
import { distance, hasLineOfSight } from './geometry.ts';
import type { MapDocument, NavEdge, NavNode, Vec2 } from './types.ts';

export interface RouteOptions {
  /** Посетитель не видит рёбер «только для персонала». */
  includeStaff?: boolean;
  /**
   * Штраф за поворот — столько метров добавляет поворот на 90°. Из почти равных путей выбирается тот,
   * где меньше поворотов: так ходят люди. 0 — чистый кратчайший путь. Длина в ответе — всегда честные метры.
   */
  turnPenalty?: number;
}

export type RouteResult =
  | { ok: true; nodes: string[]; edges: string[]; length: number }
  | { ok: false; reason: 'same_point' | 'not_found' | 'unknown_node' };

interface Adjacent {
  node: string;
  edge: NavEdge;
}

/** Состояние поиска: узел и откуда в него пришли — без штрафа за поворот откуда пришли не важно. */
interface SearchState {
  node: string;
  prev: string | null;
  cost: number;
  length: number;
  back: string | null;
  edge: NavEdge | null;
}

export class NavGraph {
  readonly nodes = new Map<string, NavNode>();
  private readonly adjacency = new Map<string, Adjacent[]>();
  private readonly turnPenalty: number;

  constructor(doc: MapDocument, options: RouteOptions = {}) {
    this.turnPenalty = Math.max(0, options.turnPenalty ?? 0);
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

  /** Длины кратчайших путей от узла до всех достижимых (Дейкстра, без штрафа за повороты). */
  distancesFrom(from: string): Map<string, number> {
    const dist = new Map<string, number>([[from, 0]]);
    if (!this.nodes.has(from)) return new Map();
    const open = new MinHeap();
    open.push(from, 0);
    const done = new Set<string>();
    while (open.size > 0) {
      const current = open.pop()!;
      if (done.has(current)) continue;
      done.add(current);
      for (const adj of this.neighbours(current)) {
        const d = dist.get(current)! + adj.edge.weight;
        if (d < (dist.get(adj.node) ?? Infinity)) {
          dist.set(adj.node, d);
          open.push(adj.node, d);
        }
      }
    }
    return dist;
  }

  private search(from: string, isGoal: (id: string) => boolean, h: (id: string) => number): RouteResult {
    const turns = this.turnPenalty > 0;
    // Со штрафом за поворот цена шага зависит от того, откуда пришли, — состояние «узел + предыдущий».
    const key = (node: string, prev: string | null) => (turns ? `${node}\u0000${prev ?? ''}` : node);
    const states = new Map<string, SearchState>();
    const startKey = key(from, null);
    states.set(startKey, { node: from, prev: null, cost: 0, length: 0, back: null, edge: null });
    const open = new MinHeap();
    open.push(startKey, h(from));
    const closed = new Set<string>();

    while (open.size > 0) {
      const currentKey = open.pop()!;
      if (closed.has(currentKey)) continue;
      const current = states.get(currentKey)!;
      if (isGoal(current.node)) return this.reconstruct(states, currentKey);
      closed.add(currentKey);
      for (const adj of this.neighbours(current.node)) {
        const nextKey = key(adj.node, current.node);
        if (closed.has(nextKey)) continue;
        const turn = turns && current.prev ? (this.turnPenalty * this.turnAngle(current.prev, current.node, adj.node)) / 90 : 0;
        const cost = current.cost + adj.edge.weight + turn;
        if (cost < (states.get(nextKey)?.cost ?? Infinity)) {
          states.set(nextKey, { node: adj.node, prev: current.node, cost, length: current.length + adj.edge.weight, back: currentKey, edge: adj.edge });
          open.push(nextKey, cost + h(adj.node));
        }
      }
    }
    return { ok: false, reason: 'not_found' };
  }

  /** Угол поворота в узле b по пути a → b → c, градусы 0…180. Между этажами поворота нет. */
  private turnAngle(a: string, b: string, c: string): number {
    const na = this.nodes.get(a)!;
    const nb = this.nodes.get(b)!;
    const nc = this.nodes.get(c)!;
    if (na.level !== nb.level || nb.level !== nc.level) return 0;
    const ux = nb.pos[0] - na.pos[0];
    const uy = nb.pos[1] - na.pos[1];
    const vx = nc.pos[0] - nb.pos[0];
    const vy = nc.pos[1] - nb.pos[1];
    const lu = Math.hypot(ux, uy);
    const lv = Math.hypot(vx, vy);
    if (lu < 1e-9 || lv < 1e-9) return 0;
    const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)));
    return (Math.acos(cos) * 180) / Math.PI;
  }

  private reconstruct(states: Map<string, SearchState>, lastKey: string): RouteResult {
    const last = states.get(lastKey)!;
    const nodes = [last.node];
    const edges: string[] = [];
    let cur = last;
    while (cur.back !== null) {
      edges.push(cur.edge!.id);
      cur = states.get(cur.back)!;
      nodes.push(cur.node);
    }
    return { ok: true, nodes: nodes.reverse(), edges: edges.reverse(), length: last.length };
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
