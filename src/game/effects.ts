import { Mesh, MeshBuilder, Scene, Vector3 } from '@babylonjs/core';
import type { Team } from '../core/types';
import { MaterialLibrary } from '../render/materials';

interface PooledEffect {
  readonly mesh: Mesh;
  active: boolean;
  age: number;
  duration: number;
  mode: 'spawn' | 'hit';
}

export class EffectPool {
  private readonly blueEffects: PooledEffect[] = [];
  private readonly redEffects: PooledEffect[] = [];
  private readonly hitEffects: PooledEffect[] = [];

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

  update(deltaSeconds: number): void {
    for (const effect of [...this.blueEffects, ...this.redEffects, ...this.hitEffects]) {
      if (!effect.active) continue;
      effect.age += deltaSeconds;
      const t = Math.min(1, effect.age / effect.duration);
      if (effect.mode === 'spawn') {
        effect.mesh.scaling.setAll(0.35 + t * 1.7);
        effect.mesh.position.y = 0.12 + t * 0.26;
      } else {
        effect.mesh.scaling.setAll(0.4 + Math.sin(t * Math.PI) * 1.15);
        effect.mesh.rotation.x += deltaSeconds * 8;
        effect.mesh.rotation.y += deltaSeconds * 10;
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
