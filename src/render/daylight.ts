import * as THREE from 'three';
import { SIZE } from '../sim/terrain';
import type { Stage } from './stage';

export type SkyMode = 'cycle' | 'day' | 'night';

const SKY_DAY = new THREE.Color('#cdeaf7');
const SKY_DUSK = new THREE.Color('#f9c0a8');
const SKY_NIGHT = new THREE.Color('#283163');
const SUN_HIGH = new THREE.Color('#fff2de');
const SUN_LOW = new THREE.Color('#ffb27a');
const MOON = new THREE.Color('#aab8ff');
const HEMI_SKY_DAY = new THREE.Color('#e4f4ff');
const HEMI_SKY_NIGHT = new THREE.Color('#6b78c2');
const HEMI_GROUND_DAY = new THREE.Color('#b8c99c');
const HEMI_GROUND_NIGHT = new THREE.Color('#353a5e');

/**
 * The ambient clock: a day/night cycle on its own real-time clock, independent of the Run.
 * One day lasts two minutes whatever the playback speed, and it keeps going while paused.
 */
export class Daylight {
  mode: SkyMode = 'cycle';
  /** Fraction of the day: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. */
  time = 0.36;
  readonly dayLength = 120;
  /** 0 by day, 1 at night. */
  night = 0;
  private readonly sky = new THREE.Color();
  private readonly dir = new THREE.Vector3();

  update(dt: number): void {
    if (this.mode === 'cycle') {
      this.time = (this.time + dt / this.dayLength) % 1;
      return;
    }
    // Ease towards late morning or midnight.
    const target = this.mode === 'day' ? 0.4 : 0.98;
    let diff = target - this.time;
    if (diff > 0.5) diff -= 1;
    if (diff < -0.5) diff += 1;
    this.time = (this.time + diff * Math.min(1, dt * 2.5) + 1) % 1;
  }

  apply(stage: Stage): void {
    const angle = (this.time - 0.25) * Math.PI * 2;
    const elevation = Math.sin(angle);
    const day = smoothstep(-0.1, 0.3, elevation);
    const dusk = Math.max(0, 1 - Math.abs(elevation) / 0.28) * (1 - this.night * 0.6);
    this.night = 1 - smoothstep(-0.12, 0.12, elevation);

    // Sun by day, moon by night; both travel across the sky.
    const az = this.time * Math.PI * 2 + 0.6;
    const el = elevation >= 0 ? Math.max(0.12, elevation) : Math.max(0.25, -elevation * 0.8);
    this.dir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
    if (elevation < 0) this.dir.set(-this.dir.x, this.dir.y, -this.dir.z);
    const target = stage.sun.target.position;
    stage.sun.position.copy(target).addScaledVector(this.dir, 180);
    stage.sun.intensity = elevation >= 0 ? 0.4 + 2.2 * day : 0.45;
    stage.sun.color.copy(elevation >= 0 ? SUN_LOW.clone().lerp(SUN_HIGH, smoothstep(0, 0.45, elevation)) : MOON);

    stage.hemi.intensity = 0.85 + 0.6 * day;
    stage.hemi.color.copy(HEMI_SKY_NIGHT).lerp(HEMI_SKY_DAY, day);
    stage.hemi.groundColor.copy(HEMI_GROUND_NIGHT).lerp(HEMI_GROUND_DAY, day);

    this.sky.copy(SKY_NIGHT).lerp(SKY_DAY, day).lerp(SKY_DUSK, dusk * 0.55);
    (stage.scene.background as THREE.Color).copy(this.sky);
    document.body.style.background = `#${this.sky.getHexString()}`;
  }

  /** Centre the shadow camera on the map. */
  static centre(stage: Stage): void {
    stage.sun.target.position.set(SIZE / 2, 0, SIZE / 2);
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
