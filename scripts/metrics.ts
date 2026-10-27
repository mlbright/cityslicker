/** Summarises growth dynamics for several Charters: densities, merges, churn. */
import { parseCharter } from '../src/sim/charter';
import { Simulation } from '../src/sim/sim';
const queries = process.argv.slice(2).length ? process.argv.slice(2) : ['?seed=4821', '?seed=11&ambition=metro&water=coastal', '?seed=5&ambition=town&water=lakes&hills=flat', '?seed=300&ambition=metro&lean=0.8&hills=mountainous', '?seed=902&ambition=city&lean=-0.8'];
for (const q of queries) {
  const sim = new Simulation(parseCharter(q)!);
  let merges = 0, abandons = 0, demolitions = 0, redevelops = 0, promotions = 0;
  const demolishedAt = new Map<number, string>();
  let characterChanges = 0;
  let pop = 0;
  for (let r = sim.step(); r; r = sim.step()) {
    pop = r.stats.population;
    for (const c of r.changes) {
      if (c.k === 'road' && c.promotion) promotions++;
      if (c.k !== 'lot') continue;
      if (c.from && c.to && c.to.w * c.to.h > c.from.w * c.from.h) merges++;
      if (c.from?.building && c.to?.building && c.to.building.density > c.from.building.density) redevelops++;
      if (c.from?.building && c.to?.building && c.from.building.abandonedTick < 0 && c.to.building.abandonedTick >= 0) abandons++;
      if (c.from && !c.to && c.from.building && c.from.building.abandonedTick >= 0) {
        demolitions++;
        demolishedAt.set(c.from.y * 128 + c.from.x, c.from.use);
      }
      if (!c.from && c.to) {
        const prev = demolishedAt.get(c.to.y * 128 + c.to.x);
        if (prev && prev !== c.to.use) characterChanges++;
      }
    }
  }
  const lots = [...sim.state.lots.values()];
  const hist = (u: string) => [1, 2, 3].map((d) => lots.filter((l) => l.use === u && l.building?.density === d).length).join('/');
  console.log(`${sim.name.padEnd(22)} pop ${String(pop).padStart(6)} | R ${hist('R')} C ${hist('C')} I ${hist('I')} | redevelop ${redevelops} merges ${merges} | abandon ${abandons} demolish ${demolitions} rezoned-differently ${characterChanges} | promotions ${promotions} | centres ${sim.state.centres.size}`);
}
