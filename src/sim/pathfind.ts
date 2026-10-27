import { DIRS, N_TILES } from './state';
import { SIZE } from './terrain';

export interface PathOptions {
  isGoal(i: number): boolean;
  /** Admissible estimate of the remaining cost. */
  heuristic(i: number): number;
  /** Cost of stepping from one tile to its neighbour in direction `dir`; Infinity when blocked. */
  stepCost(from: number, to: number, dir: number): number;
  /** Allow 45° moves. */
  diagonal: boolean;
  /** Extra cost per 45° of turning. */
  turnPenalty: number;
  maxExpanded?: number;
}

const NO_DIR = 8;

/** A* over tiles with direction-aware states so turns cost extra. Returns tile indices, start first. */
export function findPath(starts: readonly number[], opts: PathOptions): number[] | null {
  const states = N_TILES * 9;
  const g = new Float32Array(states).fill(Infinity);
  const parent = new Int32Array(states).fill(-1);
  const closed = new Uint8Array(states);
  const heap = new MinHeap();
  for (const s of starts) {
    const id = s * 9 + NO_DIR;
    g[id] = 0;
    heap.push(opts.heuristic(s), id);
  }
  const maxExpanded = opts.maxExpanded ?? 60000;
  let expanded = 0;
  while (heap.size > 0) {
    const id = heap.pop();
    if (closed[id]) continue;
    closed[id] = 1;
    const tile = (id / 9) | 0;
    const inDir = id - tile * 9;
    if (opts.isGoal(tile)) return unwind(parent, id);
    if (++expanded > maxExpanded) return null;
    const x = tile % SIZE;
    const y = (tile - x) / SIZE;
    for (let d = 0; d < 8; d++) {
      if (!opts.diagonal && d & 1) continue;
      let turn = 0;
      if (inDir !== NO_DIR) {
        const diff = Math.abs(d - inDir);
        turn = Math.min(diff, 8 - diff);
        if (turn > 2) continue; // no sharp turns or U-turns
      }
      const nx = x + DIRS[d][0];
      const ny = y + DIRS[d][1];
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
      const next = ny * SIZE + nx;
      const step = opts.stepCost(tile, next, d);
      if (!Number.isFinite(step)) continue;
      const nid = next * 9 + d;
      const ng = g[id] + step + turn * opts.turnPenalty;
      if (ng < g[nid]) {
        g[nid] = ng;
        parent[nid] = id;
        heap.push(ng + opts.heuristic(next), nid);
      }
    }
  }
  return null;
}

function unwind(parent: Int32Array, id: number): number[] {
  const path: number[] = [];
  for (let cur = id; cur !== -1; cur = parent[cur]) path.push((cur / 9) | 0);
  return path.reverse();
}

/** Octile distance between two tiles. */
export function octile(a: number, b: number): number {
  const ax = a % SIZE;
  const bx = b % SIZE;
  const dx = Math.abs(ax - bx);
  const dy = Math.abs((a - ax) / SIZE - (b - bx) / SIZE);
  return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    const keys = this.keys;
    const vals = this.vals;
    let i = keys.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const top = vals[0];
    const lastKey = keys.pop()!;
    const lastVal = vals.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = lastKey;
      vals[i] = lastVal;
    }
    return top;
  }
}
