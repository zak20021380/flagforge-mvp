import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PORTRAIT_LAYOUT } from './config';
import type { Lane, Team } from './types';

export const oppositeTeam = (team: Team): Team => team === 'blue' ? 'red' : 'blue';
export const teamDirection = (team: Team): number => team === 'blue' ? 1 : -1;
export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
export const randomRange = (min: number, max: number): number => min + Math.random() * (max - min);
export const squaredDistanceXZ = (a: Vector3, b: Vector3): number => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
};

export const laneFromX = (x: number): Lane => x < -PORTRAIT_LAYOUT.arena.laneBoundary
  ? 'left'
  : x > PORTRAIT_LAYOUT.arena.laneBoundary ? 'right' : 'center';
export const laneX = (lane: Lane): number => lane === 'left'
  ? -PORTRAIT_LAYOUT.arena.laneOffset
  : lane === 'right' ? PORTRAIT_LAYOUT.arena.laneOffset : 0;

export function moveTowardXZ(position: Vector3, target: Vector3, maxDistance: number): Vector3 {
  const dx = target.x - position.x;
  const dz = target.z - position.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.0001 || length <= maxDistance) {
    return new Vector3(target.x, position.y, target.z);
  }
  const ratio = maxDistance / length;
  return new Vector3(position.x + dx * ratio, position.y, position.z + dz * ratio);
}
