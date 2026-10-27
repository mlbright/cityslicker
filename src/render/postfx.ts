import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { HorizontalTiltShiftShader } from 'three/examples/jsm/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/examples/jsm/shaders/VerticalTiltShiftShader.js';

/** Tilt-shift blur at the top and bottom of the view, for the miniature-diorama look. */
export class PostFx {
  readonly composer: EffectComposer;
  private readonly hBlur: ShaderPass;
  private readonly vBlur: ShaderPass;
  private width = 1;
  private height = 1;
  strength = 1;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.hBlur = new ShaderPass(HorizontalTiltShiftShader);
    this.vBlur = new ShaderPass(VerticalTiltShiftShader);
    this.hBlur.uniforms.r.value = 0.5;
    this.vBlur.uniforms.r.value = 0.5;
    this.composer.addPass(this.hBlur);
    this.composer.addPass(this.vBlur);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.width = width * pixelRatio;
    this.height = height * pixelRatio;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.applyStrength();
  }

  private applyStrength(): void {
    this.hBlur.uniforms.h.value = (1.5 * this.strength) / this.width;
    this.vBlur.uniforms.v.value = (1.5 * this.strength) / this.height;
  }

  render(): void {
    this.applyStrength();
    this.composer.render();
  }
}
