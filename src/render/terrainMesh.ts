import * as THREE from 'three';
import { ValueNoise } from '../sim/noise';
import { hashInts, Rng } from '../sim/rng';
import { CORNERS, SIZE, type Terrain } from '../sim/terrain';
import { PALETTE } from './palette';

const BASE_DEPTH = -4;

/**
 * Low-poly terrain: two flat-shaded triangles per tile, with per-tile colours that can be tinted
 * (zoned Lots, Pocket parks) without rebuilding the geometry.
 */
export class TerrainMesh {
  readonly group = new THREE.Group();
  private readonly colors: Float32Array;
  private readonly baseColors: Float32Array;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly terrain: Terrain;
  /** The ground surface, for picking. */
  readonly surface: THREE.Mesh;

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    const positions = new Float32Array(SIZE * SIZE * 6 * 3);
    this.colors = new Float32Array(SIZE * SIZE * 6 * 3);
    const c = terrain.corners;
    let p = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const a = [x, c[y * CORNERS + x], y];
        const b = [x + 1, c[y * CORNERS + x + 1], y];
        const cc = [x, c[(y + 1) * CORNERS + x], y + 1];
        const d = [x + 1, c[(y + 1) * CORNERS + x + 1], y + 1];
        // Split along a–d, matching heightAt(). Counter-clockwise seen from above.
        for (const v of [a, d, b, a, cc, d]) {
          positions[p++] = v[0];
          positions[p++] = v[1];
          positions[p++] = v[2];
        }
      }
    }
    for (let i = 0; i < SIZE * SIZE; i++) this.writeTileColor(i, baseTileColor(terrain, i), this.colors);
    this.baseColors = this.colors.slice();

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.colorAttr = new THREE.BufferAttribute(this.colors, 3);
    geom.setAttribute('color', this.colorAttr);
    geom.computeVertexNormals();
    const surface = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
    );
    surface.receiveShadow = true;
    surface.castShadow = true;
    this.surface = surface;
    this.group.add(surface);
    this.group.add(buildSkirt(terrain));
    this.group.add(buildWater(terrain));
  }

  private writeTileColor(i: number, color: THREE.Color, target: Float32Array): void {
    const x = i % SIZE;
    const y = (i - x) / SIZE;
    // Slight per-triangle variation keeps the ground from looking flat.
    for (let tri = 0; tri < 2; tri++) {
      const jitter = ((hashInts(x, y, tri) % 1000) / 1000 - 0.5) * 0.035;
      for (let v = 0; v < 3; v++) {
        const o = (i * 6 + tri * 3 + v) * 3;
        target[o] = clamp01(color.r + jitter);
        target[o + 1] = clamp01(color.g + jitter);
        target[o + 2] = clamp01(color.b + jitter);
      }
    }
  }

  /** Tints a tile (null restores the natural ground colour). Call commit() afterwards. */
  tint(i: number, color: THREE.Color | null, strength = 1): void {
    if (this.terrain.water[i]) return;
    if (color === null) {
      this.colors.set(this.baseColors.subarray(i * 18, i * 18 + 18), i * 18);
      return;
    }
    const base = new THREE.Color(this.baseColors[i * 18], this.baseColors[i * 18 + 1], this.baseColors[i * 18 + 2]);
    this.writeTileColor(i, base.lerp(color, strength), this.colors);
  }

  commit(): void {
    this.colorAttr.needsUpdate = true;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

const GRASS_NOISE = new ValueNoise(new Rng(1, 'grass'));

export function baseTileColor(t: Terrain, i: number): THREE.Color {
  const h = t.height[i];
  const s = t.slope[i];
  if (t.water[i]) return PALETTE.sand.clone().lerp(PALETTE.waterDeep, Math.min(1, -h));
  const color = PALETTE.grass.clone();
  const x = i % SIZE;
  const y = (i - x) / SIZE;
  const patch = GRASS_NOISE.fbm(x / 9, y / 9, 3);
  if (patch > 0.15) color.lerp(PALETTE.meadow, Math.min(0.55, (patch - 0.15) * 2.5));
  else if (patch < -0.2) color.lerp(PALETTE.grassDark, Math.min(0.6, (-0.2 - patch) * 2.5));
  if (t.waterDist[i] <= 1 && h < 0.7) color.lerp(PALETTE.sand, 0.85);
  if (s > 0.9) color.lerp(PALETTE.rock, Math.min(1, (s - 0.9) * 1.5));
  if (t.maxHeight > 9 && h > t.maxHeight * 0.78) color.lerp(PALETTE.snow, Math.min(1, (h - t.maxHeight * 0.78) / (t.maxHeight * 0.1)));
  return color;
}

/** The soil sides of the diorama block. */
function buildSkirt(t: Terrain): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const edge = (x0: number, z0: number, x1: number, z1: number, h0: number, h1: number) => {
    const top0 = Math.max(h0, BASE_DEPTH + 0.5);
    const top1 = Math.max(h1, BASE_DEPTH + 0.5);
    const quad = [
      [x0, BASE_DEPTH, z0], [x1, BASE_DEPTH, z1], [x1, top1, z1],
      [x0, BASE_DEPTH, z0], [x1, top1, z1], [x0, top0, z0],
    ];
    for (const v of quad) {
      positions.push(v[0], v[1], v[2]);
      const c = v[1] > -0.6 ? PALETTE.soil : PALETTE.soilDark;
      colors.push(c.r, c.g, c.b);
    }
  };
  const c = t.corners;
  for (let i = 0; i < SIZE; i++) {
    // North (z=0), south (z=SIZE), west (x=0), east (x=SIZE). Winding so faces point outward.
    edge(i + 1, 0, i, 0, c[i + 1], c[i]);
    edge(i, SIZE, i + 1, SIZE, c[SIZE * CORNERS + i], c[SIZE * CORNERS + i + 1]);
    edge(0, i, 0, i + 1, c[i * CORNERS], c[(i + 1) * CORNERS]);
    edge(SIZE, i + 1, SIZE, i, c[(i + 1) * CORNERS + SIZE], c[i * CORNERS + SIZE]);
  }
  // Bottom slab.
  for (const v of [[0, BASE_DEPTH, 0], [SIZE, BASE_DEPTH, SIZE], [0, BASE_DEPTH, SIZE], [0, BASE_DEPTH, 0], [SIZE, BASE_DEPTH, 0], [SIZE, BASE_DEPTH, SIZE]]) {
    positions.push(v[0], v[1], v[2]);
    colors.push(PALETTE.soilDark.r, PALETTE.soilDark.g, PALETTE.soilDark.b);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  mesh.receiveShadow = true;
  return mesh;
}

/** A water surface at level 0 plus glassy water walls where water meets the diorama edge. */
function buildWater(t: Terrain): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: PALETTE.water,
    transparent: true,
    opacity: 0.82,
    roughness: 0.55,
    metalness: 0,
  });
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), material);
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(SIZE / 2, -0.02, SIZE / 2);
  surface.receiveShadow = true;
  surface.name = 'water-surface';
  group.add(surface);

  const positions: number[] = [];
  const c = t.corners;
  const wall = (x0: number, z0: number, x1: number, z1: number, h0: number, h1: number) => {
    if (h0 >= 0 && h1 >= 0) return;
    const b0 = Math.min(h0, 0);
    const b1 = Math.min(h1, 0);
    for (const v of [[x0, b0, z0], [x1, b1, z1], [x1, -0.02, z1], [x0, b0, z0], [x1, -0.02, z1], [x0, -0.02, z0]]) {
      positions.push(v[0], v[1], v[2]);
    }
  };
  for (let i = 0; i < SIZE; i++) {
    wall(i + 1, 0, i, 0, c[i + 1], c[i]);
    wall(i, SIZE, i + 1, SIZE, c[SIZE * CORNERS + i], c[SIZE * CORNERS + i + 1]);
    wall(0, i, 0, i + 1, c[i * CORNERS], c[(i + 1) * CORNERS]);
    wall(SIZE, i + 1, SIZE, i, c[(i + 1) * CORNERS + SIZE], c[i * CORNERS + SIZE]);
  }
  if (positions.length) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();
    group.add(new THREE.Mesh(geom, material));
  }
  return group;
}
