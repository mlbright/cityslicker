import { AMBITION_LABEL, type Charter } from '../sim/charter';
import type { Demand } from '../sim/sim';
import type { SkyMode } from '../render/daylight';
import { formatNumber, h, ICONS } from './dom';

export const WATER_LABEL = { lakes: 'Lakes', river: 'River valley', coastal: 'Coastal', islands: 'Islands' } as const;
export const HILLS_LABEL = { flat: 'Flat', rolling: 'Rolling hills', mountainous: 'Mountains' } as const;

export function charterSummary(c: Charter): string {
  const lean = c.lean <= -0.3 ? ' · Commuter town' : c.lean >= 0.3 ? ' · Port city' : '';
  return `${WATER_LABEL[c.water]} · ${HILLS_LABEL[c.hills]} · ${AMBITION_LABEL[c.ambition]}${lean}`;
}

export interface HudHandlers {
  onSnapshot(): void;
  onSky(): void;
  onAutoCamera(): void;
  onSound(): void;
  onNewCity(): void;
  onToggleUi(): void;
}

export interface HudView {
  name: string;
  population: number;
  demand: Demand;
  sky: SkyMode;
  autoCamera: boolean;
  sound: boolean;
}

/** City card (top left) with the RCI demand meter, and the toolbar (top right). */
export class Hud {
  readonly card: HTMLElement;
  readonly toolbar: HTMLElement;
  private readonly name: HTMLElement;
  private readonly pop: HTMLElement;
  private readonly bars: Record<keyof Demand, HTMLElement>;
  private readonly skyBtn: HTMLButtonElement;
  private readonly autoBtn: HTMLButtonElement;
  private readonly soundBtn: HTMLButtonElement;
  private last = '';

  constructor(charter: Charter, handlers: HudHandlers) {
    this.name = h('div.city-name');
    this.pop = h('div.city-pop');
    const bar = (zone: keyof Demand, label: string) => {
      const fill = h(`div.rci-fill.rci-${zone.toLowerCase()}`);
      const el = h('div.rci-bar', { title: `${label} demand` }, h('div.rci-track', {}, h('div.rci-zero'), fill), h('div.rci-label', {}, zone));
      return { el, fill };
    };
    const r = bar('R', 'Residential');
    const c = bar('C', 'Commercial');
    const i = bar('I', 'Industrial');
    this.bars = { R: r.fill, C: c.fill, I: i.fill };
    this.card = h(
      'div.city-card.card',
      {},
      h('div.city-text', {}, this.name, h('div.city-charter', {}, charterSummary(charter)), this.pop),
      h('div.rci', { role: 'img', 'aria-label': 'RCI demand meter' }, r.el, c.el, i.el),
    );

    const tool = (icon: string, title: string, onclick: () => void) =>
      h<HTMLButtonElement>('button.icon-btn.tool', { title, 'aria-label': title, html: icon, onclick });
    this.skyBtn = tool(ICONS.cycle, 'Sun and moon: day/night cycle (L)', handlers.onSky);
    this.autoBtn = tool(ICONS.orbit, 'Auto camera (A)', handlers.onAutoCamera);
    this.soundBtn = tool(ICONS.soundOff, 'Sound (M)', handlers.onSound);
    this.toolbar = h(
      'div.toolbar.card',
      {},
      tool(ICONS.camera, 'Snapshot (P)', handlers.onSnapshot),
      this.skyBtn,
      this.autoBtn,
      this.soundBtn,
      tool(ICONS.dice, 'New city…', handlers.onNewCity),
      tool(ICONS.eye, 'Hide controls (H)', handlers.onToggleUi),
    );
  }

  update(v: HudView): void {
    const key = `${v.name}|${Math.round(v.population)}|${v.demand.R.toFixed(2)}|${v.demand.C.toFixed(2)}|${v.demand.I.toFixed(2)}|${v.sky}|${v.autoCamera}|${v.sound}`;
    if (key === this.last) return;
    this.last = key;
    this.name.textContent = v.name || '…';
    this.pop.innerHTML = `<span class="pop-icon">👥</span> ${formatNumber(v.population)}`;
    for (const zone of ['R', 'C', 'I'] as const) {
      const d = Math.max(-1, Math.min(1, v.demand[zone]));
      const fill = this.bars[zone];
      fill.style.height = `${Math.abs(d) * 50}%`;
      fill.style.bottom = d >= 0 ? '50%' : `${50 - Math.abs(d) * 50}%`;
      fill.classList.toggle('negative', d < 0);
    }
    this.skyBtn.innerHTML = v.sky === 'day' ? ICONS.sun : v.sky === 'night' ? ICONS.moon : ICONS.cycle;
    this.skyBtn.title = `Sun and moon: ${v.sky === 'cycle' ? 'day/night cycle' : v.sky === 'day' ? 'always day' : 'always night'} (L)`;
    this.autoBtn.classList.toggle('active', v.autoCamera);
    this.soundBtn.innerHTML = v.sound ? ICONS.soundOn : ICONS.soundOff;
    this.soundBtn.classList.toggle('active', v.sound);
  }
}
