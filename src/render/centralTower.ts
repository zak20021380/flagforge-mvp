import {
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { CENTRAL_TOWER, CENTRAL_TOWER_LADDER_FRAME } from '../core/config';
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

  // ---- Grand royal base: a wide dark foundation, a dressed plinth with a clean light string
  // course, a chamfered transition and the arcade step. The extra course lifts the whole mass so
  // the crown reads taller, while every layer stays inside the gameplay footprint (baseWidth x
  // baseDepth) the ladder bases and collision rules are authored against.
  addOctagonalLayer(
    'tower-plaza-foundation',
    0.4,
    CENTRAL_TOWER.baseWidth,
    CENTRAL_TOWER.baseWidth,
    0.2,
    CENTRAL_TOWER.baseDepth / CENTRAL_TOWER.baseWidth,
    materials.castleStoneDark,
  );
  addOctagonalLayer('tower-plaza-plinth', 0.44, 6.95, 6.55, 0.62, 0.9, materials.castleStone);
  addOctagonalLayer('tower-plinth-trim', 0.1, 6.55, 6.55, 0.87, 0.9, materials.castleStoneLight);
  addOctagonalLayer('tower-base-chamfer', 0.18, 6.55, 6.2, 1.01, 0.9, materials.castleStoneLight);
  addOctagonalLayer('tower-arcade-step', 0.26, 6.2, 5.95, 1.19, 0.9, materials.castleStoneDark);

  createOpenArcade(scene, root, materials);

  const platformDepthScale = CENTRAL_TOWER.topPlatformDepth / CENTRAL_TOWER.topPlatformWidth;
  // Corbelled crown: a dark recess, a slim light string course and the gold objective ring frame
  // the light-paved royal deck, so the main objective reads as the premium centrepiece of the
  // arena. The slab overhangs the recess to cast a clean shadow line around the walkable surface.
  addOctagonalLayer('tower-open-corbel', 0.34, 5.45, 5.9, 8.62, 0.87, materials.castleStoneDark);
  addOctagonalLayer('tower-crown-trim', 0.16, 5.9, 6.0, 8.87, platformDepthScale, materials.castleStoneLight);
  addOctagonalLayer('tower-objective-ring', 0.12, 6.18, 6.18, 9.0, platformDepthScale, materials.gold);
  addOctagonalLayer(
    'tower-top-platform',
    0.26,
    CENTRAL_TOWER.topPlatformWidth,
    CENTRAL_TOWER.topPlatformWidth,
    CENTRAL_TOWER.topSurfaceY - 0.13,
    platformDepthScale,
    materials.castleStoneLight,
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

  createFlagMount(scene, root, materials);
  createBattlementParapet(scene, root, materials);
  createSideLadder(scene, root, materials, 'player');
  createSideLadder(scene, root, materials, 'enemy');
  createPennants(scene, root, materials);
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

/**
 * Royal flag mount: a three-course octagonal dais set in the middle of the deck directly under the
 * objective pole. A dark plinth, a gold band and a light upper step make the flag read as mounted
 * on a proper plinth instead of standing on the bare deck. Purely visual: the walkable surface and
 * every flag rule stay untouched.
 */
function createFlagMount(scene: Scene, root: TransformNode, materials: MaterialLibrary): void {
  const deckY = CENTRAL_TOWER.topSurfaceY;
  const addCourse = (name: string, height: number, diameter: number, y: number, material: Mesh['material']): void => {
    const mesh = MeshBuilder.CreateCylinder(name, { height, diameter, tessellation: 8 }, scene);
    configureStatic(mesh, root, material);
    mesh.position.y = y;
  };
  addCourse('tower-flag-dais-base', 0.18, 2.3, deckY + 0.07, materials.castleStoneDark);
  addCourse('tower-flag-dais-trim', 0.06, 2.3, deckY + 0.17, materials.gold);
  addCourse('tower-flag-dais-top', 0.08, 1.5, deckY + 0.16, materials.castleStoneLight);
}

function createBattlementParapet(scene: Scene, root: TransformNode, materials: MaterialLibrary): void {
  const deckY = CENTRAL_TOWER.topSurfaceY;
  const copingY = deckY + 0.19;
  const merlonY = deckY + 0.51;
  const merlonHeight = 1.02;
  const capY = merlonY + merlonHeight / 2 + 0.07;

  // Clean low parapet coping running the edges with the same ladder-exit gaps as the original
  // railing so the side climb paths stay clear.
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
      height: 0.34,
      depth: rail.d,
    }, scene);
    configureStatic(mesh, root, materials.castleStoneDark);
    mesh.position.set(rail.x, copingY, rail.z);
  }

  // Raised crenellations along the front, back and side edges, kept clear of the ladder-exit
  // gaps. Taller blocks with dressed coping caps give the parapet a clean, finished royal trim.
  const merlons = [
    { x: -1.6, z: -2.47 }, { x: 0, z: -2.47 }, { x: 1.6, z: -2.47 },
    { x: -1.6, z: 2.47 }, { x: 0, z: 2.47 }, { x: 1.6, z: 2.47 },
    { x: -2.92, z: 2.0 }, { x: 2.92, z: -2.0 },
  ];
  const merlon = MeshBuilder.CreateBox('tower-battlement-merlon-source', { width: 0.9, height: merlonHeight, depth: 0.74 }, scene);
  configureStatic(merlon, root, materials.castleStoneLight);
  merlon.position.set(merlons[0].x, merlonY, merlons[0].z);
  const cap = MeshBuilder.CreateBox('tower-battlement-cap-source', { width: 1.06, height: 0.14, depth: 0.88 }, scene);
  configureStatic(cap, root, materials.castleStoneDark);
  cap.position.set(merlons[0].x, capY, merlons[0].z);
  for (let index = 1; index < merlons.length; index += 1) {
    const merlonInstance = merlon.createInstance(`tower-battlement-merlon-${index}`);
    merlonInstance.parent = root;
    merlonInstance.position.set(merlons[index].x, merlonY, merlons[index].z);
    merlonInstance.isPickable = false;
    const capInstance = cap.createInstance(`tower-battlement-cap-${index}`);
    capInstance.parent = root;
    capInstance.position.set(merlons[index].x, capY, merlons[index].z);
    capInstance.isPickable = false;
  }

  // Corner pinnacles above the four pillar axes: a slim octagonal shaft, a cone spire, a gold
  // ball and a spear finial. They lift the silhouette without adding bulk and echo the castle
  // turrets, making the crown read taller from the portrait camera.
  const pinnaclePositions: ReadonlyArray<readonly [number, number]> = [
    [-2.75, -2.35], [2.75, -2.35], [-2.75, 2.35], [2.75, 2.35],
  ];
  const pBaseY = deckY + 0.05;
  const pShaft = MeshBuilder.CreateCylinder('tower-pinnacle-shaft-source', { height: 1.6, diameterTop: 0.34, diameterBottom: 0.5, tessellation: 8 }, scene);
  configureStatic(pShaft, root, materials.castleStoneLight);
  pShaft.position.set(pinnaclePositions[0][0], pBaseY + 0.8, pinnaclePositions[0][1]);
  const pCap = MeshBuilder.CreateCylinder('tower-pinnacle-cap-source', { height: 0.72, diameterTop: 0, diameterBottom: 0.42, tessellation: 8 }, scene);
  configureStatic(pCap, root, materials.castleStoneLight);
  pCap.position.set(pinnaclePositions[0][0], pBaseY + 1.96, pinnaclePositions[0][1]);
  const pBall = MeshBuilder.CreateSphere('tower-pinnacle-finial-source', { diameter: 0.26, segments: 6 }, scene);
  configureStatic(pBall, root, materials.gold);
  pBall.position.set(pinnaclePositions[0][0], pBaseY + 2.45, pinnaclePositions[0][1]);
  const pSpear = MeshBuilder.CreateCylinder('tower-pinnacle-spear-source', { height: 0.34, diameterTop: 0, diameterBottom: 0.18, tessellation: 6 }, scene);
  configureStatic(pSpear, root, materials.gold);
  pSpear.position.set(pinnaclePositions[0][0], pBaseY + 2.75, pinnaclePositions[0][1]);
  for (let index = 1; index < pinnaclePositions.length; index += 1) {
    const [x, z] = pinnaclePositions[index];
    const shaft = pShaft.createInstance(`tower-pinnacle-shaft-${index}`);
    shaft.parent = root; shaft.position.set(x, pBaseY + 0.8, z); shaft.isPickable = false;
    const cap = pCap.createInstance(`tower-pinnacle-cap-${index}`);
    cap.parent = root; cap.position.set(x, pBaseY + 1.96, z); cap.isPickable = false;
    const ball = pBall.createInstance(`tower-pinnacle-finial-${index}`);
    ball.parent = root; ball.position.set(x, pBaseY + 2.45, z); ball.isPickable = false;
    const spear = pSpear.createInstance(`tower-pinnacle-spear-${index}`);
    spear.parent = root; spear.position.set(x, pBaseY + 2.75, z); spear.isPickable = false;
  }
}

/**
 * The single shared siege-ladder blueprint for both tower sides. The climb centreline stays exactly
 * on the gameplay path (groundAlign -> climbTop); the near player ladder and the far enemy ladder
 * are built from this one design and mirrored across the tower, so their size, shape, materials,
 * rung count and spacing are identical.
 *
 * The ladder is pure carpentry: two thick squared oak stiles carrying evenly spaced solid oak
 * rungs, closed at the head by a cross brace and bearing at the foot on a squared timber sleeper,
 * with two slim iron lashing bands as the only metal. Rungs are one value lighter than the stiles
 * and deep enough to catch the sun, so every step reads as its own plank from the portrait camera
 * instead of a faint bar between two rails. The whole shape comes from geometry — the grain map
 * only keeps the timber from looking painted. Both ends stand clear of the stonework, the foot
 * further out than the head, so the frame reads as a real leaning ladder while the head still
 * clears the corbelled crown and the gold objective ring instead of clipping the deck edge.
 */
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
  // The climb centreline stays exactly on the gameplay path (groundAlign -> climbTop).
  const shaft = top.subtract(bottom);
  const length = shaft.length();
  const shaftDirection = shaft.scale(1 / length);
  const radialCenter = bottom.add(top).scale(0.5);
  // Tangential axis, running along the tower face the ladder leans against.
  const rungDirection = new Vector3(-radialCenter.z, 0, radialCenter.x).normalize();
  // Outward face normal: away from the tower centre, where the rungs are climbed.
  const outwardDirection = Vector3.Cross(shaftDirection, rungDirection).normalize();
  // The standoff below is applied along the horizontal part of that normal.
  const panelOutward = new Vector3(outwardDirection.x, 0, outwardDirection.z).normalize();
  const sideLabel = ladder.side;

  // ---- Proportions. One half-span drives the stile spacing, the rung length and every brace, so
  // the frame stays square and the two ladders cannot drift apart. ----
  const railHalfSpan = 0.9;
  const railWidth = 0.32;   // across the ladder
  const railDepth = 0.5;    // toward the climber, the face that catches the light
  const rungHeight = 0.26;  // along the climb, the readable step thickness
  const rungLength = railHalfSpan * 2 + railWidth; // flush with the outer stile faces
  // Rungs sit a touch proud of the stile front faces, so each step keeps a lit top edge and a cast
  // shadow instead of disappearing into the stiles at a glancing camera angle.
  // The frame standoff (bottom..top), rungProud and rungDepth come from the shared
  // CENTRAL_TOWER_LADDER_FRAME table so the mesh and the climb attachment can never drift apart.
  const { bottomStandoff, topStandoff, rungProud, rungDepth } = CENTRAL_TOWER_LADDER_FRAME;
  const standoffAt = (t: number): number => bottomStandoff + (topStandoff - bottomStandoff) * t;
  const plantedDepth = 0.3;   // stiles sink below the climb start so the ladder reads as grounded
  // The stile heads stop a touch below the climb top, level with the deck lip, so the last rung
  // still caps the frame while the heads stay under the corner pinnacle bases (which start just
  // above the deck at the same corners the ladders exit through).
  const headTrim = 0.12;

  // ---- Side stiles: thick squared oak, planted in the plaza and topping out level with the deck
  // lip. Square section, not turned rails: the flat lit face is what makes them read as sawn
  // timber from the portrait camera. ----
  const railOffsets: readonly number[] = [-railHalfSpan, railHalfSpan];
  const railBottoms = railOffsets.map((offset) => (
    bottom
      .add(rungDirection.scale(offset))
      .add(panelOutward.scale(bottomStandoff))
      .subtract(shaftDirection.scale(plantedDepth))
  ));
  const railTops = railOffsets.map((offset) => (
    top
      .add(rungDirection.scale(offset))
      .add(panelOutward.scale(topStandoff))
      .subtract(shaftDirection.scale(headTrim))
  ));
  const railShaft = railTops[0].subtract(railBottoms[0]);
  const railLength = railShaft.length();
  const railDirection = railShaft.scale(1 / railLength);
  const railRotation = Quaternion.RotationQuaternionFromAxis(
    rungDirection,
    railDirection,
    Vector3.Cross(rungDirection, railDirection).normalize(),
  );

  for (let index = 0; index < railOffsets.length; index += 1) {
    const rail = MeshBuilder.CreateBox(`tower-${sideLabel}-ladder-rail-${index}`, {
      width: railWidth,
      height: railLength,
      depth: railDepth,
    }, scene);
    configureStatic(rail, root, materials.ladderWoodDark);
    rail.position.copyFrom(railBottoms[index].add(railTops[index]).scale(0.5));
    rail.rotationQuaternion = railRotation.clone();
  }

  // ---- Rungs: solid oak steps, one value lighter than the stiles, evenly spaced and thick enough
  // to read individually from the gameplay camera. The sun sits high, so each step gets a bright lit
  // top face above a shaded front face — that value break, not a texture, is what separates one step
  // from the next at gameplay distance. ----
  const rungRotation = Quaternion.RotationQuaternionFromAxis(
    Vector3.Cross(shaftDirection, outwardDirection).normalize(),
    shaftDirection,
    outwardDirection,
  );
  // ~0.56 units of pitch: close enough to read as a continuous climb, open enough that the gap
  // between two steps is always wider than a step itself.
  const rungCount = Math.max(12, Math.round(length / 0.56));
  const rung = MeshBuilder.CreateBox(`tower-${sideLabel}-ladder-rung-source`, {
    width: rungLength,
    height: rungHeight,
    depth: rungDepth,
  }, scene);
  configureStatic(rung, root, materials.ladderWood);
  rung.rotationQuaternion = rungRotation.clone();
  for (let index = 0; index < rungCount; index += 1) {
    const t = (index + 0.5) / rungCount;
    const position = bottom
      .add(shaft.scale(t))
      .add(panelOutward.scale(standoffAt(t) + rungProud));
    const item = index === 0 ? rung : rung.createInstance(`tower-${sideLabel}-ladder-rung-${index}`);
    item.parent = root;
    item.position.copyFrom(position);
    item.isPickable = false;
    if (index > 0) item.rotationQuaternion = rungRotation.clone();
  }

  // ---- Back cross brace: one squared timber let in behind the stiles near the head, so the frame
  // reads as a carpentered ladder rather than two loose rails. It sits in the gap between the last
  // two rungs and behind the rung plane, so it never crowds a step. The foot of the frame is closed
  // by the sleeper beam below. ----
  const braceT = Math.max(0, (rungCount - 1) / rungCount);
  const brace = MeshBuilder.CreateBox(`tower-${sideLabel}-ladder-brace-head`, {
    width: rungLength,
    height: 0.2,
    depth: railDepth * 0.6,
  }, scene);
  configureStatic(brace, root, materials.ladderWoodDark);
  brace.rotationQuaternion = rungRotation.clone();
  brace.position.copyFrom(
    bottom
      .add(shaft.scale(braceT))
      .add(panelOutward.scale(standoffAt(braceT) - railDepth * 0.34)),
  );

  // ---- Iron lashing bands: two slim straps wrapping the stiles low and mid shaft. Their heights
  // land in rung gaps for the same reason. Small on purpose — they add a premium accent without
  // making the ladder read metallic. ----
  const bandRungGaps = [2, 10];
  for (const [index, gapIndex] of bandRungGaps.entries()) {
    const t = Math.min(braceT, gapIndex / rungCount);
    const band = MeshBuilder.CreateBox(`tower-${sideLabel}-ladder-band-${index}`, {
      width: railWidth + 0.1,
      height: 0.14,
      depth: railDepth + 0.1,
    }, scene);
    configureStatic(band, root, materials.metal);
    band.rotationQuaternion = rungRotation.clone();
    const center = bottom.add(shaft.scale(t)).add(panelOutward.scale(standoffAt(t)));
    band.position.copyFrom(center.add(rungDirection.scale(-railHalfSpan)));
    const mirrored = band.createInstance(`tower-${sideLabel}-ladder-band-${index}-b`);
    mirrored.parent = root;
    mirrored.position.copyFrom(center.add(rungDirection.scale(railHalfSpan)));
    mirrored.rotationQuaternion = rungRotation.clone();
    mirrored.isPickable = false;
  }

  // ---- Foot beam: a squared timber sleeper the stiles bear on where the ladder meets the plaza. ----
  const beam = MeshBuilder.CreateBox(`tower-${sideLabel}-ladder-foot-beam`, {
    width: rungLength + 0.5,
    height: 0.22,
    depth: 0.6,
  }, scene);
  configureStatic(beam, root, materials.ladderWoodDark);
  beam.rotationQuaternion = rungRotation.clone();
  beam.position.copyFrom(bottom.add(panelOutward.scale(bottomStandoff)));
  beam.position.y = 0.11;
}

/**
 * Royal pennant standards on the front and back merlon caps. Gold poles with small cloth pennants
 * flank the flag axis, lifting the crown silhouette and echoing the objective colours without
 * crowding the ladders at the open corners.
 */
function createPennants(scene: Scene, root: TransformNode, materials: MaterialLibrary): void {
  const deckY = CENTRAL_TOWER.topSurfaceY;
  const capTopY = deckY + 0.51 + 1.02 / 2 + 0.14;
  const mounts: ReadonlyArray<readonly [number, number]> = [
    [-1.6, -2.47], [1.6, -2.47], [-1.6, 2.47], [1.6, 2.47],
  ];
  const pole = MeshBuilder.CreateCylinder('tower-pennant-pole-source', {
    height: 1.5,
    diameter: 0.07,
    tessellation: 6,
  }, scene);
  configureStatic(pole, root, materials.gold);
  pole.position.set(mounts[0][0], capTopY + 0.75, mounts[0][1]);
  const ball = MeshBuilder.CreateSphere('tower-pennant-finial-source', {
    diameter: 0.14,
    segments: 5,
  }, scene);
  configureStatic(ball, root, materials.gold);
  ball.position.set(mounts[0][0], capTopY + 1.5, mounts[0][1]);
  const cloth = MeshBuilder.CreateBox('tower-pennant-cloth-source', {
    width: 0.55,
    height: 0.72,
    depth: 0.05,
  }, scene);
  configureStatic(cloth, root, materials.objectiveCloth);
  cloth.position.set(mounts[0][0], capTopY + 0.41, mounts[0][1] + 0.3);
  cloth.rotation.x = 0.04;
  for (let index = 1; index < mounts.length; index += 1) {
    const [x, z] = mounts[index];
    const front = z < 0;
    const poleInstance = pole.createInstance(`tower-pennant-pole-${index}`);
    poleInstance.parent = root;
    poleInstance.position.set(x, capTopY + 0.75, z);
    poleInstance.isPickable = false;
    const ballInstance = ball.createInstance(`tower-pennant-finial-${index}`);
    ballInstance.parent = root;
    ballInstance.position.set(x, capTopY + 1.5, z);
    ballInstance.isPickable = false;
    const clothInstance = cloth.createInstance(`tower-pennant-cloth-${index}`);
    clothInstance.parent = root;
    clothInstance.position.set(x, capTopY + 0.41, z + (front ? 0.3 : -0.3));
    clothInstance.rotation.x = front ? 0.04 : -0.04;
    clothInstance.isPickable = false;
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
