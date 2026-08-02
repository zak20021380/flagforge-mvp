import type { QualityTier, UnitKind, UnitStats } from './types';

// Authored forest-arena alignment. These are intentionally centralized because the render roots
// and their linked gameplay coordinates must move together when the artwork is tuned.
export const ARENA_TEXTURE_ROTATION = 0;
export const ARENA_TEXTURE_U_SCALE = 1;
export const ARENA_TEXTURE_V_SCALE = 1;
export const ARENA_TEXTURE_U_OFFSET = 0;
export const ARENA_TEXTURE_V_OFFSET = 0;

/**
 * Measured against flagforge-arena-forest.png (1248 x 1936) on the unchanged
 * 95.617149 x 148.329763 artwork surface centered at world (0, 20.7720465).
 * Pixel Y is top-origin; the existing ground UVs plus invertY map the PNG top to +Z.
 *
 * Landmark                 pixel (x, y)   UV (u, v)                    world (x, z)
 * Red boundary             (624, 375)     (0.5, 0.193698347107438)     (0, 66.205698080)
 * Blue boundary            (624, 1510)    (0.5, 0.779958677685950)     (0, -20.754157811)
 * Central octagon center   (622.25, 912)  (0.498597756410256, 0.471074380165289)
 *                                                                        (-0.134078534, 25.062576835)
 *
 * The complete castle bounds put the front tower-cap face 4.2 world units from
 * the root: -Z for red and +Z for blue. Roots therefore sit behind the painted
 * boundary while the real front face lands on it.
 */
export const RED_CASTLE_FRONT_FACE_OFFSET_Z = -4.2;
export const BLUE_CASTLE_FRONT_FACE_OFFSET_Z = 4.2;

export const RED_CASTLE_ROOT_X = 0;
export const RED_CASTLE_ROOT_Z = 70.405698080;
export const BLUE_CASTLE_ROOT_X = 0;
export const BLUE_CASTLE_ROOT_Z = -24.954157811;
export const CENTRAL_TOWER_ROOT_X = -0.134078534;
export const CENTRAL_TOWER_ROOT_Z = 25.062576835;

const ARENA_FOUNDATION_LENGTH = 76.6;
// The tower caps are the castle geometry nearest the battlefield. Positioning the roots by this
// exact extent leaves only that front edge on the foundation boundary and every other part behind it.
const CASTLE_FRONT_EDGE_FROM_ROOT = 4.2;
const CASTLE_CENTER_Z = ARENA_FOUNDATION_LENGTH / 2 + CASTLE_FRONT_EDGE_FROM_ROOT;

// Authoritative portrait framing bias, applied to the aim point inside the aspect-aware fit solve
// (src/render/arena.ts). Because the solve then re-derives distance, pitch and the resting pose
// from the corrected center, every downstream system (first frame, reset, resize, shake, emphasis
// dolly) inherits the same framing. These replace the previous post-solve position/target pan,
// which translated the already-solved camera and left the red castle clipped at the top.
export const CAMERA_FRAMING_CENTER_Z_OFFSET = 10.0;
export const CAMERA_FRAMING_HEIGHT_OFFSET = 1.0;

export const PORTRAIT_LAYOUT = {
  viewport: {
    desktopMaxWidth: 520,
    desktopMaxAspect: 0.625,
    resizeDebounceMs: 90,
  },
  arena: {
    // Gameplay coordinates retain their authored spacing. The visual stage envelope grows farther
    // in both axes (especially Z), filling the portrait frame without changing traversal or combat.
    halfWidth: 13.4,
    halfLength: 31.5,
    groundWidth: 35.6,
    groundLength: 75.2,
    foundationWidth: 37,
    foundationLength: ARENA_FOUNDATION_LENGTH,
    laneOffset: 6.25,
    laneBoundary: 2.7,
    sideRoadWidth: 3.55,
    centerRoadWidth: 4.15,
    roadLength: 61.2,
    riverZ: 9.75,
    riverWidth: 33.8,
    riverDepth: 2.8,
    bridgeDepth: 4.55,
    bridgeShoulder: 0.75,
    deploymentCenterZ: 17,
    deploymentDepth: 7.4,
    deploymentWidth: 22.4,
    castleZ: CASTLE_CENTER_Z,
    castleWidthScale: 0.74,
    gateOffset: 4.8,
    deliveryOffset: 5.7,
    interiorOffset: 1.3,
    unitBoundsX: 12.15,
    unitBoundsZ: CASTLE_CENTER_Z + 3.45,
    aiSpawnMinZ: 14.5,
    aiSpawnMaxZ: 19.7,
    route: {
      flagApproachZ: 5,
      flagApproachThresholdZ: 5.15,
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
    // Aim point stays on the arena centre line. The Z bias is aspect-dependent so the
    // two castle silhouettes share the available portrait height evenly.
    targetX: 0,
    targetY: 1.4,
    // Narrow phones need a more overhead angle to fit the long arena without shrinking
    // units unnecessarily. Wider portrait shells retain more of the angled 3D view.
    narrowAspect: 0.45,
    wideAspect: 0.625,
    narrowFov: 0.9,
    wideFov: 0.86,
    narrowPitchDegrees: 57.5,
    widePitchDegrees: 45,
    narrowTargetZ: -7.05,
    wideTargetZ: -9.95,
    minFov: 0.84,
    maxFov: 0.94,
    minPitchDegrees: 43,
    maxPitchDegrees: 65,
    minTargetZ: -10.5,
    maxTargetZ: -5,
    // The enlarged near edge may crop naturally behind the HUD instead of forcing the camera back.
    // These limits keep the existing aim, pitch and FOV while leaving only a narrow outer border.
    horizontalScreenCoverage: 1.21,
    topScreenLimit: 0.8,
    bottomScreenLimit: 0.84,
    minDistance: 60,
    // Conservative visual extrema used only for camera framing. They include both
    // castle silhouettes, a fully raised gate, and the flag at the tower top.
    castleFrameHalfWidth: 10.2,
    castleFrameOuterZ: 33.5,
    castleFrameTopY: 9,
    raisedGateFrameHalfWidth: 3,
    raisedGateFrameZ: 24.35,
    raisedGateFrameTopY: 10.8,
    flagFrameHalfWidth: 2.8,
    flagFrameTopY: 15,
    // A short move along the existing view ray raises the camera while preserving the aim point,
    // pitch and FOV. The wider stage absorbs this small distance increase in the final framing.
    elevationDistance: 2.2,
    // Brief, subtle dolly-in used for flag capture / gate opening / breach (world units).
    emphasisPush: 1.5,
  },
} as const;

const centralObjectivePoint = (x: number, y: number, z: number) => ({
  x: x + CENTRAL_TOWER_ROOT_X,
  y,
  z: z + CENTRAL_TOWER_ROOT_Z,
});

// All tower gameplay coordinates live here so the procedural art and deterministic
// traversal remain in sync without collision queries or runtime pathfinding.
export const CENTRAL_TOWER = {
  centerX: CENTRAL_TOWER_ROOT_X,
  centerZ: CENTRAL_TOWER_ROOT_Z,
  baseWidth: 7.3,
  baseDepth: 6.6,
  shaftHeight: 7.3,
  topPlatformWidth: 6.15,
  topPlatformDepth: 5.35,
  // 9.16 is 12.4% above the previous 8.15-unit deck: enough lift to read taller
  // without changing the portrait framing or letting the objective dominate it.
  topSurfaceY: 9.16,
  topUnitY: 9.32,
  topWalkHalfWidth: 2.25,
  topWalkHalfDepth: 1.82,
  flagRootOffsetY: 0.03,
  flagPickupHeightTolerance: 0.9,
  ladderBaseDropRadius: 1.65,
  climbSpeed: 3.45,
  queueMoveScale: 0.82,
  queueArrivalRadius: 0.18,
  maximumQueuePerLadder: 3,
  ladders: {
    // Navigation-area names stay stable for flag/drop rules; visually these are
    // the left and right side ladders respectively.
    player: {
      id: 'player',
      side: 'left',
      facingYaw: 1.18,
      groundEntry: centralObjectivePoint(-4.15, 0.16, -2.65),
      groundAlign: centralObjectivePoint(-3.4, 0.16, -1.4),
      climbTop: centralObjectivePoint(-2.65, 9.32, -1.1),
      topExit: centralObjectivePoint(-2.02, 9.32, -0.78),
      groundQueueOrigin: centralObjectivePoint(-4.15, 0.16, -3.25),
      groundQueueStep: { x: 0, y: 0, z: -0.95 },
      topQueuePositions: [
        centralObjectivePoint(-1.9, 9.32, -0.72),
        centralObjectivePoint(-0.85, 9.32, -1.35),
        centralObjectivePoint(-0.75, 9.32, 0.2),
      ],
    },
    enemy: {
      id: 'enemy',
      side: 'right',
      facingYaw: -1.96,
      groundEntry: centralObjectivePoint(4.15, 0.16, 2.65),
      groundAlign: centralObjectivePoint(3.4, 0.16, 1.4),
      climbTop: centralObjectivePoint(2.65, 9.32, 1.1),
      topExit: centralObjectivePoint(2.02, 9.32, 0.78),
      groundQueueOrigin: centralObjectivePoint(4.15, 0.16, 3.25),
      groundQueueStep: { x: 0, y: 0, z: 0.95 },
      topQueuePositions: [
        centralObjectivePoint(1.9, 9.32, 0.72),
        centralObjectivePoint(0.85, 9.32, 1.35),
        centralObjectivePoint(0.75, 9.32, -0.2),
      ],
    },
  },
  safeFlagDrops: {
    towerTop: centralObjectivePoint(0, 9.19, 0),
    playerBase: centralObjectivePoint(-4.15, 0.12, -2.65),
    enemyBase: centralObjectivePoint(4.15, 0.12, 2.65),
  },
} as const;

const ENEMY_CASTLE_X = RED_CASTLE_ROOT_X;
const ENEMY_CASTLE_Z = RED_CASTLE_ROOT_Z;
const enemyCastlePoint = (x: number, y: number, z: number) => ({
  x: x + ENEMY_CASTLE_X,
  y,
  z,
});

// The red castle is the portrait-facing enemy objective. Its assault routes retain their authored
// offsets from the castle root so its queues, access points and collision bounds move as one group.
export const ENEMY_CASTLE_ASSAULT = {
  wallTopY: 4.78,
  climbSpeed: 2.8,
  accessSpeed: 3.2,
  queueMoveScale: 0.86,
  queueArrivalRadius: 0.2,
  maximumQueuePerLadder: 3,
  attackableClimberMinY: 2.25,
  fallDuration: 0.68,
  wallBounds: {
    minX: ENEMY_CASTLE_X - 6.65,
    maxX: ENEMY_CASTLE_X + 6.65,
    minZ: ENEMY_CASTLE_Z - 2.3,
    maxZ: ENEMY_CASTLE_Z - 0.85,
  },
  rangerSupport: {
    left: enemyCastlePoint(-5.25, 0.16, ENEMY_CASTLE_Z - 5.15),
    right: enemyCastlePoint(5.25, 0.16, ENEMY_CASTLE_Z - 5.15),
  },
  ladders: {
    left: {
      id: 'left',
      groundEntry: enemyCastlePoint(-5.3, 0.16, ENEMY_CASTLE_Z - 3.9),
      groundAlign: enemyCastlePoint(-5.3, 0.16, ENEMY_CASTLE_Z - 2.93),
      climbTop: enemyCastlePoint(-5.3, 4.78, ENEMY_CASTLE_Z - 2.39),
      topExit: enemyCastlePoint(-5.3, 4.78, ENEMY_CASTLE_Z - 1.65),
      groundQueueOrigin: enemyCastlePoint(-5.3, 0.16, ENEMY_CASTLE_Z - 4.45),
      groundQueueStep: { x: -0.08, y: 0, z: -1.08 },
      defenderGroundEntry: enemyCastlePoint(-5.3, 0.16, ENEMY_CASTLE_Z + 0.8),
      defenderTopEntry: enemyCastlePoint(-5.3, 4.78, ENEMY_CASTLE_Z - 1.01),
      defenderGuard: enemyCastlePoint(-5.3, 4.78, ENEMY_CASTLE_Z - 1.53),
      breachGroundExit: enemyCastlePoint(-5.3, 0.16, ENEMY_CASTLE_Z + 0.4),
    },
    right: {
      id: 'right',
      groundEntry: enemyCastlePoint(5.3, 0.16, ENEMY_CASTLE_Z - 3.9),
      groundAlign: enemyCastlePoint(5.3, 0.16, ENEMY_CASTLE_Z - 2.93),
      climbTop: enemyCastlePoint(5.3, 4.78, ENEMY_CASTLE_Z - 2.39),
      topExit: enemyCastlePoint(5.3, 4.78, ENEMY_CASTLE_Z - 1.65),
      groundQueueOrigin: enemyCastlePoint(5.3, 0.16, ENEMY_CASTLE_Z - 4.45),
      groundQueueStep: { x: 0.08, y: 0, z: -1.08 },
      defenderGroundEntry: enemyCastlePoint(5.3, 0.16, ENEMY_CASTLE_Z + 0.8),
      defenderTopEntry: enemyCastlePoint(5.3, 4.78, ENEMY_CASTLE_Z - 1.01),
      defenderGuard: enemyCastlePoint(5.3, 4.78, ENEMY_CASTLE_Z - 1.53),
      breachGroundExit: enemyCastlePoint(5.3, 0.16, ENEMY_CASTLE_Z + 0.4),
    },
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
    flagDeliveryZ: ENEMY_CASTLE_Z - PORTRAIT_LAYOUT.arena.deliveryOffset,
    castleInteriorZ: ENEMY_CASTLE_Z + PORTRAIT_LAYOUT.arena.interiorOffset,
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
