import {
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { ENEMY_CASTLE_ASSAULT, PORTRAIT_LAYOUT } from '../core/config';
import type { Team } from '../core/types';
import { MaterialLibrary } from './materials';

export class CastleVisual {
  readonly team: Team;
  readonly root: TransformNode;
  readonly gate: TransformNode;
  readonly interiorPoint: Vector3;
  readonly deliveryPoint: Vector3;
  readonly gatePoint: Vector3;
  readonly breachGlow: Mesh;
  private gateProgress = 0;
  private gateTarget = 0;
  private readonly baseZ: number;
  private readonly facing: number;

  constructor(scene: Scene, materials: MaterialLibrary, team: Team) {
    this.team = team;
    this.baseZ = team === 'blue' ? -PORTRAIT_LAYOUT.arena.castleZ : PORTRAIT_LAYOUT.arena.castleZ;
    this.facing = team === 'blue' ? 1 : -1;
    this.root = new TransformNode(`${team}-castle-root`, scene);
    this.root.position.z = this.baseZ;
    this.root.scaling.x = PORTRAIT_LAYOUT.arena.castleWidthScale;
    this.root.rotationQuaternion = Quaternion.Identity();

    const createBox = (name: string, width: number, height: number, depth: number, position: Vector3, material = materials.stone): Mesh => {
      const mesh = MeshBuilder.CreateBox(`${team}-${name}`, { width, height, depth, faceColors: undefined }, scene);
      mesh.position.copyFrom(position);
      mesh.parent = this.root;
      mesh.material = material;
      mesh.receiveShadows = true;
      return mesh;
    };

    const keep = createBox('keep', 9.4, 7.6, 7.2, new Vector3(0, 3.8, -2.7 * this.facing), materials.stoneDark);
    keep.scaling.x = 1.02;
    createBox('keep-cap', 10, 0.8, 7.8, new Vector3(0, 7.85, -2.7 * this.facing), materials.teamDark(team));
    createBattlements(scene, this.root, materials, team, new Vector3(0, 8.35, -2.7 * this.facing), 9.8, 7.8);

    createBox('wall-left', 5.2, 4.6, 2.2, new Vector3(-7.2, 2.3, 1.3 * this.facing));
    createBox('wall-right', 5.2, 4.6, 2.2, new Vector3(7.2, 2.3, 1.3 * this.facing));
    createBox('wall-side-left', 2.1, 4.3, 8.2, new Vector3(-10.7, 2.15, -2.0 * this.facing));
    createBox('wall-side-right', 2.1, 4.3, 8.2, new Vector3(10.7, 2.15, -2.0 * this.facing));

    createTower(scene, this.root, materials, team, new Vector3(-10.6, 0, 1.3 * this.facing));
    createTower(scene, this.root, materials, team, new Vector3(10.6, 0, 1.3 * this.facing));

    const archLeft = createBox('gate-pillar-left', 2.5, 5.8, 2.8, new Vector3(-3.7, 2.9, 1.4 * this.facing), materials.stoneDark);
    const archRight = createBox('gate-pillar-right', 2.5, 5.8, 2.8, new Vector3(3.7, 2.9, 1.4 * this.facing), materials.stoneDark);
    archLeft.rotation.z = 0.015;
    archRight.rotation.z = -0.015;
    createBox('gate-lintel', 9.7, 1.6, 3.2, new Vector3(0, 6.1, 1.4 * this.facing), materials.stoneDark);

    this.gate = new TransformNode(`${team}-gate-root`, scene);
    this.gate.parent = this.root;
    this.gate.position = new Vector3(0, 0, 2.0 * this.facing);
    const gateDoor = MeshBuilder.CreateBox(`${team}-gate-door`, { width: 5.3, height: 5.25, depth: 0.52 }, scene);
    gateDoor.parent = this.gate;
    gateDoor.position.y = 2.62;
    gateDoor.material = materials.wood;
    for (let i = -2; i <= 2; i += 1) {
      const bar = MeshBuilder.CreateBox(`${team}-gate-bar-${i}`, { width: 0.16, height: 5.35, depth: 0.62 }, scene);
      bar.parent = this.gate;
      bar.position = new Vector3(i * 1.04, 2.62, 0);
      bar.material = materials.metal;
    }
    const crossbar = MeshBuilder.CreateBox(`${team}-gate-crossbar`, { width: 5.5, height: 0.26, depth: 0.7 }, scene);
    crossbar.parent = this.gate;
    crossbar.position = new Vector3(0, 2.85, 0);
    crossbar.material = materials.metal;

    createBanner(scene, this.root, materials, team, new Vector3(-4.4, 5.7, 3.0 * this.facing));
    createBanner(scene, this.root, materials, team, new Vector3(4.4, 5.7, 3.0 * this.facing));

    // Only the portrait-facing red castle is the enemy assault objective. Two
    // authored ladders sit on its left/right wall faces and match the AI paths.
    if (team === 'red') {
      createAssaultLadder(scene, this.root, materials, 'left', this.baseZ);
      createAssaultLadder(scene, this.root, materials, 'right', this.baseZ);
    }

    this.breachGlow = MeshBuilder.CreateTorus(`${team}-breach-glow`, { diameter: 5.4, thickness: 0.18, tessellation: 40 }, scene);
    this.breachGlow.parent = this.root;
    this.breachGlow.position = new Vector3(0, 0.16, -1.1 * this.facing);
    this.breachGlow.rotation.x = Math.PI / 2;
    this.breachGlow.material = materials.teamGlow(team);
    this.breachGlow.setEnabled(false);

    this.interiorPoint = new Vector3(0, 0.2, this.baseZ - PORTRAIT_LAYOUT.arena.interiorOffset * this.facing);
    this.deliveryPoint = new Vector3(0, 0.2, this.baseZ + PORTRAIT_LAYOUT.arena.deliveryOffset * this.facing);
    this.gatePoint = new Vector3(0, 0.2, this.baseZ + PORTRAIT_LAYOUT.arena.gateOffset * this.facing);
  }

  setGateOpen(open: boolean): void {
    this.gateTarget = open ? 1 : 0;
  }

  setBreached(breached: boolean): void {
    this.breachGlow.setEnabled(breached);
  }

  update(deltaSeconds: number, elapsed: number): void {
    const speed = 1.8;
    this.gateProgress += (this.gateTarget - this.gateProgress) * Math.min(1, deltaSeconds * speed);
    const eased = this.gateProgress * this.gateProgress * (3 - 2 * this.gateProgress);
    this.gate.position.y = eased * 5.35;
    if (this.breachGlow.isEnabled()) {
      this.breachGlow.scaling.setAll(1 + Math.sin(elapsed * 5) * 0.05);
      this.breachGlow.rotation.z += deltaSeconds * 0.65;
    }
  }
}

function createAssaultLadder(
  scene: Scene,
  parent: TransformNode,
  materials: MaterialLibrary,
  id: keyof typeof ENEMY_CASTLE_ASSAULT.ladders,
  castleBaseZ: number,
): void {
  const ladder = ENEMY_CASTLE_ASSAULT.ladders[id];
  const widthScale = PORTRAIT_LAYOUT.arena.castleWidthScale;
  const localX = ladder.groundAlign.x / widthScale;
  const bottomY = ladder.groundAlign.y;
  const bottomZ = ladder.groundAlign.z - castleBaseZ;
  const topY = ladder.climbTop.y;
  const topZ = ladder.climbTop.z - castleBaseZ;
  const deltaY = topY - bottomY;
  const deltaZ = topZ - bottomZ;
  const length = Math.hypot(deltaY, deltaZ);
  const pitch = Math.atan2(deltaZ, deltaY);

  for (const [index, xOffset] of [-0.72, 0.72].entries()) {
    const rail = MeshBuilder.CreateCylinder(`red-castle-ladder-${id}-rail-${index}`, {
      height: length,
      diameter: 0.21,
      tessellation: 7,
    }, scene);
    rail.parent = parent;
    rail.position.set(localX + xOffset / widthScale, (bottomY + topY) / 2, (bottomZ + topZ) / 2);
    rail.rotation.x = pitch;
    rail.material = materials.wood;
    rail.isPickable = false;
  }

  const rungCount = 12;
  const rungSource = MeshBuilder.CreateBox(`red-castle-ladder-${id}-rung-source`, {
    width: 1.62 / widthScale,
    height: 0.15,
    depth: 0.2,
  }, scene);
  rungSource.parent = parent;
  rungSource.material = materials.stoneLight;
  rungSource.isPickable = false;
  for (let index = 0; index < rungCount; index += 1) {
    const progress = (index + 0.5) / rungCount;
    const rung = index === 0 ? rungSource : rungSource.createInstance(`red-castle-ladder-${id}-rung-${index}`);
    rung.parent = parent;
    rung.position.set(localX, bottomY + deltaY * progress, bottomZ + deltaZ * progress);
    rung.rotation.x = pitch;
    rung.isPickable = false;
  }

  const landing = MeshBuilder.CreateBox(`red-castle-ladder-${id}-queue-landing`, {
    width: 2.25 / widthScale,
    height: 0.16,
    depth: 1.18,
  }, scene);
  landing.parent = parent;
  landing.position.set(localX, 0.1, ladder.groundEntry.z - castleBaseZ - 0.12);
  landing.material = materials.road;
  landing.receiveShadows = true;
  landing.isPickable = false;

  for (const [index, y] of [0.42, topY - 0.2].entries()) {
    const brace = MeshBuilder.CreateBox(`red-castle-ladder-${id}-brace-${index}`, {
      width: 1.9 / widthScale,
      height: 0.18,
      depth: 0.28,
    }, scene);
    brace.parent = parent;
    const progress = (y - bottomY) / Math.max(0.001, deltaY);
    brace.position.set(localX, y, bottomZ + deltaZ * progress);
    brace.rotation.x = pitch;
    brace.material = materials.gold;
    brace.isPickable = false;
  }
}

function createTower(scene: Scene, parent: TransformNode, materials: MaterialLibrary, team: Team, position: Vector3): void {
  const tower = MeshBuilder.CreateCylinder(`${team}-tower`, { height: 7.1, diameter: 5.2, tessellation: 8 }, scene);
  tower.parent = parent;
  tower.position = new Vector3(position.x, 3.55, position.z);
  tower.material = materials.stone;
  tower.receiveShadows = true;

  const cap = MeshBuilder.CreateCylinder(`${team}-tower-cap`, { height: 0.82, diameterTop: 5.8, diameterBottom: 5.5, tessellation: 8 }, scene);
  cap.parent = parent;
  cap.position = new Vector3(position.x, 7.35, position.z);
  cap.material = materials.teamDark(team);

  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const battlement = MeshBuilder.CreateBox(`${team}-tower-battlement-${position.x}-${i}`, { width: 1, height: 0.9, depth: 0.75 }, scene);
    battlement.parent = parent;
    battlement.position = new Vector3(position.x + Math.sin(angle) * 2.35, 8.05, position.z + Math.cos(angle) * 2.35);
    battlement.rotation.y = angle;
    battlement.material = materials.stoneDark;
  }
}

function createBattlements(scene: Scene, parent: TransformNode, materials: MaterialLibrary, team: Team, center: Vector3, width: number, depth: number): void {
  for (let x = -width / 2 + 0.7; x <= width / 2 - 0.7; x += 1.55) {
    for (const z of [-depth / 2, depth / 2]) {
      const block = MeshBuilder.CreateBox(`${team}-keep-battlement-x-${x}-${z}`, { width: 0.9, height: 0.9, depth: 0.78 }, scene);
      block.parent = parent;
      block.position = new Vector3(center.x + x, center.y, center.z + z);
      block.material = materials.stone;
    }
  }
  for (let z = -depth / 2 + 1.25; z <= depth / 2 - 1.25; z += 1.65) {
    for (const x of [-width / 2, width / 2]) {
      const block = MeshBuilder.CreateBox(`${team}-keep-battlement-z-${x}-${z}`, { width: 0.78, height: 0.9, depth: 0.9 }, scene);
      block.parent = parent;
      block.position = new Vector3(center.x + x, center.y, center.z + z);
      block.material = materials.stone;
    }
  }
}

function createBanner(scene: Scene, parent: TransformNode, materials: MaterialLibrary, team: Team, position: Vector3): void {
  const pole = MeshBuilder.CreateCylinder(`${team}-banner-pole`, { height: 4.7, diameter: 0.14, tessellation: 8 }, scene);
  pole.parent = parent;
  pole.position = position;
  pole.material = materials.metal;
  const banner = MeshBuilder.CreateBox(`${team}-banner-cloth`, { width: 1.55, height: 2.15, depth: 0.08 }, scene);
  banner.parent = parent;
  banner.position = new Vector3(position.x + 0.78, position.y + 0.65, position.z);
  banner.material = materials.team(team);
}
