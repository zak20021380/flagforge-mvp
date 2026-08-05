import type { Vector3 } from '@babylonjs/core/Maths/math.vector';

export type Team = 'blue' | 'red';
/**
 * MVP roster, in deploy-card order: BRAX (armoured frontliner), NYX (precision marksman),
 * VEX (fast objective raider), FUSE (explosive siege bomber). The literal is the registry key —
 * it also generates the card DOM hooks (`data-card`, `portrait-*`), so renames must stay in sync
 * with src/styles.css.
 */
export type UnitKind = 'brax' | 'nyx' | 'vex' | 'fuse';
export type UnitState = 'idle' | 'moving' | 'queued' | 'climbing' | 'falling' | 'attacking' | 'hit' | 'dead';
/**
 * Authoritative match flow. The match starts in FLAG_OBJECTIVE, advances once to CASTLE_ASSAULT
 * when the flag is delivered, and finishes when a castle is breached/destroyed. This single value
 * is the source of truth every subsystem (flag, tower, targeting, castle) reads from.
 */
export type MatchPhase = 'FLAG_OBJECTIVE' | 'CASTLE_ASSAULT' | 'MATCH_FINISHED';
/**
 * Central-tower ladder mount sequence (src/game/ladderSystem.ts): a queued ascender walks to the
 * ladder front (approaching), swings onto the centreline and turns to face the rungs (aligning),
 * plants one hand and one foot on the first rung (mounting), then holds at the base, posed and
 * ready for the rung-by-rung climb (readyToClimb). Null when the unit is not in the sequence.
 */
export type LadderMountState = 'approaching' | 'aligning' | 'mounting' | 'readyToClimb';
/** Bridge traffic state, shared by every team and unit type (see src/game/bridgeTraffic.ts). */
export type BridgeState = 'none' | 'approaching' | 'queued' | 'entering' | 'crossing' | 'exiting' | 'cleared';
export type NavigationArea =
  | 'ground'
  | 'towerTop'
  | 'playerLadder'
  | 'enemyLadder'
  | 'enemyWallTop'
  | 'enemyCastleLadderLeft'
  | 'enemyCastleLadderRight'
  | 'enemyCastleAccess';
export type Lane = 'left' | 'center' | 'right';
/** One-shot stuck-recovery manoeuvre a unit may run before normal movement resumes. */
export type RecoveryState = 'none' | 'lateral' | 'yield' | 'wait';
export type QualityTier = 'low' | 'standard' | 'high';
/** Display-only castle gate/breach state for the castle health HUD. */
export type CastleState = 'secure' | 'open' | 'breached';
/**
 * Which pool the single shared siege bar is currently reading. Stage 1 ('gate') runs until the gate
 * is breached; the same bar then transforms into stage 2 ('castle'). There is never a second bar.
 */
export type SiegeStage = 'gate' | 'castle';

export interface UnitStats {
  readonly cost: number;
  readonly maxHealth: number;
  readonly damage: number;
  readonly speed: number;
  readonly attackRange: number;
  readonly aggroRange: number;
  readonly attackCooldown: number;
  readonly windup: number;
  readonly projectileSpeed?: number;
  readonly scale: number;
}

export interface ActiveTarget {
  readonly unitId: number;
  readonly position: Vector3;
}

/** One painted bridge deck across a water channel, in world XZ. */
export interface ArenaRiverBridge {
  /** Painted deck edges. */
  readonly minX: number;
  readonly maxX: number;
  /** Deck edges pulled in past the painted railing; a unit body must fit inside this span. */
  readonly walkMinX: number;
  readonly walkMaxX: number;
  readonly centerX: number;
}

/** One painted water channel: an impassable Z band, crossable only on one of its bridges. */
export interface ArenaRiverChannel {
  readonly id: string;
  readonly minZ: number;
  readonly maxZ: number;
  readonly centerZ: number;
  readonly bridges: readonly ArenaRiverBridge[];
}
