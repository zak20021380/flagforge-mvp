import {
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  TransformNode,
  Vector3,
  VertexBuffer,
} from '@babylonjs/core';
import type { Material } from '@babylonjs/core';
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

export type CastleDamageStage = 'intact' | 'light' | 'moderate' | 'heavy' | 'destroyed';
export type GateState = 'closed' | 'opening' | 'open' | 'closing';
/** Mirror of GateHealthModel's stage list, kept local so the render layer owns no game imports. */
export type GateDamageStage = 'intact' | 'scratched' | 'cracked' | 'broken' | 'unstable' | 'destroyed';

const GATE_OPEN_DURATION = 2.4;
const GATE_CLOSE_DURATION = 2.6;
const GATE_LIFT_HEIGHT = 5.35;
/** Authored resting height of the gate planks and metal bands, shared by the wear transforms. */
const GATE_LEAF_REST_Y = 2.62;
/** How far into the breach sequence the planks stay in the "cracking and bending" pose. */
const GATE_BEND_PHASE = 0.24;

const GATE_STAGE_LEVEL: Record<GateDamageStage, number> = {
  intact: 0,
  scratched: 1,
  cracked: 2,
  broken: 3,
  unstable: 4,
  destroyed: 5,
};

function heavyEaseInOut(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  if (c < 0.5) {
    return 4 * c * c * c;
  }
  const f = -2 * c + 2;
  return 1 - (f * f * f) / 2;
}

function easeOutCubic(t: number): number {
  const c = 1 - Math.max(0, Math.min(1, t));
  return 1 - c * c * c;
}

interface DamagePiece {
  readonly mesh: Mesh;
  readonly originalParent: TransformNode;
  readonly originalPosition: Vector3;
  readonly originalRotation: Vector3;
  fallVelocity: number;
  rotationSpeed: number;
  fallen: boolean;
}

/**
 * One prepared gate fragment. Everything is authored up-front as a start pose plus a settled pose in
 * the gate node's own local space, so the collapse is a pure interpolation between two known
 * transforms — no runtime mesh fracturing and no physics solver.
 */
interface GatePiece {
  readonly mesh: Mesh;
  /** Pose while the gate is standing (its authored position/rotation). */
  readonly restPosition: Vector3;
  readonly restRotation: Vector3;
  /** Small pre-collapse lean, used for the "cracks and bends" beat. */
  readonly bendRotation: Vector3;
  /** Final settled pose: flat on the ground, fallen inward through the archway. */
  readonly fallenPosition: Vector3;
  readonly fallenRotation: Vector3;
  /** Fraction of the collapse window this piece waits before it starts moving. */
  readonly delay: number;
}

export class CastleVisual {
  readonly team: Team;
  readonly root: TransformNode;
  readonly gate: TransformNode;
  readonly interiorPoint: Vector3;
  readonly deliveryPoint: Vector3;
  readonly flagPlacementPoint: Vector3;
  readonly gatePoint: Vector3;
  readonly breachGlow: Mesh;
  private gateState: GateState = 'closed';
  private gateTimer = 0;
  private readonly baseX: number;
  private readonly baseZ: number;
  private readonly facing: number;
  private damageStage: CastleDamageStage = 'intact';
  private readonly damageMeshes: Mesh[] = [];
  private readonly destructionPieces: DamagePiece[] = [];
  private destructionActive = false;
  private shakeOffset = new Vector3(0, 0, 0);
  /** ---- Gate damage / breach state (stage 1) ---- */
  private gateDamageStage: GateDamageStage = 'intact';
  private readonly gateDamageMeshes: Mesh[] = [];
  private readonly gatePlanks: Mesh[] = [];
  private readonly gateBands: Mesh[] = [];
  /** Gate meshes that join the collapse but never take progressive-wear transforms. */
  private readonly gateCollapseExtras: Mesh[] = [];
  private readonly gatePieces: GatePiece[] = [];
  /** Shared dark material for every scratch/crack decal, so wear never allocates a material. */
  private readonly gateScarMaterial: Material;
  private gateBreachActive = false;
  private gateBreachProgress = 0;
  private gateShake = 0;

  constructor(scene: Scene, materials: MaterialLibrary, team: Team) {
    this.team = team;
    // Both castles get a finishing pass, each with its own architectural vocabulary: the player keep
    // stands roughly three times closer to the portrait camera and keeps the tallest crown, while the
    // rival keep is dressed as its red counterpart (see dressPlayerCastle / dressEnemyCastle below).
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
      this.gatePlanks.push(plank);
    }
    const kick = MeshBuilder.CreateBox(`${team}-gate-kick`, { width: 5.5, height: 0.14, depth: 0.66 }, scene);
    kick.parent = this.gate;
    kick.position = new Vector3(0, 0.1, 0);
    kick.material = materials.metal;
    // The kick plate collapses with the leaves, but takes no wear transforms of its own.
    this.gateCollapseExtras.push(kick);
    for (let i = -2; i <= 2; i += 1) {
      const bar = MeshBuilder.CreateBox(`${team}-gate-bar-${i}`, { width: 0.16, height: 5.35, depth: 0.62 }, scene);
      bar.parent = this.gate;
      bar.position = new Vector3(i * 1.04, 2.62, 0);
      bar.material = materials.metal;
      this.gateBands.push(bar);
    }
    const crossbar = MeshBuilder.CreateBox(`${team}-gate-crossbar`, { width: 5.5, height: 0.26, depth: 0.7 }, scene);
    crossbar.parent = this.gate;
    crossbar.position = new Vector3(0, 2.85, 0);
    crossbar.material = materials.metal;
    this.gateBands.push(crossbar);
    this.gateScarMaterial = materials.black;
    this.prepareGatePieces();

    createBanner(scene, this.root, materials, team, new Vector3(-4.4, 5.7, 3.0 * this.facing));
    createBanner(scene, this.root, materials, team, new Vector3(4.4, 5.7, 3.0 * this.facing));

    if (team === 'blue') dressPlayerCastle(scene, this.root, materials, this.facing);
    else dressEnemyCastle(scene, this.root, materials, this.facing);
    shadeCastleStone(this.root);

    // Only the portrait-facing red castle is the enemy assault objective. Two
    // authored ladders sit on its left/right wall faces and match the AI paths.
    // They are built after the shading pass so the rungs keep their own material
    // and the instanced copies stay identical to their source.
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
    this.flagPlacementPoint = new Vector3(this.baseX, 1.8, this.baseZ - 2.5 * this.facing);
    this.gatePoint = new Vector3(this.baseX, 0.2, this.baseZ + PORTRAIT_LAYOUT.arena.gateOffset * this.facing);
  }

  getGateState(): GateState {
    return this.gateState;
  }

  beginOpenGate(): void {
    if (this.gateState === 'opening' || this.gateState === 'open') return;
    // A breached gate has already collapsed out of the archway: there is nothing left to lift, so
    // the return state machine is answered immediately with an open doorway.
    if (this.gateBreachActive) {
      this.gateState = 'open';
      this.gateTimer = 0;
      return;
    }
    this.gateState = 'opening';
    this.gateTimer = 0;
  }

  beginCloseGate(): void {
    if (this.gateState === 'closing' || this.gateState === 'closed') return;
    if (this.gateBreachActive) {
      this.gateState = 'closed';
      this.gateTimer = 0;
      return;
    }
    this.gateState = 'closing';
    this.gateTimer = 0;
  }

  forceGateClosed(): void {
    this.gateState = 'closed';
    this.gateTimer = 0;
    this.gate.position.y = 0;
  }

  setBreached(breached: boolean): void {
    this.breachGlow.setEnabled(breached);
  }

  setDamageStage(stage: CastleDamageStage): void {
    if (stage === this.damageStage) return;
    this.damageStage = stage;
    this.applyDamageVisuals(stage);
  }

  /** Progressive gate damage. Cheap: a handful of small boxes plus transforms on existing planks. */
  setGateDamageStage(stage: GateDamageStage): void {
    if (stage === this.gateDamageStage) return;
    this.gateDamageStage = stage;
    this.applyGateDamageVisuals(stage);
  }

  getGateDamageStage(): GateDamageStage {
    return this.gateDamageStage;
  }

  /**
   * Tiny local jolt on the gate node itself when it is struck. Deliberately separate from
   * applyShake (which moves the whole castle) and never routed to the camera.
   */
  applyGateHitShake(intensity: number): void {
    this.gateShake = Math.min(1, Math.max(this.gateShake, intensity));
  }

  isGateBreachPlaying(): boolean {
    return this.gateBreachActive && this.gateBreachProgress < 1;
  }

  /**
   * Starts the prepared-piece breach: the planks lean, crack and then swing/fall inward through the
   * archway to their authored settled poses. Pure interpolation of prepared transforms.
   */
  beginGateBreach(): void {
    if (this.gateBreachActive) return;
    this.gateBreachActive = true;
    this.gateBreachProgress = 0;
    // The gate can no longer be lifted, so pin the carrier animation node at rest and clear any
    // in-flight hit jolt: from here the prepared pieces own every gate transform.
    this.gate.position.set(0, 0, 2.0 * this.facing);
    this.gate.rotation.z = 0;
    this.gateShake = 0;
    this.gateDamageStage = 'destroyed';
    this.applyGateDamageVisuals('destroyed');
  }

  /** `progress` is 0..1 across CONFIG.gate.breachSequenceSeconds, owned by GateHealthModel. */
  updateGateBreach(progress: number): void {
    if (!this.gateBreachActive) return;
    this.gateBreachProgress = Math.max(0, Math.min(1, progress));
    const p = this.gateBreachProgress;
    for (const piece of this.gatePieces) {
      if (p <= GATE_BEND_PHASE) {
        // Beat 1 — the gate cracks and bends inward under the last hits.
        const bend = easeOutCubic(p / GATE_BEND_PHASE);
        piece.mesh.position.copyFrom(piece.restPosition);
        lerpRotation(piece.mesh.rotation, piece.restRotation, piece.bendRotation, bend);
        continue;
      }
      // Beat 2 — staggered inward collapse to the settled pose.
      const span = 1 - GATE_BEND_PHASE;
      const local = (p - GATE_BEND_PHASE) / span;
      const scaled = Math.max(0, Math.min(1, (local - piece.delay) / (1 - piece.delay)));
      const fall = easeOutCubic(scaled);
      lerpVector(piece.mesh.position, piece.restPosition, piece.fallenPosition, fall);
      lerpRotation(piece.mesh.rotation, piece.bendRotation, piece.fallenRotation, fall);
    }
  }

  triggerDestruction(): void {
    if (this.destructionActive) return;
    this.destructionActive = true;
    this.prepareDestructionPieces();
  }

  updateDestruction(deltaSeconds: number, progress: number): void {
    if (!this.destructionActive) return;
    for (const piece of this.destructionPieces) {
      if (piece.fallen) continue;
      piece.mesh.position.y -= piece.fallVelocity * deltaSeconds;
      piece.mesh.rotation.x += piece.rotationSpeed * deltaSeconds;
      piece.mesh.rotation.z += piece.rotationSpeed * 0.7 * deltaSeconds;
      if (piece.mesh.position.y < -2) piece.fallen = true;
    }
    if (progress > 0.3) {
      this.gateState = 'closed';
      this.gate.position.y = Math.max(0, this.gate.position.y - deltaSeconds * 4);
    }
  }

  applyShake(intensity: number): void {
    if (intensity <= 0.01) {
      this.shakeOffset.set(0, 0, 0);
      return;
    }
    this.shakeOffset.set(
      (Math.random() - 0.5) * intensity * 0.15,
      (Math.random() - 0.5) * intensity * 0.08,
      (Math.random() - 0.5) * intensity * 0.15,
    );
    this.root.position.x = this.baseX + this.shakeOffset.x;
    this.root.position.y = this.shakeOffset.y;
    this.root.position.z = this.baseZ + this.shakeOffset.z;
  }

  update(deltaSeconds: number, elapsed: number): void {
    if (!this.destructionActive && !this.gateBreachActive) {
      switch (this.gateState) {
        case 'opening':
          this.gateTimer += deltaSeconds;
          if (this.gateTimer >= GATE_OPEN_DURATION) {
            this.gateState = 'open';
            this.gateTimer = 0;
            this.gate.position.y = GATE_LIFT_HEIGHT;
          } else {
            this.gate.position.y = heavyEaseInOut(this.gateTimer / GATE_OPEN_DURATION) * GATE_LIFT_HEIGHT;
          }
          break;
        case 'closing':
          this.gateTimer += deltaSeconds;
          if (this.gateTimer >= GATE_CLOSE_DURATION) {
            this.gateState = 'closed';
            this.gateTimer = 0;
            this.gate.position.y = 0;
          } else {
            this.gate.position.y = (1 - heavyEaseInOut(this.gateTimer / GATE_CLOSE_DURATION)) * GATE_LIFT_HEIGHT;
          }
          break;
        case 'open':
          this.gate.position.y = GATE_LIFT_HEIGHT;
          break;
        case 'closed':
          this.gate.position.y = 0;
          break;
      }
    }
    this.updateGateReactions(deltaSeconds, elapsed);
    if (this.breachGlow.isEnabled()) {
      this.breachGlow.scaling.setAll(1 + Math.sin(elapsed * 5) * 0.05);
      this.breachGlow.rotation.z += deltaSeconds * 0.65;
    }
  }

  /**
   * Local gate life: a tiny decaying jolt on impact and, in the last HP band, a slow sag/creak so an
   * unstable gate reads as barely holding. Two transforms on one node — no camera involvement.
   */
  private updateGateReactions(deltaSeconds: number, elapsed: number): void {
    if (this.gateBreachActive) return;
    const restZ = 2.0 * this.facing;
    if (this.gateShake > 0.01) {
      this.gateShake = Math.max(0, this.gateShake - deltaSeconds * 4.2);
      this.gate.position.x = (Math.random() - 0.5) * this.gateShake * 0.11;
      this.gate.position.z = restZ + (Math.random() - 0.5) * this.gateShake * 0.09;
    } else if (this.gateShake !== 0) {
      this.gateShake = 0;
      this.gate.position.x = 0;
      this.gate.position.z = restZ;
    }
    if (this.gateDamageStage === 'unstable') {
      // Barely-holding creak: a shallow, slow lean that never reads as a wobble.
      this.gate.rotation.z = Math.sin(elapsed * 1.7) * 0.018 - 0.02 * this.facing;
    } else if (this.gateDamageStage === 'broken') {
      this.gate.rotation.z = Math.sin(elapsed * 1.1) * 0.008;
    }
  }

  private applyDamageVisuals(stage: CastleDamageStage): void {
    for (const mesh of this.damageMeshes) mesh.setEnabled(false);
    this.damageMeshes.length = 0;
    if (stage === 'intact') return;

    const childMeshes = this.root.getChildMeshes().filter((m): m is Mesh => m instanceof Mesh);
    const crackTargets = childMeshes.filter((m) =>
      m.name.includes('wall') || m.name.includes('keep') || m.name.includes('gate-pillar'),
    );

    if (stage === 'light') {
      for (let i = 0; i < Math.min(3, crackTargets.length); i += 1) {
        const target = crackTargets[i];
        if (!target) break;
        const crack = MeshBuilder.CreateBox(`${this.team}-crack-${i}`, { width: 0.4, height: 0.08, depth: 0.15 }, this.root.getScene());
        crack.parent = this.root;
        crack.position = new Vector3(
          target.position.x + (Math.random() - 0.5) * 2,
          target.position.y + (Math.random() - 0.5),
          target.position.z + this.facing * 1.2,
        );
        crack.material = target.material;
        crack.receiveShadows = false;
        this.damageMeshes.push(crack);
      }
    } else if (stage === 'moderate') {
      for (let i = 0; i < Math.min(5, crackTargets.length); i += 1) {
        const target = crackTargets[i];
        if (!target) break;
        const crack = MeshBuilder.CreateBox(`${this.team}-crack-mod-${i}`, { width: 0.6, height: 0.12, depth: 0.2 }, this.root.getScene());
        crack.parent = this.root;
        crack.position = new Vector3(
          target.position.x + (Math.random() - 0.5) * 2.5,
          target.position.y + (Math.random() - 0.5) * 1.5,
          target.position.z + this.facing * 1.3,
        );
        crack.rotation.z = (Math.random() - 0.5) * 0.5;
        crack.material = target.material;
        crack.receiveShadows = false;
        this.damageMeshes.push(crack);
      }
    } else if (stage === 'heavy') {
      for (let i = 0; i < Math.min(7, crackTargets.length); i += 1) {
        const target = crackTargets[i];
        if (!target) break;
        const crack = MeshBuilder.CreateBox(`${this.team}-crack-heavy-${i}`, { width: 0.9, height: 0.18, depth: 0.28 }, this.root.getScene());
        crack.parent = this.root;
        crack.position = new Vector3(
          target.position.x + (Math.random() - 0.5) * 3,
          target.position.y + (Math.random() - 0.5) * 2,
          target.position.z + this.facing * 1.4,
        );
        crack.rotation.z = (Math.random() - 0.5) * 0.8;
        crack.rotation.y = (Math.random() - 0.5) * 0.3;
        crack.material = target.material;
        crack.receiveShadows = false;
        this.damageMeshes.push(crack);
      }
    }
  }

  private prepareDestructionPieces(): void {
    const childMeshes = this.root.getChildMeshes().filter((m): m is Mesh => m instanceof Mesh);
    // Gate planks are excluded: they are owned by the gate breach sequence and may already be lying
    // on the ground by the time the castle itself falls.
    const candidates = childMeshes.filter((m) =>
      m.name.includes('battlement') || m.name.includes('merlon'),
    );
    const selected = candidates.slice(0, 12);
    for (const mesh of selected) {
      const absPos = mesh.getAbsolutePosition();
      this.destructionPieces.push({
        mesh,
        originalParent: mesh.parent as TransformNode,
        originalPosition: mesh.position.clone(),
        originalRotation: mesh.rotation.clone(),
        fallVelocity: 2 + Math.random() * 3,
        rotationSpeed: (Math.random() - 0.5) * 4,
        fallen: false,
      });
      mesh.parent = null;
      mesh.position.copyFrom(absPos);
    }
  }

  /**
   * Authors the breach poses once, at build time. Each plank and metal band gets a small inward lean
   * (the "cracks and bends" beat) and a settled pose lying inside the archway, so the whole collapse
   * is two interpolations per piece at runtime. Nothing is fractured, cloned or simulated.
   */
  private prepareGatePieces(): void {
    const inward = -this.facing;
    const pieces: Mesh[] = [...this.gatePlanks, ...this.gateBands, ...this.gateCollapseExtras];
    for (const [index, mesh] of pieces.entries()) {
      const restPosition = mesh.position.clone();
      const restRotation = mesh.rotation.clone();
      const side = restPosition.x >= 0 ? 1 : -1;
      const lean = 0.06 + (index % 3) * 0.015;
      const bendRotation = new Vector3(
        restRotation.x + lean * inward,
        restRotation.y + side * 0.03,
        restRotation.z + side * 0.035,
      );
      // Settled: rotated flat and pushed inward through the doorway, spread across the passage.
      const fallenPosition = new Vector3(
        restPosition.x * 0.72 + side * 0.28,
        0.16 + (index % 3) * 0.07,
        restPosition.z + inward * (1.7 + (index % 4) * 0.42),
      );
      const fallenRotation = new Vector3(
        restRotation.x + inward * (Math.PI / 2 - 0.06 - (index % 3) * 0.05),
        restRotation.y + side * 0.16,
        restRotation.z + side * (0.08 + (index % 2) * 0.06),
      );
      this.gatePieces.push({
        mesh,
        restPosition,
        restRotation,
        bendRotation,
        fallenPosition,
        fallenRotation,
        delay: ((index * 7) % 5) / 12,
      });
    }
  }

  /**
   * Progressive gate wear. Each stage re-uses one prepared set of thin boxes (scratch lines, cracks,
   * splinter stubs) parented to the gate node, plus small transforms on the existing planks and metal
   * bands so heavier stages read as broken timber and buckled iron.
   */
  private applyGateDamageVisuals(stage: GateDamageStage): void {
    for (const mesh of this.gateDamageMeshes) mesh.dispose();
    this.gateDamageMeshes.length = 0;

    const scene = this.root.getScene();
    const level = GATE_STAGE_LEVEL[stage];
    // No decals on the destroyed stage: the leaves themselves fall away, and scars parented to the
    // gate node would otherwise be left hanging in the empty archway.
    const scars = level === 0 || level >= 5 ? 0 : Math.min(9, level * 2 + 1);
    for (let i = 0; i < scars; i += 1) {
      const deep = level >= 2;
      const scar = MeshBuilder.CreateBox(`${this.team}-gate-scar-${i}`, {
        width: deep ? 0.1 : 0.07,
        height: 0.5 + (i % 3) * (deep ? 0.55 : 0.28),
        depth: 0.08,
      }, scene);
      scar.parent = this.gate;
      scar.position = new Vector3(
        -2.1 + ((i * 1.37) % 4.2),
        0.75 + ((i * 1.9) % 3.7),
        this.facing * 0.29,
      );
      scar.rotation.z = ((i % 2 === 0 ? 1 : -1) * (0.18 + (i % 3) * 0.12));
      scar.material = this.gateScarMaterial;
      scar.receiveShadows = false;
      this.gateDamageMeshes.push(scar);
    }

    // Timber: broken planks sag and twist; the unstable stage adds a visibly dropped plank. The
    // destroyed stage clears the wear offsets so the collapse starts from the authored rest poses.
    const wear = level >= 5 ? 0 : level;
    for (const [index, plank] of this.gatePlanks.entries()) {
      const sag = wear >= 3 ? (0.1 + (index % 2) * 0.14) * (wear === 4 ? 1.8 : 1) : 0;
      const twist = wear >= 3 ? (index % 2 === 0 ? 1 : -1) * (wear === 4 ? 0.09 : 0.045) : 0;
      plank.position.y = GATE_LEAF_REST_Y - sag;
      plank.rotation.z = twist;
      plank.rotation.x = wear >= 4 ? (index % 2 === 0 ? 0.05 : -0.03) * this.facing : 0;
    }
    // Iron: bands bend outward from the second stage and buckle noticeably near destruction.
    for (const [index, band] of this.gateBands.entries()) {
      const bend = wear >= 2 ? (index % 2 === 0 ? 1 : -1) * (wear >= 4 ? 0.12 : 0.05) : 0;
      band.rotation.z = bend;
      band.position.z = wear >= 3 ? this.facing * (wear >= 4 ? 0.14 : 0.07) : 0;
    }
    if (wear < 3) {
      this.gate.rotation.z = 0;
    }
  }
}

/** Writes the interpolated position into `out` in place, so the collapse never allocates. */
function lerpVector(out: Vector3, from: Vector3, to: Vector3, t: number): void {
  out.set(
    from.x + (to.x - from.x) * t,
    from.y + (to.y - from.y) * t,
    from.z + (to.z - from.z) * t,
  );
}

/** Euler-angle counterpart of lerpVector; the authored poses are close enough that no slerp is needed. */
function lerpRotation(out: Vector3, from: Vector3, to: Vector3, t: number): void {
  lerpVector(out, from, to, t);
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
  // Rounder barrels and a proper spire instead of a squat cap: the two changes that decide whether
  // a drum tower reads as architecture or as a toy chess piece. Both castles get the round barrel;
  // the roof is where they part ways. Blue carries one tall smooth cone, red a two-stage bell spire
  // with a flared skirt, so the two silhouettes stay told apart at a glance in portrait.
  const rival = team === 'red';
  const sides = 16;
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

  if (rival) {
    const skirt = MeshBuilder.CreateCylinder(`${team}-tower-roof`, {
      height: 0.85,
      diameterBottom: 5.0,
      diameterTop: 3.6,
      tessellation: 16,
    }, scene);
    skirt.parent = parent;
    skirt.position = new Vector3(position.x, 7.825, position.z);
    skirt.material = materials.roofTeam(team);
    skirt.receiveShadows = true;

    const spire = MeshBuilder.CreateCylinder(`${team}-tower-spire`, {
      height: 1.25,
      diameterBottom: 3.6,
      diameterTop: 0.06,
      tessellation: 16,
    }, scene);
    spire.parent = parent;
    spire.position = new Vector3(position.x, 8.875, position.z);
    spire.material = materials.roofTeamLight(team);
    spire.receiveShadows = true;

    const finial = MeshBuilder.CreateSphere(`${team}-tower-finial`, { diameter: 0.4, segments: 6 }, scene);
    finial.parent = parent;
    finial.position = new Vector3(position.x, 9.62, position.z);
    finial.material = materials.gold;
    finial.isPickable = false;
    return;
  }

  const cone = MeshBuilder.CreateCylinder(`${team}-tower-roof`, {
    height: 2.55,
    diameterBottom: 5.05,
    diameterTop: 0.07,
    tessellation: 16,
  }, scene);
  cone.parent = parent;
  cone.position = new Vector3(position.x, 8.675, position.z);
  cone.material = materials.roofTeam(team);
  cone.receiveShadows = true;

  const finial = MeshBuilder.CreateSphere(`${team}-tower-finial`, { diameter: 0.44, segments: 6 }, scene);
  finial.parent = parent;
  finial.position = new Vector3(position.x, 10.08, position.z);
  finial.material = materials.gold;
  finial.isPickable = false;
}

function createTurret(scene: Scene, parent: TransformNode, materials: MaterialLibrary, team: Team, x: number, z: number): void {
  const rival = team === 'red';
  const body = MeshBuilder.CreateBox(`${team}-gate-turret-${x}`, { width: 1.7, height: 2.15, depth: 1.7 }, scene);
  body.parent = parent;
  body.position = new Vector3(x, 6.85, z);
  body.material = materials.castleStone;
  body.receiveShadows = true;

  const roof = MeshBuilder.CreateCylinder(`${team}-gate-turret-roof-${x}`, rival
    ? { height: 1.05, diameterBottom: 2.16, diameterTop: 0.06, tessellation: 8 }
    : { height: 1.15, diameterBottom: 2.12, diameterTop: 0.06, tessellation: 8 }, scene);
  roof.parent = parent;
  roof.position = new Vector3(x, rival ? 8.6 : 8.645, z);
  roof.material = materials.roofTeam(team);
  roof.receiveShadows = true;

  const finial = MeshBuilder.CreateSphere(`${team}-gate-turret-finial-${x}`, { diameter: rival ? 0.28 : 0.3, segments: 6 }, scene);
  finial.parent = parent;
  finial.position = new Vector3(x, rival ? 9.26 : 9.36, z);
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

/**
 * Rival-side finishing pass. Same technique as dressPlayerCastle — every piece is authored
 * unparented in castle-local units and merged per material, so the whole pass costs about eight
 * draw calls and nothing per frame — but a deliberately different architecture so the red castle
 * reads as the player's opponent rather than a recolour:
 *
 *   player (blue)                        rival (red)
 *   two dressed storeys                  three, on a wider base course
 *   square buttresses on the keep face    pilastered flanks with machicolated corbels
 *   sharp pyramidal keep roof + ball      low hipped roof with a ridge cap and twin pinnacles
 *   tall smooth tower cones               two-stage bell spires with a flared skirt
 *   one large keep crest                  two shields flanking the gate, gold-framed
 *   flat gate hood                        corbelled, projecting hood over a banded voussoir arch
 *
 * The red castle is also the enemy assault objective, so the curtain-wall parapet is deliberately
 * restrained: everything on the two front wall faces stays flush with the wall line (local k <= 2.4)
 * inside the span the siege ladders occupy, and the one crenellated bay per wall sits in the only
 * gap those ladders leave. Wall-walk stone tops out at exactly ENEMY_CASTLE_ASSAULT.wallTopY so
 * defenders keep standing on stone, and nothing reaches past the 4.15 front-face extent the castle
 * roots are positioned by.
 */
function dressEnemyCastle(scene: Scene, root: TransformNode, materials: MaterialLibrary, facing: number): void {
  const batch = new StaticBatch();
  const keepZ = -2.7 * facing;

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
    const mesh = MeshBuilder.CreateBox(`red-castle-${name}`, { width, height, depth }, scene);
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
    const mesh = MeshBuilder.CreateCylinder(`red-castle-${name}`, {
      height,
      diameterBottom,
      diameterTop,
      tessellation: 16,
    }, scene);
    mesh.position.set(x, y, z);
    mesh.material = material;
    return batch.add(mesh);
  };
  // ---- Keep: three horizontal courses instead of the player's two, so the taller rival block
  // reads as dressed storeys rather than one slab. ----
  slab('keep-base-course', 10.06, 0.3, 7.66, 0, 0.75, keepZ, materials.castleStoneLight);
  slab('keep-lower-course', 9.86, 0.26, 7.58, 0, 2.62, keepZ, materials.castleStoneLight);
  slab('keep-upper-course', 9.72, 0.22, 7.5, 0, 5.16, keepZ, materials.castleStoneLight);

  // ---- Keep flanks: the gatehouse hides the rival keep's front face from the portrait camera, so
  // the pilasters, loops and machicolations go on the two sides that are actually visible between
  // the gate turrets and the drum towers. ----
  for (const side of [-1, 1]) {
    slab('keep-pilaster', 0.5, 6.2, 1.05, side * 4.9, 3.3, keepZ, materials.castleStone);
    slab('keep-pilaster-cap', 0.62, 0.28, 1.2, side * 4.9, 6.54, keepZ, materials.castleStoneLight);
    for (const dz of [-1.85, 1.85]) {
      slab('keep-loop', 0.16, 1.15, 0.3, side * 4.86, 5.55, keepZ + dz, materials.castleStoneDark);
      slab('keep-loop-lintel', 0.22, 0.2, 0.78, side * 4.86, 6.26, keepZ + dz, materials.castleStoneLight);
      slab('keep-loop-sill', 0.24, 0.16, 0.78, side * 4.86, 4.85, keepZ + dz, materials.castleStoneLight);
    }
    for (let i = -2; i <= 2; i += 1) {
      slab('keep-corbel', 0.5, 0.34, 0.44, side * 4.9, 7.06, keepZ + i * 1.35, materials.castleStoneLight);
    }
  }
  // ---- Keep roof. Same four-gon-pyramid trick as the player keep (rotate, bake, then squash the
  // depth), but a low hipped roof that springs from inside the existing crenellated crown and is
  // finished with a ridge cap instead of a single spike. It tops out at 10.21 against the player
  // keep's 10.91, which keeps the rival clearly below the hero silhouette and well inside the
  // portrait frame the camera solve already fits (arena.ts framing constants are literals, so no
  // camera value moves). ----
  slab('keep-roof-plate', 8.5, 0.22, 6.6, 0, 8.5, keepZ, materials.roofRedLight);
  const roofMass = MeshBuilder.CreateCylinder('red-castle-keep-roof', {
    height: 1.2,
    diameterBottom: 9.6167,
    diameterTop: 1.7536,
    tessellation: 4,
  }, scene);
  roofMass.rotation.y = Math.PI / 4;
  roofMass.bakeCurrentTransformIntoVertices();
  roofMass.scaling.z = 2.65 / 3.4;
  roofMass.position.set(0, 9.21, keepZ);
  roofMass.material = materials.roofRed;
  batch.add(roofMass);
  slab('keep-roof-ridge', 1.44, 0.2, 1.06, 0, 9.91, keepZ, materials.roofRedLight);
  for (const side of [-1, 1]) {
    const pinnacle = MeshBuilder.CreateSphere('red-castle-keep-pinnacle', { diameter: 0.26, segments: 8 }, scene);
    pinnacle.position.set(side * 0.52, 10.08, keepZ);
    pinnacle.material = materials.gold;
    batch.add(pinnacle);
  }
  // ---- Drum towers: chamfered plinth, two mid courses, a gold band and a flared machicolation ring
  // under the parapet. The widest ring stops at diameter 5.7, which is exactly the extent the castle
  // root is positioned by, so the footprint is unchanged. ----
  for (const side of [-1, 1]) {
    const tx = side * 10.6;
    const tz = 1.3 * facing;
    ring('tower-plinth-chamfer', 0.26, 5.7, 5.34, tx, 0.58, tz, materials.castleStoneDark);
    ring('tower-lower-course', 0.28, 5.26, 5.22, tx, 2.35, tz, materials.castleStoneLight);
    ring('tower-upper-course', 0.28, 5.12, 5.06, tx, 4.95, tz, materials.castleStoneLight);
    ring('tower-band', 0.14, 5.16, 5.16, tx, 5.6, tz, materials.gold);
    ring('tower-corbel', 0.54, 4.92, 5.58, tx, 6.68, tz, materials.castleStoneDark);

    // Arrow loop on the camera-facing quarter of each barrel.
    const loopZ = tz + 2.44 * facing;
    slab('tower-loop', 0.3, 1.25, 0.2, tx, 4.4, loopZ, materials.castleStoneDark);
    slab('tower-loop-lintel', 0.8, 0.2, 0.26, tx, 5.18, loopZ, materials.castleStoneLight);
    slab('tower-loop-sill', 0.8, 0.18, 0.28, tx, 3.68, loopZ, materials.castleStoneLight);
  }

  // ---- Gate turrets: the eave their taller roofs now sit on, plus a gold string course ----
  for (const side of [-1, 1]) {
    slab('gate-turret-eave', 2.18, 0.26, 2.18, side * 3.7, 8.05, 1.4 * facing, materials.castleStoneLight);
    slab('gate-turret-band', 1.84, 0.14, 1.84, side * 3.7, 6.15, 1.4 * facing, materials.gold);
  }
  // ---- Curtain walls. The wall walk is dark stone whose top face lands on 4.78, the exact height
  // ENEMY_CASTLE_ASSAULT puts climbers and defenders at, and the two kerbs frame it without reaching
  // into the 0.85..2.30 strip they stand in. The single crenellated bay per wall sits at local
  // x 4.96..5.84, the only span the authored siege ladders (local x 5.88..8.45) leave clear. ----
  for (const side of [-1, 1]) {
    const wx = side * 7.2;
    slab('wall-base-course', 5.6, 0.28, 2.32, wx, 0.64, 1.3 * facing, materials.castleStoneLight);
    slab('wall-walk-deck', 5.4, 0.18, 2.16, wx, 4.69, 1.3 * facing, materials.castleStoneDark);
    slab('wall-front-kerb', 5.5, 0.2, 0.34, wx, 4.88, 2.21 * facing, materials.castleStoneLight);
    slab('wall-rear-kerb', 5.5, 0.2, 0.3, wx, 4.88, 0.36 * facing, materials.castleStoneLight);
    slab('wall-merlon-corbel', 0.96, 0.26, 0.42, side * 5.4, 4.62, 2.5 * facing, materials.castleStoneLight);
    slab('wall-merlon', 0.88, 0.82, 0.44, side * 5.4, 5.19, 2.52 * facing, materials.castleStoneLight);
    slab('wall-merlon-cap', 1.0, 0.14, 0.52, side * 5.4, 5.67, 2.52 * facing, materials.roofRedLight);

    // Flank walls carry no assault path, so they get the full crenellated walk.
    slab('wall-side-base-course', 2.6, 0.28, 8.6, side * 10.7, 0.64, -2.0 * facing, materials.castleStoneLight);
    slab('wall-side-coping', 2.34, 0.2, 8.5, side * 10.7, 4.4, -2.0 * facing, materials.castleStoneLight);
    slab('wall-side-walk', 1.1, 0.14, 7.4, side * 10.2, 4.57, -2.0 * facing, materials.castleStoneDark);
    for (const mz of [-5.2, -3.7, -2.2]) {
      slab('wall-side-merlon', 0.66, 0.82, 0.9, side * 11.42, 4.91, mz * facing, materials.castleStoneLight);
    }
  }
  // ---- Gate: a nine-stone banded voussoir arch on carved imposts, under a corbelled hood that
  // actually projects, capped by a gold string course. This is the closest, most-read part of the
  // rival castle in portrait, so it carries the strongest shadow lines. ----
  const archRadius = 4.45;
  for (let i = -4; i <= 4; i += 1) {
    const angle = i * 0.155;
    const isKey = i === 0;
    const stone = slab(
      'gate-voussoir',
      isKey ? 0.98 : 0.82,
      isKey ? 0.86 : 0.58,
      0.46,
      Math.sin(angle) * archRadius,
      1.32 + Math.cos(angle) * archRadius,
      3.02 * facing,
      isKey || i % 2 === 0 ? materials.castleStoneLight : materials.castleStoneDark,
    );
    stone.rotation.z = -angle;
  }
  for (const side of [-1, 1]) {
    slab('gate-impost', 1.5, 0.24, 0.52, side * 2.85, 4.6, 3.02 * facing, materials.castleStoneLight);
    slab('gate-base-course', 3.05, 0.26, 3.3, side * 3.7, 0.63, 1.4 * facing, materials.castleStoneLight);
    slab('gate-string-course', 2.1, 0.24, 0.3, side * 3.95, 2.05, 2.92 * facing, materials.castleStoneLight);
  }
  for (let i = -4; i <= 4; i += 1) {
    slab('gate-hood-corbel', 0.44, 0.32, 0.46, i * 1.06, 6.18, 3.24 * facing, materials.castleStoneLight);
  }
  slab('gate-hood', 10.1, 0.26, 0.62, 0, 6.52, 3.34 * facing, materials.castleStoneLight);
  slab('gate-hood-band', 9.7, 0.14, 0.4, 0, 6.74, 3.2 * facing, materials.gold);

  // ---- Heraldry: two gold-framed shields flanking the gate, the rival answer to the player keep's
  // single crest, plus gold rods and dark hems on the existing red banner cloths. ----
  for (const side of [-1, 1]) {
    slab('gate-shield-frame', 1.26, 1.42, 0.1, side * 3.5, 3.85, 2.86 * facing, materials.gold);
    slab('gate-shield', 1.06, 1.22, 0.14, side * 3.5, 3.85, 2.94 * facing, materials.red);
    const boss = slab('gate-shield-boss', 0.4, 0.4, 0.1, side * 3.5, 3.9, 3.03 * facing, materials.gold);
    boss.rotation.z = Math.PI / 4;

    const clothX = side * 4.4 + 0.78;
    slab('banner-bracket', 0.42, 0.34, 0.62, side * 4.4, 3.2, 3.0 * facing, materials.castleStoneLight);
    slab('banner-crossbar', 1.78, 0.14, 0.16, clothX, 7.5, 3.0 * facing, materials.gold);
    slab('banner-hem', 1.55, 0.42, 0.11, clothX, 5.42, 3.0 * facing, materials.redDark);
  }

  batch.flush('red-castle-dressing', true, root);
}
