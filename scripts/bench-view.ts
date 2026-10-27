/** Times the view's CPU work in Node (no GPU): incremental syncs, a full scrub, and Ambient life. */
import { parseCharter } from '../src/sim/charter';
import { Simulation, type TickResult } from '../src/sim/sim';
import { applyChanges, CityState } from '../src/sim/state';
import { CityView } from '../src/render/cityView';

const charter = parseCharter(process.argv[2] ?? '?seed=11&ambition=metro&water=coastal')!;
const sim = new Simulation(charter);
const results: TickResult[] = [];
for (let r = sim.step(); r; r = sim.step()) results.push(r);
const view = new CityView(sim.terrain, charter.seed);
const state = new CityState();
let worst = 0, total = 0;
for (const r of results) {
  applyChanges(state, r.changes, true);
  const t = performance.now();
  view.sync(state, true, r.tick / 10);
  const dt = performance.now() - t;
  worst = Math.max(worst, dt); total += dt;
}
console.log(`incremental sync: avg ${(total / results.length).toFixed(2)}ms, worst ${worst.toFixed(1)}ms`);
// Scrub from the Present back to year 0 and forward again in one jump each.
for (let k = results.length - 1; k >= 0; k--) applyChanges(state, results[k].changes, false);
let t = performance.now(); view.sync(state, false, 0); console.log(`jump to year 0: ${(performance.now() - t).toFixed(1)}ms`);
for (const r of results) applyChanges(state, r.changes, true);
t = performance.now(); view.sync(state, false, 0); console.log(`jump to year 100: ${(performance.now() - t).toFixed(1)}ms`);
const traffic = results.filter((r) => r.fields).at(-1)!.fields!.traffic;
t = performance.now();
for (let f = 0; f < 120; f++) view.update(f / 60, 1 / 60, state, traffic, 50000, 0);
console.log(`ambient + animation per frame: ${((performance.now() - t) / 120).toFixed(2)}ms`);
let parts = 0;
for (const child of view.buildings.group.children) parts += (child as any).count ?? 0;
console.log(`building part instances: ${parts}, lots: ${state.lots.size}`);
