import { Vector3 } from '@babylonjs/core';
import { CENTRAL_TOWER } from '../core/config';
import type { Team } from '../core/types';
import type { UnitEntity } from './unit';

type LadderId = keyof typeof CENTRAL_TOWER.ladders;
type ClimbDirection = 'ascending' | 'descending';

interface QueueEntry {
  readonly unit: UnitEntity;
  readonly direction: ClimbDirection;
}

interface ActiveClimb extends QueueEntry {
  pathIndex: number;
}

interface LadderRuntime {
  readonly id: LadderId;
  readonly facingYaw: number;
  readonly ascentPath: readonly Vector3[];
  readonly descentPath: readonly Vector3[];
  readonly groundQueue: readonly Vector3[];
  readonly topQueue: readonly Vector3[];
  readonly queue: QueueEntry[];
  active: ActiveClimb | null;
}

const point = (value: { readonly x: number; readonly y: number; readonly z: number }): Vector3 => (
  new Vector3(value.x, value.y, value.z)
);

export class LadderSystem {
  private readonly ladders: Record<LadderId, LadderRuntime>;
  private readonly ladderList: readonly LadderRuntime[];

  constructor() {
    this.ladders = {
      player: this.createRuntime('player'),
      enemy: this.createRuntime('enemy'),
    };
    this.ladderList = [this.ladders.player, this.ladders.enemy];
  }

  beginFrame(): void {
    for (const ladder of this.ladderList) {
      for (let index = ladder.queue.length - 1; index >= 0; index -= 1) {
        const unit = ladder.queue[index].unit;
        if (!unit.active || unit.state === 'dead') ladder.queue.splice(index, 1);
      }
      if (ladder.active && (!ladder.active.unit.active || ladder.active.unit.state === 'dead')) {
        this.cancelActive(ladder, ladder.active.unit, true);
      }
    }
  }

  isRegistered(unit: UnitEntity): boolean {
    for (const ladder of this.ladderList) {
      if (ladder.active?.unit === unit) return true;
      for (const entry of ladder.queue) {
        if (entry.unit === unit) return true;
      }
    }
    return false;
  }

  requestIfNeeded(unit: UnitEntity, goal: Vector3): boolean {
    if (this.isRegistered(unit)) return true;
    const goalIsTop = goal.y >= CENTRAL_TOWER.topSurfaceY - 0.6;
    const unitIsTop = unit.navigationArea === 'towerTop';
    if (goalIsTop === unitIsTop) return false;
    if (unit.navigationArea !== 'ground' && unit.navigationArea !== 'towerTop') return true;

    const ladder = this.ladders[this.preferredLadder(unit.team)];
    // A full queue still owns the height transition for this frame. The unit
    // waits in place and retries next frame instead of walking through the tower.
    if (ladder.queue.length >= CENTRAL_TOWER.maximumQueuePerLadder) {
      unit.target = null;
      unit.attackClock = 0;
      unit.attackHitApplied = false;
      unit.state = 'queued';
      return true;
    }
    ladder.queue.push({
      unit,
      direction: unitIsTop ? 'descending' : 'ascending',
    });
    unit.target = null;
    unit.attackClock = 0;
    unit.attackHitApplied = false;
    unit.state = 'queued';
    return true;
  }

  updateUnit(unit: UnitEntity, deltaSeconds: number): void {
    for (const ladder of this.ladderList) {
      if (ladder.active?.unit === unit) {
        this.updateActive(ladder, deltaSeconds);
        return;
      }

      const queueIndex = this.findQueuedIndex(ladder, unit);
      if (queueIndex < 0) continue;
      const entry = ladder.queue[queueIndex];
      const directionIndex = this.directionIndex(ladder.queue, queueIndex, entry.direction);
      const queueGoal = entry.direction === 'ascending'
        ? ladder.groundQueue[Math.min(directionIndex, ladder.groundQueue.length - 1)]
        : ladder.topQueue[Math.min(directionIndex, ladder.topQueue.length - 1)];
      const reached = this.moveToward(unit, queueGoal, unit.stats.speed * CENTRAL_TOWER.queueMoveScale * deltaSeconds, true);
      unit.state = 'queued';

      if (queueIndex === 0 && !ladder.active && reached) {
        ladder.queue.shift();
        ladder.active = { ...entry, pathIndex: 0 };
        unit.navigationArea = ladder.id === 'player' ? 'playerLadder' : 'enemyLadder';
        unit.state = 'climbing';
        this.updateActive(ladder, deltaSeconds);
      }
      return;
    }
  }

  remove(unit: UnitEntity, snapActiveToSafety: boolean): void {
    for (const ladder of this.ladderList) {
      const queuedIndex = this.findQueuedIndex(ladder, unit);
      if (queuedIndex >= 0) ladder.queue.splice(queuedIndex, 1);
      if (ladder.active?.unit === unit) this.cancelActive(ladder, unit, snapActiveToSafety);
    }
  }

  private createRuntime(id: LadderId): LadderRuntime {
    const config = CENTRAL_TOWER.ladders[id];
    const groundEntry = point(config.groundEntry);
    const groundAlign = point(config.groundAlign);
    const climbTop = point(config.climbTop);
    const topExit = point(config.topExit);
    const groundQueue: Vector3[] = [];
    for (let index = 0; index < CENTRAL_TOWER.maximumQueuePerLadder; index += 1) {
      groundQueue.push(new Vector3(
        config.groundQueueOrigin.x + config.groundQueueStep.x * index,
        config.groundQueueOrigin.y + config.groundQueueStep.y * index,
        config.groundQueueOrigin.z + config.groundQueueStep.z * index,
      ));
    }
    const topQueue = config.topQueuePositions.map(point);
    return {
      id,
      facingYaw: config.facingYaw,
      ascentPath: [groundEntry, groundAlign, climbTop, topExit],
      descentPath: [topExit, climbTop, groundAlign, groundEntry],
      groundQueue,
      topQueue,
      queue: [],
      active: null,
    };
  }

  private updateActive(ladder: LadderRuntime, deltaSeconds: number): void {
    const active = ladder.active;
    if (!active) return;
    const unit = active.unit;
    const path = active.direction === 'ascending' ? ladder.ascentPath : ladder.descentPath;
    unit.state = 'climbing';
    unit.rig.root.rotation.y = this.rotateToward(unit.rig.root.rotation.y, ladder.facingYaw, deltaSeconds * 11);

    const reached = this.moveToward(unit, path[active.pathIndex], CENTRAL_TOWER.climbSpeed * deltaSeconds, false);
    if (!reached) return;
    active.pathIndex += 1;
    if (active.pathIndex < path.length) return;

    unit.navigationArea = active.direction === 'ascending' ? 'towerTop' : 'ground';
    unit.state = 'idle';
    unit.target = null;
    unit.targetRefreshClock = 0.04;
    ladder.active = null;
  }

  private moveToward(unit: UnitEntity, target: Vector3, maxDistance: number, faceMovement: boolean): boolean {
    const dx = target.x - unit.position.x;
    const dy = target.y - unit.position.y;
    const dz = target.z - unit.position.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= Math.max(CENTRAL_TOWER.queueArrivalRadius, maxDistance)) {
      unit.position.copyFrom(target);
      return true;
    }
    const scale = maxDistance / Math.max(0.0001, distance);
    unit.position.x += dx * scale;
    unit.position.y += dy * scale;
    unit.position.z += dz * scale;
    if (faceMovement && Math.abs(dx) + Math.abs(dz) > 0.001) {
      const yaw = Math.atan2(dx, dz);
      unit.rig.root.rotation.y = this.rotateToward(unit.rig.root.rotation.y, yaw, maxDistance * 2.8);
    }
    return false;
  }

  private cancelActive(ladder: LadderRuntime, unit: UnitEntity, snapToSafety: boolean): void {
    if (snapToSafety) unit.position.copyFrom(ladder.ascentPath[0]);
    unit.navigationArea = 'ground';
    ladder.active = null;
  }

  private directionIndex(queue: readonly QueueEntry[], targetIndex: number, direction: ClimbDirection): number {
    let result = 0;
    for (let index = 0; index < targetIndex; index += 1) {
      if (queue[index].direction === direction) result += 1;
    }
    return result;
  }

  private preferredLadder(team: Team): LadderId {
    return team === 'blue' ? 'player' : 'enemy';
  }

  private findQueuedIndex(ladder: LadderRuntime, unit: UnitEntity): number {
    for (let index = 0; index < ladder.queue.length; index += 1) {
      if (ladder.queue[index].unit === unit) return index;
    }
    return -1;
  }

  private rotateToward(current: number, desired: number, amount: number): number {
    let difference = desired - current;
    while (difference > Math.PI) difference -= Math.PI * 2;
    while (difference < -Math.PI) difference += Math.PI * 2;
    return current + difference * Math.min(1, amount);
  }
}
