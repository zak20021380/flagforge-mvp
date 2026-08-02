import {
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import {
  BLUE_CASTLE_ROOT_X,
  BLUE_CASTLE_ROOT_Z,
  ENEMY_CASTLE_ASSAULT,
  PORTRAIT_LAYOUT,
  RED_CASTLE_ROOT_X,
  RED_CASTLE_ROOT_Z,
} from '../core/config';
import type { Team } from '../core/types';
import { MaterialLibrary } from './materials';

type BoxOptions = { receiveShadow?: boolean };

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
  private readonly baseX: number;
  private readonly baseZ: number;
  private readonly facing: number;

  constructor(scene: Scene, materials: MaterialLibrary, team: Team) {
    this.team = team;
    this.baseX = team === 'blue' ? BLUE_CASTLE_ROOT_X : RED_CASTLE_ROOT_X;
    this.baseZ = team === 'blue' ? BLUE_CASTLE_ROOT_Z : RED_CASTLE_ROOT_Z;
    this.facing = team === 'blue' ? 1 : -1;
    this.root = new TransformNode(`${team}-castle-root`, scene);
    this.root.position.set(this.baseX, 0, this.baseZ);
    this.root.scaling.x = PORTRAIT_LAYOUT.arena.castleWidthScale;
    this.root.rotationQuaternion = Quaternion.Identity();

    const createBox = (name: string, width: number, height: number, depth: number, position: Vector3, material = materials.castleStone, options: BoxOptions = {}): Mesh => {
      const mesh = MeshBuilder.CreateBox(`${team}-${name}`, { width, height, depth }, scene);
      mesh.position.copyFrom(position);
      mesh.parent = this.root;
      mesh.material = material;
      mesh.receiveShadows = options.receiveShadow ?? true;
      return mesh;
    };

    // ---- Keep: tall rear block with plinth, quoins, cornice and a tiered roof ----
    createBox('keep-plinth', 10.2, 0.6, 7.8, new Vector3(0, 0.3, -2.7 * this.facing), materials.castleStoneDark);
    const keep = createBox('keep', 9.4, 7.6, 7.2, new Vector3(0, 3.8, -2.7 * this.facing), materials.castleStone);
    keep.scaling.x = 1.02;
    for (const side of [-1, 1]) {
      createBox(`keep-quoin-front-${side}`, 0.6, 7.3, 0.6, new Vector3(side * 4.68, 3.9, -2.7 * this.facing + 3.45), materials.castleStoneLight, { receiveShadow: false });
      createBox(`keep-quoin-back-${side}`, 0.6, 7.3, 0.6, new Vector3(side * 4.68, 3.9, -2.7 * this.facing - 3.45), materials.castleStoneLight, { receiveShadow: false });
    }
    createBox('keep-cornice', 10, 0.34, 7.8, new Vector3(0, 7.3, -2.7 * this.facing), materials.castleStoneLight);
    const roof = materials.roofTeam(team);
    createBox('keep-cap', 10, 0.5, 7.8, new Vector3(0, 7.74, -2.7 * this.facing), roof);
    createBox('keep-cap-tier', 8.4, 0.42, 6.5, new Vector3(0, 8.18, -2.7 * this.facing), roof);
    createBattlements(scene, this.root, materials, team, new Vector3(0, 8.35, -2.7 * this.facing), 9.8, 7.8, this.facing);

    // ---- Curtain walls with base plinths and a light string course ----
    createBox('wall-left', 5.2, 4.6, 2.2, new Vector3(-7.2, 2.3, 1.3 * this.facing));
    createBox('wall-right', 5.2, 4.6, 2.2, new Vector3(7.2, 2.3, 1.3 * this.facing));
    createBox('wall-plinth-left', 5.6, 0.5, 2.3, new Vector3(-7.2, 0.25, 1.3 * this.facing), materials.castleStoneDark);
    createBox('wall-plinth-right', 5.6, 0.5, 2.3, new Vector3(7.2, 0.25, 1.3 * this.facing), materials.castleStoneDark);
    createBox('wall-string-left', 5.5, 0.28, 2.2, new Vector3(-7.2, 2.05, 1.3 * this.facing), materials.castleStoneLight, { receiveShadow: false });
    createBox('wall-string-right', 5.5, 0.28, 2.2, new Vector3(7.2, 2.05, 1.3 * this.facing), materials.castleStoneLight, { receiveShadow: false });
    createBox('wall-side-left', 2.1, 4.3, 8.2, new Vector3(-10.7, 2.15, -2.0 * this.facing));
    createBox('wall-side-right', 2.1, 4.3, 8.2, new Vector3(10.7, 2.15, -2.0 * this.facing));
    createBox('wall-side-plinth-left', 2.5, 0.5, 8.6, new Vector3(-10.7, 0.25, -2.0 * this.facing), materials.castleStoneDark);
    createBox('wall-side-plinth-right', 2.5, 0.5, 8.6, new Vector3(10.7, 0.25, -2.0 * this.facing), materials.castleStoneDark);

    createTower(scene, this.root, materials, team, new Vector3(-10.6, 0, 1.3 * this.facing));
    createTower(scene, this.root, materials, team, new Vector3(10.6, 0, 1.3 * this.facing));

    // ---- Gatehouse: layered pillars, lintel crown, and two turreted pylons ----
    const archLeft = createBox('gate-pillar-left', 2.5, 5.8, 2.8, new Vector3(-3.7, 2.9, 1.4 * this.facing), materials.castleStoneDark);
    const archRight = createBox('gate-pillar-right', 2.5, 5.8, 2.8, new Vector3(3.7, 2.9, 1.4 * this.facing), materials.castleStoneDark);
    archLeft.rotation.z = 0.015;
    archRight.rotation.z = -0.015;
    createBox('gate-lintel', 9.7, 1.6, 3.2, new Vector3(0, 6.1, 1.4 * this.facing), materials.castleStoneDark);
    createBox('gate-plinth-left', 2.9, 0.5, 3.2, new Vector3(-3.7, 0.25, 1.4 * this.facing), materials.castleStoneDark);
    createBox('gate-plinth-right', 2.9, 0.5, 3.2, new Vector3(3.7, 0.25, 1.4 * this.facing), materials.castleStoneDark);
    createBox('gate-trim-left', 0.5, 5.5, 0.3, new Vector3(-2.58, 2.85, 2.9 * this.facing), materials.castleStoneLight, { receiveShadow: false });
    createBox('gate-trim-right', 0.5, 5.5, 0.3, new Vector3(2.58, 2.85, 2.9 * this.facing), materials.castleStoneLight, { receiveShadow: false });
    createBox('gate-corbel-left', 0.75, 0.3, 0.5, new Vector3(-3.4, 5.45, 2.9 * this.facing), materials.castleStoneLight, { receiveShadow: false });
    createBox('gate-corbel-right', 0.75, 0.3, 0.5, new Vector3(3.4, 5.45, 2.9 * this.facing), materials.castleStoneLight, { receiveShadow: false });
    for (let i = -3; i <= 3; i += 1) {
      const isKey = i === 0;
      const block = MeshBuilder.CreateBox(`${team}-gate-merlon-${i}`, {
        width: isKey ? 0.8 : 0.6,
        height: isKey ? 0.8 : 0.62,
        depth: 0.55,
      }, scene);
      block.parent = this.root;
      block.position = new Vector3(i * 0.8, isKey ? 7.3 : 7.21, 1.3 * this.facing);
      block.material = materials.castleStoneLight;
      block.receiveShadows = false;
    }
    createTurret(scene, this.root, materials, team, -3.7, 1.4 * this.facing);
    createTurret(scene, this.root, materials, team, 3.7, 1.4 * this.facing);

    this.gate = new TransformNode(`${team}-gate-root`, scene);
    this.gate.parent = this.root;
    this.gate.position = new Vector3(0, 0, 2.0 * this.facing);
    for (const [index, x] of [-1.98, -0.66, 0.66, 1.98].entries()) {
      const plank = MeshBuilder.CreateBox(`${team}-gate-plank-${index}`, { width: 1.32, height: 5.25, depth: 0.5 }, scene);
      plank.parent = this.gate;
      plank.position = new Vector3(x, 2.62, 0);
      plank.material = index % 2 === 0 ? materials.gateWood : materials.gateWoodLight;
    }
    const kick = MeshBuilder.CreateBox(`${team}-gate-kick`, { width: 5.5, height: 0.14, depth: 0.66 }, scene);
    kick.parent = this.gate;
    kick.position = new Vector3(0, 0.1, 0);
    kick.material = materials.metal;
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
      createAssaultLadder(scene, this.root, materials, 'left', this.baseX, this.baseZ);
      createAssaultLadder(scene, this.root, materials, 'right', this.baseX, this.baseZ);
    }

    this.breachGlow = MeshBuilder.CreateTorus(`${team}-breach-glow`, { diameter: 5.4, thickness: 0.18, tessellation: 40 }, scene);
    this.breachGlow.parent = this.root;
    this.breachGlow.position = new Vector3(0, 0.16, -1.1 * this.facing);
    this.breachGlow.rotation.x = Math.PI / 2;
    this.breachGlow.material = materials.teamGlow(team);
    this.breachGlow.setEnabled(false);

    this.interiorPoint = new Vector3(this.baseX, 0.2, this.baseZ - PORTRAIT_LAYOUT.arena.interiorOffset * this.facing);
    this.deliveryPoint = new Vector3(this.baseX, 0.2, this.baseZ + PORTRAIT_LAYOUT.arena.deliveryOffset * this.facing);
    this.gatePoint = new Vector3(this.baseX, 0.2, this.baseZ + PORTRAIT_LAYOUT.arena.gateOffset * this.facing);
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
  castleBaseX: number,
  castleBaseZ: number,
): void {
  const ladder = ENEMY_CASTLE_ASSAULT.ladders[id];
  const widthScale = PORTRAIT_LAYOUT.arena.castleWidthScale;
  const localX = (ladder.groundAlign.x - castleBaseX) / widthScale;
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
  const tower = MeshBuilder.CreateCylinder(`${team}-tower`, {
    height: 7.1,
    diameterBottom: 5.3,
    diameterTop: 4.85,
    tessellation: 12,
  }, scene);
  tower.parent = parent;
  tower.position = new Vector3(position.x, 3.55, position.z);
  tower.material = materials.castleStone;
  tower.receiveShadows = true;

  const plinth = MeshBuilder.CreateCylinder(`${team}-tower-plinth`, {
    height: 0.45,
    diameter: 5.7,
    tessellation: 12,
  }, scene);
  plinth.parent = parent;
  plinth.position = new Vector3(position.x, 0.225, position.z);
  plinth.material = materials.castleStoneDark;
  plinth.receiveShadows = true;

  const ring = MeshBuilder.CreateCylinder(`${team}-tower-trim`, {
    height: 0.3,
    diameterBottom: 5.4,
    diameterTop: 5.6,
    tessellation: 12,
  }, scene);
  ring.parent = parent;
  ring.position = new Vector3(position.x, 7.1, position.z);
  ring.material = materials.castleStoneLight;
  ring.receiveShadows = true;

  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const battlement = MeshBuilder.CreateBox(`${team}-tower-battlement-${position.x}-${i}`, { width: 0.85, height: 0.8, depth: 0.65 }, scene);
    battlement.parent = parent;
    battlement.position = new Vector3(position.x + Math.sin(angle) * 2.5, 7.65, position.z + Math.cos(angle) * 2.5);
    battlement.rotation.y = angle;
    battlement.material = materials.castleStoneLight;
    battlement.isPickable = false;
  }

  const cone = MeshBuilder.CreateCylinder(`${team}-tower-roof`, {
    height: 1.0,
    diameterBottom: 4.7,
    diameterTop: 0.4,
    tessellation: 12,
  }, scene);
  cone.parent = parent;
  cone.position = new Vector3(position.x, 7.8, position.z);
  cone.material = materials.roofTeam(team);
  cone.receiveShadows = true;

  const finial = MeshBuilder.CreateSphere(`${team}-tower-finial`, { diameter: 0.4, segments: 6 }, scene);
  finial.parent = parent;
  finial.position = new Vector3(position.x, 8.45, position.z);
  finial.material = materials.gold;
  finial.isPickable = false;
}

function createTurret(scene: Scene, parent: TransformNode, materials: MaterialLibrary, team: Team, x: number, z: number): void {
  const body = MeshBuilder.CreateBox(`${team}-gate-turret-${x}`, { width: 1.7, height: 2.15, depth: 1.7 }, scene);
  body.parent = parent;
  body.position = new Vector3(x, 6.85, z);
  body.material = materials.castleStone;
  body.receiveShadows = true;

  const roof = MeshBuilder.CreateCylinder(`${team}-gate-turret-roof-${x}`, {
    height: 0.6,
    diameterBottom: 2.0,
    diameterTop: 0.2,
    tessellation: 8,
  }, scene);
  roof.parent = parent;
  roof.position = new Vector3(x, 8.24, z);
  roof.material = materials.roofTeam(team);
  roof.receiveShadows = true;

  const finial = MeshBuilder.CreateSphere(`${team}-gate-turret-finial-${x}`, { diameter: 0.26, segments: 6 }, scene);
  finial.parent = parent;
  finial.position = new Vector3(x, 8.64, z);
  finial.material = materials.gold;
  finial.isPickable = false;
}

function createBattlements(scene: Scene, parent: TransformNode, materials: MaterialLibrary, team: Team, center: Vector3, width: number, depth: number, facing: number): void {
  const frontZ = (depth / 2) * facing;
  const backZ = -(depth / 2) * facing;
  for (let x = -width / 2 + 0.7; x <= width / 2 - 0.7; x += 1.55) {
    for (const z of [backZ, frontZ]) {
      // The camera-facing row stops short of the gatehouse turrets.
      if (z === frontZ && Math.abs(x) > 2.75) continue;
      const block = MeshBuilder.CreateBox(`${team}-keep-battlement-x-${x}-${z}`, { width: 0.9, height: 0.9, depth: 0.78 }, scene);
      block.parent = parent;
      block.position = new Vector3(center.x + x, center.y, center.z + z);
      block.material = materials.castleStoneLight;
    }
  }
  for (let z = -depth / 2 + 1.25; z <= depth / 2 - 1.25; z += 1.65) {
    for (const x of [-width / 2, width / 2]) {
      const block = MeshBuilder.CreateBox(`${team}-keep-battlement-z-${x}-${z}`, { width: 0.78, height: 0.9, depth: 0.9 }, scene);
      block.parent = parent;
      block.position = new Vector3(center.x + x, center.y, center.z + z);
      block.material = materials.castleStoneLight;
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
  const finial = MeshBuilder.CreateSphere(`${team}-banner-finial`, { diameter: 0.24, segments: 6 }, scene);
  finial.parent = parent;
  finial.position = new Vector3(position.x, position.y + 2.55, position.z);
  finial.material = materials.gold;
  finial.isPickable = false;
}
