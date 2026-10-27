import { App } from './app';
import { charterToSearch, DEFAULT_CHARTER, parseCharter, randomSeed, type Charter } from './sim/charter';

function charterFromUrl(): Charter {
  const parsed = parseCharter(window.location.search);
  if (parsed) return parsed;
  const charter = { seed: randomSeed(), ...DEFAULT_CHARTER };
  window.history.replaceState(null, '', charterToSearch(charter));
  return charter;
}

const params = new URLSearchParams(window.location.search);
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
const app = new App(charterFromUrl(), canvas, uiRoot, {
  // Developer conveniences for screenshots: ?fast=120 forces a playback speed, ?zoom=0.4 frames closer.
  speed: params.has('fast') ? Number(params.get('fast')) : undefined,
  zoom: params.has('zoom') ? Number(params.get('zoom')) : undefined,
});
(window as unknown as { app: App }).app = app;

function loop(now: number): void {
  app.frame(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
