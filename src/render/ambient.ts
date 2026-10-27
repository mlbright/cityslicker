import * as THREE from 'three';
import { Rng } from '../sim/rng';
import { CityState, DIRS, roadConn, roadTier, Tier, type Lot } from '../sim/state';
import { heightAt, SIZE, type Terrain } from '../sim/terrain';
import { partGeometries } from './geometries';
import { PartPool } from './partPool';
import type { RoadsMesh } from './roadsMesh';

const CAR_COLORS = ['#ff8fa3', '#7ec8f2', '#ffd166', '#8fd3b6', '#c3a6f0', '#ffffff', '#ff9f68', '#6c8ee8'].map((c) => new THREE.Color(c));
const SHIRTS = ['#ff8fa3', '#7ec8f2', '#ffd166', '#8fd3b6', '#c3a6f0', '#ff9f68'].map((c) => new THREE.Color(c));
const SKIN = ['#f6d3b3', '#e0ac85', '#b9825d', '#8d5a3b', '#ffe0c7'].map((c) => new THREE.Color(c));
const CABIN = new THREE.Color('#e9f3fb');
const HEADLIGHT = new THREE.Color('#fff4c2');

interface Car {
  from: number;
  to: number;
  t: number;
  speed: number;
  life: number;
  body: number;
  cabin: number;
  light: number;
  color: THREE.Color;
}

interface Person {
  lot: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  life: number;
  phase: number;
  body: number;
  head: number;
}

/** Cars, people: Ambient life that animates the City on the real-time clock and never affects growth. */
export class AmbientLife {
  readonly group = new THREE.Group();
  private readonly bodies: PartPool;
  private readonly cabins: PartPool;
  private readonly lights: PartPool;
  private readonly torsos: PartPool;
  private readonly heads: PartPool;
  readonly headlightMaterial = new THREE.MeshStandardMaterial({ color: '#fff7d6', emissive: '#fff1b0', emissiveIntensity: 0 });
  private cars: Car[] = [];
  private people: Person[] = [];
  private roadTiles: number[] = [];
  private weights: number[] = [];
  private lastRoadVersion = -1;
  private readonly rng = new Rng(1, 'ambient');
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private time = 0;

  constructor(private readonly terrain: Terrain, private readonly roads: RoadsMesh) {
    const g = partGeometries();
    const solid = new THREE.MeshStandardMaterial({ roughness: 0.6, flatShading: true });
    this.bodies = new PartPool(this.group, g.box, solid, 256);
    this.cabins = new PartPool(this.group, g.box, solid, 256, false);
    this.lights = new PartPool(this.group, g.box, this.headlightMaterial, 256, false);
    this.torsos = new PartPool(this.group, g.cyl, solid, 128, false);
    this.heads = new PartPool(this.group, g.ball, solid, 128, false);
  }

  setNight(night: number): void {
    this.headlightMaterial.emissiveIntensity = night * 2;
  }

  update(dt: number, state: CityState, traffic: Uint8Array | null, population: number): void {
    this.time += dt;
    if (this.roads.version !== this.lastRoadVersion) this.refreshRoads(state, traffic);
    this.updateCars(dt, state, traffic);
    this.updatePeople(dt, state, population);
  }

  private refreshRoads(state: CityState, traffic: Uint8Array | null): void {
    this.lastRoadVersion = this.roads.version;
    this.roadTiles = [];
    this.weights = [];
    for (let i = 0; i < state.road.length; i++) {
      if (!state.road[i] || !roadConn(state.road[i])) continue;
      this.roadTiles.push(i);
      this.weights.push(0.02 + (traffic ? traffic[i] / 255 : 0));
    }
  }

  // ---------------------------------------------------------------- cars

  private updateCars(dt: number, state: CityState, traffic: Uint8Array | null): void {
    if (traffic && this.time % 3 < dt) this.refreshRoads(state, traffic);
    let load = 0;
    for (const w of this.weights) load += w;
    const target = Math.min(700, Math.round(load * 0.55));
    if (this.cars.length < target) {
      for (let k = 0; k < Math.min(6, target - this.cars.length); k++) this.spawnCar(state);
    }
    for (let k = this.cars.length - 1; k >= 0; k--) {
      const car = this.cars[k];
      car.life -= dt;
      const valid = state.road[car.from] && state.road[car.to];
      if (!valid || car.life <= 0 || (this.cars.length > target + 4 && this.rng.chance(dt * 0.5))) {
        this.removeCar(k);
        continue;
      }
      const diag = car.from % SIZE !== car.to % SIZE && Math.floor(car.from / SIZE) !== Math.floor(car.to / SIZE);
      car.t += (car.speed * dt) / (diag ? 1.414 : 1);
      if (car.t >= 1) {
        const next = this.nextTile(state, car.from, car.to);
        if (next < 0) {
          this.removeCar(k);
          continue;
        }
        car.from = car.to;
        car.to = next;
        car.t -= 1;
        car.speed = roadTier(state.road[car.from]) === Tier.Highway ? 2.4 : 1.2;
      }
      this.placeCar(car);
    }
  }

  private spawnCar(state: CityState): void {
    if (this.roadTiles.length === 0) return;
    const k = this.rng.weighted(this.weights);
    if (k < 0) return;
    const from = this.roadTiles[k];
    const to = this.nextTile(state, -1, from);
    if (to < 0) return;
    const color = this.rng.pick(CAR_COLORS);
    const car: Car = {
      from,
      to,
      t: this.rng.next(),
      speed: roadTier(state.road[from]) === Tier.Highway ? 2.4 : 1.2,
      life: this.rng.range(15, 40),
      body: this.bodies.alloc(),
      cabin: this.cabins.alloc(),
      light: this.lights.alloc(),
      color,
    };
    this.bodies.setColor(car.body, color);
    this.cabins.setColor(car.cabin, CABIN);
    this.lights.setColor(car.light, HEADLIGHT);
    this.cars.push(car);
  }

  private removeCar(k: number): void {
    const car = this.cars[k];
    this.bodies.release(car.body);
    this.cabins.release(car.cabin);
    this.lights.release(car.light);
    this.cars[k] = this.cars[this.cars.length - 1];
    this.cars.pop();
  }

  /** A connected neighbour of `at`, avoiding a U-turn unless it's a dead end. */
  private nextTile(state: CityState, prev: number, at: number): number {
    const conn = roadConn(state.road[at]);
    const x = at % SIZE;
    const y = (at - x) / SIZE;
    const options: number[] = [];
    for (let d = 0; d < 8; d++) {
      if (!(conn & (1 << d))) continue;
      const n = (y + DIRS[d][1]) * SIZE + x + DIRS[d][0];
      if (n !== prev && state.road[n]) options.push(n);
    }
    if (options.length === 0) return prev >= 0 && state.road[prev] ? prev : -1;
    return this.rng.pick(options);
  }

  private placeCar(car: Car): void {
    const fx = (car.from % SIZE) + 0.5;
    const fz = Math.floor(car.from / SIZE) + 0.5;
    const tx = (car.to % SIZE) + 0.5;
    const tz = Math.floor(car.to / SIZE) + 0.5;
    const dx = tx - fx;
    const dz = tz - fz;
    const len = Math.hypot(dx, dz);
    const nx = dx / len;
    const nz = dz / len;
    // Drive on the right.
    const lane = roadTier(this.roads.tierAt(car.from)) === Tier.Highway ? 0.2 : 0.12;
    const px = fx + dx * car.t - nz * lane;
    const pz = fz + dz * car.t + nx * lane;
    const h0 = this.roads.deckAt(car.from);
    const h1 = this.roads.deckAt(car.to);
    const py = h0 + (h1 - h0) * car.t + 0.005;
    this.q.setFromAxisAngle(this.up, Math.atan2(nx, nz));
    this.m.compose(this.v.set(px, py, pz), this.q, this.s.set(0.13, 0.08, 0.26));
    this.bodies.setMatrix(car.body, this.m);
    this.m.compose(this.v.set(px - nx * 0.02, py + 0.08, pz - nz * 0.02), this.q, this.s.set(0.11, 0.06, 0.13));
    this.cabins.setMatrix(car.cabin, this.m);
    this.m.compose(this.v.set(px + nx * 0.13, py + 0.03, pz + nz * 0.13), this.q, this.s.set(0.11, 0.03, 0.01));
    this.lights.setMatrix(car.light, this.m);
  }

  // ---------------------------------------------------------------- people

  private updatePeople(dt: number, state: CityState, population: number): void {
    const target = Math.min(260, Math.round(population / 120));
    if (this.people.length < target) {
      const lots = [...state.lots.values()].filter((l) => l.use === 'park' || l.use === 'C' || l.use === 'civic');
      for (let k = 0; k < Math.min(4, target - this.people.length) && lots.length; k++) this.spawnPerson(this.rng.pick(lots));
    }
    for (let k = this.people.length - 1; k >= 0; k--) {
      const p = this.people[k];
      p.life -= dt;
      const lot = state.lots.get(p.lot);
      if (!lot || p.life <= 0 || (this.people.length > target + 4 && this.rng.chance(dt * 0.5))) {
        this.removePerson(k);
        continue;
      }
      if (this.rng.chance(dt * 0.6)) p.heading += this.rng.range(-1.5, 1.5);
      let x = p.x + Math.sin(p.heading) * p.speed * dt;
      let z = p.z + Math.cos(p.heading) * p.speed * dt;
      // Stay on the Lot, along its edges where the pavement is.
      if (x < lot.x - 0.1 || x > lot.x + lot.w + 0.1 || z < lot.y - 0.1 || z > lot.y + lot.h + 0.1) {
        p.heading += Math.PI;
        x = p.x;
        z = p.z;
      }
      p.x = x;
      p.z = z;
      const bob = Math.abs(Math.sin(this.time * 9 + p.phase)) * 0.02;
      const base = Math.max(0, heightAt(this.terrain, x, z)) + bob;
      this.m.compose(this.v.set(x, base, z), this.q.identity(), this.s.set(0.05, 0.08, 0.05));
      this.torsos.setMatrix(p.body, this.m);
      this.m.compose(this.v.set(x, base + 0.075, z), this.q, this.s.set(0.05, 0.05, 0.05));
      this.heads.setMatrix(p.head, this.m);
    }
  }

  private spawnPerson(lot: Lot): void {
    const edge = this.rng.int(4);
    const along = this.rng.next();
    const x = edge === 1 ? lot.x + lot.w : edge === 3 ? lot.x : lot.x + along * lot.w;
    const z = edge === 0 ? lot.y : edge === 2 ? lot.y + lot.h : lot.y + along * lot.h;
    const person: Person = {
      lot: lot.id,
      x,
      z,
      heading: this.rng.range(0, Math.PI * 2),
      speed: this.rng.range(0.12, 0.25),
      life: this.rng.range(10, 30),
      phase: this.rng.range(0, 6),
      body: this.torsos.alloc(),
      head: this.heads.alloc(),
    };
    this.torsos.setColor(person.body, this.rng.pick(SHIRTS));
    this.heads.setColor(person.head, this.rng.pick(SKIN));
    this.people.push(person);
  }

  private removePerson(k: number): void {
    const p = this.people[k];
    this.torsos.release(p.body);
    this.heads.release(p.head);
    this.people[k] = this.people[this.people.length - 1];
    this.people.pop();
  }
}
