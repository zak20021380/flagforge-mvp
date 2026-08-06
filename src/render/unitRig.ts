import {
  Material,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import type { Team, UnitKind, UnitState } from '../core/types';
import { MaterialLibrary } from './materials';

/**
 * World-space hand target on a real ladder surface. The ladder system derives these from the
 * visible rung/rail geometry; the rig only solves the two-bone arm toward them.
 */
export interface ClimbGrip {
  /** Point on the gripped surface (rung front face or rail head), in world space. */
  readonly position: Vector3;
  /** Surface normal pointing from the ladder toward the climber. */
  readonly normal: Vector3;
  /** Unit direction along the gripped bar (rail-to-rail), signed toward the gripping hand. */
  readonly lateral: Vector3;
}

export interface ClimbGripPair {
  readonly left: ClimbGrip;
  readonly right: ClimbGrip;
}

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
  private readonly leftForearm: TransformNode;
  private readonly rightForearm: TransformNode;
  private readonly leftHandNode: TransformNode;
  private readonly rightHandNode: TransformNode;
  private readonly leftLeg: TransformNode;
  private readonly rightLeg: TransformNode;
  private readonly weaponRoot: TransformNode;
  private readonly shieldRoot: TransformNode;
  private readonly healthBack: Mesh;
  private readonly healthFill: Mesh;
  private readonly baseScale: number;
  private deathRotation = 0;

  // Arm bone lengths (local units; the visualRoot scale is applied at solve time). The elbow sits
  // half-way down the arm so the two-bone IK can bend it while the hand stays at the original
  // hand anchor (-1.06 local) for every unit kind.
  private static readonly ARM_UPPER = 0.53;
  private static readonly ARM_FORE = 0.53;
  private static readonly ARM_DOWN = new Vector3(0, -1, 0);

  /** World-space hand sphere radius, used to seat the palm ON the rung face instead of inside it. */
  private handRadiusWorld = 0;

  /** Persistent copies of the current climb grips (the ladder reuses its own scratch vectors). */
  private readonly gripLeft = {
    position: Vector3.Zero(),
    normal: Vector3.Zero(),
    lateral: Vector3.Zero(),
  };
  private readonly gripRight = {
    position: Vector3.Zero(),
    normal: Vector3.Zero(),
    lateral: Vector3.Zero(),
  };

  /** Scratch buffers for the two-bone solve (no per-frame allocation). */
  private readonly ik = {
    target: Vector3.Zero(),
    pole: Vector3.Zero(),
    toTarget: Vector3.Zero(),
    triDir: Vector3.Zero(),
    poleDir: Vector3.Zero(),
    bendAxis: Vector3.Zero(),
    bendDir: Vector3.Zero(),
    elbow: Vector3.Zero(),
    upperDir: Vector3.Zero(),
    foreDir: Vector3.Zero(),
    qWorld: new Quaternion(),
    qParent: new Quaternion(),
    qLocal: new Quaternion(),
    qInv: new Quaternion(),
    rotMat: new Matrix(),
    euler: Vector3.Zero(),
  };

  private weaponCarriedOnBack = false;
  private weaponRestParent: TransformNode | null = null;
  private readonly weaponRestPosition = Vector3.Zero();
  private readonly weaponRestRotation = Vector3.Zero();
  private shieldRestParent: TransformNode | null = null;
  private readonly shieldRestPosition = Vector3.Zero();
  private readonly shieldRestRotation = Vector3.Zero();

  constructor(scene: Scene, materials: MaterialLibrary, readonly kind: UnitKind, readonly team: Team, id: number) {
    this.root = new TransformNode(`unit-${id}-${team}-${kind}`, scene);
    this.visualRoot = new TransformNode(`unit-${id}-visual`, scene);
    this.visualRoot.parent = this.root;

    this.shadow = MeshBuilder.CreateDisc(`unit-${id}-shadow`, { radius: kind === 'brax' ? 0.92 : kind === 'fuse' ? 0.74 : 0.66, tessellation: 24 }, scene);
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

    const armXBase = kind === 'brax' ? 0.68 : 0.58;
    const armYBase = kind === 'brax' ? 0.66 : 0.62;
    this.leftArm = new TransformNode(`unit-${id}-left-arm`, scene);
    this.leftArm.parent = this.torso;
    this.leftArm.position = new Vector3(-armXBase, armYBase, 0);

    this.rightArm = new TransformNode(`unit-${id}-right-arm`, scene);
    this.rightArm.parent = this.torso;
    this.rightArm.position = new Vector3(armXBase, armYBase, 0);

    this.leftForearm = new TransformNode(`unit-${id}-left-forearm`, scene);
    this.leftForearm.parent = this.leftArm;
    this.leftForearm.position.y = -UnitRig.ARM_UPPER;

    this.rightForearm = new TransformNode(`unit-${id}-right-forearm`, scene);
    this.rightForearm.parent = this.rightArm;
    this.rightForearm.position.y = -UnitRig.ARM_UPPER;

    this.leftHandNode = new TransformNode(`unit-${id}-left-hand`, scene);
    this.leftHandNode.parent = this.leftForearm;
    this.leftHandNode.position.y = -UnitRig.ARM_FORE;

    this.rightHandNode = new TransformNode(`unit-${id}-right-hand`, scene);
    this.rightHandNode.parent = this.rightForearm;
    this.rightHandNode.position.y = -UnitRig.ARM_FORE;

    const legXBase = kind === 'brax' ? 0.36 : 0.30;
    this.leftLeg = new TransformNode(`unit-${id}-left-leg`, scene);
    this.leftLeg.parent = this.visualRoot;
    this.leftLeg.position = new Vector3(-legXBase, 1.03, 0);

    this.rightLeg = new TransformNode(`unit-${id}-right-leg`, scene);
    this.rightLeg.parent = this.visualRoot;
    this.rightLeg.position = new Vector3(legXBase, 1.03, 0);

    // Weapons hang from the FOREARM now: the elbow joint sits at -ARM_UPPER, so the rest offsets
    // are shifted by that amount to keep the exact same world attachment when the forearm is
    // straight (all non-climb poses). During the climb the roots are re-parented to the torso's
    // back so the gripping hands stay clear of sword, mace, bow and shield.
    this.weaponRoot = new TransformNode(`unit-${id}-weapon`, scene);
    this.weaponRoot.parent = this.rightForearm;
    this.weaponRoot.position = new Vector3(0, -0.65 + UnitRig.ARM_UPPER, 0.02);

    this.shieldRoot = new TransformNode(`unit-${id}-shield`, scene);
    this.shieldRoot.parent = this.leftForearm;
    this.shieldRoot.position = new Vector3(0, -0.55 + UnitRig.ARM_UPPER, 0.1);

    this.flagSocket = new TransformNode(`unit-${id}-flag-socket`, scene);
    this.flagSocket.parent = this.torso;
    this.flagSocket.position = new Vector3(0.55, 1.25, -0.22);

    // Kept in step with UNIT_STATS[kind].scale so the collision body and the silhouette agree:
    // BRAX is the broadest, FUSE is compact but bulky, NYX is slim and VEX is the smallest.
    this.baseScale = (kind === 'brax' ? 1.06 : kind === 'vex' ? 0.88 : kind === 'nyx' ? 0.94 : 1.02) * 1.15;
    this.visualRoot.scaling.set(this.baseScale, this.baseScale * 1.02, this.baseScale);
    this.buildBody(scene, materials);

    this.healthBack = MeshBuilder.CreateBox(`unit-${id}-health-back`, { width: 1.2, height: 0.07, depth: 0.03 }, scene);
    this.healthBack.parent = this.root;
    this.healthBack.position = new Vector3(0, kind === 'brax' ? 4.05 : 3.45, 0);
    this.healthBack.material = materials.black;
    this.healthBack.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.healthBack.isPickable = false;

    this.healthFill = MeshBuilder.CreateBox(`unit-${id}-health-fill`, { width: 1.14, height: 0.045, depth: 0.035 }, scene);
    this.healthFill.parent = this.root;
    this.healthFill.position = new Vector3(0, kind === 'brax' ? 4.05 : 3.45, -0.02);
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
    this.leftForearm.rotation.set(0, 0, 0);
    this.rightForearm.rotation.set(0, 0, 0);
    this.leftLeg.rotation.set(0, 0, 0);
    this.rightLeg.rotation.set(0, 0, 0);
    this.weaponRoot.rotation.set(0, 0, 0);
    this.shieldRoot.rotation.set(0, 0, 0);
    this.deathRotation = 0;
    if (this.weaponCarriedOnBack) this.setWeaponCarryOnBack(false);
    this.setHealthRatio(1);
  }

  /**
   * Stow the weapon and shield on the torso's back for the whole climb. Both hands must grip the
   * ladder, so daggers, bow, bomb charges and BRAX's big round shield leave the forearms while the
   * climb interaction owns the arms. The previous parent/position/rotation is stored and restored
   * exactly when the climb ends.
   */
  setWeaponCarryOnBack(carry: boolean): void {
    if (this.weaponCarriedOnBack === carry) return;
    this.weaponCarriedOnBack = carry;
    if (carry) {
      this.weaponRestParent = this.weaponRoot.parent as TransformNode | null;
      this.weaponRestPosition.copyFrom(this.weaponRoot.position);
      this.weaponRestRotation.copyFrom(this.weaponRoot.rotation);
      this.weaponRoot.parent = this.torso;
      this.weaponRoot.position.set(0.18, 0.12, 0.56);
      this.weaponRoot.rotation.set(0, 0, 0);
      this.shieldRestParent = this.shieldRoot.parent as TransformNode | null;
      this.shieldRestPosition.copyFrom(this.shieldRoot.position);
      this.shieldRestRotation.copyFrom(this.shieldRoot.rotation);
      this.shieldRoot.parent = this.torso;
      this.shieldRoot.position.set(0.28, 0.5, 0.38);
      this.shieldRoot.rotation.set(0, 0, 0);
    } else {
      if (this.weaponRestParent) this.weaponRoot.parent = this.weaponRestParent;
      this.weaponRoot.position.copyFrom(this.weaponRestPosition);
      this.weaponRoot.rotation.copyFrom(this.weaponRestRotation);
      if (this.shieldRestParent) this.shieldRoot.parent = this.shieldRestParent;
      this.shieldRoot.position.copyFrom(this.shieldRestPosition);
      this.shieldRoot.rotation.copyFrom(this.shieldRestRotation);
    }
  }

  applyMountPose(progress: number, lean: number, elapsed: number, grips?: ClimbGripPair, gripStrength = 1): void {
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
    if (grips) this.solveClimbArms(grips, gripStrength);
  }

  applyClimbCycle(phase: number, lean: number, elapsed: number, descending = false, grips?: ClimbGripPair, gripStrength = 1): void {
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
    // With hand IK active the arms rest in one fixed grip-ready pose so the strength blend into
    // the solved grips is steady; only the legs keep the swing cycle.
    const handSlide = grips ? 0 : 0.22;
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
    if (grips) this.solveClimbArms(grips, gripStrength);
  }

  applyTopDismount(progress: number, elapsed: number, grips?: ClimbGripPair, gripStrength = 1): void {
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
    if (grips) this.solveClimbArms(grips, gripStrength);
  }

  /**
   * Two-bone arm IK toward the climb grips, blended with the procedural pose the caller just
   * wrote. At gripStrength 0 the arms stay exactly on the procedural pose (mount/dis-mount start);
   * at 1 the hand spheres seat on the rung/rail surface. The planted hand target is a fixed rung
   * point, so the solve only changes while the body moves or a hand is scheduled to reach.
   */
  private solveClimbArms(grips: ClimbGripPair, gripStrength: number): void {
    const t = Math.max(0, Math.min(1, gripStrength));
    if (t <= 0.0001) return;
    this.gripLeft.position.copyFrom(grips.left.position);
    this.gripLeft.normal.copyFrom(grips.left.normal);
    this.gripLeft.lateral.copyFrom(grips.left.lateral);
    this.gripRight.position.copyFrom(grips.right.position);
    this.gripRight.normal.copyFrom(grips.right.normal);
    this.gripRight.lateral.copyFrom(grips.right.lateral);
    const scale = this.baseScale;
    const upper = UnitRig.ARM_UPPER * scale;
    const fore = UnitRig.ARM_FORE * scale;
    this.visualRoot.computeWorldMatrix(true);
    this.torso.computeWorldMatrix(true);
    this.solveClimbArm(this.leftArm, this.leftForearm, this.gripLeft, t, upper, fore);
    this.solveClimbArm(this.rightArm, this.rightForearm, this.gripRight, t, upper, fore);
  }

  private solveClimbArm(
    armNode: TransformNode,
    forearmNode: TransformNode,
    grip: { readonly position: Vector3; readonly normal: Vector3; readonly lateral: Vector3 },
    strength: number,
    upper: number,
    fore: number,
  ): void {
    const ik = this.ik;
    const armParent = armNode.parent as TransformNode;
    armParent.computeWorldMatrix(true);
    armNode.computeWorldMatrix(true);
    const shoulder = armNode.getAbsolutePosition();

    // Seat the palm ON the rung face: the hand sphere center sits a hand-radius back from the
    // surface along its normal, so the sphere touches the wood instead of floating or sinking.
    const palmLift = this.handRadiusWorld * 0.6;
    ik.target.set(
      grip.position.x + grip.normal.x * palmLift,
      grip.position.y + grip.normal.y * palmLift,
      grip.position.z + grip.normal.z * palmLift,
    );

    // Elbow pole: back (away from the ladder), flared toward the gripping side, and down — the
    // natural climbing elbow that keeps the forearm rising to the rung instead of snapping.
    ik.pole.set(
      shoulder.x + grip.normal.x * 1.15 + grip.lateral.x * 0.85,
      shoulder.y - 0.6,
      shoulder.z + grip.normal.z * 1.15 + grip.lateral.z * 0.85,
    );

    ik.toTarget.set(
      ik.target.x - shoulder.x,
      ik.target.y - shoulder.y,
      ik.target.z - shoulder.z,
    );
    const dist = ik.toTarget.length();
    if (dist < 0.01) return;
    const maxReach = upper + fore - 0.02;
    const minReach = Math.abs(upper - fore) + 0.02;
    const d = dist > maxReach ? maxReach : dist < minReach ? minReach : dist;
    ik.toTarget.scaleInPlace(d / dist);
    ik.triDir.copyFrom(ik.toTarget).normalize();
    let cosA = (upper * upper + d * d - fore * fore) / (2 * upper * d);
    cosA = cosA > 1 ? 1 : cosA < -1 ? -1 : cosA;
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    ik.poleDir.set(
      ik.pole.x - shoulder.x,
      ik.pole.y - shoulder.y,
      ik.pole.z - shoulder.z,
    ).normalize();
    Vector3.CrossToRef(ik.triDir, ik.poleDir, ik.bendAxis);
    if (ik.bendAxis.lengthSquared() < 1e-8) {
      Vector3.CrossToRef(ik.triDir, UnitRig.ARM_DOWN, ik.bendAxis);
    }
    ik.bendAxis.normalize();
    Vector3.CrossToRef(ik.bendAxis, ik.triDir, ik.bendDir);
    ik.bendDir.normalize();
    if (Vector3.Dot(ik.bendDir, ik.poleDir) < 0) ik.bendDir.scaleInPlace(-1);

    ik.elbow.set(
      shoulder.x + ik.triDir.x * upper * cosA + ik.bendDir.x * upper * sinA,
      shoulder.y + ik.triDir.y * upper * cosA + ik.bendDir.y * upper * sinA,
      shoulder.z + ik.triDir.z * upper * cosA + ik.bendDir.z * upper * sinA,
    );
    ik.upperDir.set(
      ik.elbow.x - shoulder.x,
      ik.elbow.y - shoulder.y,
      ik.elbow.z - shoulder.z,
    ).normalize();
    ik.foreDir.set(
      ik.target.x - ik.elbow.x,
      ik.target.y - ik.elbow.y,
      ik.target.z - ik.elbow.z,
    ).normalize();

    // --- Shoulder/upper arm: blend the solved orientation over the procedural rest pose. ---
    Quaternion.FromUnitVectorsToRef(UnitRig.ARM_DOWN, ik.upperDir, ik.qWorld);
    const parentMatrix = armParent.getWorldMatrix();
    parentMatrix.getRotationMatrixToRef(ik.rotMat);
    Quaternion.FromRotationMatrixToRef(ik.rotMat, ik.qParent);
    ik.qInv.copyFrom(ik.qParent).invert();
    ik.qLocal.copyFrom(ik.qInv).multiplyInPlace(ik.qWorld);
    ik.qLocal.toEulerAnglesToRef(ik.euler);
    const restX = armNode.rotation.x;
    const restY = armNode.rotation.y;
    const restZ = armNode.rotation.z;
    armNode.rotation.set(
      restX + (ik.euler.x - restX) * strength,
      restY + (ik.euler.y - restY) * strength,
      restZ + (ik.euler.z - restZ) * strength,
    );
    armNode.computeWorldMatrix(true);

    // --- Elbow/forearm: same solve in the (already blended) upper-arm frame. ---
    const armWorld = armNode.getWorldMatrix();
    armWorld.getRotationMatrixToRef(ik.rotMat);
    Quaternion.FromRotationMatrixToRef(ik.rotMat, ik.qWorld);
    Quaternion.FromUnitVectorsToRef(UnitRig.ARM_DOWN, ik.foreDir, ik.qLocal);
    ik.qInv.copyFrom(ik.qWorld).invert();
    ik.qLocal.copyFrom(ik.qInv).multiplyInPlace(ik.qLocal);
    ik.qLocal.toEulerAnglesToRef(ik.euler);
    const foreRestX = forearmNode.rotation.x;
    const foreRestY = forearmNode.rotation.y;
    const foreRestZ = forearmNode.rotation.z;
    forearmNode.rotation.set(
      foreRestX + (ik.euler.x - foreRestX) * strength,
      foreRestY + (ik.euler.y - foreRestY) * strength,
      foreRestZ + (ik.euler.z - foreRestZ) * strength,
    );
  }

  /** Release the scripted-pose lock so walk/run and idle animation drive the limbs again. */
  clearInteractionPose(): void {
    this.interactionPoseActive = false;
  }

  updateAnimation(state: UnitState, elapsed: number, attackProgress: number, hitProgress: number, deathProgress: number, carryingFlag: boolean): void {
    const idleSpeed = this.kind === 'brax' ? 2.6 : 3.4;
    const idleAmp = this.kind === 'brax' ? 0.032 : 0.042;
    const idleBob = Math.sin(elapsed * idleSpeed) * idleAmp;
    this.torso.position.y = 1.35 + idleBob;
    this.head.rotation.y = Math.sin(elapsed * 1.5) * 0.05;

    if ((state === 'moving' || state === 'climbing') && !this.interactionPoseActive) {
      // VEX sprints, BRAX and FUSE plod. The cadence difference is one of the clearest identity
      // cues from the gameplay camera, so it is deliberately wide.
      const speed = this.kind === 'vex' ? 11.0 : this.kind === 'brax' ? 5.8 : this.kind === 'fuse' ? 7.0 : 8.5;
      const swing = Math.sin(elapsed * speed);
      const legArc = state === 'climbing' ? 0.52 : (this.kind === 'brax' ? 0.62 : 0.74);
      const armArc = state === 'climbing' ? 0.78 : (this.kind === 'brax' ? 0.42 : 0.52);
      this.leftLeg.rotation.x = swing * legArc;
      this.rightLeg.rotation.x = -swing * legArc;
      this.leftArm.rotation.x = -swing * armArc;
      this.rightArm.rotation.x = swing * armArc;
      const bounce = state === 'climbing' ? 0.038 : (this.kind === 'brax' ? 0.06 : 0.08);
      this.visualRoot.position.y = Math.abs(Math.sin(elapsed * speed)) * bounce;
      const sway = state === 'climbing' ? 0.020 : (this.kind === 'brax' ? 0.032 : 0.040);
      this.torso.rotation.z = Math.sin(elapsed * speed * 0.5) * sway;
    } else if (!this.interactionPoseActive) {
      this.leftLeg.rotation.x *= 0.75;
      this.rightLeg.rotation.x *= 0.75;
      this.leftArm.rotation.x *= 0.75;
      this.rightArm.rotation.x *= 0.75;
      this.visualRoot.position.y *= 0.72;
    }

    if (state === 'attacking') {
      const arc = Math.sin(Math.min(1, attackProgress) * Math.PI);
      if (this.kind === 'nyx') {
        // Braced crossbow/bow aim: both arms lift level, the draw hand pulls back through the arc.
        this.leftArm.rotation.x = -1.22;
        this.leftArm.rotation.y = -0.38;
        this.rightArm.rotation.x = -1.25;
        this.rightArm.rotation.y = 0.82 - arc * 0.82;
        this.torso.rotation.y = -0.18;
      } else if (this.kind === 'fuse') {
        // Overhand bomb lob: the throwing arm winds up over the shoulder and snaps down and forward,
        // reading as a thrown charge rather than a sword swing.
        this.rightArm.rotation.x = -2.05 + arc * 2.75;
        this.rightArm.rotation.z = 0.18 - arc * 0.42;
        this.leftArm.rotation.x = -0.52 - arc * 0.28;
        this.torso.rotation.y = -0.22 + arc * 0.5;
        this.torso.rotation.x = -0.18 + arc * 0.3;
        this.weaponRoot.rotation.z = arc * 0.4;
      } else if (this.kind === 'brax') {
        this.rightArm.rotation.x = -1.28 + arc * 2.40;
        this.rightArm.rotation.z = -0.38 + arc * 0.76;
        this.torso.rotation.y = -0.38 + arc * 0.72;
        this.weaponRoot.rotation.z = arc * 0.70;
        this.leftArm.rotation.x = -0.82;
        this.shieldRoot.rotation.x = -0.12;
      } else {
        this.rightArm.rotation.x = -1.18 + arc * 2.20;
        this.rightArm.rotation.z = -0.34 + arc * 0.68;
        this.torso.rotation.y = -0.34 + arc * 0.65;
        this.weaponRoot.rotation.z = arc * 0.62;
      }
    }

    if (state === 'hit') {
      const hitRecoil = this.kind === 'brax' ? 0.32 : 0.42;
      const hitHead = this.kind === 'brax' ? 0.20 : 0.28;
      this.torso.rotation.x = -Math.sin(hitProgress * Math.PI) * hitRecoil;
      this.head.rotation.x = Math.sin(hitProgress * Math.PI) * hitHead;
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
    // BRAX is the widest and tallest torso block; FUSE is nearly as wide but shorter, so it reads
    // as a compact powder-keg next to BRAX's slab. VEX stays narrow.
    const bodyWidth = this.kind === 'brax' ? 1.48 : this.kind === 'vex' ? 0.88 : this.kind === 'fuse' ? 1.24 : 1.12;
    const bodyHeight = this.kind === 'brax' ? 1.56 : this.kind === 'fuse' ? 1.22 : 1.28;

    const torsoMesh = MeshBuilder.CreateCapsule(`${this.root.name}-body`, { height: bodyHeight, radius: bodyWidth * 0.44, tessellation: 8, subdivisions: 2 }, scene);
    torsoMesh.parent = this.torso;
    torsoMesh.position.y = 0.25;
    torsoMesh.scaling.x = this.kind === 'brax' ? 1.28 : 1.18;
    torsoMesh.material = teamCloth;

    const chest = MeshBuilder.CreateBox(`${this.root.name}-chest`, { width: bodyWidth * (this.kind === 'brax' ? 0.84 : 0.76), height: this.kind === 'brax' ? 0.82 : 0.74, depth: this.kind === 'brax' ? 0.62 : 0.54 }, scene);
    chest.parent = this.torso;
    chest.position = new Vector3(0, 0.36, -0.02);
    chest.material = this.kind === 'brax' ? materials.darkSteel : this.kind === 'vex' ? teamCloth : teamArmor;
    chest.rotation.x = -0.05;

    if (this.kind === 'brax') {
      const chestTrim = MeshBuilder.CreateBox(`${this.root.name}-chest-trim`, { width: bodyWidth * 0.86, height: 0.08, depth: 0.64 }, scene);
      chestTrim.parent = this.torso;
      chestTrim.position = new Vector3(0, 0.72, -0.02);
      chestTrim.material = materials.brassTrim;
      const chestLowerTrim = MeshBuilder.CreateBox(`${this.root.name}-chest-lower-trim`, { width: bodyWidth * 0.86, height: 0.06, depth: 0.64 }, scene);
      chestLowerTrim.parent = this.torso;
      chestLowerTrim.position = new Vector3(0, 0.0, -0.02);
      chestLowerTrim.material = materials.brassTrim;
    }

    const belt = MeshBuilder.CreateCylinder(`${this.root.name}-belt`, { height: this.kind === 'brax' ? 0.24 : 0.20, diameter: bodyWidth * 0.94, tessellation: 8 }, scene);
    belt.parent = this.torso;
    belt.position.y = -0.25;
    belt.material = this.kind === 'brax' ? materials.darkSteel : materials.black;

    if (this.kind === 'brax') {
      const beltBuckle = MeshBuilder.CreateBox(`${this.root.name}-belt-buckle`, { width: 0.28, height: 0.18, depth: 0.12 }, scene);
      beltBuckle.parent = this.torso;
      beltBuckle.position = new Vector3(0, -0.25, -0.42);
      beltBuckle.material = materials.brassTrim;
    }

    const headMesh = MeshBuilder.CreateSphere(`${this.root.name}-head-mesh`, { diameter: this.kind === 'brax' ? 0.96 : 0.82, segments: 8 }, scene);
    headMesh.parent = this.head;
    headMesh.material = materials.skin;

    if (this.kind === 'brax') {
      const jaw = MeshBuilder.CreateBox(`${this.root.name}-jaw`, { width: 0.52, height: 0.22, depth: 0.34 }, scene);
      jaw.parent = this.head;
      jaw.position = new Vector3(0, -0.32, -0.18);
      jaw.material = materials.skin;
      const brow = MeshBuilder.CreateBox(`${this.root.name}-brow`, { width: 0.68, height: 0.14, depth: 0.22 }, scene);
      brow.parent = this.head;
      brow.position = new Vector3(0, 0.18, -0.36);
      brow.material = materials.skin;
    }

    this.buildHeadwear(scene, materials, teamMaterial, teamDark);
    this.buildLimbs(scene, materials, teamDark);
    this.buildWeapon(scene, materials, teamMaterial, teamDark);
    this.buildShoulderPads(scene, materials, teamArmor, teamAccent);
    this.buildCape(scene, materials, teamCloth);

    if (this.kind === 'brax') {
      const backPlate = MeshBuilder.CreateBox(`${this.root.name}-back-plate`, { width: 1.58, height: 1.50, depth: 0.30 }, scene);
      backPlate.parent = this.torso;
      backPlate.position = new Vector3(0, 0.24, 0.36);
      backPlate.material = materials.darkSteel;
      const backTrimTop = MeshBuilder.CreateBox(`${this.root.name}-back-trim-top`, { width: 1.60, height: 0.07, depth: 0.32 }, scene);
      backTrimTop.parent = this.torso;
      backTrimTop.position = new Vector3(0, 0.96, 0.36);
      backTrimTop.material = materials.brassTrim;
      const backSpine = MeshBuilder.CreateBox(`${this.root.name}-back-spine`, { width: 0.18, height: 1.20, depth: 0.08 }, scene);
      backSpine.parent = this.torso;
      backSpine.position = new Vector3(0, 0.24, 0.52);
      backSpine.material = materials.brassTrim;
    }

    if (this.kind === 'vex') {
      const scarf = MeshBuilder.CreateBox(`${this.root.name}-scarf`, { width: 0.30, height: 1.32, depth: 0.14 }, scene);
      scarf.parent = this.torso;
      scarf.position = new Vector3(0.38, 0.05, 0.36);
      scarf.rotation.z = -0.2;
      scarf.material = teamCloth;
    }

    if (this.kind === 'nyx') {
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

    if (this.kind === 'fuse') {
      // Bomb pack: the whole point of FUSE's silhouette. A wide leather crate on the back with
      // three bomb spheres proud of it and a short lit fuse on the top charge, so the outline is
      // unmistakably "carrying explosives" even at portrait-camera distance.
      const pack = MeshBuilder.CreateBox(`${this.root.name}-bomb-pack`, { width: 1.16, height: 0.86, depth: 0.52 }, scene);
      pack.parent = this.torso;
      pack.position = new Vector3(0, 0.2, 0.52);
      pack.material = materials.leather;
      const packStrap = MeshBuilder.CreateBox(`${this.root.name}-bomb-strap`, { width: 1.24, height: 0.18, depth: 0.6 }, scene);
      packStrap.parent = this.torso;
      packStrap.position = new Vector3(0, 0.46, 0.5);
      packStrap.material = materials.black;
      for (const [index, offset] of [-0.42, 0.0, 0.42].entries()) {
        const bomb = MeshBuilder.CreateSphere(`${this.root.name}-bomb-${index}`, { diameter: 0.5, segments: 7 }, scene);
        bomb.parent = this.torso;
        bomb.position = new Vector3(offset, index === 1 ? 0.62 : 0.34, 0.82);
        bomb.material = materials.black;
        const cap = MeshBuilder.CreateCylinder(`${this.root.name}-bomb-cap-${index}`, { height: 0.16, diameter: 0.18, tessellation: 6 }, scene);
        cap.parent = bomb;
        cap.position.y = 0.28;
        cap.material = materials.metal;
      }
      // Lit fuse on the centre charge, in the team accent so it reads as a hot spark.
      const fuse = MeshBuilder.CreateCylinder(`${this.root.name}-bomb-fuse`, { height: 0.34, diameter: 0.07, tessellation: 5 }, scene);
      fuse.parent = this.torso;
      fuse.position = new Vector3(0.04, 1.02, 0.8);
      fuse.rotation.z = -0.42;
      fuse.material = teamAccent;
      const spark = MeshBuilder.CreateSphere(`${this.root.name}-bomb-spark`, { diameter: 0.2, segments: 6 }, scene);
      spark.parent = this.torso;
      spark.position = new Vector3(0.16, 1.16, 0.79);
      spark.material = materials.teamGlow(this.team);
    }
  }

  /**
   * Large armor pauldrons with a bright team cap on top. Every class gets them so the shoulder
   * line is a team-colored block from the gameplay camera, not a thin strap. The caps stay
   * clearly visible against both the silver (blue) and dark-iron (red) armor below.
   */
  private buildShoulderPads(scene: Scene, materials: MaterialLibrary, teamArmor: Material, teamAccent: Material): void {
    const diameter = this.kind === 'brax' ? 1.08 : this.kind === 'fuse' ? 0.7 : this.kind === 'nyx' ? 0.58 : 0.54;
    const capDiameter = diameter * 0.55;
    const armY = this.kind === 'brax' ? 0.66 : 0.56;
    const armX = this.kind === 'brax' ? 0.86 : this.kind === 'nyx' || this.kind === 'vex' ? 0.6 : 0.66;
    for (const side of [-1, 1] as const) {
      if (this.kind === 'brax') {
        const padBase = MeshBuilder.CreateBox(`${this.root.name}-pad-base-${side}`, { width: diameter * 0.92, height: diameter * 0.52, depth: diameter * 0.78 }, scene);
        padBase.parent = this.torso;
        padBase.position = new Vector3(side * armX, armY, 0);
        padBase.material = materials.darkSteel;
        const padTop = MeshBuilder.CreateSphere(`${this.root.name}-pad-${side}`, { diameter, segments: 7 }, scene);
        padTop.parent = this.torso;
        padTop.position = new Vector3(side * armX, armY + 0.08, 0);
        padTop.scaling.y = 0.62;
        padTop.material = materials.darkSteel;
        const padTrim = MeshBuilder.CreateCylinder(`${this.root.name}-pad-trim-${side}`, { height: 0.06, diameter: diameter * 0.96, tessellation: 8 }, scene);
        padTrim.parent = this.torso;
        padTrim.position = new Vector3(side * armX, armY - 0.12, 0);
        padTrim.material = materials.brassTrim;
        const cap = MeshBuilder.CreateSphere(`${this.root.name}-pad-cap-${side}`, { diameter: capDiameter, segments: 6 }, scene);
        cap.parent = this.torso;
        cap.position = new Vector3(side * armX, armY + diameter * 0.30, 0);
        cap.scaling.y = 0.58;
        cap.material = teamAccent;
      } else {
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
  }

  /**
   * Rigid back cloth in the team color with one bold white center stripe. A full-height block,
   * not a trim: it covers most of the back so player units (seen from behind by the portrait
   * camera) read as solid blue/red. The stripe doubles the marking for enemy units seen head-on.
   * NYX wears a half-cape clear of the quiver, offset to the free right side. FUSE gets none: the
   * bomb pack already owns its whole back, and cloth over it would bury the charges.
   */
  private buildCape(scene: Scene, materials: MaterialLibrary, teamCloth: Material): void {
    if (this.kind === 'fuse') return;
    const heavy = this.kind === 'brax';
    const marksman = this.kind === 'nyx';
    const rogue = this.kind === 'vex';
    const width = heavy ? 1.72 : marksman ? 0.7 : rogue ? 1.0 : 1.3;
    const height = heavy ? 1.58 : marksman ? 1.3 : rogue ? 1.28 : 1.38;
    const depth = heavy ? 0.18 : marksman ? 0.12 : 0.14;
    const offsetX = marksman ? 0.15 : 0;
    const backZ = heavy ? 0.56 : marksman ? 0.52 : 0.5;
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
    const teamAccent = materials.teamAccent(this.team);

    if (this.kind === 'nyx') {
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

    if (this.kind === 'brax') {
      const helmet = MeshBuilder.CreateCylinder(`${this.root.name}-helmet`, { height: 0.88, diameter: 1.12, tessellation: 8 }, scene);
      helmet.parent = this.head;
      helmet.position.y = 0.16;
      helmet.material = materials.darkSteel;
      const helmetBrim = MeshBuilder.CreateCylinder(`${this.root.name}-helmet-brim`, { height: 0.10, diameter: 1.22, tessellation: 8 }, scene);
      helmetBrim.parent = this.head;
      helmetBrim.position.y = -0.18;
      helmetBrim.material = materials.brassTrim;
      const visor = MeshBuilder.CreateBox(`${this.root.name}-visor`, { width: 1.02, height: 0.30, depth: 0.22 }, scene);
      visor.parent = this.head;
      visor.position = new Vector3(0, 0.02, -0.52);
      visor.material = materials.black;
      const visorSlit = MeshBuilder.CreateBox(`${this.root.name}-visor-slit`, { width: 0.72, height: 0.06, depth: 0.24 }, scene);
      visorSlit.parent = this.head;
      visorSlit.position = new Vector3(0, 0.06, -0.54);
      visorSlit.material = materials.teamGlow(this.team);
      const crestBase = MeshBuilder.CreateBox(`${this.root.name}-crest-base`, { width: 0.34, height: 0.18, depth: 0.72 }, scene);
      crestBase.parent = this.head;
      crestBase.position = new Vector3(0, 0.56, 0.05);
      crestBase.material = materials.brassTrim;
      const crest = MeshBuilder.CreateBox(`${this.root.name}-crest`, { width: 0.22, height: 1.05, depth: 0.58 }, scene);
      crest.parent = this.head;
      crest.position = new Vector3(0, 0.82, 0.05);
      crest.material = teamAccent;
      const cheekL = MeshBuilder.CreateBox(`${this.root.name}-cheek-l`, { width: 0.16, height: 0.42, depth: 0.38 }, scene);
      cheekL.parent = this.head;
      cheekL.position = new Vector3(-0.48, -0.10, -0.18);
      cheekL.material = materials.darkSteel;
      const cheekR = MeshBuilder.CreateBox(`${this.root.name}-cheek-r`, { width: 0.16, height: 0.42, depth: 0.38 }, scene);
      cheekR.parent = this.head;
      cheekR.position = new Vector3(0.48, -0.10, -0.18);
      cheekR.material = materials.darkSteel;
      return;
    }

    if (this.kind === 'fuse') {
      // Demolition head: low leather skullcap, two blast goggles and a breathing mask. The goggle
      // pair is the read at distance — two bright discs where every other class has a flat brow.
      const cap = MeshBuilder.CreateCylinder(`${this.root.name}-blast-cap`, { height: 0.42, diameterTop: 0.7, diameterBottom: 0.98, tessellation: 8 }, scene);
      cap.parent = this.head;
      cap.position.y = 0.26;
      cap.material = materials.leather;
      for (const side of [-1, 1] as const) {
        const goggle = MeshBuilder.CreateCylinder(`${this.root.name}-goggle-${side}`, { height: 0.16, diameter: 0.34, tessellation: 8 }, scene);
        goggle.parent = this.head;
        goggle.position = new Vector3(side * 0.19, 0.06, -0.36);
        goggle.rotation.x = Math.PI / 2;
        goggle.material = teamAccent;
      }
      const strap = MeshBuilder.CreateBox(`${this.root.name}-goggle-strap`, { width: 0.94, height: 0.14, depth: 0.86 }, scene);
      strap.parent = this.head;
      strap.position = new Vector3(0, 0.06, 0);
      strap.material = materials.black;
      const respirator = MeshBuilder.CreateBox(`${this.root.name}-respirator`, { width: 0.5, height: 0.3, depth: 0.2 }, scene);
      respirator.parent = this.head;
      respirator.position = new Vector3(0, -0.24, -0.36);
      respirator.material = materials.metal;
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
    const armRadius = this.kind === 'brax' ? 0.31 : this.kind === 'fuse' ? 0.25 : 0.22;
    const armLength = this.kind === 'brax' ? 1.38 : 1.18;
    const upperHeight = armLength * 0.52;
    const upperOffset = -armLength * 0.26;
    for (const [node, forearm, handNode, side] of [
      [this.leftArm, this.leftForearm, this.leftHandNode, 'left'],
      [this.rightArm, this.rightForearm, this.rightHandNode, 'right'],
    ] as const) {
      const upperArm = MeshBuilder.CreateCapsule(`${this.root.name}-${side}-arm-mesh`, { height: upperHeight, radius: armRadius, tessellation: 7, subdivisions: 1 }, scene);
      upperArm.parent = node;
      upperArm.position.y = upperOffset;
      upperArm.material = teamCloth;
      const forearmMesh = MeshBuilder.CreateCapsule(`${this.root.name}-${side}-forearm-mesh`, { height: upperHeight, radius: armRadius, tessellation: 7, subdivisions: 1 }, scene);
      forearmMesh.parent = forearm;
      forearmMesh.position.y = upperOffset;
      forearmMesh.material = this.kind === 'brax' ? materials.darkSteel : teamCloth;
      if (this.kind === 'brax') {
        const gauntletTrim = MeshBuilder.CreateCylinder(`${this.root.name}-${side}-gauntlet-trim`, { height: 0.06, diameter: armRadius * 2.1, tessellation: 8 }, scene);
        gauntletTrim.parent = forearm;
        gauntletTrim.position.y = upperOffset + upperHeight * 0.38;
        gauntletTrim.material = materials.brassTrim;
      }
      const hand = MeshBuilder.CreateSphere(`${this.root.name}-${side}-hand`, { diameter: armRadius * (this.kind === 'brax' ? 2.0 : 1.75), segments: 7 }, scene);
      hand.parent = handNode;
      hand.material = this.kind === 'brax' ? materials.darkSteel : materials.skin;
    }
    this.handRadiusWorld = armRadius * (this.kind === 'brax' ? 2.0 : 1.75) * 0.5 * this.baseScale;

    const legRadius = this.kind === 'brax' ? 0.33 : this.kind === 'fuse' ? 0.27 : 0.24;
    const legLength = this.kind === 'brax' ? 1.56 : this.kind === 'fuse' ? 1.26 : 1.34;
    for (const [node, side] of [[this.leftLeg, 'left'], [this.rightLeg, 'right']] as const) {
      const leg = MeshBuilder.CreateCapsule(`${this.root.name}-${side}-leg-mesh`, { height: legLength, radius: legRadius, tessellation: 7, subdivisions: 1 }, scene);
      leg.parent = node;
      leg.position.y = -0.54;
      leg.material = this.kind === 'brax' ? materials.darkSteel : materials.black;
      if (this.kind === 'brax') {
        const shinGuard = MeshBuilder.CreateBox(`${this.root.name}-${side}-shin-guard`, { width: legRadius * 1.8, height: legLength * 0.42, depth: legRadius * 1.4 }, scene);
        shinGuard.parent = node;
        shinGuard.position = new Vector3(0, -0.62, -legRadius * 0.4);
        shinGuard.material = materials.darkSteel;
        const shinTrim = MeshBuilder.CreateBox(`${this.root.name}-${side}-shin-trim`, { width: legRadius * 1.9, height: 0.06, depth: legRadius * 1.5 }, scene);
        shinTrim.parent = node;
        shinTrim.position = new Vector3(0, -0.42, -legRadius * 0.4);
        shinTrim.material = materials.brassTrim;
      }
      const bootWidth = this.kind === 'brax' ? 0.56 : 0.48;
      const bootHeight = this.kind === 'brax' ? 0.38 : 0.32;
      const bootDepth = this.kind === 'brax' ? 0.80 : 0.72;
      const boot = MeshBuilder.CreateBox(`${this.root.name}-${side}-boot`, { width: bootWidth, height: bootHeight, depth: bootDepth }, scene);
      boot.parent = node;
      boot.position = new Vector3(0, this.kind === 'brax' ? -1.26 : -1.18, -0.14);
      boot.material = this.kind === 'brax' ? materials.darkSteel : materials.leather;
    }
  }

  private buildWeapon(scene: Scene, materials: MaterialLibrary, _teamMaterial: Material, _teamDark: Material): void {
    const teamArmor = materials.teamArmor(this.team);
    const teamAccent = materials.teamAccent(this.team);
    if (this.kind === 'nyx') {
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

    if (this.kind === 'brax') {
      const shieldRim = MeshBuilder.CreateCylinder(`${this.root.name}-shield-rim`, { height: 0.34, diameter: 1.92, tessellation: 14 }, scene);
      shieldRim.parent = this.shieldRoot;
      shieldRim.position.x = -0.58;
      shieldRim.rotation.x = Math.PI / 2;
      shieldRim.material = materials.brassTrim;
      const shield = MeshBuilder.CreateCylinder(`${this.root.name}-shield-mesh`, { height: 0.30, diameter: 1.82, tessellation: 14 }, scene);
      shield.parent = this.shieldRoot;
      shield.position.x = -0.58;
      shield.rotation.x = Math.PI / 2;
      shield.material = materials.darkSteel;
      const shieldFace = MeshBuilder.CreateCylinder(`${this.root.name}-shield-face`, { height: 0.32, diameter: 1.38, tessellation: 14 }, scene);
      shieldFace.parent = this.shieldRoot;
      shieldFace.position.set(-0.58, 0, 0.12);
      shieldFace.rotation.x = Math.PI / 2;
      shieldFace.material = teamAccent;
      const emblemCenter = MeshBuilder.CreateCylinder(`${this.root.name}-shield-emblem-center`, { height: 0.34, diameter: 0.44, tessellation: 8 }, scene);
      emblemCenter.parent = shieldFace;
      emblemCenter.position.set(0, 0.17, 0);
      emblemCenter.rotation.x = Math.PI / 2;
      emblemCenter.material = materials.brassTrim;
      const emblemV = MeshBuilder.CreateBox(`${this.root.name}-shield-emblem-v`, { width: 0.08, height: 0.24, depth: 1.12 }, scene);
      emblemV.parent = shieldFace;
      emblemV.position.set(0, 0.17, 0);
      emblemV.material = materials.white;
      const emblemH = MeshBuilder.CreateBox(`${this.root.name}-shield-emblem-h`, { width: 0.08, height: 0.74, depth: 0.24 }, scene);
      emblemH.parent = shieldFace;
      emblemH.position.set(0, 0.17, 0);
      emblemH.material = materials.white;
      const maceHandle = MeshBuilder.CreateCylinder(`${this.root.name}-mace-handle`, { height: 1.52, diameter: 0.16, tessellation: 7 }, scene);
      maceHandle.parent = this.weaponRoot;
      maceHandle.position.y = -0.34;
      maceHandle.material = materials.darkSteel;
      const maceGrip = MeshBuilder.CreateCylinder(`${this.root.name}-mace-grip`, { height: 0.48, diameter: 0.22, tessellation: 7 }, scene);
      maceGrip.parent = this.weaponRoot;
      maceGrip.position.y = 0.12;
      maceGrip.material = materials.leather;
      const maceHead = MeshBuilder.CreatePolyhedron(`${this.root.name}-mace-head`, { type: 1, size: 0.62 }, scene);
      maceHead.parent = this.weaponRoot;
      maceHead.position.y = -1.14;
      maceHead.material = materials.darkSteel;
      const maceCapTop = MeshBuilder.CreateCylinder(`${this.root.name}-mace-cap-top`, { height: 0.10, diameter: 0.38, tessellation: 8 }, scene);
      maceCapTop.parent = this.weaponRoot;
      maceCapTop.position.y = -0.82;
      maceCapTop.material = materials.brassTrim;
      const maceCapBottom = MeshBuilder.CreateCylinder(`${this.root.name}-mace-cap-bottom`, { height: 0.10, diameter: 0.38, tessellation: 8 }, scene);
      maceCapBottom.parent = this.weaponRoot;
      maceCapBottom.position.y = -1.46;
      maceCapBottom.material = materials.brassTrim;
      return;
    }

    if (this.kind === 'fuse') {
      // Right hand: a big lit bomb on a short throwing grip — the thing that gets lobbed at the
      // gate. Left hand: a bundled charge of three sticks. Neither is a blade, so FUSE never reads
      // as another swordsman from the gameplay camera.
      const grip = MeshBuilder.CreateCylinder(`${this.root.name}-bomb-grip`, { height: 0.44, diameter: 0.13, tessellation: 7 }, scene);
      grip.parent = this.weaponRoot;
      grip.position.y = -0.2;
      grip.material = materials.leather;
      const charge = MeshBuilder.CreateSphere(`${this.root.name}-hand-bomb`, { diameter: 0.72, segments: 8 }, scene);
      charge.parent = this.weaponRoot;
      charge.position.y = -0.74;
      charge.material = materials.black;
      const band = MeshBuilder.CreateCylinder(`${this.root.name}-hand-bomb-band`, { height: 0.16, diameter: 0.78, tessellation: 10 }, scene);
      band.parent = charge;
      band.rotation.x = Math.PI / 2;
      band.material = teamAccent;
      const wick = MeshBuilder.CreateCylinder(`${this.root.name}-hand-bomb-wick`, { height: 0.36, diameter: 0.07, tessellation: 5 }, scene);
      wick.parent = charge;
      wick.position = new Vector3(0.1, -0.44, 0);
      wick.rotation.z = 0.5;
      wick.material = materials.teamGlow(this.team);
      for (const [index, offset] of [-0.16, 0, 0.16].entries()) {
        const stick = MeshBuilder.CreateCylinder(`${this.root.name}-satchel-stick-${index}`, { height: 0.72, diameter: 0.19, tessellation: 7 }, scene);
        stick.parent = this.shieldRoot;
        stick.position = new Vector3(offset, -0.62, 0);
        stick.material = index === 1 ? teamAccent : materials.leather;
      }
      const satchelStrap = MeshBuilder.CreateBox(`${this.root.name}-satchel-strap`, { width: 0.62, height: 0.14, depth: 0.24 }, scene);
      satchelStrap.parent = this.shieldRoot;
      satchelStrap.position = new Vector3(0, -0.5, 0);
      satchelStrap.material = materials.black;
      return;
    }

    // VEX: twin short daggers, one per hand. Slim blades and no guard bulk keep the silhouette
    // light and fast next to BRAX's shield wall.
    const bladeLength = 1.08;
    const handle = MeshBuilder.CreateCylinder(`${this.root.name}-weapon-handle`, { height: 0.64, diameter: 0.14, tessellation: 7 }, scene);
    handle.parent = this.weaponRoot;
    handle.position.y = -0.18;
    handle.material = materials.leather;
    const blade = MeshBuilder.CreateBox(`${this.root.name}-blade`, { width: 0.20, height: bladeLength, depth: 0.09 }, scene);
    blade.parent = this.weaponRoot;
    blade.position.y = -0.80;
    blade.material = materials.metal;
    const guard = MeshBuilder.CreateBox(`${this.root.name}-weapon-guard`, { width: 0.66, height: 0.13, depth: 0.15 }, scene);
    guard.parent = this.weaponRoot;
    guard.position.y = -0.44;
    guard.material = teamArmor;

    const secondBlade = blade.clone(`${this.root.name}-second-blade`) as Mesh;
    secondBlade.parent = this.shieldRoot;
    secondBlade.position = new Vector3(0, -0.82, 0);
    secondBlade.rotation.z = -0.15;
    const secondHandle = handle.clone(`${this.root.name}-second-handle`) as Mesh;
    secondHandle.parent = this.shieldRoot;
    secondHandle.position = new Vector3(0, -0.20, 0);
  }
}
