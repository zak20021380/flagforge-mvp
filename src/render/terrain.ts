import {
  MeshBuilder,
  Scene,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core';
import { PORTRAIT_LAYOUT } from '../core/config';
import { clamp } from '../core/math';
import { createRandom, Scatter, smoothStep, StaticBatch, valueNoise } from './decorKit';
import { MaterialLibrary } from './materials';

const ARENA = PORTRAIT_LAYOUT.arena;
const LANES = [-ARENA.laneOffset, 0, ARENA.laneOffset];
const RIVER_HALF_DEPTH = 1.25;
const BRIDGE_HALF = 2.05;
const ROAD_HALF_LENGTH = ARENA.roadLength / 2;
const GROUND_HALF_WIDTH = ARENA.groundWidth / 2;
const GROUND_HALF_LENGTH = ARENA.groundLength / 2;

/** Paved courtyard around the central objective (flat, so it never hides a unit). */
export const PLAZA_HALF_X = 7.55;
export const PLAZA_HALF_Z = 6.5;

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

export const isOnPlaza = (x: number, z: number): boolean =>
  Math.abs(x) < PLAZA_HALF_X + 0.4 && Math.abs(z) < PLAZA_HALF_Z + 0.4;

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

export function createTerrain(scene: Scene, materials: MaterialLibrary, density: number): void {
  createSurroundingTerrain(scene, materials);
  createArenaPlatform(scene, materials);
  createPlayfieldGround(scene, materials);
  createRoads(scene, materials);
  createRiverAndBridges(scene, materials);
  createCenterPlaza(scene, materials);
  createGroundDetail(scene, materials, density);
  createDeploymentZones(scene, materials);
  createSideWalls(scene, materials);
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
  terrain.material = materials.foliageDark;
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
    colors[c] = 0.84 + shade * 0.34 + slope * 0.14;
    colors[c + 1] = 0.9 + shade * 0.24 + slope * 0.1;
    colors[c + 2] = 0.88 + shade * 0.18 - slope * 0.05;
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
  for (const x of [-trimX, trimX]) {
    for (const z of [-trimZ, trimZ]) {
      const corner = MeshBuilder.CreateBox(`arena-trim-corner-${x}-${z}`, { width: 1.5, height: 0.44, depth: 1.5 }, scene);
      corner.position.set(x, 0.02, z);
      corner.material = materials.stoneLight;
      batch.add(corner);
    }
  }
  batch.flush('arena-platform-trim');
}

/**
 * The playfield stays one flat pickable ground mesh (deployment picking and unit heights depend
 * on it). All variation is baked into vertex colours at load: trodden earth along the lanes and
 * around the objective, richer grass in the quiet corners, and a soft vignette that pulls the
 * eye to the centre. No textures, no decals, no extra draw calls, zero runtime cost.
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
    const broad = valueNoise(x * 0.082 + 3.4, z * 0.068 - 1.9);
    const fine = valueNoise(x * 0.29 - 7.2, z * 0.26 + 4.5);
    const patch = broad * 0.74 + fine * 0.26;
    const trodden = 1 - smoothStep(0.15, 2.9, roadClearance(x));
    const objective = 1 - smoothStep(7, 14.5, Math.hypot(x, z * 0.85));
    const staging = smoothStep(11.5, 15.5, Math.abs(z)) * (1 - smoothStep(20.5, 24, Math.abs(z)));
    const wear = clamp(trodden * 0.64 + objective * 0.38 + staging * 0.2, 0, 1);
    const vignette = 1
      - 0.22 * smoothStep(9.4, GROUND_HALF_WIDTH, Math.abs(x))
      - 0.16 * smoothStep(23, GROUND_HALF_LENGTH, Math.abs(z));
    colors[c] = (0.88 + patch * 0.2 + wear * 0.4) * vignette;
    colors[c + 1] = (0.93 + patch * 0.16 + wear * 0.12) * vignette;
    colors[c + 2] = (0.86 + patch * 0.12 - wear * 0.22) * vignette;
    colors[c + 3] = 1;
  }
  ground.setVerticesData(VertexBuffer.ColorKind, colors, false);
  ground.freezeWorldMatrix();
}

/** Lane roads plus the dressed stone border and castle-approach paving that frame them. */
function createRoads(scene: Scene, materials: MaterialLibrary): void {
  const batch = new StaticBatch();
  for (const lane of LANES) {
    const width = laneHalfWidth(lane) * 2;
    // A wider, lower slab under each road reads as a dressed kerb line along the whole lane.
    const border = MeshBuilder.CreateBox(`road-border-${lane}`, {
      width: width + 0.95,
      height: 0.09,
      depth: ARENA.roadLength + 1.2,
    }, scene);
    border.position.set(lane, 0.035, 0);
    border.material = materials.stoneWarm;
    batch.add(border);

    const road = MeshBuilder.CreateBox(`stone-road-${lane}`, { width, height: 0.12, depth: ARENA.roadLength }, scene);
    road.position.set(lane, 0.05, 0);
    road.material = materials.road;
    road.isPickable = false;
    road.receiveShadows = true;
    road.freezeWorldMatrix();

    for (const side of [-1, 1]) {
      const apron = MeshBuilder.CreateBox(`road-apron-${lane}-${side}`, {
        width: width + 2.6,
        height: 0.1,
        depth: 3.6,
      }, scene);
      apron.position.set(lane, 0.045, side * (ROAD_HALF_LENGTH - 1.3));
      apron.material = materials.paving;
      batch.add(apron);
    }
  }
  batch.flush('road-dressing', true);
}

/**
 * Layered water: a dark bed under a translucent surface, stone kerbs and a pale shallow line
 * along every stretch of bank that is not covered by a bridge.
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

        const shallow = MeshBuilder.CreateBox(`river-shallow-${riverZ}-${centre}-${side}`, { width: width - 0.12, height: 0.06, depth: 0.46 }, scene);
        shallow.position.set(centre, 0.055, riverZ + side * (RIVER_HALF_DEPTH - 0.36));
        shallow.material = materials.waterShallow;
        batch.add(shallow);
      }
    }
  }
  createBridges(scene, materials, batch);
  batch.flush('river-dressing');
}

/** Bridge decks keep their footprint; the dressing is low kerbs and short corner posts only. */
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

        for (const end of [-1, 1]) {
          const post = MeshBuilder.CreateBox(`bridge-post-${lane}-${riverZ}-${side}-${end}`, { width: 0.44, height: 0.58, depth: 0.44 }, scene);
          post.position.set(lane + side * 2, 0.46, riverZ + end * 2.06);
          post.material = materials.stoneWarm;
          batch.add(post);

          const cap = MeshBuilder.CreateCylinder(`bridge-cap-${lane}-${riverZ}-${side}-${end}`, {
            height: 0.16,
            diameterTop: 0.12,
            diameterBottom: 0.5,
            tessellation: 4,
          }, scene);
          cap.position.set(lane + side * 2, 0.81, riverZ + end * 2.06);
          cap.material = materials.gold;
          batch.add(cap);
        }
      }
    }
  }
}

/**
 * Courtyard around the central objective. Everything here is flat paving, inlay or wear, so the
 * centre reads as the most important place on the map without adding a single occluder.
 */
function createCenterPlaza(scene: Scene, materials: MaterialLibrary): void {
  const batch = new StaticBatch();
  const rim = MeshBuilder.CreateCylinder('plaza-rim', {
    height: 0.05,
    diameter: (PLAZA_HALF_X + 0.6) * 2,
    tessellation: 16,
  }, scene);
  rim.position.y = 0.025;
  rim.scaling.z = (PLAZA_HALF_Z + 0.6) / (PLAZA_HALF_X + 0.6);
  rim.material = materials.stoneWarm;
  batch.add(rim);

  const deck = MeshBuilder.CreateCylinder('plaza-deck', { height: 0.07, diameter: PLAZA_HALF_X * 2, tessellation: 16 }, scene);
  deck.position.y = 0.035;
  deck.scaling.z = PLAZA_HALF_Z / PLAZA_HALF_X;
  deck.material = materials.paving;
  batch.add(deck);

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wedge = MeshBuilder.CreateBox(`plaza-wedge-${sx}-${sz}`, { width: 4.6, height: 0.03, depth: 2 }, scene);
      wedge.position.set(sx * 4.35, 0.075, sz * 4.45);
      wedge.rotation.y = sx * sz * 0.7;
      wedge.material = materials.stoneLight;
      batch.add(wedge);

      const step = MeshBuilder.CreateBox(`plaza-step-${sx}-${sz}`, { width: 1.5, height: 0.16, depth: 1.1 }, scene);
      step.position.set(sx * 3.25, 0.07, sz * 4.15);
      step.material = materials.stoneWarm;
      batch.add(step);
    }
  }

  // Earth worn bare where units crowd the tower base, and a gold inlay ring marking the prize.
  const worn = MeshBuilder.CreateTorus('plaza-worn-ring', { diameter: 10.2, thickness: 2.4, tessellation: 20 }, scene);
  worn.position.y = 0.085;
  worn.scaling.y = 0.012;
  worn.material = materials.dirt;
  batch.add(worn);

  const inlay = MeshBuilder.CreateTorus('plaza-inlay-ring', { diameter: 11.4, thickness: 0.34, tessellation: 28 }, scene);
  inlay.position.y = 0.135;
  inlay.scaling.y = 0.11;
  inlay.material = materials.gold;
  batch.add(inlay);
  batch.flush('plaza-dressing', true);
}

/**
 * Ground dressing: seeded flat patches of dirt, dry grass, lush grass, moss and paving that break
 * up the tinted grass. Patches are pure decals (2cm tall, never pickable) merged per material, so
 * the whole layer is five draw calls and can never hide a unit or block a deployment pick.
 */
function createGroundDetail(scene: Scene, materials: MaterialLibrary, density: number): void {
  const batch = new StaticBatch();
  const random = createRandom(9137);
  const palette = [materials.dirt, materials.grassDry, materials.grassLush, materials.stoneMoss, materials.paving];
  const target = Math.round(118 * density);
  for (let attempt = 0, placed = 0; attempt < target * 8 && placed < target; attempt += 1) {
    const x = (random() * 2 - 1) * (GROUND_HALF_WIDTH - 0.8);
    const z = (random() * 2 - 1) * 23.5;
    const radius = 0.55 + random() * 1.35;
    const inDeployment = Math.abs(Math.abs(z) - ARENA.deploymentCenterZ) < ARENA.deploymentDepth / 2
      && Math.abs(x) < ARENA.deploymentWidth / 2;
    if (roadClearance(x) < radius + 0.12 || isNearWater(z, 1 + radius) || isOnPlaza(x, z) || inDeployment) continue;
    const patch = MeshBuilder.CreateCylinder(`ground-patch-${placed}`, {
      height: 0.02,
      diameter: radius * 2,
      tessellation: 7,
    }, scene);
    // Each patch gets its own height inside a 2cm band so overlapping decals never z-fight.
    patch.position.set(x, 0.012 + random() * 0.016, z);
    patch.rotation.y = random() * Math.PI;
    patch.scaling.z = 0.55 + random() * 0.8;
    patch.material = palette[Math.floor(random() * palette.length)];
    batch.add(patch);
    placed += 1;
  }
  batch.flush('ground-patch');
  createLaneKerbs(scene, materials, density);
}

/**
 * Kerb stones marking every road edge: raised blocks out on the verge where they read as masonry,
 * and flattened inlay slabs in the gaps units walk through, so nothing ever clips a marching unit.
 * All of them are thin instances of a single box, so the entire lane trim is one draw call.
 */
function createLaneKerbs(scene: Scene, materials: MaterialLibrary, density: number): void {
  const source = MeshBuilder.CreateBox('lane-kerb-source', { width: 0.36, height: 0.26, depth: 0.64 }, scene);
  source.material = materials.stoneWarm;
  const kerbs = new Scatter(source);
  const spacing = 2.4 / clamp(density, 0.5, 1);
  for (const lane of LANES) {
    for (const side of [-1, 1]) {
      const x = lane + side * (laneHalfWidth(lane) + 0.72);
      const raised = Math.abs(x) > 8;
      for (let z = -ROAD_HALF_LENGTH + 1.2; z <= ROAD_HALF_LENGTH - 1.2; z += spacing) {
        if (isNearWater(z, 1.6) || isOnPlaza(x, z)) continue;
        const jitter = Math.abs((z * 17.3) % 1) * 0.12;
        if (raised) kerbs.add(x + jitter * 0.4, 0.13, z, jitter, 1, 0.85 + jitter, 1);
        else kerbs.add(x, 0.018, z, jitter * 0.3, 1.25, 0.14, 1.5);
      }
    }
  }
  kerbs.finish();
}

/**
 * Deployment pads. The tinted slabs keep their exact names, size and pickability because
 * deployment input ray-picks them by name; everything added here is non-pickable dressing.
 */
function createDeploymentZones(scene: Scene, materials: MaterialLibrary): void {
  const batch = new StaticBatch();
  const halfWidth = ARENA.deploymentWidth / 2;
  const halfDepth = ARENA.deploymentDepth / 2;
  for (const teamZ of [-ARENA.deploymentCenterZ, ARENA.deploymentCenterZ]) {
    const zone = MeshBuilder.CreateBox(`deployment-zone-${teamZ}`, {
      width: ARENA.deploymentWidth,
      height: 0.035,
      depth: ARENA.deploymentDepth,
    }, scene);
    zone.position.set(0, 0.125, teamZ);
    zone.material = teamZ < 0 ? materials.glowBlue : materials.glowRed;
    zone.isPickable = true;

    const accent = teamZ < 0 ? materials.blueDark : materials.redDark;
    for (const side of [-1, 1]) {
      const rail = MeshBuilder.CreateBox(`deploy-trim-x-${teamZ}-${side}`, { width: ARENA.deploymentWidth + 1.2, height: 0.03, depth: 0.42 }, scene);
      rail.position.set(0, 0.02, teamZ + side * (halfDepth + 0.3));
      rail.material = materials.stoneLight;
      batch.add(rail);

      const edge = MeshBuilder.CreateBox(`deploy-trim-z-${teamZ}-${side}`, { width: 0.42, height: 0.03, depth: ARENA.deploymentDepth + 1.2 }, scene);
      edge.position.set(side * (halfWidth + 0.3), 0.02, teamZ);
      edge.material = materials.stoneLight;
      batch.add(edge);
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = MeshBuilder.CreateBox(`deploy-post-${teamZ}-${sx}-${sz}`, { width: 0.42, height: 1.05, depth: 0.42 }, scene);
        post.position.set(sx * (halfWidth - 0.5), 0.52, teamZ + sz * (halfDepth + 0.32));
        post.material = materials.stoneWarm;
        batch.add(post);

        const cap = MeshBuilder.CreateBox(`deploy-post-cap-${teamZ}-${sx}-${sz}`, { width: 0.6, height: 0.2, depth: 0.6 }, scene);
        cap.position.set(sx * (halfWidth - 0.5), 1.13, teamZ + sz * (halfDepth + 0.32));
        cap.material = accent;
        batch.add(cap);
      }
    }
  }
  batch.flush('deployment-dressing');
}

/**
 * Side walls framing the arena. The wall itself keeps its original footprint; the polish is a
 * capstone and a rhythm of pillars, which give the edges a built silhouette without stealing any
 * playable width (the inner pillar face stops just outside the unit bounds).
 */
function createSideWalls(scene: Scene, materials: MaterialLibrary): void {
  const batch = new StaticBatch();
  for (const x of [-ARENA.sideWallX, ARENA.sideWallX]) {
    const wall = MeshBuilder.CreateBox(`side-wall-${x}`, { width: 0.9, height: 1.25, depth: ARENA.sideWallLength }, scene);
    wall.position.set(x, 0.65, 0);
    wall.material = materials.stoneDark;
    wall.isPickable = false;
    wall.receiveShadows = true;
    wall.freezeWorldMatrix();

    const capstone = MeshBuilder.CreateBox(`side-wall-cap-${x}`, { width: 1.16, height: 0.18, depth: ARENA.sideWallLength }, scene);
    capstone.position.set(x, 1.36, 0);
    capstone.material = materials.stoneLight;
    batch.add(capstone);

    const half = ARENA.sideWallLength / 2;
    for (let index = 0; index <= 11; index += 1) {
      const z = -half + (index / 11) * ARENA.sideWallLength;
      const pillar = MeshBuilder.CreateBox(`side-pillar-${x}-${index}`, { width: 1.3, height: 1.78, depth: 1.3 }, scene);
      pillar.position.set(x, 0.89, z);
      pillar.material = materials.stoneWarm;
      batch.add(pillar);

      const cap = MeshBuilder.CreateBox(`side-pillar-cap-${x}-${index}`, { width: 1.62, height: 0.22, depth: 1.62 }, scene);
      cap.position.set(x, 1.89, z);
      cap.material = materials.stoneLight;
      batch.add(cap);

      if (index % 3 === 1) {
        const finial = MeshBuilder.CreateCylinder(`side-pillar-finial-${x}-${index}`, {
          height: 0.42,
          diameterTop: 0.06,
          diameterBottom: 0.44,
          tessellation: 4,
        }, scene);
        finial.position.set(x, 2.21, z);
        finial.material = materials.gold;
        batch.add(finial);
      }
    }
  }
  batch.flush('side-wall-dressing');
}
