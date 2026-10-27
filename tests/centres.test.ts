import { beforeAll, describe, expect, it } from 'vitest';
import { parseCharter, type Charter } from '../src/sim/charter';
import { cityName } from '../src/sim/names';
import { Simulation, type TickResult } from '../src/sim/sim';

interface Run {
  charter: Charter;
  sim: Simulation;
  results: TickResult[];
}
const runs: Run[] = [];
beforeAll(() => {
  for (const q of ['?seed=11&ambition=metro&water=coastal', '?seed=5&ambition=town&water=lakes&hills=flat', '?seed=4821']) {
    const charter = parseCharter(q)!;
    const sim = new Simulation(charter);
    const results: TickResult[] = [];
    for (let r = sim.step(); r; r = sim.step()) results.push(r);
    runs.push({ charter, sim, results });
  }
});

describe('Centres', () => {
  it('start with one named after the City at year 0', () => {
    for (const { sim, results } of runs) {
      const first = results[0].milestones[0];
      expect(first.kind).toBe('centre');
      expect(first.label).toBe(`${sim.name} founded`);
      expect([...sim.state.centres.values()][0].name).toBe(sim.name);
    }
  });

  it('have unique names', () => {
    for (const { sim } of runs) {
      const names = [...sim.state.centres.values()].map((c) => c.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('are founded far from every existing Centre', () => {
    for (const { sim } of runs) {
      const centres = [...sim.state.centres.values()].sort((a, b) => a.foundedTick - b.foundedTick);
      for (let k = 1; k < centres.length; k++) {
        for (let j = 0; j < k; j++) {
          expect(Math.hypot(centres[k].x - centres[j].x, centres[k].y - centres[j].y)).toBeGreaterThanOrEqual(28);
        }
      }
    }
  });

  it('are limited by Ambition', () => {
    const max = { town: 2, city: 4, metro: 6 };
    for (const { charter, sim } of runs) expect(sim.state.centres.size).toBeLessThanOrEqual(max[charter.ambition]);
    expect(runs[0].sim.state.centres.size).toBeGreaterThanOrEqual(3);
  });
});

describe('Parks and Civic buildings', () => {
  it('appear in every City', () => {
    for (const { sim } of runs) {
      const uses = [...sim.state.lots.values()].map((l) => l.use);
      expect(uses).toContain('park');
      expect(uses).toContain('civic');
    }
  });

  it('give each grown Centre a town hall, and Landmarks only to large ones', () => {
    for (const { results } of runs) {
      for (const r of results) {
        for (const c of r.changes) {
          if (c.k !== 'lot' || c.from || !c.to?.building?.civic) continue;
          const pop = r.stats.centres.find((x) => x.id === c.to!.centre)?.population ?? 0;
          if (c.to.building.civic === 'landmark') expect(pop).toBeGreaterThan(2500);
        }
      }
    }
    const metro = runs[0].sim;
    const halls = [...metro.state.lots.values()].filter((l) => l.building?.civic === 'townhall');
    expect(halls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Milestones', () => {
  it('are in time order and never repeat', () => {
    for (const { results } of runs) {
      const ms = results.flatMap((r) => r.milestones);
      const labels = ms.map((m) => m.label);
      expect(new Set(labels).size).toBe(labels.length);
      for (let k = 1; k < ms.length; k++) expect(ms[k].tick).toBeGreaterThanOrEqual(ms[k - 1].tick);
    }
  });

  it('mark population thresholds as they are crossed', () => {
    const metro = runs[0];
    const pops = metro.results.flatMap((r) => r.milestones.filter((m) => m.kind === 'population').map((m) => ({ m, pop: r.stats.population })));
    expect(pops.map((p) => p.m.label)).toEqual(['Population 1,000', 'Population 5,000', 'Population 10,000', 'Population 25,000', 'Population 50,000']);
    for (const { m, pop } of pops) expect(pop).toBeGreaterThanOrEqual(Number(m.label.replace(/\D/g, '')));
  });
});

describe('names', () => {
  it('come from the Seed', () => {
    expect(cityName(42, false)).toBe(cityName(42, false));
    const names = new Set(Array.from({ length: 50 }, (_, k) => cityName(k + 1, false)));
    expect(names.size).toBeGreaterThan(30);
  });
});
