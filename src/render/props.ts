import { Mesh, MeshBuilder, Scene } from '@babylonjs/core';
import { createRandom, Scatter, StaticBatch } from './decorKit';
import { MaterialLibrary } from './materials';
import { isNearWater, isOnDeploymentPad, roadClearance, surroundingsHeight } from './terrain';

const SURROUNDINGS_Y = -0.84;

/** Ground height for props that sit outside the arena plinth. */
const outsideGround = (x: number, z: number): number => SURROUNDINGS_Y + surroundingsHeight(x, z);

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
 * Three restrained tree species share one trunk and three crown meshes. The small silhouette set
 * keeps the backdrop coherent without giving the arena an ornamental garden look.
 */
function createForestSources(scene: Scene, materials: MaterialLibrary): Forest {
  const cone = (name: string, height: number, diameterBottom: number, diameterTop: number, tessellation: number): Mesh =>
    MeshBuilder.CreateCylinder(name, { height, diameterBottom, diameterTop, tessellation }, scene);

  const trunk = scatterOf(cone('tree-trunk-source', 2.4, 0.58, 0.32, 6), materials.trunk);
  const pineCrown = scatterOf(cone('tree-crown-pine-source', 3.6, 2.7, 0, 7), materials.foliageDeep);
  const firCrown = scatterOf(cone('tree-crown-fir-source', 4.3, 2.35, 0.12, 6), materials.foliageDark);
  const oakCrown = scatterOf(MeshBuilder.CreateSphere('tree-crown-oak-source', { diameter: 2.9, segments: 5 }, scene), materials.foliage);

  const pine: TreeSpecies = { trunk, crown: pineCrown, trunkXZ: 0.9, trunkY: 1.05, crownXZ: 0.95, crownY: 1.2, crownCenter: 3.95 };
  const fir: TreeSpecies = { trunk, crown: firCrown, trunkXZ: 0.8, trunkY: 1.25, crownXZ: 0.85, crownY: 1.35, crownCenter: 4.55 };
  const oak: TreeSpecies = { trunk, crown: oakCrown, trunkXZ: 1.1, trunkY: 0.95, crownXZ: 1.15, crownY: 0.95, crownCenter: 3.15 };

  return {
    sources: [trunk, pineCrown, firCrown, oakCrown],
    species: [pine, oak, fir],
    distant: [pine, fir, oak],
  };
}

/**
 * Verge treeline. With the side walls gone this short row is what frames the battlefield, so it is
 * deliberately sparse and widely spaced: trees keep clear of water and the invisible deployment
 * areas, and species rotate in order rather than at random so the row reads intentionally placed.
 */
function plantVergeTrees(forest: Forest, density: number): void {
  const random = createRandom(4271);
  const target = Math.round(6 * density);
  const placed: Array<[number, number]> = [];
  for (let attempt = 0; attempt < target * 30 && placed.length < target; attempt += 1) {
    const side = random() < 0.5 ? -1 : 1;
    const x = side * (9.9 + random() * 2.3);
    const z = -29 + random() * 58;
    if (isNearWater(z, 2.6) || isOnDeploymentPad(x, z, 0.9)) continue;
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
  const target = Math.round(12 * density);
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
 * Low planting is limited to a few broad bushes on the outer verge. Small grass-tuft scatter is
 * deliberately absent so lanes, deployment areas and combat silhouettes stay uninterrupted.
 */
function createUndergrowth(scene: Scene, materials: MaterialLibrary, density: number): void {
  const random = createRandom(5519);
  const bush = scatterOf(MeshBuilder.CreateSphere('bush-source', { diameter: 1.35, segments: 4 }, scene), materials.foliage);
  const bushMid = scatterOf(MeshBuilder.CreateSphere('bush-mid-source', { diameter: 1.1, segments: 4 }, scene), materials.foliageMid);

  const bushTarget = Math.round(8 * density);
  for (let attempt = 0, placed = 0; attempt < bushTarget * 14 && placed < bushTarget; attempt += 1) {
    const side = random() < 0.5 ? -1 : 1;
    const outer = random() < 0.36;
    const x = side * (outer ? 15 + random() * 7 : VERGE_MIN + random() * (VERGE_MAX - VERGE_MIN));
    const z = outer ? -24 + random() * 74 : -30 + random() * 61;
    if (outer
      ? Math.abs(x) > visibleHalfWidth(z)
      : isNearWater(z, 1.7) || roadClearance(x) < 0.8 || isOnDeploymentPad(x, z, 1)) continue;
    const scale = 0.66 + random() * 0.6;
    const source = random() < 0.5 ? bush : bushMid;
    source.add(x, (outer ? outsideGround(x, z) : 0) + 0.34 * scale, z, random() * 3, scale, scale * (0.6 + random() * 0.35), scale);
    placed += 1;
  }

  for (const source of [bush, bushMid]) source.finish();
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

  const rockTarget = Math.round(6 * density);
  const placedSpots: Array<[number, number]> = [];
  for (let attempt = 0; attempt < rockTarget * 20 && placedSpots.length < rockTarget; attempt += 1) {
    const side = random() < 0.5 ? -1 : 1;
    const outer = random() < 0.45;
    const x = side * (outer ? 15.2 + random() * 8 : VERGE_MIN + 0.3 + random() * 3.2);
    const z = outer ? -24 + random() * 74 : -30 + random() * 61;
    if (outer
      ? Math.abs(x) > visibleHalfWidth(z)
      : isOnDeploymentPad(x, z, 1.6)) continue;
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
 * One torch: wooden post, metal bowl and flame. Ground-light decals are omitted so each fixture
 * remains a compact landmark without tinting the surrounding grass.
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
}

/**
 * Firelight only where it means something: four torches mark the two castle approaches. Every
 * position sits in the safe band between the roads, leaving the central objective completely bare.
 */
function createTorchlight(scene: Scene, materials: MaterialLibrary, batch: StaticBatch): void {
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      addTorch(scene, materials, batch, sx * 3.5, 0, sz * 23.4, 1.15, sx * sz > 0);
    }
  }
}

/**
 * Builds the reduced prop layer. Repeated props are thin instances, one-offs are merged per
 * material, and every placement stays outside roads, water and the castle-front deployment areas.
 */
export function createProps(scene: Scene, materials: MaterialLibrary, density: number): void {
  const batch = new StaticBatch();
  const forest = createForestSources(scene, materials);
  plantVergeTrees(forest, density);
  plantOuterForest(forest, density);
  for (const source of forest.sources) source.finish();
  createUndergrowth(scene, materials, density);
  createRockField(scene, materials, density);
  createTorchlight(scene, materials, batch);
  batch.flush('prop-dressing');
}

/**
 * The only per-frame environment work: two flame materials pulse out of phase. There are no
 * animated decorative transforms, particles or extra lights.
 */
export function startEnvironmentLife(scene: Scene, materials: MaterialLibrary): void {
  const flameBase = materials.torchGlow.emissiveColor.clone();
  const warmBase = materials.torchGlowWarm.emissiveColor.clone();
  let elapsed = 0;
  scene.onBeforeRenderObservable.add(() => {
    elapsed += scene.getEngine().getDeltaTime() / 1000;
    const flicker = 1 + Math.sin(elapsed * 7.3) * 0.14 + Math.sin(elapsed * 13.1) * 0.06;
    const warmFlicker = 1 + Math.sin(elapsed * 6.1 + 2.2) * 0.16 + Math.sin(elapsed * 11.7 + 1.1) * 0.05;
    materials.torchGlow.emissiveColor.copyFrom(flameBase).scaleInPlace(flicker);
    materials.torchGlowWarm.emissiveColor.copyFrom(warmBase).scaleInPlace(warmFlicker);
  });
}
