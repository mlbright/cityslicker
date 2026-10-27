import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SIZE } from '../sim/terrain';
import { PALETTE } from './palette';
import { PartPool } from './partPool';
import { PostFx } from './postfx';

/** Renderer, camera, orbit controls and lights: the stage the diorama sits on. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly postfx: PostFx;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = PALETTE.sky.clone();

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 900);
    this.camera.position.set(SIZE * 0.5 + 120, 150, SIZE * 0.5 + 150);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(SIZE / 2, 0, SIZE / 2);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 330;
    this.controls.maxPolarAngle = Math.PI * 0.44;
    this.controls.screenSpacePanning = false;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.update();

    this.hemi = new THREE.HemisphereLight('#e4f4ff', '#b8c99c', 1.35);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight('#fff1dc', 2.4);
    this.sun.position.set(SIZE / 2 + 60, 110, SIZE / 2 + 30);
    this.sun.target.position.set(SIZE / 2, 0, SIZE / 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const cam = this.sun.shadow.camera;
    cam.left = -100;
    cam.right = 100;
    cam.top = 100;
    cam.bottom = -100;
    cam.near = 1;
    cam.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.postfx = new PostFx(this.renderer, this.scene, this.camera);
  }

  render(): void {
    PartPool.flushAll();
    this.postfx.render();
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.postfx.setSize(width, height, this.renderer.getPixelRatio());
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
