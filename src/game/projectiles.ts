import {
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { MaterialLibrary } from '../render/materials';
import { RANGER_ARROW_VISUAL } from '../render/rangerArrow';
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
  private readonly fletchingSource: Mesh;

  constructor(private readonly scene: Scene, materials: MaterialLibrary, private readonly onImpact: (target: UnitEntity, damage: number, attacker: UnitEntity) => void) {
    this.shaftSource = MeshBuilder.CreateCylinder('arrow-shaft-source', {
      height: RANGER_ARROW_VISUAL.shaftLength,
      diameter: RANGER_ARROW_VISUAL.shaftDiameter,
      tessellation: 6,
    }, scene);
    this.shaftSource.rotation.x = Math.PI / 2;
    this.shaftSource.position.set(0, -50, 0);
    this.shaftSource.material = materials.arrowShaft;
    this.shaftSource.isPickable = false;
    this.shaftSource.checkCollisions = false;

    this.tipSource = MeshBuilder.CreateCylinder('arrow-tip-source', {
      height: RANGER_ARROW_VISUAL.tipLength,
      diameterTop: 0,
      diameterBottom: RANGER_ARROW_VISUAL.tipDiameter,
      tessellation: 6,
    }, scene);
    this.tipSource.rotation.x = Math.PI / 2;
    this.tipSource.position.set(0, -50, RANGER_ARROW_VISUAL.tipOffset);
    this.tipSource.material = materials.arrowHead;
    this.tipSource.isPickable = false;
    this.tipSource.checkCollisions = false;

    this.fletchingSource = MeshBuilder.CreateBox('arrow-fletching-source', {
      width: RANGER_ARROW_VISUAL.fletchingWidth,
      height: RANGER_ARROW_VISUAL.fletchingThickness,
      depth: RANGER_ARROW_VISUAL.fletchingLength,
    }, scene);
    this.fletchingSource.position.set(0, -50, RANGER_ARROW_VISUAL.fletchingOffset);
    this.fletchingSource.material = materials.arrowFletching;
    this.fletchingSource.isPickable = false;
    this.fletchingSource.checkCollisions = false;

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
    // Match the first rendered orientation to the unchanged homing path used by update().
    this.orientArrowAlong(arrow, target.position.add(new Vector3(0, 1.5, 0)).subtract(from));
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
      this.orientArrowAlong(arrow, direction);
    }
  }

  dispose(): void {
    this.arrows.forEach((arrow) => arrow.root.dispose());
    this.shaftSource.dispose();
    this.tipSource.dispose();
    this.fletchingSource.dispose();
  }

  private createArrow(index: number): void {
    const root = new TransformNode(`arrow-${index}`, this.scene);
    const shaft = this.shaftSource.createInstance(`arrow-${index}-shaft`);
    shaft.parent = root;
    shaft.position.set(0, 0, 0);
    shaft.isPickable = false;
    shaft.checkCollisions = false;
    const tip = this.tipSource.createInstance(`arrow-${index}-tip`);
    tip.parent = root;
    tip.position.set(0, 0, RANGER_ARROW_VISUAL.tipOffset);
    tip.isPickable = false;
    tip.checkCollisions = false;
    const fletchingHorizontal = this.fletchingSource.createInstance(`arrow-${index}-fletching-horizontal`);
    fletchingHorizontal.parent = root;
    fletchingHorizontal.position.set(0, 0, RANGER_ARROW_VISUAL.fletchingOffset);
    fletchingHorizontal.isPickable = false;
    fletchingHorizontal.checkCollisions = false;
    const fletchingVertical = this.fletchingSource.createInstance(`arrow-${index}-fletching-vertical`);
    fletchingVertical.parent = root;
    fletchingVertical.position.set(0, 0, RANGER_ARROW_VISUAL.fletchingOffset);
    fletchingVertical.rotation.z = Math.PI / 2;
    fletchingVertical.isPickable = false;
    fletchingVertical.checkCollisions = false;
    root.setEnabled(false);
    this.arrows.push({ root, active: false, speed: 0, target: null, damage: 0, attacker: null });
  }

  private orientArrowAlong(arrow: ActiveArrow, direction: Vector3): void {
    if (direction.lengthSquared() <= 1e-8) return;
    const forward = direction.normalize();
    const referenceUp = Math.abs(Vector3.Dot(forward, Vector3.Up())) > 0.98 ? Vector3.Right() : Vector3.Up();
    const right = Vector3.Cross(referenceUp, forward).normalize();
    const up = Vector3.Cross(forward, right).normalize();
    arrow.root.rotationQuaternion = Quaternion.FromLookDirectionLH(forward, up);
  }

  private release(arrow: ActiveArrow): void {
    arrow.active = false;
    arrow.target = null;
    arrow.attacker = null;
    arrow.root.setEnabled(false);
  }
}
