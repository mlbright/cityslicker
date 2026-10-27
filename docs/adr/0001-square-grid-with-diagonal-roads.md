# Square tile grid with 45° diagonal roads

The City lives on a square tile grid. Roads may run along the grid or at 45° diagonals, but nothing is free-form or curved. The "organic" feel comes from how the City spreads (irregular expansion, edges that follow the Terrain, neighbourhoods with different character), not from its geometry.

## Considered Options

- **Plain grid only:** simplest, but cities look rigid and can't cut across hills or follow rivers.
- **Free-form curved roads with lot subdivision:** most organic look, but several times the work (subdividing lots along curves, curved road meshes, arbitrary intersections) and far from SimCity 4's feel.

Adding diagonals keeps the simulation tile-based while letting arterials cut across the grid the way they do in SimCity 4: Rush Hour.
