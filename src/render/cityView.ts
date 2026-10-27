import * as THREE from 'three';
import { CityState, N_TILES } from '../sim/state';
import type { Terrain } from '../sim/terrain';
import { AmbientLife } from './ambient';
import { BuildingsLayer } from './buildingsLayer';
import { PALETTE } from './palette';
import { RoadsMesh } from './roadsMesh';
import { TerrainMesh } from './terrainMesh';
import { Trees } from './trees';

const USE_CODE: Record<string, number> = { R: 2, C: 3, I: 4, park: 5, civic: 6 };
const TINTS: Record<number, [THREE.Color, number]> = {
  1: [PALETTE.pocketPark, 0.85],
  2: [PALETTE.zoneR, 0.55],
  3: [PALETTE.zoneC, 0.55],
  4: [PALETTE.zoneI, 0.6],
  5: [PALETTE.pocketPark, 0.9],
  6: [new THREE.Color('#e8e1d3'), 0.7],
};

/** Everything that draws the City: ground, Roads and Buildings. */
export class CityView {
  readonly group = new THREE.Group();
  readonly terrainMesh: TerrainMesh;
  readonly roads: RoadsMesh;
  readonly buildings: BuildingsLayer;
  readonly trees: Trees;
  readonly ambient: AmbientLife;
  private readonly tintKey = new Uint8Array(N_TILES);

  constructor(readonly terrain: Terrain, seed: number) {
    this.terrainMesh = new TerrainMesh(terrain);
    this.roads = new RoadsMesh(terrain);
    this.buildings = new BuildingsLayer(terrain);
    this.trees = new Trees(terrain, seed);
    this.ambient = new AmbientLife(terrain, this.roads);
    this.group.add(this.terrainMesh.group, this.roads.group, this.buildings.group, this.trees.group, this.ambient.group);
  }

  sync(state: CityState, animate: boolean, now: number): void {
    this.roads.sync(state);
    this.buildings.sync(state, animate, now);
    let tinted = false;
    for (let i = 0; i < N_TILES; i++) {
      const lotId = state.lotAt[i];
      const key = state.pocket[i] ? 1 : lotId ? USE_CODE[state.lots.get(lotId)!.use] : state.road[i] ? 7 : 0;
      if (key === this.tintKey[i]) continue;
      this.tintKey[i] = key;
      this.trees.setTile(i, key);
      const tint = TINTS[key];
      this.terrainMesh.tint(i, tint ? tint[0] : null, tint ? tint[1] : 1);
      tinted = true;
    }
    if (tinted) this.terrainMesh.commit();
  }

  update(now: number, dt: number, state: CityState, traffic: Uint8Array | null, population: number, night: number): void {
    this.buildings.update(now);
    this.buildings.setNight(night);
    this.ambient.setNight(night);
    this.ambient.update(dt, state, traffic, population);
  }
}
