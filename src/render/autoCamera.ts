import * as THREE from 'three';
import { SIZE } from '../sim/terrain';
import type { Stage } from './stage';

/**
 * The Auto camera: drifts on its own toward wherever the City is changing, slowly circling.
 * Any camera input from the Viewer ends it.
 */
export class AutoCamera {
  enabled = false;
  private readonly focus = new THREE.Vector3(SIZE / 2, 0, SIZE / 2);
  private weight = 0;
  private readonly spherical = new THREE.Spherical();
  private readonly offset = new THREE.Vector3();
  onStop: (() => void) | null = null;

  constructor(private readonly stage: Stage) {
    stage.controls.addEventListener('start', () => {
      if (this.enabled) {
        this.enabled = false;
        this.onStop?.();
      }
    });
  }

  /** Something happened at (x, z); `w` is how interesting it was. */
  note(x: number, z: number, w: number): void {
    const total = this.weight + w;
    this.focus.x += ((x - this.focus.x) * w) / total;
    this.focus.z += ((z - this.focus.z) * w) / total;
    this.weight = total;
  }

  start(): void {
    this.enabled = true;
    this.focus.copy(this.stage.controls.target);
    this.weight = 1;
  }

  update(dt: number): void {
    this.weight *= Math.exp(-dt / 5);
    if (!this.enabled) return;
    const controls = this.stage.controls;
    const camera = this.stage.camera;
    controls.target.lerp(this.focus, 1 - Math.exp(-dt * 0.45));
    this.offset.copy(camera.position).sub(controls.target);
    this.spherical.setFromVector3(this.offset);
    this.spherical.theta += dt * 0.07;
    this.spherical.phi += (0.95 - this.spherical.phi) * (1 - Math.exp(-dt * 0.4));
    this.spherical.radius += (62 - this.spherical.radius) * (1 - Math.exp(-dt * 0.3));
    this.offset.setFromSpherical(this.spherical);
    camera.position.copy(controls.target).add(this.offset);
    camera.lookAt(controls.target);
  }
}
