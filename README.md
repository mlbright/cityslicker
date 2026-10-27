# Cityslicker

A browser toy that grows a city on its own, inspired by SimCity 4, as a cute low-poly diorama. Watch it grow from a village by the highway into a city with several Centres over 100 simulated years. You can pause, rewind and scrub the Time lapse, and take a Snapshot at any moment.

Vocabulary lives in [`GLOSSARY.md`](GLOSSARY.md), decisions in [`docs/adr/`](docs/adr) and the build plan in [`docs/plan.md`](docs/plan.md).

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # simulation, Time lapse and rule tests
npm run build      # static site in dist/
```

## Controls

| | |
|---|---|
| Drag / right-drag / scroll | Orbit / pan / zoom (one finger orbits, two fingers zoom and pan on touch screens) |
| Space | Play / pause |
| R | Rewind (play backwards) |
| 1 · 2 · 3 | 1× · 4× · 16× speed (a year takes 5 seconds at 1×) |
| ← / → | Step a year back / forward |
| Home / End | Jump to year 0 / the Present |
| P | Snapshot: saves a PNG at twice the screen resolution, without any controls |
| L | Sun and moon: day/night cycle → always day → always night |
| A | Auto camera, which drifts toward wherever the City is changing. Any camera input stops it |
| M | Sound (off by default) |
| H | Hide / show the controls |

Hover over (or tap) a Building, Park or Road to inspect it. Click a Milestone pin on the timeline to jump there.

The City only grows while the Playhead sits at the Present. Looking back at year 12 for a minute doesn't make you miss anything.

## Charters and sharing

Everything that determines a City is in the URL, for example `?seed=4821&water=coastal&hills=rolling&ambition=metro&lean=0`:

- `water`: `lakes`, `river`, `coastal` or `islands`
- `hills`: `flat`, `rolling` or `mountainous`
- `ambition`: `town` (~5k people), `city` (~20k) or `metro` (~50k)
- `lean`: from `-1` (commuter town) to `1` (port city)

A bare `?seed=…` uses defaults for the rest. Use the 🎲 button for the "Grow a new city" dialog. The same link grows exactly the same City in the same browser, and roughly the same one elsewhere ([ADR 0002](docs/adr/0002-reproducibility-only-within-one-browser.md)).

## How it's built

- `src/sim/` is plain TypeScript with no DOM: Terrain, the growth rules and the reversible Change format. It runs in a Web Worker in the app and directly in Vitest.
- `src/timelapse/` records every tick's Changes and moves the Playhead by applying or undoing them.
- `src/render/` draws the diorama with Three.js: instanced procedural buildings, trees, Ambient life, day/night, tilt-shift and Snapshots.
- `src/ui/` is the DOM overlay: timeline, city card with the RCI meter, inspector and the Charter picker.
- `src/audio/` synthesises the soundscape with Web Audio.

Developer tools:

- `npm run sim -- '?seed=11&ambition=metro'` prints a whole Run's yearly stats in the terminal.
- `npm run metrics` summarises densities and churn across several Charters.
- `npm run bench` times the renderer's CPU work.
- `node scripts/shot.mjs '<query>' out.png` takes a screenshot of the dev server with Playwright and your installed Chrome.
- `?fast=60` forces a playback speed, and `?zoom=0.4` frames the first Centre closer.
