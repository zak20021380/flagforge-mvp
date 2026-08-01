import {
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  TransformNode,
  UniversalCamera,
  Vector3,
} from '@babylonjs/core';
import { PORTRAIT_LAYOUT, QUALITY_SETTINGS } from '../core/config';
import { clamp } from '../core/math';
import type { QualityTier } from '../core/types';
import { CastleVisual } from './castle';
import { MaterialLibrary } from './materials';

export interface ArenaScene {
  readonly scene: Scene;
  readonly camera: UniversalCamera;
  readonly materials: MaterialLibrary;
  readonly blueCastle: CastleVisual;
  readonly redCastle: CastleVisual;
  readonly shadowGenerator: ShadowGenerator;
  readonly deployMarker: Mesh;
  readonly flagPlatform: TransformNode;
  readonly cameraRestingPosition: Vector3;
  readonly cameraForward: Vector3;
  resizeCamera(): void;
}

export function createArenaScene(engine: Engine, canvas: HTMLCanvasElement, quality: QualityTier): ArenaScene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.035, 0.072, 0.12, 1);
  scene.ambientColor = new Color3(0.18, 0.2, 0.24);
  scene.skipPointerMovePicking = true;

  const cameraRestingPosition = Vector3.Zero();
  const cameraForward = new Vector3(0, 0, 1);
  const camera = new UniversalCamera('fixed-portrait-strategy-camera', cameraRestingPosition.clone(), scene);
  camera.minZ = 0.25;
  camera.maxZ = 180;
  camera.inputs.clear();

  const hemispheric = new HemisphericLight('ambient-light', new Vector3(0, 1, -0.15), scene);
  hemispheric.intensity = 0.82;
  hemispheric.groundColor = new Color3(0.15, 0.2, 0.25);

  const sun = new DirectionalLight('sun-light', new Vector3(-0.42, -1, 0.38), scene);
  sun.position = new Vector3(26, 38, -32);
  sun.intensity = 1.65;

  const shadowGenerator = new ShadowGenerator(QUALITY_SETTINGS[quality].shadowMapSize, sun);
  shadowGenerator.usePercentageCloserFiltering = true;
  shadowGenerator.filteringQuality = quality === 'high' ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
  shadowGenerator.bias = 0.0025;
  shadowGenerator.normalBias = 0.03;

  const materials = new MaterialLibrary(scene);
  createGroundAndPaths(scene, materials);
  const flagPlatform = createFlagPlatform(scene, materials);
  createArenaDecor(scene, materials, QUALITY_SETTINGS[quality].decorations);

  const blueCastle = new CastleVisual(scene, materials, 'blue');
  const redCastle = new CastleVisual(scene, materials, 'red');

  const deployMarker = MeshBuilder.CreateTorus('deploy-marker', { diameter: 2.1, thickness: 0.13, tessellation: 36 }, scene);
  deployMarker.rotation.x = Math.PI / 2;
  deployMarker.position.y = 0.2;
  deployMarker.material = materials.glowBlue;
  deployMarker.isPickable = false;
  deployMarker.setEnabled(false);

  const resizeCamera = (): void => framePortraitCamera(engine, camera, cameraRestingPosition, cameraForward);
  resizeCamera();

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    scene,
    camera,
    materials,
    blueCastle,
    redCastle,
    shadowGenerator,
    deployMarker,
    flagPlatform,
    cameraRestingPosition,
    cameraForward,
    resizeCamera,
  };
}

export function framePortraitCamera(
  engine: Engine,
  camera: UniversalCamera,
  restingPosition: Vector3,
  forward?: Vector3,
): void {
  const cameraConfig = PORTRAIT_LAYOUT.camera;
  const arenaLayout = PORTRAIT_LAYOUT.arena;
  const renderWidth = engine.getRenderWidth();
  const renderHeight = Math.max(1, engine.getRenderHeight());
  const renderAspect = renderWidth / renderHeight;
  // CSS pixel height without touching the DOM (the engine is built with adaptToDeviceRatio off,
  // so the only scaling between CSS and buffer pixels is the quality tier's hardware scaling).
  const cssHeight = Math.max(1, renderHeight * engine.getHardwareScalingLevel());

  const wideFactor = (renderAspect - cameraConfig.narrowAspect) / (cameraConfig.wideAspect - cameraConfig.narrowAspect);
  const mix = (narrow: number, wide: number): number => narrow + (wide - narrow) * wideFactor;
  const heightTrim = (clamp(
    cameraConfig.referenceHeight / cssHeight,
    cameraConfig.heightTrimMin,
    cameraConfig.heightTrimMax,
  ) - 1) * clamp(1 - wideFactor, 0, 1);

  const fov = clamp(mix(cameraConfig.narrowFov, cameraConfig.wideFov), cameraConfig.minFov, cameraConfig.maxFov);
  const pitch = clamp(
    mix(cameraConfig.narrowPitchDegrees, cameraConfig.widePitchDegrees),
    cameraConfig.minPitchDegrees,
    cameraConfig.maxPitchDegrees,
  ) * (Math.PI / 180);
  const targetZ = clamp(
    mix(cameraConfig.narrowTargetZ, cameraConfig.wideTargetZ)
      + clamp(heightTrim * cameraConfig.targetZHeightTrim, -cameraConfig.maxTargetZTrim, cameraConfig.maxTargetZTrim),
    cameraConfig.minTargetZ,
    cameraConfig.maxTargetZ,
  );
  let distance = clamp(
    mix(cameraConfig.narrowDistance, cameraConfig.wideDistance)
      + clamp(heightTrim * cameraConfig.distanceHeightTrim, -cameraConfig.maxDistanceTrim, cameraConfig.maxDistanceTrim),
    cameraConfig.minDistance,
    cameraConfig.maxDistance,
  );

  // Narrower-than-tuned aspects (21:9 and taller) see less width at the same distance:
  // ease back just enough to keep the tappable player deployment row framed, capped so a
  // tall screen can never be pushed far away simply to reveal more ground.
  const deployRowZ = -arenaLayout.deploymentCenterZ - arenaLayout.deploymentDepth / 2;
  const requiredHalfWidth = arenaLayout.deploymentWidth / 2 + cameraConfig.deployCoverageMargin;
  const axisOffset = cameraConfig.targetY * Math.sin(pitch) + Math.cos(pitch) * (deployRowZ - targetZ);
  const coverageDistance = requiredHalfWidth / (Math.tan(fov / 2) * renderAspect) - axisOffset;
  if (coverageDistance > distance) {
    distance = clamp(
      distance + Math.min(coverageDistance - distance, cameraConfig.maxCoverageTrim),
      cameraConfig.minDistance,
      cameraConfig.maxDistance,
    );
  }

  restingPosition.set(
    cameraConfig.targetX,
    clamp(cameraConfig.targetY + distance * Math.sin(pitch), cameraConfig.minHeight, cameraConfig.maxHeight),
    clamp(targetZ - distance * Math.cos(pitch), -cameraConfig.maxBackDistance, -cameraConfig.minBackDistance),
  );
  camera.position.copyFrom(restingPosition);
  camera.fov = fov;
  const target = new Vector3(cameraConfig.targetX, cameraConfig.targetY, targetZ);
  camera.setTarget(target);
  forward?.copyFrom(target.subtract(restingPosition).normalize());
}

function createGroundAndPaths(scene: Scene, materials: MaterialLibrary): void {
  const layout = PORTRAIT_LAYOUT.arena;
  const ground = MeshBuilder.CreateGround('arena-ground', { width: layout.groundWidth, height: layout.groundLength, subdivisions: 1 }, scene);
  ground.material = materials.grass;
  ground.receiveShadows = true;

  const border = MeshBuilder.CreateBox('arena-foundation', { width: layout.foundationWidth, height: 0.75, depth: layout.foundationLength }, scene);
  border.position.y = -0.43;
  border.material = materials.stoneDark;

  for (const x of [-layout.laneOffset, 0, layout.laneOffset]) {
    const road = MeshBuilder.CreateBox(`stone-road-${x}`, {
      width: x === 0 ? layout.centerRoadWidth : layout.sideRoadWidth,
      height: 0.12,
      depth: layout.roadLength,
    }, scene);
    road.position.set(x, 0.05, 0);
    road.material = materials.road;
    road.receiveShadows = true;
  }

  for (const z of [-layout.riverZ, layout.riverZ]) {
    const stream = MeshBuilder.CreateBox(`stream-${z}`, { width: layout.riverWidth, height: 0.09, depth: 2.5 }, scene);
    stream.position.set(0, 0.02, z);
    stream.material = materials.water;
    stream.receiveShadows = true;
    for (const x of [-layout.laneOffset, 0, layout.laneOffset]) {
      const bridge = MeshBuilder.CreateBox(`bridge-${x}-${z}`, { width: 4.1, height: 0.24, depth: 4.1 }, scene);
      bridge.position.set(x, 0.15, z);
      bridge.material = materials.road;
      bridge.receiveShadows = true;
    }
  }

  for (const teamZ of [-layout.deploymentCenterZ, layout.deploymentCenterZ]) {
    const zone = MeshBuilder.CreateBox(`deployment-zone-${teamZ}`, {
      width: layout.deploymentWidth,
      height: 0.035,
      depth: layout.deploymentDepth,
    }, scene);
    zone.position.set(0, 0.125, teamZ);
    zone.material = teamZ < 0 ? materials.glowBlue : materials.glowRed;
    zone.isPickable = true;
  }

  for (const x of [-layout.sideWallX, layout.sideWallX]) {
    const wall = MeshBuilder.CreateBox(`side-wall-${x}`, { width: 0.9, height: 1.25, depth: layout.sideWallLength }, scene);
    wall.position.set(x, 0.65, 0);
    wall.material = materials.stoneDark;
  }
}

function createFlagPlatform(scene: Scene, materials: MaterialLibrary): TransformNode {
  const root = new TransformNode('flag-platform-root', scene);
  const base = MeshBuilder.CreateCylinder('flag-platform-base', { height: 0.55, diameter: 7.1, tessellation: 12 }, scene);
  base.parent = root;
  base.position.y = 0.25;
  base.material = materials.stoneDark;
  base.receiveShadows = true;
  const top = MeshBuilder.CreateCylinder('flag-platform-top', { height: 0.28, diameter: 5.9, tessellation: 12 }, scene);
  top.parent = root;
  top.position.y = 0.65;
  top.material = materials.road;
  top.receiveShadows = true;
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const torch = MeshBuilder.CreateCylinder(`center-torch-${i}`, { height: 1.8, diameter: 0.16, tessellation: 8 }, scene);
    torch.parent = root;
    torch.position = new Vector3(Math.sin(angle) * 3.15, 1.2, Math.cos(angle) * 3.15);
    torch.material = materials.metal;
    const flame = MeshBuilder.CreateSphere(`center-flame-${i}`, { diameter: 0.35, segments: 6 }, scene);
    flame.parent = root;
    flame.position = new Vector3(Math.sin(angle) * 3.15, 2.15, Math.cos(angle) * 3.15);
    flame.material = materials.gold;
  }
  return root;
}

function createArenaDecor(scene: Scene, materials: MaterialLibrary, density: number): void {
  const treeCount = Math.round(24 * density);
  const trunkSource = MeshBuilder.CreateCylinder('tree-trunk-source', { height: 2.4, diameterTop: 0.34, diameterBottom: 0.56, tessellation: 7 }, scene);
  trunkSource.material = materials.trunk;
  trunkSource.position.set(-11.2, 1.2, -13.5);
  const crownSource = MeshBuilder.CreateCylinder('tree-crown-source', { height: 3.6, diameterTop: 0, diameterBottom: 2.6, tessellation: 8 }, scene);
  crownSource.material = materials.foliageDark;
  crownSource.position.set(-11.2, 3.8, -13.5);

  const positions: Vector3[] = [];
  for (let i = 0; i < treeCount; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (10.6 + (i % 3) * 0.48);
    const z = -12.5 + ((i * 7.9) % 51);
    if (Math.abs(z) < 5.5 && i % 3 === 0) continue;
    positions.push(new Vector3(x, 0, z));
  }
  positions.forEach((position, index) => {
    if (index === 0) return;
    const trunk = trunkSource.createInstance(`tree-trunk-${index}`);
    trunk.position.set(position.x, 1.2, position.z);
    const crown = crownSource.createInstance(`tree-crown-${index}`);
    crown.position.set(position.x, 3.8, position.z);
    const scale = 0.8 + (index % 4) * 0.08;
    crown.scaling.set(scale, 0.92 + (index % 3) * 0.08, scale);
  });

  const rockSource = MeshBuilder.CreatePolyhedron('rock-source', { type: 1, size: 1.1 }, scene);
  rockSource.material = materials.stoneDark;
  rockSource.position.set(-10.3, 0.6, -5.8);
  const rockCount = Math.round(16 * density);
  for (let i = 1; i < rockCount; i += 1) {
    const rock = rockSource.createInstance(`rock-${i}`);
    const side = i % 2 === 0 ? -1 : 1;
    rock.position.set(side * (9.65 + (i % 4) * 0.52), 0.42, -25 + ((i * 6.8) % 50));
    rock.rotation.y = i * 0.73;
    rock.scaling.set(0.7 + (i % 3) * 0.22, 0.55 + (i % 2) * 0.18, 0.85 + (i % 4) * 0.12);
  }

  const bushSource = MeshBuilder.CreateSphere('bush-source', { diameter: 1.35, segments: 6 }, scene);
  bushSource.material = materials.foliage;
  bushSource.position.set(-9.4, 0.55, -19.3);
  const bushCount = Math.round(22 * density);
  for (let i = 1; i < bushCount; i += 1) {
    const bush = bushSource.createInstance(`bush-${i}`);
    const side = i % 2 === 0 ? -1 : 1;
    bush.position.set(side * (8.9 + (i % 5) * 0.46), 0.48, -27 + ((i * 5.3) % 54));
    bush.scaling.set(0.75 + (i % 3) * 0.16, 0.55 + (i % 2) * 0.1, 0.85 + (i % 4) * 0.09);
  }
}
