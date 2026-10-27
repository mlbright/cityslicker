import * as THREE from 'three';
import { charterToSearch, type Charter } from './sim/charter';
import { generateTerrain, SIZE, type Terrain } from './sim/terrain';
import { roadTier, TICKS_PER_YEAR } from './sim/state';
import { Sound } from './audio/sound';
import { AutoCamera } from './render/autoCamera';
import { CityView } from './render/cityView';
import { Clouds } from './render/clouds';
import { Daylight } from './render/daylight';
import { captureSnapshot, download, snapshotName } from './render/snapshot';
import { Stage } from './render/stage';
import { Grower } from './timelapse/grower';
import { Playback, SECONDS_PER_YEAR, SPEEDS } from './timelapse/playback';
import { Timelapse } from './timelapse/timelapse';
import { CharterPicker } from './ui/charterPicker';
import { h, ICONS } from './ui/dom';
import { Hud } from './ui/hud';
import { Inspector, type Target } from './ui/inspector';
import { CentreLabels } from './ui/labels';
import { Timeline } from './ui/timeline';

/** One City being watched: simulation, Time lapse, playback, view and controls. */
export class App {
  readonly stage: Stage;
  readonly terrain: Terrain;
  readonly view: CityView;
  readonly timelapse = new Timelapse();
  readonly playback = new Playback();
  readonly grower: Grower;
  readonly timeline: Timeline;
  readonly ui: HTMLElement;
  readonly labels: CentreLabels;
  readonly daylight = new Daylight();
  readonly clouds: Clouds;
  readonly hud: Hud;
  readonly inspector: Inspector;
  readonly picker: CharterPicker;
  readonly autoCam: AutoCamera;
  readonly sound: Sound;
  showLabels = true;
  uiHidden = false;
  private readonly flash: HTMLElement;
  private milestonesSeen = 0;
  private trafficLevel = 0;
  private trafficTick = -1;
  private framed = false;
  private pointer: { x: number; y: number; moved: boolean; inside: boolean; down: boolean } = { x: 0, y: 0, moved: false, inside: false, down: false };
  private lastPick = 0;
  private tapTimer = 0;
  private readonly raycaster = new THREE.Raycaster();
  private last = performance.now();

  constructor(
    readonly charter: Charter,
    canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    private readonly options: { speed?: number; zoom?: number } = {},
  ) {
    this.stage = new Stage(canvas);
    this.terrain = generateTerrain(charter);
    this.view = new CityView(this.terrain, charter.seed);
    this.stage.scene.add(this.view.group);
    this.clouds = new Clouds(charter.seed);
    this.stage.scene.add(this.clouds.group);
    Daylight.centre(this.stage);
    this.autoCam = new AutoCamera(this.stage);
    this.sound = new Sound(charter.water === 'coastal' || charter.water === 'islands');
    this.view.buildings.onEvent = (kind, lot) => {
      if (kind !== 'built') return;
      const weight = lot.use === 'civic' ? 4 : lot.building ? [0, 1, 2.5, 5][lot.building.density] : 1;
      this.autoCam.note(lot.x + lot.w / 2, lot.y + lot.h / 2, weight);
      if (lot.building) this.sound.plop(lot.building.density);
    };
    this.grower = new Grower(charter);
    this.grower.onStarted = () => {
      document.title = `${this.grower.name} · Cityslicker`;
    };
    this.timeline = new Timeline({
      onPlay: () => this.playback.togglePlay(),
      onReverse: () => this.reverse(),
      onToPresent: () => {
        this.playback.jump(this.timelapse.present, this.timelapse.present);
        this.playback.mode = 'play';
      },
      onSpeed: (s) => this.playback.setSpeed(s),
      onDragStart: () => this.playback.startDrag(),
      onDrag: (t) => this.playback.drag(t, this.timelapse.present),
      onDragEnd: () => this.playback.endDrag(),
      onJump: (t) => this.playback.jump(t, this.timelapse.present),
    });
    this.labels = new CentreLabels(this.terrain);
    this.hud = new Hud(charter, {
      onSnapshot: () => this.snapshot(),
      onSky: () => this.cycleSky(),
      onAutoCamera: () => this.toggleAutoCamera(),
      onSound: () => this.toggleSound(),
      onNewCity: () => this.picker.open(this.charter),
      onToggleUi: () => this.toggleUi(),
    });
    this.inspector = new Inspector(this.terrain);
    this.picker = new CharterPicker(charter, (c) => {
      window.location.search = charterToSearch(c);
    });
    this.flash = h('div.flash');
    const showUi = h('button.icon-btn.show-ui.card', { title: 'Show controls (H)', 'aria-label': 'Show controls', html: ICONS.eye, onclick: () => this.toggleUi() });
    this.ui = h('div.ui-layer');
    this.ui.append(this.labels.el, this.hud.card, this.hud.toolbar, this.timeline.el, this.inspector.el, this.picker.el, showUi);
    uiRoot.replaceChildren(this.ui, this.flash);
    canvas.addEventListener('pointermove', (e) => {
      this.pointer = { ...this.pointer, x: e.clientX, y: e.clientY, moved: true, inside: true };
    });
    let downAt = { x: 0, y: 0 };
    canvas.addEventListener('pointerdown', (e) => {
      this.pointer.down = true;
      downAt = { x: e.clientX, y: e.clientY };
      this.inspector.hide();
    });
    window.addEventListener('pointerup', (e) => {
      this.pointer.down = false;
      // On touch screens a tap inspects what's under the finger.
      if (e.pointerType === 'touch' && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 8) {
        this.pointer = { x: e.clientX, y: e.clientY, moved: true, inside: true, down: false };
        this.lastPick = 0;
        clearTimeout(this.tapTimer);
        this.tapTimer = window.setTimeout(() => {
          this.pointer.inside = false;
          this.inspector.hide();
        }, 3500);
      }
    });
    canvas.addEventListener('pointerleave', () => {
      this.pointer.inside = false;
      this.inspector.hide();
    });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  private readonly onResize = () => this.stage.resize(window.innerWidth, window.innerHeight);

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return;
    if (this.picker.isOpen) {
      if (e.key === 'Escape') this.picker.close();
      return;
    }
    const present = this.timelapse.present;
    switch (e.key) {
      case 'p':
      case 'P':
        this.snapshot();
        break;
      case 'l':
      case 'L':
        this.cycleSky();
        break;
      case 'a':
      case 'A':
        this.toggleAutoCamera();
        break;
      case 'm':
      case 'M':
        this.toggleSound();
        break;
      case 'h':
      case 'H':
        this.toggleUi();
        break;
      case ' ':
        e.preventDefault();
        this.playback.togglePlay();
        break;
      case 'r':
      case 'R':
        this.reverse();
        break;
      case '1':
      case '2':
      case '3':
        this.playback.setSpeed(SPEEDS[Number(e.key) - 1]);
        break;
      case 'ArrowLeft':
        this.playback.jump(Math.floor(this.playback.playhead) - TICKS_PER_YEAR, present);
        break;
      case 'ArrowRight':
        this.playback.jump(Math.floor(this.playback.playhead) + TICKS_PER_YEAR, present);
        break;
      case 'End':
        this.playback.jump(present, present);
        this.playback.mode = 'play';
        break;
      case 'Home':
        this.playback.jump(0, present);
        break;
      default:
        return;
    }
  };

  /** Advances playback by one animation frame and renders. */
  frame(nowMs: number): void {
    const now = nowMs / 1000;
    const dt = Math.min(0.1, (nowMs - this.last) / 1000);
    this.last = nowMs;
    const pb = this.playback;
    const tl = this.timelapse;

    // Growth happens only while the Playhead is at the Present.
    const speedOverride = this.options.speed;
    if (speedOverride) pb.speed = speedOverride as never;
    const rate = (pb.speed * TICKS_PER_YEAR) / SECONDS_PER_YEAR;
    const growing = pb.wantsGrowth(tl.present);
    if (growing) this.grower.keepAhead(Math.max(12, Math.ceil(rate * 1.5)));
    pb.update(dt, growing ? tl.present + this.grower.available : tl.present);
    while (tl.present < Math.floor(pb.playhead)) {
      const [r] = this.grower.take(1);
      if (!r) break;
      tl.record(r);
    }

    const moved = tl.seek(pb.playhead);
    if (moved.moved > 0) {
      this.view.sync(tl.state, moved.moved <= 3, now);
      if (!this.framed && tl.state.centres.size > 0) this.frameFirstCentre();
    }
    this.daylight.update(dt);
    this.daylight.apply(this.stage);
    this.clouds.update(dt, this.stage.camera, this.stage.controls.target);
    this.autoCam.update(dt);
    this.view.update(now, dt, tl.state, tl.fieldsNow()?.traffic ?? null, tl.stats()?.population ?? 0, this.daylight.night);
    this.timeline.update({
      playhead: pb.playhead,
      applied: tl.at,
      present: tl.present,
      mode: pb.mode,
      speed: pb.speed,
      growing,
      complete: this.grower.exhausted,
      milestones: tl.milestones,
    });

    const stats = tl.stats();
    this.hud.update({
      name: this.grower.name,
      population: stats?.population ?? 0,
      demand: stats?.demand ?? { R: 0, C: 0, I: 0 },
      sky: this.daylight.mode,
      autoCamera: this.autoCam.enabled,
      sound: this.sound.on,
    });
    this.ambience(nowMs / 1000, tl.state.centres.size > 0);

    this.stage.controls.update();
    this.labels.update(tl.state, stats, this.stage.camera, window.innerWidth, window.innerHeight, this.showLabels && !this.uiHidden);
    this.hover(nowMs, moved.moved > 0);
    this.stage.render();
  }

  /** Updates the hover card for whatever is under the pointer. */
  private hover(nowMs: number, cityChanged: boolean): void {
    const p = this.pointer;
    if (!p.inside || p.down || this.uiHidden || this.picker.isOpen) return;
    if (!p.moved && !cityChanged) return;
    if (nowMs - this.lastPick < 70) return;
    this.lastPick = nowMs;
    p.moved = false;
    const ndc = new THREE.Vector2((p.x / window.innerWidth) * 2 - 1, -(p.y / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    const state = this.timelapse.state;
    let target: Target = null;
    const hit = this.view.buildings.pick(this.raycaster);
    const ground = this.raycaster.intersectObject(this.view.terrainMesh.surface, false)[0];
    if (hit && (!ground || hit.distance <= ground.distance + 0.5)) {
      const lot = state.lots.get(hit.lotId);
      if (lot) target = { kind: 'lot', lot };
    } else if (ground) {
      const x = Math.floor(ground.point.x);
      const y = Math.floor(ground.point.z);
      if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) {
        const i = y * SIZE + x;
        const lot = state.lots.get(state.lotAt[i]);
        if (lot) target = { kind: 'lot', lot };
        else if (roadTier(state.road[i])) target = { kind: 'road', tile: i };
      }
    }
    if (target) this.inspector.show(target, state, this.timelapse.fieldsNow(), p.x, p.y);
    else this.inspector.hide();
  }

  private cycleSky(): void {
    this.daylight.mode = this.daylight.mode === 'cycle' ? 'day' : this.daylight.mode === 'day' ? 'night' : 'cycle';
  }

  private toggleUi(): void {
    this.uiHidden = !this.uiHidden;
    this.ui.classList.toggle('ui-hidden', this.uiHidden);
    this.inspector.hide();
  }

  private reverse(): void {
    this.playback.toggleReverse();
    if (this.playback.mode === 'reverse') this.sound.whoosh();
  }

  /** Feeds the soundscape and reacts to new Milestones. */
  private ambience(now: number, started: boolean): void {
    const tl = this.timelapse;
    if (tl.milestones.length > this.milestonesSeen) {
      for (const m of tl.milestones.slice(this.milestonesSeen)) {
        if (m.kind === 'centre') this.autoCam.note(m.x, m.y, 12);
      }
      if (this.milestonesSeen > 0) this.sound.chime();
      this.milestonesSeen = tl.milestones.length;
    }
    const fields = tl.fieldsNow();
    if (fields && fields.tick !== this.trafficTick) {
      this.trafficTick = fields.tick;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < fields.traffic.length; i++) {
        if (fields.traffic[i]) {
          sum += fields.traffic[i];
          n++;
        }
      }
      this.trafficLevel = n ? (sum / n / 255) * Math.min(1, n / 800) : 0;
    }
    const size = started ? (tl.stats()?.population ?? 0) / Math.max(1, this.grower.targetPopulation) : 0;
    this.sound.update(now, size, this.trafficLevel, this.daylight.night > 0.5);
  }

  /** Saves a PNG of the 3D view at the Playhead's moment. */
  async snapshot(): Promise<void> {
    this.sound.shutter();
    this.flash.classList.remove('go');
    void this.flash.offsetWidth;
    this.flash.classList.add('go');
    const blob = await captureSnapshot(this.stage);
    download(blob, snapshotName(this.grower.name, this.timelapse.at));
  }

  toggleAutoCamera(): void {
    if (this.autoCam.enabled) this.autoCam.enabled = false;
    else this.autoCam.start();
  }

  toggleSound(): void {
    this.sound.setEnabled(!this.sound.on);
  }

  private frameFirstCentre(): void {
    this.framed = true;
    const c = [...this.timelapse.state.centres.values()][0];
    const offset = this.stage.camera.position.clone().sub(this.stage.controls.target).multiplyScalar(0.55 * (this.options.zoom ?? 1));
    this.stage.controls.target.set(c.x + 0.5, 0, c.y + 0.5);
    this.stage.camera.position.copy(this.stage.controls.target).add(offset);
  }

  dispose(): void {
    this.grower.dispose();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onResize);
  }
}
