import { Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import type { Team } from '../core/types';
import { MaterialLibrary } from '../render/materials';

interface PooledEffect {
  readonly mesh: Mesh;
  active: boolean;
  age: number;
  duration: number;
  mode: 'spawn' | 'hit' | 'castleHit' | 'dust' | 'debris' | 'splinter' | 'smoke';
  /** Per-activation drift, reused in place so the pool never allocates while running. */
  readonly velocity: Vector3;
  spin: number;
  /** Per-activation size multiplier, so one pool serves both light hits and the breach burst. */
  scale: number;
}

export class EffectPool {
  private readonly blueEffects: PooledEffect[] = [];
  private readonly redEffects: PooledEffect[] = [];
  private readonly hitEffects: PooledEffect[] = [];
  private readonly castleHitEffects: PooledEffect[] = [];
  private readonly dustEffects: PooledEffect[] = [];
  private readonly debrisEffects: PooledEffect[] = [];
  /** Small wood shards for gate impacts and the breach burst. */
  private readonly splinterEffects: PooledEffect[] = [];
  /** Soft translucent puffs for castle stage-2 damage smoke. */
  private readonly smokeEffects: PooledEffect[] = [];

  constructor(scene: Scene, materials: MaterialLibrary) {
    for (let i = 0; i < 8; i += 1) {
      const blue = MeshBuilder.CreateTorus(`spawn-blue-${i}`, { diameter: 1.2, thickness: 0.1, tessellation: 20 }, scene);
      blue.rotation.x = Math.PI / 2;
      blue.material = materials.glowBlue;
      blue.setEnabled(false);
      this.blueEffects.push(makeEffect(blue, 0.55, 'spawn'));

      const red = MeshBuilder.CreateTorus(`spawn-red-${i}`, { diameter: 1.2, thickness: 0.1, tessellation: 20 }, scene);
      red.rotation.x = Math.PI / 2;
      red.material = materials.glowRed;
      red.setEnabled(false);
      this.redEffects.push(makeEffect(red, 0.55, 'spawn'));
    }

    for (let i = 0; i < 14; i += 1) {
      const hit = MeshBuilder.CreatePolyhedron(`hit-spark-${i}`, { type: 1, size: 0.28 }, scene);
      hit.material = materials.gold;
      hit.setEnabled(false);
      this.hitEffects.push(makeEffect(hit, 0.26, 'hit'));
    }

    const castleFlashMat = new StandardMaterial('castle-flash-mat', scene);
    castleFlashMat.emissiveColor.set(1, 0.95, 0.8);
    castleFlashMat.disableLighting = true;
    for (let i = 0; i < 6; i += 1) {
      const flash = MeshBuilder.CreateSphere(`castle-hit-${i}`, { diameter: 0.7, segments: 6 }, scene);
      flash.material = castleFlashMat;
      flash.setEnabled(false);
      this.castleHitEffects.push(makeEffect(flash, 0.18, 'castleHit'));
    }

    const dustMat = new StandardMaterial('dust-mat', scene);
    dustMat.diffuseColor.set(0.65, 0.6, 0.52);
    dustMat.alpha = 0.7;
    for (let i = 0; i < 8; i += 1) {
      const dust = MeshBuilder.CreateSphere(`dust-${i}`, { diameter: 0.55, segments: 5 }, scene);
      dust.material = dustMat;
      dust.setEnabled(false);
      this.dustEffects.push(makeEffect(dust, 0.5, 'dust'));
    }

    const debrisMat = materials.castleStoneDark;
    for (let i = 0; i < 10; i += 1) {
      const debris = MeshBuilder.CreateBox(`debris-${i}`, { width: 0.3, height: 0.25, depth: 0.28 }, scene);
      debris.material = debrisMat;
      debris.setEnabled(false);
      this.debrisEffects.push(makeEffect(debris, 1.2, 'debris'));
    }

    // Wood splinters: one shared gate-timber material, 12 thin shards, arced by simple transforms.
    for (let i = 0; i < 12; i += 1) {
      const splinter = MeshBuilder.CreateBox(`gate-splinter-${i}`, { width: 0.09, height: 0.34, depth: 0.07 }, scene);
      splinter.material = i % 2 === 0 ? materials.gateWood : materials.gateWoodLight;
      splinter.setEnabled(false);
      this.splinterEffects.push(makeEffect(splinter, 0.75, 'splinter'));
    }

    // Structural smoke for the damaged castle: darker and slower than impact dust.
    const smokeMat = new StandardMaterial('castle-smoke-mat', scene);
    smokeMat.diffuseColor.set(0.24, 0.23, 0.22);
    smokeMat.emissiveColor.set(0.05, 0.05, 0.05);
    smokeMat.alpha = 0.4;
    for (let i = 0; i < 8; i += 1) {
      const smoke = MeshBuilder.CreateSphere(`castle-smoke-${i}`, { diameter: 0.9, segments: 5 }, scene);
      smoke.material = smokeMat;
      smoke.setEnabled(false);
      this.smokeEffects.push(makeEffect(smoke, 1.5, 'smoke'));
    }
  }

  spawn(position: Vector3, team: Team): void {
    const pool = team === 'blue' ? this.blueEffects : this.redEffects;
    const effect = pool.find((candidate) => !candidate.active);
    if (!effect) return;
    this.activate(effect, position.add(new Vector3(0, 0.12, 0)));
  }

  hit(position: Vector3): void {
    const effect = this.hitEffects.find((candidate) => !candidate.active);
    if (!effect) return;
    this.activate(effect, position.add(new Vector3(0, 1.25, 0)));
  }

  castleHit(position: Vector3): void {
    const flash = this.castleHitEffects.find((c) => !c.active);
    if (flash) this.activate(flash, position);
    const dust = this.dustEffects.find((c) => !c.active);
    if (dust) this.activate(dust, position.add(new Vector3(0, -0.2, 0)));
  }

  /**
   * Restrained gate impact: one small flash, one dust puff and two or three wood splinters. All from
   * the existing pools, so a sustained assault never grows the scene or leaves particles behind.
   */
  gateHit(position: Vector3, strong: boolean): void {
    const flash = this.castleHitEffects.find((c) => !c.active);
    if (flash) this.activate(flash, position, 0.55);
    const dust = this.dustEffects.find((c) => !c.active);
    if (dust) this.activate(dust, position.add(new Vector3(0, -0.35, 0)), 0.8);
    this.splinterBurst(position, strong ? 3 : 2, strong ? 1 : 0.72);
  }

  /** Larger one-shot shower used by the breach sequence. */
  gateBreachBurst(position: Vector3): void {
    this.splinterBurst(position, 6, 1.25);
    for (let i = 0; i < 3; i += 1) {
      const dust = this.dustEffects.find((c) => !c.active);
      if (!dust) break;
      this.activate(dust, position.add(new Vector3((Math.random() - 0.5) * 3.2, -0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8)), 1.35);
    }
    const flash = this.castleHitEffects.find((c) => !c.active);
    if (flash) this.activate(flash, position, 1.6);
  }

  /** Slow structural smoke plume for a damaged castle. Pooled and self-deactivating. */
  castleSmoke(position: Vector3, dark: boolean): void {
    const smoke = this.smokeEffects.find((c) => !c.active);
    if (!smoke) return;
    this.activate(smoke, position.add(new Vector3((Math.random() - 0.5) * 2.4, 0, (Math.random() - 0.5) * 1.2)), dark ? 1.35 : 0.9);
    smoke.velocity.set((Math.random() - 0.5) * 0.35, 0.8 + Math.random() * 0.5, (Math.random() - 0.5) * 0.2);
  }

  castleDebris(position: Vector3): void {
    for (let i = 0; i < 3; i += 1) {
      const debris = this.debrisEffects.find((c) => !c.active);
      if (!debris) break;
      const offset = new Vector3(
        (Math.random() - 0.5) * 1.5,
        Math.random() * 0.5,
        (Math.random() - 0.5) * 1.5,
      );
      this.activate(debris, position.add(offset));
    }
  }

  private splinterBurst(position: Vector3, count: number, scale: number): void {
    for (let i = 0; i < count; i += 1) {
      const splinter = this.splinterEffects.find((c) => !c.active);
      if (!splinter) break;
      this.activate(splinter, position, scale);
      splinter.velocity.set(
        (Math.random() - 0.5) * 3.4 * scale,
        1.4 + Math.random() * 2.2 * scale,
        (Math.random() - 0.5) * 1.6 + 0.9 * scale,
      );
      splinter.spin = (Math.random() - 0.5) * 14;
      splinter.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    }
  }

  update(deltaSeconds: number): void {
    this.updatePool(this.blueEffects, deltaSeconds);
    this.updatePool(this.redEffects, deltaSeconds);
    this.updatePool(this.hitEffects, deltaSeconds);
    this.updatePool(this.castleHitEffects, deltaSeconds);
    this.updatePool(this.dustEffects, deltaSeconds);
    this.updatePool(this.debrisEffects, deltaSeconds);
    this.updatePool(this.splinterEffects, deltaSeconds);
    this.updatePool(this.smokeEffects, deltaSeconds);
  }

  private updatePool(pool: PooledEffect[], deltaSeconds: number): void {
    for (const effect of pool) {
      if (!effect.active) continue;
      effect.age += deltaSeconds;
      const t = Math.min(1, effect.age / effect.duration);
      const scale = effect.scale;
      if (effect.mode === 'spawn') {
        effect.mesh.scaling.setAll(0.35 + t * 1.7);
        effect.mesh.position.y = 0.12 + t * 0.26;
      } else if (effect.mode === 'hit') {
        effect.mesh.scaling.setAll(0.4 + Math.sin(t * Math.PI) * 1.15);
        effect.mesh.rotation.x += deltaSeconds * 8;
        effect.mesh.rotation.y += deltaSeconds * 10;
      } else if (effect.mode === 'castleHit') {
        effect.mesh.scaling.setAll((0.6 + (1 - t) * 1.2) * scale);
        (effect.mesh.material as StandardMaterial).alpha = 1 - t;
      } else if (effect.mode === 'dust') {
        effect.mesh.scaling.setAll((0.4 + t * 1.8) * scale);
        effect.mesh.position.y += deltaSeconds * 0.8;
        (effect.mesh.material as StandardMaterial).alpha = 0.7 * (1 - t);
      } else if (effect.mode === 'debris') {
        effect.mesh.position.y -= deltaSeconds * 3.5 * t;
        effect.mesh.rotation.x += deltaSeconds * 4;
        effect.mesh.rotation.z += deltaSeconds * 3;
      } else if (effect.mode === 'splinter') {
        // Simple ballistic arc, no physics engine: constant gravity on a pooled transform.
        effect.velocity.y -= deltaSeconds * 9.2;
        effect.mesh.position.x += effect.velocity.x * deltaSeconds;
        effect.mesh.position.y += effect.velocity.y * deltaSeconds;
        effect.mesh.position.z += effect.velocity.z * deltaSeconds;
        effect.mesh.rotation.x += effect.spin * deltaSeconds;
        effect.mesh.rotation.z += effect.spin * 0.6 * deltaSeconds;
        effect.mesh.scaling.setAll(scale);
      } else if (effect.mode === 'smoke') {
        effect.mesh.position.x += effect.velocity.x * deltaSeconds;
        effect.mesh.position.y += effect.velocity.y * deltaSeconds;
        effect.mesh.position.z += effect.velocity.z * deltaSeconds;
        effect.mesh.scaling.setAll((0.5 + t * 1.5) * scale);
      }
      if (t >= 1) {
        effect.active = false;
        effect.mesh.setEnabled(false);
      }
    }
  }

  private activate(effect: PooledEffect, position: Vector3, scale = 1): void {
    effect.active = true;
    effect.age = 0;
    effect.scale = scale;
    effect.mesh.position.copyFrom(position);
    effect.mesh.scaling.setAll(0.4 * scale);
    effect.velocity.setAll(0);
    effect.spin = 0;
    effect.mesh.setEnabled(true);
  }
}

function makeEffect(mesh: Mesh, duration: number, mode: PooledEffect['mode']): PooledEffect {
  return { mesh, active: false, age: 0, duration, mode, velocity: new Vector3(0, 0, 0), spin: 0, scale: 1 };
}
