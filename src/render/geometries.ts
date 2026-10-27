import * as THREE from 'three';

/**
 * Unit shapes that buildings, trees and props are assembled from. Every shape sits on y = 0 and
 * spans -0.5..0.5 horizontally, so a part's scale is simply its size.
 */
export type PartKind = 'box' | 'gable' | 'hip' | 'cyl' | 'cone' | 'ball' | 'window' | 'windowDark';

export function partGeometries(): Record<PartKind, THREE.BufferGeometry> {
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);

  // Triangular prism, ridge along x.
  const gable = new THREE.BufferGeometry();
  const g = [
    // front and back triangles
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
    0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
    // gable ends
    0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0,
    -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0,
    // bottom
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5,
  ];
  gable.setAttribute('position', new THREE.Float32BufferAttribute(g, 3));
  gable.computeVertexNormals();

  const hip = new THREE.ConeGeometry(0.7071, 1, 4, 1);
  hip.rotateY(Math.PI / 4);
  hip.translate(0, 0.5, 0);

  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1);
  cyl.translate(0, 0.5, 0);

  const cone = new THREE.ConeGeometry(0.5, 1, 8, 1);
  cone.translate(0, 0.5, 0);

  const ball = new THREE.IcosahedronGeometry(0.5, 1);
  ball.translate(0, 0.5, 0);

  const window = new THREE.BoxGeometry(1, 1, 1);
  window.translate(0, 0.5, 0);

  return { box, gable, hip, cyl, cone, ball, window, windowDark: window };
}
