import { Vector3 } from '@babylonjs/core';
import { CONFIG, UNIT_STATS } from '../core/config';
import { laneFromX, laneX, randomRange } from '../core/math';
import type { Lane, UnitKind } from '../core/types';
import { CastleLogic } from './castleLogic';
import { EnergyModel } from './energy';
import { FlagController } from './flag';
import { UnitManager } from './unitManager';

export class EnemyAI {
  private thinkTimer = 0.75;

  constructor(
    private readonly energy: EnergyModel,
    private readonly units: UnitManager,
    private readonly flag: FlagController,
    private readonly castles: CastleLogic,
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

    if (this.castles.isAttackWindow('red')) {
      if (roll < 0.52) return 'raider';
      if (roll < 0.72) return 'ironGuard';
      if (roll < 0.88) return 'vanguard';
      return 'ranger';
    }

    if (playerHasFlag) {
      if (roll < 0.4) return 'ranger';
      if (roll < 0.76) return 'vanguard';
      return roll < 0.9 ? 'raider' : 'ironGuard';
    }

    if (aiHasFlag) {
      if (!this.units.hasActiveKind('red', 'ironGuard') && roll < 0.58) return 'ironGuard';
      return roll < 0.72 ? 'vanguard' : 'ranger';
    }

    if (!this.units.hasActiveKind('red', 'raider') && roll < 0.38) return 'raider';
    if (roll < 0.35) return 'vanguard';
    if (roll < 0.62) return 'ranger';
    if (roll < 0.82) return 'raider';
    return 'ironGuard';
  }

  private chooseAffordable(preferred: UnitKind): UnitKind | null {
    if (this.energy.canSpend(UNIT_STATS[preferred].cost)) return preferred;
    const affordable = (['raider', 'vanguard', 'ranger', 'ironGuard'] as const)
      .filter((kind) => this.energy.canSpend(UNIT_STATS[kind].cost));
    if (affordable.length === 0) return null;
    return affordable[Math.floor(Math.random() * affordable.length)] ?? null;
  }

  private chooseLane(kind: UnitKind): Lane {
    if (kind === 'raider' && this.flag.currentStatus === 'dropped') return laneFromX(this.flag.position.x);
    const activeWindow = this.castles.isAttackWindow('red');
    if (activeWindow && Math.random() < 0.55) return 'center';
    const roll = Math.random();
    return roll < 0.33 ? 'left' : roll < 0.66 ? 'center' : 'right';
  }
}
