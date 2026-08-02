import {
  Color3,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Texture,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core';
import {
  ARENA_ARTWORK_SURFACE,
  ARENA_RIVERS,
  ARENA_TEXTURE_ROTATION,
  ARENA_TEXTURE_U_OFFSET,
  ARENA_TEXTURE_U_SCALE,
  ARENA_TEXTURE_V_OFFSET,
  ARENA_TEXTURE_V_SCALE,
  PORTRAIT_LAYOUT,
} from '../core/config';
import { clamp } from '../core/math';
import { smoothStep, valueNoise } from './decorKit';
import { MaterialLibrary } from './materials';

const ARENA = PORTRAIT_LAYOUT.arena;
const LANES = [-ARENA.laneOffset, 0, ARENA.laneOffset];
const GROUND_HALF_WIDTH = ARENA.groundWidth / 2;
const GROUND_HALF_LENGTH = ARENA.groundLength / 2;

// Expanded-top authored arena PNG (1248 x 2256). The canvas grew symmetrically around the original
// 1936px content — 160px of extra forest above the red side and 160px below the blue side — so the
// formerly empty/dark region beyond the red castle is now painted out to z = 107.196.
const ARENA_TEXTURE_URL = '/assets/textures/arena/flagforge-arena-forest.png';

// Geometry and the pixel -> world mapping both live in src/core/config.ts, next to the landmark
// measurements and the castle/tower roots derived from them, so the painting and the objects
// standing on it can never drift apart again.
const VISUAL_SURFACE_WIDTH = ARENA_ARTWORK_SURFACE.width;
const VISUAL_SURFACE_LENGTH = ARENA_ARTWORK_SURFACE.length;
const VISUAL_SURFACE_CENTER_X = ARENA_ARTWORK_SURFACE.centerX;
const VISUAL_SURFACE_CENTER_Z = ARENA_ARTWORK_SURFACE.centerZ;

const laneHalfWidth = (lane: number): number => (lane === 0 ? ARENA.centerRoadWidth : ARENA.sideRoadWidth) / 2;

/**
 * Signed clearance to the nearest lane road edge. Negative means the point sits on a road, so
 * every prop placement can cheaply guarantee the marching lanes stay empty and readable.
 */
export function roadClearance(x: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const lane of LANES) best = Math.min(best, Math.abs(x - lane) - laneHalfWidth(lane));
  return best;
}

export const isNearWater = (z: number, margin = 0.6): boolean =>
  ARENA_RIVERS.some((channel) => z > channel.minZ - margin && z < channel.maxZ + margin);

/** Deployment pads are read as UI, so no decoration is allowed to stand on or overhang one. */
export const isOnDeploymentPad = (x: number, z: number, margin = 0): boolean =>
  Math.abs(x) < ARENA.deploymentWidth / 2 + margin
  && Math.abs(Math.abs(z) - ARENA.deploymentCenterZ) < ARENA.deploymentDepth / 2 + margin;

/**
 * Rolling ground outside the arena. The displacement is masked to zero across the playfield
 * footprint so the battlefield itself stays perfectly flat for unit movement and picking.
 */
export function surroundingsHeight(x: number, z: number): number {
  const flatHalfWidth = ARENA.foundationWidth / 2 + 1.1;
  const flatHalfLength = ARENA.foundationLength / 2 + 1.2;
  const mask = smoothStep(0, 1, clamp(Math.max(
    (Math.abs(x) - flatHalfWidth) / 11.5,
    (Math.abs(z) - flatHalfLength) / 14,
  ), 0, 1));
  const rolling = valueNoise(x * 0.032 + 12.7, z * 0.026 - 5.3) - 0.5;
  const detail = valueNoise(x * 0.105 - 4.1, z * 0.093 + 9.6) - 0.5;
  return mask * (rolling * 5.6 + detail * 1.4);
}

export function createTerrain(scene: Scene, materials: MaterialLibrary): void {
  createSurroundingTerrain(scene, materials);
  createArenaPlatform(scene, materials);
  createPlayfieldGround(scene, materials);
  createArenaArtworkSurface(scene);
}

function createSurroundingTerrain(scene: Scene, materials: MaterialLibrary): void {
  const terrain = MeshBuilder.CreateGround('arena-surroundings', {
    width: 122,
    height: 196,
    subdivisionsX: 26,
    subdivisionsY: 34,
    updatable: true,
  }, scene);
  terrain.position.y = -0.84;
  // The forest PNG now owns the complete visible surroundings. Retain this generated mesh only as
  // dormant geometry so height sampling for perimeter props stays unchanged.
  terrain.material = materials.grass;
  terrain.isPickable = false;
  terrain.visibility = 0;

  const positions = terrain.getVerticesData(VertexBuffer.PositionKind)!;
  const colors = new Float32Array((positions.length / 3) * 4);
  for (let i = 0, c = 0; i < positions.length; i += 3, c += 4) {
    const x = positions[i];
    const z = positions[i + 2];
    const height = surroundingsHeight(x, z);
    positions[i + 1] = height;
    const shade = valueNoise(x * 0.058 + 1.7, z * 0.049 - 2.3);
    const slope = clamp(height / 3.4, -1, 1);
    const tint = 0.82 + shade * 0.15 + slope * 0.1;
    colors[c] = tint * 0.93;
    colors[c + 1] = tint;
    colors[c + 2] = tint * 0.85;
    colors[c + 3] = 1;
  }
  terrain.updateVerticesData(VertexBuffer.PositionKind, positions);
  terrain.setVerticesData(VertexBuffer.ColorKind, colors, false);

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, terrain.getIndices()!, normals);
  terrain.updateVerticesData(VertexBuffer.NormalKind, normals);
  terrain.refreshBoundingInfo();
  terrain.freezeWorldMatrix();
}

/** Stone plinth under the battlefield; its old top-edge trim is now painted into the PNG. */
function createArenaPlatform(scene: Scene, materials: MaterialLibrary): void {
  const foundation = MeshBuilder.CreateBox('arena-foundation', {
    width: ARENA.foundationWidth,
    height: 0.75,
    depth: ARENA.foundationLength,
  }, scene);
  foundation.position.y = -0.43;
  foundation.material = materials.stoneDark;
  foundation.isPickable = false;
  foundation.freezeWorldMatrix();
}

/**
 * Deployment picking depends on this mesh's exact geometry and name. Keep it intact and pickable,
 * but suppress rendering so it cannot cover or fight with the dedicated artwork surface.
 */
function createPlayfieldGround(scene: Scene, materials: MaterialLibrary): void {
  const ground = MeshBuilder.CreateGround('arena-ground', {
    width: ARENA.groundWidth,
    height: ARENA.groundLength,
    subdivisionsX: 20,
    subdivisionsY: 50,
    updatable: true,
  }, scene);
  ground.material = materials.grass;
  ground.receiveShadows = true;
  ground.visibility = 0;

  const positions = ground.getVerticesData(VertexBuffer.PositionKind)!;
  const colors = new Float32Array((positions.length / 3) * 4);
  for (let i = 0, c = 0; i < positions.length; i += 3, c += 4) {
    const x = positions[i];
    const z = positions[i + 2];
    const broad = valueNoise(x * 0.052 + 3.4, z * 0.044 - 1.9);
    const tint = 0.94 + broad * 0.1;
    const falloff = 1
      - 0.12 * smoothStep(10.2, GROUND_HALF_WIDTH, Math.abs(x))
      - 0.09 * smoothStep(25, GROUND_HALF_LENGTH, Math.abs(z));
    colors[c] = tint * 0.94 * falloff;
    colors[c + 1] = tint * 1.02 * falloff;
    colors[c + 2] = tint * 0.89 * falloff;
    colors[c + 3] = 1;
  }
  ground.setVerticesData(VertexBuffer.ColorKind, colors, false);
  ground.freezeWorldMatrix();
}

/** One render-only mesh carries the complete authored arena surface. */
function createArenaArtworkSurface(scene: Scene): void {
  const texture = new Texture(ARENA_TEXTURE_URL, scene, {
    noMipmap: false,
    invertY: true,
    samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
  });
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = Math.max(1, Math.min(4, scene.getEngine().getCaps().maxAnisotropy));
  texture.uScale = ARENA_TEXTURE_U_SCALE;
  texture.vScale = ARENA_TEXTURE_V_SCALE;
  texture.uOffset = ARENA_TEXTURE_U_OFFSET;
  texture.vOffset = ARENA_TEXTURE_V_OFFSET;
  texture.uRotationCenter = 0.5;
  texture.vRotationCenter = 0.5;
  texture.wAng = ARENA_TEXTURE_ROTATION;

  const material = new StandardMaterial('mat-arena-artwork-surface', scene);
  material.diffuseTexture = texture;
  material.diffuseColor = Color3.White();
  material.specularColor = Color3.Black();
  material.disableLighting = false;
  material.freeze();

  const surface = MeshBuilder.CreateGround('arena-artwork-surface', {
    width: VISUAL_SURFACE_WIDTH,
    height: VISUAL_SURFACE_LENGTH,
    subdivisions: 1,
  }, scene);
  surface.position.set(VISUAL_SURFACE_CENTER_X, 0, VISUAL_SURFACE_CENTER_Z);
  surface.material = material;
  surface.isPickable = false;
  surface.checkCollisions = false;
  surface.receiveShadows = true;
  surface.freezeWorldMatrix();
}
