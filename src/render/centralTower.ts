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

  // ---- Stronger, more detailed medieval base: a wider dark foundation, a dressed plinth
  // and a chamfered transition into the open arcade. Castle-stone tones keep it consistent
  // with the two keeps while the octagon silhouette stays centred on the gameplay footprint.
  addOctagonalLayer(
    'tower-plaza-foundation',
    0.36,
    CENTRAL_TOWER.baseWidth,
    CENTRAL_TOWER.baseWidth,
    0.18,
    CENTRAL_TOWER.baseDepth / CENTRAL_TOWER.baseWidth,
    materials.castleStoneDark,
  );
  addOctagonalLayer('tower-plaza-plinth', 0.34, 6.95, 6.55, 0.5, 0.9, materials.castleStone);
  addOctagonalLayer('tower-base-chamfer', 0.2, 6.55, 6.2, 0.77, 0.88, materials.castleStoneLight);
  addOctagonalLayer('tower-arcade-step', 0.26, 6.2, 5.95, 0.93, 0.88, materials.castleStoneDark);

  createOpenArcade(scene, root, materials);

  const platformDepthScale = CENTRAL_TOWER.topPlatformDepth / CENTRAL_TOWER.topPlatformWidth;
  // Corbelled crown: a dark recess, a light string course and the gold objective ring frame
  // the upper deck so the main objective reads as the premium centrepiece of the arena.
  addOctagonalLayer('tower-open-corbel', 0.34, 5.45, 5.9, 8.62, 0.87, materials.castleStoneDark);
  addOctagonalLayer('tower-crown-trim', 0.2, 5.9, 6.08, 8.87, platformDepthScale, materials.castleStoneLight);
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
  // Thin gold lip along the deck edge ties the crown ring to the walkable surface.
  addOctagonalLayer(
    'tower-deck-edge-trim',
    0.08,
    CENTRAL_TOWER.topPlatformWidth + 0.06,
    CENTRAL_TOWER.topPlatformWidth + 0.06,
    CENTRAL_TOWER.topSurfaceY + 0.02,
    platformDepthScale,
    materials.gold,
  );

  createBattlementParapet(scene, root, materials);
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
  // Stronger dressed-stone shafts carry the upper crown. The shaft is marginally wider so the
  // proportions read heavier without widening the gameplay footprint (collisions use baseWidth).
  const pillar = MeshBuilder.CreateBox('tower-arcade-pillar-source', {
    width: 0.64,
    height: CENTRAL_TOWER.shaftHeight,
    depth: 0.64,
  }, scene);
  configureStatic(pillar, root, materials.castleStone);
  pillar.position.copyFrom(pillarPositions[0]);
  for (let index = 1; index < pillarPositions.length; index += 1) {
    const instance = pillar.createInstance(`tower-arcade-pillar-${index}`);
    instance.parent = root;
    instance.position.copyFrom(pillarPositions[index]);
    instance.isPickable = false;
  }

  // Two-step plinth base: a wide dark foot and a lighter die, giving each pillar a proper
  // medieval base course that grounds the arcade.
  const foot = MeshBuilder.CreateBox('tower-pillar-foot-source', { width: 0.96, height: 0.36, depth: 0.96 }, scene);
  configureStatic(foot, root, materials.castleStoneDark);
  foot.position.set(pillarPositions[0].x, 1.1, pillarPositions[0].z);
  const die = MeshBuilder.CreateBox('tower-pillar-die-source', { width: 0.78, height: 0.22, depth: 0.78 }, scene);
  configureStatic(die, root, materials.castleStoneLight);
  die.position.set(pillarPositions[0].x, 1.39, pillarPositions[0].z);
  // Capital with a projecting abacus plate so the load reads as transferring into the crown.
  const capital = MeshBuilder.CreateBox('tower-pillar-capital-source', { width: 0.94, height: 0.3, depth: 0.94 }, scene);
  configureStatic(capital, root, materials.castleStoneLight);
  capital.position.set(pillarPositions[0].x, 8.25, pillarPositions[0].z);
  const abacus = MeshBuilder.CreateBox('tower-pillar-abacus-source', { width: 1.04, height: 0.14, depth: 1.04 }, scene);
  configureStatic(abacus, root, materials.castleStoneDark);
  abacus.position.set(pillarPositions[0].x, 8.46, pillarPositions[0].z);
  for (let index = 1; index < pillarPositions.length; index += 1) {
    const footInstance = foot.createInstance(`tower-pillar-foot-${index}`);
    footInstance.parent = root;
    footInstance.position.set(pillarPositions[index].x, 1.1, pillarPositions[index].z);
    footInstance.isPickable = false;
    const dieInstance = die.createInstance(`tower-pillar-die-${index}`);
    dieInstance.parent = root;
    dieInstance.position.set(pillarPositions[index].x, 1.39, pillarPositions[index].z);
    dieInstance.isPickable = false;
    const capitalInstance = capital.createInstance(`tower-pillar-capital-${index}`);
    capitalInstance.parent = root;
    capitalInstance.position.set(pillarPositions[index].x, 8.25, pillarPositions[index].z);
    capitalInstance.isPickable = false;
    const abacusInstance = abacus.createInstance(`tower-pillar-abacus-${index}`);
    abacusInstance.parent = root;
    abacusInstance.position.set(pillarPositions[index].x, 8.46, pillarPositions[index].z);
    abacusInstance.isPickable = false;
  }

  // Short angled voussoirs imply four arches without filling their openings, alternating light
  // and dark stone like the castle gate bands for a consistent dressed-stone vocabulary.
  for (const z of [-1.58, 1.58]) {
    for (const side of [-1, 1]) {
      const arch = MeshBuilder.CreateBox(`tower-arch-long-${z}-${side}`, { width: 1.82, height: 0.36, depth: 0.46 }, scene);
      configureStatic(arch, root, side > 0 ? materials.castleStoneLight : materials.castleStoneDark);
      arch.position.set(side * 1.36, 8.12, z);
      arch.rotation.z = -side * 0.39;
    }
    const keystone = MeshBuilder.CreateBox(`tower-arch-long-keystone-${z}`, { width: 0.74, height: 0.52, depth: 0.54 }, scene);
    configureStatic(keystone, root, materials.castleStoneLight);
    keystone.position.set(0, 8.38, z);
  }

  for (const x of [-2.2, 2.2]) {
    for (const side of [-1, 1]) {
      const arch = MeshBuilder.CreateBox(`tower-arch-side-${x}-${side}`, { width: 0.46, height: 0.34, depth: 1.25 }, scene);
      configureStatic(arch, root, side > 0 ? materials.castleStoneLight : materials.castleStoneDark);
      arch.position.set(x, 8.08, side * 0.96);
      arch.rotation.x = side * 0.34;
    }
    const keystone = MeshBuilder.CreateBox(`tower-arch-side-keystone-${x}`, { width: 0.54, height: 0.48, depth: 0.58 }, scene);
    configureStatic(keystone, root, materials.castleStoneLight);
    keystone.position.set(x, 8.35, 0);
  }
}

function createBattlementParapet(scene: Scene, root: TransformNode, materials: MaterialLibrary): void {
  const deckY = CENTRAL_TOWER.topSurfaceY;
  const copingY = deckY + 0.17;
  const merlonY = deckY + 0.5;

  // Low coping runs the edges with the same ladder-exit gaps as the original railing so the
  // side climb paths stay clear.
  const coping = [
    { w: 2.05, d: 0.26, x: -1.6, z: -2.47 },
    { w: 2.05, d: 0.26, x: 1.6, z: -2.47 },
    { w: 2.05, d: 0.26, x: -1.6, z: 2.47 },
    { w: 2.05, d: 0.26, x: 1.6, z: 2.47 },
    { w: 0.26, d: 1.25, x: -2.92, z: 1.22 },
    { w: 0.26, d: 1.25, x: 2.92, z: -1.22 },
  ];
  for (const [index, rail] of coping.entries()) {
    const mesh = MeshBuilder.CreateBox(`tower-battlement-coping-${index}`, {
      width: rail.w,
      height: 0.3,
      depth: rail.d,
    }, scene);
    configureStatic(mesh, root, materials.castleStoneDark);
    mesh.position.set(rail.x, copingY, rail.z);
  }

  // Raised merlons (crenellations) along the front, back and side edges, kept clear of the
  // ladder-exit gaps. One source renders as instances to stay a single draw call.
  const merlons = [
    { x: -1.6, z: -2.47 }, { x: 0, z: -2.47 }, { x: 1.6, z: -2.47 },
    { x: -1.6, z: 2.47 }, { x: 0, z: 2.47 }, { x: 1.6, z: 2.47 },
    { x: -2.92, z: 2.0 }, { x: 2.92, z: -2.0 },
  ];
  const merlon = MeshBuilder.CreateBox('tower-battlement-merlon-source', { width: 0.9, height: 0.86, depth: 0.74 }, scene);
  configureStatic(merlon, root, materials.castleStoneLight);
  merlon.position.set(merlons[0].x, merlonY, merlons[0].z);
  for (let index = 1; index < merlons.length; index += 1) {
    const instance = merlon.createInstance(`tower-battlement-merlon-${index}`);
    instance.parent = root;
    instance.position.set(merlons[index].x, merlonY, merlons[index].z);
    instance.isPickable = false;
  }

  // Corner pinnacles above the four pillar axes: a slim octagonal shaft, a cone spire and a
  // gold finial. They lift the silhouette without adding bulk and echo the castle turrets.
  const pinnaclePositions: ReadonlyArray<readonly [number, number]> = [
    [-2.75, -2.35], [2.75, -2.35], [-2.75, 2.35], [2.75, 2.35],
  ];
  const pBaseY = deckY + 0.05;
  const pShaft = MeshBuilder.CreateCylinder('tower-pinnacle-shaft-source', { height: 1.3, diameterTop: 0.34, diameterBottom: 0.5, tessellation: 8 }, scene);
  configureStatic(pShaft, root, materials.castleStoneLight);
  pShaft.position.set(pinnaclePositions[0][0], pBaseY + 0.65, pinnaclePositions[0][1]);
  const pCap = MeshBuilder.CreateCylinder('tower-pinnacle-cap-source', { height: 0.6, diameterTop: 0, diameterBottom: 0.42, tessellation: 8 }, scene);
  configureStatic(pCap, root, materials.castleStoneLight);
  pCap.position.set(pinnaclePositions[0][0], pBaseY + 1.6, pinnaclePositions[0][1]);
  const pBall = MeshBuilder.CreateSphere('tower-pinnacle-finial-source', { diameter: 0.22, segments: 6 }, scene);
  configureStatic(pBall, root, materials.gold);
  pBall.position.set(pinnaclePositions[0][0], pBaseY + 2.02, pinnaclePositions[0][1]);
  for (let index = 1; index < pinnaclePositions.length; index += 1) {
    const [x, z] = pinnaclePositions[index];
    const shaft = pShaft.createInstance(`tower-pinnacle-shaft-${index}`);
    shaft.parent = root; shaft.position.set(x, pBaseY + 0.65, z); shaft.isPickable = false;
    const cap = pCap.createInstance(`tower-pinnacle-cap-${index}`);
    cap.parent = root; cap.position.set(x, pBaseY + 1.6, z); cap.isPickable = false;
    const ball = pBall.createInstance(`tower-pinnacle-finial-${index}`);
    ball.parent = root; ball.position.set(x, pBaseY + 2.02, z); ball.isPickable = false;
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
