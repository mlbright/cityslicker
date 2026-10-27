# Cityslicker implementation plan

Vocabulary follows `GLOSSARY.md`. Decisions behind the less obvious choices are in `docs/adr/`.

## Architecture

```
src/
  sim/        pure TypeScript, no DOM or Three.js; runs in a Web Worker and in Vitest
  timelapse/  the recorded history: Change log, keyframes, Playhead/Present logic
  render/     Three.js scene built from the City state at the Playhead
  ui/         DOM overlay: timeline, HUD, Charter picker, hover card
  audio/      Web Audio synthesis
  main.ts     wires worker ⇄ timelapse ⇄ render ⇄ ui
```

**Simulation (`sim/`).** Steps one month at a time, so a Run is 1,200 ticks. Each tick returns a list of **Changes**, such as `RoadBuilt`, `RoadPromoted`, `LotZoned`, `LotsMerged`, `BuildingBuilt`, `BuildingAbandoned`, `BuildingDemolished`, `ParkLaid`, `CivicBuilt` and `CentreFounded`, plus stats (date, population, Demand). Every Change carries enough data to be undone. All randomness comes from one seeded generator derived from the Charter.

**Worker protocol.** The main thread sends `start(charter)` and `advance(n)`. The worker replies with `ticks: {changes, stats}[]`. The worker only ever moves forward. It runs ahead only when asked, because the Present advances only while the Playhead is at the Present.

**Time lapse (`timelapse/`).** The main thread stores every tick's Changes and applies or undoes whole ticks to move the Playhead. *(Changed during milestone 3: no keyframes. Undoing an entire metropolis Run is about 20k small Changes and takes a few milliseconds, so keyframes would add complexity for no gain.)* Reverse playback undoes one tick at a time, so the renderer can animate Buildings sinking back into the ground. Ticks the worker computes ahead stay in an invisible buffer and only become part of the Time lapse when the Playhead reaches them, so the Present advances only while the Viewer watches it.

**Rendering (`render/`).**
- Buildings use instanced meshes, with one archetype per Zone type × Density × footprint.
- All geometry is generated in code: rounded low-poly boxes with roofs and windows.
- The renderer turns Changes into animations: a bounce when a Building appears, a shrink when it's demolished, and a fade plus overgrowth for Abandonment.
- Post-processing adds tilt-shift and soft shadows.
- Day/night and Ambient life run on a separate real-time clock. Car density per Road follows the Traffic at the Playhead.

**Snapshot.** Temporarily render at 2× pixel ratio, read the canvas with `toBlob`, then restore the normal ratio. The UI is plain DOM, so it's never in the image.

**Charter in the URL.** Query string such as `?seed=4821&water=coastal&hills=rolling&ambition=metro&lean=0`. Every setting has a default.

## Simulation rules (first pass)

| Rule | Approach |
|---|---|
| Terrain | Seeded value/simplex noise for height. Water type picks a carving pass: river, coast, lakes or islands. Hilliness scales the amplitude. |
| Regional highway | Cheapest path between two opposite map edges, avoiding steep and wet tiles. |
| First village | The best tile next to the highway, scored by flatness, water nearby and river crossings. |
| Demand | City-wide R, C and I values from the jobs/residents balance, Ambition (target population curve) and RCI lean. |
| Land value | A field recomputed every few ticks: Centre proximity weighted by size, plus water, Parks and Civic buildings, minus slope and Industrial pollution. |
| Zoning | Claim bare tiles beside Roads where Land value suits the Zone type with the highest Demand. Lots are 1×1 to 4×4 tiles. |
| Road growth | Extend streets from a Centre into good land and add diagonals as arterials. Fill the leftover slivers with Pocket parks. Short Bridges over water. *(Added in milestone 2:)* every new street reserves side-street stubs every 5–7 tiles, which Zoning leaves alone, so Lots can't box the network in. |
| Redevelopment | When Land value and Demand allow, increase Density and merge adjacent Lots of the same Zone type. |
| Abandonment | When a Lot's Zone type fits badly for a sustained period, the Building is abandoned, demolished after a delay, and its tiles go back to bare ground. |
| Traffic | Per Road: homes and jobs reachable within a radius, plus a centrality term. No individual trips. |
| Promotion | Sustained high Traffic moves a Road up a tier: dirt → street → avenue. |
| New highways | Once the population passes a threshold, add a spur or bypass between Centres or to industry. |
| Centres | Founded when Zoning wants land more than N tiles from every Centre. Each gets a generated name. |
| Parks / Civic | Placed as a Centre's population crosses thresholds: school → fire station → town hall → Landmark. These Lots never change. |
| Terraces | Lots on gentle slopes are allowed; the renderer adds a retaining wall. Steep tiles are never zoned. |

## Milestones (each one runnable)

1. **Scaffold and Terrain.** Vite, TypeScript, Three.js and Vitest. Charter ⇄ URL, seeded random generator, Terrain generation, terrain and water meshes, orbit camera.
2. **First growth.** *(All the rules in the table were written in this milestone because they share one Change format; milestones 4–6 tune, test and visualise them.)* Regional highway, first village, Zoning, Demand, Low-density Buildings as plain boxes, monthly ticks in the worker.
3. **Time lapse.** Change log, keyframes, play/pause, 1×/4×/16×, reverse, scrubbing, the "grow only at the Present" rule, Run end and Idle.
4. **A living City.** Land value, Density tiers, Redevelopment with Lot merging, Abandonment and demolition.
5. **Road network.** Diagonals, Pocket parks, Traffic, Promotion, Bridges, Terraces, new highways.
6. **Centres.** Founding, generated names, Parks, Civic buildings, Landmarks, Milestones.
7. **Diorama look.** Procedural Building kit, pastel palette, build/demolish/abandon animations, tilt-shift, shadows, day/night with window lights, Ambient life.
8. **HUD.** Date, population, RCI meter, Milestone pins on the timeline, hover card, Charter picker, sun/moon toggle.
9. **Camera, Snapshot and sound.** Auto camera, 2× PNG Snapshot with a flash, synthesized ambience and effects.
*Status: all milestones done.* Changes made along the way:
- Diagonal high streets are added to each new Centre's crossroads (milestone 5), because diagonals otherwise only appeared between Centres.
- Floating Centre labels show residents only (milestone 6).
- Cities that keep running out of land, and can't found another Centre, densify on slightly lower Land value (milestone 10). This lets hemmed-in maps such as islands reach their Ambition.
- Instance uploads are limited to the slots that changed each frame (milestone 10).

10. **Polish.** Touch controls, performance pass (target 60 fps at year 100 on a laptop), tuning so each Ambition hits its population target.

## Tests

- **Reproducibility:** the same Charter gives the same hash of the Change log, on Node in CI only (see ADR 0002).
- **Reversibility:** applying then undoing any span of ticks returns exactly to the starting keyframe.
- **Invariants after every tick:**
  - Lots don't overlap Roads or each other.
  - Lots are 4×4 tiles or smaller.
  - Park and Civic Lots never change.
  - Zoned Lots never split.
  - Highways never come from Promotion.
- **Rule tests** for each row in the table above, using small hand-built maps.
