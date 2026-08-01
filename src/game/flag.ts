import {
  Mesh,
  MeshBuilder,
  Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { CENTRAL_TOWER, CONFIG } from '../core/config';
import type { Team } from '../core/types';
import { squaredDistanceXZ } from '../core/math';
import { MaterialLibrary } from '../render/materials';
import type { UnitEntity } from './unit';

export type FlagStatus = 'neutral' | 'carried' | 'dropped' | 'resetting';

export class FlagController {
  readonly root: TransformNode;
  private readonly cloth: Mesh;
  private readonly tail: Mesh;
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
    this.root.position.set(
      CENTRAL_TOWER.safeFlagDrops.towerTop.x,
      CENTRAL_TOWER.safeFlagDrops.towerTop.y,
      CENTRAL_TOWER.safeFlagDrops.towerTop.z,
    );

    const pole = MeshBuilder.CreateCylinder('central-flag-pole', { height: 4.65, diameter: 0.15, tessellation: 8 }, scene);
    pole.parent = this.root;
    pole.position.y = 2.325;
    pole.material = materials.metal;

    const finial = MeshBuilder.CreateSphere('central-flag-finial', { diameter: 0.38, segments: 7 }, scene);
    finial.parent = this.root;
    finial.position.y = 4.74;
    finial.material = materials.gold;

    this.cloth = MeshBuilder.CreateBox('central-flag-cloth', { width: 2.35, height: 1.35, depth: 0.08 }, scene);
    this.cloth.parent = this.root;
    this.cloth.position = new Vector3(1.2, 3.93, 0);
    this.cloth.material = materials.objectiveCloth;

    this.tail = MeshBuilder.CreateBox('central-flag-tail', { width: 0.92, height: 0.92, depth: 0.085 }, scene);
    this.tail.parent = this.cloth;
    this.tail.position = new Vector3(1.25, -0.16, 0);
    this.tail.rotation.z = -0.48;
    this.tail.material = materials.objectiveCloth;

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
    const flagPosition = this.root.getAbsolutePosition();
    if (Math.abs(unit.position.y - flagPosition.y) > CENTRAL_TOWER.flagPickupHeightTolerance) return false;
    if (squaredDistanceXZ(unit.position, flagPosition) > CONFIG.arena.flagPickupRadius ** 2) return false;
    this.carrier = unit;
    this.status = 'carried';
    unit.carryingFlag = true;
    unit.target = null;
    this.root.parent = unit.rig.flagSocket;
    this.root.position.set(0, -0.15, 0);
    this.root.scaling.setAll(0.76);
    this.cloth.material = this.materials.team(unit.team);
    this.tail.material = this.materials.team(unit.team);
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
    unit.carryingFlag = false;
    this.carrier = null;
    this.status = 'dropped';
    this.root.parent = null;
    this.root.scaling.setAll(1);
    this.placeAtSafeDrop(unit);
    this.root.setEnabled(true);
    this.cloth.material = this.materials.objectiveCloth;
    this.tail.material = this.materials.objectiveCloth;
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
    this.root.position.set(
      CENTRAL_TOWER.safeFlagDrops.towerTop.x,
      CENTRAL_TOWER.safeFlagDrops.towerTop.y,
      CENTRAL_TOWER.safeFlagDrops.towerTop.z,
    );
    this.root.scaling.setAll(1);
    this.root.setEnabled(true);
    this.cloth.material = this.materials.objectiveCloth;
    this.tail.material = this.materials.objectiveCloth;
    this.carrierRing.parent = null;
    this.carrierRing.setEnabled(false);
  }

  private placeAtSafeDrop(unit: UnitEntity): void {
    if (unit.navigationArea === 'towerTop') {
      const safe = CENTRAL_TOWER.safeFlagDrops.towerTop;
      this.root.position.set(safe.x, safe.y, safe.z);
      return;
    }
    if (unit.navigationArea === 'playerLadder') {
      const safe = CENTRAL_TOWER.safeFlagDrops.playerBase;
      this.root.position.set(safe.x, safe.y, safe.z);
      return;
    }
    if (unit.navigationArea === 'enemyLadder') {
      const safe = CENTRAL_TOWER.safeFlagDrops.enemyBase;
      this.root.position.set(safe.x, safe.y, safe.z);
      return;
    }

    const radiusSquared = CENTRAL_TOWER.ladderBaseDropRadius ** 2;
    const playerBase = CENTRAL_TOWER.safeFlagDrops.playerBase;
    if (squaredDistanceXZ(unit.position, new Vector3(playerBase.x, unit.position.y, playerBase.z)) <= radiusSquared) {
      this.root.position.set(playerBase.x, playerBase.y, playerBase.z);
      return;
    }
    const enemyBase = CENTRAL_TOWER.safeFlagDrops.enemyBase;
    if (squaredDistanceXZ(unit.position, new Vector3(enemyBase.x, unit.position.y, enemyBase.z)) <= radiusSquared) {
      this.root.position.set(enemyBase.x, enemyBase.y, enemyBase.z);
      return;
    }
    this.root.position.set(unit.position.x, 0.12, unit.position.z);
  }
}
