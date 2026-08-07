import { AbstractMesh, Vector3 } from '@babylonjs/core';
import { AudioManager } from '../audio/audioManager';
import { CONFIG, PORTRAIT_LAYOUT, UNIT_STATS } from '../core/config';
import { laneFromX } from '../core/math';
import type { CastleState, Team, UnitKind } from '../core/types';
import type { ArenaScene } from '../render/arena';
import { VanguardModelLibrary } from '../render/vanguardModel';
import type { SiegeHudState } from '../ui/gameUI';
import { GameUI } from '../ui/gameUI';
import { CastleLogic } from './castleLogic';
import { EffectPool } from './effects';
import { EnemyAI } from './enemyAI';
import { EnergyModel } from './energy';
import { FlagController } from './flag';
import { MatchFlow } from './matchFlow';
import { ProjectilePool } from './projectiles';
import { UnitManager } from './unitManager';

export class GameController {
  private readonly matchFlow = new MatchFlow();
  private readonly playerEnergy = new EnergyModel();
  private readonly enemyEnergy = new EnergyModel();
  private readonly effects: EffectPool;
  private readonly castles: CastleLogic;
  private readonly flag: FlagController;
  private readonly projectiles: ProjectilePool;
  private readonly units: UnitManager;
  private readonly ai: EnemyAI;
  private selectedKind: UnitKind | null = null;
  private lastFlagDeliveredBy: Team | null = null;
  private started = false;
  private ended = false;
  private elapsed = 0;
  private matchTime: number = CONFIG.match.durationSeconds;
  private overtime = false;
  private hudClock = 0;
  private cameraKick = 0;
  private cameraPush = 0;
  /** Rate limiters for the stage-2 structural smoke plumes, one per castle. */
  private blueSmokeClock = 0;
  private redSmokeClock = 0;

  constructor(
    private readonly arena: ArenaScene,
    private readonly canvas: HTMLCanvasElement,
    private readonly ui: GameUI,
    private readonly audio: AudioManager,
    private readonly vanguardModels: VanguardModelLibrary,
  ) {
    this.effects = new EffectPool(arena.scene, arena.materials);
    this.flag = new FlagController(
      arena.scene,
      arena.materials,
      (team) => this.handleFlagPickup(team),
      (team) => this.handleFlagDelivered(team),
      () => this.ui.showBanner('FLAG DROPPED — RECOVER IT', 'neutral'),
    );
    this.castles = new CastleLogic(
      arena.blueCastle,
      arena.redCastle,
      this.flag,
      this.matchFlow,
      (castleTeam) => this.handleGateOpened(castleTeam),
      (castleTeam) => this.handleGateClosed(castleTeam),
      (attacker, defender) => this.handleBreach(attacker, defender),
      (winner) => this.finishMatch(winner),
    );

    let unitManager: UnitManager | null = null;
    this.projectiles = new ProjectilePool(arena.scene, arena.materials, (target, damage, attacker) => {
      unitManager?.applyDamage(target, damage, attacker);
    });
    unitManager = new UnitManager(
      arena.scene,
      arena.materials,
      arena.shadowGenerator,
      this.effects,
      this.flag,
      this.castles,
      this.matchFlow,
      this.projectiles,
      this.audio,
      this.vanguardModels,
    );
    this.units = unitManager;
    this.ai = new EnemyAI(this.enemyEnergy, this.units, this.flag, this.castles, this.matchFlow);

    this.ui.onCardSelect = (kind) => this.selectCard(kind);
    this.bindInput();
    this.updateHud();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.audio.unlock();
    this.ui.hideLoading();
    this.ui.showBanner('SELECT A CARD, THEN TAP YOUR BLUE ZONE', 'neutral', 2.8);
  }

  update(deltaSeconds: number): void {
    if (!this.started || this.ended) return;
    const delta = Math.min(0.05, deltaSeconds);
    this.elapsed += delta;

    if (!this.overtime) {
      this.matchTime = Math.max(0, this.matchTime - delta);
      if (this.matchTime <= 0) {
        this.overtime = true;
        this.ui.showBanner('OVERTIME — ENERGY REGEN BOOSTED', 'danger', 2.5);
      }
    }

    this.playerEnergy.update(delta, this.overtime);
    this.enemyEnergy.update(delta, this.overtime);
    this.ai.update(delta);
    this.units.update(delta, this.elapsed);
    this.projectiles.update(delta);
    this.effects.update(delta);
    this.flag.update(delta, this.elapsed);
    this.castles.update(delta, this.elapsed);
    this.updateCastleHealth(delta);
    this.updateCamera(delta);

    this.hudClock -= delta;
    if (this.hudClock <= 0) {
      this.hudClock = 0.1;
      this.updateHud();
    }
  }

  dispose(): void {
    this.projectiles.dispose();
    this.units.dispose();
    this.vanguardModels.dispose();
    this.audio.dispose();
    this.ui.disposeMeters();
  }

  private bindInput(): void {
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.tryDeployFromPointer(event);
    }, { passive: false });
    this.canvas.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse' && this.selectedKind) this.updateDeployMarker(event);
    });
    this.canvas.addEventListener('pointerleave', () => this.arena.deployMarker.setEnabled(false));
  }

  private selectCard(kind: UnitKind): void {
    if (!this.started || this.ended) return;
    if (this.castles.isDeploymentLocked('blue')) {
      this.ui.showDeployFeedback('CASTLE BREACHED — DEPLOYMENT PERMANENTLY LOCKED', false);
      return;
    }
    if (!this.playerEnergy.canSpend(UNIT_STATS[kind].cost)) {
      this.ui.showDeployFeedback('NOT ENOUGH ENERGY', false);
      return;
    }
    this.selectedKind = this.selectedKind === kind ? null : kind;
    this.updateHud();
    this.arena.deployMarker.setEnabled(false);
  }

  private tryDeployFromPointer(event: PointerEvent): void {
    if (!this.started || this.ended || !this.selectedKind) return;
    const point = this.pickGround(event);
    if (!point) {
      this.arena.deployMarker.setEnabled(false);
      this.ui.showDeployFeedback('TAP THE BLUE DEPLOYMENT ZONE', false);
      return;
    }
    const valid = this.isValidPlayerDeployment(point);
    if (!valid) {
      this.ui.showDeployFeedback('DEPLOY INSIDE THE BLUE ZONE', false);
      this.pulseMarker(point, false);
      return;
    }

    const kind = this.selectedKind;
    const cost = UNIT_STATS[kind].cost;
    if (!this.playerEnergy.canSpend(cost)) {
      this.ui.showDeployFeedback('NOT ENOUGH ENERGY', false);
      return;
    }
    if (this.castles.isDeploymentLocked('blue')) {
      this.ui.showDeployFeedback('DEPLOYMENT LOCKED', false);
      return;
    }

    const spawnPosition = new Vector3(point.x, 0.16, point.z);
    const spawned = this.units.spawn('blue', kind, spawnPosition, laneFromX(point.x));
    if (!spawned) {
      this.ui.showDeployFeedback('UNIT LIMIT REACHED', false);
      return;
    }
    this.playerEnergy.spend(cost);
    this.selectedKind = null;
    this.arena.deployMarker.setEnabled(false);
    this.updateHud();
  }

  private updateDeployMarker(event: PointerEvent): void {
    if (!this.started || this.ended || !this.selectedKind) {
      this.arena.deployMarker.setEnabled(false);
      return;
    }
    const point = this.pickGround(event);
    if (!point) {
      this.arena.deployMarker.setEnabled(false);
      return;
    }
    this.pulseMarker(point, this.isValidPlayerDeployment(point));
  }

  private pulseMarker(point: Vector3, valid: boolean): void {
    this.arena.deployMarker.position.set(point.x, 0.2, point.z);
    this.arena.deployMarker.material = valid ? this.arena.materials.glowBlue : this.arena.materials.glowRed;
    this.arena.deployMarker.setEnabled(true);
  }

  private pickGround(event: PointerEvent): Vector3 | null {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const localX = event.clientX - bounds.left;
    const localY = event.clientY - bounds.top;
    if (localX < 0 || localY < 0 || localX > bounds.width || localY > bounds.height) return null;

    // scene.pick expects CSS pixels relative to the canvas; it divides by the hardware
    // scaling level itself, so pre-converting to render-buffer pixels would scale twice.
    const pick = this.arena.scene.pick(
      localX,
      localY,
      (mesh: AbstractMesh) => mesh.name === 'arena-ground' || mesh.name.startsWith('deployment-zone'),
      false,
      this.arena.camera,
    );
    return pick?.hit && pick.pickedPoint ? pick.pickedPoint : null;
  }

  private isValidPlayerDeployment(point: Vector3): boolean {
    const deployHalfWidth = PORTRAIT_LAYOUT.arena.deploymentWidth / 2;
    return point.x >= -deployHalfWidth
      && point.x <= deployHalfWidth
      && point.z >= CONFIG.arena.blueDeployMinZ
      && point.z <= CONFIG.arena.blueDeployMaxZ;
  }

  private handleFlagPickup(team: Team): void {
    this.audio.play('flag');
    this.cameraPush = Math.max(this.cameraPush, 0.9);
    this.ui.showBanner(team === 'blue' ? 'FLAG CAPTURED — ESCORT THE CARRIER' : 'ENEMY STOLE THE FLAG', team === 'blue' ? 'success' : 'danger');
  }

  private handleFlagDelivered(team: Team): void {
    this.audio.play('flag');
    if (!this.matchFlow.enterCastleAssault(team)) return;
    this.lastFlagDeliveredBy = team;
    this.units.beginCastleAssault(team);
    this.ui.showBanner(team === 'blue' ? 'FLAG SECURED — ASSAULT THE ENEMY CASTLE' : 'ENEMY FLAG SECURED — DEFEND NOW', team === 'blue' ? 'success' : 'danger', 2.4);
    this.updateHud();
  }

  private handleGateOpened(castleTeam: Team): void {
    this.audio.play('gate');
    this.cameraKick = Math.max(this.cameraKick, 0.85);
    this.cameraPush = Math.max(this.cameraPush, 0.85);
    if (castleTeam === 'blue') this.ui.showBanner('BLUE GATE OPEN — CARRIER RETURNING', 'success');
    else this.ui.showBanner('RED GATE OPEN — ENEMY CARRIER RETURNING', 'danger');
  }

  private handleGateClosed(_castleTeam: Team): void {
    this.audio.play('gateClose');
  }

  private handleBreach(attacker: Team, defender: Team): void {
    this.audio.play('breach');
    this.cameraKick = 1.7;
    this.cameraPush = Math.max(this.cameraPush, 1);
    if (defender === 'blue') this.selectedKind = null;
    this.ui.showBanner(
      attacker === 'blue' ? 'CASTLE BREACHED — CHECKMATE COUNTDOWN' : 'YOUR CASTLE IS BREACHED — DEPLOYMENT LOCKED',
      attacker === 'blue' ? 'success' : 'danger',
      CONFIG.match.breachCountdownSeconds,
    );
    this.updateHud();
  }

  private finishMatch(winner: Team): void {
    if (this.ended) return;
    this.ended = true;
    this.matchFlow.finish();
    this.selectedKind = null;
    this.arena.deployMarker.setEnabled(false);
    this.audio.play(winner === 'blue' ? 'victory' : 'defeat');
    this.ui.showEnd(winner);
    this.updateHud();
  }

  private updateCastleHealth(deltaSeconds: number): void {
    const playerHealth = this.castles.getHealth('blue');
    const enemyHealth = this.castles.getHealth('red');

    this.updateGateStage('blue', deltaSeconds);
    this.updateGateStage('red', deltaSeconds);

    this.arena.blueCastle.setDamageStage(playerHealth.stage);
    this.arena.redCastle.setDamageStage(enemyHealth.stage);

    if (enemyHealth.destroyed) {
      this.arena.redCastle.triggerDestruction();
      this.arena.redCastle.updateDestruction(deltaSeconds, enemyHealth.destructionProgress);
    }
    if (playerHealth.destroyed) {
      this.arena.blueCastle.triggerDestruction();
      this.arena.blueCastle.updateDestruction(deltaSeconds, playerHealth.destructionProgress);
    }

    for (const reaction of enemyHealth.hitReactions) {
      if (reaction.age < 0.05) {
        this.effects.castleHit(new Vector3(reaction.x, reaction.y, reaction.z));
        this.ui.pulseSiegeHit('enemy', reaction.strong);
      }
    }
    for (const reaction of playerHealth.hitReactions) {
      if (reaction.age < 0.05) {
        this.effects.castleHit(new Vector3(reaction.x, reaction.y, reaction.z));
        this.ui.pulseSiegeHit('player', reaction.strong);
      }
    }

    this.arena.blueCastle.applyShake(playerHealth.shakeIntensity);
    this.arena.redCastle.applyShake(enemyHealth.shakeIntensity);

    // Stage-2 structural smoke: the plume thickens and darkens as the castle degrades. Pooled and
    // rate-limited, so a long assault never accumulates particles.
    this.updateCastleSmoke('blue', deltaSeconds);
    this.updateCastleSmoke('red', deltaSeconds);

    if (enemyHealth.destroyed && enemyHealth.destructionProgress > 0.4 && enemyHealth.destructionProgress < 0.45) {
      this.effects.castleDebris(this.arena.redCastle.gatePoint);
    }
    if (playerHealth.destroyed && playerHealth.destructionProgress > 0.4 && playerHealth.destructionProgress < 0.45) {
      this.effects.castleDebris(this.arena.blueCastle.gatePoint);
    }
  }

  /**
   * Stage-1 presentation for one castle's gate: progressive wear on the mesh, the escalating impact
   * ladder, the restrained critical tick, and the one-shot breach sequence. All feedback is local to
   * the gate node, the HUD and the pooled effects — updateCamera is never involved.
   */
  private updateGateStage(team: Team, deltaSeconds: number): void {
    const gate = this.castles.getGateHealth(team);
    const castle = this.castles.getCastle(team);
    const side = team === 'blue' ? 'player' : 'enemy';

    castle.setGateDamageStage(gate.stage);

    for (const reaction of gate.hitReactions) {
      if (reaction.handled) continue;
      reaction.handled = true;
      const point = new Vector3(reaction.x, reaction.y, reaction.z);
      this.effects.gateHit(point, reaction.strong);
      castle.applyGateHitShake(reaction.strong ? 0.85 : 0.45);
      this.audio.play(
        reaction.tier === 'heavy' ? 'gateImpactHeavy'
          : reaction.tier === 'mid' ? 'gateImpactMid'
            : 'gateImpactLight',
      );
      this.ui.pulseSiegeHit(side, reaction.strong);
    }

    if (gate.consumeCriticalTick()) this.audio.play('gateCritical');

    if (gate.consumeBreachAnnouncement()) {
      castle.beginGateBreach();
      this.effects.gateBreachBurst(new Vector3(castle.gatePoint.x, castle.gatePoint.y + 2.2, castle.gatePoint.z));
      this.audio.play('gateBreach');
      this.ui.announceGateBreach(side);
    }
    if (gate.destroyed) {
      castle.updateGateBreach(gate.breachProgress);
      // One deep landing impact as the timber settles near the end of the collapse: a single
      // dust/splinter burst on the frame it crosses the threshold, never a loop.
      const landing = CONFIG.gate.breachSequenceSeconds * 0.82;
      if (gate.breachTimer >= landing && gate.breachTimer - deltaSeconds < landing) {
        this.effects.gateBreachBurst(new Vector3(castle.gatePoint.x, castle.gatePoint.y + 0.9, castle.gatePoint.z));
        this.audio.play('gateImpactHeavy');
      }
    }
  }

  /** Rate-limited stage-2 smoke: only once the gate is down and the castle is visibly damaged. */
  private updateCastleSmoke(team: Team, deltaSeconds: number): void {
    if (this.castles.isGateStage(team)) return;
    const health = this.castles.getHealth(team);
    if (health.destroyed) return;
    const stage = health.stage;
    if (stage === 'intact') return;
    const interval = stage === 'heavy' ? 0.55 : stage === 'moderate' ? 0.9 : 1.6;
    const clock = team === 'blue' ? 'blueSmokeClock' : 'redSmokeClock';
    this[clock] -= deltaSeconds;
    if (this[clock] > 0) return;
    this[clock] = interval;
    const castle = this.castles.getCastle(team);
    this.effects.castleSmoke(
      new Vector3(castle.gatePoint.x, castle.gatePoint.y + 5.4, castle.gatePoint.z - 1.6 * (team === 'blue' ? 1 : -1)),
      stage === 'heavy',
    );
  }

  private castleStateFor(team: Team): CastleState {
    if (this.castles.getBreachedTeam() === team) return 'breached';
    return this.castles.isGateOpen(team) ? 'open' : 'secure';
  }

  /**
   * Reading for the single shared siege bar. Stage 1 exposes the gate pool; the moment the gate is
   * destroyed the same bar starts reporting the castle pool instead. The two are never mixed.
   */
  private siegeStateFor(team: Team): SiegeHudState {
    const gate = this.castles.getGateHealth(team);
    if (!gate.destroyed) {
      return {
        stage: 'gate',
        hp: gate.hp,
        maxHp: gate.maxHp,
        ratio: gate.ratio,
        warning: gate.warning,
        critical: gate.critical,
        shake: gate.hudShake,
      };
    }
    const health = this.castles.getHealth(team);
    const ratio = health.ratio;
    return {
      stage: 'castle',
      hp: health.hp,
      maxHp: health.maxHp,
      ratio,
      warning: !health.destroyed && ratio <= CONFIG.gate.warningRatio,
      critical: !health.destroyed && ratio <= CONFIG.gate.criticalRatio,
      shake: health.shakeIntensity * 0.6,
    };
  }

  private castleThreatCountdown(team: Team): number {
    return this.castles.getBreachedTeam() === team
      ? this.castles.getBreachCountdown()
      : this.castles.getGateOpenRemaining(team);
  }

  private updateHud(): void {
    // A delivered flag is permanently secured in the delivering team's own castle and never
    // returns to the field.
    const flagSecuredAt: Team | null = this.flag.currentStatus === 'consumed'
      ? this.lastFlagDeliveredBy
      : null;
    this.ui.update({
      playerEnergy: this.playerEnergy.value,
      enemyEnergy: this.enemyEnergy.value,
      timeRemaining: this.matchTime,
      overtime: this.overtime,
      flagStatus: this.flag.currentStatus,
      flagCarrier: this.flag.currentCarrier?.team ?? null,
      blueGateTime: 0,
      redGateTime: 0,
      breachedTeam: this.castles.getBreachedTeam(),
      breachCountdown: this.castles.getBreachCountdown(),
      selectedKind: this.selectedKind,
      playerLocked: this.castles.isDeploymentLocked('blue'),
      playerSiege: this.siegeStateFor('blue'),
      playerCastleState: this.castleStateFor('blue'),
      playerCastleCountdown: this.castleThreatCountdown('blue'),
      playerFlagSecured: flagSecuredAt === 'blue',
      enemySiege: this.siegeStateFor('red'),
      enemyCastleState: this.castleStateFor('red'),
      enemyCastleCountdown: this.castleThreatCountdown('red'),
      enemyFlagSecured: flagSecuredAt === 'red',
    });
  }

  private updateCamera(deltaSeconds: number): void {
    if (this.cameraKick <= 0 && this.cameraPush <= 0) {
      this.arena.camera.position.copyFrom(this.arena.cameraRestingPosition);
      return;
    }
    this.cameraKick = Math.max(0, this.cameraKick - deltaSeconds * 1.4);
    this.cameraPush = Math.max(0, this.cameraPush - deltaSeconds * 1.8);
    const intensity = this.cameraKick * 0.14;
    // Brief ease-in/ease-out dolly along the fixed view axis: no re-aiming, no tracking.
    const push = Math.sin(this.cameraPush * Math.PI) * PORTRAIT_LAYOUT.camera.emphasisPush;
    const resting = this.arena.cameraRestingPosition;
    const forward = this.arena.cameraForward;
    this.arena.camera.position.set(
      resting.x + forward.x * push + Math.sin(this.elapsed * 31) * intensity,
      resting.y + forward.y * push + Math.cos(this.elapsed * 24) * intensity * 0.55,
      resting.z + forward.z * push + Math.sin(this.elapsed * 27) * intensity * 0.45,
    );
  }
}
