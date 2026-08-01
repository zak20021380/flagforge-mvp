import { Color3, Scene } from '@babylonjs/core';
import { QUALITY_SETTINGS } from '../core/config';
import type { QualityTier } from '../core/types';
import { MaterialLibrary } from './materials';
import { createProps, startEnvironmentLife } from './props';
import { createTerrain } from './terrain';

/**
 * Builds the complete static environment in the order the look depends on: fog first (so every
 * material compiles with it), then terrain and paving, then props, then the single per-frame life
 * hook. Environment-only materials are frozen at the end because gameplay never touches them.
 */
export function createEnvironment(scene: Scene, materials: MaterialLibrary, quality: QualityTier): void {
  configureDepthFog(scene);
  const density = QUALITY_SETTINGS[quality].decorations;
  createTerrain(scene, materials, density);
  const banners = createProps(scene, materials, density);
  startEnvironmentLife(scene, materials, banners);
  materials.freezeEnvironmentMaterials();
}

/**
 * Linear distance fog that only bites past the enemy castle: the whole playfield and both castles
 * sit inside fogStart, so gameplay reads exactly as before while the outer forest and hills fade
 * into the background instead of ending in a hard silhouette.
 */
function configureDepthFog(scene: Scene): void {
  scene.fogMode = Scene.FOGMODE_LINEAR;
  // Pale haze matched to the daylight sky so the treeline dissolves into it.
  scene.fogColor = new Color3(0.66, 0.79, 0.86);
  scene.fogStart = 74;
  scene.fogEnd = 150;
}
