import { describe, expect, it } from 'vitest';
import { AMBITION_POPULATION, parseCharter } from '../src/sim/charter';
import { Simulation } from '../src/sim/sim';

describe('Ambition', () => {
  it.each([
    '?seed=5&ambition=town&water=lakes&hills=flat',
    '?seed=77&water=islands&hills=mountainous&ambition=city',
    '?seed=902&ambition=city&lean=-0.8',
    '?seed=12&water=islands&ambition=metro',
    '?seed=300&ambition=metro&lean=0.8&hills=mountainous',
  ])('is roughly reached by the end of the Run: %s', (q) => {
    const charter = parseCharter(q)!;
    const sim = new Simulation(charter);
    let pop = 0;
    for (let r = sim.step(); r; r = sim.step()) pop = r.stats.population;
    const target = AMBITION_POPULATION[charter.ambition];
    expect(pop).toBeGreaterThan(target * 0.75);
    expect(pop).toBeLessThan(target * 1.3);
  });
});
