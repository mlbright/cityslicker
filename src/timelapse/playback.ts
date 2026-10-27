import { TICKS_PER_YEAR } from '../sim/state';

export const SECONDS_PER_YEAR = 5;
export const SPEEDS = [1, 4, 16] as const;
export type Speed = (typeof SPEEDS)[number];
export type Mode = 'play' | 'pause' | 'reverse';

/**
 * Where the Playhead is and how it moves. The Playhead is measured in ticks (months) and never
 * passes the Present; the City only grows while the Playhead sits at the Present.
 */
export class Playback {
  mode: Mode = 'play';
  speed: Speed = 1;
  playhead = 0;
  private dragging = false;
  private modeBeforeDrag: Mode = 'play';

  /** True when the Playhead wants the Present to move forward. */
  wantsGrowth(present: number): boolean {
    return this.mode === 'play' && !this.dragging && this.playhead >= present - 0.001;
  }

  update(dt: number, present: number): void {
    if (this.dragging) return;
    const rate = (this.speed * TICKS_PER_YEAR) / SECONDS_PER_YEAR;
    if (this.mode === 'play') {
      this.playhead = Math.min(present, this.playhead + dt * rate);
    } else if (this.mode === 'reverse') {
      this.playhead = Math.max(0, this.playhead - dt * rate);
      if (this.playhead <= 0) this.mode = 'pause';
    }
  }

  togglePlay(): void {
    this.mode = this.mode === 'play' ? 'pause' : 'play';
  }

  toggleReverse(): void {
    this.mode = this.mode === 'reverse' ? 'pause' : 'reverse';
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
  }

  startDrag(): void {
    if (this.dragging) return;
    this.dragging = true;
    this.modeBeforeDrag = this.mode;
  }

  drag(tick: number, present: number): void {
    this.playhead = Math.max(0, Math.min(present, tick));
  }

  endDrag(): void {
    this.dragging = false;
    this.mode = this.modeBeforeDrag;
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  /** Jumps to a tick (e.g. a Milestone) and pauses there. */
  jump(tick: number, present: number): void {
    this.playhead = Math.max(0, Math.min(present, tick));
    this.mode = 'pause';
  }
}
