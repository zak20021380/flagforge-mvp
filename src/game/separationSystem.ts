import { CONFIG } from '../core/config';
import type { UnitEntity } from './unit';

/**
 * Lightweight local separation between nearby units, evaluated on the XZ plane only.
 *
 * Each unit claims a personal-space bubble sized from its own collision radius
 * (`bodyRadius`, derived from the unit scale, so a BRAX reserves slightly more room than a
 * VEX). Two units only repel while their bubbles actually intrude on each other. The push is
 * strongest at very close range and fades smoothly to zero at the bubble edge (a quadratic
 * falloff), so clustered units ease apart into a loose formation instead of ever being kicked or
 * teleported.
 *
 * The scan is a plain linear pass over the unit list: with the match hard-capped at 24 active
 * units the max neighbor window stays tiny, which keeps it cheaper than building and clearing a
 * grid every frame and friendly to mobile and Telegram Mini App budgets. Everything is written
 * through reusable scratch objects — no per-frame allocation anywhere in this module.
 *
 * The force is only a steering nudge folded into the caller's normal movement step: the step
 * keeps its speed cap and its water/arena/bridge gates, so separation can never push a body into
 * a river, over a railing or outside the battlefield. Callers scale the force down (or off) for
 * controlled traversal — bridge decks and queues, ladder lines and climbs, gate work, reserved
 * slots and committed combat — so designated positions are never disturbed.
 */
export class SeparationSystem {
  /**
   * Accumulate the separation force acting on `unit` into `out` as `{x, z}`. Same-team bodies
   * push at full strength; opposing teams push a little softer so marching groups slide around
   * each other instead of hard-locking before melee reach.
   *
   * Returns `out` for convenient chaining.
   */
  compute(unit: UnitEntity, units: readonly UnitEntity[], out: { x: number; z: number }): { x: number; z: number } {
    let forceX = 0;
    let forceZ = 0;
    for (const neighbor of units) {
      if (
        neighbor === unit
        || !neighbor.active
        || neighbor.state === 'dead'
        || neighbor.navigationArea !== unit.navigationArea
      ) continue;
      // Comfortable space between the two centres: the sum of both personal-space bubbles, each
      // derived from that unit's collision radius, so a bigger body naturally asks for more room.
      const comfort = unit.separationRadius + neighbor.separationRadius;
      const offsetX = unit.position.x - neighbor.position.x;
      const offsetZ = unit.position.z - neighbor.position.z;
      const comfortSquared = comfort * comfort;
      const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;
      if (distanceSquared >= comfortSquared) continue;

      let pushX: number;
      let pushZ: number;
      let falloff: number;
      if (distanceSquared <= 0.000001) {
        // Exact stack: fall back to a stable, tiny direction from the id parity so the two bodies
        // spread in opposite directions without any abrupt kick or frame-to-frame flip.
        const angle = (neighbor.id * 137.50776405003785) * (Math.PI / 180);
        const direction = unit.id <= neighbor.id ? 1 : -1;
        pushX = Math.sin(angle) * direction;
        pushZ = Math.cos(angle) * direction;
        falloff = 1;
      } else {
        const distance = Math.sqrt(distanceSquared);
        const inverse = 1 / distance;
        pushX = offsetX * inverse;
        pushZ = offsetZ * inverse;
        const fraction = 1 - distance / comfort;
        falloff = fraction * fraction;
      }

      let strength = falloff * CONFIG.unit.separationStrength;
      if (neighbor.team !== unit.team) strength *= CONFIG.unit.separationEnemyScale;
      forceX += pushX * strength;
      forceZ += pushZ * strength;
    }

    // Clamp the summed force so even a dense cluster only ever produces a gentle drift; the push
    // rate also eases in smoothly as overlap grows, which keeps separation gradual.
    const length = Math.hypot(forceX, forceZ);
    const maxForce = CONFIG.unit.separationMaxForce;
    if (length > maxForce) {
      const scale = maxForce / length;
      forceX *= scale;
      forceZ *= scale;
    }
    out.x = forceX;
    out.z = forceZ;
    return out;
  }
}
