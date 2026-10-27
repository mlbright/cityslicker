import { describe, expect, it } from 'vitest';
import { charterToSearch, DEFAULT_CHARTER, parseCharter } from '../src/sim/charter';

describe('Charter in the URL', () => {
  it('round-trips every setting', () => {
    const charter = { seed: 4821, water: 'coastal', hills: 'mountainous', ambition: 'metro', lean: -0.4 } as const;
    expect(parseCharter(charterToSearch(charter))).toEqual(charter);
  });

  it('fills in defaults when only a Seed is given', () => {
    expect(parseCharter('?seed=12')).toEqual({ seed: 12, ...DEFAULT_CHARTER });
  });

  it('ignores unknown values and clamps the RCI lean', () => {
    expect(parseCharter('?seed=5&water=lava&lean=9')).toEqual({ ...DEFAULT_CHARTER, seed: 5, lean: 1 });
  });

  it('has no Charter without a Seed', () => {
    expect(parseCharter('?water=river')).toBeNull();
  });
});
