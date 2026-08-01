import { CONFIG } from '../core/config';

export class EnergyModel {
  value: number = CONFIG.energy.initial;

  update(deltaSeconds: number, overtime: boolean): void {
    const multiplier = overtime ? CONFIG.energy.overtimeMultiplier : 1;
    this.value = Math.min(CONFIG.energy.maximum, this.value + CONFIG.energy.regenPerSecond * multiplier * deltaSeconds);
  }

  canSpend(cost: number): boolean {
    return this.value + 0.0001 >= cost;
  }

  spend(cost: number): boolean {
    if (!this.canSpend(cost)) return false;
    this.value -= cost;
    return true;
  }

  reset(): void {
    this.value = CONFIG.energy.initial;
  }
}
