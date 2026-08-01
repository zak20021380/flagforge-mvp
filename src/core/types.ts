import type { Vector3 } from '@babylonjs/core/Maths/math.vector';

export type Team = 'blue' | 'red';
export type UnitKind = 'vanguard' | 'ranger' | 'raider' | 'ironGuard';
export type UnitState = 'idle' | 'moving' | 'queued' | 'climbing' | 'attacking' | 'hit' | 'dead';
export type NavigationArea = 'ground' | 'towerTop' | 'playerLadder' | 'enemyLadder';
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
