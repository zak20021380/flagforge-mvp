import {
  Mesh,
  MeshBuilder,
  Scene,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core';
import { CENTRAL_TOWER, CONFIG } from '../core/config';
import type { Team } from '../core/types';
import { squaredDistanceXZ } from '../core/math';
import { MaterialLibrary } from '../render/materials';
import type { UnitEntity } from './unit';

export type FlagStatus = 'neutral' | 'carried' | 'delivering' | 'dropped' | 'consumed';

const PLACEMENT_DURATION = 1.2;

// Banner cloth dimensions. The cloth is horizontal: it flies out from the pole toward +X with its
// front face toward the gameplay camera (-Z; the portrait camera sits south of the tower and the
// sun lights that side). The fly end carries a subtle swallowtail V-cut.
const BANNER_WIDTH = 3.0;
const BANNER_HEIGHT = 1.8;
const BANNER_COLUMNS = 8;
const BANNER_ROWS = 4;
const BANNER_CUT_DEPTH = 0.5;
// Hoist edge sits just outside the pole surface (pole diameter 0.16).
const BANNER_HOIST_OFFSET = 0.09;

// Lightweight wind ripple: two travelling sine waves whose amplitude grows toward the fly end,
// plus a whisper of vertical flutter. All displacement is pinned to zero at the hoist column.
const WIND_SPEED = 3.0;
const WIND_FREQUENCY = 8.0;
const WIND_AMPLITUDE = 0.28;
const FOLD_FREQUENCY = 13.0;
const FOLD_AMPLITUDE = 0.08;
const FLUTTER_SPEED = 2.3;
const FLUTTER_AMPLITUDE = 0.055;

function placementEase(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  if (c < 0.5) return 4 * c * c * c;
  const f = -2 * c + 2;
  return 1 - (f * f * f) / 2;
}

export class FlagController {
  readonly root: TransformNode;
  private readonly banner: Mesh;
  private readonly attach: TransformNode;
  private readonly carrierRing: Mesh;
  private readonly bannerVertexCount: number;
  private readonly bannerPositions: Float32Array;
  private readonly bannerNormals: Float32Array;
  private readonly bannerRest: Float32Array;
  private readonly bannerIndices: number[];
  private carrier: UnitEntity | null = null;
  private status: FlagStatus = 'neutral';
  private lastDeliveredTeamField: Team | null = null;
  private placementTimer = 0;
  private placementStartPos = Vector3.Zero();
  private placementEndPos = Vector3.Zero();
  private placementActive = false;

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

    // Taller, cleaner flagpole with a gold base collar where the banner is bound, so the main
    // objective reads clearly above the tower crown from the portrait camera.
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

    const ferrule = MeshBuilder.CreateCylinder('central-flag-ferrule', { height: 0.16, diameter: 0.26, tessellation: 8 }, scene);
    ferrule.parent = this.root;
    ferrule.position.y = poleHeight - 0.05;
    ferrule.material = materials.gold;
    ferrule.isPickable = false;

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

    // The banner flies horizontally from the pole, bound along its hoist (left) edge. The attach
    // node sits at the hoist midpoint so the whole cloth shares one pivot for carrying and scaling.
    const clothTop = poleHeight - 0.38;
    this.attach = new TransformNode('central-flag-attach', scene);
    this.attach.parent = this.root;
    this.attach.position.set(0, clothTop - BANNER_HEIGHT / 2, 0);

    // Coarse 8x4 vertex grid (45 vertices) so the whole cloth can be re-deformed every frame by a
    // lightweight sine wave instead of cloth physics. The fly edge carries a subtle swallowtail
    // V-cut; the hoist column stays pinned to the pole. Triangle winding puts the front face
    // toward -Z (the gameplay camera and the sun) so the emblem can never render mirrored or
    // fall in the unlit shadow side of the tower.
    const bannerColumns = BANNER_COLUMNS + 1;
    const bannerRows = BANNER_ROWS + 1;
    this.bannerVertexCount = bannerColumns * bannerRows;
    this.bannerPositions = new Float32Array(this.bannerVertexCount * 3);
    this.bannerNormals = new Float32Array(this.bannerVertexCount * 3);
    this.bannerRest = new Float32Array(this.bannerVertexCount * 2);
    const bannerUvs: number[] = [];
    this.bannerIndices = [];
    for (let row = 0; row < bannerRows; row += 1) {
      const s = row / BANNER_ROWS;
      const notch = BANNER_CUT_DEPTH * (1 - Math.abs(2 * s - 1));
      for (let column = 0; column < bannerColumns; column += 1) {
        const t = column / BANNER_COLUMNS;
        const index = row * bannerColumns + column;
        const restX = (BANNER_WIDTH - notch) * t;
        const restY = (s - 0.5) * BANNER_HEIGHT;
        this.bannerRest[index * 2] = restX;
        this.bannerRest[index * 2 + 1] = restY;
        this.bannerPositions[index * 3] = restX;
        this.bannerPositions[index * 3 + 1] = restY;
        this.bannerPositions[index * 3 + 2] = 0;
        // Canvas top (crown) maps to the cloth's upper edge along the pole, so the emblem reads
        // upright from the camera: u runs hoist -> fly, v runs cloth top -> bottom (canvas bottom).
        bannerUvs.push(t, 1 - s);
      }
    }
    for (let row = 0; row < BANNER_ROWS; row += 1) {
      for (let column = 0; column < BANNER_COLUMNS; column += 1) {
        const a = row * bannerColumns + column;
        const b = a + 1;
        const c = a + bannerColumns;
        const d = c + 1;
        // Winding matches Babylon's ComputeNormals convention so the face toward the camera (-Z,
        // the portrait camera sits south of the tower and the sun lights that side) is the front
        // face and the emblem can never render mirrored.
        this.bannerIndices.push(a, b, c, b, d, c);
      }
    }
    const bannerData = new VertexData();
    bannerData.positions = this.bannerPositions;
    bannerData.normals = this.bannerNormals;
    bannerData.uvs = bannerUvs;
    bannerData.indices = this.bannerIndices;
    VertexData.ComputeNormals(this.bannerPositions, this.bannerIndices, this.bannerNormals);
    const banner = new Mesh('central-flag-banner', scene);
    bannerData.applyToMesh(banner, false);
    banner.parent = this.attach;
    banner.position.set(BANNER_HOIST_OFFSET, 0, 0);
    banner.material = materials.flagNeutral;
    banner.isPickable = false;
    this.banner = banner;

    // Gold binding collars pin the hoist edge of the cloth to the pole at the banner's upper and
    // lower quarters, so the banner reads as properly mounted on the pole.
    for (const offset of [0.45, 1.35]) {
      const binding = MeshBuilder.CreateCylinder('central-flag-binding', { height: 0.16, diameter: 0.27, tessellation: 8 }, scene);
      binding.parent = this.root;
      binding.position.set(0, clothTop - offset, 0);
      binding.material = materials.gold;
      binding.isPickable = false;
    }

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

  get isPlacing(): boolean {
    return this.status === 'delivering';
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
    this.setClothMaterial(this.materials.flagTeam(unit.team));
    this.carrierRing.parent = unit.rig.root;
    this.carrierRing.position.set(0, 0.12, 0);
    this.carrierRing.material = this.materials.teamGlow(unit.team);
    this.carrierRing.setEnabled(true);
    this.onPickup(unit.team);
    return true;
  }

  tryDeliver(unit: UnitEntity, deliveryPoint: Vector3, placementTarget?: Vector3): boolean {
    if (this.carrier !== unit || this.status !== 'carried') return false;
    if (squaredDistanceXZ(unit.position, deliveryPoint) > 1.7 ** 2) return false;
    unit.carryingFlag = false;
    this.carrier = null;
    this.lastDeliveredTeamField = unit.team;
    this.carrierRing.parent = null;
    this.carrierRing.setEnabled(false);
    const startPos = this.root.getAbsolutePosition().clone();
    this.root.parent = null;
    this.root.position.copyFrom(startPos);
    this.root.scaling.setAll(0.76);
    this.placementStartPos.copyFrom(startPos);
    this.placementEndPos.copyFrom(placementTarget ?? deliveryPoint);
    this.placementTimer = 0;
    this.placementActive = true;
    this.status = 'delivering';
    return true;
  }

  beginPlacementAnimation(targetPos: Vector3): void {
    if (this.status !== 'delivering') return;
    const startPos = this.root.getAbsolutePosition().clone();
    this.placementStartPos.copyFrom(startPos);
    this.placementEndPos.copyFrom(targetPos);
    this.placementTimer = 0;
    this.placementActive = true;
  }

  finalizeDelivery(): void {
    if (this.status !== 'delivering') return;
    this.status = 'consumed';
    this.placementActive = false;
    this.root.setEnabled(false);
    this.onDelivered(this.lastDeliveredTeamField!);
  }

  dropFrom(unit: UnitEntity): void {
    if (this.status === 'delivering') {
      this.placementActive = false;
      this.status = 'dropped';
      this.root.parent = null;
      this.root.scaling.setAll(1);
      this.placeAtSafeDrop(unit);
      this.root.setEnabled(true);
      this.setClothMaterial(this.materials.flagNeutral);
      this.onDropped();
      return;
    }
    if (this.carrier !== unit) return;
    unit.carryingFlag = false;
    this.carrier = null;
    this.status = 'dropped';
    this.root.parent = null;
    this.root.scaling.setAll(1);
    this.placeAtSafeDrop(unit);
    this.root.setEnabled(true);
    this.setClothMaterial(this.materials.flagNeutral);
    this.carrierRing.parent = null;
    this.carrierRing.setEnabled(false);
    this.onDropped();
  }

  update(deltaSeconds: number, elapsed: number): void {
    if (this.status === 'consumed') return;

    if (this.placementActive) {
      this.placementTimer += deltaSeconds;
      const progress = Math.min(1, this.placementTimer / PLACEMENT_DURATION);
      const eased = placementEase(progress);
      const px = this.placementStartPos.x + (this.placementEndPos.x - this.placementStartPos.x) * eased;
      const py = this.placementStartPos.y + (this.placementEndPos.y - this.placementStartPos.y) * eased;
      const pz = this.placementStartPos.z + (this.placementEndPos.z - this.placementStartPos.z) * eased;
      this.root.position.set(px, py, pz);
      const scaleDown = 0.76 + (1.0 - 0.76) * eased;
      this.root.scaling.setAll(scaleDown);
      this.updateClothWave(elapsed);
      if (progress >= 1) {
        this.finalizeDelivery();
      }
      return;
    }

    this.updateClothWave(elapsed);
  }

  /**
   * Wind ripple for the horizontal banner. The hoist column stays pinned to the pole while two
   * travelling sine waves (a broad main swell and a tighter harmonic fold) grow toward the free
   * end, plus a whisper of vertical flutter. Normals are recomputed on the fly so the smooth
   * folds catch the sun — ~45 vertices, no cloth physics.
   */
  private updateClothWave(elapsed: number): void {
    const wind = elapsed * WIND_SPEED;
    const columns = BANNER_COLUMNS + 1;
    for (let index = 0; index < this.bannerVertexCount; index += 1) {
      const t = (index % columns) / BANNER_COLUMNS;
      const grow = 0.55 + 0.45 * t;
      const z = t * (
        Math.sin(wind - t * WIND_FREQUENCY) * WIND_AMPLITUDE * grow
        + Math.sin(wind * 1.8 - t * FOLD_FREQUENCY) * FOLD_AMPLITUDE * t
      );
      const y = this.bannerRest[index * 2 + 1] + Math.sin(elapsed * FLUTTER_SPEED + t * 3.3) * FLUTTER_AMPLITUDE * t;
      this.bannerPositions[index * 3] = this.bannerRest[index * 2];
      this.bannerPositions[index * 3 + 1] = y;
      this.bannerPositions[index * 3 + 2] = z;
    }
    VertexData.ComputeNormals(this.bannerPositions, this.bannerIndices, this.bannerNormals);
    this.banner.updateVerticesData(VertexBuffer.PositionKind, this.bannerPositions, true);
    this.banner.updateVerticesData(VertexBuffer.NormalKind, this.bannerNormals, false);
  }

  private setClothMaterial(material: Mesh['material']): void {
    this.banner.material = material;
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
