import { Mesh, MeshBuilder, Scene } from '@babylonjs/core';
import { PORTRAIT_LAYOUT } from '../core/config';
import { createRandom, Scatter } from './decorKit';
import { MaterialLibrary } from './materials';
import { surroundingsHeight } from './terrain';

const SURROUNDINGS_Y = -0.84;
const ARENA = PORTRAIT_LAYOUT.arena;
const PERIMETER_HALF_WIDTH = ARENA.foundationWidth / 2;
const PERIMETER_HALF_LENGTH = ARENA.foundationLength / 2;
const TREE_EDGE_CLEARANCE = 2.8;
const LOW_GROWTH_EDGE_CLEARANCE = 0.9;

/** Ground height for props that sit outside the arena plinth. */
const outsideGround = (x: number, z: number): number => SURROUNDINGS_Y + surroundingsHeight(x, z);

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
 * Dense perimeter forest. Side rows span the arena length, a fuller far row closes the horizon,
 * and only shorter corner trees are allowed on the camera-facing edge. Every crown is given enough
 * clearance to remain outside the foundation, so gameplay and castle silhouettes stay unobstructed.
 */
function plantPerimeterForest(forest: Forest, density: number): void {
  const random = createRandom(4271);

  const sideCount = Math.max(20, Math.round(34 * density));
  for (const side of [-1, 1]) {
    for (let index = 0; index < sideCount; index += 1) {
      const progress = (index + 0.5) / sideCount;
      const x = side * (PERIMETER_HALF_WIDTH + TREE_EDGE_CLEARANCE + random() * 2.3);
      const z = -PERIMETER_HALF_LENGTH + 1.2
        + progress * (PERIMETER_HALF_LENGTH * 2 - 2.4)
        + (random() - 0.5) * 2.1;
      const species = forest.species[(index + (side > 0 ? 1 : 0)) % forest.species.length];
      plantTree(
        species,
        x,
        z,
        outsideGround(x, z),
        0.78 + random() * 0.5,
        random() * Math.PI * 2,
        (random() - 0.5) * 0.055,
      );
    }
  }

  const farCount = Math.max(14, Math.round(24 * density));
  for (let index = 0; index < farCount; index += 1) {
    const progress = (index + 0.5) / farCount;
    const x = -PERIMETER_HALF_WIDTH - 2 + progress * (PERIMETER_HALF_WIDTH * 2 + 4)
      + (random() - 0.5) * 1.8;
    const z = PERIMETER_HALF_LENGTH + TREE_EDGE_CLEARANCE + random() * 2.4;
    const species = forest.distant[Math.floor(random() * forest.distant.length)];
    plantTree(species, x, z, outsideGround(x, z), 0.88 + random() * 0.62, random() * Math.PI * 2, (random() - 0.5) * 0.05);
  }

  const nearCornerCount = Math.max(3, Math.round(5 * density));
  for (const side of [-1, 1]) {
    for (let index = 0; index < nearCornerCount; index += 1) {
      const x = side * (PERIMETER_HALF_WIDTH * 0.82 + index * 1.8 + random() * 1.25);
      const z = -PERIMETER_HALF_LENGTH - TREE_EDGE_CLEARANCE - random() * 1.6;
      const species = forest.species[(index + 1) % forest.species.length];
      plantTree(species, x, z, outsideGround(x, z), 0.7 + random() * 0.24, random() * Math.PI * 2, (random() - 0.5) * 0.04);
    }
  }
}

/**
 * Returns a point in a narrow rectangular band outside the foundation. Edge choice is weighted by
 * edge length, avoiding a corner-heavy ring while still leaving enough random overlap to feel wild.
 */
function perimeterPoint(random: () => number, clearance: number, bandDepth: number): { x: number; z: number } {
  const sideWeight = PERIMETER_HALF_LENGTH / (PERIMETER_HALF_LENGTH + PERIMETER_HALF_WIDTH);
  if (random() < sideWeight) {
    const side = random() < 0.5 ? -1 : 1;
    return {
      x: side * (PERIMETER_HALF_WIDTH + clearance + random() * bandDepth),
      z: (random() * 2 - 1) * (PERIMETER_HALF_LENGTH + bandDepth * 0.45),
    };
  }
  const end = random() < 0.5 ? -1 : 1;
  return {
    x: (random() * 2 - 1) * (PERIMETER_HALF_WIDTH + bandDepth * 0.45),
    z: end * (PERIMETER_HALF_LENGTH + clearance + random() * bandDepth),
  };
}

/** Low bushes fill gaps between trunks while remaining below every gameplay silhouette. */
function createUndergrowth(scene: Scene, materials: MaterialLibrary, density: number): void {
  const random = createRandom(5519);
  const bush = scatterOf(MeshBuilder.CreateSphere('bush-source', { diameter: 1.35, segments: 4 }, scene), materials.foliage);
  const bushMid = scatterOf(MeshBuilder.CreateSphere('bush-mid-source', { diameter: 1.1, segments: 4 }, scene), materials.foliageMid);

  const bushTarget = Math.max(32, Math.round(64 * density));
  for (let placed = 0; placed < bushTarget; placed += 1) {
    const { x, z } = perimeterPoint(random, LOW_GROWTH_EDGE_CLEARANCE, 3.4);
    const scale = 0.66 + random() * 0.6;
    const source = random() < 0.5 ? bush : bushMid;
    source.add(x, outsideGround(x, z) + 0.34 * scale, z, random() * 3, scale, scale * (0.6 + random() * 0.35), scale);
  }

  for (const source of [bush, bushMid]) source.finish();
}

/**
 * A few low-poly boulders break up the planted ring. They use the same outside-only band as the
 * vegetation and stay widely separated so they read as accents rather than obstacles.
 */
function createRockField(scene: Scene, materials: MaterialLibrary, density: number): void {
  const random = createRandom(3121);
  const rocks = [
    scatterOf(MeshBuilder.CreatePolyhedron('rock-a-source', { type: 1, size: 1.05 }, scene), materials.stone),
    scatterOf(MeshBuilder.CreatePolyhedron('rock-b-source', { type: 3, size: 0.9 }, scene), materials.stoneMoss),
  ];

  const rockTarget = Math.max(8, Math.round(12 * density));
  const placedSpots: Array<[number, number]> = [];
  for (let attempt = 0; attempt < rockTarget * 20 && placedSpots.length < rockTarget; attempt += 1) {
    const { x, z } = perimeterPoint(random, 1.8, 3.8);
    if (placedSpots.some(([px, pz]) => Math.hypot(x - px, z - pz) < 5.5)) continue;
    const scale = 0.7 + random() * 0.72;
    rocks[placedSpots.length % rocks.length]
      .add(x, outsideGround(x, z) + 0.16 * scale, z, random() * 3, scale, scale * (0.55 + random() * 0.4), scale * (0.8 + random() * 0.5), (random() - 0.5) * 0.2);
    placedSpots.push([x, z]);
  }
  for (const source of rocks) source.finish();
}

/**
 * Builds the prop layer. Repeated natural props are thin instances and the perimeter vegetation
 * stays entirely outside the arena foundation, so the battlefield itself carries no standing props.
 */
export function createProps(scene: Scene, materials: MaterialLibrary, density: number): void {
  const forest = createForestSources(scene, materials);
  plantPerimeterForest(forest, density);
  for (const source of forest.sources) source.finish();
  createUndergrowth(scene, materials, density);
  createRockField(scene, materials, density);
}
