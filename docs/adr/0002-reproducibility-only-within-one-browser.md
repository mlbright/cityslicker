# Cities are exactly reproducible only within one browser

The simulation uses ordinary floating-point maths (`Math.sin`, `Math.pow` and friends), whose last-digit results can differ between browser engines. So a shared Charter link always grows the same Terrain, but the City's details may drift between, say, Chrome and Safari over a 100-year Run. Within one browser, a Charter is exactly reproducible, which is all that rewinding the Time lapse needs.

## Considered Options

- **Identical everywhere:** a custom fixed-point or integer maths layer with its own noise and random number generator. Rejected as too much up-front cost for a toy; links show "your city's land, roughly your city" rather than a guarantee.

## Consequences

A bug report saying "my friend's copy of my link looks different" is expected behaviour, not a bug. Tests that pin exact outcomes for a Seed are only valid on the engine they run on (Node/V8 in CI). Moving to cross-browser determinism later means rewriting all of the simulation's maths.
