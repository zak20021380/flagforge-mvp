import {
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { MaterialLibrary } from '../render/materials';
import type { UnitEntity } from './unit';

interface ActiveArrow {
  readonly root: TransformNode;
  active: boolean;
  speed: number;
  target: UnitEntity | null;
  damage: number;
  attacker: UnitEntity | null;
}

export class ProjectilePool {
  private readonly arrows: ActiveArrow[] = [];
  private readonly shaftSource: Mesh;
  private readonly tipSource: Mesh;

  constructor(private readonly scene: Scene, materials: MaterialLibrary, private readonly onImpact: (target: UnitEntity, damage: number, attacker: UnitEntity) => void) {
    this.shaftSource = MeshBuilder.CreateCylinder('arrow-shaft-source', { height: 1.15, diameter: 0.055, tessellation: 6 }, scene);
    this.shaftSource.rotation.x = Math.PI / 2;
    this.shaftSource.position.set(0, -50, 0);
    this.shaftSource.material = materials.wood;
    this.shaftSource.isPickable = false;

    this.tipSource = MeshBuilder.CreateCylinder('arrow-tip-source', { height: 0.24, diameterTop: 0, diameterBottom: 0.18, tessellation: 6 }, scene);
    this.tipSource.rotation.x = Math.PI / 2;
    this.tipSource.position.set(0, -50, 0.68);
    this.tipSource.material = materials.metal;
    this.tipSource.isPickable = false;

    for (let i = 0; i < 24; i += 1) this.createArrow(i);
  }

  launch(from: Vector3, target: UnitEntity, damage: number, speed: number, attacker: UnitEntity): void {
    const arrow = this.arrows.find((candidate) => !candidate.active);
    if (!arrow) return;
    arrow.active = true;
    arrow.speed = speed;
    arrow.target = target;
    arrow.damage = damage;
    arrow.attacker = attacker;
    arrow.root.position.copyFrom(from);
    arrow.root.setEnabled(true);
    this.orientArrow(arrow, target.position);
  }

  update(deltaSeconds: number): void {
    for (const arrow of this.arrows) {
      if (!arrow.active || !arrow.target || !arrow.attacker) continue;
      if (!arrow.target.active || arrow.target.state === 'dead') {
        this.release(arrow);
        continue;
      }
      const targetPosition = arrow.target.position.add(new Vector3(0, 1.5, 0));
      const direction = targetPosition.subtract(arrow.root.position);
      const distance = direction.length();
      const step = arrow.speed * deltaSeconds;
      if (distance <= step + 0.18) {
        this.onImpact(arrow.target, arrow.damage, arrow.attacker);
        this.release(arrow);
        continue;
      }
      direction.scaleInPlace(1 / Math.max(0.0001, distance));
      arrow.root.position.addInPlace(direction.scale(step));
      this.orientArrow(arrow, targetPosition);
    }
  }

  dispose(): void {
    this.arrows.forEach((arrow) => arrow.root.dispose());
    this.shaftSource.dispose();
    this.tipSource.dispose();
  }

  private createArrow(index: number): void {
    const root = new TransformNode(`arrow-${index}`, this.scene);
    const shaft = this.shaftSource.createInstance(`arrow-${index}-shaft`);
    shaft.parent = root;
    shaft.position.set(0, 0, 0);
    const tip = this.tipSource.createInstance(`arrow-${index}-tip`);
    tip.parent = root;
    tip.position.set(0, 0, 0.68);
    root.setEnabled(false);
    this.arrows.push({ root, active: false, speed: 0, target: null, damage: 0, attacker: null });
  }

  private orientArrow(arrow: ActiveArrow, target: Vector3): void {
    const direction = target.subtract(arrow.root.position).normalize();
    arrow.root.rotationQuaternion = Quaternion.FromLookDirectionLH(direction, Vector3.Up());
  }

  private release(arrow: ActiveArrow): void {
    arrow.active = false;
    arrow.target = null;
    arrow.attacker = null;
    arrow.root.setEnabled(false);
  }
}
