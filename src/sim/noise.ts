import { Rng } from './rng';

/** Seeded 2D value noise with smooth interpolation, plus fractal layering. */
export class ValueNoise {
  private readonly perm: Uint16Array;
  private readonly values: Float32Array;

  constructor(rng: Rng) {
    this.perm = new Uint16Array(512);
    this.values = new Float32Array(256);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = rng.int(i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) this.values[i] = rng.next() * 2 - 1;
  }

  private lattice(x: number, y: number): number {
    return this.values[this.perm[(this.perm[x & 255] + y) & 511]];
  }

  /** Noise in roughly [-1, 1]. */
  sample(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = this.lattice(x0, y0);
    const b = this.lattice(x0 + 1, y0);
    const c = this.lattice(x0, y0 + 1);
    const d = this.lattice(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  fbm(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.sample(x * freq + o * 17.3, y * freq - o * 9.1);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}
