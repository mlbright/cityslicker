import type { Charter, Hills } from './charter';
import { ValueNoise } from './noise';
import { Rng } from './rng';

export const SIZE = 128;
export const CORNERS = SIZE + 1;

/** Steepness (height difference across one tile) limits. */
export const FLAT_SLOPE = 0.28;
export const GENTLE_SLOPE = 0.75;
export const ROAD_SLOPE = 1.1;

export interface Terrain {
  size: number;
  /** Corner heights, (SIZE+1)². Water level is 0. */
  corners: Float32Array;
  /** Mean height per tile. */
  height: Float32Array;
  /** Max minus min corner height per tile. */
  slope: Float32Array;
  /** 1 where the tile is water. */
  water: Uint8Array;
  /** Distance in tiles to the nearest water tile (capped at 40). */
  waterDist: Float32Array;
  /** Tallest point, for colouring. */
  maxHeight: number;
}

const AMPLITUDE: Record<Hills, number> = { flat: 1.4, rolling: 6, mountainous: 12 };

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function generateTerrain(charter: Charter): Terrain {
  const rng = new Rng(charter.seed, `terrain:${charter.water}:${charter.hills}`);
  const noise = new ValueNoise(rng);
  const detail = new ValueNoise(rng);
  const amp = AMPLITUDE[charter.hills];
  const corners = new Float32Array(CORNERS * CORNERS);

  // Land shape: broad hills plus finer detail, always above water before carving.
  for (let y = 0; y < CORNERS; y++) {
    for (let x = 0; x < CORNERS; x++) {
      const n = noise.fbm(x / 46, y / 46, 5);
      const ridge = 1 - Math.abs(detail.fbm(x / 34 + 40, y / 34 - 13, 4));
      let h = 0.5 + 0.5 * n;
      if (charter.hills === 'mountainous') h = h * 0.65 + ridge * ridge * 0.5;
      corners[y * CORNERS + x] = 0.35 + amp * Math.max(0, h - 0.18) * 1.15;
    }
  }

  switch (charter.water) {
    case 'river':
      carveRiver(corners, rng, noise, amp);
      break;
    case 'coastal':
      carveCoast(corners, rng, noise);
      break;
    case 'lakes':
      carveLakes(corners, detail);
      break;
    case 'islands':
      carveIslands(corners, rng, detail);
      break;
  }

  return finishTerrain(corners);
}

function carveRiver(corners: Float32Array, rng: Rng, noise: ValueNoise, amp: number): void {
  const horizontal = rng.chance(0.5);
  const offset = rng.range(-0.15, 0.15);
  const width = rng.range(1.6, 2.6);
  const phase = rng.range(0, 100);
  for (let y = 0; y < CORNERS; y++) {
    for (let x = 0; x < CORNERS; x++) {
      const along = horizontal ? x : y;
      const across = horizontal ? y : x;
      const centre =
        CORNERS * (0.5 + offset) +
        noise.fbm(along / 38 + phase, phase, 3) * 22 +
        Math.sin(along / 17 + phase) * 4;
      const d = Math.abs(across - centre);
      const i = y * CORNERS + x;
      const valley = smoothstep(width, width + 10 + amp * 2.2, d);
      const floor = 0.35;
      let h = floor + (corners[i] - floor) * valley;
      if (d < width + 1.2) h = Math.min(h, -0.7 + smoothstep(width - 0.5, width + 1.2, d) * 1.05);
      corners[i] = h;
    }
  }
}

function carveCoast(corners: Float32Array, rng: Rng, noise: ValueNoise): void {
  const side = rng.int(4);
  const coastAt = rng.range(0.24, 0.34);
  const phase = rng.range(0, 100);
  for (let y = 0; y < CORNERS; y++) {
    for (let x = 0; x < CORNERS; x++) {
      const u = [x, y, CORNERS - 1 - x, CORNERS - 1 - y][side] / (CORNERS - 1);
      const v = [y, x, y, x][side] / (CORNERS - 1);
      const line = coastAt + noise.fbm(v * 3.2 + phase, phase, 4) * 0.12;
      const i = y * CORNERS + x;
      const land = smoothstep(line - 0.02, line + 0.16, u);
      if (u < line) {
        corners[i] = -0.6 - (line - u) * 6;
      } else {
        corners[i] = 0.25 + (corners[i] - 0.25) * land;
      }
    }
  }
}

function carveLakes(corners: Float32Array, detail: ValueNoise): void {
  for (let y = 0; y < CORNERS; y++) {
    for (let x = 0; x < CORNERS; x++) {
      const m = detail.fbm(x / 22 + 91, y / 22 - 47, 3);
      const i = y * CORNERS + x;
      const keep = smoothstep(-0.36, 0.08, m);
      const h = 0.3 + (corners[i] - 0.3) * keep;
      corners[i] = m < -0.36 ? -0.5 - (-0.36 - m) * 4 : h;
    }
  }
}

function carveIslands(corners: Float32Array, rng: Rng, detail: ValueNoise): void {
  const cx = CORNERS * rng.range(0.42, 0.58);
  const cy = CORNERS * rng.range(0.42, 0.58);
  for (let y = 0; y < CORNERS; y++) {
    for (let x = 0; x < CORNERS; x++) {
      const dx = (x - cx) / (CORNERS * 0.5);
      const dy = (y - cy) / (CORNERS * 0.5);
      const r = Math.sqrt(dx * dx + dy * dy);
      const mask = detail.fbm(x / 20 + 300, y / 20 + 300, 4) + 0.42 - 0.75 * r * r;
      const i = y * CORNERS + x;
      if (mask < 0) corners[i] = -0.5 + mask * 3;
      else corners[i] = 0.25 + (corners[i] - 0.25) * smoothstep(0, 0.55, mask);
    }
  }
}

export function finishTerrain(corners: Float32Array): Terrain {
  const n = SIZE * SIZE;
  const height = new Float32Array(n);
  const slope = new Float32Array(n);
  const water = new Uint8Array(n);
  let maxHeight = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const a = corners[y * CORNERS + x];
      const b = corners[y * CORNERS + x + 1];
      const c = corners[(y + 1) * CORNERS + x];
      const d = corners[(y + 1) * CORNERS + x + 1];
      const i = y * SIZE + x;
      height[i] = (a + b + c + d) / 4;
      slope[i] = Math.max(a, b, c, d) - Math.min(a, b, c, d);
      water[i] = height[i] < 0 ? 1 : 0;
      maxHeight = Math.max(maxHeight, a);
    }
  }
  return { size: SIZE, corners, height, slope, water, waterDist: distanceField(water), maxHeight };
}

/** Breadth-first distance (8-connected) from every water tile, capped at 40. */
export function distanceField(source: Uint8Array): Float32Array {
  const dist = new Float32Array(SIZE * SIZE).fill(40);
  const queue = new Int32Array(SIZE * SIZE);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i]) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % SIZE;
    const y = (i - x) / SIZE;
    const nd = dist[i] + 1;
    if (nd >= 40) continue;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        const j = ny * SIZE + nx;
        if (dist[j] > nd) {
          dist[j] = nd;
          queue[tail++] = j;
        }
      }
    }
  }
  return dist;
}

/** Height of the terrain surface at world position (x, z), matching the rendered triangles. */
export function heightAt(t: Terrain, x: number, z: number): number {
  const cx = Math.max(0, Math.min(SIZE - 1e-4, x));
  const cz = Math.max(0, Math.min(SIZE - 1e-4, z));
  const x0 = Math.floor(cx);
  const z0 = Math.floor(cz);
  const fx = cx - x0;
  const fz = cz - z0;
  const a = t.corners[z0 * CORNERS + x0];
  const b = t.corners[z0 * CORNERS + x0 + 1];
  const c = t.corners[(z0 + 1) * CORNERS + x0];
  const d = t.corners[(z0 + 1) * CORNERS + x0 + 1];
  // Quads are split along the a–d diagonal.
  if (fx >= fz) return a + (b - a) * fx + (d - b) * fz;
  return a + (d - c) * fx + (c - a) * fz;
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < SIZE && y < SIZE;
}
