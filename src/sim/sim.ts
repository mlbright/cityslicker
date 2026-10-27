import { AMBITION_POPULATION, type Charter } from './charter';
import {
  boxBlur,
  centreInfluence,
  computeAmenity,
  computeLandValue,
  computePollution,
  computeTraffic,
  growthRadius,
  toBytes,
  type Arterial,
  type CentreSize,
} from './fields';
import { centreName, cityName, compassDirection } from './names';
import { findPath, octile } from './pathfind';
import { hashInts, Rng } from './rng';
import {
  applyChange,
  CityState,
  DIRS,
  isDiagonal,
  lotCapacity,
  N_TILES,
  opposite,
  packRoad,
  roadConn,
  roadTier,
  RUN_TICKS,
  Tier,
  TICKS_PER_YEAR,
  type Building,
  type Centre,
  type Change,
  type CivicKind,
  type Density,
  type Lot,
  type LotUse,
  type Zone,
} from './state';
import { distanceField, FLAT_SLOPE, generateTerrain, GENTLE_SLOPE, ROAD_SLOPE, SIZE, type Terrain } from './terrain';

export interface Demand {
  R: number;
  C: number;
  I: number;
}

export interface TickStats {
  tick: number;
  population: number;
  jobsC: number;
  jobsI: number;
  demand: Demand;
  centres: { id: number; population: number }[];
}

export type MilestoneKind =
  | 'centre'
  | 'population'
  | 'avenue'
  | 'midrise'
  | 'tower'
  | 'townhall'
  | 'landmark'
  | 'highway'
  | 'bridge';

export interface MilestoneEvent {
  tick: number;
  kind: MilestoneKind;
  label: string;
  x: number;
  y: number;
}

export interface FieldsSnapshot {
  tick: number;
  landValue: Uint8Array;
  traffic: Uint8Array;
}

export interface TickResult {
  tick: number;
  changes: Change[];
  stats: TickStats;
  milestones: MilestoneEvent[];
  fields: FieldsSnapshot | null;
}

const RECOMPUTE_EVERY = 3;
const FIELDS_EVERY = 6;
const ORTHO = [0, 2, 4, 6] as const;

interface CivicStep {
  pop: number;
  use: 'park' | 'civic';
  kind?: CivicKind;
  w: number;
  d: number;
}

/** What each Centre adds as it grows. */
const CIVIC_PLAN: readonly CivicStep[] = [
  { pop: 120, use: 'park', w: 2, d: 2 },
  { pop: 350, use: 'civic', kind: 'school', w: 2, d: 2 },
  { pop: 700, use: 'civic', kind: 'townhall', w: 2, d: 2 },
  { pop: 1300, use: 'civic', kind: 'fire', w: 2, d: 1 },
  { pop: 2000, use: 'park', w: 3, d: 3 },
  { pop: 3200, use: 'civic', kind: 'clinic', w: 2, d: 2 },
  { pop: 4500, use: 'civic', kind: 'library', w: 2, d: 2 },
  { pop: 6500, use: 'civic', kind: 'landmark', w: 2, d: 2 },
  { pop: 9000, use: 'park', w: 4, d: 4 },
  { pop: 14000, use: 'civic', kind: 'school', w: 2, d: 2 },
  { pop: 20000, use: 'park', w: 4, d: 3 },
];

const MAX_CENTRES = { town: 2, city: 4, metro: 6 } as const;
const POPULATION_MILESTONES = [1_000, 5_000, 10_000, 25_000, 50_000];

/** Grows one City, a month per step, recording every change so the Time lapse can rewind it. */
export class Simulation {
  readonly state = new CityState();
  readonly terrain: Terrain;
  readonly charter: Charter;
  readonly name: string;
  readonly targetPopulation: number;
  tick = 0;

  private readonly rng: Rng;
  private pending: Change[] = [];
  private pendingMilestones: MilestoneEvent[] = [];
  private nextLotId = 1;
  private nextCentreId = 1;

  private landValue: Float32Array = new Float32Array(N_TILES);
  private traffic: Float32Array = new Float32Array(N_TILES);
  private pollution: Float32Array = new Float32Array(N_TILES);
  private influence: Float32Array = new Float32Array(N_TILES);
  private nearestCentre = new Int32Array(N_TILES);
  private reach = new Uint8Array(N_TILES);
  private highwayDist: Float32Array = new Float32Array(N_TILES).fill(40);
  private readonly promoteStreak = new Uint8Array(N_TILES);
  private readonly misfit = new Map<number, number>();
  /** Tiles kept free for future side streets, so Zoning doesn't box the network in. */
  private readonly reserved = new Uint8Array(N_TILES);
  private stubs: { t: number; dir: number; tiles: number[] }[] = [];
  private readonly arterials: Arterial[] = [];
  private centreSizes: CentreSize[] = [];
  /** Centre size (residents plus half the jobs), which drives its reach and Land value. */
  private readonly centrePop = new Map<number, number>();
  private readonly centreResidents = new Map<number, number>();
  private readonly civicProgress = new Map<number, number>();
  /** Extra reach a Centre earns when it runs out of land. */
  private readonly reachBonus = new Map<number, number>();
  private readonly achieved = new Set<string>();
  private readonly stamp = new Int32Array(N_TILES);
  private stampId = 0;

  private population = 0;
  private jobsC = 0;
  private jobsI = 0;
  private pendingCap: Demand = { R: 0, C: 0, I: 0 };
  private deficit: Demand = { R: 0, C: 0, I: 0 };
  private demand: Demand = { R: 0, C: 0, I: 0 };
  private unmet = 0;
  private lastFounded = 0;
  /** Set when no spot was left for another Centre. */
  private noSite = false;
  private highwaysBuilt = 0;
  private highwayEdges: number[] = [];
  private roadList: number[] = [];
  private roadListDirty = true;

  constructor(charter: Charter, terrain?: Terrain) {
    this.charter = charter;
    this.terrain = terrain ?? generateTerrain(charter);
    this.rng = new Rng(charter.seed, `growth:${charter.water}:${charter.hills}:${charter.ambition}:${charter.lean}`);
    this.targetPopulation = AMBITION_POPULATION[charter.ambition];
    this.name = cityName(charter.seed, charter.water === 'coastal' || charter.water === 'islands');
  }

  get done(): boolean {
    return this.tick >= RUN_TICKS;
  }

  /** Simulates one month. Returns null once the Run is over. */
  step(): TickResult | null {
    if (this.done) return null;
    const t = this.tick;
    if (t === 0) this.genesis();
    this.countPopulation();
    if (t % RECOMPUTE_EVERY === 0) this.recomputeFields();
    this.updateDemand();
    this.grow();
    this.construct();
    if (t % RECOMPUTE_EVERY === 1) {
      this.churn();
      this.promoteRoads();
    }
    if (t % RECOMPUTE_EVERY === 2) this.addCivic();
    if (t % TICKS_PER_YEAR === 6) {
      this.maybeFoundCentre();
      this.maybeBuildHighway();
      this.maybeAddWatersidePark();
    }
    this.countPopulation();
    this.checkPopulationMilestones();

    const result: TickResult = {
      tick: t,
      changes: this.pending,
      stats: {
        tick: t,
        population: Math.round(this.population),
        jobsC: Math.round(this.jobsC),
        jobsI: Math.round(this.jobsI),
        demand: { ...this.demand },
        centres: [...this.state.centres.keys()].map((id) => ({ id, population: Math.round(this.centreResidents.get(id) ?? 0) })),
      },
      milestones: this.pendingMilestones,
      fields:
        t % FIELDS_EVERY === 0
          ? { tick: t, landValue: toBytes(this.landValue), traffic: toBytes(this.traffic) }
          : null,
    };
    this.pending = [];
    this.pendingMilestones = [];
    this.tick++;
    return result;
  }

  // ---------------------------------------------------------------- recording changes

  private record(c: Change): void {
    applyChange(this.state, c, true);
    this.pending.push(c);
  }

  private setRoad(i: number, tier: number, conn: number): void {
    const from = this.state.road[i];
    const to = packRoad(tier, conn);
    if (from !== to) {
      this.record({ k: 'road', i, from, to });
      this.roadListDirty = true;
    }
    if (tier > 0 && this.state.pocket[i]) this.record({ k: 'pocket', i, from: this.state.pocket[i], to: 0 });
    if (tier > 0) this.reserved[i] = 0;
  }

  private setPocket(i: number, v: number): void {
    const from = this.state.pocket[i];
    if (from !== v) this.record({ k: 'pocket', i, from, to: v });
  }

  private addLot(x: number, y: number, w: number, h: number, use: LotUse, building: Building | null): Lot {
    const lot: Lot = {
      id: this.nextLotId++,
      x,
      y,
      w,
      h,
      use,
      zonedTick: this.tick,
      centre: this.nearestCentre[(y + (h >> 1)) * SIZE + x + (w >> 1)],
      building,
    };
    this.record({ k: 'lot', id: lot.id, from: null, to: lot });
    return lot;
  }

  private replaceLot(from: Lot, to: Lot | null): void {
    this.record({ k: 'lot', id: from.id, from, to });
  }

  private milestone(kind: MilestoneKind, label: string, x: number, y: number, key = kind as string): void {
    if (this.achieved.has(key)) return;
    this.achieved.add(key);
    this.pendingMilestones.push({ tick: this.tick, kind, label, x, y });
  }

  // ---------------------------------------------------------------- roads

  /** Connects two neighbouring tiles with road. Diagonal steps leave Pocket parks in the slivers. */
  private link(a: number, b: number, tier: number, force = false): void {
    const ax = a % SIZE;
    const ay = (a - ax) / SIZE;
    const bx = b % SIZE;
    const by = (b - bx) / SIZE;
    const dir = DIRS.findIndex(([dx, dy]) => dx === bx - ax && dy === by - ay);
    if (dir < 0) throw new Error('link: tiles are not neighbours');
    for (const [i, d] of [[a, dir], [b, opposite(dir)]] as const) {
      const cur = this.state.road[i];
      const curTier = roadTier(cur);
      const newTier = curTier === 0 ? tier : force ? Math.max(curTier, tier) : curTier;
      this.setRoad(i, newTier, roadConn(cur) | (1 << d));
    }
    if (isDiagonal(dir)) {
      for (const s of [ay * SIZE + bx, by * SIZE + ax]) {
        if (!this.state.road[s] && !this.state.lotAt[s] && !this.terrain.water[s]) this.setPocket(s, 1);
      }
    }
  }

  private buildPath(path: readonly number[], tier: number, force = false): void {
    if (path.length === 1 && !this.state.road[path[0]]) this.setRoad(path[0], tier, 0);
    for (let k = 0; k + 1 < path.length; k++) this.link(path[k], path[k + 1], tier, force);
    for (const t of path) {
      if (this.terrain.water[t] && roadTier(this.state.road[t]) < Tier.Highway) {
        this.milestone('bridge', 'First bridge', t % SIZE, (t / SIZE) | 0);
        break;
      }
    }
  }

  private roads(): number[] {
    if (this.roadListDirty) {
      this.roadList = [];
      for (let i = 0; i < N_TILES; i++) if (this.state.road[i]) this.roadList.push(i);
      this.roadListDirty = false;
    }
    return this.roadList;
  }

  private isLocalRoad(i: number): boolean {
    const t = roadTier(this.state.road[i]);
    return t >= Tier.Dirt && t <= Tier.Avenue;
  }

  /** Cost function for roads laid by pathfinding (highways and connectors). */
  private pathCost(tier: number, maxSlope: number): (from: number, to: number, dir: number) => number {
    return (from, to, dir) => {
      if (this.state.lotAt[to]) return Infinity;
      const slope = this.terrain.slope[to];
      if (slope > maxSlope) return Infinity;
      if (isDiagonal(dir)) {
        const fx = from % SIZE;
        const fy = (from - fx) / SIZE;
        const tx = to % SIZE;
        const ty = (to - tx) / SIZE;
        const s1 = fy * SIZE + tx;
        const s2 = ty * SIZE + fx;
        if (this.state.lotAt[s1] || this.state.lotAt[s2]) return Infinity;
        if (this.state.road[s1] && this.state.road[s2]) return Infinity;
      }
      let cost = isDiagonal(dir) ? 1.414 : 1;
      cost += slope * 2.5;
      if (this.terrain.water[to]) cost += tier === Tier.Highway ? 3 : 6;
      const existing = roadTier(this.state.road[to]);
      if (existing) cost = tier === Tier.Highway ? cost + 1.5 : cost * 0.35;
      return cost;
    };
  }

  /**
   * Extends a straight Road from `start` in direction `dir`. Stops at obstacles, joins existing Roads
   * and may bridge short stretches of water. Returns the number of new tiles.
   */
  private extendLine(start: number, dir: number, maxLen: number, tier: number, allowBridge: boolean, maxReach: number): number {
    const [dx, dy] = DIRS[dir];
    const path = [start];
    let x = start % SIZE;
    let y = (start - x) / SIZE;
    let joined = false;
    const sides = [
      [-dy, dx],
      [dy, -dx],
    ];
    const startCentre = this.nearestCentre[start];
    const centre = this.state.centres.get(startCentre);
    for (let step = 1; step <= maxLen; step++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= SIZE - 1 || ny >= SIZE - 1) break;
      const next = ny * SIZE + nx;
      const cornersBlocked = isDiagonal(dir) && (this.state.lotAt[y * SIZE + nx] !== 0 || this.state.lotAt[ny * SIZE + x] !== 0);
      if (this.state.road[next]) {
        if (this.isLocalRoad(next) && !cornersBlocked) {
          path.push(next);
          joined = true;
        }
        break;
      }
      if (centre && Math.hypot(nx - centre.x, ny - centre.y) > maxReach) break;
      if (this.state.lotAt[next]) break;
      if (this.terrain.water[next]) {
        if (!allowBridge || isDiagonal(dir)) break;
        const span: number[] = [];
        let bx = nx;
        let by = ny;
        let landed = false;
        for (let k = 0; k < 6; k++) {
          if (bx < 1 || by < 1 || bx >= SIZE - 1 || by >= SIZE - 1) break;
          const b = by * SIZE + bx;
          if (this.state.road[b] || this.state.lotAt[b]) break;
          span.push(b);
          if (!this.terrain.water[b]) {
            landed = this.terrain.slope[b] <= ROAD_SLOPE;
            break;
          }
          bx += dx;
          by += dy;
        }
        if (!landed || span.length > 6) break;
        path.push(...span);
        x = bx;
        y = by;
        continue;
      }
      if (this.terrain.slope[next] > ROAD_SLOPE) break;
      if (isDiagonal(dir)) {
        // A diagonal step cuts the corners of two tiles; they must be free to become Pocket parks.
        if (cornersBlocked) break;
        if (this.state.road[y * SIZE + nx] && this.state.road[ny * SIZE + x] && step > 1) break;
      }
      let hugging = false;
      if (!isDiagonal(dir) || step > 2) {
        for (const [sx, sy] of sides) {
          const s = (ny + sy) * SIZE + nx + sx;
          if (this.state.road[s]) hugging = true;
        }
      }
      if (hugging) break;
      path.push(next);
      x = nx;
      y = ny;
    }
    if (path.length < 3 && !joined) return 0;
    if (path.length < 2) return 0;
    this.buildPath(path, tier);
    this.reserveStubs(path, !joined);
    return path.length - 1;
  }

  /**
   * Keeps a side-street stub free every few tiles along a new Road, plus room to continue past a
   * dead end, so later streets can branch off before Lots fill the frontage.
   */
  private reserveStubs(path: readonly number[], deadEnd: boolean): void {
    const spacing = 5 + this.rng.int(3);
    const phase = this.rng.int(spacing);
    const reserve = (from: number, dir: number) => {
      const x = from % SIZE;
      const y = (from - x) / SIZE;
      const tiles: number[] = [];
      for (let k = 1; k <= 2; k++) {
        const tx = x + DIRS[dir][0] * k;
        const ty = y + DIRS[dir][1] * k;
        if (tx < 1 || ty < 1 || tx >= SIZE - 1 || ty >= SIZE - 1) break;
        const t = ty * SIZE + tx;
        if (!this.zonable(t)) break;
        tiles.push(t);
      }
      if (tiles.length === 0) return;
      for (const t of tiles) this.reserved[t] = 1;
      this.stubs.push({ t: from, dir, tiles });
    };
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1];
      const b = path[k];
      const dir = DIRS.findIndex(([dx, dy]) => dx === (b % SIZE) - (a % SIZE) && dy === ((b / SIZE) | 0) - ((a / SIZE) | 0));
      if (dir < 0 || this.terrain.water[b]) continue;
      if (isDiagonal(dir)) {
        if (deadEnd && k === path.length - 1) this.reserveDiagonal(b, dir);
        continue;
      }
      if ((k + phase) % spacing === 0) {
        reserve(b, (dir + 2) & 7);
        reserve(b, (dir + 6) & 7);
      }
      if (deadEnd && k === path.length - 1) reserve(b, dir);
    }
  }

  /** Keeps the next diagonal step (and the two corners it cuts) free so a diagonal can keep going. */
  private reserveDiagonal(from: number, dir: number): void {
    const x = from % SIZE;
    const y = (from - x) / SIZE;
    const [dx, dy] = DIRS[dir];
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 1 || ny < 1 || nx >= SIZE - 1 || ny >= SIZE - 1) return;
    const tiles = [ny * SIZE + nx, y * SIZE + nx, ny * SIZE + x];
    if (!tiles.every((t) => this.zonable(t))) return;
    for (const t of tiles) this.reserved[t] = 1;
    this.stubs.push({ t: from, dir, tiles });
  }

  private releaseStub(index: number): void {
    const stub = this.stubs[index];
    for (const t of stub.tiles) this.reserved[t] = 0;
    this.stubs[index] = this.stubs[this.stubs.length - 1];
    this.stubs.pop();
  }

  /** Tries to grow a street from a reserved stub near a Centre. */
  private growFromStub(): boolean {
    for (let tries = 0; tries < 6 && this.stubs.length > 0; tries++) {
      let bestIndex = -1;
      let bestScore = -Infinity;
      for (let s = 0; s < Math.min(12, this.stubs.length); s++) {
        const index = this.rng.int(this.stubs.length);
        const c = this.centreOf(this.stubs[index].t);
        if (!c) continue;
        const t = this.stubs[index].t;
        const d = Math.hypot((t % SIZE) - c.centre.x, ((t / SIZE) | 0) - c.centre.y);
        if (d > c.radius + 1) continue;
        const score = 1 - d / (c.radius + 1) + this.landValue[t] * 0.4 + this.rng.next() * 0.6;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }
      if (bestIndex < 0) return false;
      const stub = this.stubs[bestIndex];
      this.releaseStub(bestIndex);
      if (!this.isLocalRoad(stub.t)) continue;
      const c = this.centreOf(stub.t)!;
      const bridge = this.population > 400 && this.rng.chance(0.35);
      if (this.extendLine(stub.t, stub.dir, 4 + this.rng.int(9), this.newRoadTier(), bridge, c.radius + 3) > 0) return true;
    }
    return false;
  }

  private newRoadTier(): number {
    return this.population < 1500 ? Tier.Dirt : Tier.Street;
  }

  /** Grows new streets out of the existing network near Centres. Returns true if any were built. */
  private growRoads(attempts: number): boolean {
    const local = this.roads().filter((r) => this.isLocalRoad(r));
    if (local.length === 0) return false;
    let any = false;
    for (let a = 0; a < attempts; a++) {
      if (this.growFromStub()) {
        any = true;
        continue;
      }
      const scored: { t: number; score: number }[] = [];
      for (let s = 0; s < 30; s++) {
        const t = local[this.rng.int(local.length)];
        const c = this.centreOf(t);
        if (!c) continue;
        const d = Math.hypot((t % SIZE) - c.centre.x, ((t / SIZE) | 0) - c.centre.y);
        if (d > c.radius + 1) continue;
        scored.push({ t, score: 1 - d / (c.radius + 1) + this.landValue[t] * 0.5 + this.rng.next() * 0.7 });
      }
      scored.sort((p, q) => q.score - p.score);
      let built = false;
      for (const { t } of scored.slice(0, 6)) {
        const conn = roadConn(this.state.road[t]);
        const options = ORTHO.filter((d) => !(conn & (1 << d)));
        for (let k = options.length - 1; k > 0; k--) {
          const j = this.rng.int(k + 1);
          [options[k], options[j]] = [options[j], options[k]];
        }
        const c = this.centreOf(t)!;
        for (const dir of options) {
          const straight = (conn & (1 << opposite(dir))) !== 0;
          if (!straight && !this.branchSpacingOk(t, dir, 4 + this.rng.int(3))) continue;
          const bridge = this.population > 400 && this.rng.chance(0.35);
          if (this.extendLine(t, dir, 4 + this.rng.int(9), this.newRoadTier(), bridge, c.radius + 3) > 0) {
            built = true;
            break;
          }
        }
        if (built) break;
      }
      if (built) any = true;
    }
    return any;
  }

  /** Keeps parallel streets far enough apart for Lots between them. */
  private branchSpacingOk(start: number, dir: number, spacing: number): boolean {
    const [dx, dy] = DIRS[dir];
    const x = start % SIZE;
    const y = (start - x) / SIZE;
    for (let k = 1; k < spacing; k++) {
      for (const sgn of [-1, 1]) {
        for (let ahead = 1; ahead <= 2; ahead++) {
          const tx = x + dx * ahead + -dy * k * sgn;
          const ty = y + dy * ahead + dx * k * sgn;
          if (tx < 0 || ty < 0 || tx >= SIZE || ty >= SIZE) continue;
          if (this.state.road[ty * SIZE + tx]) return false;
        }
      }
    }
    return true;
  }

  private centreOf(i: number): CentreSize | undefined {
    const id = this.nearestCentre[i];
    return this.centreSizes.find((c) => c.centre.id === id);
  }

  // ---------------------------------------------------------------- genesis and Centres

  private genesis(): void {
    this.buildRegionalHighway();
    this.highwayDist = this.computeHighwayDist();
    const site = this.chooseSite(0, true);
    if (site >= 0) this.foundCentre(site);
    this.recomputeFields();
  }

  private edgeTiles(side: number): number[] {
    const out: number[] = [];
    for (let k = 0; k < SIZE; k++) {
      const [x, y] = [
        [k, 0],
        [SIZE - 1, k],
        [k, SIZE - 1],
        [0, k],
      ][side];
      out.push(y * SIZE + x);
    }
    return out;
  }

  private buildRegionalHighway(): void {
    const landCount = (side: number) => this.edgeTiles(side).filter((i) => !this.terrain.water[i]).length;
    const ns = Math.min(landCount(0), landCount(2));
    const we = Math.min(landCount(1), landCount(3));
    const pair = ns > we || (ns === we && this.rng.chance(0.5)) ? [0, 2] : [3, 1];
    if (this.rng.chance(0.5)) pair.reverse();
    const [from, to] = pair;
    this.highwayEdges = [from, to];
    const startTiles = this.edgeTiles(from);
    const scored = startTiles.map((i, k) => {
      const mid = 1 - Math.abs(k - SIZE / 2) / (SIZE / 2);
      const land = this.terrain.water[i] ? -1.5 : 0;
      return mid * 0.8 + land - this.terrain.slope[i] + this.rng.next() * 0.6;
    });
    const start = startTiles[scored.indexOf(Math.max(...scored))];
    const goal = new Set(this.edgeTiles(to));
    const path = findPath([start], {
      isGoal: (i) => goal.has(i),
      heuristic: (i) => {
        const x = i % SIZE;
        const y = (i - x) / SIZE;
        return [y, SIZE - 1 - x, SIZE - 1 - y, x][to];
      },
      stepCost: this.pathCost(Tier.Highway, ROAD_SLOPE * 1.8),
      diagonal: true,
      turnPenalty: 1.2,
      maxExpanded: 400000,
    });
    if (path) this.buildPath(path, Tier.Highway, true);
  }

  private computeHighwayDist(): Float32Array {
    const src = new Uint8Array(N_TILES);
    for (let i = 0; i < N_TILES; i++) if (roadTier(this.state.road[i]) === Tier.Highway) src[i] = 1;
    return distanceField(src);
  }

  /** Picks a spot for a new Centre: flat, roomy, near a Road, and at least `minGap` from other Centres. */
  private chooseSite(minGap: number, first: boolean): number {
    const roadSrc = new Uint8Array(N_TILES);
    for (const r of this.roads()) roadSrc[r] = 1;
    const roadDist = distanceField(roadSrc);
    let best = -1;
    let bestScore = -Infinity;
    for (let y = 12; y < SIZE - 12; y += 2) {
      for (let x = 12; x < SIZE - 12; x += 2) {
        const i = y * SIZE + x;
        if (this.terrain.water[i] || this.terrain.slope[i] > FLAT_SLOPE * 1.3 || this.state.lotAt[i] || this.state.road[i]) continue;
        const rd = first ? this.highwayDist[i] : roadDist[i];
        if (rd < 2 || rd > 6) continue;
        let tooClose = false;
        for (const c of this.state.centres.values()) if (Math.hypot(x - c.x, y - c.y) < minGap) tooClose = true;
        if (tooClose) continue;
        let room = 0;
        for (let oy = -6; oy <= 6; oy += 2) {
          for (let ox = -6; ox <= 6; ox += 2) {
            const j = (y + oy) * SIZE + x + ox;
            if (!this.terrain.water[j] && this.terrain.slope[j] <= GENTLE_SLOPE && !this.state.lotAt[j]) room++;
          }
        }
        if (room < 30) continue;
        const wd = this.terrain.waterDist[i];
        const waterBonus = wd >= 2 && wd <= 9 ? 0.5 : wd <= 16 ? 0.2 : 0;
        const central = 1 - Math.hypot(x - SIZE / 2, y - SIZE / 2) / (SIZE * 0.7);
        let score = room / 49 + waterBonus + central * 0.6 + this.rng.next() * 0.35 - this.terrain.slope[i];
        if (!first) {
          let nearest = Infinity;
          for (const c of this.state.centres.values()) nearest = Math.min(nearest, Math.hypot(x - c.x, y - c.y));
          score -= Math.max(0, nearest - minGap) / 40;
        }
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
    }
    return best;
  }

  private foundCentre(site: number): void {
    const x = site % SIZE;
    const y = (site - x) / SIZE;
    const id = this.nextCentreId++;
    const first = this.state.centres.size === 0;
    let name = this.name;
    if (!first) {
      const home = [...this.state.centres.values()][0];
      const taken = new Set([...this.state.centres.values()].map((c) => c.name));
      name = centreName(this.charter.seed, id, this.name, compassDirection(x - home.x, y - home.y), this.terrain.waterDist[site] <= 4, taken);
    }
    const centre: Centre = { id, x, y, name, foundedTick: this.tick };
    this.record({ k: 'centre', id, from: null, to: centre });
    this.lastFounded = this.tick;
    this.refreshCentres();

    // Connect to the network: the highway for the first village, the nearest Road otherwise.
    const target = (i: number) => (first ? roadTier(this.state.road[i]) === Tier.Highway : this.state.road[i] !== 0 && i !== site);
    const link = findPath([site], {
      isGoal: target,
      heuristic: () => 0,
      stepCost: this.pathCost(Tier.Street, ROAD_SLOPE),
      diagonal: false,
      turnPenalty: 0.5,
      maxExpanded: 20000,
    });
    if (link) this.buildPath(link, Tier.Dirt);
    else this.setRoad(site, Tier.Dirt, roadConn(this.state.road[site]));
    for (const d of ORTHO) this.extendLine(site, d, 4 + this.rng.int(4), Tier.Dirt, false, 12);
    // One or two diagonal high streets, SimCity 4: Rush Hour style.
    // A second one runs the opposite way, making a straight diagonal through the Centre.
    const diagonals = [1, 3, 5, 7];
    const firstDiagonal = this.rng.int(4);
    const count = this.rng.chance(0.4) ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const dir = diagonals[(firstDiagonal + k * 2) % 4];
      this.extendLine(site, dir, 7 + this.rng.int(6), Tier.Dirt, false, 18);
    }

    // Later Centres also get an arterial to their nearest neighbour, which may run diagonally.
    if (!first) {
      let nearest: Centre | null = null;
      for (const c of this.state.centres.values()) {
        if (c.id === id) continue;
        if (!nearest || Math.hypot(c.x - x, c.y - y) < Math.hypot(nearest.x - x, nearest.y - y)) nearest = c;
      }
      if (nearest) this.buildArterial(centre, nearest);
    }
    this.milestone('centre', `${name} founded`, x, y, `centre:${id}`);
  }

  private buildArterial(a: Centre, b: Centre): void {
    const goal = b.y * SIZE + b.x;
    const near = (i: number) => {
      const x = i % SIZE;
      return Math.hypot(x - b.x, (i - x) / SIZE - b.y) <= 3 && this.state.road[i] !== 0;
    };
    const path = findPath([a.y * SIZE + a.x], {
      isGoal: near,
      heuristic: (i) => octile(i, goal) * 0.35,
      stepCost: this.pathCost(Tier.Street, ROAD_SLOPE),
      diagonal: true,
      turnPenalty: 0.9,
      maxExpanded: 120000,
    });
    if (!path) return;
    this.buildPath(path, Tier.Street);
    this.reserveStubs(path, false);
    this.arterials.push({ a: a.id, b: b.id, tiles: path });
  }

  private maybeFoundCentre(): void {
    const max = MAX_CENTRES[this.charter.ambition];
    if (this.state.centres.size >= max) return;
    if (this.tick < 10 * TICKS_PER_YEAR || this.tick - this.lastFounded < 6 * TICKS_PER_YEAR) return;
    if (this.unmet < 12 || !this.reachSaturated()) return;
    const site = this.chooseSite(28, false);
    this.noSite = site < 0;
    if (site < 0) return;
    this.foundCentre(site);
    this.unmet = 0;
  }

  private maybeBuildHighway(): void {
    if (this.targetPopulation < 20_000) return;
    if (this.highwaysBuilt === 0 && this.population >= this.targetPopulation * 0.3) {
      let target: Centre | null = null;
      for (const c of this.state.centres.values()) {
        const d = this.highwayDist[c.y * SIZE + c.x];
        if (d > 10 && (!target || d > this.highwayDist[target.y * SIZE + target.x])) target = c;
      }
      const goal = target ? target.y * SIZE + target.x : this.industryCentroid();
      if (goal < 0 || this.highwayDist[goal] <= 8) {
        this.highwaysBuilt++;
        return;
      }
      if (this.buildHighwayTo(goal, 3)) {
        this.milestone('highway', 'First highway spur', goal % SIZE, (goal / SIZE) | 0);
      }
      this.highwaysBuilt++;
    } else if (this.highwaysBuilt === 1 && this.targetPopulation >= 50_000 && this.population >= this.targetPopulation * 0.55) {
      const unused = [0, 1, 2, 3].filter((s) => !this.highwayEdges.includes(s));
      const side = unused.sort((a, b) => this.edgeLand(b) - this.edgeLand(a))[0];
      const goal = new Set(this.edgeTiles(side));
      const starts: number[] = [];
      for (const c of this.centreSizes) if (c.population > 2000) starts.push(c.centre.y * SIZE + c.centre.x);
      const sources = starts.length ? starts : this.roads().filter((r) => roadTier(this.state.road[r]) === Tier.Highway);
      const path = findPath(sources, {
        isGoal: (i) => goal.has(i),
        heuristic: (i) => {
          const x = i % SIZE;
          const y = (i - x) / SIZE;
          return [y, SIZE - 1 - x, SIZE - 1 - y, x][side];
        },
        stepCost: this.pathCost(Tier.Highway, ROAD_SLOPE * 1.6),
        diagonal: true,
        turnPenalty: 1.2,
        maxExpanded: 300000,
      });
      if (path) {
        this.buildPath(path, Tier.Highway, true);
        this.highwayDist = this.computeHighwayDist();
        const end = path[path.length - 1];
        this.milestone('highway', 'Second regional highway', end % SIZE, (end / SIZE) | 0, 'highway2');
      }
      this.highwaysBuilt++;
    }
  }

  private edgeLand(side: number): number {
    return this.edgeTiles(side).filter((i) => !this.terrain.water[i]).length;
  }

  private industryCentroid(): number {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const lot of this.state.lots.values()) {
      if (lot.use !== 'I') continue;
      sx += lot.x;
      sy += lot.y;
      n++;
    }
    if (n === 0) return -1;
    return Math.round(sy / n) * SIZE + Math.round(sx / n);
  }

  private buildHighwayTo(goal: number, within: number): boolean {
    const gx = goal % SIZE;
    const gy = (goal - gx) / SIZE;
    const sources = this.roads().filter((r) => roadTier(this.state.road[r]) === Tier.Highway);
    const path = findPath(sources, {
      isGoal: (i) => {
        const x = i % SIZE;
        return Math.hypot(x - gx, (i - x) / SIZE - gy) <= within && this.isLocalRoad(i);
      },
      heuristic: (i) => octile(i, goal) * 0.5,
      stepCost: this.pathCost(Tier.Highway, ROAD_SLOPE * 1.6),
      diagonal: true,
      turnPenalty: 1.2,
      maxExpanded: 250000,
    });
    if (!path) return false;
    // The last tile is a local road: keep it local so the spur ends in an interchange.
    this.buildPath(path.slice(0, -1), Tier.Highway, true);
    this.link(path[path.length - 2], path[path.length - 1], Tier.Street);
    this.highwayDist = this.computeHighwayDist();
    return true;
  }

  // ---------------------------------------------------------------- fields and demand

  private refreshCentres(): void {
    this.centreSizes = [...this.state.centres.values()].map((centre) => {
      const population = this.centrePop.get(centre.id) ?? 0;
      return { centre, population, radius: Math.min(32, growthRadius(population) + (this.reachBonus.get(centre.id) ?? 0)) };
    });
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        let best = 0;
        let bestD = Infinity;
        let inReach = 0;
        for (const c of this.centreSizes) {
          const d = Math.hypot(x - c.centre.x, y - c.centre.y);
          if (d - c.radius < bestD) {
            bestD = d - c.radius;
            best = c.centre.id;
          }
          if (d <= c.radius) inReach = 1;
        }
        this.nearestCentre[y * SIZE + x] = best;
        this.reach[y * SIZE + x] = inReach;
      }
    }
  }

  private countPopulation(): void {
    let pop = 0;
    let jc = 0;
    let ji = 0;
    const pending: Demand = { R: 0, C: 0, I: 0 };
    this.centrePop.clear();
    this.centreResidents.clear();
    for (const lot of this.state.lots.values()) {
      if (lot.use !== 'R' && lot.use !== 'C' && lot.use !== 'I') continue;
      const cap = lotCapacity(lot);
      if (!lot.building) pending[lot.use] += lotCapacity({ ...lot, building: { density: 1, variant: 0, builtTick: 0, abandonedTick: -1 } });
      if (lot.use === 'R') pop += cap;
      else if (lot.use === 'C') jc += cap;
      else ji += cap;
      this.centrePop.set(lot.centre, (this.centrePop.get(lot.centre) ?? 0) + (lot.use === 'R' ? cap : cap * 0.5));
      if (lot.use === 'R') this.centreResidents.set(lot.centre, (this.centreResidents.get(lot.centre) ?? 0) + cap);
    }
    this.population = pop;
    this.jobsC = jc;
    this.jobsI = ji;
    this.pendingCap = pending;
  }

  private recomputeFields(): void {
    this.refreshCentres();
    this.influence = centreInfluence(this.centreSizes, this.targetPopulation);
    this.pollution = computePollution(this.state);
    const amenity = computeAmenity(this.state);
    this.landValue = computeLandValue(
      { terrain: this.terrain, state: this.state, influence: this.influence, pollution: this.pollution },
      amenity,
    );
    this.traffic = computeTraffic(this.state, this.arterials, this.centrePop, this.population);
  }

  /** Target population over the Run: an S-curve that reaches the Ambition near the end. */
  targetAt(tick: number): number {
    const year = tick / TICKS_PER_YEAR;
    const s = 1 / (1 + Math.exp(-(year - 40) / 11));
    const s0 = 1 / (1 + Math.exp(40 / 11));
    return 60 + this.targetPopulation * 1.04 * ((s - s0) / (1 - s0));
  }

  private updateDemand(): void {
    const lean = this.charter.lean;
    const progress = this.tick / RUN_TICKS;
    const jobRatio = 0.5 + 0.12 * lean;
    const iShare = Math.max(0.12, Math.min(0.85, 0.55 + 0.25 * lean - 0.28 * progress));
    const jobs = this.jobsC + this.jobsI;
    const rTarget = Math.min(this.targetAt(this.tick), ((jobs + 140) / jobRatio) * 1.3);
    const jobsTarget = (this.population + 40) * jobRatio;
    this.deficit = {
      R: rTarget - (this.population + this.pendingCap.R),
      C: jobsTarget * (1 - iShare) - (this.jobsC + this.pendingCap.C),
      I: jobsTarget * iShare - (this.jobsI + this.pendingCap.I),
    };
    const norm = (d: number, scale: number) => Math.max(-1, Math.min(1, d / (scale * 0.15 + 60)));
    this.demand = {
      R: norm(this.deficit.R, rTarget),
      C: norm(this.deficit.C, jobsTarget * (1 - iShare)),
      I: norm(this.deficit.I, jobsTarget * iShare),
    };
  }

  // ---------------------------------------------------------------- growth

  private grow(): void {
    const frontage = this.frontage();
    const zones: Zone[] = (['R', 'C', 'I'] as Zone[]).sort((a, b) => this.deficit[b] - this.deficit[a]);
    let unmetThisTick = false;
    for (const zone of zones) {
      let remaining = this.deficit[zone];
      const unit = zone === 'R' ? 36 : zone === 'C' ? 24 : 40;
      let actions = Math.min(10, Math.ceil(remaining / unit));
      while (actions-- > 0 && remaining > 0) {
        const added = this.rng.chance(this.redevelopChance(zone, frontage.length))
          ? this.redevelop(zone) || this.zoneLot(zone, frontage)
          : this.zoneLot(zone, frontage) || this.redevelop(zone);
        if (added <= 0) {
          unmetThisTick = true;
          break;
        }
        remaining -= added;
      }
    }
    const wantLand = Math.max(0, this.deficit.R) / 25 + Math.max(0, this.deficit.C) / 30 + Math.max(0, this.deficit.I) / 30;
    if (frontage.length < 30 + wantLand) {
      const grew = this.growRoads(2 + Math.min(4, Math.floor(wantLand / 8)));
      if (!grew) {
        // Out of room: let every Centre reach a little further.
        for (const c of this.centreSizes) this.reachBonus.set(c.centre.id, Math.min(20, (this.reachBonus.get(c.centre.id) ?? 0) + 0.1));
        if (unmetThisTick) this.unmet++;
      }
    } else if (!unmetThisTick) {
      this.unmet = Math.max(0, this.unmet - 1);
    }
  }

  /** True when every Centre has spread as far as it can. */
  private reachSaturated(): boolean {
    return this.centreSizes.every((c) => c.radius >= 24);
  }

  /** How likely growth is to densify rather than spread: low early on, higher as land runs short. */
  private redevelopChance(zone: Zone, frontage: number): number {
    if (this.population < 800) return 0.05;
    const progress = Math.min(1, this.population / this.targetPopulation);
    const scarcity = frontage < 40 ? 0.3 : 0;
    return Math.min(0.85, (zone === 'I' ? 0.05 : 0.1) + 0.55 * progress + scarcity);
  }

  private zonable(i: number): boolean {
    return (
      !this.terrain.water[i] &&
      this.terrain.slope[i] <= GENTLE_SLOPE &&
      this.state.road[i] === 0 &&
      this.state.pocket[i] === 0 &&
      this.state.lotAt[i] === 0 &&
      this.reserved[i] === 0
    );
  }

  /** Bare tiles beside a Road (or a diagonal's Pocket park) that are in reach of a Centre. */
  private frontage(): number[] {
    this.stampId++;
    const out: number[] = [];
    const consider = (i: number) => {
      if (this.stamp[i] === this.stampId) return;
      this.stamp[i] = this.stampId;
      if (this.reach[i] && this.zonable(i)) out.push(i);
    };
    for (const r of this.roads()) {
      if (!this.isLocalRoad(r)) continue;
      const x = r % SIZE;
      const y = (r - x) / SIZE;
      for (const d of ORTHO) {
        const nx = x + DIRS[d][0];
        const ny = y + DIRS[d][1];
        if (nx < 1 || ny < 1 || nx >= SIZE - 1 || ny >= SIZE - 1) continue;
        const n = ny * SIZE + nx;
        if (this.state.pocket[n]) {
          for (const d2 of ORTHO) {
            const px = nx + DIRS[d2][0];
            const py = ny + DIRS[d2][1];
            if (px >= 1 && py >= 1 && px < SIZE - 1 && py < SIZE - 1) consider(py * SIZE + px);
          }
        } else consider(n);
      }
    }
    return out;
  }

  /** Direction from a tile towards the Road or Pocket park it fronts. */
  private accessDir(i: number): number {
    const x = i % SIZE;
    const y = (i - x) / SIZE;
    for (const d of ORTHO) {
      const n = (y + DIRS[d][1]) * SIZE + x + DIRS[d][0];
      if (this.isLocalRoad(n)) return d;
    }
    for (const d of ORTHO) {
      const n = (y + DIRS[d][1]) * SIZE + x + DIRS[d][0];
      if (this.state.pocket[n]) return d;
    }
    return -1;
  }

  /** Finds a free rectangle `width` along the Road and `depth` away from it, containing tile i. */
  private fitLot(i: number, width: number, depth: number): [number, number, number, number] | null {
    const access = this.accessDir(i);
    if (access < 0) return null;
    const x = i % SIZE;
    const y = (i - x) / SIZE;
    const offsets = Array.from({ length: width }, (_, k) => k);
    const shift = this.rng.int(width);
    for (let k = 0; k < width; k++) {
      const off = offsets[(k + shift) % width];
      let rx: number;
      let ry: number;
      let rw: number;
      let rh: number;
      if (access === 0 || access === 4) {
        rw = width;
        rh = depth;
        rx = x - off;
        ry = access === 0 ? y : y - depth + 1;
      } else {
        rw = depth;
        rh = width;
        ry = y - off;
        rx = access === 6 ? x : x - depth + 1;
      }
      if (this.rectFree(rx, ry, rw, rh)) return [rx, ry, rw, rh];
    }
    return null;
  }

  private rectFree(x: number, y: number, w: number, h: number): boolean {
    if (x < 1 || y < 1 || x + w > SIZE - 1 || y + h > SIZE - 1) return false;
    let lo = Infinity;
    let hi = -Infinity;
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        const t = ty * SIZE + tx;
        if (!this.zonable(t)) return false;
        const hgt = this.terrain.height[t];
        lo = Math.min(lo, hgt);
        hi = Math.max(hi, hgt);
      }
    }
    return hi - lo <= 1.2;
  }

  private zoneScore(zone: Zone, i: number): number {
    const lv = this.landValue[i];
    const noise = this.rng.next() * 0.25;
    switch (zone) {
      case 'R':
        return lv - this.pollution[i] * 0.6 + noise;
      case 'C': {
        let traffic = 0;
        const x = i % SIZE;
        const y = (i - x) / SIZE;
        for (const d of ORTHO) traffic = Math.max(traffic, this.traffic[(y + DIRS[d][1]) * SIZE + x + DIRS[d][0]] ?? 0);
        return lv * 0.7 + traffic * 0.7 + this.influence[i] * 0.4 + noise;
      }
      case 'I': {
        const port = this.charter.lean > 0 && this.terrain.waterDist[i] <= 3 ? 0.2 * this.charter.lean : 0;
        return (
          0.6 * (1 - this.influence[i]) +
          0.4 * Math.exp(-this.highwayDist[i] / 8) +
          0.3 * (1 - this.terrain.slope[i] / GENTLE_SLOPE) -
          0.3 * lv +
          port +
          noise
        );
      }
    }
  }

  private lotSize(zone: Zone, i: number): [number, number] {
    const lv = this.landValue[i];
    const r = this.rng;
    switch (zone) {
      case 'R':
        return [1 + r.int(2), lv > 0.45 && r.chance(0.5) ? 2 : 1 + r.int(2)];
      case 'C':
        return [1 + r.int(3), 1 + r.int(2)];
      case 'I':
        return [2 + r.int(3), 2 + r.int(3)];
    }
  }

  /** Zones a new Lot for `zone`. Returns the capacity it will add, or 0. */
  private zoneLot(zone: Zone, frontage: number[]): number {
    if (frontage.length === 0) return 0;
    let best = -1;
    let bestScore = -Infinity;
    const samples = Math.min(frontage.length, 40);
    for (let s = 0; s < samples; s++) {
      const i = frontage[this.rng.int(frontage.length)];
      if (this.state.lotAt[i] || !this.zonable(i)) continue;
      const score = this.zoneScore(zone, i);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) return 0;
    let [w, d] = this.lotSize(zone, best);
    while (w >= 1 && d >= 1) {
      const rect = this.fitLot(best, w, d);
      if (rect) {
        const lot = this.addLot(rect[0], rect[1], rect[2], rect[3], zone, null);
        return lotCapacity({ ...lot, building: { density: 1, variant: 0, builtTick: 0, abandonedTick: -1 } });
      }
      if (w >= d) w--;
      else d--;
    }
    return 0;
  }

  private lotLandValue(lot: Lot): number {
    let sum = 0;
    for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) sum += this.landValue[y * SIZE + x];
    return sum / (lot.w * lot.h);
  }

  /** True when the City keeps running out of land, so it builds taller instead (think Hong Kong). */
  private get crowded(): boolean {
    const canFound = this.state.centres.size < MAX_CENTRES[this.charter.ambition] && !this.noSite;
    return this.unmet >= 10 && this.reachSaturated() && !canFound;
  }

  private allowedDensity(lot: Lot): Density {
    const lv = this.lotLandValue(lot) + (this.crowded ? 0.1 : 0);
    const pop = this.population;
    const centrePop = this.centrePop.get(lot.centre) ?? 0;
    switch (lot.use) {
      case 'R':
        if (lv >= 0.6 && pop >= 8000 && centrePop >= 3000) return 3;
        return lv >= 0.42 && pop >= 1500 ? 2 : 1;
      case 'C':
        if (lv >= 0.56 && pop >= 5000 && centrePop >= 2500) return 3;
        return lv >= 0.36 && pop >= 900 ? 2 : 1;
      case 'I':
        if (lv >= 0.36 && pop >= 12000) return 3;
        return lv >= 0.22 && pop >= 2500 ? 2 : 1;
      default:
        return 1;
    }
  }

  private construct(): void {
    for (const lot of this.state.lots.values()) {
      if (lot.building || (lot.use !== 'R' && lot.use !== 'C' && lot.use !== 'I')) continue;
      if (this.tick - lot.zonedTick < 1 + (hashInts(lot.id) % 4)) continue;
      const density = Math.min(2, this.allowedDensity(lot)) as Density;
      const starting: Density = lot.w * lot.h >= 2 && density === 2 && this.rng.chance(0.4) ? 2 : 1;
      this.replaceLot(lot, { ...lot, building: this.newBuilding(starting) });
      this.densityMilestones(lot, starting);
    }
  }

  private newBuilding(density: Density, civic?: CivicKind): Building {
    const b: Building = { density, variant: this.rng.int(1 << 30), builtTick: this.tick, abandonedTick: -1 };
    if (civic) b.civic = civic;
    return b;
  }

  private densityMilestones(lot: Lot, density: Density): void {
    if (lot.use === 'I') return;
    const cx = lot.x + lot.w / 2;
    const cy = lot.y + lot.h / 2;
    if (density >= 2) this.milestone('midrise', 'First mid-rise', cx, cy);
    if (density >= 3) this.milestone('tower', 'First tower', cx, cy);
  }

  /** Rebuilds a Lot one Density step higher, sometimes merging a neighbour first. */
  private redevelop(zone: Zone): number {
    const candidates: Lot[] = [];
    for (const lot of this.state.lots.values()) {
      if (lot.use !== zone || !lot.building || lot.building.abandonedTick >= 0) continue;
      if (this.tick - lot.building.builtTick < 30) continue;
      candidates.push(lot);
    }
    if (candidates.length === 0) return 0;
    let best: Lot | null = null;
    let bestScore = -Infinity;
    for (let s = 0; s < Math.min(40, candidates.length); s++) {
      const lot = candidates[this.rng.int(candidates.length)];
      if (this.allowedDensity(lot) <= lot.building!.density) continue;
      const score = this.lotLandValue(lot) + this.rng.next() * 0.2;
      if (score > bestScore) {
        bestScore = score;
        best = lot;
      }
    }
    if (!best) return 0;
    const before = lotCapacity(best);
    const density = (best.building!.density + 1) as Density;
    let rect = { x: best.x, y: best.y, w: best.w, h: best.h };
    if (this.rng.chance(0.6)) {
      const neighbour = this.mergeCandidate(best, density);
      if (neighbour) {
        rect = {
          x: Math.min(best.x, neighbour.x),
          y: Math.min(best.y, neighbour.y),
          w: Math.max(best.x + best.w, neighbour.x + neighbour.w) - Math.min(best.x, neighbour.x),
          h: Math.max(best.y + best.h, neighbour.y + neighbour.h) - Math.min(best.y, neighbour.y),
        };
        this.replaceLot(neighbour, null);
        this.misfit.delete(neighbour.id);
      }
    }
    const next: Lot = { ...best, ...rect, building: this.newBuilding(density) };
    this.replaceLot(best, next);
    this.densityMilestones(next, density);
    return lotCapacity(next) - before;
  }

  /** A same-use neighbour that shares a whole edge, so the two can merge into a rectangle of at most 4×4. */
  private mergeCandidate(lot: Lot, density: Density): Lot | null {
    const seen = new Set<number>();
    const options: Lot[] = [];
    const probe = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
      const id = this.state.lotAt[y * SIZE + x];
      if (!id || id === lot.id || seen.has(id)) return;
      seen.add(id);
      const n = this.state.lots.get(id)!;
      if (n.use !== lot.use) return;
      if (n.building && (n.building.abandonedTick >= 0 || n.building.density > density)) return;
      const horizontal = n.y === lot.y && n.h === lot.h && (n.x === lot.x + lot.w || n.x + n.w === lot.x);
      const vertical = n.x === lot.x && n.w === lot.w && (n.y === lot.y + lot.h || n.y + n.h === lot.y);
      if (horizontal && lot.w + n.w <= 4) options.push(n);
      if (vertical && lot.h + n.h <= 4) options.push(n);
    };
    for (let x = lot.x; x < lot.x + lot.w; x++) {
      probe(x, lot.y - 1);
      probe(x, lot.y + lot.h);
    }
    for (let y = lot.y; y < lot.y + lot.h; y++) {
      probe(lot.x - 1, y);
      probe(lot.x + lot.w, y);
    }
    return options.length ? this.rng.pick(options) : null;
  }

  // ---------------------------------------------------------------- churn and Promotion

  /** Abandonment of Buildings whose Zone type no longer fits, and demolition of long-empty ones. */
  private churn(): void {
    let abandoned = 0;
    for (const lot of [...this.state.lots.values()]) {
      const b = lot.building;
      if (!b || (lot.use !== 'R' && lot.use !== 'C' && lot.use !== 'I')) continue;
      if (b.abandonedTick >= 0) {
        if (this.tick - b.abandonedTick >= 15 + (hashInts(lot.id, 3) % 15)) {
          this.replaceLot(lot, null);
          this.misfit.delete(lot.id);
        }
        continue;
      }
      const i = (lot.y + (lot.h >> 1)) * SIZE + lot.x + (lot.w >> 1);
      const lv = this.lotLandValue(lot);
      let misfit = false;
      if (lot.use === 'R') misfit = this.pollution[i] > 0.55 || (this.demand.R < -0.4 && lv < 0.35);
      else if (lot.use === 'C') misfit = this.demand.C < -0.4 && lv < 0.42;
      else misfit = (lv > 0.6 && this.population > 3000 && b.density < 3) || this.demand.I < -0.45;
      const streak = misfit ? (this.misfit.get(lot.id) ?? 0) + 1 : Math.max(0, (this.misfit.get(lot.id) ?? 0) - 1);
      this.misfit.set(lot.id, streak);
      if (streak >= 6 && abandoned < 3 && this.tick - b.builtTick > 48 && this.rng.chance(0.2)) {
        this.replaceLot(lot, { ...lot, building: { ...b, abandonedTick: this.tick } });
        this.misfit.set(lot.id, 0);
        abandoned++;
      }
    }
  }

  private promoteRoads(): void {
    for (const i of this.roads()) {
      const packed = this.state.road[i];
      const tier = roadTier(packed);
      if (tier !== Tier.Dirt && tier !== Tier.Street) continue;
      const threshold = tier === Tier.Dirt ? 0.12 : this.population >= 2500 ? 0.5 : Infinity;
      const t = this.traffic[i];
      this.promoteStreak[i] = t >= threshold ? Math.min(255, this.promoteStreak[i] + 1) : Math.max(0, this.promoteStreak[i] - 1);
      if (this.promoteStreak[i] >= (tier === Tier.Dirt ? 3 : 6)) {
        this.record({ k: 'road', i, from: packed, to: packRoad(tier + 1, roadConn(packed)), promotion: true });
        this.promoteStreak[i] = 0;
        if (tier + 1 === Tier.Avenue) this.milestone('avenue', 'First avenue', i % SIZE, (i / SIZE) | 0);
      }
    }
  }

  // ---------------------------------------------------------------- Parks and Civic buildings

  private addCivic(): void {
    for (const c of this.centreSizes) {
      const step = this.civicProgress.get(c.centre.id) ?? 0;
      const next = CIVIC_PLAN[step];
      if (!next || c.population < next.pop) continue;
      const lot = this.placeNear(c, next.w, next.d, next.use === 'park' ? 'park' : 'civic', next.kind);
      if (lot || this.rng.chance(0.1)) this.civicProgress.set(c.centre.id, step + 1);
      if (lot && next.kind === 'townhall') this.milestone('townhall', `${c.centre.name} town hall opens`, c.centre.x, c.centre.y, `townhall:${c.centre.id}`);
      if (lot && next.kind === 'landmark') this.milestone('landmark', `${c.centre.name} clock tower`, lot.x, lot.y, `landmark:${c.centre.id}`);
    }
  }

  private placeNear(c: CentreSize, w: number, d: number, use: 'park' | 'civic', kind?: CivicKind): Lot | null {
    const candidates = this.frontage()
      .filter((i) => this.nearestCentre[i] === c.centre.id)
      .map((i) => {
        const x = i % SIZE;
        const dist = Math.hypot(x - c.centre.x, (i - x) / SIZE - c.centre.y);
        const water = use === 'park' && this.terrain.waterDist[i] <= 3 ? 4 : 0;
        return { i, score: dist - water + this.rng.next() * 3 };
      })
      .sort((a, b) => a.score - b.score);
    for (const { i } of candidates.slice(0, 60)) {
      const rect = this.fitLot(i, w, d) ?? this.fitLot(i, d, w);
      if (!rect) continue;
      const building = use === 'civic' ? this.newBuilding(1, kind) : null;
      return this.addLot(rect[0], rect[1], rect[2], rect[3], use, building);
    }
    return null;
  }

  private maybeAddWatersidePark(): void {
    if (this.population < 600 || !this.rng.chance(0.5)) return;
    const options = this.frontage().filter((i) => this.terrain.waterDist[i] <= 2);
    for (let tries = 0; tries < 8 && options.length; tries++) {
      const i = options[this.rng.int(options.length)];
      const rect = this.fitLot(i, 2 + this.rng.int(2), 2);
      if (rect) {
        this.addLot(rect[0], rect[1], rect[2], rect[3], 'park', null);
        return;
      }
    }
  }

  private checkPopulationMilestones(): void {
    for (const p of POPULATION_MILESTONES) {
      if (this.population >= p) {
        const home = [...this.state.centres.values()][0];
        this.milestone('population', `Population ${p.toLocaleString('en-US')}`, home?.x ?? SIZE / 2, home?.y ?? SIZE / 2, `pop:${p}`);
      }
    }
  }

  // ---------------------------------------------------------------- inspection (tests and tools)

  /** Current Land value of a tile, 0..1. */
  landValueAt(i: number): number {
    return this.landValue[i];
  }

  /** Smoothed land value field, used for debugging overlays. */
  blurredLandValue(): Float32Array {
    return boxBlur(this.landValue, 1);
  }
}
