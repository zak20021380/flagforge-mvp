import { Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import type { Team } from '../core/types';
import { MaterialLibrary } from '../render/materials';

interface PooledEffect {
  readonly mesh: Mesh;
  active: boolean;
  age: number;
  duration: number;
  mode: 'spawn' | 'hit' | 'castleHit' | 'dust' | 'debris';
}

export class EffectPool {
  private readonly blueEffects: PooledEffect[] = [];
  private readonly redEffects: PooledEffect[] = [];
  private readonly hitEffects: PooledEffect[] = [];
  private readonly castleHitEffects: PooledEffect[] = [];
  private readonly dustEffects: PooledEffect[] = [];
  private readonly debrisEffects: PooledEffect[] = [];

  constructor(scene: Scene, materials: MaterialLibrary) {
    for (let i = 0; i < 8; i += 1) {
      const blue = MeshBuilder.CreateTorus(`spawn-blue-${i}`, { diameter: 1.2, thickness: 0.1, tessellation: 20 }, scene);
      blue.rotation.x = Math.PI / 2;
      blue.material = materials.glowBlue;
      blue.setEnabled(false);
      this.blueEffects.push({ mesh: blue, active: false, age: 0, duration: 0.55, mode: 'spawn' });

      const red = MeshBuilder.CreateTorus(`spawn-red-${i}`, { diameter: 1.2, thickness: 0.1, tessellation: 20 }, scene);
      red.rotation.x = Math.PI / 2;
      red.material = materials.glowRed;
      red.setEnabled(false);
      this.redEffects.push({ mesh: red, active: false, age: 0, duration: 0.55, mode: 'spawn' });
    }

    for (let i = 0; i < 14; i += 1) {
      const hit = MeshBuilder.CreatePolyhedron(`hit-spark-${i}`, { type: 1, size: 0.28 }, scene);
      hit.material = materials.gold;
      hit.setEnabled(false);
      this.hitEffects.push({ mesh: hit, active: false, age: 0, duration: 0.26, mode: 'hit' });
    }

    const castleFlashMat = new StandardMaterial('castle-flash-mat', scene);
    castleFlashMat.emissiveColor.set(1, 0.95, 0.8);
    castleFlashMat.disableLighting = true;
    for (let i = 0; i < 6; i += 1) {
      const flash = MeshBuilder.CreateSphere(`castle-hit-${i}`, { diameter: 0.7, segments: 6 }, scene);
      flash.material = castleFlashMat;
      flash.setEnabled(false);
      this.castleHitEffects.push({ mesh: flash, active: false, age: 0, duration: 0.18, mode: 'castleHit' });
    }

    const dustMat = new StandardMaterial('dust-mat', scene);
    dustMat.diffuseColor.set(0.65, 0.6, 0.52);
    dustMat.alpha = 0.7;
    for (let i = 0; i < 8; i += 1) {
      const dust = MeshBuilder.CreateSphere(`dust-${i}`, { diameter: 0.55, segments: 5 }, scene);
      dust.material = dustMat;
      dust.setEnabled(false);
      this.dustEffects.push({ mesh: dust, active: false, age: 0, duration: 0.5, mode: 'dust' });
    }

    const debrisMat = materials.castleStoneDark;
    for (let i = 0; i < 10; i += 1) {
      const debris = MeshBuilder.CreateBox(`debris-${i}`, { width: 0.3, height: 0.25, depth: 0.28 }, scene);
      debris.material = debrisMat;
      debris.setEnabled(false);
      this.debrisEffects.push({ mesh: debris, active: false, age: 0, duration: 1.2, mode: 'debris' });
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

  update(deltaSeconds: number): void {
    const allEffects = [
      ...this.blueEffects,
      ...this.redEffects,
      ...this.hitEffects,
      ...this.castleHitEffects,
      ...this.dustEffects,
      ...this.debrisEffects,
    ];
    for (const effect of allEffects) {
      if (!effect.active) continue;
      effect.age += deltaSeconds;
      const t = Math.min(1, effect.age / effect.duration);
      if (effect.mode === 'spawn') {
        effect.mesh.scaling.setAll(0.35 + t * 1.7);
        effect.mesh.position.y = 0.12 + t * 0.26;
      } else if (effect.mode === 'hit') {
        effect.mesh.scaling.setAll(0.4 + Math.sin(t * Math.PI) * 1.15);
        effect.mesh.rotation.x += deltaSeconds * 8;
        effect.mesh.rotation.y += deltaSeconds * 10;
      } else if (effect.mode === 'castleHit') {
        effect.mesh.scaling.setAll(0.6 + (1 - t) * 1.2);
        (effect.mesh.material as StandardMaterial).alpha = 1 - t;
      } else if (effect.mode === 'dust') {
        effect.mesh.scaling.setAll(0.4 + t * 1.8);
        effect.mesh.position.y += deltaSeconds * 0.8;
        (effect.mesh.material as StandardMaterial).alpha = 0.7 * (1 - t);
      } else if (effect.mode === 'debris') {
        effect.mesh.position.y -= deltaSeconds * 3.5 * t;
        effect.mesh.rotation.x += deltaSeconds * 4;
        effect.mesh.rotation.z += deltaSeconds * 3;
      }
      if (t >= 1) {
        effect.active = false;
        effect.mesh.setEnabled(false);
      }
    }
  }

  private activate(effect: PooledEffect, position: Vector3): void {
    effect.active = true;
    effect.age = 0;
    effect.mesh.position.copyFrom(position);
    effect.mesh.scaling.setAll(0.4);
    effect.mesh.setEnabled(true);
  }
}
