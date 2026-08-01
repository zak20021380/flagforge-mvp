import { AbstractMesh, Mesh, MeshBuilder, Scene, TransformNode } from '@babylonjs/core';
import { PORTRAIT_LAYOUT } from '../core/config';
import { createRandom, Scatter, StaticBatch } from './decorKit';
import { MaterialLibrary } from './materials';
import { isNearWater, isOnPlaza, roadClearance, surroundingsHeight } from './terrain';

const ARENA = PORTRAIT_LAYOUT.arena;
const LANES = [-ARENA.laneOffset, 0, ARENA.laneOffset];
const SURROUNDINGS_Y = -0.84;

/** Ground height for props that sit outside the arena plinth. */
const outsideGround = (x: number, z: number): number => SURROUNDINGS_Y + surroundingsHeight(x, z);

/**
 * Authored anchors (banners, torches, camps, deployment posts) that scattered vegetation must
 * leave alone, so a hand-placed silhouette never ends up buried inside a random bush.
 */
const ANCHORS: Array<[number, number, number]> = [];
const reserve = (x: number, z: number, radius: number): void => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ANCHORS.push([sx * x, sz * z, radius]);
};
reserve(9, 5.4, 2.2);
reserve(9.7, 6.2, 1.5);
reserve(11.6, 17, 1.9);
reserve(10.7, 12.98, 1.3);
reserve(10.7, 21.02, 1.3);
reserve(11.2, 24.2, 3.4);
reserve(10.6, 11.5, 1.7);

const clearsAnchors = (x: number, z: number, radius: number): boolean =>
  ANCHORS.every(([ax, az, ar]) => Math.hypot(x - ax, z - az) > ar + radius);

/**
 * Half-width the portrait camera can actually see at a given depth. The outer forest is culled
 * against this instead of paying for trees behind the camera or far off frame.
 */
const visibleHalfWidth = (z: number): number => 4 + 0.24 * (z + 41);

/** Distance from the arena centre line to the nearest spot a standing prop may occupy. */
const VERGE_MIN = 8.4;
const VERGE_MAX = 12.3;

interface TreeSpecies {
  readonly trunk: Scatter;
  readonly crown: Scatter;
  readonly trunkXZ: number;
  readonly trunkY: number;
  readonly crownXZ: number;
  readonly crownY: number;
  readonly crownCenter: number;
}

interface Forest {
  readonly sources: Scatter[];
  readonly species: TreeSpecies[];
  readonly distant: TreeSpecies[];
}

/** Places one tree as two thin instances (trunk + crown) sharing a single scale and lean. */
function plantTree(species: TreeSpecies, x: number, z: number, ground: number, scale: number, yaw: number, tilt: number): void {
  const trunkY = species.trunkY * scale;
  const trunkXZ = species.trunkXZ * scale;
  species.trunk.add(x, ground + 1.2 * trunkY, z, yaw, trunkXZ, trunkY, trunkXZ, tilt);
  const crownXZ = species.crownXZ * scale;
  species.crown.add(x, ground + species.crownCenter * scale, z, yaw * 0.7, crownXZ, species.crownY * scale, crownXZ, tilt * 0.6);
}

/** A repeated prop: one source mesh, one material, one draw call for every copy on the map. */
const scatterOf = (mesh: Mesh, material: Mesh['material']): Scatter => {
  mesh.material = material;
  return new Scatter(mesh);
};

/**
 * Five tree species built from seven shared source meshes: two trunks (dark and pale bark) and
 * five crowns (two conifer cones, three broadleaf domes). Every tree on the map is a thin instance
 * of one of those meshes, so the entire treeline — verge and backdrop — is seven draw calls.
 */
function createForestSources(scene: Scene, materials: MaterialLibrary): Forest {
  const cone = (name: string, height: number, diameterBottom: number, diameterTop: number, tessellation: number): Mesh =>
    MeshBuilder.CreateCylinder(name, { height, diameterBottom, diameterTop, tessellation }, scene);

  const trunk = scatterOf(cone('tree-trunk-source', 2.4, 0.58, 0.32, 6), materials.trunk);
  const trunkPale = scatterOf(cone('tree-trunk-pale-source', 2.4, 0.42, 0.26, 6), materials.trunkPale);
  const pineCrown = scatterOf(cone('tree-crown-pine-source', 3.6, 2.7, 0, 7), materials.foliageDeep);
  const firCrown = scatterOf(cone('tree-crown-fir-source', 4.3, 2.35, 0.12, 6), materials.foliageDark);
  const oakCrown = scatterOf(MeshBuilder.CreateSphere('tree-crown-oak-source', { diameter: 2.9, segments: 5 }, scene), materials.foliage);
  const birchCrown = scatterOf(MeshBuilder.CreateSphere('tree-crown-birch-source', { diameter: 2.4, segments: 4 }, scene), materials.foliageMid);
  const blossomCrown = scatterOf(MeshBuilder.CreateSphere('tree-crown-blossom-source', { diameter: 2.5, segments: 4 }, scene), materials.foliageWarm);


  const pine: TreeSpecies = { trunk, crown: pineCrown, trunkXZ: 0.9, trunkY: 1.05, crownXZ: 0.95, crownY: 1.2, crownCenter: 3.95 };
  const fir: TreeSpecies = { trunk, crown: firCrown, trunkXZ: 0.8, trunkY: 1.25, crownXZ: 0.85, crownY: 1.35, crownCenter: 4.55 };
  const oak: TreeSpecies = { trunk, crown: oakCrown, trunkXZ: 1.1, trunkY: 0.95, crownXZ: 1.15, crownY: 0.95, crownCenter: 3.15 };
  const birch: TreeSpecies = { trunk: trunkPale, crown: birchCrown, trunkXZ: 0.85, trunkY: 1.35, crownXZ: 0.9, crownY: 1.15, crownCenter: 4.05 };
  const blossom: TreeSpecies = { trunk, crown: blossomCrown, trunkXZ: 0.95, trunkY: 0.8, crownXZ: 1.05, crownY: 0.85, crownCenter: 2.55 };

  return {
    sources: [trunk, trunkPale, pineCrown, firCrown, oakCrown, birchCrown, blossomCrown],
    species: [pine, oak, birch, blossom, fir],
    distant: [pine, fir, birch, pine, fir],
  };
}

/**
 * Verge treeline. Trees start outside the outer road edge and keep clear of the water and of
 * every authored anchor, so the marching lanes and the river crossings stay completely open.
 */
function plantVergeTrees(forest: Forest, density: number): void {
  const random = createRandom(4271);
  const target = Math.round(40 * density);
  for (let attempt = 0, planted = 0; attempt < target * 14 && planted < target; attempt += 1) {
    const side = random() < 0.5 ? -1 : 1;
    const x = side * (9.7 + random() * 2.5);
    const z = -30.5 + random() * 62;
    if (isNearWater(z, 2.4) || !clearsAnchors(x, z, 1.6)) continue;
    const species = forest.species[Math.floor(random() * forest.species.length)];
    plantTree(species, x, z, 0, 0.8 + random() * 0.45, random() * Math.PI * 2, (random() - 0.5) * 0.06);
    planted += 1;
  }
}

/**
 * Forest ring on the rolling ground outside the arena. Placement is weighted towards the far
 * half of the map, where the portrait camera actually has empty screen space behind the enemy
 * castle, and every candidate is culled against the visible cone so nothing is paid for twice.
 */
function plantOuterForest(forest: Forest, density: number): void {
  const random = createRandom(8813);
  const target = Math.round(112 * density);
  for (let attempt = 0, planted = 0; attempt < target * 10 && planted < target; attempt += 1) {
    const z = -26 + random() * 80;
    const x = (random() * 2 - 1) * visibleHalfWidth(z);
    if (Math.abs(z) < 33.8 && Math.abs(x) < 15.6) continue;
    if (random() * 90 > z + 34) continue;
    const species = forest.distant[Math.floor(random() * forest.distant.length)];
    plantTree(species, x, z, outsideGround(x, z), 0.95 + random() * 0.75, random() * Math.PI * 2, (random() - 0.5) * 0.05);
    planted += 1;
  }
}

/**
 * Low planting: bushes on the verge and outer ground, grass tufts in the safe gaps between the
 * roads, and flower clusters. Nothing here rises above knee height on a unit, so the layer adds
 * life without ever hiding a soldier, a health bar or a lane.
 */
function createUndergrowth(scene: Scene, materials: MaterialLibrary, density: number): void {
  const random = createRandom(5519);
  const bush = scatterOf(MeshBuilder.CreateSphere('bush-source', { diameter: 1.35, segments: 4 }, scene), materials.foliage);
  const bushMid = scatterOf(MeshBuilder.CreateSphere('bush-mid-source', { diameter: 1.1, segments: 4 }, scene), materials.foliageMid);
  const tuft = scatterOf(MeshBuilder.CreateCylinder('grass-tuft-source', { height: 0.52, diameterBottom: 0.34, diameterTop: 0.02, tessellation: 4 }, scene), materials.grassLush);
  const dryTuft = scatterOf(MeshBuilder.CreateCylinder('grass-dry-source', { height: 0.44, diameterBottom: 0.3, diameterTop: 0.02, tessellation: 4 }, scene), materials.grassDry);
  const flower = scatterOf(MeshBuilder.CreateSphere('flower-source', { diameter: 0.28, segments: 3 }, scene), materials.blossom);

  const bushTarget = Math.round(70 * density);
  for (let attempt = 0, placed = 0; attempt < bushTarget * 12 && placed < bushTarget; attempt += 1) {
    const side = random() < 0.5 ? -1 : 1;
    const outer = random() < 0.32;
    const x = side * (outer ? 15 + random() * 7 : VERGE_MIN + random() * (VERGE_MAX - VERGE_MIN));
    const z = outer ? -24 + random() * 74 : -30 + random() * 61;
    if (outer ? Math.abs(x) > visibleHalfWidth(z) : isNearWater(z, 1.7) || !clearsAnchors(x, z, 1)) continue;
    const scale = 0.62 + random() * 0.62;
    const source = random() < 0.5 ? bush : bushMid;
    source.add(x, (outer ? outsideGround(x, z) : 0) + 0.34 * scale, z, random() * 3, scale, scale * (0.6 + random() * 0.35), scale);
    placed += 1;
  }

  const tuftTarget = Math.round(300 * density);
  for (let attempt = 0, placed = 0; attempt < tuftTarget * 6 && placed < tuftTarget; attempt += 1) {
    const roll = random();
    const side = random() < 0.5 ? -1 : 1;
    let ground = 0;
    let x: number;
    let z: number;
    if (roll < 0.42) {
      x = side * (2.3 + random() * 2);
      z = -25 + random() * 50;
    } else if (roll < 0.8) {
      x = side * (VERGE_MIN - 0.3 + random() * 4.2);
      z = -30 + random() * 61;
    } else {
      x = side * (15 + random() * 9);
      z = -22 + random() * 70;
      ground = outsideGround(x, z);
    }
    if (roadClearance(x) < 0.24 || isNearWater(z, 1.4) || isOnPlaza(x, z)) continue;
    const scale = 0.65 + random() * 0.7;
    const source = random() < 0.62 ? tuft : dryTuft;
    source.add(x, ground + 0.24 * scale, z, random() * 3, scale, scale * (0.75 + random() * 0.6), scale, (random() - 0.5) * 0.25);
    placed += 1;
  }

  const clusterTarget = Math.round(34 * density);
  for (let attempt = 0, placed = 0; attempt < clusterTarget * 12 && placed < clusterTarget; attempt += 1) {
    const side = random() < 0.5 ? -1 : 1;
    const x = side * (VERGE_MIN + random() * (VERGE_MAX - VERGE_MIN));
    const z = -29 + random() * 59;
    if (isNearWater(z, 1.5) || !clearsAnchors(x, z, 0.8)) continue;
    for (let petal = 0; petal < 3; petal += 1) {
      const scale = 0.7 + random() * 0.8;
      flower.add(x + (random() - 0.5) * 0.7, 0.13 + random() * 0.09, z + (random() - 0.5) * 0.7, random() * 3, scale, scale, scale);
    }
    placed += 1;
  }
  for (const source of [bush, bushMid, tuft, dryTuft, flower]) source.finish();
}

/**
 * Rock variation: four low-poly boulder shapes plus a pebble, all thin-instanced, and four merged
 * standing stones that give the mid-field verge an authored landmark on each side.
 */
function createRockField(scene: Scene, materials: MaterialLibrary, batch: StaticBatch, density: number): void {
  const random = createRandom(3121);
  const rocks = [
    scatterOf(MeshBuilder.CreatePolyhedron('rock-a-source', { type: 1, size: 1.05 }, scene), materials.stoneDark),
    scatterOf(MeshBuilder.CreatePolyhedron('rock-b-source', { type: 0, size: 0.95 }, scene), materials.stone),
    scatterOf(MeshBuilder.CreatePolyhedron('rock-c-source', { type: 2, size: 0.85 }, scene), materials.stoneLight),
    scatterOf(MeshBuilder.CreatePolyhedron('rock-d-source', { type: 3, size: 0.9 }, scene), materials.stoneMoss),
  ];
  const pebble = scatterOf(MeshBuilder.CreatePolyhedron('pebble-source', { type: 1, size: 0.3 }, scene), materials.stone);

  const rockTarget = Math.round(46 * density);
  for (let attempt = 0, placed = 0; attempt < rockTarget * 12 && placed < rockTarget; attempt += 1) {
    const side = random() < 0.5 ? -1 : 1;
    const outer = random() < 0.4;
    const x = side * (outer ? 15.2 + random() * 8 : VERGE_MIN + 0.2 + random() * 3.5);
    const z = outer ? -24 + random() * 74 : -30 + random() * 61;
    if (outer ? Math.abs(x) > visibleHalfWidth(z) : !clearsAnchors(x, z, 1)) continue;
    const scale = (outer ? 0.75 : 0.5) + random() * 0.7;
    const ground = outer ? outsideGround(x, z) : 0;
    rocks[Math.floor(random() * rocks.length)]
      .add(x, ground + 0.16 * scale, z, random() * 3, scale, scale * (0.55 + random() * 0.4), scale * (0.8 + random() * 0.5), (random() - 0.5) * 0.2);
    placed += 1;
  }

  const pebbleTarget = Math.round(150 * density);
  for (let attempt = 0, placed = 0; attempt < pebbleTarget * 5 && placed < pebbleTarget; attempt += 1) {
    const side = random() < 0.5 ? -1 : 1;
    const inner = random() < 0.45;
    const x = side * (inner ? 2.25 + random() * 2.05 : VERGE_MIN - 0.4 + random() * 4.4);
    const z = -30 + random() * 60;
    if (roadClearance(x) < 0.22 || isOnPlaza(x, z)) continue;
    const scale = 0.6 + random() * 0.9;
    pebble.add(x, 0.06 * scale, z, random() * 3, scale, scale * 0.7, scale, (random() - 0.5) * 0.4);
    placed += 1;
  }
  for (const source of [...rocks, pebble]) source.finish();
  createStandingStones(scene, materials, batch);
}

/** Mossy monoliths on a paved base — four cheap landmarks that give the verge some story. */
function createStandingStones(scene: Scene, materials: MaterialLibrary, batch: StaticBatch): void {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * 10.6;
      const z = sz * 11.5;
      const yaw = sx * sz * 0.24;
      const base = MeshBuilder.CreateCylinder(`standing-stone-base-${sx}-${sz}`, { height: 0.16, diameter: 2.15, tessellation: 9 }, scene);
      base.position.set(x, 0.08, z);
      base.material = materials.stoneWarm;
      batch.add(base);

      const stone = MeshBuilder.CreateBox(`standing-stone-${sx}-${sz}`, { width: 0.86, height: 2.55, depth: 0.62 }, scene);
      stone.position.set(x, 1.3, z);
      stone.rotation.set(0, yaw, sx * 0.03);
      stone.material = materials.stoneLight;
      batch.add(stone);

      const moss = MeshBuilder.CreateBox(`standing-stone-moss-${sx}-${sz}`, { width: 0.92, height: 0.3, depth: 0.68 }, scene);
      moss.position.set(x, 2.55, z);
      moss.rotation.y = yaw;
      moss.material = materials.stoneMoss;
      batch.add(moss);
    }
  }
}

/**
 * Water-edge dressing. Reeds and lily pads only appear on the open stretches of each river,
 * never near a bridge, so the crossings stay clean and readable while the banks look finished.
 */
function createWaterEdge(scene: Scene, materials: MaterialLibrary, density: number): void {
  const random = createRandom(7717);
  const reed = scatterOf(MeshBuilder.CreateCylinder('reed-source', { height: 1.15, diameterBottom: 0.16, diameterTop: 0.02, tessellation: 4 }, scene), materials.foliageDeep);
  const lily = scatterOf(MeshBuilder.CreateCylinder('lily-pad-source', { height: 0.03, diameter: 0.62, tessellation: 6 }, scene), materials.foliageMid);
  const nearBridge = (x: number): boolean => LANES.some((lane) => Math.abs(x - lane) < 2.6);

  const reedTarget = Math.round(90 * density);
  for (let attempt = 0, placed = 0; attempt < reedTarget * 5 && placed < reedTarget; attempt += 1) {
    const x = (random() * 2 - 1) * 12.6;
    if (nearBridge(x)) continue;
    const z = (random() < 0.5 ? -ARENA.riverZ : ARENA.riverZ) + (random() < 0.5 ? -1 : 1) * (1.05 + random() * 0.8);
    const scale = 0.7 + random() * 0.7;
    reed.add(x, 0.5 * scale, z, random() * 3, scale, scale * (0.8 + random() * 0.6), scale, (random() - 0.5) * 0.3);
    placed += 1;
  }

  const lilyTarget = Math.round(40 * density);
  for (let attempt = 0, placed = 0; attempt < lilyTarget * 5 && placed < lilyTarget; attempt += 1) {
    const x = (random() * 2 - 1) * 12.4;
    if (nearBridge(x)) continue;
    const z = (random() < 0.5 ? -ARENA.riverZ : ARENA.riverZ) + (random() - 0.5) * 1.7;
    const scale = 0.7 + random() * 0.8;
    lily.add(x, 0.092, z, random() * 3, scale, 1, scale);
    placed += 1;
  }
  reed.finish();
  lily.finish();
}

/**
 * One torch: wooden post, metal bowl, flame, and a flat additive disc that fakes the pool of
 * light on the ground. The disc costs one transparent quad instead of a real light (no extra
 * shadow map, no per-pixel light loop) and the flame shares one of two glow materials, so the
 * whole map can flicker from two material updates per frame.
 */
function addTorch(
  scene: Scene,
  materials: MaterialLibrary,
  batch: StaticBatch,
  x: number,
  groundY: number,
  z: number,
  scale: number,
  warm: boolean,
  pool = true,
): void {
  const id = `${x.toFixed(1)}-${z.toFixed(1)}`;
  const post = MeshBuilder.CreateCylinder(`torch-post-${id}`, {
    height: 1.5 * scale,
    diameterBottom: 0.19 * scale,
    diameterTop: 0.13 * scale,
    tessellation: 6,
  }, scene);
  post.position.set(x, groundY + 0.75 * scale, z);
  post.material = materials.wood;
  batch.add(post);

  const bowl = MeshBuilder.CreateCylinder(`torch-bowl-${id}`, {
    height: 0.3 * scale,
    diameterTop: 0.52 * scale,
    diameterBottom: 0.24 * scale,
    tessellation: 8,
  }, scene);
  bowl.position.set(x, groundY + 1.62 * scale, z);
  bowl.material = materials.metal;
  batch.add(bowl);

  const flame = MeshBuilder.CreateSphere(`torch-flame-${id}`, { diameter: 0.42 * scale, segments: 5 }, scene);
  flame.position.set(x, groundY + 1.9 * scale, z);
  flame.scaling.set(1, 1.5, 1);
  flame.material = warm ? materials.torchGlowWarm : materials.torchGlow;
  batch.add(flame);

  if (!pool) return;
  const disc = MeshBuilder.CreateCylinder(`torch-pool-${id}`, { height: 0.02, diameter: 3.4 * scale, tessellation: 12 }, scene);
  disc.position.set(x, groundY + 0.15, z);
  disc.material = materials.lightPool;
  batch.add(disc);
}

/**
 * Firelight around everything that matters: the castle gates, the objective plaza, both river
 * crossings, the wall pillars and the centre bridges. Every position sits in the safe bands
 * between the roads or out on the verge, so no flame ever stands in a marching lane.
 */
function createTorchlight(scene: Scene, materials: MaterialLibrary, batch: StaticBatch): void {
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      addTorch(scene, materials, batch, sx * 3.5, 0, sz * 23.4, 1.15, sx * sz > 0);
      addTorch(scene, materials, batch, sx * 3.2, 0.07, sz * 5.6, 0.95, sx > 0);
      addTorch(scene, materials, batch, sx * 9.7, 0, sz * 6.2, 1, sz > 0);
    }
  }

  // Wall pillars every third bay carry a brazier; no ground pool, they light the parapet itself.
  for (const sx of [-1, 1]) {
    for (let index = 2; index <= 11; index += 3) {
      const z = -ARENA.sideWallLength / 2 + (index / 11) * ARENA.sideWallLength;
      addTorch(scene, materials, batch, sx * ARENA.sideWallX, 2, z, 0.6, index % 2 === 0, false);
    }
  }

  // Small flames on the centre bridge posts, marking the crossings after dark.
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      for (const end of [-1, 1]) {
        const flame = MeshBuilder.CreateSphere(`bridge-flame-${sx}-${sz}-${end}`, { diameter: 0.32, segments: 5 }, scene);
        flame.position.set(sx * 2, 1.03, sz * ARENA.riverZ + end * 2.06);
        flame.scaling.set(1, 1.45, 1);
        flame.material = end > 0 ? materials.torchGlow : materials.torchGlowWarm;
        batch.add(flame);
      }
    }
  }
}

/**
 * Supply camps behind each deployment pad: tents, crates, barrels, a spear rack and a campfire.
 * They are authored one-offs merged into the shared prop batch, so all four camps together add
 * nothing beyond the materials they already share with the rest of the arena.
 */
function createCamps(scene: Scene, materials: MaterialLibrary, batch: StaticBatch): void {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const id = `${sx}-${sz}`;
      // Local frame: +dx points out towards the side wall, +dz towards that team's castle.
      const at = (dx: number, dz: number): { x: number; z: number } => ({ x: sx * (11.2 + dx), z: sz * (24.2 + dz) });

      for (const [index, spot] of [at(-0.35, 1.5), at(0.55, 0.85)].entries()) {
        const tent = MeshBuilder.CreateCylinder(`camp-tent-${id}-${index}`, { height: 1.85, diameterTop: 0, diameterBottom: 2.6, tessellation: 4 }, scene);
        tent.position.set(spot.x, 0.92, spot.z);
        tent.rotation.y = 0.72 + index * 0.26;
        tent.material = materials.canvas;
        batch.add(tent);

        const pole = MeshBuilder.CreateCylinder(`camp-tent-pole-${id}-${index}`, { height: 2.35, diameter: 0.1, tessellation: 5 }, scene);
        pole.position.set(spot.x, 1.17, spot.z);
        pole.material = materials.wood;
        batch.add(pole);
      }

      for (const [index, spot] of [at(-1, -1.9), at(-0.1, -2.15), at(0.8, -1.75)].entries()) {
        const crate = MeshBuilder.CreateBox(`camp-crate-${id}-${index}`, { width: 0.72, height: 0.58 + index * 0.09, depth: 0.72 }, scene);
        crate.position.set(spot.x, 0.29 + index * 0.045, spot.z);
        crate.rotation.y = 0.32 * index;
        crate.material = materials.wood;
        batch.add(crate);
      }

      for (const [index, spot] of [at(1, -1.15), at(1.05, -0.45)].entries()) {
        const barrel = MeshBuilder.CreateCylinder(`camp-barrel-${id}-${index}`, { height: 0.86, diameter: 0.62, tessellation: 8 }, scene);
        barrel.position.set(spot.x, 0.43, spot.z);
        barrel.material = materials.wood;
        batch.add(barrel);

        const band = MeshBuilder.CreateCylinder(`camp-barrel-band-${id}-${index}`, { height: 0.11, diameter: 0.68, tessellation: 8 }, scene);
        band.position.set(spot.x, 0.55, spot.z);
        band.material = materials.metal;
        batch.add(band);
      }
      createCampFire(scene, materials, batch, id, sx, at(-0.55, -0.35));
      createSpearRack(scene, materials, batch, id, at(-1.05, 1.45));
    }
  }
}

/** Ring of stones, crossed logs, a flame and an additive pool: a campfire for four draw groups. */
function createCampFire(
  scene: Scene,
  materials: MaterialLibrary,
  batch: StaticBatch,
  id: string,
  side: number,
  spot: { x: number; z: number },
): void {
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    const stone = MeshBuilder.CreateBox(`camp-fire-stone-${id}-${index}`, { width: 0.34, height: 0.22, depth: 0.26 }, scene);
    stone.position.set(spot.x + Math.cos(angle) * 0.62, 0.11, spot.z + Math.sin(angle) * 0.62);
    stone.rotation.y = angle;
    stone.material = materials.stoneWarm;
    batch.add(stone);
  }
  for (const index of [0, 1]) {
    const log = MeshBuilder.CreateCylinder(`camp-fire-log-${id}-${index}`, { height: 1.05, diameter: 0.18, tessellation: 6 }, scene);
    log.position.set(spot.x, 0.16, spot.z);
    log.rotation.set(Math.PI / 2, index === 0 ? 0.6 : -0.7, 0);
    log.material = materials.wood;
    batch.add(log);
  }
  const flame = MeshBuilder.CreateSphere(`camp-fire-flame-${id}`, { diameter: 0.5, segments: 5 }, scene);
  flame.position.set(spot.x, 0.42, spot.z);
  flame.scaling.set(1, 1.5, 1);
  flame.material = side > 0 ? materials.torchGlow : materials.torchGlowWarm;
  batch.add(flame);

  const pool = MeshBuilder.CreateCylinder(`camp-fire-pool-${id}`, { height: 0.02, diameter: 4.2, tessellation: 12 }, scene);
  pool.position.set(spot.x, 0.15, spot.z);
  pool.material = materials.lightPool;
  batch.add(pool);
}

/** Two posts, a rail and three spears — a cheap silhouette that reads as an army camp. */
function createSpearRack(scene: Scene, materials: MaterialLibrary, batch: StaticBatch, id: string, spot: { x: number; z: number }): void {
  for (const side of [-1, 1]) {
    const post = MeshBuilder.CreateBox(`camp-rack-post-${id}-${side}`, { width: 0.12, height: 1.15, depth: 0.12 }, scene);
    post.position.set(spot.x + side * 0.55, 0.58, spot.z);
    post.material = materials.wood;
    batch.add(post);
  }
  const rail = MeshBuilder.CreateBox(`camp-rack-rail-${id}`, { width: 1.3, height: 0.1, depth: 0.14 }, scene);
  rail.position.set(spot.x, 1.05, spot.z);
  rail.material = materials.wood;
  batch.add(rail);

  for (const [index, offset] of [-0.4, 0.02, 0.42].entries()) {
    const spear = MeshBuilder.CreateCylinder(`camp-rack-spear-${id}-${index}`, { height: 1.75, diameter: 0.07, tessellation: 5 }, scene);
    spear.position.set(spot.x + offset, 0.88, spot.z + 0.12);
    spear.rotation.x = 0.13 * (index - 1);
    spear.material = materials.metal;
    batch.add(spear);
  }
}

/**
 * Banners: four gold objective banners framing the centre, plus a team banner on each side of
 * both deployment pads. Poles, arms, bases and finials are merged into the static batch; only the
 * eight cloths stay separate, hung on pivot nodes so they can sway.
 */
function createBanners(scene: Scene, materials: MaterialLibrary, batch: StaticBatch): TransformNode[] {
  const pivots: TransformNode[] = [];
  const sources = new Map<string, Mesh>();
  const cloth = (key: string, material: Mesh['material'], index: number): AbstractMesh => {
    const existing = sources.get(key);
    if (existing) return existing.createInstance(`banner-cloth-${key}-${index}`);
    const source = MeshBuilder.CreateBox(`banner-cloth-${key}`, { width: 1.42, height: 2.1, depth: 0.07 }, scene);
    source.material = material;
    sources.set(key, source);
    return source;
  };

  const place = (key: string, material: Mesh['material'], x: number, z: number, height: number, index: number): void => {
    const dir = x < 0 ? 1 : -1;
    const pole = MeshBuilder.CreateCylinder(`banner-pole-${key}-${index}`, { height, diameter: 0.13, tessellation: 6 }, scene);
    pole.position.set(x, height / 2, z);
    pole.material = materials.metal;
    batch.add(pole);

    const finial = MeshBuilder.CreateCylinder(`banner-finial-${key}-${index}`, { height: 0.36, diameterBottom: 0.26, diameterTop: 0.02, tessellation: 5 }, scene);
    finial.position.set(x, height + 0.18, z);
    finial.material = materials.gold;
    batch.add(finial);

    const arm = MeshBuilder.CreateBox(`banner-arm-${key}-${index}`, { width: 1.62, height: 0.1, depth: 0.1 }, scene);
    arm.position.set(x + dir * 0.74, height - 0.22, z);
    arm.material = materials.metal;
    batch.add(arm);

    const base = MeshBuilder.CreateCylinder(`banner-base-${key}-${index}`, { height: 0.26, diameter: 0.95, tessellation: 8 }, scene);
    base.position.set(x, 0.13, z);
    base.material = materials.stoneWarm;
    batch.add(base);

    const pivot = new TransformNode(`banner-pivot-${key}-${index}`, scene);
    pivot.position.set(x, height - 0.3, z);
    const flag = cloth(key, material, index);
    flag.parent = pivot;
    flag.position.set(dir * 0.72, -1.06, 0);
    flag.isPickable = false;
    pivots.push(pivot);
  };

  let index = 0;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      place('objective', materials.objectiveCloth, sx * 9, sz * 5.4, 4.6, index);
      index += 1;
    }
  }
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const team = sz < 0 ? 'blue' : 'red';
      place(team, sz < 0 ? materials.blue : materials.red, sx * 11.6, sz * ARENA.deploymentCenterZ, 4.2, index);
      index += 1;
    }
  }
  return pivots;
}

/**
 * Builds every prop layer and returns the banner pivots so the caller can bring them to life.
 * Repeated props are thin instances, one-offs are merged per material, and every scattered
 * placement is rejection-sampled against the roads, the water, the plaza and the authored anchors.
 */
export function createProps(scene: Scene, materials: MaterialLibrary, density: number): TransformNode[] {
  const batch = new StaticBatch();
  const forest = createForestSources(scene, materials);
  plantVergeTrees(forest, density);
  plantOuterForest(forest, density);
  for (const source of forest.sources) source.finish();
  createUndergrowth(scene, materials, density);
  createRockField(scene, materials, batch, density);
  createWaterEdge(scene, materials, density);
  createTorchlight(scene, materials, batch);
  createCamps(scene, materials, batch);
  const banners = createBanners(scene, materials, batch);
  batch.flush('prop-dressing');
  return banners;
}

/**
 * The only per-frame environment work: two flame materials pulse out of phase, the additive light
 * pools breathe with them, and the banner cloths sway. Two material updates and eight transforms
 * per frame for the whole map — no particle systems and no extra lights.
 */
export function startEnvironmentLife(scene: Scene, materials: MaterialLibrary, banners: TransformNode[]): void {
  const flameBase = materials.torchGlow.emissiveColor.clone();
  const warmBase = materials.torchGlowWarm.emissiveColor.clone();
  let elapsed = 0;
  scene.onBeforeRenderObservable.add(() => {
    elapsed += scene.getEngine().getDeltaTime() / 1000;
    const flicker = 1 + Math.sin(elapsed * 7.3) * 0.14 + Math.sin(elapsed * 13.1) * 0.06;
    const warmFlicker = 1 + Math.sin(elapsed * 6.1 + 2.2) * 0.16 + Math.sin(elapsed * 11.7 + 1.1) * 0.05;
    materials.torchGlow.emissiveColor.copyFrom(flameBase).scaleInPlace(flicker);
    materials.torchGlowWarm.emissiveColor.copyFrom(warmBase).scaleInPlace(warmFlicker);
    materials.lightPool.alpha = 0.26 + (flicker - 1) * 0.35;
    for (let index = 0; index < banners.length; index += 1) {
      const pivot = banners[index];
      pivot.rotation.z = Math.sin(elapsed * 1.6 + index * 1.7) * 0.075;
      pivot.rotation.x = Math.sin(elapsed * 1.15 + index * 2.3) * 0.05;
    }
  });
}
