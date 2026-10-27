import { describe, expect, it } from 'vitest';
import { DEFAULT_CHARTER, WATER_OPTIONS } from '../src/sim/charter';
import { generateTerrain, heightAt, CORNERS, SIZE } from '../src/sim/terrain';

describe('Terrain', () => {
  it('is the same for the same Charter', () => {
    const c = { seed: 99, ...DEFAULT_CHARTER };
    expect(generateTerrain(c).corners).toEqual(generateTerrain(c).corners);
  });

  it('differs between Seeds', () => {
    const a = generateTerrain({ seed: 1, ...DEFAULT_CHARTER });
    const b = generateTerrain({ seed: 2, ...DEFAULT_CHARTER });
    expect(a.corners).not.toEqual(b.corners);
  });

  it.each(WATER_OPTIONS)('%s maps have both land and water', (water) => {
    const t = generateTerrain({ ...DEFAULT_CHARTER, seed: 7, water });
    const wet = t.water.reduce((n, w) => n + w, 0) / (SIZE * SIZE);
    expect(wet).toBeGreaterThan(0.01);
    expect(wet).toBeLessThan(0.8);
  });

  it('samples corner heights exactly at corners', () => {
    const t = generateTerrain({ seed: 3, ...DEFAULT_CHARTER });
    expect(heightAt(t, 10, 20)).toBeCloseTo(t.corners[20 * CORNERS + 10]);
    expect(heightAt(t, 11, 21)).toBeCloseTo(t.corners[21 * CORNERS + 11]);
  });
});
