import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHARTER, type Charter } from '../src/sim/charter';
import { Simulation, type TickResult } from '../src/sim/sim';
import {
  applyChanges,
  CityState,
  N_TILES,
  roadConn,
  roadTier,
  RUN_TICKS,
  stateDigest,
  Tier,
} from '../src/sim/state';

function runAll(charter: Charter): { sim: Simulation; results: TickResult[] } {
  const sim = new Simulation(charter);
  const results: TickResult[] = [];
  for (let r = sim.step(); r; r = sim.step()) results.push(r);
  return { sim, results };
}

const charter: Charter = { seed: 4821, ...DEFAULT_CHARTER };
let run: ReturnType<typeof runAll>;
beforeAll(() => {
  run = runAll(charter);
});

describe('a Run', () => {
  it('lasts 100 years of monthly ticks, then stops', () => {
    expect(run.results.length).toBe(RUN_TICKS);
    expect(run.sim.step()).toBeNull();
  });

  it('is reproducible: the same Charter grows the same City', () => {
    const again = runAll(charter);
    expect(stateDigest(again.sim.state)).toBe(stateDigest(run.sim.state));
  });

  it('differs for a different Seed', () => {
    const other = runAll({ ...charter, seed: 4822 });
    expect(stateDigest(other.sim.state)).not.toBe(stateDigest(run.sim.state));
  });

  it('grows roughly to its Ambition', () => {
    const final = run.results[run.results.length - 1].stats.population;
    expect(final).toBeGreaterThan(20_000 * 0.6);
    expect(final).toBeLessThan(20_000 * 1.5);
  });
});

describe('the Time lapse', () => {
  it('rewinds to an empty City and replays to the same Present', () => {
    const s = new CityState();
    for (const r of run.results) applyChanges(s, r.changes, true);
    const present = stateDigest(s);
    expect(present).toBe(stateDigest(run.sim.state));
    for (let k = run.results.length - 1; k >= 0; k--) applyChanges(s, run.results[k].changes, false);
    expect(stateDigest(s)).toBe(stateDigest(new CityState()));
    for (const r of run.results) applyChanges(s, r.changes, true);
    expect(stateDigest(s)).toBe(present);
  });

  it('can rewind any span and land where it started', () => {
    const s = new CityState();
    for (const r of run.results.slice(0, 700)) applyChanges(s, r.changes, true);
    const at700 = stateDigest(s);
    for (let k = 699; k >= 300; k--) applyChanges(s, run.results[k].changes, false);
    for (let k = 300; k < 700; k++) applyChanges(s, run.results[k].changes, true);
    expect(stateDigest(s)).toBe(at700);
  });
});

describe('invariants', () => {
  it('Lots never overlap Roads, Pocket parks or each other, and are at most 4×4', () => {
    const s = new CityState();
    for (const r of run.results) {
      applyChanges(s, r.changes, true);
      if (r.tick % 60 !== 0 && r.tick !== RUN_TICKS - 1) continue;
      let area = 0;
      for (const lot of s.lots.values()) {
        expect(lot.w).toBeLessThanOrEqual(4);
        expect(lot.h).toBeLessThanOrEqual(4);
        area += lot.w * lot.h;
        for (let y = lot.y; y < lot.y + lot.h; y++) {
          for (let x = lot.x; x < lot.x + lot.w; x++) {
            const i = y * 128 + x;
            expect(s.lotAt[i]).toBe(lot.id);
            expect(s.road[i]).toBe(0);
            expect(s.pocket[i]).toBe(0);
          }
        }
      }
      let occupied = 0;
      for (let i = 0; i < N_TILES; i++) if (s.lotAt[i]) occupied++;
      expect(occupied).toBe(area);
    }
  });

  it('Park and Civic Lots never change once laid out', () => {
    for (const r of run.results) {
      for (const c of r.changes) {
        if (c.k === 'lot' && c.from && (c.from.use === 'park' || c.from.use === 'civic')) {
          throw new Error(`tick ${r.tick}: ${c.from.use} Lot ${c.id} changed`);
        }
      }
    }
  });

  it('zoned Lots never split: they only grow, change Building, or are demolished', () => {
    for (const r of run.results) {
      for (const c of r.changes) {
        if (c.k !== 'lot' || !c.from || !c.to) continue;
        expect(c.to.x).toBeLessThanOrEqual(c.from.x);
        expect(c.to.y).toBeLessThanOrEqual(c.from.y);
        expect(c.to.x + c.to.w).toBeGreaterThanOrEqual(c.from.x + c.from.w);
        expect(c.to.y + c.to.h).toBeGreaterThanOrEqual(c.from.y + c.from.h);
        expect(c.to.use).toBe(c.from.use);
      }
    }
  });

  it('Promotion climbs one step at a time and never produces a highway', () => {
    for (const r of run.results) {
      for (const c of r.changes) {
        if (c.k !== 'road' || !c.promotion) continue;
        const from = roadTier(c.from);
        const to = roadTier(c.to);
        expect(to).toBe(from + 1);
        expect(to).toBeLessThanOrEqual(Tier.Avenue);
      }
    }
  });

  it('Promotions do happen', () => {
    expect(run.results.some((r) => r.changes.some((c) => c.k === 'road' && c.promotion))).toBe(true);
  });

  it('road connections are always mutual', () => {
    const s = run.sim.state;
    const dirs = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    for (let i = 0; i < N_TILES; i++) {
      const conn = roadConn(s.road[i]);
      for (let d = 0; d < 8; d++) {
        if (!(conn & (1 << d))) continue;
        const n = i + dirs[d][1] * 128 + dirs[d][0];
        expect(roadConn(s.road[n]) & (1 << ((d + 4) & 7))).not.toBe(0);
      }
    }
  });
});
