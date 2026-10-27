import * as THREE from 'three';
import { CityState, DIRS, N_TILES, roadConn, roadTier, Tier } from '../sim/state';
import { heightAt, SIZE, type Terrain } from '../sim/terrain';
import { PALETTE } from './palette';

const WIDTH = [0, 0.4, 0.5, 0.74, 0.86];
const DECK = 0.55;
const LIFT = 0.05;

/** All Roads as one merged mesh, rebuilt whenever the network changes. */
export class RoadsMesh {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private readonly material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });
  private readonly terrain: Terrain;
  private readonly last = new Uint16Array(N_TILES);
  /** Increments whenever the network is rebuilt. */
  version = 0;

  constructor(terrain: Terrain) {
    this.terrain = terrain;
  }

  /** Rebuilds if any road tile changed since the last call. */
  sync(state: CityState): boolean {
    let changed = false;
    for (let i = 0; i < N_TILES; i++) {
      if (state.road[i] !== this.last[i]) {
        changed = true;
        break;
      }
    }
    if (!changed) return false;
    this.last.set(state.road);
    this.rebuild(state);
    return true;
  }

  /** Packed road value at a tile, as last drawn. */
  tierAt(i: number): number {
    return this.last[i];
  }

  /** Height of the road surface at a tile's centre. */
  deckAt(i: number): number {
    return this.deck(i);
  }

  private deck(i: number): number {
    const x = i % SIZE;
    const y = (i - x) / SIZE;
    if (this.terrain.water[i]) return DECK;
    return heightAt(this.terrain, x + 0.5, y + 0.5) + LIFT;
  }

  private rebuild(state: CityState): void {
    this.version++;
    const pos: number[] = [];
    const col: number[] = [];
    const t = this.terrain;
    const quad = (p: number[][], c: THREE.Color) => {
      for (const k of [0, 2, 1, 0, 3, 2]) {
        pos.push(p[k][0], p[k][1], p[k][2]);
        col.push(c.r, c.g, c.b);
      }
    };
    const box = (cx: number, cz: number, y0: number, y1: number, half: number, c: THREE.Color) => {
      const a = [cx - half, cz - half];
      const b = [cx + half, cz + half];
      quad([[a[0], y1, a[1]], [b[0], y1, a[1]], [b[0], y1, b[1]], [a[0], y1, b[1]]], c);
      quad([[a[0], y0, b[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, b[1]]], c);
      quad([[b[0], y0, a[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, a[1]]], c);
      quad([[b[0], y0, b[1]], [b[0], y0, a[1]], [b[0], y1, a[1]], [b[0], y1, b[1]]], c);
      quad([[a[0], y0, a[1]], [a[0], y0, b[1]], [a[0], y1, b[1]], [a[0], y1, a[1]]], c);
    };
    const colourOf = (tier: number) =>
      tier === Tier.Dirt ? PALETTE.dirt : tier === Tier.Street ? PALETTE.road : tier === Tier.Avenue ? PALETTE.avenue : PALETTE.highway;

    for (let i = 0; i < N_TILES; i++) {
      const packed = state.road[i];
      if (!packed) continue;
      const tier = roadTier(packed);
      const conn = roadConn(packed);
      const x = i % SIZE;
      const y = (i - x) / SIZE;
      const cx = x + 0.5;
      const cz = y + 0.5;
      const h = this.deck(i);
      const w = WIDTH[tier] / 2;
      const colour = colourOf(tier);
      // Centre pad.
      quad([[cx - w, h, cz - w], [cx + w, h, cz - w], [cx + w, h, cz + w], [cx - w, h, cz + w]], colour);
      for (let d = 0; d < 8; d++) {
        if (!(conn & (1 << d))) continue;
        const nx = x + DIRS[d][0];
        const ny = y + DIRS[d][1];
        const n = ny * SIZE + nx;
        const nTier = Math.min(tier, roadTier(state.road[n]) || tier);
        const armW = WIDTH[nTier] / 2;
        const mx = cx + DIRS[d][0] * 0.5;
        const mz = cz + DIRS[d][1] * 0.5;
        const mh = this.terrain.water[i] || this.terrain.water[n]
          ? (h + this.deck(n)) / 2
          : Math.max((h + this.deck(n)) / 2, heightAt(t, mx, mz) + LIFT);
        const len = Math.hypot(DIRS[d][0], DIRS[d][1]);
        const px = (-DIRS[d][1] / len) * armW;
        const pz = (DIRS[d][0] / len) * armW;
        quad(
          [
            [cx - px, h, cz - pz],
            [mx - px, mh, mz - pz],
            [mx + px, mh, mz + pz],
            [cx + px, h, cz + pz],
          ],
          colourOf(nTier),
        );
        if (nTier >= Tier.Avenue) {
          const lw = 0.035;
          const lx = (-DIRS[d][1] / len) * lw;
          const lz = (DIRS[d][0] / len) * lw;
          quad(
            [
              [cx - lx, h + 0.012, cz - lz],
              [mx - lx, mh + 0.012, mz - lz],
              [mx + lx, mh + 0.012, mz + lz],
              [cx + lx, h + 0.012, cz + lz],
            ],
            PALETTE.roadLine,
          );
        }
      }
      if (t.water[i]) {
        // Bridge pillar and a little deck slab.
        box(cx, cz, -1.5, h - 0.02, 0.09, PALETTE.bridge);
        const e = WIDTH[tier] / 2 + 0.05;
        box(cx, cz, h - 0.12, h - 0.005, e, PALETTE.bridge);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geom.computeVertexNormals();
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geom;
    } else {
      this.mesh = new THREE.Mesh(geom, this.material);
      this.mesh.receiveShadow = true;
      this.group.add(this.mesh);
    }
  }
}
