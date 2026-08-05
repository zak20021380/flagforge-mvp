import { CONFIG } from '../core/config';

/**
 * Progressive gate damage read, driven purely by the gate's own HP ratio:
 *   intact     - untouched timber
 *   scratched  - light scratches and shallow gouges
 *   cracked    - deeper cracks running down the planks
 *   broken     - broken planks and bent metal bands
 *   unstable   - sagging, near-destruction state
 *   destroyed  - breached; the gate never takes damage again
 */
export type GateDamageStage = 'intact' | 'scratched' | 'cracked' | 'broken' | 'unstable' | 'destroyed';

/** Loudness tier for the impact ladder: hits get heavier as the gate weakens. */
export type GateImpactTier = 'light' | 'mid' | 'heavy';

export interface GateHitReaction {
  x: number;
  y: number;
  z: number;
  strong: boolean;
  tier: GateImpactTier;
  age: number;
  /** Set by the consumer once its one-shot cues have fired, so a hit never plays twice. */
  handled: boolean;
}

/**
 * Authoritative gate HP. This is a completely separate pool from CastleHealthModel: stage 1 of the
 * siege spends this one down while the castle is immune, and once it hits zero it latches destroyed
 * so no further gate damage can ever be applied.
 */
export class GateHealthModel {
  hp: number;
  readonly maxHp: number;
  stage: GateDamageStage = 'intact';
  destroyed = false;
  /** Seconds since the breach started; drives the prepared-piece collapse. */
  breachTimer = 0;
  readonly hitReactions: GateHitReaction[] = [];
  /** HUD-only shake budget. Deliberately never routed to the camera. */
  hudShake = 0;
  private criticalClock = 0;
  private criticalTickPending = false;
  private breachAnnounced = false;

  constructor(maxHp: number = CONFIG.gate.maxHp) {
    this.maxHp = maxHp;
    this.hp = maxHp;
  }

  get ratio(): number {
    return this.hp / this.maxHp;
  }

  get warning(): boolean {
    return !this.destroyed && this.ratio <= CONFIG.gate.warningRatio;
  }

  get critical(): boolean {
    return !this.destroyed && this.ratio <= CONFIG.gate.criticalRatio;
  }

  /** 0..1 progress through the short breach collapse, 1 once it has finished playing. */
  get breachProgress(): number {
    if (!this.destroyed) return 0;
    return Math.min(1, this.breachTimer / CONFIG.gate.breachSequenceSeconds);
  }

  /** Impact tier for the current HP band, used for the escalating hit sounds. */
  get impactTier(): GateImpactTier {
    if (this.ratio <= CONFIG.gate.criticalRatio) return 'heavy';
    if (this.ratio <= CONFIG.gate.warningRatio) return 'mid';
    return 'light';
  }

  /**
   * Spends gate HP. Returns false when the gate is already destroyed so the caller can fall through
   * to castle damage — a single hit therefore only ever lands on one of the two pools.
   */
  applyDamage(amount: number, hitX: number, hitY: number, hitZ: number, strong: boolean): boolean {
    if (this.destroyed) return false;
    const tier = this.impactTier;
    this.hp = Math.max(0, this.hp - amount);
    this.updateStage();
    if (this.hitReactions.length < 6) {
      this.hitReactions.push({ x: hitX, y: hitY, z: hitZ, strong, tier, age: 0, handled: false });
    }
    // Strong hits are allowed a small HUD nudge only; the camera is never touched.
    if (strong) this.hudShake = Math.min(1, this.hudShake + 0.4);
    else this.hudShake = Math.min(1, this.hudShake + 0.16);
    if (this.hp <= 0) this.triggerBreach();
    return true;
  }

  update(deltaSeconds: number): void {
    this.hudShake = Math.max(0, this.hudShake - deltaSeconds * 3.4);
    for (let i = this.hitReactions.length - 1; i >= 0; i -= 1) {
      this.hitReactions[i].age += deltaSeconds;
      if (this.hitReactions[i].age > 0.4) this.hitReactions.splice(i, 1);
    }
    if (this.destroyed) {
      this.breachTimer += deltaSeconds;
      this.criticalClock = 0;
      return;
    }
    // Restrained critical rhythm: one soft tick per interval, never a continuous alarm.
    if (this.critical) {
      this.criticalClock += deltaSeconds;
      if (this.criticalClock >= CONFIG.gate.criticalTickSeconds) {
        this.criticalClock = 0;
        this.criticalTickPending = true;
      }
    } else {
      this.criticalClock = 0;
      this.criticalTickPending = false;
    }
  }

  /** True once per critical interval; the caller plays the tick and the flag clears. */
  consumeCriticalTick(): boolean {
    if (!this.criticalTickPending) return false;
    this.criticalTickPending = false;
    return true;
  }

  /** True exactly once, on the frame the gate falls, so the breach sequence fires a single time. */
  consumeBreachAnnouncement(): boolean {
    if (!this.destroyed || this.breachAnnounced) return false;
    this.breachAnnounced = true;
    return true;
  }

  private triggerBreach(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.hp = 0;
    this.stage = 'destroyed';
    this.breachTimer = 0;
    this.criticalTickPending = false;
  }

  private updateStage(): void {
    const r = this.ratio;
    if (r > 0.78) this.stage = 'intact';
    else if (r > 0.55) this.stage = 'scratched';
    else if (r > 0.32) this.stage = 'cracked';
    else if (r > 0.12) this.stage = 'broken';
    else if (r > 0) this.stage = 'unstable';
    else this.stage = 'destroyed';
  }
}
