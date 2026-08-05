import { Vector3 } from '@babylonjs/core';
import { ENEMY_CASTLE_ASSAULT } from '../core/config';
import { squaredDistanceXZ } from '../core/math';
import { blocksApproach } from './riverCrossing';
import type { UnitEntity } from './unit';

type LadderId = keyof typeof ENEMY_CASTLE_ASSAULT.ladders;
type TransitMode = 'defenderUp' | 'defenderDown' | 'wallExit';

interface ActiveTransit {
  readonly unit: UnitEntity;
  readonly mode: TransitMode;
  readonly path: readonly Vector3[];
  pathIndex: number;
}

interface FallingUnit {
  readonly unit: UnitEntity;
  readonly start: Vector3;
  readonly landing: Vector3;
  readonly spinDirection: number;
  elapsed: number;
}

interface LadderRuntime {
  readonly id: LadderId;
  readonly ascentPath: readonly Vector3[];
  readonly groundQueue: readonly Vector3[];
  readonly defenderUpPath: readonly Vector3[];
  readonly defenderDownPath: readonly Vector3[];
  readonly wallExitPath: readonly Vector3[];
  readonly guardPoint: Vector3;
  readonly queue: UnitEntity[];
  activeClimber: UnitEntity | null;
  climbPathIndex: number;
  dismountProgress: number;
  mountProgress: number;
  speedRamp: number;
  defender: UnitEntity | null;
}

const point = (value: { readonly x: number; readonly y: number; readonly z: number }): Vector3 => (
  new Vector3(value.x, value.y, value.z)
);

export class CastleLadderSystem {
  private readonly ladders: Record<LadderId, LadderRuntime>;
  private readonly ladderList: readonly LadderRuntime[];
  private readonly transits: ActiveTransit[] = [];
  private readonly falling: FallingUnit[] = [];
  private readonly wallAttackers = new Set<UnitEntity>();

  constructor() {
    this.ladders = {
      left: this.createRuntime('left'),
      right: this.createRuntime('right'),
    };
    this.ladderList = [this.ladders.left, this.ladders.right];
  }

  beginFrame(): void {
    for (const ladder of this.ladderList) {
      for (let index = ladder.queue.length - 1; index >= 0; index -= 1) {
        const unit = ladder.queue[index];
        if (!unit.active || unit.state === 'dead') ladder.queue.splice(index, 1);
      }
      if (ladder.activeClimber && (!ladder.activeClimber.active || ladder.activeClimber.state === 'dead')) {
        this.clearActiveClimber(ladder, ladder.activeClimber, true);
      }
      if (ladder.defender && (!ladder.defender.active || ladder.defender.state === 'dead')) {
        ladder.defender = null;
      }
    }

    for (let index = this.transits.length - 1; index >= 0; index -= 1) {
      const transit = this.transits[index];
      if (transit.unit.active && transit.unit.state !== 'dead') continue;
      this.clearDefenderReservation(transit.unit);
      this.transits.splice(index, 1);
    }
    for (let index = this.falling.length - 1; index >= 0; index -= 1) {
      const fall = this.falling[index];
      if (fall.unit.active && fall.unit.state !== 'dead') continue;
      fall.unit.rig.root.rotation.z = 0;
      this.falling.splice(index, 1);
    }
    for (const unit of this.wallAttackers) {
      if (
        !unit.active
        || unit.state === 'dead'
        || (unit.navigationArea !== 'enemyWallTop' && unit.navigationArea !== 'enemyCastleAccess')
      ) this.wallAttackers.delete(unit);
    }
  }

  isRegistered(unit: UnitEntity): boolean {
    if (this.transits.some((transit) => transit.unit === unit)) return true;
    if (this.falling.some((fall) => fall.unit === unit)) return true;
    for (const ladder of this.ladderList) {
      if (ladder.activeClimber === unit || ladder.queue.includes(unit)) return true;
    }
    return false;
  }

  requestAssault(unit: UnitEntity): boolean {
    if (this.isRegistered(unit)) return true;
    if (
      unit.team !== 'blue'
      || unit.kind === 'nyx'
      || unit.carryingFlag
      || unit.navigationArea !== 'ground'
      || !this.prefersLadder(unit)
    ) return false;

    const candidates = this.ladderList.filter((ladder) => (
      ladder.queue.length < ENEMY_CASTLE_ASSAULT.maximumQueuePerLadder
    ));
    if (candidates.length === 0) return false;

    let selected = candidates[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const ladder of candidates) {
      const entry = ladder.ascentPath[0];
      const congestion = ladder.queue.length + (ladder.activeClimber ? 1 : 0);
      const score = congestion * 4.5 + Math.abs(unit.position.x - entry.x) * 0.18;
      if (score < bestScore) {
        bestScore = score;
        selected = ladder;
      }
    }
    // The queue walk is a straight line to the castle, so a unit with a river still in front of it
    // stays under normal movement and joins the queue once it has crossed a bridge.
    if (blocksApproach(unit, selected.groundQueue[0].z)) return false;

    selected.queue.push(unit);
    unit.target = null;
    unit.attackClock = 0;
    unit.attackHitApplied = false;
    unit.state = 'queued';
    return true;
  }

  requestDefense(unit: UnitEntity): boolean {
    if (this.isRegistered(unit)) return true;
    if (!this.canDefend(unit)) return false;

    const ladder = this.freeDefenceLadder();
    if (!ladder) return false;
    // The defender transit is a straight line to the wall: cross any river on a bridge first.
    if (blocksApproach(unit, ladder.defenderUpPath[0].z)) return false;
    ladder.defender = unit;
    const transit: ActiveTransit = {
      unit,
      mode: 'defenderUp',
      path: ladder.defenderUpPath,
      pathIndex: 0,
    };
    this.transits.push(transit);
    unit.target = null;
    unit.attackClock = 0;
    unit.attackHitApplied = false;
    unit.state = 'queued';
    return true;
  }

  /**
   * Ground point a would-be defender should walk to while a river still blocks the transit, so it keeps
   * heading for the wall under normal (bridge-aware) movement. Null when nothing is waiting on it.
   */
  defenceApproach(unit: UnitEntity): Vector3 | null {
    if (this.isRegistered(unit) || !this.canDefend(unit)) return null;
    const ladder = this.freeDefenceLadder();
    if (!ladder || !blocksApproach(unit, ladder.defenderUpPath[0].z)) return null;
    return ladder.defenderUpPath[0];
  }

  requestWallExit(unit: UnitEntity): boolean {
    if (this.isRegistered(unit)) return true;
    if (unit.team !== 'blue' || unit.navigationArea !== 'enemyWallTop') return false;
    const ladder = this.closestLadder(unit.position.x);
    this.transits.push({
      unit,
      mode: 'wallExit',
      path: ladder.wallExitPath,
      pathIndex: 0,
    });
    unit.navigationArea = 'enemyCastleAccess';
    unit.state = 'climbing';
    unit.target = null;
    return true;
  }

  requestDefenseReturn(unit: UnitEntity): boolean {
    if (this.isRegistered(unit)) return true;
    const ladder = this.ladderList.find((candidate) => candidate.defender === unit);
    if (!ladder || unit.navigationArea !== 'enemyWallTop') return false;
    this.transits.push({
      unit,
      mode: 'defenderDown',
      path: ladder.defenderDownPath,
      pathIndex: 0,
    });
    unit.navigationArea = 'enemyCastleAccess';
    unit.state = 'climbing';
    unit.target = null;
    return true;
  }

  updateUnit(unit: UnitEntity, deltaSeconds: number): void {
    const fall = this.falling.find((candidate) => candidate.unit === unit);
    if (fall) {
      this.updateFall(fall, deltaSeconds);
      return;
    }

    const transit = this.transits.find((candidate) => candidate.unit === unit);
    if (transit) {
      this.updateTransit(transit, deltaSeconds);
      return;
    }

    for (const ladder of this.ladderList) {
      if (ladder.activeClimber === unit) {
        this.updateClimber(ladder, deltaSeconds);
        return;
      }
      const queueIndex = ladder.queue.indexOf(unit);
      if (queueIndex < 0) continue;
      const queueGoal = ladder.groundQueue[queueIndex];
      const reached = this.moveToward(
        unit,
        queueGoal,
        unit.stats.speed * ENEMY_CASTLE_ASSAULT.queueMoveScale * deltaSeconds,
        true,
      );
      unit.state = 'queued';
      if (queueIndex === 0 && !ladder.activeClimber && reached) {
        ladder.queue.shift();
        ladder.activeClimber = unit;
        ladder.climbPathIndex = 0;
        ladder.mountProgress = 0;
        ladder.speedRamp = 0;
        unit.navigationArea = ladder.id === 'left' ? 'enemyCastleLadderLeft' : 'enemyCastleLadderRight';
        unit.state = 'climbing';
        this.updateClimber(ladder, deltaSeconds);
      }
      return;
    }
  }

  findPriorityTarget(unit: UnitEntity, units: readonly UnitEntity[]): UnitEntity | null {
    let nearest: UnitEntity | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of units) {
      if (!candidate.active || candidate.state === 'dead' || candidate.team === unit.team) continue;
      let eligible = false;
      if (unit.team === 'red' && unit.navigationArea === 'enemyWallTop') {
        eligible = candidate.navigationArea === 'enemyWallTop' || this.isAttackableClimber(candidate);
      } else if (unit.team === 'red' && unit.kind === 'nyx' && unit.navigationArea === 'ground') {
        eligible = candidate.navigationArea === 'enemyWallTop' || this.isCastleClimber(candidate);
      } else if (unit.team === 'blue' && unit.kind === 'nyx' && unit.navigationArea === 'ground') {
        eligible = candidate.navigationArea === 'enemyWallTop';
      } else if (unit.team === 'blue' && unit.navigationArea === 'enemyWallTop') {
        eligible = candidate.navigationArea === 'enemyWallTop';
      }
      if (!eligible) continue;
      const distance = squaredDistanceXZ(unit.position, candidate.position);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = candidate;
      }
    }
    return nearest;
  }

  canEngage(attacker: UnitEntity, target: UnitEntity): boolean {
    if (attacker.navigationArea === 'enemyWallTop' && target.navigationArea === 'enemyWallTop') return true;
    if (
      attacker.team === 'red'
      && attacker.kind !== 'nyx'
      && attacker.navigationArea === 'enemyWallTop'
      && this.isAttackableClimber(target)
    ) return true;
    if (attacker.kind !== 'nyx' || attacker.navigationArea !== 'ground') return false;
    if (attacker.team === 'red') return this.isCastleClimber(target) || target.navigationArea === 'enemyWallTop';
    return target.navigationArea === 'enemyWallTop';
  }

  tryKnockDown(target: UnitEntity, attacker: UnitEntity): boolean {
    if (
      attacker.team !== 'red'
      || attacker.kind === 'nyx'
      || attacker.navigationArea !== 'enemyWallTop'
      || !this.isAttackableClimber(target)
    ) return false;

    const ladder = this.ladderList.find((candidate) => candidate.activeClimber === target);
    if (!ladder) return false;
    ladder.activeClimber = null;
    ladder.climbPathIndex = 0;
    this.wallAttackers.delete(target);
    target.target = null;
    target.attackClock = 0;
    target.attackHitApplied = false;
    target.state = 'falling';
    this.falling.push({
      unit: target,
      start: target.position.clone(),
      landing: ladder.ascentPath[0].clone(),
      spinDirection: ladder.id === 'left' ? -1 : 1,
      elapsed: 0,
    });
    return true;
  }

  getGuardPoint(unit: UnitEntity): Vector3 | null {
    return this.ladderList.find((ladder) => ladder.defender === unit)?.guardPoint ?? null;
  }

  getNyxSupportPoint(unit: UnitEntity): Vector3 {
    const side = unit.lane === 'left' ? 'left' : unit.lane === 'right' ? 'right' : unit.id % 2 === 0 ? 'left' : 'right';
    return point(ENEMY_CASTLE_ASSAULT.nyxSupport[side]);
  }

  isWallDefender(unit: UnitEntity): boolean {
    return this.ladderList.some((ladder) => ladder.defender === unit);
  }

  hasAssaultInProgress(): boolean {
    return this.wallAttackers.size > 0 || this.ladderList.some((ladder) => (
      ladder.activeClimber !== null || ladder.queue.length > 0
    ));
  }

  remove(unit: UnitEntity, snapActiveToSafety: boolean): void {
    for (const ladder of this.ladderList) {
      const queuedIndex = ladder.queue.indexOf(unit);
      if (queuedIndex >= 0) ladder.queue.splice(queuedIndex, 1);
      if (ladder.activeClimber === unit) {
        ladder.dismountProgress = 0;
        ladder.mountProgress = 0;
        ladder.speedRamp = 0;
        this.clearActiveClimber(ladder, unit, snapActiveToSafety);
      }
      if (ladder.defender === unit) ladder.defender = null;
    }
    const transitIndex = this.transits.findIndex((transit) => transit.unit === unit);
    if (transitIndex >= 0) {
      const transit = this.transits[transitIndex];
      if (snapActiveToSafety) {
        const safetyPoint = transit.mode === 'defenderUp' ? transit.path[0] : transit.path[transit.path.length - 1];
        unit.position.copyFrom(safetyPoint);
      }
      unit.navigationArea = 'ground';
      this.transits.splice(transitIndex, 1);
    }
    const fallIndex = this.falling.findIndex((fall) => fall.unit === unit);
    if (fallIndex >= 0) {
      const fall = this.falling[fallIndex];
      if (snapActiveToSafety) unit.position.copyFrom(fall.landing);
      unit.navigationArea = 'ground';
      unit.rig.root.rotation.z = 0;
      this.falling.splice(fallIndex, 1);
    }
    this.wallAttackers.delete(unit);
  }

  private createRuntime(id: LadderId): LadderRuntime {
    const config = ENEMY_CASTLE_ASSAULT.ladders[id];
    const groundEntry = point(config.groundEntry);
    const groundAlign = point(config.groundAlign);
    const climbTop = point(config.climbTop);
    const topExit = point(config.topExit);
    const defenderGroundEntry = point(config.defenderGroundEntry);
    const defenderTopEntry = point(config.defenderTopEntry);
    const guardPoint = point(config.defenderGuard);
    const breachGroundExit = point(config.breachGroundExit);
    const groundQueue: Vector3[] = [];
    for (let index = 0; index < ENEMY_CASTLE_ASSAULT.maximumQueuePerLadder; index += 1) {
      groundQueue.push(new Vector3(
        config.groundQueueOrigin.x + config.groundQueueStep.x * index,
        config.groundQueueOrigin.y + config.groundQueueStep.y * index,
        config.groundQueueOrigin.z + config.groundQueueStep.z * index,
      ));
    }
    return {
      id,
      ascentPath: [groundEntry, groundAlign, climbTop, topExit],
      groundQueue,
      defenderUpPath: [defenderGroundEntry, defenderTopEntry, guardPoint],
      defenderDownPath: [guardPoint, defenderTopEntry, defenderGroundEntry],
      wallExitPath: [topExit, defenderTopEntry, breachGroundExit],
      guardPoint,
      queue: [],
      activeClimber: null,
      climbPathIndex: 0,
      dismountProgress: 0,
      mountProgress: 0,
      speedRamp: 0,
      defender: null,
    };
  }

  private updateClimber(ladder: LadderRuntime, deltaSeconds: number): void {
    const unit = ladder.activeClimber;
    if (!unit) return;
    unit.state = 'climbing';
    unit.rig.root.rotation.y = this.rotateToward(unit.rig.root.rotation.y, 0, deltaSeconds * 8);

    const lean = 0.18;
    let targetSpeed: number;
    if (ladder.climbPathIndex <= 0) {
      targetSpeed = ENEMY_CASTLE_ASSAULT.mountTransitionSpeed;
    } else if (ladder.climbPathIndex === 1) {
      targetSpeed = ENEMY_CASTLE_ASSAULT.climbUpSpeed;
    } else {
      targetSpeed = ENEMY_CASTLE_ASSAULT.dismountTransitionSpeed;
    }

    const rampRate = 4.5 * deltaSeconds;
    ladder.speedRamp += (targetSpeed - ladder.speedRamp) * Math.min(1, rampRate);
    const moveStep = ladder.speedRamp * deltaSeconds;
    const reached = this.moveToward(
      unit,
      ladder.ascentPath[ladder.climbPathIndex],
      moveStep,
      false,
    );

    const isOnMountSegment = ladder.climbPathIndex === 0;
    const isOnClimbSegment = ladder.climbPathIndex >= 1 && ladder.climbPathIndex <= 2;

    if (isOnMountSegment) {
      const segStart = ladder.ascentPath[0];
      const segEnd = ladder.ascentPath[1];
      const totalLen = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y, segEnd.z - segStart.z);
      const dx = unit.position.x - segStart.x;
      const dy = unit.position.y - segStart.y;
      const dz = unit.position.z - segStart.z;
      const dist = Math.hypot(dx, dy, dz);
      ladder.mountProgress = Math.min(1, dist / Math.max(0.01, totalLen));
      unit.rig.applyMountPose(ladder.mountProgress, lean, unit.age);
    } else if (isOnClimbSegment) {
      const climbStart = ladder.ascentPath[1];
      const climbEnd = ladder.ascentPath[2];
      const dx = unit.position.x - climbStart.x;
      const dy = unit.position.y - climbStart.y;
      const dz = unit.position.z - climbStart.z;
      const distAlongClimb = Math.hypot(dx, dy, dz);
      const totalClimbLen = Math.hypot(
        climbEnd.x - climbStart.x,
        climbEnd.y - climbStart.y,
        climbEnd.z - climbStart.z,
      );
      const rungSpacing = totalClimbLen / 12;
      const phase = (distAlongClimb / rungSpacing) % 1;
      unit.rig.applyClimbCycle(phase, lean, unit.age, false);
    }

    if (!reached) return;
    ladder.climbPathIndex += 1;
    if (ladder.climbPathIndex < ladder.ascentPath.length) return;

    ladder.dismountProgress += deltaSeconds * 1.4;
    if (ladder.dismountProgress < 1) {
      unit.rig.applyTopDismount(ladder.dismountProgress, unit.age);
      ladder.climbPathIndex = ladder.ascentPath.length - 1;
      return;
    }
    unit.rig.clearInteractionPose();
    unit.navigationArea = 'enemyWallTop';
    unit.state = 'idle';
    unit.target = null;
    unit.targetRefreshClock = 0.02;
    this.wallAttackers.add(unit);
    ladder.activeClimber = null;
    ladder.climbPathIndex = 0;
    ladder.dismountProgress = 0;
    ladder.mountProgress = 0;
    ladder.speedRamp = 0;
  }

  private updateTransit(transit: ActiveTransit, deltaSeconds: number): void {
    const unit = transit.unit;
    const approachingAccess = transit.mode === 'defenderUp' && transit.pathIndex === 0;
    unit.state = approachingAccess ? 'queued' : 'climbing';
    const speed = approachingAccess
      ? unit.stats.speed * ENEMY_CASTLE_ASSAULT.queueMoveScale
      : ENEMY_CASTLE_ASSAULT.accessSpeed;
    const reached = this.moveToward(unit, transit.path[transit.pathIndex], speed * deltaSeconds, true);
    if (!reached) return;
    transit.pathIndex += 1;
    if (transit.pathIndex < transit.path.length) {
      unit.navigationArea = 'enemyCastleAccess';
      return;
    }

    if (transit.mode === 'defenderUp') {
      unit.navigationArea = 'enemyWallTop';
    } else {
      unit.navigationArea = 'ground';
      if (transit.mode === 'defenderDown') this.clearDefenderReservation(unit);
      if (transit.mode === 'wallExit') this.wallAttackers.delete(unit);
    }
    unit.state = 'idle';
    unit.target = null;
    unit.targetRefreshClock = 0.02;
    this.transits.splice(this.transits.indexOf(transit), 1);
  }

  private updateFall(fall: FallingUnit, deltaSeconds: number): void {
    fall.elapsed += deltaSeconds;
    const progress = Math.min(1, fall.elapsed / ENEMY_CASTLE_ASSAULT.fallDuration);
    const eased = progress * progress * (3 - 2 * progress);
    fall.unit.state = 'falling';
    fall.unit.navigationArea = fall.unit.position.x < 0 ? 'enemyCastleLadderLeft' : 'enemyCastleLadderRight';
    fall.unit.position.x = fall.start.x + (fall.landing.x - fall.start.x) * eased;
    fall.unit.position.z = fall.start.z + (fall.landing.z - fall.start.z) * eased - Math.sin(progress * Math.PI) * 0.72;
    fall.unit.position.y = fall.start.y + (fall.landing.y - fall.start.y) * eased + Math.sin(progress * Math.PI) * 0.52;
    fall.unit.rig.root.rotation.z = fall.spinDirection * Math.sin(progress * Math.PI) * 1.08;
    if (progress < 1) return;
    fall.unit.position.copyFrom(fall.landing);
    fall.unit.rig.root.rotation.z = 0;
    fall.unit.navigationArea = 'ground';
    fall.unit.state = 'hit';
    fall.unit.hitClock = Math.max(fall.unit.hitClock, 0.3);
    fall.unit.targetRefreshClock = 0.08;
    this.falling.splice(this.falling.indexOf(fall), 1);
  }

  private clearActiveClimber(ladder: LadderRuntime, unit: UnitEntity, snapToSafety: boolean): void {
    if (snapToSafety) unit.position.copyFrom(ladder.ascentPath[0]);
    unit.navigationArea = 'ground';
    ladder.activeClimber = null;
    ladder.climbPathIndex = 0;
    ladder.mountProgress = 0;
    ladder.speedRamp = 0;
    this.wallAttackers.delete(unit);
  }

  private clearDefenderReservation(unit: UnitEntity): void {
    for (const ladder of this.ladderList) {
      if (ladder.defender === unit) ladder.defender = null;
    }
  }

  private closestLadder(x: number): LadderRuntime {
    return Math.abs(x - this.ladders.left.guardPoint.x) <= Math.abs(x - this.ladders.right.guardPoint.x)
      ? this.ladders.left
      : this.ladders.right;
  }

  private prefersLadder(unit: UnitEntity): boolean {
    // VEX always goes over the wall — infiltration is its whole job. BRAX mostly climbs to contest
    // the wall top. FUSE never climbs: its damage belongs on the gate/castle, so it stays on the
    // ground assault route and sieges the structure.
    if (unit.kind === 'vex') return true;
    if (unit.kind === 'brax') return unit.id % 3 !== 0;
    return false;
  }

  private canDefend(unit: UnitEntity): boolean {
    return unit.team === 'red'
      && unit.kind !== 'nyx'
      && !unit.carryingFlag
      && unit.navigationArea === 'ground'
      && !this.isWallDefender(unit);
  }

  private freeDefenceLadder(): LadderRuntime | undefined {
    return this.ladderList.find((candidate) => !candidate.defender);
  }

  private isCastleClimber(unit: UnitEntity): boolean {
    return unit.navigationArea === 'enemyCastleLadderLeft' || unit.navigationArea === 'enemyCastleLadderRight';
  }

  private isAttackableClimber(unit: UnitEntity): boolean {
    return this.isCastleClimber(unit)
      && unit.state === 'climbing'
      && unit.position.y >= ENEMY_CASTLE_ASSAULT.attackableClimberMinY;
  }

  private moveToward(unit: UnitEntity, target: Vector3, maxDistance: number, faceMovement: boolean): boolean {
    const dx = target.x - unit.position.x;
    const dy = target.y - unit.position.y;
    const dz = target.z - unit.position.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= Math.max(ENEMY_CASTLE_ASSAULT.queueArrivalRadius, maxDistance)) {
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

  private rotateToward(current: number, desired: number, amount: number): number {
    let difference = desired - current;
    while (difference > Math.PI) difference -= Math.PI * 2;
    while (difference < -Math.PI) difference += Math.PI * 2;
    return current + difference * Math.min(1, amount);
  }
}
