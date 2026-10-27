import * as THREE from 'three';
import { Rng } from '../sim/rng';
import { SIZE } from '../sim/terrain';

/** A few puffy clouds drifting over the diorama on the ambient clock. They fade when the camera gets close. */
export class Clouds {
  readonly group = new THREE.Group();
  private readonly clouds: { obj: THREE.Group; speed: number; material: THREE.MeshStandardMaterial }[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(seed: number) {
    const rng = new Rng(seed, 'clouds');
    const ball = new THREE.IcosahedronGeometry(1, 1);
    for (let c = 0; c < 7; c++) {
      const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true, transparent: true, opacity: 0.94, depthWrite: false });
      const cloud = new THREE.Group();
      const puffs = 4 + rng.int(4);
      for (let p = 0; p < puffs; p++) {
        const m = new THREE.Mesh(ball, material);
        const s = rng.range(2.2, 4.2);
        m.scale.set(s, s * 0.75, s);
        m.position.set((p - puffs / 2) * 2.6 + rng.range(-0.6, 0.6), rng.range(-0.4, 0.8), rng.range(-1.6, 1.6));
        cloud.add(m);
      }
      cloud.position.set(rng.range(-30, SIZE + 30), rng.range(38, 52), rng.range(-10, SIZE + 10));
      this.group.add(cloud);
      this.clouds.push({ obj: cloud, speed: rng.range(0.6, 1.3), material });
    }
  }

  update(dt: number, camera: THREE.Camera, target: THREE.Vector3): void {
    for (const c of this.clouds) {
      c.obj.position.x += c.speed * dt;
      if (c.obj.position.x > SIZE + 50) c.obj.position.x = -50;
      // Fade clouds near the camera, and any cloud between the camera and what it looks at.
      const near = c.obj.position.distanceTo(camera.position);
      const line = distanceToSegment(c.obj.position, camera.position, target, this.tmp);
      const fade = Math.min(smoothstep(12, 30, near), smoothstep(6, 16, line));
      c.material.opacity = 0.94 * fade;
      c.obj.visible = fade > 0.02;
    }
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function distanceToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, tmp: THREE.Vector3): number {
  const ab = tmp.copy(b).sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(ab.multiplyScalar(t).add(a));
}
