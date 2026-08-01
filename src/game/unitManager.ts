import { Scene, ShadowGenerator, Vector3 } from '@babylonjs/core';
import { AudioManager } from '../audio/audioManager';
import { CONFIG, PORTRAIT_LAYOUT } from '../core/config';
import { laneX, randomRange, squaredDistanceXZ } from '../core/math';
import type { Lane, Team, UnitKind } from '../core/types';
import { MaterialLibrary } from '../render/materials';
import { UnitRig } from '../render/unitRig';
import { CastleLogic } from './castleLogic';
import { EffectPool } from './effects';
import { FlagController } from './flag';
import { ProjectilePool } from './projectiles';
import { UnitEntity } from './unit';

export class UnitManager {
  private readonly units: UnitEntity[] = [];
  private nextId = 1;

  constructor(
    private readonly scene: Scene,
    private readonly materials: MaterialLibrary,
    private readonly shadows: ShadowGenerator,
    private readonly effects: EffectPool,
    private readonly flag: FlagController,
    private readonly castles: CastleLogic,
    private readonly projectiles: ProjectilePool,
    private readonly audio: AudioManager,
  ) {
    for (const team of ['blue', 'red'] as const) {
      for (const kind of ['vanguard', 'ranger', 'raider', 'ironGuard'] as const) {
        this.createUnit(team, kind);
      }
    }
  }

  spawn(team: Team, kind: UnitKind, position: Vector3, lane: Lane): UnitEntity | null {
    if (this.countActive() >= CONFIG.match.maxActiveUnits) return null;
    let unit = this.units.find((candidate) => !candidate.active && candidate.team === team && candidate.kind === kind);
    if (!unit) unit = this.createUnit(team, kind);
    unit.spawn(position, lane);
    this.effects.spawn(position, team);
    this.audio.play('deploy');
    return unit;
  }

  update(deltaSeconds: number, elapsed: number): void {
    for (const unit of this.units) {
      if (!unit.active) continue;
      unit.age += deltaSeconds;

      if (unit.state === 'dead') {
        unit.deathClock += deltaSeconds;
        unit.rig.updateAnimation('dead', elapsed, 0, 0, Math.min(1, unit.deathClock / 0.82), false);
        if (unit.deathClock >= 1.18) unit.deactivate();
        continue;
      }

      if (unit.hitClock > 0) {
        unit.hitClock = Math.max(0, unit.hitClock - deltaSeconds);
        unit.state = 'hit';
        unit.rig.updateAnimation('hit', elapsed, 0, 1 - unit.hitClock / 0.24, 0, unit.carryingFlag);
        continue;
      }

      unit.targetRefreshClock -= deltaSeconds;
      if (unit.targetRefreshClock <= 0) {
        this.refreshTarget(unit);
        unit.targetRefreshClock = randomRange(CONFIG.unit.targetRefreshMin, CONFIG.unit.targetRefreshMax);
      }

      this.updateAliveUnit(unit, deltaSeconds, elapsed);
    }
  }

  applyDamage(target: UnitEntity, rawDamage: number, attacker: UnitEntity): void {
    if (!target.active || target.state === 'dead') return;
    let damage = rawDamage;
    const nearbyGuard = this.findNearbyGuard(target);
    if (nearbyGuard) damage *= nearbyGuard === target ? 0.92 : 0.8;

    target.health = Math.max(0, target.health - damage);
    target.lastAttacker = attacker;
    target.rig.setHealthRatio(target.health / target.stats.maxHealth);
    this.effects.hit(target.position);
    this.audio.play('hit');

    if (target.health <= 0) {
      this.kill(target);
      return;
    }

    target.hitClock = 0.24;
    target.attackClock = 0;
    target.attackHitApplied = false;
  }

  countActive(team?: Team): number {
    let count = 0;
    for (const unit of this.units) {
      if (unit.active && unit.state !== 'dead' && (!team || unit.team === team)) count += 1;
    }
    return count;
  }

  hasActiveKind(team: Team, kind: UnitKind): boolean {
    return this.units.some((unit) => unit.active && unit.state !== 'dead' && unit.team === team && unit.kind === kind);
  }

  dispose(): void {
    for (const unit of this.units) unit.rig.root.dispose();
    this.units.length = 0;
  }

  private createUnit(team: Team, kind: UnitKind): UnitEntity {
    const id = this.nextId++;
    const rig = new UnitRig(this.scene, this.materials, kind, team, id);
    rig.setEnabled(false);
    for (const mesh of rig.root.getChildMeshes()) {
      if (!mesh.name.includes('shadow') && !mesh.name.includes('health')) this.shadows.addShadowCaster(mesh);
    }
    const unit = new UnitEntity(id, team, kind, rig);
    this.units.push(unit);
    return unit;
  }

  private updateAliveUnit(unit: UnitEntity, deltaSeconds: number, elapsed: number): void {
    const target = unit.target;
    if (target && target.active && target.state !== 'dead' && !unit.carryingFlag) {
      const distanceSquared = squaredDistanceXZ(unit.position, target.position);
      const attackRangeSquared = unit.stats.attackRange * unit.stats.attackRange;
      if (distanceSquared <= attackRangeSquared) {
        this.updateAttack(unit, target, deltaSeconds, elapsed);
        return;
      }
    }

    unit.attackClock = 0;
    unit.attackHitApplied = false;
    const goal = this.getStrategicGoal(unit);
    const moved = this.moveUnit(unit, goal, deltaSeconds);
    unit.state = moved ? 'moving' : 'idle';

    if (!unit.carryingFlag && this.flag.canBePickedUp()) this.flag.tryPickup(unit);
    if (unit.carryingFlag) {
      const ownDelivery = this.castles.getCastle(unit.team).deliveryPoint;
      this.flag.tryDeliver(unit, ownDelivery);
    }
    if (this.castles.isAttackWindow(unit.team)) this.castles.tryInfiltrate(unit);

    unit.rig.updateAnimation(unit.state, elapsed, 0, 0, 0, unit.carryingFlag);
  }

  private updateAttack(unit: UnitEntity, target: UnitEntity, deltaSeconds: number, elapsed: number): void {
    unit.state = 'attacking';
    this.faceUnit(unit, target.position, deltaSeconds * 1.8);
    unit.attackClock += deltaSeconds;
    const progress = Math.min(1, unit.attackClock / unit.stats.attackCooldown);

    if (!unit.attackHitApplied && unit.attackClock >= unit.stats.windup) {
      unit.attackHitApplied = true;
      if (unit.kind === 'ranger') {
        this.projectiles.launch(
          unit.position.add(new Vector3(0, 1.75, 0)),
          target,
          unit.stats.damage,
          unit.stats.projectileSpeed ?? 16,
          unit,
        );
        this.audio.play('arrow');
      } else {
        this.applyDamage(target, unit.stats.damage, unit);
        this.audio.play('swing');
      }
    }

    if (unit.attackClock >= unit.stats.attackCooldown) {
      unit.attackClock = 0;
      unit.attackHitApplied = false;
    }

    unit.rig.updateAnimation('attacking', elapsed, progress, 0, 0, false);
  }

  private refreshTarget(unit: UnitEntity): void {
    if (unit.carryingFlag) {
      unit.target = null;
      return;
    }

    if (unit.lastAttacker?.active && unit.lastAttacker.state !== 'dead') {
      const retaliationRange = unit.stats.aggroRange * 1.6;
      if (squaredDistanceXZ(unit.position, unit.lastAttacker.position) <= retaliationRange * retaliationRange) {
        unit.target = unit.lastAttacker;
        return;
      }
    }

    const enemyCarrier = this.flag.currentCarrier?.team !== unit.team ? this.flag.currentCarrier : null;
    if (enemyCarrier?.active) {
      const carrierPressureRange = Math.max(unit.stats.aggroRange, unit.kind === 'ranger' ? 13 : 10.5);
      if (squaredDistanceXZ(unit.position, enemyCarrier.position) <= carrierPressureRange * carrierPressureRange) {
        unit.target = enemyCarrier;
        return;
      }
    }

    const friendlyCarrier = this.flag.currentCarrier?.team === unit.team ? this.flag.currentCarrier : null;
    if (friendlyCarrier) {
      const threat = this.findNearestEnemy(friendlyCarrier.position, unit.team, 6.5);
      if (threat && squaredDistanceXZ(unit.position, threat.position) <= 12 * 12) {
        unit.target = threat;
        return;
      }
    }

    const aggro = unit.kind === 'raider' && this.flag.canBePickedUp()
      ? Math.min(3.2, unit.stats.aggroRange)
      : unit.stats.aggroRange;
    unit.target = this.findNearestEnemy(unit.position, unit.team, aggro);
  }

  private findNearestEnemy(position: Vector3, team: Team, range: number): UnitEntity | null {
    let nearest: UnitEntity | null = null;
    let bestDistance = range * range;
    for (const candidate of this.units) {
      if (!candidate.active || candidate.state === 'dead' || candidate.team === team) continue;
      const distance = squaredDistanceXZ(position, candidate.position);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = candidate;
      }
    }
    return nearest;
  }

  private getStrategicGoal(unit: UnitEntity): Vector3 {
    if (unit.carryingFlag) return this.getReturnRoutePoint(unit);
    if (unit.target?.active && unit.target.state !== 'dead') return unit.target.position;

    const friendlyCarrier = this.flag.currentCarrier?.team === unit.team ? this.flag.currentCarrier : null;
    if (friendlyCarrier) {
      const side = unit.id % 2 === 0 ? -1 : 1;
      const behind = unit.team === 'blue' ? -1 : 1;
      return new Vector3(
        friendlyCarrier.position.x + side * (unit.kind === 'ironGuard' ? 1.45 : 1.95),
        unit.position.y,
        friendlyCarrier.position.z + behind * (unit.kind === 'ironGuard' ? 1.25 : 2.05),
      );
    }

    if (this.castles.isAttackWindow(unit.team)) return this.getAttackRoutePoint(unit);
    return this.getFlagRoutePoint(unit);
  }

  private getFlagRoutePoint(unit: UnitEntity): Vector3 {
    const flagPosition = this.flag.position;
    const lanePosition = laneX(unit.lane);
    const route = PORTRAIT_LAYOUT.arena.route;
    if (unit.team === 'blue' && unit.position.z < -route.flagApproachThresholdZ) {
      return new Vector3(lanePosition, unit.position.y, -route.flagApproachZ);
    }
    if (unit.team === 'red' && unit.position.z > route.flagApproachThresholdZ) {
      return new Vector3(lanePosition, unit.position.y, route.flagApproachZ);
    }
    return new Vector3(flagPosition.x, unit.position.y, flagPosition.z);
  }

  private getReturnRoutePoint(unit: UnitEntity): Vector3 {
    const delivery = this.castles.getCastle(unit.team).deliveryPoint;
    const route = PORTRAIT_LAYOUT.arena.route;
    if (unit.team === 'blue' && unit.position.z > -route.returnMergeThresholdZ) {
      return new Vector3(laneX(unit.lane) * route.returnLaneScale, unit.position.y, -route.returnMergeZ);
    }
    if (unit.team === 'red' && unit.position.z < route.returnMergeThresholdZ) {
      return new Vector3(laneX(unit.lane) * route.returnLaneScale, unit.position.y, route.returnMergeZ);
    }
    return new Vector3(delivery.x, unit.position.y, delivery.z);
  }

  private getAttackRoutePoint(unit: UnitEntity): Vector3 {
    const enemyCastle = this.castles.getCastle(unit.team === 'blue' ? 'red' : 'blue');
    const route = PORTRAIT_LAYOUT.arena.route;
    if (unit.team === 'blue') {
      if (unit.position.z < route.attackMergeThresholdZ) {
        return new Vector3(laneX(unit.lane) * route.attackLaneScale, unit.position.y, route.attackMergeZ);
      }
      if (unit.position.z < enemyCastle.gatePoint.z - 0.12) {
        return new Vector3(enemyCastle.gatePoint.x, unit.position.y, enemyCastle.gatePoint.z);
      }
    } else {
      if (unit.position.z > -route.attackMergeThresholdZ) {
        return new Vector3(laneX(unit.lane) * route.attackLaneScale, unit.position.y, -route.attackMergeZ);
      }
      if (unit.position.z > enemyCastle.gatePoint.z + 0.12) {
        return new Vector3(enemyCastle.gatePoint.x, unit.position.y, enemyCastle.gatePoint.z);
      }
    }
    const infiltrationZ = enemyCastle.interiorPoint.z + (unit.team === 'blue' ? route.infiltrationDepth : -route.infiltrationDepth);
    return new Vector3(enemyCastle.interiorPoint.x, unit.position.y, infiltrationZ);
  }

  private moveUnit(unit: UnitEntity, goal: Vector3, deltaSeconds: number): boolean {
    let dx = goal.x - unit.position.x;
    let dz = goal.z - unit.position.z;
    let distance = Math.hypot(dx, dz);
    if (distance < 0.12) return false;

    dx /= distance;
    dz /= distance;

    let separationX = 0;
    let separationZ = 0;
    const separationRadiusSquared = CONFIG.unit.separationRadius ** 2;
    for (const neighbor of this.units) {
      if (neighbor === unit || !neighbor.active || neighbor.state === 'dead' || neighbor.team !== unit.team) continue;
      const offsetX = unit.position.x - neighbor.position.x;
      const offsetZ = unit.position.z - neighbor.position.z;
      const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;
      if (distanceSquared <= 0.0001 || distanceSquared >= separationRadiusSquared) continue;
      const inverse = 1 / Math.sqrt(distanceSquared);
      const strength = (1 - Math.sqrt(distanceSquared) / CONFIG.unit.separationRadius) * CONFIG.unit.separationStrength;
      separationX += offsetX * inverse * strength;
      separationZ += offsetZ * inverse * strength;
    }

    dx += separationX * 0.38;
    dz += separationZ * 0.38;
    distance = Math.hypot(dx, dz);
    if (distance > 0.0001) {
      dx /= distance;
      dz /= distance;
    }

    let speed = unit.stats.speed;
    if (unit.carryingFlag) speed *= unit.kind === 'raider' ? 1 : 0.9;
    const step = speed * deltaSeconds;
    unit.position.x += dx * step;
    unit.position.z += dz * step;
    unit.position.x = Math.max(-PORTRAIT_LAYOUT.arena.unitBoundsX, Math.min(PORTRAIT_LAYOUT.arena.unitBoundsX, unit.position.x));
    unit.position.z = Math.max(-PORTRAIT_LAYOUT.arena.unitBoundsZ, Math.min(PORTRAIT_LAYOUT.arena.unitBoundsZ, unit.position.z));
    this.faceUnit(unit, new Vector3(unit.position.x + dx, unit.position.y, unit.position.z + dz), deltaSeconds);
    return true;
  }

  private faceUnit(unit: UnitEntity, target: Vector3, deltaSeconds: number): void {
    const dx = target.x - unit.position.x;
    const dz = target.z - unit.position.z;
    if (Math.abs(dx) + Math.abs(dz) < 0.001) return;
    const desired = Math.atan2(dx, dz);
    let difference = desired - unit.rig.root.rotation.y;
    while (difference > Math.PI) difference -= Math.PI * 2;
    while (difference < -Math.PI) difference += Math.PI * 2;
    unit.rig.root.rotation.y += difference * Math.min(1, deltaSeconds * 9);
  }

  private findNearbyGuard(target: UnitEntity): UnitEntity | null {
    let nearest: UnitEntity | null = null;
    let best = 2.8 * 2.8;
    for (const candidate of this.units) {
      if (!candidate.active || candidate.state === 'dead' || candidate.team !== target.team || candidate.kind !== 'ironGuard') continue;
      const distance = squaredDistanceXZ(target.position, candidate.position);
      if (distance <= best) {
        best = distance;
        nearest = candidate;
      }
    }
    return nearest;
  }

  private kill(unit: UnitEntity): void {
    unit.health = 0;
    unit.state = 'dead';
    unit.deathClock = 0;
    unit.target = null;
    if (unit.carryingFlag) this.flag.dropFrom(unit);
    this.audio.play('death');
  }
}
