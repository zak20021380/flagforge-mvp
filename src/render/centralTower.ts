import {
  Mesh,
  MeshBuilder,
  Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { CENTRAL_TOWER } from '../core/config';
import { MaterialLibrary } from './materials';

export interface CentralTowerVisual {
  readonly root: TransformNode;
  readonly topCenter: Vector3;
}

export function createCentralTower(scene: Scene, materials: MaterialLibrary): CentralTowerVisual {
  const root = new TransformNode('central-fortress-root', scene);

  const addOctagonalLayer = (
    name: string,
    height: number,
    diameterBottom: number,
    diameterTop: number,
    y: number,
    depthScale: number,
    material: Mesh['material'],
  ): Mesh => {
    const mesh = MeshBuilder.CreateCylinder(name, {
      height,
      diameterBottom,
      diameterTop,
      tessellation: 8,
    }, scene);
    mesh.parent = root;
    mesh.position.y = y;
    mesh.scaling.z = depthScale;
    mesh.material = material;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    return mesh;
  };

  // A stepped, tapered silhouette reads as masonry from the portrait camera while
  // keeping the structure to a handful of low-poly primitive meshes.
  addOctagonalLayer('tower-foundation', 0.5, 8.4, 8.4, 0.25, 7.6 / 8.4, materials.stoneDark);
  addOctagonalLayer('tower-lower-plinth', 0.38, 7.8, 8.15, 0.67, 0.9, materials.stoneWarm);
  addOctagonalLayer('tower-upper-plinth', 0.34, 7.15, 7.55, 1.02, 0.9, materials.stoneLight);
  addOctagonalLayer('tower-keep', CENTRAL_TOWER.shaftHeight, 6.55, 5.72, 4.19, 0.88, materials.stone);

  for (const [index, band] of [
    { y: 1.55, diameter: 6.7, depthScale: 0.88 },
    { y: 3.25, diameter: 6.45, depthScale: 0.88 },
    { y: 5.05, diameter: 6.2, depthScale: 0.9 },
    { y: 6.65, diameter: 6.02, depthScale: 0.9 },
  ].entries()) {
    addOctagonalLayer(`tower-stone-band-${index}`, 0.18, band.diameter, band.diameter, band.y, band.depthScale, materials.stoneWarm);
  }

  addOctagonalLayer('tower-corbel', 0.42, 6.18, 6.9, 7.34, 0.9, materials.stoneDark);
  addOctagonalLayer('tower-crown-trim', 0.4, 7.08, 6.8, 7.65, 0.9, materials.stoneLight);
  addOctagonalLayer('tower-objective-ring', 0.14, 7.16, 7.16, 7.83, 0.9, materials.gold);
  addOctagonalLayer('tower-top-deck', 0.32, 6.82, 6.82, 7.99, 0.9, materials.road);

  createButtresses(scene, root, materials);
  createParapets(scene, root, materials);
  createLadder(scene, root, materials, -1);
  createLadder(scene, root, materials, 1);
  createBraziers(scene, root, materials);
  createCrownSpires(scene, root, materials);
  createBanners(scene, root, materials);
  createHeraldry(scene, root, materials);
  createApproachAccents(scene, root, materials);

  return {
    root,
    topCenter: new Vector3(0, CENTRAL_TOWER.topUnitY, 0),
  };
}

function createButtresses(scene: Scene, root: TransformNode, materials: MaterialLibrary): void {
  for (const [index, position] of [
    new Vector3(-2.72, 3.82, -2.18),
    new Vector3(2.72, 3.82, -2.18),
    new Vector3(-2.72, 3.82, 2.18),
    new Vector3(2.72, 3.82, 2.18),
  ].entries()) {
    const buttress = MeshBuilder.CreateBox(`tower-buttress-${index}`, { width: 0.72, height: 5.85, depth: 0.82 }, scene);
    buttress.parent = root;
    buttress.position.copyFrom(position);
    buttress.rotation.y = position.x * position.z > 0 ? -0.18 : 0.18;
    buttress.scaling.y = 1 + (index % 2) * 0.025;
    buttress.material = index % 2 === 0 ? materials.stoneWarm : materials.stoneDark;
    buttress.receiveShadows = true;
    buttress.isPickable = false;

    const foot = MeshBuilder.CreateBox(`tower-buttress-foot-${index}`, { width: 1.02, height: 0.48, depth: 1.12 }, scene);
    foot.parent = root;
    foot.position.set(position.x, 0.78, position.z * 1.08);
    foot.rotation.y = buttress.rotation.y;
    foot.material = materials.stoneDark;
    foot.receiveShadows = true;
    foot.isPickable = false;
  }
}

function createParapets(scene: Scene, root: TransformNode, materials: MaterialLibrary): void {
  const wallY = CENTRAL_TOWER.topSurfaceY + 0.19;
  for (const [index, wall] of [
    { width: 2.15, depth: 0.36, x: -2.08, z: -2.68 },
    { width: 2.15, depth: 0.36, x: 2.08, z: -2.68 },
    { width: 2.15, depth: 0.36, x: -2.08, z: 2.68 },
    { width: 2.15, depth: 0.36, x: 2.08, z: 2.68 },
    { width: 0.36, depth: 4.65, x: -3.05, z: 0 },
    { width: 0.36, depth: 4.65, x: 3.05, z: 0 },
  ].entries()) {
    const rail = MeshBuilder.CreateBox(`tower-parapet-rail-${index}`, { width: wall.width, height: 0.38, depth: wall.depth }, scene);
    rail.parent = root;
    rail.position.set(wall.x, wallY, wall.z);
    rail.material = materials.stoneDark;
    rail.receiveShadows = true;
    rail.isPickable = false;
  }

  const positions: Vector3[] = [];
  for (const z of [-2.7, 2.7]) {
    for (const x of [-2.72, -1.72, 1.72, 2.72]) positions.push(new Vector3(x, CENTRAL_TOWER.topSurfaceY + 0.53, z));
  }
  for (const x of [-3.08, 3.08]) {
    for (const z of [-1.72, -0.58, 0.58, 1.72]) positions.push(new Vector3(x, CENTRAL_TOWER.topSurfaceY + 0.53, z));
  }

  const source = MeshBuilder.CreateBox('tower-battlement-source', { width: 0.7, height: 1.05, depth: 0.62 }, scene);
  source.parent = root;
  source.position.copyFrom(positions[0]);
  source.material = materials.stoneLight;
  source.receiveShadows = true;
  source.isPickable = false;
  for (let index = 1; index < positions.length; index += 1) {
    const block = source.createInstance(`tower-battlement-${index}`);
    block.parent = root;
    block.position.copyFrom(positions[index]);
    block.isPickable = false;
  }
}

function createLadder(scene: Scene, root: TransformNode, materials: MaterialLibrary, side: -1 | 1): void {
  const label = side < 0 ? 'player' : 'enemy';
  const ladder = CENTRAL_TOWER.ladders[label];
  const bottom = ladder.groundAlign;
  const top = ladder.climbTop;
  const centerY = (bottom.y + top.y) / 2;
  const centerZ = (bottom.z + top.z) / 2;
  const deltaY = top.y - bottom.y;
  const deltaZ = top.z - bottom.z;
  const length = Math.hypot(deltaY, deltaZ);
  const pitch = Math.atan2(deltaZ, deltaY);

  for (const x of [-0.67, 0.67]) {
    const rail = MeshBuilder.CreateCylinder(`tower-${label}-ladder-rail-${x}`, { height: length, diameter: 0.16, tessellation: 7 }, scene);
    rail.parent = root;
    rail.position.set(x, centerY, centerZ);
    rail.rotation.x = pitch;
    rail.material = materials.wood;
    rail.isPickable = false;
  }

  const rungCount = Math.ceil(length / 0.42);
  const rungSource = MeshBuilder.CreateBox(`tower-${label}-ladder-rung-source`, { width: 1.52, height: 0.13, depth: 0.16 }, scene);
  rungSource.parent = root;
  rungSource.material = materials.wood;
  rungSource.isPickable = false;
  for (let index = 0; index < rungCount; index += 1) {
    const t = (index + 0.5) / rungCount;
    const rung = index === 0 ? rungSource : rungSource.createInstance(`tower-${label}-ladder-rung-${index}`);
    rung.parent = root;
    rung.position.set(0, bottom.y + deltaY * t, bottom.z + deltaZ * t);
    rung.rotation.x = pitch;
    rung.isPickable = false;
  }

  const landing = MeshBuilder.CreateBox(`tower-${label}-ladder-landing`, { width: 2.05, height: 0.18, depth: 1.15 }, scene);
  landing.parent = root;
  landing.position.set(0, 0.12, ladder.groundEntry.z - side * 0.18);
  landing.material = materials.road;
  landing.receiveShadows = true;
  landing.isPickable = false;
}

function createBraziers(scene: Scene, root: TransformNode, materials: MaterialLibrary): void {
  for (const [index, x] of [-2.05, 2.05].entries()) {
    const pedestal = MeshBuilder.CreateCylinder(`tower-brazier-pedestal-${index}`, { height: 0.7, diameterTop: 0.48, diameterBottom: 0.7, tessellation: 8 }, scene);
    pedestal.parent = root;
    pedestal.position.set(x, CENTRAL_TOWER.topSurfaceY + 0.35, 0);
    pedestal.material = materials.stoneDark;
    pedestal.isPickable = false;

    const bowl = MeshBuilder.CreateCylinder(`tower-brazier-bowl-${index}`, { height: 0.32, diameterTop: 0.9, diameterBottom: 0.44, tessellation: 10 }, scene);
    bowl.parent = root;
    bowl.position.set(x, CENTRAL_TOWER.topSurfaceY + 0.77, 0);
    bowl.material = materials.metal;
    bowl.isPickable = false;

    const flame = MeshBuilder.CreateSphere(`tower-brazier-flame-${index}`, { diameter: 0.56, segments: 6 }, scene);
    flame.parent = root;
    flame.position.set(x, CENTRAL_TOWER.topSurfaceY + 1.13, 0);
    flame.scaling.set(0.72, 1.35, 0.72);
    flame.material = materials.torchGlow;
    flame.isPickable = false;
  }
}

function createCrownSpires(scene: Scene, root: TransformNode, materials: MaterialLibrary): void {
  for (const [index, position] of [
    new Vector3(-2.5, CENTRAL_TOWER.topSurfaceY + 0.92, -2.1),
    new Vector3(2.5, CENTRAL_TOWER.topSurfaceY + 0.92, -2.1),
    new Vector3(-2.5, CENTRAL_TOWER.topSurfaceY + 0.92, 2.1),
    new Vector3(2.5, CENTRAL_TOWER.topSurfaceY + 0.92, 2.1),
  ].entries()) {
    const spire = MeshBuilder.CreateCylinder(`tower-crown-spire-${index}`, {
      height: 1.65,
      diameterTop: 0.12,
      diameterBottom: 0.58,
      tessellation: 6,
    }, scene);
    spire.parent = root;
    spire.position.copyFrom(position);
    spire.material = materials.stoneLight;
    spire.isPickable = false;

    const finial = MeshBuilder.CreateSphere(`tower-crown-finial-${index}`, { diameter: 0.3, segments: 6 }, scene);
    finial.parent = root;
    finial.position.set(position.x, position.y + 0.91, position.z);
    finial.material = materials.gold;
    finial.isPickable = false;
  }
}

function createBanners(scene: Scene, root: TransformNode, materials: MaterialLibrary): void {
  for (const [index, x] of [-2.28, 2.28].entries()) {
    const pole = MeshBuilder.CreateCylinder(`tower-banner-pole-${index}`, { height: 2.45, diameter: 0.1, tessellation: 7 }, scene);
    pole.parent = root;
    pole.position.set(x, CENTRAL_TOWER.topSurfaceY - 1.17, -2.76);
    pole.material = materials.metal;
    pole.isPickable = false;

    const cloth = MeshBuilder.CreateBox(`tower-banner-cloth-${index}`, { width: 0.92, height: 1.2, depth: 0.08 }, scene);
    cloth.parent = root;
    cloth.position.set(x + (x < 0 ? 0.46 : -0.46), CENTRAL_TOWER.topSurfaceY - 0.73, -2.86);
    cloth.rotation.z = 0.04 * (index === 0 ? -1 : 1);
    cloth.material = materials.objectiveCloth;
    cloth.isPickable = false;
  }
}

function createHeraldry(scene: Scene, root: TransformNode, materials: MaterialLibrary): void {
  for (const side of [-1, 1] as const) {
    const shield = MeshBuilder.CreateCylinder(`tower-shield-${side}`, { height: 0.18, diameter: 1.2, tessellation: 10 }, scene);
    shield.parent = root;
    shield.position.set(2.05 * side, 4.35, -2.74);
    shield.rotation.x = Math.PI / 2;
    shield.scaling.y = 1.15;
    shield.material = materials.metal;
    shield.isPickable = false;

    const boss = MeshBuilder.CreateSphere(`tower-shield-boss-${side}`, { diameter: 0.34, segments: 6 }, scene);
    boss.parent = root;
    boss.position.set(2.05 * side, 4.35, -2.86);
    boss.material = materials.gold;
    boss.isPickable = false;
  }
}

function createApproachAccents(scene: Scene, root: TransformNode, materials: MaterialLibrary): void {
  for (const side of [-1, 1] as const) {
    const apron = MeshBuilder.CreateBox(`tower-approach-${side}`, { width: 3.2, height: 0.13, depth: 3.25 }, scene);
    apron.parent = root;
    apron.position.set(0, 0.1, side * 5.35);
    apron.material = materials.road;
    apron.receiveShadows = true;
    apron.isPickable = false;

    for (const x of [-1.72, 1.72]) {
      for (const offset of [-0.85, 0, 0.85]) {
        const edge = MeshBuilder.CreateBox(`tower-edge-stone-${side}-${x}-${offset}`, { width: 0.48, height: 0.24, depth: 0.62 }, scene);
        edge.parent = root;
        edge.position.set(x, 0.19, side * 5.35 + offset);
        edge.rotation.y = (side * x + offset) * 0.035;
        edge.material = materials.stoneWarm;
        edge.receiveShadows = true;
        edge.isPickable = false;
      }
    }
  }
}
