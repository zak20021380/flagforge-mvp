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
  UniversalCamera,
  Vector3,
} from '@babylonjs/core';
import { PORTRAIT_LAYOUT, QUALITY_SETTINGS } from '../core/config';
import { clamp } from '../core/math';
import type { QualityTier } from '../core/types';
import { CastleVisual } from './castle';
import { createCentralTower, type CentralTowerVisual } from './centralTower';
import { createEnvironment } from './environment';
import { MaterialLibrary } from './materials';

export interface ArenaScene {
  readonly scene: Scene;
  readonly camera: UniversalCamera;
  readonly materials: MaterialLibrary;
  readonly blueCastle: CastleVisual;
  readonly redCastle: CastleVisual;
  readonly shadowGenerator: ShadowGenerator;
  readonly deployMarker: Mesh;
  readonly centralTower: CentralTowerVisual;
  readonly cameraRestingPosition: Vector3;
  readonly cameraForward: Vector3;
  resizeCamera(): void;
}

export function createArenaScene(engine: Engine, canvas: HTMLCanvasElement, quality: QualityTier): ArenaScene {
  const scene = new Scene(engine);
  // A deeper sky and restrained ambient floor keep silhouettes crisp without crushing shadows.
  scene.clearColor = new Color4(0.12, 0.24, 0.29, 1);
  scene.ambientColor = new Color3(0.07, 0.09, 0.08);
  scene.skipPointerMovePicking = true;

  const cameraRestingPosition = Vector3.Zero();
  const cameraForward = new Vector3(0, 0, 1);
  const camera = new UniversalCamera('fixed-portrait-strategy-camera', cameraRestingPosition.clone(), scene);
  camera.minZ = 0.25;
  camera.maxZ = 180;
  camera.inputs.clear();

  const hemispheric = new HemisphericLight('ambient-light', new Vector3(0, 1, -0.15), scene);
  hemispheric.intensity = 0.48;
  hemispheric.groundColor = new Color3(0.08, 0.11, 0.07);

  const sun = new DirectionalLight('sun-light', new Vector3(-0.42, -1, 0.38), scene);
  sun.position = new Vector3(26, 38, -32);
  sun.intensity = 1.05;

  const shadowGenerator = new ShadowGenerator(QUALITY_SETTINGS[quality].shadowMapSize, sun);
  shadowGenerator.usePercentageCloserFiltering = true;
  shadowGenerator.filteringQuality = quality === 'high' ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
  shadowGenerator.bias = 0.0025;
  shadowGenerator.normalBias = 0.03;

  const materials = new MaterialLibrary(scene);
  createEnvironment(scene, materials, quality);
  const centralTower = createCentralTower(scene, materials);

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
    centralTower,
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

  const wideFactor = (renderAspect - cameraConfig.narrowAspect) / (cameraConfig.wideAspect - cameraConfig.narrowAspect);
  const mix = (narrow: number, wide: number): number => narrow + (wide - narrow) * wideFactor;
  const fov = clamp(mix(cameraConfig.narrowFov, cameraConfig.wideFov), cameraConfig.minFov, cameraConfig.maxFov);
  const pitch = clamp(
    mix(cameraConfig.narrowPitchDegrees, cameraConfig.widePitchDegrees),
    cameraConfig.minPitchDegrees,
    cameraConfig.maxPitchDegrees,
  ) * (Math.PI / 180);
  const targetZ = clamp(
    mix(cameraConfig.narrowTargetZ, cameraConfig.wideTargetZ),
    cameraConfig.minTargetZ,
    cameraConfig.maxTargetZ,
  );

  // Find the nearest distance that contains the actual gameplay silhouette. Unlike a
  // fixed dolly anchor, this accounts for perspective: the player-side edge is wider
  // on screen than the enemy-side edge, while raised structures constrain height.
  const sinPitch = Math.sin(pitch);
  const cosPitch = Math.cos(pitch);
  const tanHalfFov = Math.tan(fov / 2);
  let distance: number = cameraConfig.minDistance;
  const fitPoint = (x: number, y: number, z: number): void => {
    const depthOffset = (cameraConfig.targetY - y) * sinPitch + (z - targetZ) * cosPitch;
    const verticalOffset = (y - cameraConfig.targetY) * cosPitch + (z - targetZ) * sinPitch;
    const horizontalDistance = Math.abs(x)
      / (cameraConfig.horizontalScreenCoverage * tanHalfFov * renderAspect) - depthOffset;
    const upperDistance = verticalOffset
      / (cameraConfig.topScreenLimit * tanHalfFov) - depthOffset;
    const lowerDistance = -verticalOffset
      / (cameraConfig.bottomScreenLimit * tanHalfFov) - depthOffset;
    distance = Math.max(distance, horizontalDistance, upperDistance, lowerDistance);
  };

  const foundationHalfWidth = arenaLayout.foundationWidth / 2;
  const foundationHalfLength = arenaLayout.foundationLength / 2;
  for (const x of [-foundationHalfWidth, foundationHalfWidth]) {
    for (const z of [-foundationHalfLength, foundationHalfLength]) fitPoint(x, 0, z);
  }
  for (const x of [-cameraConfig.castleFrameHalfWidth, cameraConfig.castleFrameHalfWidth]) {
    for (const z of [-cameraConfig.castleFrameOuterZ, cameraConfig.castleFrameOuterZ]) {
      fitPoint(x, 0, z);
      fitPoint(x, cameraConfig.castleFrameTopY, z);
    }
  }
  for (const x of [-cameraConfig.raisedGateFrameHalfWidth, cameraConfig.raisedGateFrameHalfWidth]) {
    fitPoint(x, cameraConfig.raisedGateFrameTopY, -cameraConfig.raisedGateFrameZ);
    fitPoint(x, cameraConfig.raisedGateFrameTopY, cameraConfig.raisedGateFrameZ);
  }
  fitPoint(-cameraConfig.flagFrameHalfWidth, cameraConfig.flagFrameTopY, 0);
  fitPoint(cameraConfig.flagFrameHalfWidth, cameraConfig.flagFrameTopY, 0);

  restingPosition.set(
    cameraConfig.targetX,
    cameraConfig.targetY + distance * sinPitch,
    targetZ - distance * cosPitch,
  );
  camera.position.copyFrom(restingPosition);
  camera.fov = fov;
  const target = new Vector3(cameraConfig.targetX, cameraConfig.targetY, targetZ);
  camera.setTarget(target);
  forward?.copyFrom(target.subtract(restingPosition).normalize());
}
