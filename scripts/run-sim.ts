/** Runs a whole Run headlessly and prints yearly stats. Usage: npx tsx scripts/run-sim.ts [query] */
import { parseCharter, DEFAULT_CHARTER } from '../src/sim/charter';
import { Simulation } from '../src/sim/sim';
import { roadTier, TICKS_PER_YEAR } from '../src/sim/state';

const charter = parseCharter(process.argv[2] ?? '?seed=4821') ?? { seed: 4821, ...DEFAULT_CHARTER };
const sim = new Simulation(charter);
console.log(`${sim.name} — ${JSON.stringify(charter)}`);
const t0 = performance.now();
let slowest = 0;
let changes = 0;
for (;;) {
  const s = performance.now();
  const r = sim.step();
  if (!r) break;
  slowest = Math.max(slowest, performance.now() - s);
  changes += r.changes.length;
  for (const m of r.milestones) console.log(`  year ${(r.tick / 12).toFixed(1)}: ${m.label}`);
  if (r.tick % (TICKS_PER_YEAR * 10) === TICKS_PER_YEAR * 10 - 1) {
    const lots = [...sim.state.lots.values()];
    const count = (u: string, d?: number) => lots.filter((l) => l.use === u && (d === undefined || l.building?.density === d)).length;
    const tiers = [0, 0, 0, 0, 0];
    for (const v of sim.state.road) if (v) tiers[roadTier(v)]++;
    const abandoned = lots.filter((l) => l.building && l.building.abandonedTick >= 0).length;
    const d = r.stats.demand;
    console.log(
      `year ${Math.round((r.tick + 1) / 12)}: pop ${r.stats.population} jobs C${r.stats.jobsC}/I${r.stats.jobsI} ` +
        `demand R${d.R.toFixed(2)} C${d.C.toFixed(2)} I${d.I.toFixed(2)} | lots R${count('R')} (${count('R', 2)}/${count('R', 3)}) ` +
        `C${count('C')} (${count('C', 2)}/${count('C', 3)}) I${count('I')} park${count('park')} civic${count('civic')} abandoned${abandoned} | ` +
        `roads dirt${tiers[1]} street${tiers[2]} ave${tiers[3]} hwy${tiers[4]} | centres ${sim.state.centres.size}`,
    );
  }
}
console.log(`done in ${((performance.now() - t0) / 1000).toFixed(1)}s, slowest tick ${slowest.toFixed(1)}ms, ${changes} changes`);
