import {
  Material,
  Mesh,
  MeshBuilder,
  Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import type { Team, UnitKind, UnitState } from '../core/types';
import { MaterialLibrary } from './materials';

export class UnitRig {
  readonly root: TransformNode;
  readonly flagSocket: TransformNode;
  readonly shadow: Mesh;
  /**
   * True while a scripted interaction (the central-tower ladder mount) owns the limb pose.
   * updateAnimation skips the walk/run cycle in this mode so the scripted pose is never
   * overwritten, and only applies the gentle idle bob on top.
   */
  interactionPoseActive = false;
  private readonly visualRoot: TransformNode;
  private readonly torso: TransformNode;
  private readonly head: TransformNode;
  private readonly leftArm: TransformNode;
  private readonly rightArm: TransformNode;
  private readonly leftLeg: TransformNode;
  private readonly rightLeg: TransformNode;
  private readonly weaponRoot: TransformNode;
  private readonly shieldRoot: TransformNode;
  private readonly healthBack: Mesh;
  private readonly healthFill: Mesh;
  private readonly baseScale: number;
  private deathRotation = 0;

  constructor(scene: Scene, materials: MaterialLibrary, readonly kind: UnitKind, readonly team: Team, id: number) {
    this.root = new TransformNode(`unit-${id}-${team}-${kind}`, scene);
    this.visualRoot = new TransformNode(`unit-${id}-visual`, scene);
    this.visualRoot.parent = this.root;

    this.shadow = MeshBuilder.CreateDisc(`unit-${id}-shadow`, { radius: kind === 'ironGuard' ? 0.72 : 0.58, tessellation: 24 }, scene);
    this.shadow.parent = this.root;
    this.shadow.position.y = 0.045;
    this.shadow.rotation.x = Math.PI / 2;
    this.shadow.material = materials.blobShadow;
    this.shadow.isPickable = false;

    this.torso = new TransformNode(`unit-${id}-torso`, scene);
    this.torso.parent = this.visualRoot;
    this.torso.position.y = 1.35;

    this.head = new TransformNode(`unit-${id}-head`, scene);
    this.head.parent = this.torso;
    this.head.position.y = 1.05;

    this.leftArm = new TransformNode(`unit-${id}-left-arm`, scene);
    this.leftArm.parent = this.torso;
    this.leftArm.position = new Vector3(-0.52, 0.62, 0);

    this.rightArm = new TransformNode(`unit-${id}-right-arm`, scene);
    this.rightArm.parent = this.torso;
    this.rightArm.position = new Vector3(0.52, 0.62, 0);

    this.leftLeg = new TransformNode(`unit-${id}-left-leg`, scene);
    this.leftLeg.parent = this.visualRoot;
    this.leftLeg.position = new Vector3(-0.27, 1.03, 0);

    this.rightLeg = new TransformNode(`unit-${id}-right-leg`, scene);
    this.rightLeg.parent = this.visualRoot;
    this.rightLeg.position = new Vector3(0.27, 1.03, 0);

    this.weaponRoot = new TransformNode(`unit-${id}-weapon`, scene);
    this.weaponRoot.parent = this.rightArm;
    this.weaponRoot.position = new Vector3(0, -0.65, 0.02);

    this.shieldRoot = new TransformNode(`unit-${id}-shield`, scene);
    this.shieldRoot.parent = this.leftArm;
    this.shieldRoot.position = new Vector3(0, -0.55, 0.1);

    this.flagSocket = new TransformNode(`unit-${id}-flag-socket`, scene);
    this.flagSocket.parent = this.torso;
    this.flagSocket.position = new Vector3(0.55, 1.25, -0.22);

    this.baseScale = (kind === 'ironGuard' ? 1.16 : kind === 'raider' ? 0.9 : kind === 'ranger' ? 0.94 : 1) * 1.04;
    this.visualRoot.scaling.setAll(this.baseScale);
    this.buildBody(scene, materials);

    this.healthBack = MeshBuilder.CreateBox(`unit-${id}-health-back`, { width: 1.6, height: 0.14, depth: 0.06 }, scene);
    this.healthBack.parent = this.root;
    this.healthBack.position = new Vector3(0, kind === 'ironGuard' ? 3.65 : 3.25, 0);
    this.healthBack.material = materials.black;
    this.healthBack.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.healthBack.isPickable = false;

    this.healthFill = MeshBuilder.CreateBox(`unit-${id}-health-fill`, { width: 1.52, height: 0.085, depth: 0.07 }, scene);
    this.healthFill.parent = this.root;
    this.healthFill.position = new Vector3(0, kind === 'ironGuard' ? 3.65 : 3.25, -0.04);
    this.healthFill.material = materials.team(team);
    this.healthFill.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.healthFill.isPickable = false;
  }

  setEnabled(enabled: boolean): void {
    this.root.setEnabled(enabled);
  }

  setHealthRatio(ratio: number): void {
    const safe = Math.max(0, Math.min(1, ratio));
    this.healthFill.scaling.x = safe;
    this.healthFill.position.x = -(1 - safe) * 0.76;
    this.healthBack.setEnabled(safe < 0.995 && safe > 0);
    this.healthFill.setEnabled(safe < 0.995 && safe > 0);
  }

  resetVisual(): void {
    this.visualRoot.rotation.set(0, 0, 0);
    this.visualRoot.position.set(0, 0, 0);
    this.visualRoot.scaling.setAll(this.baseScale);
    this.torso.rotation.set(0, 0, 0);
    this.torso.position.y = 1.35;
    this.head.rotation.set(0, 0, 0);
    this.leftArm.rotation.set(0, 0, 0);
    this.rightArm.rotation.set(0, 0, 0);
    this.leftLeg.rotation.set(0, 0, 0);
    this.rightLeg.rotation.set(0, 0, 0);
    this.weaponRoot.rotation.set(0, 0, 0);
    this.shieldRoot.rotation.set(0, 0, 0);
    this.deathRotation = 0;
    this.setHealthRatio(1);
  }

  /**
   * Scripted ladder-mount pose, blended in by progress (0 = neutral idle, 1 = fully mounted):
   * the torso leans onto the ladder, one hand reaches up to grip the first rung overhead, the
   * other stays low on the rail, one leg steps up onto the rung and the other braced leg trails.
   * Everything is written absolutely each frame, so a single call per frame owns the pose and no
   * reset ordering matters afterward.
   */
  applyMountPose(progress: number, lean: number, elapsed: number): void {
    this.interactionPoseActive = true;
    const p = Math.max(0, Math.min(1, progress));
    const settle = p * p * (3 - 2 * p);
    const sway = Math.sin(elapsed * 9) * (1 - settle) * 0.04;
    this.torso.rotation.x = -lean * p;
    this.torso.rotation.z = sway * 0.4;
    // Reaching arm climbs overhead; the low arm folds onto the rail beside the hip.
    this.leftArm.rotation.x = -0.2 - (1.62 * p);
    this.leftArm.rotation.z = -0.3 * p;
    this.rightArm.rotation.x = -0.08 - (0.42 * p);
    this.rightArm.rotation.z = 0.18 * p;
    // Lead leg steps up onto the first rung; the trailing leg pushes off mid-stride and settles.
    this.leftLeg.rotation.x = -0.2 - (0.95 * p);
    this.rightLeg.rotation.x = (0.55 - 0.35 * p);
    this.head.rotation.x = -(0.12 + 0.14 * p);
    this.head.rotation.y = sway;
    this.weaponRoot.rotation.z = 0.22 * p;
    this.shieldRoot.rotation.x = 0.15 * p;
  }

  applyClimbCycle(phase: number, lean: number, elapsed: number): void {
    this.interactionPoseActive = true;
    const p = ((phase % 1) + 1) % 1;
    const sway = Math.sin(elapsed * 7) * 0.02;
    this.torso.rotation.x = -lean;
    this.torso.rotation.z = sway * 0.3;
    const leftHandUp = Math.sin(p * Math.PI * 2);
    const rightHandUp = Math.sin((p + 0.5) * Math.PI * 2);
    const leftFootUp = Math.sin((p + 0.5) * Math.PI * 2);
    const rightFootUp = Math.sin(p * Math.PI * 2);
    this.leftArm.rotation.x = -1.2 - leftHandUp * 0.45;
    this.leftArm.rotation.z = -0.18;
    this.rightArm.rotation.x = -1.2 - rightHandUp * 0.45;
    this.rightArm.rotation.z = 0.18;
    this.leftLeg.rotation.x = -0.35 - leftFootUp * 0.38;
    this.rightLeg.rotation.x = -0.35 - rightFootUp * 0.38;
    this.head.rotation.x = -0.18;
    this.head.rotation.y = sway;
    this.visualRoot.position.y = Math.abs(Math.sin(p * Math.PI * 2)) * 0.03;
    this.weaponRoot.rotation.z = 0.15;
    this.shieldRoot.rotation.x = 0.1;
  }

  applyTopDismount(progress: number, elapsed: number): void {
    this.interactionPoseActive = true;
    const p = Math.max(0, Math.min(1, progress));
    const settle = p * p * (3 - 2 * p);
    this.torso.rotation.x = -0.35 * (1 - settle);
    this.torso.rotation.z = 0;
    this.leftArm.rotation.x = -1.6 + settle * 1.2;
    this.leftArm.rotation.z = -0.18 * (1 - settle);
    this.rightArm.rotation.x = -1.6 + settle * 1.2;
    this.rightArm.rotation.z = 0.18 * (1 - settle);
    const leftFootPlace = Math.min(1, p * 2);
    const rightFootPlace = Math.max(0, (p - 0.4) * 1.667);
    this.leftLeg.rotation.x = -0.7 + leftFootPlace * 0.7;
    this.rightLeg.rotation.x = -0.7 + rightFootPlace * 0.7;
    this.visualRoot.position.y = settle * 0.15;
    this.head.rotation.x = -0.18 * (1 - settle);
    this.head.rotation.y = Math.sin(elapsed * 5) * 0.02 * (1 - settle);
    this.weaponRoot.rotation.z = 0.15 * (1 - settle);
    this.shieldRoot.rotation.x = 0.1 * (1 - settle);
  }

  /** Release the scripted-pose lock so walk/run and idle animation drive the limbs again. */
  clearInteractionPose(): void {
    this.interactionPoseActive = false;
  }

  updateAnimation(state: UnitState, elapsed: number, attackProgress: number, hitProgress: number, deathProgress: number, carryingFlag: boolean): void {
    const idleBob = Math.sin(elapsed * 3.4) * 0.035;
    this.torso.position.y = 1.35 + idleBob;
    this.head.rotation.y = Math.sin(elapsed * 1.5) * 0.04;

    if ((state === 'moving' || state === 'climbing') && !this.interactionPoseActive) {
      const speed = this.kind === 'raider' ? 10.5 : this.kind === 'ironGuard' ? 6.8 : 8.5;
      const swing = Math.sin(elapsed * speed);
      const legArc = state === 'climbing' ? 0.48 : 0.66;
      const armArc = state === 'climbing' ? 0.72 : 0.46;
      this.leftLeg.rotation.x = swing * legArc;
      this.rightLeg.rotation.x = -swing * legArc;
      this.leftArm.rotation.x = -swing * armArc;
      this.rightArm.rotation.x = swing * armArc;
      this.visualRoot.position.y = Math.abs(Math.sin(elapsed * speed)) * (state === 'climbing' ? 0.035 : 0.07);
      this.torso.rotation.z = Math.sin(elapsed * speed * 0.5) * (state === 'climbing' ? 0.018 : 0.035);
    } else if (!this.interactionPoseActive) {
      this.leftLeg.rotation.x *= 0.75;
      this.rightLeg.rotation.x *= 0.75;
      this.leftArm.rotation.x *= 0.75;
      this.rightArm.rotation.x *= 0.75;
      this.visualRoot.position.y *= 0.72;
    }

    if (state === 'attacking') {
      const arc = Math.sin(Math.min(1, attackProgress) * Math.PI);
      if (this.kind === 'ranger') {
        this.leftArm.rotation.x = -1.15;
        this.leftArm.rotation.y = -0.35;
        this.rightArm.rotation.x = -1.18;
        this.rightArm.rotation.y = 0.75 - arc * 0.75;
        this.torso.rotation.y = -0.16;
      } else {
        this.rightArm.rotation.x = -1.1 + arc * 2.05;
        this.rightArm.rotation.z = -0.3 + arc * 0.6;
        this.torso.rotation.y = -0.3 + arc * 0.58;
        this.weaponRoot.rotation.z = arc * 0.55;
        if (this.kind === 'ironGuard') this.leftArm.rotation.x = -0.7;
      }
    }

    if (state === 'hit') {
      this.torso.rotation.x = -Math.sin(hitProgress * Math.PI) * 0.35;
      this.head.rotation.x = Math.sin(hitProgress * Math.PI) * 0.22;
    }

    if (state === 'falling') {
      this.leftArm.rotation.x = -1.05;
      this.rightArm.rotation.x = -0.82;
      this.leftLeg.rotation.x = 0.58;
      this.rightLeg.rotation.x = -0.42;
      this.torso.rotation.x = -0.3;
      this.head.rotation.z = Math.sin(elapsed * 13) * 0.12;
    }

    if (state === 'dead') {
      this.deathRotation = Math.min(Math.PI * 0.47, deathProgress * Math.PI * 0.47);
      this.visualRoot.rotation.z = (this.team === 'blue' ? -1 : 1) * this.deathRotation;
      this.visualRoot.position.y = -Math.min(0.38, deathProgress * 0.38);
      this.healthBack.setEnabled(false);
      this.healthFill.setEnabled(false);
    }

    if (carryingFlag) {
      this.leftArm.rotation.x = -0.48;
      this.leftArm.rotation.z = -0.38;
      this.torso.rotation.z += Math.sin(elapsed * 4.2) * 0.02;
    }
  }

  private buildBody(scene: Scene, materials: MaterialLibrary): void {
    const teamMaterial = materials.team(this.team);
    const teamDark = materials.teamDark(this.team);
    const bodyWidth = this.kind === 'ironGuard' ? 1.22 : this.kind === 'raider' ? 0.76 : 0.98;
    const bodyHeight = this.kind === 'ironGuard' ? 1.42 : 1.22;

    const torsoMesh = MeshBuilder.CreateCapsule(`${this.root.name}-body`, { height: bodyHeight, radius: bodyWidth * 0.42, tessellation: 8, subdivisions: 2 }, scene);
    torsoMesh.parent = this.torso;
    torsoMesh.position.y = 0.25;
    torsoMesh.scaling.x = 1.1;
    torsoMesh.material = this.kind === 'ranger' ? materials.leather : teamDark;

    const chest = MeshBuilder.CreateBox(`${this.root.name}-chest`, { width: bodyWidth, height: 0.68, depth: 0.48 }, scene);
    chest.parent = this.torso;
    chest.position = new Vector3(0, 0.36, -0.02);
    chest.material = this.kind === 'raider' ? materials.black : teamMaterial;
    chest.rotation.x = -0.05;

    const belt = MeshBuilder.CreateCylinder(`${this.root.name}-belt`, { height: 0.18, diameter: bodyWidth * 0.92, tessellation: 8 }, scene);
    belt.parent = this.torso;
    belt.position.y = -0.25;
    belt.material = materials.leather;

    const headMesh = MeshBuilder.CreateSphere(`${this.root.name}-head-mesh`, { diameter: this.kind === 'ironGuard' ? 0.82 : 0.72, segments: 8 }, scene);
    headMesh.parent = this.head;
    headMesh.material = materials.skin;

    this.buildHeadwear(scene, materials, teamMaterial, teamDark);
    this.buildLimbs(scene, materials, teamDark);
    this.buildWeapon(scene, materials, teamMaterial, teamDark);

    if (this.kind === 'vanguard') {
      const shoulderL = MeshBuilder.CreateSphere(`${this.root.name}-shoulder-l`, { diameter: 0.62, segments: 7 }, scene);
      shoulderL.parent = this.torso;
      shoulderL.position = new Vector3(-0.56, 0.56, 0);
      shoulderL.scaling.y = 0.72;
      shoulderL.material = materials.metal;
      const shoulderR = shoulderL.clone(`${this.root.name}-shoulder-r`) as Mesh;
      shoulderR.position.x = 0.56;
    }

    if (this.kind === 'ironGuard') {
      const backPlate = MeshBuilder.CreateBox(`${this.root.name}-back-plate`, { width: 1.32, height: 1.35, depth: 0.22 }, scene);
      backPlate.parent = this.torso;
      backPlate.position = new Vector3(0, 0.24, 0.32);
      backPlate.material = materials.metal;
    }

    if (this.kind === 'raider') {
      const scarf = MeshBuilder.CreateBox(`${this.root.name}-scarf`, { width: 0.26, height: 1.25, depth: 0.12 }, scene);
      scarf.parent = this.torso;
      scarf.position = new Vector3(0.35, 0.05, 0.34);
      scarf.rotation.z = -0.2;
      scarf.material = teamMaterial;
    }

    if (this.kind === 'ranger') {
      const quiver = MeshBuilder.CreateCylinder(`${this.root.name}-quiver`, { height: 1.05, diameter: 0.38, tessellation: 8 }, scene);
      quiver.parent = this.torso;
      quiver.position = new Vector3(-0.38, 0.25, 0.34);
      quiver.rotation.z = -0.28;
      quiver.material = materials.leather;
      for (let i = 0; i < 3; i += 1) {
        const arrow = MeshBuilder.CreateCylinder(`${this.root.name}-quiver-arrow-${i}`, { height: 1.25, diameter: 0.045, tessellation: 5 }, scene);
        arrow.parent = this.torso;
        arrow.position = new Vector3(-0.48 + i * 0.09, 0.68, 0.35);
        arrow.rotation.z = -0.25;
        arrow.material = materials.wood;
      }
    }
  }

  private buildHeadwear(scene: Scene, materials: MaterialLibrary, teamMaterial: Material, teamDark: Material): void {
    if (this.kind === 'ranger') {
      const hood = MeshBuilder.CreateCylinder(`${this.root.name}-hood`, { height: 0.78, diameterTop: 0.18, diameterBottom: 0.86, tessellation: 8 }, scene);
      hood.parent = this.head;
      hood.position.y = 0.19;
      hood.material = teamDark;
      const mask = MeshBuilder.CreateBox(`${this.root.name}-mask`, { width: 0.58, height: 0.24, depth: 0.13 }, scene);
      mask.parent = this.head;
      mask.position = new Vector3(0, -0.08, -0.34);
      mask.material = materials.black;
      return;
    }

    if (this.kind === 'ironGuard') {
      const helmet = MeshBuilder.CreateCylinder(`${this.root.name}-helmet`, { height: 0.72, diameter: 0.92, tessellation: 8 }, scene);
      helmet.parent = this.head;
      helmet.position.y = 0.12;
      helmet.material = materials.metal;
      const visor = MeshBuilder.CreateBox(`${this.root.name}-visor`, { width: 0.84, height: 0.23, depth: 0.16 }, scene);
      visor.parent = this.head;
      visor.position = new Vector3(0, 0.04, -0.44);
      visor.material = materials.black;
      const crest = MeshBuilder.CreateBox(`${this.root.name}-crest`, { width: 0.18, height: 0.75, depth: 0.55 }, scene);
      crest.parent = this.head;
      crest.position = new Vector3(0, 0.62, 0.05);
      crest.material = teamMaterial;
      return;
    }

    if (this.kind === 'vanguard') {
      const hair = MeshBuilder.CreateCylinder(`${this.root.name}-hair`, { height: 0.42, diameterTop: 0.42, diameterBottom: 0.78, tessellation: 8 }, scene);
      hair.parent = this.head;
      hair.position.y = 0.28;
      hair.material = materials.leather;
      const brow = MeshBuilder.CreateBox(`${this.root.name}-brow`, { width: 0.7, height: 0.12, depth: 0.13 }, scene);
      brow.parent = this.head;
      brow.position = new Vector3(0, 0.05, -0.35);
      brow.material = teamMaterial;
      return;
    }

    const cowl = MeshBuilder.CreateCylinder(`${this.root.name}-cowl`, { height: 0.46, diameterTop: 0.5, diameterBottom: 0.82, tessellation: 8 }, scene);
    cowl.parent = this.head;
    cowl.position.y = 0.28;
    cowl.material = materials.black;
    const eyeBand = MeshBuilder.CreateBox(`${this.root.name}-eye-band`, { width: 0.65, height: 0.15, depth: 0.13 }, scene);
    eyeBand.parent = this.head;
    eyeBand.position = new Vector3(0, 0, -0.35);
    eyeBand.material = teamMaterial;
  }

  private buildLimbs(scene: Scene, materials: MaterialLibrary, teamDark: Material): void {
    const armRadius = this.kind === 'ironGuard' ? 0.23 : 0.18;
    const armLength = this.kind === 'ironGuard' ? 1.25 : 1.13;
    for (const [node, side] of [[this.leftArm, 'left'], [this.rightArm, 'right']] as const) {
      const arm = MeshBuilder.CreateCapsule(`${this.root.name}-${side}-arm-mesh`, { height: armLength, radius: armRadius, tessellation: 7, subdivisions: 1 }, scene);
      arm.parent = node;
      arm.position.y = -0.5;
      arm.material = this.kind === 'ranger' || this.kind === 'raider' ? materials.leather : teamDark;
      const hand = MeshBuilder.CreateSphere(`${this.root.name}-${side}-hand`, { diameter: armRadius * 1.65, segments: 7 }, scene);
      hand.parent = node;
      hand.position.y = -1.02;
      hand.material = materials.skin;
    }

    const legRadius = this.kind === 'ironGuard' ? 0.25 : 0.2;
    const legLength = this.kind === 'ironGuard' ? 1.42 : 1.28;
    for (const [node, side] of [[this.leftLeg, 'left'], [this.rightLeg, 'right']] as const) {
      const leg = MeshBuilder.CreateCapsule(`${this.root.name}-${side}-leg-mesh`, { height: legLength, radius: legRadius, tessellation: 7, subdivisions: 1 }, scene);
      leg.parent = node;
      leg.position.y = -0.52;
      leg.material = materials.black;
      const boot = MeshBuilder.CreateBox(`${this.root.name}-${side}-boot`, { width: 0.42, height: 0.28, depth: 0.65 }, scene);
      boot.parent = node;
      boot.position = new Vector3(0, -1.13, -0.12);
      boot.material = materials.leather;
    }
  }

  private buildWeapon(scene: Scene, materials: MaterialLibrary, teamMaterial: Material, teamDark: Material): void {
    if (this.kind === 'ranger') {
      const upperLimb = MeshBuilder.CreateCylinder(`${this.root.name}-bow-upper`, { height: 0.92, diameter: 0.09, tessellation: 7 }, scene);
      upperLimb.parent = this.weaponRoot;
      upperLimb.position = new Vector3(0.2, 0.35, 0);
      upperLimb.rotation.z = -0.43;
      upperLimb.material = materials.wood;
      const lowerLimb = MeshBuilder.CreateCylinder(`${this.root.name}-bow-lower`, { height: 0.92, diameter: 0.09, tessellation: 7 }, scene);
      lowerLimb.parent = this.weaponRoot;
      lowerLimb.position = new Vector3(0.2, -0.35, 0);
      lowerLimb.rotation.z = 0.43;
      lowerLimb.material = materials.wood;
      const grip = MeshBuilder.CreateCylinder(`${this.root.name}-bow-grip`, { height: 0.42, diameter: 0.13, tessellation: 7 }, scene);
      grip.parent = this.weaponRoot;
      grip.position = new Vector3(0.38, 0, 0);
      grip.material = materials.leather;
      const string = MeshBuilder.CreateCylinder(`${this.root.name}-bow-string`, { height: 1.55, diameter: 0.025, tessellation: 5 }, scene);
      string.parent = this.weaponRoot;
      string.position.x = -0.03;
      string.material = materials.white;
      return;
    }

    if (this.kind === 'ironGuard') {
      const shield = MeshBuilder.CreateCylinder(`${this.root.name}-shield-mesh`, { height: 0.25, diameter: 1.5, tessellation: 12 }, scene);
      shield.parent = this.shieldRoot;
      shield.rotation.x = Math.PI / 2;
      shield.rotation.z = Math.PI / 2;
      shield.material = materials.metal;
      const shieldFace = MeshBuilder.CreateCylinder(`${this.root.name}-shield-face`, { height: 0.27, diameter: 1.12, tessellation: 12 }, scene);
      shieldFace.parent = this.shieldRoot;
      shieldFace.rotation.x = Math.PI / 2;
      shieldFace.rotation.z = Math.PI / 2;
      shieldFace.position.z = -0.04;
      shieldFace.material = teamMaterial;
      const maceHandle = MeshBuilder.CreateCylinder(`${this.root.name}-mace-handle`, { height: 1.25, diameter: 0.11, tessellation: 7 }, scene);
      maceHandle.parent = this.weaponRoot;
      maceHandle.position.y = -0.28;
      maceHandle.material = materials.wood;
      const maceHead = MeshBuilder.CreatePolyhedron(`${this.root.name}-mace-head`, { type: 1, size: 0.42 }, scene);
      maceHead.parent = this.weaponRoot;
      maceHead.position.y = -0.93;
      maceHead.material = materials.metal;
      return;
    }

    const bladeLength = this.kind === 'raider' ? 0.95 : 1.35;
    const handle = MeshBuilder.CreateCylinder(`${this.root.name}-weapon-handle`, { height: 0.58, diameter: 0.12, tessellation: 7 }, scene);
    handle.parent = this.weaponRoot;
    handle.position.y = -0.16;
    handle.material = materials.leather;
    const blade = MeshBuilder.CreateBox(`${this.root.name}-blade`, { width: this.kind === 'raider' ? 0.17 : 0.25, height: bladeLength, depth: 0.08 }, scene);
    blade.parent = this.weaponRoot;
    blade.position.y = -0.73;
    blade.material = materials.metal;
    const guard = MeshBuilder.CreateBox(`${this.root.name}-weapon-guard`, { width: 0.58, height: 0.11, depth: 0.13 }, scene);
    guard.parent = this.weaponRoot;
    guard.position.y = -0.4;
    guard.material = teamDark;

    if (this.kind === 'vanguard') {
      const axeBack = MeshBuilder.CreateBox(`${this.root.name}-axe-back`, { width: 0.42, height: 0.48, depth: 0.12 }, scene);
      axeBack.parent = this.weaponRoot;
      axeBack.position = new Vector3(0.3, -1.05, 0);
      axeBack.rotation.z = 0.34;
      axeBack.material = materials.metal;
    }

    if (this.kind === 'raider') {
      const secondBlade = blade.clone(`${this.root.name}-second-blade`) as Mesh;
      secondBlade.parent = this.shieldRoot;
      secondBlade.position = new Vector3(0, -0.75, 0);
      secondBlade.rotation.z = -0.15;
      const secondHandle = handle.clone(`${this.root.name}-second-handle`) as Mesh;
      secondHandle.parent = this.shieldRoot;
      secondHandle.position = new Vector3(0, -0.18, 0);
    }
  }
}
