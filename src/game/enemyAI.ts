import { Vector3 } from '@babylonjs/core';
import { CONFIG, UNIT_STATS } from '../core/config';
import { laneFromX, laneX, oppositeTeam, randomRange } from '../core/math';
import type { Lane, Team, UnitKind } from '../core/types';
import { CastleLogic } from './castleLogic';
import { EnergyModel } from './energy';
import { FlagController } from './flag';
import { MatchFlow } from './matchFlow';
import { UnitManager } from './unitManager';

export class EnemyAI {
  private thinkTimer = 0.75;

  constructor(
    private readonly energy: EnergyModel,
    private readonly units: UnitManager,
    private readonly flag: FlagController,
    private readonly castles: CastleLogic,
    private readonly matchFlow: MatchFlow,
  ) {}

  update(deltaSeconds: number): void {
    if (this.castles.isDeploymentLocked('red') || this.castles.getWinner()) return;
    this.thinkTimer -= deltaSeconds;
    if (this.thinkTimer > 0) return;
    this.thinkTimer = randomRange(CONFIG.ai.thinkMin, CONFIG.ai.thinkMax);
    if (this.units.countActive('red') >= 12) return;

    const preferred = this.chooseUnit();
    const kind = this.chooseAffordable(preferred);
    if (!kind) return;

    const lane = this.chooseLane(kind);
    const x = laneX(lane) + randomRange(-1.2, 1.2);
    const z = randomRange(CONFIG.arena.redDeployMinZ, CONFIG.arena.redDeployMaxZ);
    const cost = UNIT_STATS[kind].cost;
    if (!this.energy.spend(cost)) return;
    const spawned = this.units.spawn('red', kind, new Vector3(x, 0.16, z), laneFromX(x));
    if (!spawned) this.energy.value = Math.min(CONFIG.energy.maximum, this.energy.value + cost);
  }

  private chooseUnit(): UnitKind {
    const roll = Math.random();
    const playerHasFlag = this.flag.currentCarrier?.team === 'blue';
    const aiHasFlag = this.flag.currentCarrier?.team === 'red';

    if (this.canAssaultCastle('red')) {
      // Siege window: FUSE carries the structure damage, VEX still slips through, BRAX escorts.
      if (roll < 0.38) return 'fuse';
      if (roll < 0.68) return 'vex';
      if (roll < 0.88) return 'brax';
      return 'nyx';
    }

    if (playerHasFlag) {
      if (roll < 0.4) return 'nyx';
      if (roll < 0.76) return 'brax';
      return roll < 0.9 ? 'vex' : 'fuse';
    }

    if (aiHasFlag) {
      // Escorting its own carrier: keep a BRAX bodyguard alive (UnitManager.findNearbyGuard reads
      // BRAX as the damage-reducing guard), then screen with a runner or a marksman.
      if (!this.units.hasActiveKind('red', 'brax') && roll < 0.58) return 'brax';
      return roll < 0.72 ? 'vex' : 'nyx';
    }

    if (!this.units.hasActiveKind('red', 'vex') && roll < 0.38) return 'vex';
    if (roll < 0.35) return 'brax';
    if (roll < 0.62) return 'nyx';
    if (roll < 0.82) return 'vex';
    return 'fuse';
  }

  private chooseAffordable(preferred: UnitKind): UnitKind | null {
    if (this.energy.canSpend(UNIT_STATS[preferred].cost)) return preferred;
    const affordable = (['vex', 'brax', 'nyx', 'fuse'] as const)
      .filter((kind) => this.energy.canSpend(UNIT_STATS[kind].cost));
    if (affordable.length === 0) return null;
    return affordable[Math.floor(Math.random() * affordable.length)] ?? null;
  }

  private chooseLane(kind: UnitKind): Lane {
    if (kind === 'vex' && this.flag.currentStatus === 'dropped') return laneFromX(this.flag.position.x);
    const activeWindow = this.canAssaultCastle('red');
    if (activeWindow && Math.random() < 0.55) return 'center';
    const roll = Math.random();
    return roll < 0.33 ? 'left' : roll < 0.66 ? 'center' : 'right';
  }

  /**
   * Phase gate for castle assault, read from the match flow: red may only assault after it has
   * delivered the flag and the match has entered the permanent CASTLE_ASSAULT phase.
   */
  private canAssaultCastle(team: Team): boolean {
    if (!this.matchFlow.isAssaulting(team)) return false;
    if (this.castles.getHealth(oppositeTeam(team)).destroyed) return false;
    return true;
  }
}
