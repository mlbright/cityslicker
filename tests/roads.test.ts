import { beforeAll, describe, expect, it } from 'vitest';
import { parseCharter } from '../src/sim/charter';
import { Simulation } from '../src/sim/sim';
import { DIRS, isDiagonal, N_TILES, roadConn, roadTier, Tier } from '../src/sim/state';
import { GENTLE_SLOPE, SIZE } from '../src/sim/terrain';

const sims: Simulation[] = [];
beforeAll(() => {
  for (const q of ['?seed=4821', '?seed=77&water=islands&hills=mountainous', '?seed=11&ambition=metro&water=coastal']) {
    const sim = new Simulation(parseCharter(q)!);
    while (sim.step());
    sims.push(sim);
  }
});

const xy = (i: number) => [i % SIZE, Math.floor(i / SIZE)] as const;

describe('the road network', () => {
  it('has diagonal Roads, and every diagonal step leaves its two corners free of Lots', () => {
    for (const sim of sims) {
      let diagonals = 0;
      for (let i = 0; i < N_TILES; i++) {
        const conn = roadConn(sim.state.road[i]);
        const [x, y] = xy(i);
        for (let d = 1; d < 8; d += 2) {
          if (!(conn & (1 << d))) continue;
          diagonals++;
          const [dx, dy] = DIRS[d];
          expect(sim.state.lotAt[y * SIZE + x + dx]).toBe(0);
          expect(sim.state.lotAt[(y + dy) * SIZE + x]).toBe(0);
        }
      }
      expect(diagonals).toBeGreaterThan(0);
    }
  });

  it('only has Pocket parks in the corners cut by diagonal Roads', () => {
    for (const sim of sims) {
      let pockets = 0;
      for (let i = 0; i < N_TILES; i++) {
        if (!sim.state.pocket[i]) continue;
        pockets++;
        const [x, y] = xy(i);
        let beside = false;
        // A pocket at (x, y) is cut by a diagonal between two of its orthogonal neighbours.
        for (const [ax, ay, bx, by] of [[x - 1, y, x, y + 1], [x - 1, y, x, y - 1], [x + 1, y, x, y + 1], [x + 1, y, x, y - 1]]) {
          const a = ay * SIZE + ax;
          const d = DIRS.findIndex(([dx, dy]) => dx === bx - ax && dy === by - ay);
          if (d >= 0 && isDiagonal(d) && roadConn(sim.state.road[a]) & (1 << d)) beside = true;
        }
        expect(beside).toBe(true);
      }
      expect(pockets).toBeGreaterThan(0);
    }
  });

  it('keeps local Bridges short', () => {
    for (const sim of sims) {
      for (let i = 0; i < N_TILES; i++) {
        const tier = roadTier(sim.state.road[i]);
        if (!tier || tier === Tier.Highway || !sim.terrain.water[i]) continue;
        // Walk along each connection while still on water.
        for (let d = 0; d < 8; d++) {
          let run = 1;
          let cur = i;
          while (roadConn(sim.state.road[cur]) & (1 << d)) {
            const [x, y] = xy(cur);
            cur = (y + DIRS[d][1]) * SIZE + x + DIRS[d][0];
            if (!sim.terrain.water[cur]) break;
            run++;
          }
          expect(run).toBeLessThanOrEqual(7);
        }
      }
    }
  });

  it('never builds Lots on steep ground', () => {
    for (const sim of sims) {
      for (const lot of sim.state.lots.values()) {
        for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) {
          expect(sim.terrain.slope[y * SIZE + x]).toBeLessThanOrEqual(GENTLE_SLOPE);
          expect(sim.terrain.water[y * SIZE + x]).toBe(0);
        }
      }
    }
  });

  it('gives almost every Lot frontage on a local Road or Pocket park', () => {
    for (const sim of sims) {
      let without = 0;
      for (const lot of sim.state.lots.values()) {
        let fronts = false;
        for (let y = lot.y - 1; y <= lot.y + lot.h && !fronts; y++) {
          for (let x = lot.x - 1; x <= lot.x + lot.w; x++) {
            const inside = x >= lot.x && x < lot.x + lot.w && y >= lot.y && y < lot.y + lot.h;
            const corner = (x === lot.x - 1 || x === lot.x + lot.w) && (y === lot.y - 1 || y === lot.y + lot.h);
            if (inside || corner) continue;
            const t = roadTier(sim.state.road[y * SIZE + x]);
            if ((t >= Tier.Dirt && t <= Tier.Avenue) || sim.state.pocket[y * SIZE + x]) fronts = true;
          }
        }
        if (!fronts) without++;
      }
      expect(without / sim.state.lots.size).toBeLessThan(0.02);
    }
  });

  it('keeps one Regional highway from edge to edge', () => {
    for (const sim of sims) {
      const edgeHighways = [0, SIZE - 1].flatMap((k) => [
        ...Array.from({ length: SIZE }, (_, j) => k * SIZE + j),
        ...Array.from({ length: SIZE }, (_, j) => j * SIZE + k),
      ]).filter((i) => roadTier(sim.state.road[i]) === Tier.Highway);
      expect(edgeHighways.length).toBeGreaterThanOrEqual(2);
    }
  });
});
