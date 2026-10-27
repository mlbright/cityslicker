import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHARTER } from '../src/sim/charter';
import { computeLandValue, computeTraffic, centreInfluence, computeAmenity } from '../src/sim/fields';
import { Simulation, type TickResult } from '../src/sim/sim';
import { CityState, lotCapacity, packRoad, Tier, type Lot } from '../src/sim/state';
import { CORNERS, finishTerrain, SIZE } from '../src/sim/terrain';

/** A flat island-free test map, with optional water columns. */
function flatTerrain(waterColumns: number[] = []) {
  const corners = new Float32Array(CORNERS * CORNERS).fill(0.5);
  for (const x of waterColumns) for (let y = 0; y < CORNERS; y++) corners[y * CORNERS + x] = -1;
  return finishTerrain(corners);
}

function lot(id: number, x: number, y: number, use: Lot['use'], density: 1 | 2 | 3 = 1): Lot {
  return { id, x, y, w: 2, h: 2, use, zonedTick: 0, centre: 1, building: { density, variant: 0, builtTick: 0, abandonedTick: -1 } };
}

function place(state: CityState, l: Lot): void {
  state.lots.set(l.id, l);
  for (let y = l.y; y < l.y + l.h; y++) for (let x = l.x; x < l.x + l.w; x++) state.lotAt[y * SIZE + x] = l.id;
}

describe('Land value', () => {
  const terrain = flatTerrain([100, 101]);
  const state = new CityState();
  const centre = { centre: { id: 1, x: 40, y: 40, name: 'A', foundedTick: 0 }, population: 5000, radius: 20 };
  const influence = centreInfluence([centre], 20_000);
  const noPollution = new Float32Array(SIZE * SIZE);
  const lv = computeLandValue({ terrain, state, influence, pollution: noPollution }, computeAmenity(state));

  it('is higher near a large Centre than far away', () => {
    expect(lv[40 * SIZE + 42]).toBeGreaterThan(lv[40 * SIZE + 80] + 0.2);
  });

  it('is raised by water', () => {
    expect(lv[60 * SIZE + 98]).toBeGreaterThan(lv[60 * SIZE + 90]);
  });

  it('is lowered by pollution', () => {
    const polluted = noPollution.slice();
    polluted[40 * SIZE + 42] = 1;
    const dirty = computeLandValue({ terrain, state, influence, pollution: polluted }, computeAmenity(state));
    expect(dirty[40 * SIZE + 42]).toBeLessThan(lv[40 * SIZE + 42] - 0.3);
  });

  it('is raised by Parks', () => {
    const withPark = new CityState();
    place(withPark, { ...lot(9, 70, 70, 'park'), building: null });
    const lv2 = computeLandValue({ terrain, state: withPark, influence, pollution: noPollution }, computeAmenity(withPark));
    expect(lv2[72 * SIZE + 72]).toBeGreaterThan(lv[72 * SIZE + 72]);
  });
});

describe('Traffic', () => {
  it('is heavier on Roads beside busy Lots than on empty ones', () => {
    const state = new CityState();
    for (let x = 10; x < 120; x++) {
      state.road[20 * SIZE + x] = packRoad(Tier.Street, 0b01000100);
    }
    for (let k = 0; k < 6; k++) place(state, lot(k + 1, 12 + k * 2, 21, 'R', 3));
    const traffic = computeTraffic(state, [], new Map(), 0);
    expect(traffic[20 * SIZE + 16]).toBeGreaterThan(traffic[20 * SIZE + 100] + 0.2);
  });
});

describe('Lot capacity', () => {
  it('is zero for abandoned and unbuilt Buildings', () => {
    const l = lot(1, 0, 0, 'R', 2);
    expect(lotCapacity(l)).toBeGreaterThan(0);
    expect(lotCapacity({ ...l, building: { ...l.building!, abandonedTick: 5 } })).toBe(0);
    expect(lotCapacity({ ...l, building: null })).toBe(0);
  });

  it('grows with Density', () => {
    const caps = ([1, 2, 3] as const).map((d) => lotCapacity(lot(1, 0, 0, 'C', d)));
    expect(caps[1]).toBeGreaterThan(caps[0]);
    expect(caps[2]).toBeGreaterThan(caps[1]);
  });
});

describe('a living City', () => {
  let results: TickResult[];
  beforeAll(() => {
    const sim = new Simulation({ seed: 4821, ...DEFAULT_CHARTER });
    results = [];
    for (let r = sim.step(); r; r = sim.step()) results.push(r);
  });
  const lotChanges = () => results.flatMap((r) => r.changes.map((c) => ({ tick: r.tick, c })).filter(({ c }) => c.k === 'lot'));

  it('redevelops Lots into denser Buildings', () => {
    const redevelopments = lotChanges().filter(({ c }) => c.k === 'lot' && c.from?.building && c.to?.building && c.to.building.density > c.from.building.density);
    expect(redevelopments.length).toBeGreaterThan(20);
  });

  it('merges neighbouring Lots during Redevelopment', () => {
    const merges = lotChanges().filter(({ c }) => c.k === 'lot' && c.from && c.to && c.to.w * c.to.h > c.from.w * c.from.h);
    expect(merges.length).toBeGreaterThan(5);
  });

  it('abandons Buildings and later demolishes them', () => {
    const abandoned = new Map<number, number>();
    let demolishedAfter = 0;
    for (const { tick, c } of lotChanges()) {
      if (c.k !== 'lot') continue;
      if (c.from?.building && c.to?.building && c.from.building.abandonedTick < 0 && c.to.building.abandonedTick >= 0) abandoned.set(c.id, tick);
      if (c.from && !c.to && abandoned.has(c.id)) {
        expect(tick).toBeGreaterThan(abandoned.get(c.id)!);
        demolishedAfter++;
      }
    }
    expect(abandoned.size).toBeGreaterThan(3);
    expect(demolishedAfter).toBeGreaterThan(0);
  });

  it('only builds towers once the City is big', () => {
    for (const r of results) {
      const tower = r.changes.some((c) => c.k === 'lot' && c.to?.building?.density === 3 && c.to.use !== 'I' && (!c.from?.building || c.from.building.density < 3));
      if (tower) expect(r.stats.population).toBeGreaterThan(4000);
    }
  });

  it('founds more Centres as it grows', () => {
    const founded = results.flatMap((r) => r.milestones).filter((m) => m.kind === 'centre');
    expect(founded.length).toBeGreaterThanOrEqual(2);
  });
});
