import * as THREE from 'three';
import { CityState, roadTier, Tier, type Lot } from '../sim/state';
import { CORNERS, SIZE, type Terrain } from '../sim/terrain';
import { buildingParts, type PartSpec } from './buildingKit';
import { partGeometries, type PartKind } from './geometries';
import { PALETTE } from './palette';
import { PartPool } from './partPool';

const GROW_SECONDS = 0.55;
const SHRINK_SECONDS = 0.4;

interface Placed {
  pool: PartPool;
  slot: number;
  base: THREE.Matrix4;
}

interface Entry {
  lot: Lot;
  parts: Placed[];
  anchor: THREE.Vector3;
  anim: 'grow' | 'shrink' | null;
  start: number;
}

/** Turns Lots into instanced parts, with a bounce when a Building appears and a sink when it goes. */
export class BuildingsLayer {
  readonly group = new THREE.Group();
  private readonly pools: Record<PartKind, PartPool>;
  private readonly entries = new Map<number, Entry>();
  private readonly dying: Entry[] = [];
  private readonly animating = new Set<Entry>();
  private readonly terrain: Terrain;
  /** Which Lot owns each instance slot, per pool, for picking. */
  private readonly owners = new Map<PartPool, Map<number, number>>();
  private readonly tmp = new THREE.Matrix4();
  private readonly tmp2 = new THREE.Matrix4();

  /** Called for each Lot that appears or disappears with animation (used for sound and the Auto camera). */
  onEvent: ((kind: 'built' | 'removed', lot: Lot) => void) | null = null;

  /** Lit windows glow at night; this material's emissive intensity follows the day/night cycle. */
  readonly windowMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: '#ffcf73',
    emissiveIntensity: 0,
    roughness: 0.3,
  });

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    const geoms = partGeometries();
    const solid = new THREE.MeshStandardMaterial({ roughness: 0.82, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ roughness: 0.4 });
    this.pools = Object.fromEntries(
      (Object.entries(geoms) as [PartKind, THREE.BufferGeometry][]).map(([kind, g]) => {
        const material = kind === 'window' ? this.windowMaterial : kind === 'windowDark' ? dark : solid;
        return [kind, new PartPool(this.group, g, material, 256, !kind.startsWith('window'))];
      }),
    ) as Record<PartKind, PartPool>;
  }

  /** 0 by day, 1 at night. */
  setNight(night: number): void {
    this.windowMaterial.emissiveIntensity = night * 1.35;
  }

  /** Brings the rendered Buildings in line with the state. */
  sync(state: CityState, animate: boolean, now: number): void {
    const replaced = new Map<number, Lot>();
    for (const [id, entry] of this.entries) {
      const lot = state.lots.get(id);
      if (lot === entry.lot) continue;
      this.entries.delete(id);
      replaced.set(id, entry.lot);
      const moved = !lot || lot.x !== entry.lot.x || lot.y !== entry.lot.y || lot.w !== entry.lot.w || lot.h !== entry.lot.h;
      const gone = !lot?.building;
      if (animate && entry.lot.building && (moved || gone)) this.startShrink(entry, now);
      else this.free(entry);
    }
    for (const [id, lot] of state.lots) {
      if (this.entries.has(id)) continue;
      const entry = this.place(lot, state);
      this.entries.set(id, entry);
      const prev = replaced.get(id)?.building;
      const b = lot.building;
      const fresh = lot.use === 'park' ? !replaced.has(id) : b !== null && b.abandonedTick < 0 && (!prev || prev.builtTick !== b.builtTick || prev.density !== b.density);
      if (animate && fresh) {
        entry.anim = 'grow';
        entry.start = now;
        this.animating.add(entry);
        this.applyScale(entry, 0.01);
        this.onEvent?.('built', lot);
      }
    }
  }

  /** Advances bounce and sink animations. */
  update(now: number): void {
    for (const entry of this.animating) {
      if (entry.anim === 'grow') {
        const t = Math.min(1, (now - entry.start) / GROW_SECONDS);
        this.applyScale(entry, easeOutBack(t));
        if (t >= 1) {
          entry.anim = null;
          this.animating.delete(entry);
        }
      }
    }
    for (let k = this.dying.length - 1; k >= 0; k--) {
      const entry = this.dying[k];
      const t = Math.min(1, (now - entry.start) / SHRINK_SECONDS);
      this.applyScale(entry, 1 - t * t);
      if (t >= 1) {
        this.free(entry);
        this.dying.splice(k, 1);
      }
    }
  }

  /** Drops every rendered Building (used before a full rebuild). */
  reset(): void {
    for (const entry of this.entries.values()) this.free(entry);
    for (const entry of this.dying) this.free(entry);
    this.entries.clear();
    this.dying.length = 0;
    this.animating.clear();
  }

  private startShrink(entry: Entry, now: number): void {
    this.animating.delete(entry);
    entry.anim = 'shrink';
    entry.start = now;
    this.dying.push(entry);
    this.onEvent?.('removed', entry.lot);
  }

  private free(entry: Entry): void {
    this.animating.delete(entry);
    for (const p of entry.parts) {
      p.pool.release(p.slot);
      this.owners.get(p.pool)?.delete(p.slot);
    }
    entry.parts = [];
  }

  /** The Lot under a ray, if it hits a Building, Park or prop. */
  pick(raycaster: THREE.Raycaster): { lotId: number; distance: number } | null {
    let best: { lotId: number; distance: number } | null = null;
    for (const [kind, pool] of Object.entries(this.pools)) {
      if (kind.startsWith('window')) continue;
      const hits = raycaster.intersectObject(pool.mesh, false);
      for (const hit of hits) {
        if (hit.instanceId === undefined) continue;
        const lotId = this.owners.get(pool)?.get(hit.instanceId);
        if (lotId === undefined) continue;
        if (!best || hit.distance < best.distance) best = { lotId, distance: hit.distance };
        break;
      }
    }
    return best;
  }

  private place(lot: Lot, state: CityState): Entry {
    const { base, low } = this.groundOf(lot);
    const anchor = new THREE.Vector3(lot.x, base, lot.y);
    const specs: PartSpec[] = buildingParts(lot, frontOf(lot, state));
    if (lot.building && base - low > 0.12) {
      // A Terrace: a little retaining wall levelling the slope.
      specs.unshift({
        kind: 'box', x: lot.w / 2, y: low - base - 0.05, z: lot.h / 2,
        sx: lot.w - 0.06, sy: base - low + 0.05, sz: lot.h - 0.06, rot: 0, color: PALETTE.terrace.clone(),
      });
    }
    const parts: Placed[] = specs.map((spec) => {
      const pool = this.pools[spec.kind];
      const slot = pool.alloc();
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(anchor.x + spec.x, anchor.y + spec.y, anchor.z + spec.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spec.rot),
        new THREE.Vector3(spec.sx, spec.sy, spec.sz),
      );
      pool.set(slot, m, spec.color);
      let owners = this.owners.get(pool);
      if (!owners) this.owners.set(pool, (owners = new Map()));
      owners.set(slot, lot.id);
      return { pool, slot, base: m };
    });
    return { lot, parts, anchor, anim: null, start: 0 };
  }

  private applyScale(entry: Entry, s: number): void {
    const a = entry.anchor;
    const side = 0.6 + 0.4 * Math.min(1, s);
    this.tmp.makeTranslation(a.x + entry.lot.w / 2, a.y, a.z + entry.lot.h / 2);
    this.tmp.multiply(this.tmp2.makeScale(side, Math.max(0.001, s), side));
    this.tmp.multiply(this.tmp2.makeTranslation(-(a.x + entry.lot.w / 2), -a.y, -(a.z + entry.lot.h / 2)));
    for (const p of entry.parts) p.pool.setMatrix(p.slot, this.tmp2.multiplyMatrices(this.tmp, p.base));
  }

  private groundOf(lot: Lot): { base: number; low: number } {
    let hi = -Infinity;
    let lo = Infinity;
    for (let y = lot.y; y <= lot.y + lot.h; y++) {
      for (let x = lot.x; x <= lot.x + lot.w; x++) {
        const h = this.terrain.corners[y * CORNERS + x];
        hi = Math.max(hi, h);
        lo = Math.min(lo, h);
      }
    }
    return { base: Math.max(hi, 0.05), low: lo };
  }
}

/** Which side of the Lot faces a Road: 0 N, 1 E, 2 S, 3 W. */
function frontOf(lot: Lot, state: CityState): number {
  const score = [0, 0, 0, 0];
  const open = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return 0;
    const i = y * SIZE + x;
    const t = roadTier(state.road[i]);
    return t >= Tier.Dirt && t <= Tier.Avenue ? 2 : state.pocket[i] ? 1 : 0;
  };
  for (let x = lot.x; x < lot.x + lot.w; x++) {
    score[0] += open(x, lot.y - 1);
    score[2] += open(x, lot.y + lot.h);
  }
  for (let y = lot.y; y < lot.y + lot.h; y++) {
    score[1] += open(lot.x + lot.w, y);
    score[3] += open(lot.x - 1, y);
  }
  let best = 0;
  for (let d = 1; d < 4; d++) if (score[d] > score[best]) best = d;
  return best;
}

function easeOutBack(t: number): number {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
