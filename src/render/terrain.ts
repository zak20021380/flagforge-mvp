import {
  MeshBuilder,
  Scene,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core';
import { PORTRAIT_LAYOUT } from '../core/config';
import { clamp } from '../core/math';
import { smoothStep, StaticBatch, valueNoise } from './decorKit';
import { MaterialLibrary } from './materials';

const ARENA = PORTRAIT_LAYOUT.arena;
const LANES = [-ARENA.laneOffset, 0, ARENA.laneOffset];
const RIVER_HALF_DEPTH = 1.25;
const BRIDGE_HALF = 2.05;
const GROUND_HALF_WIDTH = ARENA.groundWidth / 2;
const GROUND_HALF_LENGTH = ARENA.groundLength / 2;

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
  const mask = smoothStep(0, 1, clamp(Math.max((Math.abs(x) - 15.5) / 11.5, (Math.abs(z) - 34.5) / 14), 0, 1));
  const rolling = valueNoise(x * 0.032 + 12.7, z * 0.026 - 5.3) - 0.5;
  const detail = valueNoise(x * 0.105 - 4.1, z * 0.093 + 9.6) - 0.5;
  return mask * (rolling * 5.6 + detail * 1.4);
}

export function createTerrain(scene: Scene, materials: MaterialLibrary): void {
  createSurroundingTerrain(scene, materials);
  createArenaPlatform(scene, materials);
  createPlayfieldGround(scene, materials);
  createRoads(scene, materials);
  createRiverAndBridges(scene, materials);
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
  // Shares the playfield grass material so the world reads as one continuous meadow; the vertex
  // tint below is a touch deeper and cooler, which is all the separation the distance needs.
  terrain.material = materials.grass;
  terrain.isPickable = false;

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

/** Stone plinth the whole battlefield sits on, plus a kerb that frames the playable area. */
function createArenaPlatform(scene: Scene, materials: MaterialLibrary): void {
  const batch = new StaticBatch();
  const foundation = MeshBuilder.CreateBox('arena-foundation', {
    width: ARENA.foundationWidth,
    height: 0.75,
    depth: ARENA.foundationLength,
  }, scene);
  foundation.position.y = -0.43;
  foundation.material = materials.stoneDark;
  foundation.isPickable = false;
  foundation.freezeWorldMatrix();

  const trimX = GROUND_HALF_WIDTH + 0.35;
  const trimZ = GROUND_HALF_LENGTH + 0.32;
  for (const x of [-trimX, trimX]) {
    const trim = MeshBuilder.CreateBox(`arena-trim-x-${x}`, { width: 0.7, height: 0.2, depth: ARENA.foundationLength }, scene);
    trim.position.set(x, -0.04, 0);
    trim.material = materials.stoneWarm;
    batch.add(trim);
  }
  for (const z of [-trimZ, trimZ]) {
    const trim = MeshBuilder.CreateBox(`arena-trim-z-${z}`, { width: ARENA.foundationWidth, height: 0.2, depth: 0.66 }, scene);
    trim.position.set(0, -0.04, z);
    trim.material = materials.stoneWarm;
    batch.add(trim);
  }
  batch.flush('arena-platform-trim');
}

/**
 * The playfield stays one flat pickable ground mesh (deployment picking and unit heights depend
 * on it). It is clean, rich grass: the only thing baked into the vertex colours is a broad
 * low-amplitude tint so the meadow never reads as one flat fill, plus a very soft edge falloff
 * that keeps the eye on the centre. No trodden earth, no dirt, no textures, no runtime cost.
 */
function createPlayfieldGround(scene: Scene, materials: MaterialLibrary): void {
  const ground = MeshBuilder.CreateGround('arena-ground', {
    width: ARENA.groundWidth,
    height: ARENA.groundLength,
    subdivisionsX: 20,
    subdivisionsY: 44,
    updatable: true,
  }, scene);
  ground.material = materials.grass;
  ground.receiveShadows = true;

  const positions = ground.getVerticesData(VertexBuffer.PositionKind)!;
  const colors = new Float32Array((positions.length / 3) * 4);
  for (let i = 0, c = 0; i < positions.length; i += 3, c += 4) {
    const x = positions[i];
    const z = positions[i + 2];
    const broad = valueNoise(x * 0.052 + 3.4, z * 0.044 - 1.9);
    const tint = 0.965 + broad * 0.075;
    const falloff = 1
      - 0.09 * smoothStep(10.2, GROUND_HALF_WIDTH, Math.abs(x))
      - 0.07 * smoothStep(25, GROUND_HALF_LENGTH, Math.abs(z));
    colors[c] = tint * 0.975 * falloff;
    colors[c + 1] = tint * 1.02 * falloff;
    colors[c + 2] = tint * 0.94 * falloff;
    colors[c + 3] = 1;
  }
  ground.setVerticesData(VertexBuffer.ColorKind, colors, false);
  ground.freezeWorldMatrix();
}

/**
 * Lane roads: one restrained stone slab per lane. With the border dressing removed, the paths
 * stay distinct from the grass without adding parallel edge lines to every combat corridor.
 */
function createRoads(scene: Scene, materials: MaterialLibrary): void {
  for (const lane of LANES) {
    const width = laneHalfWidth(lane) * 2;
    const road = MeshBuilder.CreateBox(`stone-road-${lane}`, { width, height: 0.12, depth: ARENA.roadLength }, scene);
    road.position.set(lane, 0.05, 0);
    road.material = materials.road;
    road.isPickable = false;
    road.receiveShadows = true;
    road.freezeWorldMatrix();
  }
}

/**
 * Layered water: a dark bed under a translucent surface, with a single stone kerb along every
 * stretch of bank that is not covered by a bridge. Nothing else — no foam lines, no shallows —
 * so both crossings stay clean and instantly readable.
 */
function createRiverAndBridges(scene: Scene, materials: MaterialLibrary): void {
  const batch = new StaticBatch();
  const edges = [
    -ARENA.riverWidth / 2,
    ...LANES.flatMap((lane) => [lane - BRIDGE_HALF, lane + BRIDGE_HALF]),
    ARENA.riverWidth / 2,
  ];
  const bankSpans: Array<[number, number]> = [];
  for (let i = 0; i < edges.length; i += 2) {
    if (edges[i + 1] - edges[i] > 0.5) bankSpans.push([edges[i], edges[i + 1]]);
  }

  for (const riverZ of [-ARENA.riverZ, ARENA.riverZ]) {
    const bed = MeshBuilder.CreateBox(`river-bed-${riverZ}`, { width: ARENA.riverWidth + 1, height: 0.2, depth: 3.5 }, scene);
    bed.position.set(0, -0.04, riverZ);
    bed.material = materials.waterDeep;
    batch.add(bed);

    const stream = MeshBuilder.CreateBox(`stream-${riverZ}`, { width: ARENA.riverWidth, height: 0.1, depth: 2.5 }, scene);
    stream.position.set(0, 0.028, riverZ);
    stream.material = materials.water;
    stream.isPickable = false;
    stream.receiveShadows = true;
    stream.freezeWorldMatrix();

    for (const [from, to] of bankSpans) {
      const width = to - from;
      const centre = (from + to) / 2;
      for (const side of [-1, 1]) {
        const kerb = MeshBuilder.CreateBox(`river-kerb-${riverZ}-${centre}-${side}`, { width, height: 0.32, depth: 0.66 }, scene);
        kerb.position.set(centre, 0.02, riverZ + side * (RIVER_HALF_DEPTH + 0.05));
        kerb.material = materials.stoneWarm;
        batch.add(kerb);
      }
    }
  }
  createBridges(scene, materials, batch);
  batch.flush('river-dressing');
}

/** Bridge decks keep their footprint; the only dressing is a low kerb along each side. */
function createBridges(scene: Scene, materials: MaterialLibrary, batch: StaticBatch): void {
  for (const riverZ of [-ARENA.riverZ, ARENA.riverZ]) {
    for (const lane of LANES) {
      const deck = MeshBuilder.CreateBox(`bridge-${lane}-${riverZ}`, { width: 4.1, height: 0.24, depth: 4.1 }, scene);
      deck.position.set(lane, 0.15, riverZ);
      deck.material = materials.road;
      deck.isPickable = false;
      deck.receiveShadows = true;
      deck.freezeWorldMatrix();

      for (const side of [-1, 1]) {
        const kerb = MeshBuilder.CreateBox(`bridge-kerb-${lane}-${riverZ}-${side}`, { width: 0.28, height: 0.2, depth: 4.35 }, scene);
        kerb.position.set(lane + side * 2, 0.35, riverZ);
        kerb.material = materials.stoneLight;
        batch.add(kerb);
      }
    }
  }
}
