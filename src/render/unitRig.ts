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

    this.shadow = MeshBuilder.CreateDisc(`unit-${id}-shadow`, { radius: kind === 'ironGuard' ? 0.82 : 0.66, tessellation: 24 }, scene);
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
    this.leftArm.position = new Vector3(-0.58, 0.62, 0);

    this.rightArm = new TransformNode(`unit-${id}-right-arm`, scene);
    this.rightArm.parent = this.torso;
    this.rightArm.position = new Vector3(0.58, 0.62, 0);

    this.leftLeg = new TransformNode(`unit-${id}-left-leg`, scene);
    this.leftLeg.parent = this.visualRoot;
    this.leftLeg.position = new Vector3(-0.30, 1.03, 0);

    this.rightLeg = new TransformNode(`unit-${id}-right-leg`, scene);
    this.rightLeg.parent = this.visualRoot;
    this.rightLeg.position = new Vector3(0.30, 1.03, 0);

    this.weaponRoot = new TransformNode(`unit-${id}-weapon`, scene);
    this.weaponRoot.parent = this.rightArm;
    this.weaponRoot.position = new Vector3(0, -0.65, 0.02);

    this.shieldRoot = new TransformNode(`unit-${id}-shield`, scene);
    this.shieldRoot.parent = this.leftArm;
    this.shieldRoot.position = new Vector3(0, -0.55, 0.1);

    this.flagSocket = new TransformNode(`unit-${id}-flag-socket`, scene);
    this.flagSocket.parent = this.torso;
    this.flagSocket.position = new Vector3(0.55, 1.25, -0.22);

    this.baseScale = (kind === 'ironGuard' ? 1.16 : kind === 'raider' ? 0.9 : kind === 'ranger' ? 0.94 : 1) * 1.15;
    this.visualRoot.scaling.set(this.baseScale, this.baseScale * 1.02, this.baseScale);
    this.buildBody(scene, materials);

    this.healthBack = MeshBuilder.CreateBox(`unit-${id}-health-back`, { width: 1.2, height: 0.07, depth: 0.03 }, scene);
    this.healthBack.parent = this.root;
    this.healthBack.position = new Vector3(0, kind === 'ironGuard' ? 3.85 : 3.45, 0);
    this.healthBack.material = materials.black;
    this.healthBack.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.healthBack.isPickable = false;

    this.healthFill = MeshBuilder.CreateBox(`unit-${id}-health-fill`, { width: 1.14, height: 0.045, depth: 0.035 }, scene);
    this.healthFill.parent = this.root;
    this.healthFill.position = new Vector3(0, kind === 'ironGuard' ? 3.85 : 3.45, -0.02);
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
    this.healthFill.position.x = -(1 - safe) * 0.57;
    this.healthBack.setEnabled(safe < 0.995 && safe > 0);
    this.healthFill.setEnabled(safe < 0.995 && safe > 0);
  }

  resetVisual(): void {
    this.visualRoot.rotation.set(0, 0, 0);
    this.visualRoot.position.set(0, 0, 0);
    this.visualRoot.scaling.set(this.baseScale, this.baseScale * 1.02, this.baseScale);
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

  applyMountPose(progress: number, lean: number, elapsed: number): void {
    this.interactionPoseActive = true;
    const p = Math.max(0, Math.min(1, progress));
    const ease = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
    const sway = Math.sin(elapsed * 5) * (1 - ease) * 0.018;
    this.torso.rotation.x = -lean * ease;
    this.torso.rotation.z = sway * 0.15;
    this.leftArm.rotation.x = -0.3 - 1.15 * ease;
    this.leftArm.rotation.z = -0.32 * ease;
    this.leftArm.rotation.y = 0.08 * ease;
    this.rightArm.rotation.x = -0.3 - 1.15 * ease;
    this.rightArm.rotation.z = 0.32 * ease;
    this.rightArm.rotation.y = -0.08 * ease;
    this.leftLeg.rotation.x = -0.95 * ease;
    this.rightLeg.rotation.x = 0.15 * ease;
    this.head.rotation.x = -(0.08 + 0.1 * ease);
    this.head.rotation.y = sway;
    this.visualRoot.position.y = ease * 0.06;
    this.weaponRoot.rotation.z = 0.25 * ease;
    this.shieldRoot.rotation.x = 0.15 * ease;
  }

  applyClimbCycle(phase: number, lean: number, elapsed: number, descending?: boolean): void {
    this.interactionPoseActive = true;
    const p = ((phase % 1) + 1) % 1;
    const dir = descending ? -1 : 1;
    const cycle = p * Math.PI * 2;
    const sway = Math.sin(elapsed * 3.2) * 0.008;
    this.torso.rotation.x = -lean;
    this.torso.rotation.z = sway * 0.1;
    const leftGrip = Math.sin(cycle);
    const rightGrip = Math.sin(cycle + Math.PI);
    const leftFoot = Math.sin(cycle + Math.PI);
    const rightFoot = Math.sin(cycle);
    const handSlide = 0.22;
    const footLift = 0.28;
    const armBaseX = -1.35;
    this.leftArm.rotation.x = armBaseX - leftGrip * handSlide * dir;
    this.leftArm.rotation.z = -0.34;
    this.leftArm.rotation.y = 0.1;
    this.rightArm.rotation.x = armBaseX - rightGrip * handSlide * dir;
    this.rightArm.rotation.z = 0.34;
    this.rightArm.rotation.y = -0.1;
    const legBaseX = -0.35;
    this.leftLeg.rotation.x = legBaseX - leftFoot * footLift * dir;
    this.rightLeg.rotation.x = legBaseX - rightFoot * footLift * dir;
    this.head.rotation.x = -0.12;
    this.head.rotation.y = sway;
    this.visualRoot.position.y = Math.abs(Math.sin(cycle)) * 0.012;
    this.weaponRoot.rotation.z = 0.18;
    this.shieldRoot.rotation.x = 0.1;
  }

  applyTopDismount(progress: number, elapsed: number): void {
    this.interactionPoseActive = true;
    const p = Math.max(0, Math.min(1, progress));
    const ease = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
    const handRelease = Math.max(0, (p - 0.45) * 1.818);
    const handEase = handRelease < 0.5 ? 2 * handRelease * handRelease : 1 - (-2 * handRelease + 2) ** 2 / 2;
    this.torso.rotation.x = -0.25 * (1 - ease);
    this.torso.rotation.z = 0;
    this.leftArm.rotation.x = -1.35 + handEase * 1.0;
    this.leftArm.rotation.z = -0.34 * (1 - handEase);
    this.leftArm.rotation.y = 0.1 * (1 - handEase);
    this.rightArm.rotation.x = -1.35 + handEase * 1.0;
    this.rightArm.rotation.z = 0.34 * (1 - handEase);
    this.rightArm.rotation.y = -0.1 * (1 - handEase);
    const leadFoot = Math.min(1, p * 2.0);
    const trailFoot = Math.max(0, (p - 0.3) * 1.428);
    const leadEase = leadFoot < 0.5 ? 2 * leadFoot * leadFoot : 1 - (-2 * leadFoot + 2) ** 2 / 2;
    const trailEase = trailFoot < 0.5 ? 2 * trailFoot * trailFoot : 1 - (-2 * trailFoot + 2) ** 2 / 2;
    this.leftLeg.rotation.x = -0.5 + leadEase * 0.5;
    this.rightLeg.rotation.x = -0.5 + trailEase * 0.5;
    this.visualRoot.position.y = ease * 0.1;
    this.head.rotation.x = -0.12 * (1 - ease);
    this.head.rotation.y = Math.sin(elapsed * 3) * 0.01 * (1 - ease);
    this.weaponRoot.rotation.z = 0.18 * (1 - ease);
    this.shieldRoot.rotation.x = 0.1 * (1 - ease);
  }

  /** Release the scripted-pose lock so walk/run and idle animation drive the limbs again. */
  clearInteractionPose(): void {
    this.interactionPoseActive = false;
  }

  updateAnimation(state: UnitState, elapsed: number, attackProgress: number, hitProgress: number, deathProgress: number, carryingFlag: boolean): void {
    const idleBob = Math.sin(elapsed * 3.4) * 0.042;
    this.torso.position.y = 1.35 + idleBob;
    this.head.rotation.y = Math.sin(elapsed * 1.5) * 0.05;

    if ((state === 'moving' || state === 'climbing') && !this.interactionPoseActive) {
      const speed = this.kind === 'raider' ? 10.5 : this.kind === 'ironGuard' ? 6.8 : 8.5;
      const swing = Math.sin(elapsed * speed);
      const legArc = state === 'climbing' ? 0.52 : 0.74;
      const armArc = state === 'climbing' ? 0.78 : 0.52;
      this.leftLeg.rotation.x = swing * legArc;
      this.rightLeg.rotation.x = -swing * legArc;
      this.leftArm.rotation.x = -swing * armArc;
      this.rightArm.rotation.x = swing * armArc;
      this.visualRoot.position.y = Math.abs(Math.sin(elapsed * speed)) * (state === 'climbing' ? 0.038 : 0.08);
      this.torso.rotation.z = Math.sin(elapsed * speed * 0.5) * (state === 'climbing' ? 0.020 : 0.040);
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
        this.leftArm.rotation.x = -1.22;
        this.leftArm.rotation.y = -0.38;
        this.rightArm.rotation.x = -1.25;
        this.rightArm.rotation.y = 0.82 - arc * 0.82;
        this.torso.rotation.y = -0.18;
      } else {
        this.rightArm.rotation.x = -1.18 + arc * 2.20;
        this.rightArm.rotation.z = -0.34 + arc * 0.68;
        this.torso.rotation.y = -0.34 + arc * 0.65;
        this.weaponRoot.rotation.z = arc * 0.62;
        if (this.kind === 'ironGuard') this.leftArm.rotation.x = -0.78;
      }
    }

    if (state === 'hit') {
      this.torso.rotation.x = -Math.sin(hitProgress * Math.PI) * 0.42;
      this.head.rotation.x = Math.sin(hitProgress * Math.PI) * 0.28;
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
    const teamCloth = materials.teamCloth(this.team);
    const teamArmor = materials.teamArmor(this.team);
    const teamAccent = materials.teamAccent(this.team);
    const bodyWidth = this.kind === 'ironGuard' ? 1.38 : this.kind === 'raider' ? 0.88 : 1.12;
    const bodyHeight = this.kind === 'ironGuard' ? 1.48 : 1.28;

    const torsoMesh = MeshBuilder.CreateCapsule(`${this.root.name}-body`, { height: bodyHeight, radius: bodyWidth * 0.44, tessellation: 8, subdivisions: 2 }, scene);
    torsoMesh.parent = this.torso;
    torsoMesh.position.y = 0.25;
    torsoMesh.scaling.x = 1.18;
    // Every class wears the team tabard as its largest single block. Rangers keep their hood,
    // quiver and bow; only the tunic material changes from leather to the team cloth.
    torsoMesh.material = teamCloth;

    const chest = MeshBuilder.CreateBox(`${this.root.name}-chest`, { width: bodyWidth * 0.76, height: 0.74, depth: 0.54 }, scene);
    chest.parent = this.torso;
    chest.position = new Vector3(0, 0.36, -0.02);
    // Armor plate over the tabard: silver for blue, dark iron for red. Raiders carry a cloth
    // vest instead of plate, so their whole torso reads as one team-colored block.
    chest.material = this.kind === 'raider' ? teamCloth : teamArmor;
    chest.rotation.x = -0.05;

    const belt = MeshBuilder.CreateCylinder(`${this.root.name}-belt`, { height: 0.20, diameter: bodyWidth * 0.94, tessellation: 8 }, scene);
    belt.parent = this.torso;
    belt.position.y = -0.25;
    belt.material = materials.black;

    const headMesh = MeshBuilder.CreateSphere(`${this.root.name}-head-mesh`, { diameter: this.kind === 'ironGuard' ? 0.92 : 0.82, segments: 8 }, scene);
    headMesh.parent = this.head;
    headMesh.material = materials.skin;

    this.buildHeadwear(scene, materials, teamMaterial, teamDark);
    this.buildLimbs(scene, materials, teamDark);
    this.buildWeapon(scene, materials, teamMaterial, teamDark);
    this.buildShoulderPads(scene, teamArmor, teamAccent);
    this.buildCape(scene, materials, teamCloth);

    if (this.kind === 'ironGuard') {
      const backPlate = MeshBuilder.CreateBox(`${this.root.name}-back-plate`, { width: 1.48, height: 1.42, depth: 0.26 }, scene);
      backPlate.parent = this.torso;
      backPlate.position = new Vector3(0, 0.24, 0.34);
      backPlate.material = teamArmor;
    }

    if (this.kind === 'raider') {
      const scarf = MeshBuilder.CreateBox(`${this.root.name}-scarf`, { width: 0.30, height: 1.32, depth: 0.14 }, scene);
      scarf.parent = this.torso;
      scarf.position = new Vector3(0.38, 0.05, 0.36);
      scarf.rotation.z = -0.2;
      scarf.material = teamCloth;
    }

    if (this.kind === 'ranger') {
      const quiver = MeshBuilder.CreateCylinder(`${this.root.name}-quiver`, { height: 1.12, diameter: 0.44, tessellation: 8 }, scene);
      quiver.parent = this.torso;
      quiver.position = new Vector3(-0.42, 0.25, 0.36);
      quiver.rotation.z = -0.28;
      quiver.material = materials.leather;
      for (let i = 0; i < 3; i += 1) {
        const arrow = MeshBuilder.CreateCylinder(`${this.root.name}-quiver-arrow-${i}`, { height: 1.32, diameter: 0.05, tessellation: 5 }, scene);
        arrow.parent = this.torso;
        arrow.position = new Vector3(-0.52 + i * 0.10, 0.72, 0.37);
        arrow.rotation.z = -0.25;
        arrow.material = materials.wood;
      }
    }
  }

  /**
   * Large armor pauldrons with a bright team cap on top. Every class gets them so the shoulder
   * line is a team-colored block from the gameplay camera, not a thin strap. The caps stay
   * clearly visible against both the silver (blue) and dark-iron (red) armor below.
   */
  private buildShoulderPads(scene: Scene, teamArmor: Material, teamAccent: Material): void {
    const diameter = this.kind === 'ironGuard' ? 0.9 : this.kind === 'vanguard' ? 0.74 : this.kind === 'ranger' ? 0.58 : 0.54;
    const capDiameter = diameter * 0.55;
    const armY = this.kind === 'ironGuard' ? 0.62 : 0.56;
    const armX = this.kind === 'ironGuard' ? 0.78 : this.kind === 'ranger' || this.kind === 'raider' ? 0.6 : 0.62;
    for (const side of [-1, 1] as const) {
      const pad = MeshBuilder.CreateSphere(`${this.root.name}-pad-${side}`, { diameter, segments: 7 }, scene);
      pad.parent = this.torso;
      pad.position = new Vector3(side * armX, armY, 0);
      pad.scaling.y = 0.72;
      pad.material = teamArmor;
      const cap = MeshBuilder.CreateSphere(`${this.root.name}-pad-cap-${side}`, { diameter: capDiameter, segments: 6 }, scene);
      cap.parent = this.torso;
      cap.position = new Vector3(side * armX, armY + diameter * 0.26, 0);
      cap.scaling.y = 0.62;
      cap.material = teamAccent;
    }
  }

  /**
   * Rigid back cloth in the team color with one bold white center stripe. A full-height block,
   * not a trim: it covers most of the back so player units (seen from behind by the portrait
   * camera) read as solid blue/red. The stripe doubles the marking for enemy units seen head-on.
   * Rangers wear a half-cape clear of their quiver, offset to the free right side.
   */
  private buildCape(scene: Scene, materials: MaterialLibrary, teamCloth: Material): void {
    const iron = this.kind === 'ironGuard';
    const ranger = this.kind === 'ranger';
    const raider = this.kind === 'raider';
    const width = iron ? 1.6 : ranger ? 0.7 : raider ? 1.0 : 1.3;
    const height = iron ? 1.46 : ranger ? 1.3 : raider ? 1.28 : 1.38;
    const depth = iron ? 0.16 : ranger ? 0.12 : 0.14;
    const offsetX = ranger ? 0.15 : 0;
    const backZ = iron ? 0.56 : ranger ? 0.52 : 0.5;
    const cape = MeshBuilder.CreateBox(`${this.root.name}-cape`, { width, height, depth }, scene);
    cape.parent = this.torso;
    cape.position = new Vector3(offsetX, 0.08, backZ);
    // Lean the bottom edge away from the body so the cloth reads as draped, not glued.
    cape.rotation.x = -0.1;
    cape.material = teamCloth;
    // The stripe rides on the cape surface (parented so it shares the lean) and stays proud of it
    // by a hair, so it never z-fights or sinks into the cloth from any camera angle.
    const stripe = MeshBuilder.CreateBox(`${this.root.name}-cape-stripe`, { width: 0.2, height: height * 0.85, depth: 0.035 }, scene);
    stripe.parent = cape;
    stripe.position = new Vector3(0, 0, depth / 2 + 0.03);
    stripe.material = materials.white;
  }

  private buildHeadwear(scene: Scene, materials: MaterialLibrary, _teamMaterial: Material, _teamDark: Material): void {
    const teamCloth = materials.teamCloth(this.team);
    const teamArmor = materials.teamArmor(this.team);
    const teamAccent = materials.teamAccent(this.team);

    if (this.kind === 'ranger') {
      const hood = MeshBuilder.CreateCylinder(`${this.root.name}-hood`, { height: 0.88, diameterTop: 0.22, diameterBottom: 0.96, tessellation: 8 }, scene);
      hood.parent = this.head;
      hood.position.y = 0.22;
      hood.material = teamCloth;
      const mask = MeshBuilder.CreateBox(`${this.root.name}-mask`, { width: 0.66, height: 0.28, depth: 0.15 }, scene);
      mask.parent = this.head;
      mask.position = new Vector3(0, -0.08, -0.38);
      mask.material = materials.black;
      const crest = MeshBuilder.CreateBox(`${this.root.name}-crest`, { width: 0.13, height: 0.42, depth: 0.32 }, scene);
      crest.parent = this.head;
      crest.position = new Vector3(0, 0.84, 0.05);
      crest.material = teamAccent;
      return;
    }

    if (this.kind === 'ironGuard') {
      const helmet = MeshBuilder.CreateCylinder(`${this.root.name}-helmet`, { height: 0.82, diameter: 1.04, tessellation: 8 }, scene);
      helmet.parent = this.head;
      helmet.position.y = 0.14;
      helmet.material = teamArmor;
      const visor = MeshBuilder.CreateBox(`${this.root.name}-visor`, { width: 0.94, height: 0.27, depth: 0.18 }, scene);
      visor.parent = this.head;
      visor.position = new Vector3(0, 0.04, -0.50);
      visor.material = materials.black;
      const crest = MeshBuilder.CreateBox(`${this.root.name}-crest`, { width: 0.26, height: 0.95, depth: 0.66 }, scene);
      crest.parent = this.head;
      crest.position = new Vector3(0, 0.72, 0.05);
      crest.material = teamAccent;
      return;
    }

    if (this.kind === 'vanguard') {
      const hair = MeshBuilder.CreateCylinder(`${this.root.name}-hair`, { height: 0.48, diameterTop: 0.48, diameterBottom: 0.88, tessellation: 8 }, scene);
      hair.parent = this.head;
      hair.position.y = 0.30;
      hair.material = teamCloth;
      const brow = MeshBuilder.CreateBox(`${this.root.name}-brow`, { width: 0.80, height: 0.14, depth: 0.15 }, scene);
      brow.parent = this.head;
      brow.position = new Vector3(0, 0.05, -0.39);
      brow.material = teamAccent;
      const crest = MeshBuilder.CreateBox(`${this.root.name}-crest`, { width: 0.15, height: 0.5, depth: 0.4 }, scene);
      crest.parent = this.head;
      crest.position = new Vector3(0, 0.74, 0.05);
      crest.material = teamAccent;
      return;
    }

    const cowl = MeshBuilder.CreateCylinder(`${this.root.name}-cowl`, { height: 0.52, diameterTop: 0.56, diameterBottom: 0.92, tessellation: 8 }, scene);
    cowl.parent = this.head;
    cowl.position.y = 0.30;
    cowl.material = teamCloth;
    const eyeBand = MeshBuilder.CreateBox(`${this.root.name}-eye-band`, { width: 0.74, height: 0.17, depth: 0.15 }, scene);
    eyeBand.parent = this.head;
    eyeBand.position = new Vector3(0, 0, -0.39);
    eyeBand.material = teamAccent;
    const crest = MeshBuilder.CreateBox(`${this.root.name}-crest`, { width: 0.13, height: 0.42, depth: 0.34 }, scene);
    crest.parent = this.head;
    crest.position = new Vector3(0, 0.74, 0.05);
    crest.material = teamAccent;
  }

  private buildLimbs(scene: Scene, materials: MaterialLibrary, _teamDark: Material): void {
    const teamCloth = materials.teamCloth(this.team);
    const armRadius = this.kind === 'ironGuard' ? 0.27 : 0.22;
    const armLength = this.kind === 'ironGuard' ? 1.30 : 1.18;
    for (const [node, side] of [[this.leftArm, 'left'], [this.rightArm, 'right']] as const) {
      const arm = MeshBuilder.CreateCapsule(`${this.root.name}-${side}-arm-mesh`, { height: armLength, radius: armRadius, tessellation: 7, subdivisions: 1 }, scene);
      arm.parent = node;
      arm.position.y = -0.52;
      // Sleeves in the team tabard cloth: another large colored block on every class.
      arm.material = teamCloth;
      const hand = MeshBuilder.CreateSphere(`${this.root.name}-${side}-hand`, { diameter: armRadius * 1.75, segments: 7 }, scene);
      hand.parent = node;
      hand.position.y = -1.06;
      hand.material = materials.skin;
    }

    const legRadius = this.kind === 'ironGuard' ? 0.29 : 0.24;
    const legLength = this.kind === 'ironGuard' ? 1.48 : 1.34;
    for (const [node, side] of [[this.leftLeg, 'left'], [this.rightLeg, 'right']] as const) {
      const leg = MeshBuilder.CreateCapsule(`${this.root.name}-${side}-leg-mesh`, { height: legLength, radius: legRadius, tessellation: 7, subdivisions: 1 }, scene);
      leg.parent = node;
      leg.position.y = -0.54;
      leg.material = materials.black;
      const boot = MeshBuilder.CreateBox(`${this.root.name}-${side}-boot`, { width: 0.48, height: 0.32, depth: 0.72 }, scene);
      boot.parent = node;
      boot.position = new Vector3(0, -1.18, -0.14);
      boot.material = materials.leather;
    }
  }

  private buildWeapon(scene: Scene, materials: MaterialLibrary, _teamMaterial: Material, _teamDark: Material): void {
    const teamArmor = materials.teamArmor(this.team);
    const teamAccent = materials.teamAccent(this.team);
    if (this.kind === 'ranger') {
      const upperLimb = MeshBuilder.CreateCylinder(`${this.root.name}-bow-upper`, { height: 1.06, diameter: 0.11, tessellation: 7 }, scene);
      upperLimb.parent = this.weaponRoot;
      upperLimb.position = new Vector3(0.22, 0.40, 0);
      upperLimb.rotation.z = -0.43;
      upperLimb.material = materials.wood;
      const lowerLimb = MeshBuilder.CreateCylinder(`${this.root.name}-bow-lower`, { height: 1.06, diameter: 0.11, tessellation: 7 }, scene);
      lowerLimb.parent = this.weaponRoot;
      lowerLimb.position = new Vector3(0.22, -0.40, 0);
      lowerLimb.rotation.z = 0.43;
      lowerLimb.material = materials.wood;
      const grip = MeshBuilder.CreateCylinder(`${this.root.name}-bow-grip`, { height: 0.48, diameter: 0.15, tessellation: 7 }, scene);
      grip.parent = this.weaponRoot;
      grip.position = new Vector3(0.42, 0, 0);
      grip.material = materials.leather;
      const string = MeshBuilder.CreateCylinder(`${this.root.name}-bow-string`, { height: 1.72, diameter: 0.028, tessellation: 5 }, scene);
      string.parent = this.weaponRoot;
      string.position.x = -0.03;
      string.material = materials.white;
      return;
    }

    if (this.kind === 'ironGuard') {
      // Tower shield held out at the left flank, facing front/back (axis along Z after the
      // rotation), so the portrait camera sees a full roundel instead of a sliver buried in the
      // torso. The bright face carries a large white cross raised off the camera-side cap.
      const shield = MeshBuilder.CreateCylinder(`${this.root.name}-shield-mesh`, { height: 0.28, diameter: 1.72, tessellation: 12 }, scene);
      shield.parent = this.shieldRoot;
      shield.position.x = -0.55;
      shield.rotation.x = Math.PI / 2;
      shield.material = materials.metal;
      const shieldFace = MeshBuilder.CreateCylinder(`${this.root.name}-shield-face`, { height: 0.30, diameter: 1.28, tessellation: 12 }, scene);
      shieldFace.parent = this.shieldRoot;
      shieldFace.position.set(-0.55, 0, 0.11);
      shieldFace.rotation.x = Math.PI / 2;
      shieldFace.material = teamAccent;
      const emblemV = MeshBuilder.CreateBox(`${this.root.name}-shield-emblem-v`, { width: 0.06, height: 0.22, depth: 1.0 }, scene);
      emblemV.parent = shieldFace;
      emblemV.position.set(0, 0.16, 0);
      emblemV.material = materials.white;
      const emblemH = MeshBuilder.CreateBox(`${this.root.name}-shield-emblem-h`, { width: 0.06, height: 0.66, depth: 0.22 }, scene);
      emblemH.parent = shieldFace;
      emblemH.position.set(0, 0.16, 0);
      emblemH.material = materials.white;
      const maceHandle = MeshBuilder.CreateCylinder(`${this.root.name}-mace-handle`, { height: 1.38, diameter: 0.13, tessellation: 7 }, scene);
      maceHandle.parent = this.weaponRoot;
      maceHandle.position.y = -0.30;
      maceHandle.material = materials.wood;
      const maceHead = MeshBuilder.CreatePolyhedron(`${this.root.name}-mace-head`, { type: 1, size: 0.50 }, scene);
      maceHead.parent = this.weaponRoot;
      maceHead.position.y = -1.02;
      maceHead.material = materials.metal;
      return;
    }

    const bladeLength = this.kind === 'raider' ? 1.08 : 1.52;
    const handle = MeshBuilder.CreateCylinder(`${this.root.name}-weapon-handle`, { height: 0.64, diameter: 0.14, tessellation: 7 }, scene);
    handle.parent = this.weaponRoot;
    handle.position.y = -0.18;
    handle.material = materials.leather;
    const blade = MeshBuilder.CreateBox(`${this.root.name}-blade`, { width: this.kind === 'raider' ? 0.20 : 0.30, height: bladeLength, depth: 0.09 }, scene);
    blade.parent = this.weaponRoot;
    blade.position.y = -0.80;
    blade.material = materials.metal;
    const guard = MeshBuilder.CreateBox(`${this.root.name}-weapon-guard`, { width: 0.66, height: 0.13, depth: 0.15 }, scene);
    guard.parent = this.weaponRoot;
    guard.position.y = -0.44;
    guard.material = teamArmor;

    if (this.kind === 'vanguard') {
      const axeBack = MeshBuilder.CreateBox(`${this.root.name}-axe-back`, { width: 0.50, height: 0.56, depth: 0.14 }, scene);
      axeBack.parent = this.weaponRoot;
      axeBack.position = new Vector3(0.34, -1.15, 0);
      axeBack.rotation.z = 0.34;
      axeBack.material = materials.metal;
    }

    if (this.kind === 'raider') {
      const secondBlade = blade.clone(`${this.root.name}-second-blade`) as Mesh;
      secondBlade.parent = this.shieldRoot;
      secondBlade.position = new Vector3(0, -0.82, 0);
      secondBlade.rotation.z = -0.15;
      const secondHandle = handle.clone(`${this.root.name}-second-handle`) as Mesh;
      secondHandle.parent = this.shieldRoot;
      secondHandle.position = new Vector3(0, -0.20, 0);
    }
  }
}
