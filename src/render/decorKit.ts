import { Matrix, Mesh, Quaternion, TransformNode, Vector3 } from '@babylonjs/core';

// Every prop position is derived from a seeded generator instead of Math.random so the
// battlefield is byte-identical on every device and across reloads (helps visual QA and
// keeps the "authored" look stable rather than re-rolling clutter each match).
export function createRandom(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const hash2 = (x: number, y: number): number => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

/** Smoothed value noise used for ground tinting and the surrounding hills. */
export function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export const smoothStep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * One-off decoration (kerbs, river banks, wall pillars, castle trim...) is authored as many
 * tiny primitives and then merged per material, so a few hundred pieces collapse into a
 * handful of draw calls with no per-mesh CPU cost at runtime.
 */
export class StaticBatch {
  private readonly groups = new Map<string, Mesh[]>();

  add(mesh: Mesh): Mesh {
    const key = mesh.material?.name ?? 'unlit';
    const group = this.groups.get(key);
    if (group) group.push(mesh);
    else this.groups.set(key, [mesh]);
    mesh.isPickable = false;
    return mesh;
  }

  /**
   * Sources must be unparented while they are authored because merging bakes world matrices.
   * Passing a parent attaches the merged result afterwards, which lets a group of dressing follow
   * a root transform (castle roots carry a non-uniform width scale) while still being one mesh.
   */
  flush(prefix: string, receiveShadows = false, parent?: TransformNode): void {
    for (const [key, meshes] of this.groups) {
      const material = meshes[0].material;
      const merged = meshes.length === 1
        ? meshes[0]
        : Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
      if (!merged) continue;
      merged.name = `${prefix}-${key}`;
      merged.material = material;
      merged.isPickable = false;
      merged.receiveShadows = receiveShadows;
      if (parent) merged.parent = parent;
      merged.freezeWorldMatrix();
    }
    this.groups.clear();
  }
}

const scratchScale = new Vector3(1, 1, 1);
const scratchPosition = new Vector3();
const scratchRotation = new Quaternion();
const scratchMatrix = new Matrix();

/**
 * Repeated props (trees, bushes, rocks, grass tufts, kerb stones) share one source mesh and
 * render as thin instances: a single draw call per source, no scene node per prop, and no
 * per-instance culling or world-matrix work.
 */
export class Scatter {
  private count = 0;

  constructor(readonly source: Mesh) {
    source.isPickable = false;
    source.receiveShadows = false;
    source.doNotSyncBoundingInfo = true;
  }

  add(x: number, y: number, z: number, yaw: number, scaleX: number, scaleY: number, scaleZ: number, tilt = 0): void {
    scratchScale.set(scaleX, scaleY, scaleZ);
    scratchPosition.set(x, y, z);
    Quaternion.RotationYawPitchRollToRef(yaw, tilt * 0.6, tilt, scratchRotation);
    Matrix.ComposeToRef(scratchScale, scratchRotation, scratchPosition, scratchMatrix);
    this.source.thinInstanceAdd(scratchMatrix, false);
    this.count += 1;
  }

  addUniform(x: number, y: number, z: number, yaw: number, scale: number, tilt = 0): void {
    this.add(x, y, z, yaw, scale, scale, scale, tilt);
  }

  finish(): void {
    if (this.count === 0) {
      this.source.dispose();
      return;
    }
    this.source.thinInstanceRefreshBoundingInfo(true);
    this.source.freezeWorldMatrix();
  }
}
