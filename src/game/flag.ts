import {
  Mesh,
  MeshBuilder,
  Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { CONFIG } from '../core/config';
import type { Team } from '../core/types';
import { squaredDistanceXZ } from '../core/math';
import { MaterialLibrary } from '../render/materials';
import type { UnitEntity } from './unit';

export type FlagStatus = 'neutral' | 'carried' | 'dropped' | 'resetting';

export class FlagController {
  readonly root: TransformNode;
  private readonly cloth: Mesh;
  private readonly carrierRing: Mesh;
  private carrier: UnitEntity | null = null;
  private status: FlagStatus = 'neutral';
  private resetTimer = 0;

  constructor(
    scene: Scene,
    private readonly materials: MaterialLibrary,
    private readonly onPickup: (team: Team) => void,
    private readonly onDelivered: (team: Team) => void,
    private readonly onDropped: () => void,
  ) {
    this.root = new TransformNode('central-flag-root', scene);
    this.root.position.set(0, 0.72, 0);

    const pole = MeshBuilder.CreateCylinder('central-flag-pole', { height: 4.1, diameter: 0.13, tessellation: 8 }, scene);
    pole.parent = this.root;
    pole.position.y = 2.05;
    pole.material = materials.metal;

    const finial = MeshBuilder.CreateSphere('central-flag-finial', { diameter: 0.32, segments: 7 }, scene);
    finial.parent = this.root;
    finial.position.y = 4.16;
    finial.material = materials.gold;

    this.cloth = MeshBuilder.CreateBox('central-flag-cloth', { width: 2, height: 1.18, depth: 0.07 }, scene);
    this.cloth.parent = this.root;
    this.cloth.position = new Vector3(1.02, 3.42, 0);
    this.cloth.material = materials.gold;

    const tail = MeshBuilder.CreateBox('central-flag-tail', { width: 0.8, height: 0.82, depth: 0.075 }, scene);
    tail.parent = this.cloth;
    tail.position = new Vector3(1.25, -0.16, 0);
    tail.rotation.z = -0.48;
    tail.material = materials.gold;

    this.carrierRing = MeshBuilder.CreateTorus('flag-carrier-ring', { diameter: 2.15, thickness: 0.13, tessellation: 30 }, scene);
    this.carrierRing.rotation.x = Math.PI / 2;
    this.carrierRing.position.y = 0.12;
    this.carrierRing.isPickable = false;
    this.carrierRing.setEnabled(false);
  }

  get currentStatus(): FlagStatus {
    return this.status;
  }

  get currentCarrier(): UnitEntity | null {
    return this.carrier;
  }

  get position(): Vector3 {
    return this.carrier ? this.carrier.position : this.root.getAbsolutePosition();
  }

  canBePickedUp(): boolean {
    return this.status === 'neutral' || this.status === 'dropped';
  }

  tryPickup(unit: UnitEntity): boolean {
    if (!this.canBePickedUp() || unit.state === 'dead') return false;
    if (squaredDistanceXZ(unit.position, this.root.getAbsolutePosition()) > CONFIG.arena.flagPickupRadius ** 2) return false;
    this.carrier = unit;
    this.status = 'carried';
    unit.carryingFlag = true;
    unit.target = null;
    this.root.parent = unit.rig.flagSocket;
    this.root.position.set(0, -0.15, 0);
    this.root.scaling.setAll(0.76);
    this.cloth.material = this.materials.team(unit.team);
    this.carrierRing.parent = unit.rig.root;
    this.carrierRing.position.set(0, 0.12, 0);
    this.carrierRing.material = this.materials.teamGlow(unit.team);
    this.carrierRing.setEnabled(true);
    this.onPickup(unit.team);
    return true;
  }

  tryDeliver(unit: UnitEntity, deliveryPoint: Vector3): boolean {
    if (this.carrier !== unit || this.status !== 'carried') return false;
    if (squaredDistanceXZ(unit.position, deliveryPoint) > 1.7 ** 2) return false;
    unit.carryingFlag = false;
    this.carrier = null;
    this.status = 'resetting';
    this.resetTimer = 1.15;
    this.root.parent = null;
    this.root.setEnabled(false);
    this.carrierRing.parent = null;
    this.carrierRing.setEnabled(false);
    this.onDelivered(unit.team);
    return true;
  }

  dropFrom(unit: UnitEntity): void {
    if (this.carrier !== unit) return;
    const dropPosition = unit.position.clone();
    unit.carryingFlag = false;
    this.carrier = null;
    this.status = 'dropped';
    this.root.parent = null;
    this.root.scaling.setAll(1);
    this.root.position.set(dropPosition.x, 0.72, dropPosition.z);
    this.root.setEnabled(true);
    this.cloth.material = this.materials.gold;
    this.carrierRing.parent = null;
    this.carrierRing.setEnabled(false);
    this.onDropped();
  }

  update(deltaSeconds: number, elapsed: number): void {
    this.cloth.rotation.y = Math.sin(elapsed * 4.4) * 0.08;
    this.cloth.scaling.y = 1 + Math.sin(elapsed * 6.1) * 0.035;
    if (this.status !== 'resetting') return;
    this.resetTimer -= deltaSeconds;
    if (this.resetTimer <= 0) this.resetToCenter();
  }

  resetToCenter(): void {
    if (this.carrier) this.carrier.carryingFlag = false;
    this.carrier = null;
    this.status = 'neutral';
    this.root.parent = null;
    this.root.position.set(0, 0.72, 0);
    this.root.scaling.setAll(1);
    this.root.setEnabled(true);
    this.cloth.material = this.materials.gold;
    this.carrierRing.parent = null;
    this.carrierRing.setEnabled(false);
  }
}
