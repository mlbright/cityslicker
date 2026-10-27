import { describe, expect, it } from 'vitest';
import { snapshotName } from '../src/render/snapshot';

describe('Snapshot file names', () => {
  it('use the City name and the Playhead year', () => {
    expect(snapshotName('Puddleford', 37 * 12 + 5)).toBe('puddleford-year37.png');
    expect(snapshotName('Little Brambleton', 0)).toBe('little-brambleton-year0.png');
  });
});
