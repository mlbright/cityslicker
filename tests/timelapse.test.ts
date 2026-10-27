import { describe, expect, it } from 'vitest';
import { DEFAULT_CHARTER } from '../src/sim/charter';
import { Simulation } from '../src/sim/sim';
import { stateDigest, TICKS_PER_YEAR } from '../src/sim/state';
import { Playback, SECONDS_PER_YEAR } from '../src/timelapse/playback';
import { Timelapse } from '../src/timelapse/timelapse';

function recorded(ticks: number): { tl: Timelapse; sim: Simulation } {
  const sim = new Simulation({ seed: 21, ...DEFAULT_CHARTER });
  const tl = new Timelapse();
  for (let k = 0; k < ticks; k++) tl.record(sim.step()!);
  return { tl, sim };
}

describe('Playback', () => {
  it('never moves the Playhead past the Present', () => {
    const pb = new Playback();
    pb.speed = 16;
    pb.update(100, 40);
    expect(pb.playhead).toBe(40);
  });

  it('only wants growth while playing at the Present', () => {
    const pb = new Playback();
    pb.playhead = 40;
    expect(pb.wantsGrowth(40)).toBe(true);
    pb.playhead = 12;
    expect(pb.wantsGrowth(40)).toBe(false);
    pb.playhead = 40;
    pb.mode = 'pause';
    expect(pb.wantsGrowth(40)).toBe(false);
    pb.mode = 'play';
    pb.startDrag();
    expect(pb.wantsGrowth(40)).toBe(false);
  });

  it('plays a year in five seconds at 1×', () => {
    const pb = new Playback();
    pb.update(SECONDS_PER_YEAR, 1000);
    expect(pb.playhead).toBeCloseTo(TICKS_PER_YEAR);
  });

  it('reverses back to the start and pauses there', () => {
    const pb = new Playback();
    pb.playhead = 30;
    pb.toggleReverse();
    pb.speed = 16;
    pb.update(10, 30);
    expect(pb.playhead).toBe(0);
    expect(pb.mode).toBe('pause');
  });

  it('resumes the previous mode after a drag', () => {
    const pb = new Playback();
    pb.startDrag();
    pb.drag(5, 30);
    pb.update(10, 30);
    expect(pb.playhead).toBe(5);
    pb.endDrag();
    expect(pb.mode).toBe('play');
  });
});

describe('Timelapse', () => {
  it('shows the City at the Playhead and returns to the Present', () => {
    const { tl, sim } = recorded(360);
    tl.seek(360);
    const present = stateDigest(tl.state);
    expect(present).toBe(stateDigest(sim.state));
    tl.seek(120);
    expect(tl.at).toBe(120);
    expect(stateDigest(tl.state)).not.toBe(present);
    tl.seek(10_000);
    expect(tl.at).toBe(360);
    expect(stateDigest(tl.state)).toBe(present);
  });

  it('reports stats and fields for the Playhead moment', () => {
    const { tl } = recorded(240);
    tl.seek(130);
    expect(tl.stats()!.tick).toBe(129);
    expect(tl.fieldsNow()!.tick).toBeLessThan(130);
    expect(tl.fieldsNow()!.tick).toBeGreaterThanOrEqual(120);
  });

  it('refuses ticks out of order', () => {
    const { tl, sim } = recorded(2);
    sim.step();
    expect(() => tl.record(sim.step()!)).toThrow();
  });
});
