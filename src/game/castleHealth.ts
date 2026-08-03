import { CONFIG } from '../core/config';

/**
 * Display-only castle integrity for the health HUD. Purely cosmetic — no gameplay system reads
 * these values, and match outcome is still decided entirely by the breach countdown in
 * CastleLogic. The two derived rules keep the bar honest without adding mechanics:
 *
 *  - While the enemy gate is open (underAssault) the castle chips slowly, but assault pressure
 *    alone can never take it below the assault floor.
 *  - A breach drains the remaining integrity to zero exactly as the victory countdown expires,
 *    so the bar bottoms out at the same moment the match actually ends.
 */
export class CastleHealthModel {
  hp: number;
  readonly maxHp: number;

  constructor(maxHp: number = CONFIG.hud.castleIntegrityMax) {
    this.maxHp = maxHp;
    this.hp = maxHp;
  }

  get ratio(): number {
    return this.hp / this.maxHp;
  }

  update(deltaSeconds: number, underAssault: boolean, breached: boolean, breachCountdownSeconds: number): void {
    if (breached) {
      const drained = Math.min(this.hp, this.maxHp * (breachCountdownSeconds / CONFIG.match.breachCountdownSeconds));
      this.hp = Math.max(0, drained);
      return;
    }
    if (!underAssault) return;
    const floor = this.maxHp * CONFIG.hud.castleAssaultFloorRatio;
    this.hp = Math.max(floor, this.hp - this.maxHp * CONFIG.hud.castleAssaultDrainPerSecond * deltaSeconds);
  }
}
