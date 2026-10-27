import { CityState, DIRS, lotCapacity, N_TILES, roadConn, roadTier, Tier, type Centre } from './state';
import { GENTLE_SLOPE, SIZE, type Terrain } from './terrain';

/** Separable box blur with the given radius (edges are clamped). */
export function boxBlur(src: Float32Array, radius: number): Float32Array {
  const tmp = new Float32Array(N_TILES);
  const out = new Float32Array(N_TILES);
  const span = radius * 2 + 1;
  for (let y = 0; y < SIZE; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[y * SIZE + clamp(x)];
    for (let x = 0; x < SIZE; x++) {
      tmp[y * SIZE + x] = sum / span;
      sum += src[y * SIZE + clamp(x + radius + 1)] - src[y * SIZE + clamp(x - radius)];
    }
  }
  for (let x = 0; x < SIZE; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[clamp(y) * SIZE + x];
    for (let y = 0; y < SIZE; y++) {
      out[y * SIZE + x] = sum / span;
      sum += tmp[clamp(y + radius + 1) * SIZE + x] - tmp[clamp(y - radius) * SIZE + x];
    }
  }
  return out;
}

function clamp(v: number): number {
  return v < 0 ? 0 : v >= SIZE ? SIZE - 1 : v;
}

export interface CentreSize {
  centre: Centre;
  population: number;
  /** How far growth around this Centre may reach. */
  radius: number;
}

export function growthRadius(population: number): number {
  return Math.min(30, 9 + Math.sqrt(population) * 0.24);
}

/** Influence of the nearest large Centre, 0..1. */
export function centreInfluence(centres: readonly CentreSize[], targetPopulation: number): Float32Array {
  const out = new Float32Array(N_TILES);
  for (const c of centres) {
    const strength = 0.55 + 0.45 * Math.min(1, c.population / (targetPopulation * 0.25));
    const reach = 6 + c.radius * 0.6;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const d = Math.hypot(x - c.centre.x, y - c.centre.y);
        const v = strength * Math.exp(-d / reach);
        const i = y * SIZE + x;
        if (v > out[i]) out[i] = v;
      }
    }
  }
  return out;
}

export interface LandValueInputs {
  terrain: Terrain;
  state: CityState;
  influence: Float32Array;
  pollution: Float32Array;
}

/** Industrial pollution, 0..1, spread a few tiles around each industrial Lot. */
export function computePollution(state: CityState): Float32Array {
  const src = new Float32Array(N_TILES);
  for (const lot of state.lots.values()) {
    if (lot.use !== 'I' || !lot.building || lot.building.abandonedTick >= 0) continue;
    const v = 0.5 + 0.5 * lot.building.density;
    for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) src[y * SIZE + x] = v;
  }
  for (let i = 0; i < N_TILES; i++) if (roadTier(state.road[i]) === Tier.Highway) src[i] = Math.max(src[i], 0.25);
  const blurred = boxBlur(src, 4);
  for (let i = 0; i < N_TILES; i++) blurred[i] = Math.min(1, blurred[i] * 2.6);
  return blurred;
}

/** Amenity from Parks and Civic buildings, 0..1. */
export function computeAmenity(state: CityState): Float32Array {
  const src = new Float32Array(N_TILES);
  for (const lot of state.lots.values()) {
    if (lot.use !== 'park' && lot.use !== 'civic') continue;
    const v = lot.use === 'park' ? 1 : 0.7;
    for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) src[y * SIZE + x] = v;
  }
  for (let i = 0; i < N_TILES; i++) if (state.pocket[i]) src[i] = Math.max(src[i], 0.4);
  const blurred = boxBlur(src, 5);
  for (let i = 0; i < N_TILES; i++) blurred[i] = Math.min(1, blurred[i] * 5);
  return blurred;
}

export function computeLandValue(inputs: LandValueInputs, amenity: Float32Array): Float32Array {
  const { terrain, influence, pollution } = inputs;
  const out = new Float32Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) {
    if (terrain.water[i]) continue;
    const water = 0.14 * Math.exp(-(terrain.waterDist[i] - 1) / 3);
    const slope = 0.12 * Math.min(1, terrain.slope[i] / GENTLE_SLOPE);
    const v = 0.14 + 0.62 * influence[i] + water + 0.14 * amenity[i] - 0.4 * pollution[i] - slope;
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

export interface Arterial {
  a: number;
  b: number;
  tiles: number[];
}

/**
 * Traffic per road tile, 0..1: homes and jobs nearby, plus through traffic on the arterials
 * between Centres and on highways. No individual trips are simulated.
 */
export function computeTraffic(
  state: CityState,
  arterials: readonly Arterial[],
  centrePopulation: ReadonlyMap<number, number>,
  cityPopulation: number,
): Float32Array {
  const activity = new Float32Array(N_TILES);
  for (const lot of state.lots.values()) {
    const cap = lotCapacity(lot);
    if (cap <= 0) continue;
    const per = cap / (lot.w * lot.h);
    for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) activity[y * SIZE + x] = per;
  }
  const local = boxBlur(activity, 6);
  const raw = new Float32Array(N_TILES);
  const span = 13 * 13;
  for (let i = 0; i < N_TILES; i++) {
    const tier = roadTier(state.road[i]);
    if (tier === Tier.None) continue;
    raw[i] = local[i] * span * 0.8;
    if (tier === Tier.Highway) raw[i] += cityPopulation * 0.35;
  }
  for (const art of arterials) {
    const load = Math.sqrt((centrePopulation.get(art.a) ?? 0) * (centrePopulation.get(art.b) ?? 0)) * 1.4;
    for (const t of art.tiles) if (roadTier(state.road[t]) !== Tier.None) raw[t] += load;
  }
  // Smooth along connected roads so busy stretches form continuous runs.
  let cur = raw;
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float32Array(N_TILES);
    for (let i = 0; i < N_TILES; i++) {
      if (cur[i] === 0 && roadTier(state.road[i]) === Tier.None) continue;
      const conn = roadConn(state.road[i]);
      let sum = cur[i] * 2;
      let n = 2;
      const x = i % SIZE;
      const y = (i - x) / SIZE;
      for (let d = 0; d < 8; d++) {
        if (!(conn & (1 << d))) continue;
        sum += cur[(y + DIRS[d][1]) * SIZE + x + DIRS[d][0]];
        n++;
      }
      next[i] = sum / n;
    }
    cur = next;
  }
  const out = new Float32Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) if (cur[i] > 0) out[i] = 1 - Math.exp(-cur[i] / 2600);
  return out;
}

export function toBytes(field: Float32Array): Uint8Array {
  const out = new Uint8Array(field.length);
  for (let i = 0; i < field.length; i++) out[i] = Math.round(Math.max(0, Math.min(1, field[i])) * 255);
  return out;
}
