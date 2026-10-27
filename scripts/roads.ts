import { parseCharter } from '../src/sim/charter';
import { Simulation } from '../src/sim/sim';
import { roadConn, roadTier } from '../src/sim/state';
import { FLAT_SLOPE } from '../src/sim/terrain';
const qs = process.argv.slice(2).length ? process.argv.slice(2) : ['?seed=4821', '?seed=11&ambition=metro&water=coastal', '?seed=300&ambition=metro&hills=mountainous', '?seed=77&water=islands&hills=mountainous'];
for (const q of qs) {
  const sim = new Simulation(parseCharter(q)!);
  while (sim.step());
  const s = sim.state;
  let diag = 0, pockets = 0, bridges = 0, tiles = 0;
  const tiers = [0, 0, 0, 0, 0];
  for (let i = 0; i < s.road.length; i++) {
    if (s.pocket[i]) pockets++;
    if (!s.road[i]) continue;
    tiles++;
    tiers[roadTier(s.road[i])]++;
    const c = roadConn(s.road[i]);
    if (c & 0b10101010) diag++;
    if (sim.terrain.water[i]) bridges++;
  }
  let terraces = 0;
  for (const l of s.lots.values()) {
    let lo = Infinity, hi = -Infinity;
    for (let y = l.y; y < l.y + l.h; y++) for (let x = l.x; x < l.x + l.w; x++) { const sl = sim.terrain.slope[y * 128 + x]; lo = Math.min(lo, sl); hi = Math.max(hi, sl); }
    if (hi > FLAT_SLOPE) terraces++;
  }
  console.log(`${sim.name.padEnd(20)} road tiles ${tiles} tiers ${tiers.slice(1).join('/')} diagonal ${diag} pockets ${pockets} bridge tiles ${bridges} terraced lots ${terraces}/${s.lots.size}`);
}
