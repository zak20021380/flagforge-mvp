import {
  Mesh,
  MeshBuilder,
  Quaternion,
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

type LadderId = keyof typeof CENTRAL_TOWER.ladders;

export function createCentralTower(scene: Scene, materials: MaterialLibrary): CentralTowerVisual {
  const root = new TransformNode('central-flag-tower-root', scene);
  root.position.set(CENTRAL_TOWER.centerX, 0, CENTRAL_TOWER.centerZ);

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

  // A low stepped base keys into the plaza. Above it, the entire shaft is an
  // open arcade so the enemy castle and combat remain visible through the tower.
  addOctagonalLayer(
    'tower-plaza-foundation',
    0.34,
    CENTRAL_TOWER.baseWidth,
    CENTRAL_TOWER.baseWidth,
    0.17,
    CENTRAL_TOWER.baseDepth / CENTRAL_TOWER.baseWidth,
    materials.stoneDark,
  );
  addOctagonalLayer('tower-plaza-plinth', 0.34, 6.95, 6.55, 0.48, 0.9, materials.stoneWarm);
  addOctagonalLayer('tower-arcade-step', 0.28, 6.35, 5.95, 0.79, 0.88, materials.stoneLight);

  createOpenArcade(scene, root, materials);

  const platformDepthScale = CENTRAL_TOWER.topPlatformDepth / CENTRAL_TOWER.topPlatformWidth;
  addOctagonalLayer('tower-open-corbel', 0.34, 5.45, 5.9, 8.62, 0.87, materials.stoneDark);
  addOctagonalLayer('tower-crown-trim', 0.2, 5.9, 6.08, 8.87, platformDepthScale, materials.stoneLight);
  addOctagonalLayer('tower-objective-ring', 0.12, 6.18, 6.18, 9, platformDepthScale, materials.gold);
  addOctagonalLayer(
    'tower-top-platform',
    0.26,
    CENTRAL_TOWER.topPlatformWidth,
    CENTRAL_TOWER.topPlatformWidth,
    CENTRAL_TOWER.topSurfaceY - 0.13,
    platformDepthScale,
    materials.road,
  );

  createOpenParapet(scene, root, materials);
  createSideLadder(scene, root, materials, 'player');
  createSideLadder(scene, root, materials, 'enemy');
  createSideBanners(scene, root, materials);
  createHeraldry(scene, root, materials);

  return {
    root,
    topCenter: new Vector3(CENTRAL_TOWER.centerX, CENTRAL_TOWER.topUnitY, CENTRAL_TOWER.centerZ),
  };
}

function configureStatic(mesh: Mesh, root: TransformNode, material: Mesh['material']): void {
  mesh.parent = root;
  mesh.material = material;
  mesh.receiveShadows = true;
  mesh.isPickable = false;
}

function createOpenArcade(scene: Scene, root: TransformNode, materials: MaterialLibrary): void {
  const pillarPositions = [
    new Vector3(-2.2, 4.61, -1.58),
    new Vector3(2.2, 4.61, -1.58),
    new Vector3(-2.2, 4.61, 1.58),
    new Vector3(2.2, 4.61, 1.58),
  ];
  const pillar = MeshBuilder.CreateBox('tower-arcade-pillar-source', {
    width: 0.58,
    height: CENTRAL_TOWER.shaftHeight,
    depth: 0.58,
  }, scene);
  configureStatic(pillar, root, materials.stone);
  pillar.position.copyFrom(pillarPositions[0]);
  for (let index = 1; index < pillarPositions.length; index += 1) {
    const instance = pillar.createInstance(`tower-arcade-pillar-${index}`);
    instance.parent = root;
    instance.position.copyFrom(pillarPositions[index]);
    instance.isPickable = false;
  }

  const foot = MeshBuilder.CreateBox('tower-pillar-foot-source', { width: 0.86, height: 0.34, depth: 0.86 }, scene);
  configureStatic(foot, root, materials.stoneDark);
  foot.position.set(pillarPositions[0].x, 1.08, pillarPositions[0].z);
  const capital = MeshBuilder.CreateBox('tower-pillar-capital-source', { width: 0.88, height: 0.3, depth: 0.88 }, scene);
  configureStatic(capital, root, materials.stoneLight);
  capital.position.set(pillarPositions[0].x, 8.25, pillarPositions[0].z);
  for (let index = 1; index < pillarPositions.length; index += 1) {
    const footInstance = foot.createInstance(`tower-pillar-foot-${index}`);
    footInstance.parent = root;
    footInstance.position.set(pillarPositions[index].x, 1.08, pillarPositions[index].z);
    footInstance.isPickable = false;
    const capitalInstance = capital.createInstance(`tower-pillar-capital-${index}`);
    capitalInstance.parent = root;
    capitalInstance.position.set(pillarPositions[index].x, 8.25, pillarPositions[index].z);
    capitalInstance.isPickable = false;
  }

  // Short angled stones imply four arches without filling their openings.
  for (const z of [-1.58, 1.58]) {
    for (const side of [-1, 1]) {
      const arch = MeshBuilder.CreateBox(`tower-arch-long-${z}-${side}`, { width: 1.82, height: 0.36, depth: 0.46 }, scene);
      configureStatic(arch, root, materials.stoneWarm);
      arch.position.set(side * 1.36, 8.12, z);
      arch.rotation.z = -side * 0.39;
    }
    const keystone = MeshBuilder.CreateBox(`tower-arch-long-keystone-${z}`, { width: 0.74, height: 0.52, depth: 0.54 }, scene);
    configureStatic(keystone, root, materials.stoneLight);
    keystone.position.set(0, 8.38, z);
  }

  for (const x of [-2.2, 2.2]) {
    for (const side of [-1, 1]) {
      const arch = MeshBuilder.CreateBox(`tower-arch-side-${x}-${side}`, { width: 0.46, height: 0.34, depth: 1.25 }, scene);
      configureStatic(arch, root, materials.stoneWarm);
      arch.position.set(x, 8.08, side * 0.96);
      arch.rotation.x = side * 0.34;
    }
    const keystone = MeshBuilder.CreateBox(`tower-arch-side-keystone-${x}`, { width: 0.54, height: 0.48, depth: 0.58 }, scene);
    configureStatic(keystone, root, materials.stoneLight);
    keystone.position.set(x, 8.35, 0);
  }
}

function createOpenParapet(scene: Scene, root: TransformNode, materials: MaterialLibrary): void {
  const railY = CENTRAL_TOWER.topSurfaceY + 0.2;
  const rails = [
    { width: 2.05, depth: 0.2, x: -1.6, z: -2.47 },
    { width: 2.05, depth: 0.2, x: 1.6, z: -2.47 },
    { width: 2.05, depth: 0.2, x: -1.6, z: 2.47 },
    { width: 2.05, depth: 0.2, x: 1.6, z: 2.47 },
    // Side gaps line up with the ladder exits.
    { width: 0.2, depth: 1.25, x: -2.92, z: 1.22 },
    { width: 0.2, depth: 1.25, x: 2.92, z: -1.22 },
  ];
  for (const [index, rail] of rails.entries()) {
    const mesh = MeshBuilder.CreateBox(`tower-open-parapet-rail-${index}`, {
      width: rail.width,
      height: 0.22,
      depth: rail.depth,
    }, scene);
    configureStatic(mesh, root, materials.stoneDark);
    mesh.position.set(rail.x, railY, rail.z);
  }

  const posts = [
    [-2.75, -2.35], [0, -2.52], [2.75, -2.35],
    [-2.75, 2.35], [0, 2.52], [2.75, 2.35],
    [-2.9, 0.35], [-2.9, 2], [2.9, -2], [2.9, -0.35],
  ] as const;
  const post = MeshBuilder.CreateBox('tower-parapet-post-source', { width: 0.46, height: 0.72, depth: 0.46 }, scene);
  configureStatic(post, root, materials.stoneLight);
  post.position.set(posts[0][0], CENTRAL_TOWER.topSurfaceY + 0.39, posts[0][1]);
  for (let index = 1; index < posts.length; index += 1) {
    const instance = post.createInstance(`tower-parapet-post-${index}`);
    instance.parent = root;
    instance.position.set(posts[index][0], CENTRAL_TOWER.topSurfaceY + 0.39, posts[index][1]);
    instance.isPickable = false;
  }
}

function createSideLadder(
  scene: Scene,
  root: TransformNode,
  materials: MaterialLibrary,
  id: LadderId,
): void {
  const ladder = CENTRAL_TOWER.ladders[id];
  const bottom = new Vector3(
    ladder.groundAlign.x - CENTRAL_TOWER.centerX,
    ladder.groundAlign.y,
    ladder.groundAlign.z - CENTRAL_TOWER.centerZ,
  );
  const top = new Vector3(
    ladder.climbTop.x - CENTRAL_TOWER.centerX,
    ladder.climbTop.y,
    ladder.climbTop.z - CENTRAL_TOWER.centerZ,
  );
  const shaft = top.subtract(bottom);
  const length = shaft.length();
  const shaftDirection = shaft.scale(1 / length);
  const radialCenter = bottom.add(top).scale(0.5);
  const rungDirection = new Vector3(-radialCenter.z, 0, radialCenter.x).normalize();
  const outwardDirection = Vector3.Cross(rungDirection, shaftDirection).normalize();
  const rotation = Quaternion.RotationQuaternionFromAxis(rungDirection, shaftDirection, outwardDirection);
  const sideLabel = ladder.side;

  for (const offset of [-0.64, 0.64]) {
    const rail = MeshBuilder.CreateCylinder(`tower-${sideLabel}-ladder-rail-${offset}`, {
      height: length,
      diameter: 0.15,
      tessellation: 7,
    }, scene);
    configureStatic(rail, root, materials.wood);
    rail.position.copyFrom(bottom.add(top).scale(0.5).add(rungDirection.scale(offset)));
    rail.rotationQuaternion = rotation.clone();
  }

  const rungCount = Math.ceil(length / 0.43);
  const rung = MeshBuilder.CreateBox(`tower-${sideLabel}-ladder-rung-source`, {
    width: 1.48,
    height: 0.12,
    depth: 0.15,
  }, scene);
  configureStatic(rung, root, materials.wood);
  rung.rotationQuaternion = rotation.clone();
  for (let index = 0; index < rungCount; index += 1) {
    const t = (index + 0.5) / rungCount;
    const position = bottom.add(shaft.scale(t));
    const item = index === 0 ? rung : rung.createInstance(`tower-${sideLabel}-ladder-rung-${index}`);
    item.parent = root;
    item.position.copyFrom(position);
    item.isPickable = false;
    if (index > 0) item.rotationQuaternion = rotation.clone();
  }
}

function createSideBanners(scene: Scene, root: TransformNode, materials: MaterialLibrary): void {
  for (const [index, x] of [-2.42, 2.42].entries()) {
    const pole = MeshBuilder.CreateCylinder(`tower-side-banner-pole-${index}`, { height: 2.75, diameter: 0.09, tessellation: 7 }, scene);
    configureStatic(pole, root, materials.metal);
    pole.position.set(x, 7.15, -1.82);

    const crossbar = MeshBuilder.CreateBox(`tower-side-banner-crossbar-${index}`, { width: 0.82, height: 0.08, depth: 0.08 }, scene);
    configureStatic(crossbar, root, materials.gold);
    crossbar.position.set(x + (x < 0 ? 0.32 : -0.32), 8.22, -1.88);

    const cloth = MeshBuilder.CreateBox(`tower-side-banner-cloth-${index}`, { width: 0.68, height: 1.38, depth: 0.06 }, scene);
    configureStatic(cloth, root, materials.objectiveCloth);
    cloth.position.set(x + (x < 0 ? 0.34 : -0.34), 7.48, -1.9);
    cloth.rotation.z = x < 0 ? -0.035 : 0.035;
  }
}

function createHeraldry(scene: Scene, root: TransformNode, materials: MaterialLibrary): void {
  for (const side of [-1, 1] as const) {
    const shield = MeshBuilder.CreateCylinder(`tower-arcade-shield-${side}`, { height: 0.12, diameter: 0.92, tessellation: 8 }, scene);
    configureStatic(shield, root, materials.metal);
    shield.position.set(2.2 * side, 4.8, -1.9);
    shield.rotation.x = Math.PI / 2;
    shield.scaling.y = 1.12;

    const boss = MeshBuilder.CreateSphere(`tower-arcade-shield-boss-${side}`, { diameter: 0.25, segments: 5 }, scene);
    configureStatic(boss, root, materials.gold);
    boss.position.set(2.2 * side, 4.8, -1.98);
  }
}
