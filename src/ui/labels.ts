import * as THREE from 'three';
import type { TickStats } from '../sim/sim';
import type { CityState } from '../sim/state';
import { heightAt, type Terrain } from '../sim/terrain';
import { formatNumber, h } from './dom';

/** Floating name tags over each Centre, shown when zoomed out. */
export class CentreLabels {
  readonly el = h('div.labels');
  private readonly tags = new Map<number, { el: HTMLElement; name: HTMLElement; pop: HTMLElement; pos: THREE.Vector3 }>();
  private readonly v = new THREE.Vector3();

  constructor(private readonly terrain: Terrain) {}

  update(state: CityState, stats: TickStats | null, camera: THREE.PerspectiveCamera, width: number, height: number, visible: boolean): void {
    for (const [id, tag] of this.tags) {
      if (!state.centres.has(id)) {
        tag.el.remove();
        this.tags.delete(id);
      }
    }
    const pops = new Map(stats?.centres.map((c) => [c.id, c.population]) ?? []);
    const distance = camera.position.distanceTo(new THREE.Vector3(64, 0, 64));
    const show = visible && distance > 70;
    this.el.classList.toggle('hidden', !show);
    if (!show) return;
    for (const centre of state.centres.values()) {
      let tag = this.tags.get(centre.id);
      if (!tag) {
        const name = h('span.label-name', {}, centre.name);
        const pop = h('span.label-pop');
        const el = h('div.label', {}, name, pop);
        const pos = new THREE.Vector3(centre.x + 0.5, Math.max(0, heightAt(this.terrain, centre.x + 0.5, centre.y + 0.5)) + 7, centre.y + 0.5);
        tag = { el, name, pop, pos };
        this.tags.set(centre.id, tag);
        this.el.append(el);
      }
      const p = pops.get(centre.id) ?? 0;
      tag.pop.textContent = p > 0 ? formatNumber(p) : '';
      this.v.copy(tag.pos).project(camera);
      const behind = this.v.z > 1;
      tag.el.style.display = behind ? 'none' : '';
      tag.el.style.transform = `translate(-50%, -100%) translate(${((this.v.x + 1) / 2) * width}px, ${((1 - this.v.y) / 2) * height}px)`;
      tag.el.style.setProperty('--size', String(Math.min(1.15, 0.8 + Math.sqrt(p) / 400)));
    }
  }
}
