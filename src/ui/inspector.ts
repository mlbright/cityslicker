import type { FieldsSnapshot } from '../sim/sim';
import { CityState, lotCapacity, roadTier, Tier, TICKS_PER_YEAR, type Lot } from '../sim/state';
import { SIZE, type Terrain } from '../sim/terrain';
import { formatNumber, h } from './dom';

const ZONE_NAME = { R: 'Residential', C: 'Commercial', I: 'Industrial' } as const;
const DENSITY_NAME = ['', 'Low', 'Medium', 'High'];
const BUILDING_NAME: Record<string, string[]> = {
  R: ['', 'Cottage', 'Apartments', 'Residential tower'],
  C: ['', 'Shop', 'Offices', 'Skyscraper'],
  I: ['', 'Workshop', 'Factory', 'Heavy industry'],
};
const CIVIC_NAME = { townhall: 'Town hall', school: 'School', fire: 'Fire station', clinic: 'Clinic', library: 'Library', landmark: 'Clock tower' };
const ROAD_NAME = ['', 'Dirt road', 'Street', 'Avenue', 'Highway'];

export type Target = { kind: 'lot'; lot: Lot } | { kind: 'road'; tile: number } | null;

/** The little card that follows the pointer, describing what's under it. */
export class Inspector {
  readonly el = h('div.inspector.card', { role: 'tooltip' });
  private shownKey = '';

  constructor(private readonly terrain: Terrain) {
    this.hide();
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.shownKey = '';
  }

  show(target: Target, state: CityState, fields: FieldsSnapshot | null, x: number, y: number): void {
    if (!target) return this.hide();
    const key = target.kind === 'lot' ? `lot:${target.lot.id}:${target.lot.building?.builtTick}:${target.lot.building?.abandonedTick}:${fields?.tick}` : `road:${target.tile}:${state.road[target.tile]}:${fields?.tick}`;
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.el.replaceChildren(...(target.kind === 'lot' ? this.lotCard(target.lot, state, fields) : this.roadCard(target.tile, state, fields)));
    }
    this.el.classList.remove('hidden');
    const w = this.el.offsetWidth;
    const hgt = this.el.offsetHeight;
    const left = Math.min(window.innerWidth - w - 12, x + 18);
    const top = Math.min(window.innerHeight - hgt - 12, y + 18);
    this.el.style.transform = `translate(${Math.max(12, left)}px, ${Math.max(12, top)}px)`;
  }

  private lotCard(lot: Lot, state: CityState, fields: FieldsSnapshot | null): Node[] {
    const b = lot.building;
    const centre = state.centres.get(lot.centre);
    const year = (tick: number) => `Year ${Math.floor(tick / TICKS_PER_YEAR)}`;
    let title: string;
    let dot: string;
    const rows: [string, string][] = [];
    if (lot.use === 'park') {
      title = lot.w * lot.h >= 9 ? 'Pond park' : 'Park';
      dot = 'park';
      rows.push(['Opened', year(lot.zonedTick)]);
    } else if (lot.use === 'civic') {
      title = CIVIC_NAME[b?.civic ?? 'townhall'];
      dot = 'civic';
      rows.push(['Opened', year(lot.zonedTick)]);
    } else {
      dot = lot.use.toLowerCase();
      title = b ? BUILDING_NAME[lot.use][b.density] : `${ZONE_NAME[lot.use]} lot`;
      rows.push(['Zone', ZONE_NAME[lot.use]]);
      if (b) {
        rows.push(['Density', DENSITY_NAME[b.density]]);
        if (b.abandonedTick >= 0) rows.push(['Abandoned', `since ${year(b.abandonedTick)}`]);
        else {
          rows.push([lot.use === 'R' ? 'Residents' : 'Jobs', formatNumber(lotCapacity(lot))]);
          rows.push(['Built', year(b.builtTick)]);
        }
      } else rows.push(['Zoned', `${year(lot.zonedTick)} · awaiting builders`]);
    }
    rows.push(['Size', `${lot.w}×${lot.h}`]);
    const lv = fields ? this.average(fields.landValue, lot) : null;
    return [
      h('div.insp-title', {}, h(`span.insp-dot.dot-${dot}`), title, b && b.abandonedTick >= 0 ? h('span.insp-tag', {}, 'abandoned') : null),
      centre ? h('div.insp-sub', {}, `in ${centre.name}`) : null,
      h('dl.insp-rows', {}, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      lv !== null ? meter('Land value', lv) : null,
    ].filter(Boolean) as Node[];
  }

  private roadCard(tile: number, state: CityState, fields: FieldsSnapshot | null): Node[] {
    const tier = roadTier(state.road[tile]);
    const bridge = this.terrain.water[tile] === 1;
    const traffic = fields ? fields.traffic[tile] / 255 : null;
    return [
      h('div.insp-title', {}, h('span.insp-dot.dot-road'), `${ROAD_NAME[tier]}${bridge ? ' bridge' : ''}`),
      tier === Tier.Highway ? h('div.insp-sub', {}, 'Never promoted; only ever built') : h('div.insp-sub', {}, tier === Tier.Avenue ? 'Top of the Promotion ladder' : 'Busy Roads get promoted'),
      traffic !== null ? meter('Traffic', traffic) : null,
    ].filter(Boolean) as Node[];
  }

  private average(field: Uint8Array, lot: Lot): number {
    let sum = 0;
    for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) sum += field[y * SIZE + x];
    return sum / (lot.w * lot.h) / 255;
  }
}

function meter(label: string, value: number): HTMLElement {
  const pct = Math.round(value * 100);
  return h(
    'div.insp-meter',
    {},
    h('span', {}, label),
    h('div.insp-meter-track', {}, h('div.insp-meter-fill', { style: `width:${pct}%` })),
    h('span.insp-meter-val', {}, `${pct}`),
  );
}
