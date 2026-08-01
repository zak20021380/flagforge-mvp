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
  // Bright daylight sky and a warm ambient fill: with the clutter gone the map is read almost
  // entirely off flat colour, so the lighting has to keep the grass fresh and the shadows soft.
  scene.clearColor = new Color4(0.47, 0.7, 0.85, 1);
  scene.ambientColor = new Color3(0.26, 0.29, 0.3);
  scene.skipPointerMovePicking = true;

  const cameraRestingPosition = Vector3.Zero();
  const cameraForward = new Vector3(0, 0, 1);
  const camera = new UniversalCamera('fixed-portrait-strategy-camera', cameraRestingPosition.clone(), scene);
  camera.minZ = 0.25;
  camera.maxZ = 180;
  camera.inputs.clear();

  const hemispheric = new HemisphericLight('ambient-light', new Vector3(0, 1, -0.15), scene);
  hemispheric.intensity = 0.9;
  hemispheric.groundColor = new Color3(0.34, 0.4, 0.34);

  const sun = new DirectionalLight('sun-light', new Vector3(-0.42, -1, 0.38), scene);
  sun.position = new Vector3(26, 38, -32);
  sun.intensity = 1.65;

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

  // Ultra-tall aspects see less width at the same distance. Allow only a slight step
  // back; the outer deployment edges are intentionally cropped to preserve unit scale.
  const deployRowZ = -arenaLayout.deploymentCenterZ - arenaLayout.deploymentDepth / 2;
  const requiredHalfWidth = arenaLayout.deploymentWidth / 2 + cameraConfig.deployCoverageMargin;
  const axisOffset = cameraConfig.targetY * Math.sin(pitch) + Math.cos(pitch) * (deployRowZ - targetZ);
  const coverageDistance = requiredHalfWidth / (Math.tan(fov / 2) * renderAspect) - axisOffset;
  if (renderAspect < cameraConfig.narrowAspect && coverageDistance > distance) {
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
