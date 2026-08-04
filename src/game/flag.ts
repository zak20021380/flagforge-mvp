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

export type FlagStatus = 'neutral' | 'carried' | 'dropped' | 'consumed';

export class FlagController {
  readonly root: TransformNode;
  private readonly clothSegments: ReadonlyArray<Mesh>;
  private readonly tail: Mesh;
  private readonly carrierRing: Mesh;
  private carrier: UnitEntity | null = null;
  private status: FlagStatus = 'neutral';
  private lastDeliveredTeamField: Team | null = null;

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

    // Taller, cleaner flagpole with a gold base collar and a crossbar where the cloth attaches,
    // so the main objective reads clearly above the tower crown from the portrait camera.
    const poleHeight = 6.4;
    const pole = MeshBuilder.CreateCylinder('central-flag-pole', { height: poleHeight, diameter: 0.16, tessellation: 8 }, scene);
    pole.parent = this.root;
    pole.position.y = poleHeight / 2;
    pole.material = materials.metal;
    pole.isPickable = false;

    const poleCollar = MeshBuilder.CreateCylinder('central-flag-pole-collar', { height: 0.22, diameterTop: 0.26, diameterBottom: 0.34, tessellation: 8 }, scene);
    poleCollar.parent = this.root;
    poleCollar.position.y = 0.11;
    poleCollar.material = materials.gold;
    poleCollar.isPickable = false;

    const crossbar = MeshBuilder.CreateBox('central-flag-crossbar', { width: 0.62, height: 0.1, depth: 0.1 }, scene);
    crossbar.parent = this.root;
    crossbar.position.y = poleHeight - 0.42;
    crossbar.material = materials.gold;
    crossbar.isPickable = false;

    const finial = MeshBuilder.CreateSphere('central-flag-finial', { diameter: 0.36, segments: 7 }, scene);
    finial.parent = this.root;
    finial.position.y = poleHeight + 0.18;
    finial.material = materials.gold;
    finial.isPickable = false;

    const spear = MeshBuilder.CreateCylinder('central-flag-finial-spear', { height: 0.5, diameterTop: 0, diameterBottom: 0.16, tessellation: 7 }, scene);
    spear.parent = this.root;
    spear.position.y = poleHeight + 0.5;
    spear.material = materials.gold;
    spear.isPickable = false;

    // High-quality cloth built as a short chain of vertical strips. Each strip parents to the
    // previous one, so phased rotations propagate along the length like fabric rippling in wind
    // while staying a handful of cheap boxes (no per-frame mesh deformation).
    const clothTop = poleHeight - 0.42;
    const segWidth = 0.98;
    const segHeight = 1.7;
    const clothCenterY = clothTop - segHeight / 2;
    const seg1 = MeshBuilder.CreateBox('central-flag-cloth-1', { width: segWidth, height: segHeight, depth: 0.07 }, scene);
    seg1.parent = this.root;
    seg1.position = new Vector3(segWidth / 2, clothCenterY, 0);
    seg1.material = materials.objectiveCloth;
    seg1.isPickable = false;

    const seg2 = MeshBuilder.CreateBox('central-flag-cloth-2', { width: segWidth, height: segHeight, depth: 0.07 }, scene);
    seg2.parent = seg1;
    seg2.position = new Vector3(segWidth, 0, 0);
    seg2.material = materials.objectiveCloth;
    seg2.isPickable = false;

    const seg3 = MeshBuilder.CreateBox('central-flag-cloth-3', { width: segWidth, height: segHeight, depth: 0.07 }, scene);
    seg3.parent = seg2;
    seg3.position = new Vector3(segWidth, 0, 0);
    seg3.material = materials.objectiveCloth;
    seg3.isPickable = false;

    this.clothSegments = [seg1, seg2, seg3];

    // Swallowtail fly end on the free segment so the cloth reads as a finished pennant.
    this.tail = MeshBuilder.CreateBox('central-flag-tail', { width: 0.7, height: 1.18, depth: 0.085 }, scene);
    this.tail.parent = seg3;
    this.tail.position = new Vector3(segWidth / 2 + 0.18, -0.18, 0);
    this.tail.rotation.z = -0.34;
    this.tail.material = materials.objectiveCloth;
    this.tail.isPickable = false;

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

  /** The team whose carrier delivered the flag. Set on delivery and never cleared for this match. */
  get lastDeliveredTeam(): Team | null {
    return this.lastDeliveredTeamField;
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
    this.setClothMaterial(this.materials.team(unit.team));
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
    // The flag is permanently consumed for this match. It is hidden, detached from the carrier,
    // and never re-enabled: no timer, update branch or reset step can bring it back to the tower.
    // A flag can only exist again when a completely new match builds a fresh FlagController.
    this.status = 'consumed';
    this.lastDeliveredTeamField = unit.team;
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
    this.setClothMaterial(this.materials.objectiveCloth);
    this.tail.material = this.materials.objectiveCloth;
    this.carrierRing.parent = null;
    this.carrierRing.setEnabled(false);
    this.onDropped();
  }

  update(_deltaSeconds: number, elapsed: number): void {
    // A consumed flag is gone for this match: no cloth drift, no timer, no reset. Nothing here can
    // reactivate it.
    if (this.status === 'consumed') return;
    // Subtle, lightweight cloth motion: a gentle horizontal sway on the root strip plus a
    // travelling ripple (phased z-rotations) down the chain, and a soft flutter on the free
    // edge. All values are absolute so nothing accumulates, and there is no mesh deformation.
    const sway = Math.sin(elapsed * 2.1);
    const ripple = elapsed * 3.3;
    const seg1 = this.clothSegments[0];
    seg1.rotation.y = sway * 0.05;
    seg1.rotation.z = Math.sin(ripple) * 0.05;
    const seg2 = this.clothSegments[1];
    seg2.rotation.z = Math.sin(ripple - 0.95) * 0.075;
    const seg3 = this.clothSegments[2];
    seg3.rotation.z = Math.sin(ripple - 1.9) * 0.095;
    seg3.scaling.y = 1 + Math.sin(elapsed * 5.5) * 0.03;
    this.tail.rotation.z = -0.34 + Math.sin(ripple - 2.6) * 0.1;
  }

  private setClothMaterial(material: Mesh['material']): void {
    for (const segment of this.clothSegments) segment.material = material;
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
