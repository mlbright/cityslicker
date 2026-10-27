import type { MilestoneEvent, MilestoneKind } from '../sim/sim';
import { RUN_TICKS, TICKS_PER_YEAR } from '../sim/state';
import { SPEEDS, type Mode, type Speed } from '../timelapse/playback';
import { formatDate, h, ICONS } from './dom';

export interface TimelineHandlers {
  onPlay(): void;
  onReverse(): void;
  onToPresent(): void;
  onSpeed(speed: Speed): void;
  onDragStart(): void;
  onDrag(tick: number): void;
  onDragEnd(): void;
  onJump(tick: number): void;
}

export interface TimelineView {
  playhead: number;
  applied: number;
  present: number;
  mode: Mode;
  speed: Speed;
  growing: boolean;
  complete: boolean;
  milestones: readonly MilestoneEvent[];
}

const MILESTONE_ICON: Record<MilestoneKind, string> = {
  centre: '🏘️',
  population: '👥',
  avenue: '🛣️',
  midrise: '🏢',
  tower: '🏙️',
  townhall: '🏛️',
  landmark: '🕰️',
  highway: '🚗',
  bridge: '🌉',
};

/** The playback bar: play/pause, reverse, speeds, and a track you can scrub up to the Present. */
export class Timeline {
  readonly el: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly reverseBtn: HTMLButtonElement;
  private readonly presentBtn: HTMLButtonElement;
  private readonly speedBtns = new Map<Speed, HTMLButtonElement>();
  private readonly track: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly recorded: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly presentFlag: HTMLElement;
  private readonly pins: HTMLElement;
  private readonly date: HTMLElement;
  private readonly status: HTMLElement;
  private pinCount = -1;
  private present = 0;

  constructor(private readonly handlers: TimelineHandlers) {
    this.reverseBtn = h<HTMLButtonElement>('button.icon-btn', { title: 'Rewind (R)', 'aria-label': 'Rewind', html: ICONS.reverse, onclick: () => handlers.onReverse() });
    this.playBtn = h<HTMLButtonElement>('button.icon-btn.big', { title: 'Play / pause (Space)', 'aria-label': 'Play or pause', html: ICONS.pause, onclick: () => handlers.onPlay() });
    this.presentBtn = h<HTMLButtonElement>('button.icon-btn', { title: 'Jump to the Present (End)', 'aria-label': 'Jump to the Present', html: ICONS.present, onclick: () => handlers.onToPresent() });
    const speeds = h('div.speeds', { role: 'group', 'aria-label': 'Playback speed' });
    for (const s of SPEEDS) {
      const b = h<HTMLButtonElement>('button.chip', { onclick: () => handlers.onSpeed(s), title: `${s}× speed (${SPEEDS.indexOf(s) + 1})` }, `${s}×`);
      this.speedBtns.set(s, b);
      speeds.append(b);
    }
    this.recorded = h('div.track-recorded');
    this.fill = h('div.track-fill');
    this.pins = h('div.track-pins');
    this.presentFlag = h('div.track-present', { title: 'The Present' });
    this.knob = h('div.track-knob', { role: 'slider', 'aria-label': 'Playhead', tabindex: '0' });
    const ticks = h('div.track-years');
    for (let y = 0; y <= 100; y += 25) ticks.append(h('span', { style: `left:${y}%` }, String(y)));
    this.track = h('div.track', {}, this.recorded, this.fill, this.pins, this.presentFlag, this.knob, ticks);
    this.date = h('div.date');
    this.status = h('div.status');
    this.el = h(
      'div.timeline.card',
      {},
      h('div.controls', {}, this.reverseBtn, this.playBtn, this.presentBtn, speeds),
      h('div.track-wrap', {}, this.track),
      h('div.when', {}, this.date, this.status),
    );
    this.bindDrag();
  }

  private tickAt(clientX: number): number {
    const rect = this.track.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.min(this.present, f * RUN_TICKS);
  }

  private bindDrag(): void {
    this.track.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.pin')) return;
      e.preventDefault();
      this.track.setPointerCapture(e.pointerId);
      this.handlers.onDragStart();
      this.handlers.onDrag(this.tickAt(e.clientX));
      const move = (ev: PointerEvent) => this.handlers.onDrag(this.tickAt(ev.clientX));
      const up = () => {
        this.track.removeEventListener('pointermove', move);
        this.track.removeEventListener('pointerup', up);
        this.track.removeEventListener('pointercancel', up);
        this.handlers.onDragEnd();
      };
      this.track.addEventListener('pointermove', move);
      this.track.addEventListener('pointerup', up);
      this.track.addEventListener('pointercancel', up);
    });
  }

  update(v: TimelineView): void {
    this.present = v.present;
    const pct = (t: number) => `${(t / RUN_TICKS) * 100}%`;
    this.recorded.style.width = pct(v.present);
    this.fill.style.width = pct(v.playhead);
    this.knob.style.left = pct(v.playhead);
    this.presentFlag.style.left = pct(v.present);
    this.knob.setAttribute('aria-valuenow', String(Math.floor(v.playhead / TICKS_PER_YEAR)));
    this.playBtn.innerHTML = v.mode === 'play' ? ICONS.pause : ICONS.play;
    this.playBtn.classList.toggle('active', v.mode === 'play');
    this.reverseBtn.classList.toggle('active', v.mode === 'reverse');
    this.presentBtn.disabled = v.playhead >= v.present - 0.5;
    for (const [s, b] of this.speedBtns) b.classList.toggle('active', s === v.speed);
    this.date.textContent = formatDate(v.applied);
    this.status.textContent = v.complete
      ? v.playhead >= v.present - 0.5
        ? 'Run complete'
        : 'Looking back'
      : v.playhead < v.present - 0.5
        ? 'Looking back'
        : v.mode === 'play'
          ? 'Growing'
          : 'Paused';
    this.status.dataset.state = this.status.textContent.toLowerCase().replace(' ', '-');
    if (v.milestones.length !== this.pinCount) this.renderPins(v.milestones);
  }

  private renderPins(milestones: readonly MilestoneEvent[]): void {
    this.pinCount = milestones.length;
    // Stack pins that would overlap into up to three rows.
    const rowEnds = [-Infinity, -Infinity, -Infinity];
    const width = this.track.getBoundingClientRect().width || 600;
    this.pins.replaceChildren(
      ...milestones.map((m) => {
        const f = (m.tick + 1) / RUN_TICKS;
        const px = f * width;
        let row = rowEnds.findIndex((end) => px - end >= 18);
        if (row < 0) row = rowEnds.indexOf(Math.min(...rowEnds));
        rowEnds[row] = px;
        return h(
          'button.pin',
          {
            style: `left:${f * 100}%;bottom:${12 + row * 15}px`,
            title: `${m.label} · Year ${Math.floor((m.tick + 1) / TICKS_PER_YEAR)}`,
            'aria-label': m.label,
            onclick: () => this.handlers.onJump(m.tick + 1),
          },
          h('span.pin-icon', {}, MILESTONE_ICON[m.kind]),
        );
      }),
    );
  }
}
