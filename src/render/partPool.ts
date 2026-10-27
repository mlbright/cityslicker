import * as THREE from 'three';

/** A growable InstancedMesh with slot allocation, so thousands of building parts cost one draw call each kind. */
export class PartPool {
  /** Every pool, so changed slots can be uploaded once per frame. */
  private static readonly all = new Set<PartPool>();
  mesh: THREE.InstancedMesh;
  private dirtyLo = Infinity;
  private dirtyHi = -1;
  private colorLo = Infinity;
  private colorHi = -1;
  private capacity: number;
  private free: number[] = [];
  private used = 0;
  private readonly parent: THREE.Object3D;
  private static readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(
    parent: THREE.Object3D,
    private readonly geometry: THREE.BufferGeometry,
    private readonly material: THREE.Material,
    initial = 256,
    private readonly shadows = true,
  ) {
    this.parent = parent;
    this.capacity = initial;
    this.mesh = this.create(initial);
    PartPool.all.add(this);
  }

  /** Uploads only the changed slots of every pool. Call once per frame before rendering. */
  static flushAll(): void {
    for (const pool of PartPool.all) pool.flush();
  }

  private flush(): void {
    if (this.dirtyHi >= 0) {
      const attr = this.mesh.instanceMatrix;
      attr.clearUpdateRanges();
      attr.addUpdateRange(this.dirtyLo * 16, (this.dirtyHi - this.dirtyLo + 1) * 16);
      attr.needsUpdate = true;
      this.dirtyLo = Infinity;
      this.dirtyHi = -1;
    }
    if (this.colorHi >= 0 && this.mesh.instanceColor) {
      const attr = this.mesh.instanceColor;
      attr.clearUpdateRanges();
      attr.addUpdateRange(this.colorLo * 3, (this.colorHi - this.colorLo + 1) * 3);
      attr.needsUpdate = true;
      this.colorLo = Infinity;
      this.colorHi = -1;
    }
  }

  private markMatrix(slot: number): void {
    if (slot < this.dirtyLo) this.dirtyLo = slot;
    if (slot > this.dirtyHi) this.dirtyHi = slot;
  }

  private markColor(slot: number): void {
    if (slot < this.colorLo) this.colorLo = slot;
    if (slot > this.colorHi) this.colorHi = slot;
  }

  private create(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = this.shadows;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    // A fixed bound covering the whole diorama, so raycasts never use a stale one.
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(64, 0, 64), 140);
    this.parent.add(mesh);
    return mesh;
  }

  alloc(): number {
    if (this.free.length) return this.free.pop()!;
    if (this.used >= this.capacity) this.grow();
    const slot = this.used++;
    this.mesh.count = this.used;
    return slot;
  }

  release(slot: number): void {
    this.mesh.setMatrixAt(slot, PartPool.hidden);
    this.markMatrix(slot);
    this.free.push(slot);
  }

  set(slot: number, matrix: THREE.Matrix4, color?: THREE.Color): void {
    this.mesh.setMatrixAt(slot, matrix);
    this.markMatrix(slot);
    if (color) {
      this.mesh.setColorAt(slot, color);
      this.markColor(slot);
    }
  }

  setMatrix(slot: number, matrix: THREE.Matrix4): void {
    this.mesh.setMatrixAt(slot, matrix);
    this.markMatrix(slot);
  }

  setColor(slot: number, color: THREE.Color): void {
    this.mesh.setColorAt(slot, color);
    this.markColor(slot);
  }

  private grow(): void {
    const old = this.mesh;
    const next = this.create(this.capacity * 2);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let i = 0; i < this.used; i++) {
      old.getMatrixAt(i, m);
      next.setMatrixAt(i, m);
      old.getColorAt(i, c);
      next.setColorAt(i, c);
    }
    next.count = this.used;
    next.instanceMatrix.needsUpdate = true;
    if (next.instanceColor) next.instanceColor.needsUpdate = true;
    this.dirtyLo = Infinity;
    this.dirtyHi = -1;
    this.colorLo = Infinity;
    this.colorHi = -1;
    this.parent.remove(old);
    old.dispose();
    this.mesh = next;
    this.capacity *= 2;
  }

  /** Releases everything. */
  clear(): void {
    this.free = [];
    this.used = 0;
    this.mesh.count = 0;
  }
}
