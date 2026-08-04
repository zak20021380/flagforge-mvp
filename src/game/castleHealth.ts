import { CONFIG } from '../core/config';

export type CastleDamageStage = 'intact' | 'light' | 'moderate' | 'heavy' | 'destroyed';

export interface CastleHitReaction {
  x: number;
  y: number;
  z: number;
  strong: boolean;
  age: number;
}

export class CastleHealthModel {
  hp: number;
  readonly maxHp: number;
  stage: CastleDamageStage = 'intact';
  destroyed = false;
  destructionTimer = 0;
  readonly hitReactions: CastleHitReaction[] = [];
  shakeIntensity = 0;

  constructor(maxHp: number = CONFIG.castle.maxHp) {
    this.maxHp = maxHp;
    this.hp = maxHp;
  }

  get ratio(): number {
    return this.hp / this.maxHp;
  }

  applyDamage(amount: number, hitX: number, hitY: number, hitZ: number, strong: boolean): void {
    if (this.destroyed) return;
    this.hp = Math.max(0, this.hp - amount);
    this.updateStage();
    if (this.hitReactions.length < 6) {
      this.hitReactions.push({ x: hitX, y: hitY, z: hitZ, strong, age: 0 });
    }
    if (strong) this.shakeIntensity = Math.min(1, this.shakeIntensity + 0.35);
  }

  update(deltaSeconds: number): void {
    this.shakeIntensity = Math.max(0, this.shakeIntensity - deltaSeconds * 3.2);
    for (let i = this.hitReactions.length - 1; i >= 0; i -= 1) {
      this.hitReactions[i].age += deltaSeconds;
      if (this.hitReactions[i].age > 0.4) this.hitReactions.splice(i, 1);
    }
    if (this.destroyed) {
      this.destructionTimer += deltaSeconds;
    }
  }

  triggerDestruction(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.hp = 0;
    this.stage = 'destroyed';
    this.destructionTimer = 0;
  }

  get destructionProgress(): number {
    if (!this.destroyed) return 0;
    return Math.min(1, this.destructionTimer / CONFIG.castle.destructionDurationSeconds);
  }

  private updateStage(): void {
    const r = this.ratio;
    if (r > 0.75) this.stage = 'intact';
    else if (r > 0.50) this.stage = 'light';
    else if (r > 0.25) this.stage = 'moderate';
    else if (r > 0) this.stage = 'heavy';
    else this.stage = 'destroyed';
  }
}
