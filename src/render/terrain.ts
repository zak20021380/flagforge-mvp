import {
  Color3,
  DynamicTexture,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Texture,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core';
import {
  ARENA_TEXTURE_U_SCALE,
  ARENA_TEXTURE_V_SCALE,
  MAIN_ARENA_TEXTURE_ROTATION,
  MAIN_ARENA_TEXTURE_U_OFFSET,
  MAIN_ARENA_TEXTURE_V_OFFSET,
  MAIN_ARENA_VISUAL_LENGTH,
  MAIN_ARENA_VISUAL_WIDTH,
  MAIN_ARENA_Y,
  OUTER_FILLER_CENTER_X,
  OUTER_FILLER_CENTER_Z,
  OUTER_FILLER_LENGTH,
  OUTER_FILLER_WIDTH,
  OUTER_FILLER_Y,
  PORTRAIT_LAYOUT,
} from '../core/config';
import { clamp } from '../core/math';
import { smoothStep, valueNoise } from './decorKit';
import { MaterialLibrary } from './materials';

const ARENA = PORTRAIT_LAYOUT.arena;
const LANES = [-ARENA.laneOffset, 0, ARENA.laneOffset];
const RIVER_HALF_DEPTH = ARENA.riverDepth / 2;
const GROUND_HALF_WIDTH = ARENA.groundWidth / 2;
const GROUND_HALF_LENGTH = ARENA.groundLength / 2;

const ARENA_TEXTURE_URL = '/assets/textures/arena/flagforge-arena-forest.png';
const OUTER_FILLER_TEXTURE_WIDTH = 512;
const OUTER_FILLER_TEXTURE_HEIGHT = 800;
const OUTER_FILLER_TILE_COLUMNS = 4;
const OUTER_FILLER_TILE_ROWS = 8;

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
  Math.abs(Math.abs(z) - ARENA.riverZ) < RIVER_HALF_DEPTH + margin;

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
  createOuterForestFiller(scene);
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

/**
 * Builds a small mobile-friendly texture once from forest-only corner patches in the existing
 * arena artwork. Mirrored placement varies the canopy pattern without ever copying the authored
 * lanes, rivers, bridges, castles, or central objective into the outer surroundings.
 */
function createOuterForestTexture(scene: Scene): DynamicTexture {
  const texture = new DynamicTexture('outer-forest-filler-texture', {
    width: OUTER_FILLER_TEXTURE_WIDTH,
    height: OUTER_FILLER_TEXTURE_HEIGHT,
  }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = Math.max(1, Math.min(2, scene.getEngine().getCaps().maxAnisotropy));

  const context = texture.getContext();
  context.fillStyle = '#193c2a';
  context.fillRect(0, 0, OUTER_FILLER_TEXTURE_WIDTH, OUTER_FILLER_TEXTURE_HEIGHT);
  texture.update(false);

  const source = new Image();
  source.decoding = 'async';
  source.onload = (): void => {
    const patchSize = Math.floor(Math.min(source.naturalWidth * 0.16, source.naturalHeight * 0.1));
    const inset = Math.max(2, Math.floor(patchSize * 0.025));
    const patches = [
      { x: inset, y: inset },
      { x: source.naturalWidth - patchSize - inset, y: inset },
      { x: inset, y: source.naturalHeight - patchSize - inset },
      {
        x: source.naturalWidth - patchSize - inset,
        y: source.naturalHeight - patchSize - inset,
      },
    ];
    const tileWidth = OUTER_FILLER_TEXTURE_WIDTH / OUTER_FILLER_TILE_COLUMNS;
    const tileHeight = OUTER_FILLER_TEXTURE_HEIGHT / OUTER_FILLER_TILE_ROWS;

    for (let row = 0; row < OUTER_FILLER_TILE_ROWS; row += 1) {
      for (let column = 0; column < OUTER_FILLER_TILE_COLUMNS; column += 1) {
        const patch = patches[(row * 3 + column * 5 + row * column) % patches.length];
        const flipX = (row + column) % 2 === 1;
        const flipY = (row * 2 + column) % 3 === 1;
        const destinationX = column * tileWidth;
        const destinationY = row * tileHeight;

        context.save();
        context.translate(destinationX + tileWidth / 2, destinationY + tileHeight / 2);
        context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
        context.drawImage(
          source,
          patch.x,
          patch.y,
          patchSize,
          patchSize,
          -tileWidth / 2 - 1,
          -tileHeight / 2 - 1,
          tileWidth + 2,
          tileHeight + 2,
        );
        context.restore();
      }
    }

    texture.update(false);
    source.onload = null;
    source.onerror = null;
  };
  source.onerror = (): void => {
    source.onload = null;
    source.onerror = null;
  };
  source.src = ARENA_TEXTURE_URL;

  return texture;
}

/** A render-only underlay fills the complete measured camera footprint beneath the main art. */
function createOuterForestFiller(scene: Scene): void {
  const material = new StandardMaterial('mat-outer-forest-filler', scene);
  material.diffuseTexture = createOuterForestTexture(scene);
  material.diffuseColor = Color3.White();
  material.specularColor = Color3.Black();
  material.disableLighting = false;
  material.freeze();

  const surface = MeshBuilder.CreateGround('outer-forest-filler', {
    width: OUTER_FILLER_WIDTH,
    height: OUTER_FILLER_LENGTH,
    subdivisions: 1,
  }, scene);
  surface.position.set(OUTER_FILLER_CENTER_X, OUTER_FILLER_Y, OUTER_FILLER_CENTER_Z);
  surface.material = material;
  surface.isPickable = false;
  surface.checkCollisions = false;
  surface.receiveShadows = false;
  surface.freezeWorldMatrix();
}

/** One render-only mesh carries the complete authored main arena surface unchanged. */
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
  texture.uOffset = MAIN_ARENA_TEXTURE_U_OFFSET;
  texture.vOffset = MAIN_ARENA_TEXTURE_V_OFFSET;
  texture.uRotationCenter = 0.5;
  texture.vRotationCenter = 0.5;
  texture.wAng = MAIN_ARENA_TEXTURE_ROTATION;

  const material = new StandardMaterial('mat-arena-artwork-surface', scene);
  material.diffuseTexture = texture;
  material.diffuseColor = Color3.White();
  material.specularColor = Color3.Black();
  material.disableLighting = false;
  material.freeze();

  const surface = MeshBuilder.CreateGround('arena-artwork-surface', {
    width: MAIN_ARENA_VISUAL_WIDTH,
    height: MAIN_ARENA_VISUAL_LENGTH,
    subdivisions: 1,
  }, scene);
  surface.position.set(0, MAIN_ARENA_Y, 0);
  surface.material = material;
  surface.isPickable = false;
  surface.checkCollisions = false;
  surface.receiveShadows = true;
  surface.freezeWorldMatrix();
}
