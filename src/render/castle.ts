import {
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  TransformNode,
  Vector3,
  VertexBuffer,
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
import { smoothStep, StaticBatch, valueNoise } from './decorKit';
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
    // The player keep stands roughly three times closer to the portrait camera than the enemy one,
    // so it is the only castle that gets the extra silhouette work (see dressPlayerCastle below).
    const hero = team === 'blue';
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

    createTower(scene, this.root, materials, team, new Vector3(-10.6, 0, 1.3 * this.facing), hero);
    createTower(scene, this.root, materials, team, new Vector3(10.6, 0, 1.3 * this.facing), hero);

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
    createTurret(scene, this.root, materials, team, -3.7, 1.4 * this.facing, hero);
    createTurret(scene, this.root, materials, team, 3.7, 1.4 * this.facing, hero);

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

    if (hero) {
      dressPlayerCastle(scene, this.root, materials, this.facing);
      shadeCastleStone(this.root);
    }

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

function createTower(scene: Scene, parent: TransformNode, materials: MaterialLibrary, team: Team, position: Vector3, hero = false): void {
  // Rounder barrels and a proper spire instead of a squat cap: the two changes that decide whether
  // a drum tower reads as architecture or as a toy chess piece at close range.
  const sides = hero ? 16 : 12;
  const tower = MeshBuilder.CreateCylinder(`${team}-tower`, {
    height: 7.1,
    diameterBottom: 5.3,
    diameterTop: 4.85,
    tessellation: sides,
  }, scene);
  tower.parent = parent;
  tower.position = new Vector3(position.x, 3.55, position.z);
  tower.material = materials.castleStone;
  tower.receiveShadows = true;

  const plinth = MeshBuilder.CreateCylinder(`${team}-tower-plinth`, {
    height: 0.45,
    diameter: 5.7,
    tessellation: sides,
  }, scene);
  plinth.parent = parent;
  plinth.position = new Vector3(position.x, 0.225, position.z);
  plinth.material = materials.castleStoneDark;
  plinth.receiveShadows = true;

  const ring = MeshBuilder.CreateCylinder(`${team}-tower-trim`, {
    height: 0.3,
    diameterBottom: 5.4,
    diameterTop: 5.6,
    tessellation: sides,
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

  const cone = MeshBuilder.CreateCylinder(`${team}-tower-roof`, hero
    ? { height: 2.55, diameterBottom: 5.05, diameterTop: 0.07, tessellation: 16 }
    : { height: 1.0, diameterBottom: 4.7, diameterTop: 0.4, tessellation: 12 }, scene);
  cone.parent = parent;
  cone.position = new Vector3(position.x, hero ? 8.675 : 7.8, position.z);
  cone.material = materials.roofTeam(team);
  cone.receiveShadows = true;

  const finial = MeshBuilder.CreateSphere(`${team}-tower-finial`, { diameter: hero ? 0.44 : 0.4, segments: 6 }, scene);
  finial.parent = parent;
  finial.position = new Vector3(position.x, hero ? 10.08 : 8.45, position.z);
  finial.material = materials.gold;
  finial.isPickable = false;
}

function createTurret(scene: Scene, parent: TransformNode, materials: MaterialLibrary, team: Team, x: number, z: number, hero = false): void {
  const body = MeshBuilder.CreateBox(`${team}-gate-turret-${x}`, { width: 1.7, height: 2.15, depth: 1.7 }, scene);
  body.parent = parent;
  body.position = new Vector3(x, 6.85, z);
  body.material = materials.castleStone;
  body.receiveShadows = true;

  const roof = MeshBuilder.CreateCylinder(`${team}-gate-turret-roof-${x}`, hero
    ? { height: 1.15, diameterBottom: 2.12, diameterTop: 0.06, tessellation: 8 }
    : { height: 0.6, diameterBottom: 2.0, diameterTop: 0.2, tessellation: 8 }, scene);
  roof.parent = parent;
  roof.position = new Vector3(x, hero ? 8.645 : 8.24, z);
  roof.material = materials.roofTeam(team);
  roof.receiveShadows = true;

  const finial = MeshBuilder.CreateSphere(`${team}-gate-turret-finial-${x}`, { diameter: hero ? 0.3 : 0.26, segments: 6 }, scene);
  finial.parent = parent;
  finial.position = new Vector3(x, hero ? 9.36 : 8.64, z);
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

/**
 * Bakes cheap ambient occlusion and stone grain into vertex colours. Babylon's PBR shader
 * multiplies albedo by the vertex colour, so every large face gains a grounded gradient plus a
 * little mottling without a texture, an extra material or an extra draw call. This is what stops
 * the flat "plastic block" read at close range.
 */
function shadeCastleStone(root: TransformNode): void {
  for (const mesh of root.getChildMeshes()) {
    if (!(mesh instanceof Mesh)) continue;
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) continue;
    const originY = mesh.position.y;
    const colors = new Float32Array((positions.length / 3) * 4);
    for (let i = 0, c = 0; i < positions.length; i += 3, c += 4) {
      const y = originY + positions[i + 1];
      // Two bands: contact shade in the lower courses, sunlit crown from the parapet upwards.
      const grounded = smoothStep(0, 3.4, y);
      const crown = smoothStep(4.5, 10.6, y);
      const grain = valueNoise(positions[i] * 0.44 + y * 0.29, positions[i + 2] * 0.44 - y * 0.17) - 0.5;
      const tint = 0.79 + grounded * 0.15 + crown * 0.12 + grain * 0.07;
      colors[c] = tint * 1.02;
      colors[c + 1] = tint;
      colors[c + 2] = tint * (1.04 - crown * 0.06);
      colors[c + 3] = 1;
    }
    mesh.setVerticesData(VertexBuffer.ColorKind, colors, false);
  }
}

/**
 * Player-side finishing pass, built on top of the shared castle instead of replacing it.
 *
 * Everything here is medium-scale architecture rather than fine detail: base and string courses,
 * buttresses, a machicolated corbel course, window loops, crenellated wall walks, a real hipped
 * roof over the keep and clean blue-and-gold heraldry. All pieces are authored unparented in
 * castle-local units and merged per material, so the entire pass adds roughly eight draw calls and
 * no per-frame cost; the merged result is then parented to the castle root so it inherits the
 * arena's castle width scale exactly like the hand-built blocks do.
 */
function dressPlayerCastle(scene: Scene, root: TransformNode, materials: MaterialLibrary, facing: number): void {
  const batch = new StaticBatch();
  const outward = -facing;
  const keepZ = -2.7 * facing;
  const keepFaceZ = keepZ + 3.6 * outward;

  const slab = (
    name: string,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: Mesh['material'],
  ): Mesh => {
    const mesh = MeshBuilder.CreateBox(`blue-castle-${name}`, { width, height, depth }, scene);
    mesh.position.set(x, y, z);
    mesh.material = material;
    return batch.add(mesh);
  };

  const ring = (
    name: string,
    height: number,
    diameterBottom: number,
    diameterTop: number,
    x: number,
    y: number,
    z: number,
    material: Mesh['material'],
  ): Mesh => {
    const mesh = MeshBuilder.CreateCylinder(`blue-castle-${name}`, {
      height,
      diameterBottom,
      diameterTop,
      tessellation: 16,
    }, scene);
    mesh.position.set(x, y, z);
    mesh.material = material;
    return batch.add(mesh);
  };

  // ---- Keep: horizontal courses break the single tall block into dressed storeys ----
  slab('keep-base-course', 9.98, 0.3, 7.62, 0, 0.74, keepZ, materials.castleStoneLight);
  slab('keep-string-course', 9.78, 0.26, 7.56, 0, 4.15, keepZ, materials.castleStoneLight);

  // ---- Camera-facing keep wall: buttresses, loops and a machicolated corbel course ----
  for (const side of [-1, 1]) {
    const bx = side * 3.05;
    slab('keep-buttress', 1.12, 6.35, 0.95, bx, 3.18, keepFaceZ + 0.42 * outward, materials.castleStone);
    slab('keep-buttress-foot', 1.44, 0.62, 1.24, bx, 0.31, keepFaceZ + 0.5 * outward, materials.castleStoneDark);
    slab('keep-buttress-cap', 1.34, 0.32, 1.12, bx, 6.51, keepFaceZ + 0.45 * outward, materials.castleStoneLight);

    const lx = side * 1.95;
    slab('keep-loop', 0.26, 1.25, 0.14, lx, 5.5, keepFaceZ + 0.05 * outward, materials.castleStoneDark);
    slab('keep-loop-lintel', 0.78, 0.22, 0.24, lx, 6.28, keepFaceZ + 0.08 * outward, materials.castleStoneLight);
    slab('keep-loop-sill', 0.78, 0.18, 0.26, lx, 4.78, keepFaceZ + 0.1 * outward, materials.castleStoneLight);
  }
  for (let i = -4; i <= 4; i += 1) {
    slab(`keep-corbel-${i}`, 0.42, 0.36, 0.5, i * 0.92, 7.02, keepFaceZ + 0.19 * outward, materials.castleStoneLight);
  }

  // ---- Player heraldry: the one strong colour accent, hung between the two loops ----
  slab('keep-crest-cloth', 2.15, 2.3, 0.2, 0, 5.5, keepFaceZ + 0.14 * outward, materials.blue);
  slab('keep-crest-hem', 2.15, 0.42, 0.24, 0, 4.56, keepFaceZ + 0.16 * outward, materials.blueDark);
  slab('keep-crest-rod', 2.55, 0.17, 0.24, 0, 6.74, keepFaceZ + 0.17 * outward, materials.gold);
  const lozenge = slab('keep-crest-boss', 0.62, 0.62, 0.12, 0, 5.62, keepFaceZ + 0.26 * outward, materials.gold);
  lozenge.rotation.z = Math.PI / 4;

  // ---- Hipped keep roof. A four-gon cylinder is the cheapest true pyramid, but Babylon applies
  // scale before rotation, so the 45 degree turn that squares the base is baked into the vertices
  // first and only then is the depth squashed to the keep footprint. ----
  slab('keep-roof-eave', 8.58, 0.2, 6.62, 0, 8.45, keepZ, materials.roofBlueLight);
  const roofMass = MeshBuilder.CreateCylinder('blue-castle-keep-roof', {
    height: 2.0,
    diameterBottom: 11.4,
    diameterTop: 0.04,
    tessellation: 4,
  }, scene);
  roofMass.rotation.y = Math.PI / 4;
  roofMass.bakeCurrentTransformIntoVertices();
  roofMass.scaling.z = 6.15 / 8.06;
  roofMass.position.set(0, 9.55, keepZ);
  roofMass.material = materials.roofBlue;
  batch.add(roofMass);
  const roofFinial = MeshBuilder.CreateSphere('blue-castle-keep-finial', { diameter: 0.42, segments: 8 }, scene);
  roofFinial.position.set(0, 10.7, keepZ);
  roofFinial.material = materials.gold;
  batch.add(roofFinial);

  // ---- Drum towers: a mid course plus a flared machicolation ring under the parapet ----
  for (const side of [-1, 1]) {
    const tx = side * 10.6;
    const tz = 1.3 * facing;
    ring('tower-course', 0.3, 5.32, 5.28, tx, 3.45, tz, materials.castleStoneLight);
    ring('tower-corbel', 0.52, 4.95, 5.62, tx, 6.79, tz, materials.castleStoneDark);
  }

  // ---- Gatehouse turrets get the eave the taller roofs now sit on ----
  for (const side of [-1, 1]) {
    slab('gate-turret-eave', 2.06, 0.24, 2.06, side * 3.7, 7.95, 1.4 * facing, materials.castleStoneLight);
  }

  // ---- Curtain walls: coping, a recessed wall walk and crenellations, so the walls stop being
  // plain slabs. Merlon spans are chosen to clear the tower barrels and the gate pylons. ----
  for (const side of [-1, 1]) {
    slab('wall-coping', 5.5, 0.22, 2.42, side * 7.2, 4.71, 1.3 * facing, materials.castleStoneLight);
    slab('wall-walk', 4.9, 0.14, 1.15, side * 7.2, 4.89, 0.8 * facing, materials.castleStoneDark);
    for (const mx of [7.9, 6.6, 5.3]) {
      slab(`wall-merlon-${mx}`, 0.92, 0.8, 0.66, side * mx, 5.22, 2.09 * facing, materials.castleStoneLight);
    }

    slab('wall-side-coping', 2.32, 0.22, 8.5, side * 10.7, 4.41, -2.0 * facing, materials.castleStoneLight);
    slab('wall-side-walk', 1.1, 0.14, 7.4, side * 10.2, 4.59, -2.0 * facing, materials.castleStoneDark);
    for (const mz of [-5.4, -3.9, -2.4]) {
      slab(`wall-side-merlon-${mz}`, 0.66, 0.8, 0.92, side * 11.42, 4.92, mz * facing, materials.castleStoneLight);
    }
  }

  // ---- Gate: a segmental voussoir arch with a keystone turns the square opening into a portal,
  // and a hood course above it gives the gatehouse front a shadow line. ----
  const archRadius = 4.3;
  for (let i = -3; i <= 3; i += 1) {
    const angle = i * 0.2;
    const isKey = i === 0;
    const stone = slab(
      `gate-voussoir-${i}`,
      isKey ? 1.0 : 0.9,
      isKey ? 0.74 : 0.56,
      0.42,
      Math.sin(angle) * archRadius,
      1.32 + Math.cos(angle) * archRadius,
      2.95 * facing,
      materials.castleStoneLight,
    );
    stone.rotation.z = -angle;
  }
  slab('gate-hood', 9.9, 0.28, 0.5, 0, 6.72, 3.05 * facing, materials.castleStoneLight);

  // ---- Wall banners: a gold rod and a dark hem finish the existing cloths ----
  for (const side of [-1, 1]) {
    const clothX = side * 4.4 + 0.78;
    slab('banner-crossbar', 1.75, 0.14, 0.14, clothX, 7.52, 3.0 * facing, materials.gold);
    slab('banner-hem', 1.55, 0.4, 0.1, clothX, 5.44, 3.0 * facing, materials.blueDark);
  }

  batch.flush('blue-castle-dressing', true, root);
}
