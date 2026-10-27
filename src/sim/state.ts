import { SIZE } from './terrain';

export const TICKS_PER_YEAR = 12;
export const RUN_YEARS = 100;
export const RUN_TICKS = TICKS_PER_YEAR * RUN_YEARS;
export const N_TILES = SIZE * SIZE;

export type Zone = 'R' | 'C' | 'I';
export type LotUse = Zone | 'park' | 'civic';
export type Density = 1 | 2 | 3;
export type CivicKind = 'townhall' | 'school' | 'fire' | 'clinic' | 'library' | 'landmark';

/** Road tiers. Dirt → Street → Avenue is the Promotion ladder; Highway is only ever built. */
export const Tier = { None: 0, Dirt: 1, Street: 2, Avenue: 3, Highway: 4 } as const;
export type TierValue = (typeof Tier)[keyof typeof Tier];

/** Eight directions, used as bits in a road tile's connection mask. */
export const DIRS: readonly (readonly [number, number])[] = [
  [0, -1], // 0 N
  [1, -1], // 1 NE
  [1, 0], // 2 E
  [1, 1], // 3 SE
  [0, 1], // 4 S
  [-1, 1], // 5 SW
  [-1, 0], // 6 W
  [-1, -1], // 7 NW
];
export const opposite = (dir: number): number => (dir + 4) & 7;
export const isDiagonal = (dir: number): boolean => (dir & 1) === 1;

export interface Building {
  density: Density;
  /** Per-building variety for the renderer. */
  variant: number;
  builtTick: number;
  /** -1 while the Building is occupied. */
  abandonedTick: number;
  civic?: CivicKind;
}

/** Lots are immutable values: every change replaces the whole Lot. */
export interface Lot {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  use: LotUse;
  zonedTick: number;
  /** The Centre this Lot belongs to. */
  centre: number;
  building: Building | null;
}

export interface Centre {
  id: number;
  x: number;
  y: number;
  name: string;
  foundedTick: number;
}

/** Packed road tile: tier in the high byte, connection mask in the low byte. */
export const packRoad = (tier: number, conn: number): number => (tier << 8) | conn;
export const roadTier = (packed: number): number => packed >> 8;
export const roadConn = (packed: number): number => packed & 255;

/**
 * One reversible step of growth. The Time lapse is a list of these per tick; applying them
 * forward grows the City and applying them backward rewinds it.
 */
export type Change =
  | { k: 'road'; i: number; from: number; to: number; promotion?: true }
  | { k: 'pocket'; i: number; from: number; to: number }
  | { k: 'lot'; id: number; from: Lot | null; to: Lot | null }
  | { k: 'centre'; id: number; from: Centre | null; to: Centre | null };

export class CityState {
  readonly road = new Uint16Array(N_TILES);
  readonly pocket = new Uint8Array(N_TILES);
  readonly lotAt = new Int32Array(N_TILES);
  readonly lots = new Map<number, Lot>();
  readonly centres = new Map<number, Centre>();

  clone(): CityState {
    const c = new CityState();
    c.road.set(this.road);
    c.pocket.set(this.pocket);
    c.lotAt.set(this.lotAt);
    for (const [id, lot] of this.lots) c.lots.set(id, lot);
    for (const [id, centre] of this.centres) c.centres.set(id, centre);
    return c;
  }
}

export function applyChange(s: CityState, c: Change, forward: boolean): void {
  switch (c.k) {
    case 'road':
      s.road[c.i] = forward ? c.to : c.from;
      return;
    case 'pocket':
      s.pocket[c.i] = forward ? c.to : c.from;
      return;
    case 'lot': {
      const prev = forward ? c.from : c.to;
      const next = forward ? c.to : c.from;
      if (prev) {
        s.lots.delete(prev.id);
        fillLot(s.lotAt, prev, 0);
      }
      if (next) {
        s.lots.set(next.id, next);
        fillLot(s.lotAt, next, next.id);
      }
      return;
    }
    case 'centre': {
      const next = forward ? c.to : c.from;
      if (next) s.centres.set(c.id, next);
      else s.centres.delete(c.id);
      return;
    }
  }
}

export function applyChanges(s: CityState, changes: readonly Change[], forward: boolean): void {
  if (forward) for (let i = 0; i < changes.length; i++) applyChange(s, changes[i], true);
  else for (let i = changes.length - 1; i >= 0; i--) applyChange(s, changes[i], false);
}

function fillLot(lotAt: Int32Array, lot: Lot, value: number): void {
  for (let y = lot.y; y < lot.y + lot.h; y++) {
    for (let x = lot.x; x < lot.x + lot.w; x++) lotAt[y * SIZE + x] = value;
  }
}

/** Residents (R) or jobs (C, I) a Lot provides. Abandoned and unbuilt Lots provide none. */
export function lotCapacity(lot: Lot): number {
  const b = lot.building;
  if (!b || b.abandonedTick >= 0) return 0;
  const area = lot.w * lot.h;
  switch (lot.use) {
    case 'R':
      return area * [0, 9, 40, 140][b.density];
    case 'C':
      return area * [0, 6, 28, 110][b.density];
    case 'I':
      return area * [0, 12, 28, 52][b.density];
    default:
      return 0;
  }
}

/** Simple hash of a state, for reproducibility and reversibility tests. */
export function stateDigest(s: CityState): string {
  let h = 2166136261;
  const mix = (v: number) => {
    h ^= v | 0;
    h = Math.imul(h, 16777619);
  };
  for (let i = 0; i < N_TILES; i++) {
    mix(s.road[i]);
    mix(s.pocket[i]);
    mix(s.lotAt[i]);
  }
  const ids = [...s.lots.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const l = s.lots.get(id)!;
    mix(l.x); mix(l.y); mix(l.w); mix(l.h); mix(l.use.charCodeAt(0)); mix(l.centre);
    if (l.building) {
      mix(l.building.density); mix(l.building.variant); mix(l.building.builtTick); mix(l.building.abandonedTick);
    }
  }
  for (const c of s.centres.values()) { mix(c.id); mix(c.x); mix(c.y); }
  return (h >>> 0).toString(16);
}
