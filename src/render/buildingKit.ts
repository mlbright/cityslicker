import * as THREE from 'three';
import { Rng } from '../sim/rng';
import type { CivicKind, Lot } from '../sim/state';
import type { PartKind } from './geometries';

export interface PartSpec {
  kind: PartKind;
  /** Base centre, relative to the Lot's ground anchor (its north-west corner). */
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rot: number;
  color: THREE.Color;
}

const C = (hex: string) => new THREE.Color(hex);

const WALLS_R = ['#fff4e0', '#ffd9c2', '#ffd1dc', '#d6f2e3', '#d4e9fa', '#fff1b8', '#f3e1ff', '#ffe7cc'].map(C);
const ROOFS = ['#e5866a', '#f29e8e', '#7f8fb3', '#71c3a4', '#efc25c', '#b49ad8', '#e36f7f', '#6fa8dc'].map(C);
const APARTMENT = ['#ffe3d3', '#f7d6e6', '#d9efe2', '#e2e8fb', '#fff0c9', '#f6dcc8'].map(C);
const TOWER = ['#f9e6dc', '#e3ecfa', '#ffeef3', '#e6f6ee', '#f4ecdf'].map(C);
const SHOP = ['#ffd6a5', '#caffbf', '#9bf6ff', '#ffc6ff', '#fdffb6', '#ffadad', '#a0c4ff'].map(C);
const AWNING = ['#ff6f91', '#ff9671', '#ffc75f', '#00c9a7', '#4d8af0', '#c34a36'].map(C);
const GLASS = ['#a9cdea', '#9fd8d0', '#c3b8f0', '#b4d7f7', '#a6e3cf'].map(C);
const INDUSTRY = ['#eadbbd', '#d9cbb0', '#c8d3dc', '#e3d2c3', '#d5dcc6'].map(C);
const INDUSTRY_ROOF = ['#a7adbd', '#b9b2a3', '#93a3b8', '#c2a28a'].map(C);
const TREE = ['#7cc67a', '#69b96e', '#8fd082', '#5fae6a', '#a3d977'].map(C);
const WHITE = C('#fbf8f2');
const CREAM = C('#f6efe1');
const DOOR = C('#8a6a5a');
const TRUNK = C('#a07454');
const CHIMNEY = C('#c9705a');
const STRIPE_RED = C('#e8584f');
const STEEL = C('#b8c0cc');
const POND = C('#7cc4ea');
const PATH = C('#efe2c4');
const GOLD = C('#f2c14e');
const CLOCK = C('#fffaf0');
const FADE = C('#c9c2b8');
const WEED = C('#7f9f5a');

const FLOOR = 0.27;

/** Assembles parts in a frame where the Lot's front (the side facing its Road) is -z. */
class Builder {
  readonly parts: PartSpec[] = [];
  readonly rng: Rng;

  constructor(
    seed: number,
    readonly W: number,
    readonly D: number,
    readonly abandoned: boolean,
  ) {
    this.rng = new Rng(seed, 'kit');
  }

  col(c: THREE.Color): THREE.Color {
    return this.abandoned ? c.clone().lerp(FADE, 0.6) : c;
  }

  add(kind: PartKind, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.Color, rot = 0): void {
    if (this.abandoned && kind === 'window') kind = 'windowDark';
    this.parts.push({ kind, x, y, z, sx, sy, sz, rot, color: kind.startsWith('window') ? color : this.col(color) });
  }

  pick<T>(items: readonly T[]): T {
    return this.rng.pick(items);
  }

  /** Window bands on all four faces of a box, one per floor. */
  bands(cx: number, cz: number, sx: number, sz: number, y0: number, floors: number, lit = 0.75, glass = C('#90b4d8')): void {
    for (let f = 0; f < floors; f++) {
      const y = y0 + f * FLOOR + FLOOR * 0.32;
      const hgt = FLOOR * 0.42;
      for (const side of [-1, 1]) {
        this.add(this.rng.chance(lit) ? 'window' : 'windowDark', cx, y, cz + side * (sz / 2 + 0.006), sx * 0.84, hgt, 0.02, glass);
        this.add(this.rng.chance(lit) ? 'window' : 'windowDark', cx + side * (sx / 2 + 0.006), y, cz, 0.02, hgt, sz * 0.84, glass);
      }
    }
  }

  tree(x: number, z: number, scale = 1): void {
    const s = scale * this.rng.range(0.8, 1.15);
    this.add('cyl', x, 0, z, 0.07 * s, 0.22 * s, 0.07 * s, TRUNK);
    this.add('ball', x, 0.14 * s, z, 0.42 * s, 0.42 * s, 0.42 * s, this.pick(TREE));
  }

  bush(x: number, z: number, s = 0.22, color?: THREE.Color): void {
    this.add('ball', x, -0.03, z, s, s * 0.8, s, color ?? this.pick(TREE));
  }
}

/** Parts for whatever stands on a Lot. `front` is the side facing the Road: 0 N, 1 E, 2 S, 3 W. */
export function buildingParts(lot: Lot, front: number): PartSpec[] {
  const b = lot.building;
  if (!b && lot.use !== 'park') return [];
  const sideways = front === 1 || front === 3;
  const W = sideways ? lot.h : lot.w;
  const D = sideways ? lot.w : lot.h;
  const k = new Builder(b?.variant ?? lot.id * 7919, W, D, (b?.abandonedTick ?? -1) >= 0);
  switch (lot.use) {
    case 'R':
      if (b!.density === 1) cottages(k);
      else if (b!.density === 2) apartments(k);
      else residentialTower(k);
      break;
    case 'C':
      if (b!.density === 1) shop(k);
      else if (b!.density === 2) office(k);
      else skyscraper(k);
      break;
    case 'I':
      if (b!.density === 1) workshop(k);
      else factory(k, b!.density === 3);
      break;
    case 'park':
      park(k);
      break;
    case 'civic':
      civic(k, b!.civic ?? 'townhall');
      break;
  }
  if (k.abandoned) overgrow(k);
  // Rotate from the canonical frame (front = -z) into the Lot's frame.
  const theta = [0, -Math.PI / 2, Math.PI, Math.PI / 2][front];
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return k.parts.map((p) => ({
    ...p,
    x: lot.w / 2 + p.x * cos + p.z * sin,
    z: lot.h / 2 - p.x * sin + p.z * cos,
    rot: p.rot + theta,
  }));
}

// ------------------------------------------------------------------ residential

function cottages(k: Builder): void {
  const count = k.W >= 2 && k.rng.chance(0.7) ? Math.floor(k.W) : 1;
  const slot = k.W / count;
  for (let n = 0; n < count; n++) {
    const cx = -k.W / 2 + slot * (n + 0.5);
    const bw = Math.min(slot, 1.6) * k.rng.range(0.55, 0.72);
    const bd = Math.min(k.D, 1.2) * k.rng.range(0.48, 0.6);
    const bh = k.rng.range(0.34, 0.46);
    const cz = -k.D / 2 + 0.2 + bd / 2;
    const wall = k.pick(WALLS_R);
    const roof = k.pick(ROOFS);
    k.add('box', cx, 0, cz, bw, bh, bd, wall);
    if (k.rng.chance(0.75)) k.add('gable', cx, bh, cz, bw + 0.08, k.rng.range(0.24, 0.34), bd + 0.1, roof);
    else k.add('hip', cx, bh, cz, bw + 0.1, k.rng.range(0.22, 0.3), bd + 0.1, roof);
    if (k.rng.chance(0.6)) k.add('box', cx + bw * 0.28, bh, cz + bd * 0.15, 0.07, 0.3, 0.07, CHIMNEY);
    k.add('box', cx, 0, cz - bd / 2 - 0.005, 0.1, 0.19, 0.02, DOOR);
    for (const side of [-1, 1]) k.add('window', cx + side * bw * 0.28, 0.17, cz - bd / 2 - 0.005, 0.1, 0.1, 0.02, C('#9cc2e6'));
    // Garden behind.
    const garden = k.D / 2 - (cz + bd / 2);
    if (garden > 0.35) k.tree(cx + k.rng.range(-0.2, 0.2) * slot, cz + bd / 2 + garden * 0.55, 0.8);
    else if (k.rng.chance(0.5)) k.bush(cx + bw * 0.5 + 0.06, cz - bd * 0.2);
  }
}

function apartments(k: Builder): void {
  const bw = k.W * k.rng.range(0.72, 0.84);
  const bd = k.D * k.rng.range(0.62, 0.76);
  const floors = 3 + k.rng.int(3) + (k.W * k.D >= 4 ? 1 : 0);
  const h = floors * FLOOR;
  const cz = -k.D / 2 + 0.16 + bd / 2;
  const wall = k.pick(APARTMENT);
  k.add('box', 0, 0, cz, bw, h, bd, wall);
  k.bands(0, cz, bw, bd, 0, floors, 0.7);
  if (k.rng.chance(0.4)) {
    k.add('hip', 0, h, cz, bw + 0.06, 0.32, bd + 0.06, k.pick(ROOFS));
  } else {
    k.add('box', 0, h, cz, bw + 0.04, 0.05, bd + 0.04, wall.clone().multiplyScalar(0.92));
    k.add('box', bw * 0.22, h, cz + bd * 0.1, bw * 0.22, 0.16, bd * 0.3, CREAM);
  }
  k.add('box', 0, 0, cz - bd / 2 - 0.01, 0.16, 0.22, 0.03, DOOR);
  if (k.D - bd > 0.6) k.tree(k.rng.range(-0.3, 0.3) * k.W, k.D / 2 - 0.3, 0.9);
}

function residentialTower(k: Builder): void {
  const fw = k.W * 0.86;
  const fd = k.D * 0.82;
  const wall = k.pick(TOWER);
  const accent = k.pick(ROOFS);
  k.add('box', 0, 0, 0, fw, FLOOR * 1.4, fd, accent.clone().lerp(WHITE, 0.6));
  k.bands(0, 0, fw, fd, 0, 1, 0.9, C('#f6d38e'));
  const tw = Math.min(fw, 2.6) * k.rng.range(0.62, 0.78);
  const td = Math.min(fd, 2.6) * k.rng.range(0.62, 0.78);
  const floors = 10 + k.rng.int(10) + Math.floor(Math.min(k.W, k.D) * 2);
  const base = FLOOR * 1.4;
  k.add('box', 0, base, 0, tw, floors * FLOOR, td, wall);
  k.bands(0, 0, tw, td, base, floors, 0.72);
  // Balcony stripes in an accent colour.
  for (let f = 2; f < floors; f += 3) k.add('box', 0, base + f * FLOOR, -td / 2 - 0.02, tw * 0.9, 0.035, 0.05, accent);
  const top = base + floors * FLOOR;
  k.add('box', 0, top, 0, tw + 0.05, 0.06, td + 0.05, accent);
  k.add('cyl', tw * 0.2, top, td * 0.15, 0.22, 0.24, 0.22, STEEL);
}

// ------------------------------------------------------------------ commercial

function shop(k: Builder): void {
  const bw = k.W * k.rng.range(0.78, 0.88);
  const bd = k.D * k.rng.range(0.6, 0.72);
  const bh = k.rng.range(0.38, 0.5) + (k.rng.chance(0.3) ? FLOOR : 0);
  const cz = -k.D / 2 + 0.14 + bd / 2;
  const wall = k.pick(SHOP);
  k.add('box', 0, 0, cz, bw, bh, bd, wall);
  k.add('box', 0, bh, cz, bw + 0.04, 0.05, bd + 0.04, wall.clone().multiplyScalar(0.9));
  k.add('window', 0, 0.06, cz - bd / 2 - 0.005, bw * 0.7, 0.16, 0.02, C('#bfe0f5'));
  // Striped awning.
  const stripes = Math.max(3, Math.round(bw * 5));
  for (let s = 0; s < stripes; s++) {
    const x = -bw / 2 + (bw / stripes) * (s + 0.5);
    k.add('box', x, 0.25, cz - bd / 2 - 0.09, bw / stripes, 0.035, 0.2, s % 2 ? WHITE : k.pick(AWNING));
  }
  k.add('box', 0, bh + 0.05, cz - bd / 2 + 0.06, bw * 0.5, 0.14, 0.04, k.pick(AWNING));
}

function office(k: Builder): void {
  const bw = k.W * k.rng.range(0.74, 0.86);
  const bd = k.D * k.rng.range(0.68, 0.8);
  const floors = 4 + k.rng.int(4) + (k.W * k.D >= 4 ? 2 : 0);
  const glass = k.pick(GLASS);
  const wall = WHITE.clone().lerp(glass, 0.35);
  k.add('box', 0, 0, 0, bw, floors * FLOOR, bd, wall);
  k.bands(0, 0, bw, bd, 0, floors, 0.8, glass);
  k.add('box', 0, floors * FLOOR, 0, bw * 0.4, 0.14, bd * 0.4, STEEL);
  k.add('box', 0, 0, -bd / 2 - 0.05, bw * 0.5, 0.05, 0.12, k.pick(AWNING));
}

function skyscraper(k: Builder): void {
  const glass = k.pick(GLASS);
  const frame = WHITE.clone().lerp(glass, 0.25);
  let w = Math.min(k.W, 3.2) * 0.8;
  let d = Math.min(k.D, 3.2) * 0.8;
  let y = 0;
  k.add('box', 0, 0, 0, k.W * 0.9, FLOOR * 2, k.D * 0.88, frame);
  k.bands(0, 0, k.W * 0.9, k.D * 0.88, 0, 2, 0.95, C('#f6d38e'));
  y = FLOOR * 2;
  const tiers = 1 + k.rng.int(3);
  const total = 14 + k.rng.int(14) + Math.floor(Math.min(k.W, k.D) * 3);
  for (let t = 0; t < tiers; t++) {
    const floors = Math.max(3, Math.round(total / tiers) - t * 2);
    k.add('box', 0, y, 0, w, floors * FLOOR, d, frame);
    k.bands(0, 0, w, d, y, floors, 0.78, glass);
    y += floors * FLOOR;
    k.add('box', 0, y, 0, w + 0.06, 0.05, d + 0.06, glass.clone().multiplyScalar(0.85));
    y += 0.05;
    w *= 0.78;
    d *= 0.78;
  }
  if (k.rng.chance(0.5)) k.add('cone', 0, y, 0, w * 0.9, 0.9 + k.rng.next(), d * 0.9, glass);
  else {
    k.add('box', 0, y, 0, w * 0.6, 0.18, d * 0.6, STEEL);
    k.add('cyl', 0, y + 0.18, 0, 0.04, 0.9, 0.04, STEEL);
    k.add('ball', 0, y + 1.05, 0, 0.09, 0.09, 0.09, STRIPE_RED);
  }
}

// ------------------------------------------------------------------ industrial

function workshop(k: Builder): void {
  const bw = k.W * 0.82;
  const bd = k.D * 0.7;
  const bh = 0.42;
  const cz = -k.D / 2 + 0.12 + bd / 2;
  k.add('box', 0, 0, cz, bw, bh, bd, k.pick(INDUSTRY));
  // Sawtooth roof: a row of small gables with ridges running front to back.
  const teeth = Math.max(2, Math.round(bw / 0.45));
  const roof = k.pick(INDUSTRY_ROOF);
  for (let t = 0; t < teeth; t++) {
    k.add('gable', -bw / 2 + (bw / teeth) * (t + 0.5), bh, cz, bd, 0.22, bw / teeth, roof, Math.PI / 2);
  }
  k.add('box', -bw * 0.2, 0, cz - bd / 2 - 0.01, bw * 0.3, 0.3, 0.03, STEEL);
  k.add('box', bw * 0.3, 0, -k.D / 2 + 0.3, 0.3, 0.2, 0.22, C('#d9a066'));
}

function factory(k: Builder, big: boolean): void {
  const bw = k.W * 0.7;
  const bd = k.D * 0.62;
  const bh = big ? 0.85 : 0.6;
  const cx = -k.W * 0.12;
  const cz = -k.D * 0.12;
  const wall = k.pick(INDUSTRY);
  k.add('box', cx, 0, cz, bw, bh, bd, wall);
  k.add('gable', cx, bh, cz, bw + 0.05, 0.28, bd + 0.05, k.pick(INDUSTRY_ROOF));
  k.bands(cx, cz, bw, bd, 0.05, big ? 2 : 1, 0.6, C('#c9d9e8'));
  // Striped chimney.
  const chx = k.W / 2 - 0.35;
  const chz = -k.D / 2 + 0.35;
  const segments = big ? 6 : 4;
  for (let s = 0; s < segments; s++) k.add('cyl', chx, s * 0.32, chz, 0.26 - s * 0.012, 0.32, 0.26 - s * 0.012, s % 2 ? WHITE : STRIPE_RED);
  // Tanks or silos.
  const tanks = big ? 3 : 1 + k.rng.int(2);
  for (let t = 0; t < tanks; t++) {
    const tx = k.W / 2 - 0.35 - t * 0.45;
    const tz = k.D / 2 - 0.35;
    const th = big ? 1.1 + k.rng.next() * 0.6 : 0.5;
    k.add('cyl', tx, 0, tz, 0.38, th, 0.38, big ? STEEL : C('#e7e2d6'));
    k.add('ball', tx, th - 0.18, tz, 0.38, 0.36, 0.38, big ? STEEL : C('#e7e2d6'));
  }
}

// ------------------------------------------------------------------ parks and civic

function park(k: Builder): void {
  const area = k.W * k.D;
  if (area >= 9) {
    const pr = Math.min(k.W, k.D) * 0.28;
    k.add('cyl', 0.2, -0.05, 0.15, pr * 2, 0.08, pr * 1.5, POND);
  } else {
    k.add('box', 0, 0, 0, k.W * 0.9, 0.012, 0.16, PATH);
    k.add('box', 0, 0, 0, 0.16, 0.012, k.D * 0.9, PATH);
    if (area >= 4) {
      k.add('cyl', 0, 0, 0, 0.32, 0.08, 0.32, CREAM);
      k.add('cyl', 0, 0.08, 0, 0.08, 0.16, 0.08, POND);
    }
  }
  const trees = Math.round(area * 1.2) + 1;
  for (let t = 0; t < trees; t++) {
    const x = k.rng.range(-k.W / 2 + 0.25, k.W / 2 - 0.25);
    const z = k.rng.range(-k.D / 2 + 0.25, k.D / 2 - 0.25);
    if (Math.abs(x) < 0.15 || Math.abs(z) < 0.15) continue;
    k.tree(x, z, k.rng.range(0.7, 1.1));
  }
  for (let s = 0; s < Math.min(3, area); s++) k.add('box', k.rng.range(-0.4, 0.4) * k.W, 0, -k.D / 2 + 0.2, 0.18, 0.06, 0.06, TRUNK);
}

function civic(k: Builder, kind: CivicKind): void {
  const cz = -k.D / 2 + 0.2 + k.D * 0.3;
  switch (kind) {
    case 'townhall': {
      const bw = k.W * 0.72;
      const bd = k.D * 0.55;
      k.add('box', 0, 0, cz, bw, 0.7, bd, WHITE);
      k.bands(0, cz, bw, bd, 0.08, 2, 0.8, C('#9cc2e6'));
      for (let c = 0; c < 4; c++) k.add('cyl', -bw * 0.36 + c * bw * 0.24, 0, cz - bd / 2 - 0.12, 0.08, 0.62, 0.08, CREAM);
      k.add('gable', 0, 0.62, cz - bd / 2 - 0.12, bw * 0.9, 0.18, 0.24, CREAM);
      k.add('ball', 0, 0.55, cz, 0.6, 0.6, 0.6, C('#8fd3b6'));
      k.add('cyl', 0, 1.1, cz, 0.03, 0.35, 0.03, STEEL);
      k.add('box', 0.1, 1.33, cz, 0.18, 0.1, 0.01, C('#ff6f91'));
      break;
    }
    case 'school': {
      const bw = k.W * 0.8;
      const bd = k.D * 0.5;
      k.add('box', 0, 0, cz, bw, 0.55, bd, C('#f2a07b'));
      k.bands(0, cz, bw, bd, 0.06, 2, 0.6, C('#9cc2e6'));
      k.add('gable', 0, 0.55, cz, bw + 0.06, 0.26, bd + 0.06, C('#7f8fb3'));
      k.add('cyl', bw / 2 - 0.1, 0, cz - bd / 2 - 0.25, 0.03, 0.8, 0.03, STEEL);
      k.add('box', bw / 2 - 0.02, 0.66, cz - bd / 2 - 0.25, 0.16, 0.1, 0.01, C('#4d8af0'));
      k.add('box', 0, 0, k.D / 2 - 0.4, bw * 0.7, 0.01, 0.5, C('#e9c46a'));
      break;
    }
    case 'fire': {
      const bw = k.W * 0.82;
      const bd = k.D * 0.7;
      const z = -k.D / 2 + 0.12 + bd / 2;
      k.add('box', 0, 0, z, bw, 0.55, bd, C('#ef6f6f'));
      for (let d = 0; d < 2; d++) k.add('box', -bw * 0.22 + d * bw * 0.44, 0, z - bd / 2 - 0.01, bw * 0.34, 0.36, 0.03, WHITE);
      k.add('box', bw / 2 - 0.15, 0, z + bd / 2 - 0.15, 0.24, 0.95, 0.24, C('#e05656'));
      k.add('hip', bw / 2 - 0.15, 0.95, z + bd / 2 - 0.15, 0.3, 0.2, 0.3, C('#7f8fb3'));
      break;
    }
    case 'clinic': {
      const bw = k.W * 0.76;
      const bd = k.D * 0.58;
      k.add('box', 0, 0, cz, bw, 0.75, bd, WHITE);
      k.bands(0, cz, bw, bd, 0.06, 2, 0.85, C('#a6e3cf'));
      k.add('box', 0, 0.75, cz, bw + 0.04, 0.05, bd + 0.04, C('#a6e3cf'));
      k.add('box', 0, 0.86, cz - bd / 2 + 0.05, 0.22, 0.07, 0.03, STRIPE_RED);
      k.add('box', 0, 0.79, cz - bd / 2 + 0.05, 0.07, 0.21, 0.03, STRIPE_RED);
      break;
    }
    case 'library': {
      const bw = k.W * 0.7;
      const bd = k.D * 0.55;
      k.add('box', 0, 0, cz, bw, 0.6, bd, C('#efe3d0'));
      for (let c = 0; c < 5; c++) k.add('cyl', -bw * 0.4 + c * bw * 0.2, 0, cz - bd / 2 - 0.1, 0.07, 0.55, 0.07, WHITE);
      k.add('gable', 0, 0.55, cz - 0.05, bw + 0.1, 0.24, bd + 0.2, C('#b49ad8'));
      break;
    }
    case 'landmark': {
      k.add('box', 0, 0, 0, 0.9, 0.2, 0.9, CREAM);
      k.add('box', 0, 0.2, 0, 0.55, 2.6, 0.55, C('#f3d9c6'));
      for (let f = 0; f < 4; f++) k.add('box', 0, 0.5 + f * 0.5, 0, 0.6, 0.06, 0.6, WHITE);
      for (const [dx, dz, sx, sz] of [[0, -0.285, 0.36, 0.02], [0, 0.285, 0.36, 0.02], [-0.285, 0, 0.02, 0.36], [0.285, 0, 0.02, 0.36]] as const) {
        k.add('box', dx, 2.2, dz, sx, 0.36, sz, CLOCK);
        k.add('box', dx * 1.05, 2.3, dz * 1.05, dz ? 0.03 : 0.02, 0.16, dz ? 0.02 : 0.03, DOOR);
      }
      k.add('hip', 0, 2.8, 0, 0.75, 0.75, 0.75, C('#71c3a4'));
      k.add('cone', 0, 3.5, 0, 0.12, 0.55, 0.12, GOLD);
      k.tree(-k.W / 2 + 0.3, k.D / 2 - 0.3, 0.8);
      k.tree(k.W / 2 - 0.3, k.D / 2 - 0.3, 0.8);
      break;
    }
  }
  if (kind !== 'landmark' && k.D > 1.5) k.tree(-k.W / 2 + 0.3, k.D / 2 - 0.3, 0.9);
}

function overgrow(k: Builder): void {
  for (let n = 0; n < 3 + k.rng.int(3); n++) {
    const x = k.rng.range(-k.W / 2 + 0.15, k.W / 2 - 0.15);
    const z = k.rng.range(-k.D / 2 + 0.15, k.D / 2 - 0.15);
    k.parts.push({ kind: 'ball', x, y: -0.03, z, sx: 0.26, sy: 0.22, sz: 0.26, rot: 0, color: WEED });
  }
}
