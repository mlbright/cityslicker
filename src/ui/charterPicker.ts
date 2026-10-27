import {
  AMBITION_LABEL,
  AMBITION_OPTIONS,
  HILLS_OPTIONS,
  randomSeed,
  WATER_OPTIONS,
  type Charter,
} from '../sim/charter';
import { h, ICONS } from './dom';
import { HILLS_LABEL, WATER_LABEL } from './hud';

const WATER_EMOJI = { lakes: '💧', river: '🏞️', coastal: '🏖️', islands: '🏝️' };
const HILLS_EMOJI = { flat: '🌾', rolling: '⛰️', mountainous: '🏔️' };
const AMBITION_EMOJI = { town: '🏡', city: '🏙️', metro: '🌆' };

/** The "New city" dialog: pick a Seed and settings. Any change starts a new Run. */
export class CharterPicker {
  readonly el: HTMLElement;
  private draft: Charter;
  private readonly form: HTMLElement;

  constructor(
    current: Charter,
    private readonly onGrow: (c: Charter) => void,
  ) {
    this.draft = { ...current };
    this.form = h('div.picker-body');
    this.el = h(
      'div.picker-backdrop.hidden',
      { onclick: (e: Event) => e.target === this.el && this.close() },
      h(
        'div.picker.card',
        { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'New city' },
        h('div.picker-head', {}, h('h2', {}, 'Grow a new city'), h('button.icon-btn.close', { 'aria-label': 'Close', onclick: () => this.close(), html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>' })),
        this.form,
      ),
    );
    this.render();
  }

  open(current: Charter): void {
    this.draft = { ...current };
    this.render();
    this.el.classList.remove('hidden');
    (this.el.querySelector('input') as HTMLInputElement | null)?.focus();
  }

  close(): void {
    this.el.classList.add('hidden');
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  private render(): void {
    const d = this.draft;
    const segmented = <T extends string>(label: string, options: readonly T[], value: T, text: (o: T) => string, emoji: Record<T, string>, set: (v: T) => void) =>
      h(
        'fieldset.seg',
        {},
        h('legend', {}, label),
        h(
          'div.seg-options',
          {},
          ...options.map((o) =>
            h('button.seg-btn', { type: 'button', 'aria-pressed': String(o === value), onclick: () => { set(o); this.render(); } }, h('span.seg-emoji', {}, emoji[o]), h('span', {}, text(o))),
          ),
        ),
      );
    const seed = h<HTMLInputElement>('input.seed-input', {
      type: 'number',
      min: '1',
      value: String(d.seed),
      'aria-label': 'Seed',
      oninput: (e: Event) => {
        const v = Number.parseInt((e.target as HTMLInputElement).value, 10);
        if (v > 0) this.draft.seed = v;
      },
    });
    const lean = h<HTMLInputElement>('input.lean', {
      type: 'range',
      min: '-1',
      max: '1',
      step: '0.1',
      value: String(d.lean),
      'aria-label': 'RCI lean',
      oninput: (e: Event) => {
        this.draft.lean = Number((e.target as HTMLInputElement).value);
      },
    });
    this.form.replaceChildren(
      h(
        'div.seed-row',
        {},
        h('label', {}, 'Seed', seed),
        h('button.icon-btn.dice', { type: 'button', title: 'Random Seed', 'aria-label': 'Random Seed', html: ICONS.dice, onclick: () => { this.draft.seed = randomSeed(); this.render(); } }),
      ),
      segmented('Water', WATER_OPTIONS, d.water, (o) => WATER_LABEL[o], WATER_EMOJI, (v) => (this.draft.water = v)),
      segmented('Hills', HILLS_OPTIONS, d.hills, (o) => HILLS_LABEL[o], HILLS_EMOJI, (v) => (this.draft.hills = v)),
      segmented('Ambition', AMBITION_OPTIONS, d.ambition, (o) => AMBITION_LABEL[o], AMBITION_EMOJI, (v) => (this.draft.ambition = v)),
      h('fieldset.lean-row', {}, h('legend', {}, 'RCI lean'), h('div.lean-scale', {}, h('span', {}, '🏡 Commuter town'), lean, h('span', {}, 'Port city ⚓'))),
      h('p.picker-note', {}, 'The same settings always grow the same city, so you can share the link.'),
      h('button.grow-btn', { type: 'button', onclick: () => this.onGrow({ ...this.draft }) }, 'Grow this city'),
    );
  }
}
