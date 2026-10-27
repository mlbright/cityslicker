import * as THREE from 'three';
import { ValueNoise } from '../sim/noise';
import { hashInts, Rng } from '../sim/rng';
import { GENTLE_SLOPE, heightAt, SIZE, type Terrain } from '../sim/terrain';
import { partGeometries } from './geometries';
import { PartPool } from './partPool';

const CROWNS = ['#7cc67a', '#69b96e', '#8fd082', '#5fae6a', '#a3d977', '#5aa36a'].map((c) => new THREE.Color(c));
const PINES = ['#4f9e72', '#5cae7d', '#468f69'].map((c) => new THREE.Color(c));
const TRUNK = new THREE.Color('#a07454');
const BUSH = new THREE.Color('#6cc46a');
const FLOWERS = ['#ff9fb2', '#ffd36e', '#ffffff', '#c9a7ff'].map((c) => new THREE.Color(c));

interface TileTrees {
  /** Pool slots of the forest trees on this tile. */
  forest: { pool: PartPool; slot: number; m: THREE.Matrix4; color: THREE.Color }[];
  /** Pool slots used by Pocket park greenery, when shown. */
  pocket: { pool: PartPool; slot: number }[];
}

/**
 * Decorative woodland on bare land, cleared wherever Roads or Lots arrive, plus little bushes and
 * flowers in Pocket parks. Trees come from the Terrain, so they are the same every time.
 */
export class Trees {
  readonly group = new THREE.Group();
  private readonly trunks: PartPool;
  private readonly crowns: PartPool;
  private readonly pines: PartPool;
  private readonly tiles = new Map<number, TileTrees>();
  private readonly visible = new Uint8Array(SIZE * SIZE);

  constructor(private readonly terrain: Terrain, seed: number) {
    const g = partGeometries();
    const material = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
    this.trunks = new PartPool(this.group, g.cyl, material, 2048);
    this.crowns = new PartPool(this.group, g.ball, material, 2048);
    this.pines = new PartPool(this.group, g.cone, material, 1024);
    const noise = new ValueNoise(new Rng(seed, 'forest'));
    for (let y = 1; y < SIZE - 1; y++) {
      for (let x = 1; x < SIZE - 1; x++) {
        const i = y * SIZE + x;
        if (terrain.water[i] || terrain.slope[i] > GENTLE_SLOPE * 2.2) continue;
        const f = noise.fbm(x / 14, y / 14, 3);
        const r = (hashInts(x, y, 11) % 1000) / 1000;
        const count = f > 0.28 ? (r < 0.7 ? 2 : 1) : f > 0.12 ? (r < 0.35 ? 1 : 0) : r < 0.025 ? 1 : 0;
        if (count === 0) continue;
        const forest: TileTrees['forest'] = [];
        const high = terrain.height[i] > terrain.maxHeight * 0.55 && terrain.maxHeight > 4;
        for (let t = 0; t < count; t++) {
          const h = hashInts(x, y, t, 5);
          const px = x + 0.25 + ((h % 100) / 100) * 0.5;
          const pz = y + 0.25 + (((h >>> 8) % 100) / 100) * 0.5;
          const s = 0.75 + ((h >>> 16) % 100) / 200;
          const base = heightAt(terrain, px, pz) - 0.02;
          const pine = high || (h >>> 24) % 5 === 0;
          const trunkM = new THREE.Matrix4().compose(new THREE.Vector3(px, base, pz), new THREE.Quaternion(), new THREE.Vector3(0.07 * s, 0.22 * s, 0.07 * s));
          forest.push({ pool: this.trunks, slot: -1, m: trunkM, color: TRUNK });
          const crownM = pine
            ? new THREE.Matrix4().compose(new THREE.Vector3(px, base + 0.12 * s, pz), new THREE.Quaternion(), new THREE.Vector3(0.38 * s, 0.7 * s, 0.38 * s))
            : new THREE.Matrix4().compose(new THREE.Vector3(px, base + 0.14 * s, pz), new THREE.Quaternion(), new THREE.Vector3(0.44 * s, 0.42 * s, 0.44 * s));
          forest.push({ pool: pine ? this.pines : this.crowns, slot: -1, m: crownM, color: (pine ? PINES : CROWNS)[(h >>> 4) % (pine ? PINES.length : CROWNS.length)] });
        }
        this.tiles.set(i, { forest, pocket: [] });
        this.setForest(i, true);
      }
    }
  }

  private setForest(i: number, show: boolean): void {
    const t = this.tiles.get(i);
    if (!t || (this.visible[i] === 1) === show) return;
    this.visible[i] = show ? 1 : 0;
    for (const part of t.forest) {
      if (show) {
        part.slot = part.pool.alloc();
        part.pool.set(part.slot, part.m, part.color);
      } else if (part.slot >= 0) {
        part.pool.release(part.slot);
        part.slot = -1;
      }
    }
  }

  /** Tile occupancy changed: 0 bare, 1 Pocket park, anything else built over. */
  setTile(i: number, key: number): void {
    this.setForest(i, key === 0);
    let t = this.tiles.get(i);
    if (key === 1) {
      if (!t) {
        t = { forest: [], pocket: [] };
        this.tiles.set(i, t);
      }
      if (t.pocket.length) return;
      const x = i % SIZE;
      const y = (i - x) / SIZE;
      const h = hashInts(x, y, 23);
      const spots = [[0.3, 0.3], [0.7, 0.65], [0.35, 0.72]];
      for (let k = 0; k < 2 + (h % 2); k++) {
        const [ox, oz] = spots[k];
        const px = x + ox;
        const pz = y + oz;
        const base = Math.max(0, heightAt(this.terrain, px, pz)) - 0.02;
        const flower = k === 2;
        const s = flower ? 0.12 : 0.22 + ((h >>> (k * 3)) % 4) * 0.03;
        const slot = this.crowns.alloc();
        this.crowns.set(slot, new THREE.Matrix4().compose(new THREE.Vector3(px, base, pz), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.8, s)), flower ? FLOWERS[h % FLOWERS.length] : BUSH);
        t.pocket.push({ pool: this.crowns, slot });
      }
    } else if (t && t.pocket.length) {
      for (const p of t.pocket) p.pool.release(p.slot);
      t.pocket = [];
    }
  }
}
