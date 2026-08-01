import { AbstractMesh, Mesh, MeshBuilder, Scene, TransformNode } from '@babylonjs/core';
import { PORTRAIT_LAYOUT } from '../core/config';
import { createRandom, Scatter, StaticBatch } from './decorKit';
import { MaterialLibrary } from './materials';
import { isNearWater, isOnDeploymentPad, isOnPlaza, roadClearance, surroundingsHeight } from './terrain';

const ARENA = PORTRAIT_LAYOUT.arena;
const LANES = [-ARENA.laneOffset, 0, ARENA.laneOffset];
const SURROUNDINGS_Y = -0.84;

/** Ground height for props that sit outside the arena plinth. */
const outsideGround = (x: number, z: number): number => SURROUNDINGS_Y + surroundingsHeight(x, z);

/**
 * Authored anchors that scattered vegetation must leave alone, so a hand-placed silhouette never
 * ends up buried inside a random bush. Only the four objective banners qualify now — the camps,
 * monoliths, deployment posts and verge torches they used to protect are gone.
 */
const ANCHORS: Array<[number, number, number]> = [];
const reserve = (x: number, z: number, radius: number): void => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ANCHORS.push([sx * x, sz * z, radius]);
};
reserve(9, 5.4, 2.6);

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
 * Verge treeline. With the side walls gone this short row is what frames the battlefield, so it is
 * deliberately sparse and widely spaced: trees keep clear of the water, the deployment pads and
 * every authored anchor, and species rotate in order rather than at random so the row reads placed.
 */
function plantVergeTrees(forest: Forest, density: number): void {
  const random = createRandom(4271);
  const target = Math.round(18 * density);
  const placed: Array<[number, number]> = [];
  for (let attempt = 0; attempt < target * 30 && placed.length < target; attempt += 1) {
    const side = random() < 0.5 ? -1 : 1;
    const x = side * (9.9 + random() * 2.3);
    const z = -29 + random() * 58;
    if (isNearWater(z, 2.6) || !clearsAnchors(x, z, 1.6) || isOnDeploymentPad(x, z, 0.9)) continue;
    if (placed.some(([px, pz]) => px * side > 0 && Math.hypot(x - px, z - pz) < 5.2)) continue;
    const species = forest.species[placed.length % forest.species.length];
    plantTree(species, x, z, 0, 0.85 + random() * 0.4, random() * Math.PI * 2, (random() - 0.5) * 0.05);
    placed.push([x, z]);
  }
}

/**
 * Forest ring on the rolling ground outside the arena. Placement is weighted towards the far
 * half of the map, where the portrait camera actually has empty screen space behind the enemy
 * castle, and every candidate is culled against the visible cone so nothing is paid for twice.
 */
function plantOuterForest(forest: Forest, density: number): void {
  const random = createRandom(8813);
  const target = Math.round(90 * density);
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
 * Low planting: a few bushes on the verge and outer ground plus grass tufts in the safe bands
 * between the roads. Two bush shapes and one tuft, all fresh green — no flowers, no dry straw and
 * nothing inside a deployment pad — so the layer adds life without adding a single point of noise.
 */
function createUndergrowth(scene: Scene, materials: MaterialLibrary, density: number): void {
  const random = createRandom(5519);
  const bush = scatterOf(MeshBuilder.CreateSphere('bush-source', { diameter: 1.35, segments: 4 }, scene), materials.foliage);
  const bushMid = scatterOf(MeshBuilder.CreateSphere('bush-mid-source', { diameter: 1.1, segments: 4 }, scene), materials.foliageMid);
  const tuft = scatterOf(MeshBuilder.CreateCylinder('grass-tuft-source', { height: 0.52, diameterBottom: 0.34, diameterTop: 0.02, tessellation: 4 }, scene), materials.grassLush);

  const bushTarget = Math.round(30 * density);
  for (let attempt = 0, placed = 0; attempt < bushTarget * 14 && placed < bushTarget; attempt += 1) {
    const side = random() < 0.5 ? -1 : 1;
    const outer = random() < 0.36;
    const x = side * (outer ? 15 + random() * 7 : VERGE_MIN + random() * (VERGE_MAX - VERGE_MIN));
    const z = outer ? -24 + random() * 74 : -30 + random() * 61;
    if (outer
      ? Math.abs(x) > visibleHalfWidth(z)
      : isNearWater(z, 1.7) || !clearsAnchors(x, z, 1) || isOnDeploymentPad(x, z, 1)) continue;
    const scale = 0.66 + random() * 0.6;
    const source = random() < 0.5 ? bush : bushMid;
    source.add(x, (outer ? outsideGround(x, z) : 0) + 0.34 * scale, z, random() * 3, scale, scale * (0.6 + random() * 0.35), scale);
    placed += 1;
  }

  const tuftTarget = Math.round(110 * density);
  for (let attempt = 0, placed = 0; attempt < tuftTarget * 8 && placed < tuftTarget; attempt += 1) {
    const side = random() < 0.5 ? -1 : 1;
    const inner = random() < 0.4;
    const x = side * (inner ? 2.4 + random() * 1.9 : VERGE_MIN - 0.2 + random() * 4);
    const z = -29 + random() * 58;
    if (roadClearance(x) < 0.26 || isNearWater(z, 1.4) || isOnPlaza(x, z) || isOnDeploymentPad(x, z, 0.2)) continue;
    const scale = 0.7 + random() * 0.65;
    tuft.add(x, 0.24 * scale, z, random() * 3, scale, scale * (0.8 + random() * 0.5), scale, (random() - 0.5) * 0.22);
    placed += 1;
  }
  for (const source of [bush, bushMid, tuft]) source.finish();
}

/**
 * Rock variation: two low-poly boulder shapes, thin-instanced onto the verge and the outer ground.
 * No pebble layer and no standing stones, so the ground stays clear and the boulders that remain
 * read as deliberate landmarks rather than scatter.
 */
function createRockField(scene: Scene, materials: MaterialLibrary, density: number): void {
  const random = createRandom(3121);
  const rocks = [
    scatterOf(MeshBuilder.CreatePolyhedron('rock-a-source', { type: 1, size: 1.05 }, scene), materials.stone),
    scatterOf(MeshBuilder.CreatePolyhedron('rock-b-source', { type: 3, size: 0.9 }, scene), materials.stoneMoss),
  ];

  const rockTarget = Math.round(18 * density);
  const placedSpots: Array<[number, number]> = [];
  for (let attempt = 0; attempt < rockTarget * 20 && placedSpots.length < rockTarget; attempt += 1) {
    const side = random() < 0.5 ? -1 : 1;
    const outer = random() < 0.45;
    const x = side * (outer ? 15.2 + random() * 8 : VERGE_MIN + 0.3 + random() * 3.2);
    const z = outer ? -24 + random() * 74 : -30 + random() * 61;
    if (outer
      ? Math.abs(x) > visibleHalfWidth(z)
      : !clearsAnchors(x, z, 1.2) || isOnDeploymentPad(x, z, 1.6)) continue;
    if (placedSpots.some(([px, pz]) => Math.hypot(x - px, z - pz) < 6)) continue;
    const scale = (outer ? 0.85 : 0.6) + random() * 0.7;
    const ground = outer ? outsideGround(x, z) : 0;
    rocks[placedSpots.length % rocks.length]
      .add(x, ground + 0.16 * scale, z, random() * 3, scale, scale * (0.55 + random() * 0.4), scale * (0.8 + random() * 0.5), (random() - 0.5) * 0.2);
    placedSpots.push([x, z]);
  }
  for (const source of rocks) source.finish();
}

/**
 * Water-edge dressing: a light band of reeds on the open stretches of each river, never near a
 * bridge. No lily pads, so the water surface itself stays a clean readable ribbon.
 */
function createWaterEdge(scene: Scene, materials: MaterialLibrary, density: number): void {
  const random = createRandom(7717);
  const reed = scatterOf(MeshBuilder.CreateCylinder('reed-source', { height: 1.15, diameterBottom: 0.16, diameterTop: 0.02, tessellation: 4 }, scene), materials.foliageDeep);
  const nearBridge = (x: number): boolean => LANES.some((lane) => Math.abs(x - lane) < 2.6);

  const reedTarget = Math.round(28 * density);
  for (let attempt = 0, placed = 0; attempt < reedTarget * 8 && placed < reedTarget; attempt += 1) {
    const x = (random() * 2 - 1) * 12.6;
    if (nearBridge(x)) continue;
    const z = (random() < 0.5 ? -ARENA.riverZ : ARENA.riverZ) + (random() < 0.5 ? -1 : 1) * (1.05 + random() * 0.8);
    const scale = 0.7 + random() * 0.7;
    reed.add(x, 0.5 * scale, z, random() * 3, scale, scale * (0.8 + random() * 0.6), scale, (random() - 0.5) * 0.3);
    placed += 1;
  }
  reed.finish();
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
 * Firelight only where it means something: four torches on the castle approaches and four framing
 * the objective plaza. Every position sits in the safe band between the roads, so no flame ever
 * stands in a marching lane, and the whole map now carries eight fixtures instead of twenty-eight.
 */
function createTorchlight(scene: Scene, materials: MaterialLibrary, batch: StaticBatch): void {
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      addTorch(scene, materials, batch, sx * 3.5, 0, sz * 23.4, 1.15, sx * sz > 0);
      addTorch(scene, materials, batch, sx * 3.2, 0.07, sz * 5.6, 0.95, sx > 0);
    }
  }
}

/**
 * Banners: four gold objective banners framing the centre. Poles, arms, bases and finials are
 * merged into the static batch; only the four cloths stay separate, hung on pivot nodes so they can
 * sway. The team banners that used to flank both deployment pads are gone with the rest of the
 * clutter, leaving the pads as clean team-coloured rectangles.
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
  createRockField(scene, materials, density);
  createWaterEdge(scene, materials, density);
  createTorchlight(scene, materials, batch);
  const banners = createBanners(scene, materials, batch);
  batch.flush('prop-dressing');
  return banners;
}

/**
 * The only per-frame environment work: two flame materials pulse out of phase, the additive light
 * pools breathe with them, and the banner cloths sway. Two material updates and four transforms
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
