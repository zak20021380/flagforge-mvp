import { Scene } from '@babylonjs/core';
import { QUALITY_SETTINGS } from '../core/config';
import type { QualityTier } from '../core/types';
import { MaterialLibrary } from './materials';
import { createProps, startEnvironmentLife } from './props';
import { createTerrain } from './terrain';

/**
 * Builds the complete static environment: terrain and paving first, then props, then the single
 * per-frame life hook. Environment-only materials are frozen at the end because gameplay never
 * touches them.
 */
export function createEnvironment(scene: Scene, materials: MaterialLibrary, quality: QualityTier): void {
  // Keep arena colours intact at every camera distance. The surrounding terrain already provides
  // a natural horizon, so distance whitening only flattens the portrait battlefield.
  scene.fogMode = Scene.FOGMODE_NONE;
  const density = QUALITY_SETTINGS[quality].decorations;
  createTerrain(scene, materials);
  createProps(scene, materials, density);
  startEnvironmentLife(scene, materials);
  materials.freezeEnvironmentMaterials();
}
