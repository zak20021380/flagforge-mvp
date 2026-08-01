import type { QualityTier, UnitKind, UnitStats } from './types';

export const PORTRAIT_LAYOUT = {
  viewport: {
    desktopMaxWidth: 520,
    desktopMaxAspect: 0.625,
    resizeDebounceMs: 90,
  },
  arena: {
    halfWidth: 13.4,
    halfLength: 31.5,
    groundWidth: 27.6,
    groundLength: 64,
    foundationWidth: 29,
    foundationLength: 65.2,
    laneOffset: 6.25,
    laneBoundary: 2.7,
    sideRoadWidth: 3.25,
    centerRoadWidth: 3.8,
    roadLength: 52.5,
    riverZ: 8.6,
    riverWidth: 25.8,
    deploymentCenterZ: 17,
    deploymentDepth: 7.4,
    deploymentWidth: 22.4,
    sideWallX: 12.85,
    sideWallLength: 60,
    castleZ: 26.35,
    castleWidthScale: 0.74,
    gateOffset: 4.8,
    deliveryOffset: 5.7,
    interiorOffset: 1.3,
    unitBoundsX: 12.15,
    unitBoundsZ: 29.8,
    aiSpawnMinZ: 14.5,
    aiSpawnMaxZ: 19.7,
    route: {
      flagApproachZ: 3.7,
      flagApproachThresholdZ: 4.2,
      returnMergeZ: 13.4,
      returnMergeThresholdZ: 12.9,
      returnLaneScale: 0.58,
      attackMergeZ: 12.9,
      attackMergeThresholdZ: 12.4,
      attackLaneScale: 0.54,
      infiltrationDepth: 0.45,
    },
  },
  camera: {
    // Aim point: chest height in the central combat band, biased a little behind the
    // flag platform so the objective sits just above the optical centre.
    targetX: 0,
    targetY: 1.4,
    // Framing is interpolated between two tuned anchors on the real render aspect.
    // narrow = phone portrait (360x800 / 393x873 / 412x915 all land on ~0.450),
    // wide = the widest the CSS shell can ever be (min(vw, 520, vh * 0.625)).
    narrowAspect: 0.45,
    wideAspect: 0.625,
    narrowFov: 0.9,
    wideFov: 0.86,
    narrowPitchDegrees: 49,
    widePitchDegrees: 50,
    narrowDistance: 62.6,
    wideDistance: 59,
    narrowTargetZ: -3.95,
    wideTargetZ: -7,
    // Same-aspect phones still differ in CSS height, so the HUD eats a different share
    // of the frame. Trim the aim (and marginally the distance) against a reference
    // height; the correction fades out toward the desktop shell aspect, where the
    // enemy gate arch rather than the HUD share is the binding constraint.
    referenceHeight: 873,
    heightTrimMin: 0.86,
    heightTrimMax: 1.16,
    targetZHeightTrim: -10.4,
    distanceHeightTrim: -6.5,
    maxTargetZTrim: 1.3,
    maxDistanceTrim: 0.9,
    // Safety net for aspects narrower than the tuned anchor (21:9 and taller): keep the
    // player deployment row inside the frame, but never dolly back more than this.
    deployCoverageMargin: 0.15,
    maxCoverageTrim: 3.2,
    // Portrait-safe clamps.
    minFov: 0.78,
    maxFov: 0.92,
    minPitchDegrees: 46,
    maxPitchDegrees: 53,
    minDistance: 52,
    maxDistance: 68,
    minTargetZ: -9,
    maxTargetZ: -2.4,
    minHeight: 38,
    maxHeight: 56,
    minBackDistance: 34,
    maxBackDistance: 58,
    // Brief, subtle dolly-in used for flag capture / gate opening / breach (world units).
    emphasisPush: 1.5,
  },
} as const;

export const CONFIG = {
  arena: {
    halfWidth: PORTRAIT_LAYOUT.arena.halfWidth,
    halfLength: PORTRAIT_LAYOUT.arena.halfLength,
    blueDeployMinZ: -PORTRAIT_LAYOUT.arena.deploymentCenterZ - PORTRAIT_LAYOUT.arena.deploymentDepth / 2,
    blueDeployMaxZ: -PORTRAIT_LAYOUT.arena.deploymentCenterZ + PORTRAIT_LAYOUT.arena.deploymentDepth / 2,
    redDeployMinZ: PORTRAIT_LAYOUT.arena.deploymentCenterZ - PORTRAIT_LAYOUT.arena.deploymentDepth / 2,
    redDeployMaxZ: PORTRAIT_LAYOUT.arena.deploymentCenterZ + PORTRAIT_LAYOUT.arena.deploymentDepth / 2,
    flagPickupRadius: 1.05,
    flagDeliveryZ: PORTRAIT_LAYOUT.arena.castleZ - PORTRAIT_LAYOUT.arena.deliveryOffset,
    castleInteriorZ: PORTRAIT_LAYOUT.arena.castleZ + PORTRAIT_LAYOUT.arena.interiorOffset,
  },
  match: {
    durationSeconds: 180,
    gateOpenSeconds: 13,
    breachCountdownSeconds: 5,
    maxActiveUnits: 24,
  },
  energy: {
    maximum: 10,
    initial: 5,
    regenPerSecond: 0.72,
    overtimeMultiplier: 1.45,
  },
  ai: {
    thinkMin: 0.62,
    thinkMax: 1.05,
    deploymentPadding: 1.2,
  },
  unit: {
    separationRadius: 1.05,
    separationStrength: 1.6,
    targetRefreshMin: 0.18,
    targetRefreshMax: 0.34,
  },
} as const;

export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  vanguard: {
    cost: 3,
    maxHealth: 170,
    damage: 32,
    speed: 3.25,
    attackRange: 1.35,
    aggroRange: 7.5,
    attackCooldown: 1.05,
    windup: 0.42,
    scale: 1,
  },
  ranger: {
    cost: 3,
    maxHealth: 92,
    damage: 26,
    speed: 3.05,
    attackRange: 8.4,
    aggroRange: 10.5,
    attackCooldown: 1.3,
    windup: 0.55,
    projectileSpeed: 17,
    scale: 0.94,
  },
  raider: {
    cost: 2,
    maxHealth: 88,
    damage: 20,
    speed: 4.65,
    attackRange: 1.15,
    aggroRange: 5.4,
    attackCooldown: 0.82,
    windup: 0.28,
    scale: 0.9,
  },
  ironGuard: {
    cost: 5,
    maxHealth: 310,
    damage: 41,
    speed: 2.35,
    attackRange: 1.5,
    aggroRange: 8.3,
    attackCooldown: 1.55,
    windup: 0.62,
    scale: 1.16,
  },
};

export const QUALITY_SETTINGS: Record<QualityTier, {
  hardwareScaling: number;
  shadowMapSize: number;
  decorations: number;
  antialias: boolean;
}> = {
  low: { hardwareScaling: 1.35, shadowMapSize: 512, decorations: 0.55, antialias: false },
  standard: { hardwareScaling: 1, shadowMapSize: 768, decorations: 0.78, antialias: true },
  high: { hardwareScaling: 1, shadowMapSize: 1024, decorations: 1, antialias: true },
};

export const UNIT_LABELS: Record<UnitKind, string> = {
  vanguard: 'Vanguard',
  ranger: 'Ranger',
  raider: 'Raider',
  ironGuard: 'Iron Guard',
};
