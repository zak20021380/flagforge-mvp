import { Scene, ShadowGenerator, Vector3 } from '@babylonjs/core';
import { AudioManager } from '../audio/audioManager';
import { ARENA_RIVERS, CENTRAL_TOWER, CONFIG, ENEMY_CASTLE_ASSAULT, PORTRAIT_LAYOUT } from '../core/config';
import { clamp, laneX, randomRange, squaredDistanceXZ } from '../core/math';
import type { Lane, NavigationArea, Team, UnitKind } from '../core/types';
import { MaterialLibrary } from '../render/materials';
import { UnitRig } from '../render/unitRig';
import { BridgeTraffic } from './bridgeTraffic';
import { CastleLogic } from './castleLogic';
import { CastleLadderSystem } from './castleLadderSystem';
import { EffectPool } from './effects';
import { FlagController } from './flag';
import { LadderSystem } from './ladderSystem';
import { ProjectilePool } from './projectiles';
import { applyGroundStep, keepOnLand, resolveCrossingGoal } from './riverCrossing';
import { UnitEntity } from './unit';

export class UnitManager {
  private readonly units: UnitEntity[] = [];
  private readonly bridges = new BridgeTraffic();
  private readonly ladders = new LadderSystem();
  private readonly castleLadders = new CastleLadderSystem();
  private readonly movementScratch = Vector3.Zero();
  private readonly facingScratch = Vector3.Zero();
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
    this.bridges.beginFrame();
    this.ladders.beginFrame();
    this.castleLadders.beginFrame();
    for (const unit of this.units) {
      if (!unit.active) continue;
      unit.age += deltaSeconds;

      if (unit.state === 'dead') {
        unit.deathClock += deltaSeconds;
        unit.rig.updateAnimation('dead', elapsed, 0, 0, Math.min(1, unit.deathClock / 0.82), false);
        if (unit.deathClock >= 1.18) unit.deactivate();
        continue;
      }

      // One-shot rescue: anything that displaced a body into a channel (a spawn, a snap-back, an old
      // save) is undone before the unit acts. Idempotent, so a unit on land pays two comparisons.
      if (unit.navigationArea === 'ground') keepOnLand(unit);

      if (this.castleLadders.isRegistered(unit)) {
        this.castleLadders.updateUnit(unit, deltaSeconds);
        if (
          !this.castleLadders.isRegistered(unit)
          && unit.navigationArea === 'ground'
          && this.castles.isAttackWindow(unit.team)
        ) this.castles.tryInfiltrate(unit);
        unit.rig.updateAnimation(unit.state, elapsed, 0, 0, 0, unit.carryingFlag);
        continue;
      }

      if (unit.hitClock > 0) {
        unit.hitClock = Math.max(0, unit.hitClock - deltaSeconds);
        unit.state = 'hit';
        unit.rig.updateAnimation('hit', elapsed, 0, 1 - unit.hitClock / 0.24, 0, unit.carryingFlag);
        continue;
      }

      if (this.ladders.isRegistered(unit)) {
        this.ladders.updateUnit(unit, deltaSeconds);
        unit.rig.updateAnimation(unit.state, elapsed, 0, 0, 0, unit.carryingFlag);
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
    this.castleLadders.tryKnockDown(target, attacker);
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
    if (this.castles.isAttackWindow(unit.team) && this.castles.tryInfiltrate(unit)) {
      unit.state = 'idle';
      unit.rig.updateAnimation(unit.state, elapsed, 0, 0, 0, unit.carryingFlag);
      return;
    }

    const enemyCastleUnderAttack = this.castles.isAttackWindow('blue');
    const wantsCastleDefence = enemyCastleUnderAttack
      && unit.team === 'red'
      && unit.navigationArea === 'ground'
      && unit.position.z > PORTRAIT_LAYOUT.arena.route.attackMergeThresholdZ;
    if (wantsCastleDefence && this.castleLadders.requestDefense(unit)) {
      this.castleLadders.updateUnit(unit, deltaSeconds);
      unit.rig.updateAnimation(unit.state, elapsed, 0, 0, 0, unit.carryingFlag);
      return;
    }
    if (enemyCastleUnderAttack && unit.team === 'blue' && this.castleLadders.requestAssault(unit)) {
      this.castleLadders.updateUnit(unit, deltaSeconds);
      unit.rig.updateAnimation(unit.state, elapsed, 0, 0, 0, unit.carryingFlag);
      return;
    }
    if (
      unit.team === 'red'
      && unit.navigationArea === 'enemyWallTop'
      && !enemyCastleUnderAttack
      && !this.castleLadders.hasAssaultInProgress()
      && this.castleLadders.requestDefenseReturn(unit)
    ) {
      this.castleLadders.updateUnit(unit, deltaSeconds);
      unit.rig.updateAnimation(unit.state, elapsed, 0, 0, 0, unit.carryingFlag);
      return;
    }

    // On a contested bridge the combat target is the nearest enemy on the same deck, computed fresh
    // every frame; the preserved strategic target is only a fallback while it exists.
    const target = this.bridges.contestedTarget(unit) ?? unit.target;
    if (target && target.active && target.state !== 'dead' && !unit.carryingFlag && this.canAttackTarget(unit, target)) {
      const distanceSquared = squaredDistanceXZ(unit.position, target.position);
      const attackRangeSquared = unit.stats.attackRange * unit.stats.attackRange;
      if (distanceSquared <= attackRangeSquared) {
        this.updateAttack(unit, target, deltaSeconds, elapsed);
        return;
      }
    }

    if (
      unit.team === 'blue'
      && unit.navigationArea === 'enemyWallTop'
      && (!target || !target.active || target.state === 'dead')
      && this.castleLadders.requestWallExit(unit)
    ) {
      this.castleLadders.updateUnit(unit, deltaSeconds);
      unit.rig.updateAnimation(unit.state, elapsed, 0, 0, 0, unit.carryingFlag);
      return;
    }

    unit.attackClock = 0;
    unit.attackHitApplied = false;
    // A defender the castle system turned away because a river still lies in the way walks to the
    // ladder approach on foot instead, so the defensive intent survives the crossing.
    const defenceApproach = wantsCastleDefence ? this.castleLadders.defenceApproach(unit) : null;
    const goal = defenceApproach ?? this.getStrategicGoal(unit);
    if (this.ladders.requestIfNeeded(unit, goal)) {
      this.ladders.updateUnit(unit, deltaSeconds);
      unit.rig.updateAnimation(unit.state, elapsed, 0, 0, 0, unit.carryingFlag);
      return;
    }
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

    // While the unit's bridge is contested its pursuit pauses: keep the strategic target and let the
    // bridge system pick the nearest enemy on the deck. Without a target yet, adopt the bridge one so
    // the unit fights instead of standing idle at the frontline.
    if (this.bridges.isInCombat(unit)) {
      if (!unit.target || !unit.target.active || unit.target.state === 'dead') {
        unit.target = this.bridges.contestedTarget(unit);
      }
      return;
    }

    const castleTarget = this.castleLadders.findPriorityTarget(unit, this.units);
    if (castleTarget) {
      unit.target = castleTarget;
      return;
    }

    if (unit.lastAttacker?.active && unit.lastAttacker.state !== 'dead' && unit.lastAttacker.state !== 'climbing') {
      const retaliationRange = unit.stats.aggroRange * 1.6;
      if (squaredDistanceXZ(unit.position, unit.lastAttacker.position) <= retaliationRange * retaliationRange) {
        unit.target = unit.lastAttacker;
        return;
      }
    }

    const enemyCarrier = this.flag.currentCarrier?.team !== unit.team ? this.flag.currentCarrier : null;
    if (enemyCarrier?.active && enemyCarrier.state !== 'climbing') {
      const carrierPressureRange = Math.max(unit.stats.aggroRange, unit.kind === 'ranger' ? 13 : 10.5);
      if (squaredDistanceXZ(unit.position, enemyCarrier.position) <= carrierPressureRange * carrierPressureRange) {
        unit.target = enemyCarrier;
        return;
      }
    }

    const friendlyCarrier = this.flag.currentCarrier?.team === unit.team ? this.flag.currentCarrier : null;
    if (friendlyCarrier) {
      const threat = this.findNearestEnemy(friendlyCarrier.position, unit.team, 6.5, friendlyCarrier.navigationArea);
      if (threat && squaredDistanceXZ(unit.position, threat.position) <= 12 * 12) {
        unit.target = threat;
        return;
      }
    }

    const aggro = unit.kind === 'raider' && this.flag.canBePickedUp()
      ? Math.min(3.2, unit.stats.aggroRange)
      : unit.stats.aggroRange;
    unit.target = this.findNearestEnemy(unit.position, unit.team, aggro, unit.navigationArea);
  }

  private findNearestEnemy(position: Vector3, team: Team, range: number, area: NavigationArea): UnitEntity | null {
    let nearest: UnitEntity | null = null;
    let bestDistance = range * range;
    for (const candidate of this.units) {
      if (
        !candidate.active
        || candidate.state === 'dead'
        || candidate.team === team
        || candidate.navigationArea !== area
      ) continue;
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

    const guardPoint = this.castleLadders.getGuardPoint(unit);
    if (guardPoint) return guardPoint;

    const friendlyCarrier = this.flag.currentCarrier?.team === unit.team ? this.flag.currentCarrier : null;
    if (friendlyCarrier) {
      const side = unit.id % 2 === 0 ? -1 : 1;
      const behind = unit.team === 'blue' ? -1 : 1;
      return new Vector3(
        friendlyCarrier.position.x + side * (unit.kind === 'ironGuard' ? 1.45 : 1.95),
        friendlyCarrier.state === 'climbing' ? 0.16 : friendlyCarrier.position.y,
        friendlyCarrier.position.z + behind * (unit.kind === 'ironGuard' ? 1.25 : 2.05),
      );
    }

    if (this.castles.isAttackWindow(unit.team)) return this.getAttackRoutePoint(unit);
    return this.getFlagRoutePoint(unit);
  }

  private getFlagRoutePoint(unit: UnitEntity): Vector3 {
    const carrier = this.flag.currentCarrier;
    if (carrier?.navigationArea === 'playerLadder') {
      const safe = CENTRAL_TOWER.safeFlagDrops.playerBase;
      return new Vector3(safe.x, 0.16, safe.z);
    }
    if (carrier?.navigationArea === 'enemyLadder') {
      const safe = CENTRAL_TOWER.safeFlagDrops.enemyBase;
      return new Vector3(safe.x, 0.16, safe.z);
    }
    const flagPosition = this.flag.position;
    const lanePosition = laneX(unit.lane);
    const route = PORTRAIT_LAYOUT.arena.route;
    if (unit.team === 'blue' && unit.position.z < -route.flagApproachThresholdZ) {
      return new Vector3(lanePosition, unit.position.y, -route.flagApproachZ);
    }
    if (unit.team === 'red' && unit.position.z > route.flagApproachThresholdZ) {
      return new Vector3(lanePosition, unit.position.y, route.flagApproachZ);
    }
    return new Vector3(flagPosition.x, flagPosition.y, flagPosition.z);
  }

  private getReturnRoutePoint(unit: UnitEntity): Vector3 {
    const delivery = this.castles.getCastle(unit.team).deliveryPoint;
    const route = PORTRAIT_LAYOUT.arena.route;
    if (unit.team === 'blue' && unit.position.z > -route.returnMergeThresholdZ) {
      return new Vector3(laneX(unit.lane) * route.returnLaneScale, delivery.y, -route.returnMergeZ);
    }
    if (unit.team === 'red' && unit.position.z < route.returnMergeThresholdZ) {
      return new Vector3(laneX(unit.lane) * route.returnLaneScale, delivery.y, route.returnMergeZ);
    }
    return new Vector3(delivery.x, unit.position.y, delivery.z);
  }

  private getAttackRoutePoint(unit: UnitEntity): Vector3 {
    const enemyCastle = this.castles.getCastle(unit.team === 'blue' ? 'red' : 'blue');
    const route = PORTRAIT_LAYOUT.arena.route;
    if (unit.team === 'blue') {
      if (unit.kind === 'ranger') return this.castleLadders.getRangerSupportPoint(unit);
      if (unit.position.z < route.attackMergeThresholdZ) {
        return new Vector3(laneX(unit.lane) * route.attackLaneScale, enemyCastle.gatePoint.y, route.attackMergeZ);
      }
      if (unit.position.z < enemyCastle.gatePoint.z - 0.12) {
        return new Vector3(enemyCastle.gatePoint.x, enemyCastle.gatePoint.y, enemyCastle.gatePoint.z);
      }
    } else {
      if (unit.position.z > -route.attackMergeThresholdZ) {
        return new Vector3(laneX(unit.lane) * route.attackLaneScale, enemyCastle.gatePoint.y, -route.attackMergeZ);
      }
      if (unit.position.z > enemyCastle.gatePoint.z + 0.12) {
        return new Vector3(enemyCastle.gatePoint.x, enemyCastle.gatePoint.y, enemyCastle.gatePoint.z);
      }
    }
    const infiltrationZ = enemyCastle.interiorPoint.z + (unit.team === 'blue' ? route.infiltrationDepth : -route.infiltrationDepth);
    return new Vector3(enemyCastle.interiorPoint.x, enemyCastle.interiorPoint.y, infiltrationZ);
  }

  private moveUnit(unit: UnitEntity, goal: Vector3, deltaSeconds: number): boolean {
    let movementGoal = goal;
    if (unit.navigationArea === 'ground') {
      // Bridge waypoint first, then tower avoidance around it. Both return their own scratch vector,
      // and no bridge waypoint sits inside the tower footprint, so the two never fight each other.
      this.bridges.syncRegistration(unit);
      movementGoal = this.bridges.applyQueueGoal(unit, resolveCrossingGoal(unit, goal, deltaSeconds));
      movementGoal = this.resolveGroundGoal(unit, movementGoal);
    }
    let dx = movementGoal.x - unit.position.x;
    let dz = movementGoal.z - unit.position.z;
    let distance = Math.hypot(dx, dz);
    if (distance < 0.12) return false;

    dx /= distance;
    dz /= distance;

    let separationX = 0;
    let separationZ = 0;
    const separationRadiusSquared = CONFIG.unit.separationRadius ** 2;
    for (const neighbor of this.units) {
      if (
        neighbor === unit
        || !neighbor.active
        || neighbor.state === 'dead'
        || neighbor.team !== unit.team
        || neighbor.navigationArea !== unit.navigationArea
      ) continue;
      const offsetX = unit.position.x - neighbor.position.x;
      const offsetZ = unit.position.z - neighbor.position.z;
      const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;
      if (distanceSquared <= 0.0001 || distanceSquared >= separationRadiusSquared) continue;
      const inverse = 1 / Math.sqrt(distanceSquared);
      const strength = (1 - Math.sqrt(distanceSquared) / CONFIG.unit.separationRadius) * CONFIG.unit.separationStrength;
      separationX += offsetX * inverse * strength;
      separationZ += offsetZ * inverse * strength;
    }

    // On or near a bridge, separation works mainly along the bridge axis: sideways push is killed on
    // the deck and nearly killed inside the queue zone, so waiting units line up instead of fanning
    // out into horizontal walls at the bridge mouth.
    separationX *= this.bridges.separationScaleX(unit);
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
    let moved = true;
    if (unit.navigationArea === 'towerTop') {
      unit.position.x = clamp(
        unit.position.x + dx * step,
        CENTRAL_TOWER.centerX - CENTRAL_TOWER.topWalkHalfWidth,
        CENTRAL_TOWER.centerX + CENTRAL_TOWER.topWalkHalfWidth,
      );
      unit.position.z = clamp(
        unit.position.z + dz * step,
        CENTRAL_TOWER.centerZ - CENTRAL_TOWER.topWalkHalfDepth,
        CENTRAL_TOWER.centerZ + CENTRAL_TOWER.topWalkHalfDepth,
      );
      unit.position.y = CENTRAL_TOWER.topUnitY;
    } else if (unit.navigationArea === 'enemyWallTop') {
      unit.position.x = clamp(unit.position.x + dx * step, ENEMY_CASTLE_ASSAULT.wallBounds.minX, ENEMY_CASTLE_ASSAULT.wallBounds.maxX);
      unit.position.z = clamp(unit.position.z + dz * step, ENEMY_CASTLE_ASSAULT.wallBounds.minZ, ENEMY_CASTLE_ASSAULT.wallBounds.maxZ);
      unit.position.y = ENEMY_CASTLE_ASSAULT.wallTopY;
    } else {
      let nextX = clamp(unit.position.x + dx * step, -PORTRAIT_LAYOUT.arena.unitBoundsX, PORTRAIT_LAYOUT.arena.unitBoundsX);
      let nextZ = clamp(unit.position.z + dz * step, -PORTRAIT_LAYOUT.arena.unitBoundsZ, PORTRAIT_LAYOUT.arena.unitBoundsZ);
      if (unit.navigationArea === 'ground') {
        // A unit on a bridge deck stays inside its own deck's walkable span until it has cleared
        // the exit, so separation or goal seeking can never push it over a railing into the water.
        if (unit.bridgeState === 'entering' || unit.bridgeState === 'crossing' || unit.bridgeState === 'exiting') {
          const route = unit.riverRoute;
          if (route) {
            const bridge = ARENA_RIVERS[route.channelIndex].bridges[route.bridgeIndex];
            nextX = clamp(nextX, bridge.walkMinX + unit.bodyRadius, bridge.walkMaxX - unit.bodyRadius);
          }
        }
        // Goal seeking, separation and the arena clamp are all already folded into this one step, so
        // rejecting it here is enough to keep every one of them out of the water.
        moved = applyGroundStep(unit, nextX, nextZ);
      } else {
        unit.position.x = nextX;
        unit.position.z = nextZ;
      }
    }
    this.facingScratch.set(unit.position.x + dx, unit.position.y, unit.position.z + dz);
    this.faceUnit(unit, this.facingScratch, deltaSeconds);
    return moved;
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
      if (
        !candidate.active
        || candidate.state === 'dead'
        || candidate.team !== target.team
        || candidate.kind !== 'ironGuard'
        || candidate.navigationArea !== target.navigationArea
      ) continue;
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
    this.bridges.release(unit);
    if (unit.carryingFlag) this.flag.dropFrom(unit);
    this.ladders.remove(unit, true);
    this.castleLadders.remove(unit, true);
    this.audio.play('death');
  }

  private canAttackTarget(unit: UnitEntity, target: UnitEntity): boolean {
    if (this.castleLadders.canEngage(unit, target)) return true;
    if (unit.navigationArea !== target.navigationArea) return false;
    if (unit.navigationArea !== 'ground' && unit.navigationArea !== 'towerTop') return false;
    return unit.navigationArea === 'towerTop' || !this.segmentCrossesTower(unit.position, target.position, 0.18);
  }

  private resolveGroundGoal(unit: UnitEntity, goal: Vector3): Vector3 {
    if (!this.segmentCrossesTower(unit.position, goal, 0.72)) return goal;
    const clearanceX = CENTRAL_TOWER.baseWidth / 2 + 0.82;
    const clearanceZ = CENTRAL_TOWER.baseDepth / 2 + 0.78;
    const side = unit.lane === 'left' ? -1 : unit.lane === 'right' ? 1 : unit.id % 2 === 0 ? -1 : 1;
    const sideX = CENTRAL_TOWER.centerX + side * clearanceX;
    const goalSideZ = CENTRAL_TOWER.centerZ + (goal.z < CENTRAL_TOWER.centerZ ? -1 : 1) * clearanceZ;

    if (Math.abs(unit.position.x - CENTRAL_TOWER.centerX) < clearanceX - 0.16) {
      const currentSideZ = CENTRAL_TOWER.centerZ
        + (unit.position.z < CENTRAL_TOWER.centerZ ? -1 : 1) * clearanceZ;
      this.movementScratch.set(sideX, unit.position.y, currentSideZ);
    } else {
      this.movementScratch.set(sideX, unit.position.y, goalSideZ);
    }
    return this.movementScratch;
  }

  private segmentCrossesTower(start: Vector3, end: Vector3, padding: number): boolean {
    const minX = CENTRAL_TOWER.centerX - CENTRAL_TOWER.baseWidth / 2 - padding;
    const maxX = CENTRAL_TOWER.centerX + CENTRAL_TOWER.baseWidth / 2 + padding;
    const minZ = CENTRAL_TOWER.centerZ - CENTRAL_TOWER.baseDepth / 2 - padding;
    const maxZ = CENTRAL_TOWER.centerZ + CENTRAL_TOWER.baseDepth / 2 + padding;
    let startT = 0;
    let endT = 1;
    const dx = end.x - start.x;
    const dz = end.z - start.z;

    const clip = (direction: number, offset: number): boolean => {
      if (Math.abs(direction) < 0.00001) return offset >= 0;
      const ratio = offset / direction;
      if (direction > 0) endT = Math.min(endT, ratio);
      else startT = Math.max(startT, ratio);
      return startT <= endT;
    };

    return clip(-dx, start.x - minX)
      && clip(dx, maxX - start.x)
      && clip(-dz, start.z - minZ)
      && clip(dz, maxZ - start.z);
  }
}
