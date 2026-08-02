import type { Vector3 } from '@babylonjs/core/Maths/math.vector';

export type Team = 'blue' | 'red';
export type UnitKind = 'vanguard' | 'ranger' | 'raider' | 'ironGuard';
export type UnitState = 'idle' | 'moving' | 'queued' | 'climbing' | 'falling' | 'attacking' | 'hit' | 'dead';
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
export type QualityTier = 'low' | 'standard' | 'high';

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
