/**
 * Shared lightweight arrow proportions for the 6.1-unit Ranger. The assembled arrow is about 2.7
 * units long, matching the imported character's proportions without rendering the unsafe GLB mesh.
 */
export const RANGER_ARROW_VISUAL = {
  shaftLength: 2.15,
  shaftDiameter: 0.19,
  tipLength: 0.48,
  tipDiameter: 0.5,
  tipOffset: 1.315,
  fletchingLength: 0.42,
  fletchingWidth: 0.48,
  fletchingThickness: 0.1,
  fletchingOffset: -0.9,
} as const;
