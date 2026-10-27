import type { FieldsSnapshot, MilestoneEvent, TickResult, TickStats } from '../sim/sim';
import { applyChanges, CityState, type Change } from '../sim/state';

/**
 * The recorded history of a Run, and the City as it stands at the Playhead.
 *
 * `state` always equals the City after the first `applied` ticks. Moving the Playhead applies or
 * undoes whole ticks; every Change is reversible, so no keyframes are needed.
 */
export class Timelapse {
  readonly state = new CityState();
  private readonly ticks: TickResult[] = [];
  private readonly fields: FieldsSnapshot[] = [];
  readonly milestones: MilestoneEvent[] = [];
  private applied = 0;

  /** Number of recorded ticks: the Present. */
  get present(): number {
    return this.ticks.length;
  }

  /** Number of ticks currently applied to `state`. */
  get at(): number {
    return this.applied;
  }

  record(result: TickResult): void {
    if (result.tick !== this.ticks.length) throw new Error(`Time lapse expected tick ${this.ticks.length}, got ${result.tick}`);
    this.ticks.push(result);
    if (result.fields) this.fields.push(result.fields);
    this.milestones.push(...result.milestones);
  }

  /**
   * Moves the City to `target` applied ticks (clamped to the Present). Returns the Changes in the
   * order they were applied, and the direction.
   */
  seek(target: number): { moved: number; forward: boolean; changes: Change[] } {
    const goal = Math.max(0, Math.min(this.present, Math.floor(target)));
    const forward = goal >= this.applied;
    const moved = Math.abs(goal - this.applied);
    const changes: Change[] = [];
    while (this.applied < goal) {
      const r = this.ticks[this.applied++];
      applyChanges(this.state, r.changes, true);
      if (moved <= 3) changes.push(...r.changes);
    }
    while (this.applied > goal) {
      const r = this.ticks[--this.applied];
      applyChanges(this.state, r.changes, false);
      if (moved <= 3) changes.push(...r.changes);
    }
    return { moved, forward, changes };
  }

  /** Stats at the end of the last applied tick (or the first tick when nothing is applied). */
  stats(): TickStats | null {
    if (this.ticks.length === 0) return null;
    return this.ticks[Math.max(0, this.applied - 1)].stats;
  }

  statsAt(tick: number): TickStats | null {
    return this.ticks[Math.max(0, Math.min(this.ticks.length - 1, tick))]?.stats ?? null;
  }

  /** The latest Land value and Traffic snapshot at or before the Playhead. */
  fieldsNow(): FieldsSnapshot | null {
    let lo = 0;
    let hi = this.fields.length - 1;
    let best: FieldsSnapshot | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.fields[mid].tick < this.applied) {
        best = this.fields[mid];
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best ?? this.fields[0] ?? null;
  }
}
