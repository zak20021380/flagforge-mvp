import {
  AbstractMesh,
  AnimationGroup,
  AssetContainer,
  InstantiatedEntries,
  Matrix,
  MeshBuilder,
  Quaternion,
  Scene,
  SceneLoader,
  TransformNode,
  Vector3,
  VertexBuffer,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { RANGER_ARROW_VISUAL } from './rangerArrow';
import type { MaterialLibrary } from './materials';

export const RANGER_CLIP_NAMES = [
  'Run',
  'Idle',
  'Shoot',
  'Death',
  'ClimbUp',
  'ClimbDown',
  'Lift',
] as const;

export type RangerClipName = typeof RANGER_CLIP_NAMES[number];

/**
 * Bounds measured from the GLB accessors. The 337.3858457 wrapper compensates for the armature's
 * authored 0.01 scale. Babylon's skinned meshes already include the inverse bind/root conversion,
 * however, so each instantiated GLB root receives one matching 0.01 correction below. The net
 * visual factor remains 6.1 / 1.80801894 without touching the gameplay-owned root.
 */
const RANGER_MESH_MIN_Y = -0.013317604549229145;
const RANGER_MESH_MAX_Y = 1.794701337814331;
const RANGER_ARMATURE_SCALE = 0.01;
export const RANGER_VISUAL_HEIGHT = 6.1;
export const RANGER_VISUAL_SCALE = RANGER_VISUAL_HEIGHT
  / ((RANGER_MESH_MAX_Y - RANGER_MESH_MIN_Y) * RANGER_ARMATURE_SCALE);
const RANGER_GROUND_OFFSET = -RANGER_MESH_MIN_Y * RANGER_ARMATURE_SCALE * RANGER_VISUAL_SCALE;

/** The authored Run loop is 0.533 seconds; 0.84 matches NYX's quicker 3.4-unit ground pace. */
const RANGER_RUN_SPEED_RATIO = 0.84;
/**
 * Shoot has 151 authored keys at 30 fps. Frame 49 is the nocked, draw-ready pose. The draw hand
 * opens and the arm begins its release recoil at frame 125; mapping that key to the gameplay-owned
 * windup skips only the long nocking preamble and keeps the full authored recovery.
 */
const RANGER_SHOOT_FIRST_FRAME = 1;
const RANGER_SHOOT_DRAW_START_FRAME = 49;
const RANGER_SHOOT_RELEASE_FRAME = 125;
const RANGER_SHOOT_LAST_FRAME = 151;
const RANGER_SHOOT_DRAW_START = authoredShootProgress(RANGER_SHOOT_DRAW_START_FRAME);
const RANGER_SHOOT_RELEASE = authoredShootProgress(RANGER_SHOOT_RELEASE_FRAME);
const RANGER_DEATH_DURATION = 2.0333333015441895;
const RANGER_CORPSE_LIFETIME = 1.18;
const RANGER_BOW_FALLBACK = new Vector3(2.35, 4.65, 0.55);
const RANGER_ARROW_BONE = 'mixamorig:arrow';
const RANGER_BODY_MIN_INFLUENCING_BONES = 8;
const RANGER_AUXILIARY_BOUNDS_LIMIT = RANGER_VISUAL_HEIGHT * 4;

/**
 * Scene-scoped Ranger source data. The GLB is parsed once; each unit receives cloned animation and
 * skeleton runtime state while Babylon reuses the source materials, textures and geometry.
 */
export class RangerVisualLibrary {
  readonly detectedClipNames: readonly string[];
  private disposed = false;

  private constructor(
    private readonly container: AssetContainer,
    private readonly materials: MaterialLibrary,
  ) {
    this.detectedClipNames = container.animationGroups.map((group) => group.name);
    const missing = RANGER_CLIP_NAMES.filter((name) => !this.detectedClipNames.includes(name));
    if (missing.length > 0) {
      container.dispose();
      throw new Error(`ranger.glb is missing animation clips: ${missing.join(', ')}`);
    }
  }

  static async load(scene: Scene, materials: MaterialLibrary): Promise<RangerVisualLibrary> {
    const container = await SceneLoader.LoadAssetContainerAsync(
      '/assets/units/ranger/',
      'ranger.glb',
      scene,
    );
    return new RangerVisualLibrary(container, materials);
  }

  createInstance(parent: TransformNode, id: number): RangerVisualInstance {
    if (this.disposed) throw new Error('Cannot instantiate a disposed Ranger visual library');
    return new RangerVisualInstance(this.container, this.materials, parent, id);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.container.dispose();
  }
}

/** Per-unit skeleton, animation groups and visual-only transform wrapper. */
export class RangerVisualInstance {
  private readonly wrapper: TransformNode;
  private readonly visualParent: TransformNode;
  private readonly entries: InstantiatedEntries;
  private readonly clips = new Map<RangerClipName, AnimationGroup>();
  private readonly heldArrow: TransformNode;
  private readonly bowHand: TransformNode | null;
  private readonly hips: TransformNode | null;
  private readonly hipsRestPosition: Vector3 | null;
  private readonly bowWorld = Vector3.Zero();
  private readonly parentInverse = Matrix.Identity();
  private readonly climbForwardLocal = Vector3.Zero();
  private currentClip: RangerClipName | null = null;
  private lastAttackProgress = -1;
  private lastAttackReleased = false;
  private disposed = false;

  constructor(
    container: AssetContainer,
    materials: MaterialLibrary,
    parent: TransformNode,
    id: number,
  ) {
    const prefix = `unit-${id}-ranger-`;
    this.visualParent = parent;
    this.wrapper = new TransformNode(`${prefix}visual-wrapper`, parent.getScene());
    this.wrapper.parent = parent;
    this.wrapper.position.y = RANGER_GROUND_OFFSET;
    this.wrapper.scaling.setAll(RANGER_VISUAL_SCALE);

    this.entries = container.instantiateModelsToScene(
      (sourceName) => `${prefix}${sourceName}`,
      false,
    );
    for (const root of this.entries.rootNodes) {
      root.parent = this.wrapper;
      if (!(root instanceof TransformNode)) {
        throw new Error(`Ranger GLB root ${root.name} does not expose a transform scale`);
      }
      // The GLB's skin inverse-bind matrices already undo the authored armature scale. Without this
      // root correction, the wrapper applies the 0.01 -> 337 compensation to every skinned mesh a
      // second time and produces render/shadow bounds hundreds of world units across.
      root.scaling.scaleInPlace(RANGER_ARMATURE_SCALE);
    }

    const meshes = this.wrapper.getChildMeshes(false).filter((mesh) => mesh.getTotalVertices() > 0);
    for (const mesh of meshes) {
      mesh.isPickable = false;
      mesh.checkCollisions = false;
    }
    const boneInfluences = new Map(meshes.map((mesh) => [mesh, influencingBoneIndices(mesh)]));
    const bodyMeshes = identifyBodyMeshes(meshes, boneInfluences);
    const importedAuxiliaryMeshes = meshes.filter((mesh) => !bodyMeshes.has(mesh));
    const importedArrows = meshes.filter((mesh) => isRigidlySkinnedToBone(
      mesh,
      boneInfluences.get(mesh),
      RANGER_ARROW_BONE,
    ));
    // The GLB arrow is driven by mixamorig:arrow, so it is not rendered alongside the custom held
    // arrow and pooled projectile. Bone influence, rather than the exporter's shifted names or
    // materials, identifies it.
    for (const importedArrow of importedArrows) importedArrow.setEnabled(false);

    for (const clipName of RANGER_CLIP_NAMES) {
      const group = this.entries.animationGroups.find((candidate) => sourceName(candidate.name) === clipName);
      if (!group) throw new Error(`Could not instantiate Ranger animation clip ${clipName}`);
      group.stop(true);
      group.enableBlending = true;
      group.blendingSpeed = 0.12;
      this.clips.set(clipName, group);
    }

    this.hips = this.findAnimatedNode('mixamorig:Hips');
    this.hipsRestPosition = this.hips?.position.clone() ?? null;
    this.bowHand = this.findAnimatedNode('mixamorig:LeftHand');
    this.removeRootTranslationTracks();
    this.heldArrow = new TransformNode(`${prefix}held-arrow`, parent.getScene());
    this.heldArrow.parent = this.bowHand ?? parent;
    if (this.bowHand) {
      // The animated hand sits below the 337.385 wrapper and its matching 0.01 GLB root correction.
      // Cancel the socket's final world scale once so this procedural arrow keeps world-unit sizing.
      this.bowHand.computeWorldMatrix(true);
      const socketScale = this.bowHand.absoluteScaling;
      this.heldArrow.scaling.set(
        inverseFiniteScale(socketScale.x),
        inverseFiniteScale(socketScale.y),
        inverseFiniteScale(socketScale.z),
      );
    } else {
      this.heldArrow.position.copyFrom(RANGER_BOW_FALLBACK);
    }
    const shaft = MeshBuilder.CreateCylinder(`${prefix}held-arrow-shaft`, {
      height: RANGER_ARROW_VISUAL.shaftLength,
      diameter: RANGER_ARROW_VISUAL.shaftDiameter,
      tessellation: 6,
    }, parent.getScene());
    shaft.parent = this.heldArrow;
    shaft.rotation.x = Math.PI / 2;
    shaft.material = materials.arrowShaft;
    shaft.isPickable = false;
    shaft.checkCollisions = false;
    const tip = MeshBuilder.CreateCylinder(`${prefix}held-arrow-tip`, {
      height: RANGER_ARROW_VISUAL.tipLength,
      diameterTop: 0,
      diameterBottom: RANGER_ARROW_VISUAL.tipDiameter,
      tessellation: 6,
    }, parent.getScene());
    tip.parent = this.heldArrow;
    tip.position.z = RANGER_ARROW_VISUAL.tipOffset;
    tip.rotation.x = Math.PI / 2;
    tip.material = materials.arrowHead;
    tip.isPickable = false;
    tip.checkCollisions = false;
    const fletchingHorizontal = MeshBuilder.CreateBox(`${prefix}held-arrow-fletching-horizontal`, {
      width: RANGER_ARROW_VISUAL.fletchingWidth,
      height: RANGER_ARROW_VISUAL.fletchingThickness,
      depth: RANGER_ARROW_VISUAL.fletchingLength,
    }, parent.getScene());
    fletchingHorizontal.parent = this.heldArrow;
    fletchingHorizontal.position.z = RANGER_ARROW_VISUAL.fletchingOffset;
    fletchingHorizontal.material = materials.arrowFletching;
    fletchingHorizontal.isPickable = false;
    fletchingHorizontal.checkCollisions = false;
    const fletchingVertical = MeshBuilder.CreateBox(`${prefix}held-arrow-fletching-vertical`, {
      width: RANGER_ARROW_VISUAL.fletchingThickness,
      height: RANGER_ARROW_VISUAL.fletchingWidth,
      depth: RANGER_ARROW_VISUAL.fletchingLength,
    }, parent.getScene());
    fletchingVertical.parent = this.heldArrow;
    fletchingVertical.position.z = RANGER_ARROW_VISUAL.fletchingOffset;
    fletchingVertical.material = materials.arrowFletching;
    fletchingVertical.isPickable = false;
    fletchingVertical.checkCollisions = false;
    this.setHeldArrowVisible(false);
    this.guardImportedAuxiliaryBounds(importedAuxiliaryMeshes);
  }

  reset(): void {
    this.stopAll();
    this.wrapper.position.set(0, RANGER_GROUND_OFFSET, 0);
    this.wrapper.rotationQuaternion = null;
    this.wrapper.rotation.set(0, 0, 0);
    this.wrapper.scaling.setAll(RANGER_VISUAL_SCALE);
    this.lastAttackProgress = -1;
    this.lastAttackReleased = false;
    this.playClip('Idle', true, 1);
    this.setHeldArrowVisible(true);
  }

  setEnabled(enabled: boolean): void {
    if (!enabled) {
      this.stopAll();
      this.setHeldArrowVisible(false);
    }
  }

  update(
    state: string,
    attackProgress: number,
    attackReleaseProgress: number,
    attackReleased: boolean,
    descending: boolean,
    climbSurfaceNormal: Vector3 | null,
  ): void {
    if (this.disposed) return;
    if (state === 'attacking') {
      this.clearClimbFacing();
      const beganNewAttack = this.currentClip !== 'Shoot'
        || this.lastAttackProgress < 0
        || attackProgress + 0.1 < this.lastAttackProgress;
      if (beganNewAttack) {
        this.playClip('Shoot', false, 1, true, true);
      }
      // On the first gameplay release frame, land exactly on the authored finger-open key even if
      // a long render delta stepped the attack clock slightly past its windup.
      const releasedThisFrame = attackReleased && !this.lastAttackReleased;
      this.seekShoot(releasedThisFrame ? attackReleaseProgress : attackProgress, attackReleaseProgress);
      this.setHeldArrowVisible(!attackReleased);
      this.lastAttackProgress = attackProgress;
      this.lastAttackReleased = attackReleased;
      return;
    }

    this.lastAttackProgress = -1;
    this.lastAttackReleased = false;
    if (state === 'dead') {
      this.clearClimbFacing();
      this.setHeldArrowVisible(false);
      this.playClip('Death', false, RANGER_DEATH_DURATION / RANGER_CORPSE_LIFETIME);
    } else if (state === 'moving') {
      this.clearClimbFacing();
      this.setHeldArrowVisible(true);
      this.playClip('Run', true, RANGER_RUN_SPEED_RATIO);
    } else if (state === 'climbing') {
      this.applyClimbFacing(climbSurfaceNormal);
      this.setHeldArrowVisible(false);
      this.playClip(descending ? 'ClimbDown' : 'ClimbUp', true, 1);
    } else {
      this.clearClimbFacing();
      // Idle, queued and other stationary states stop Run immediately and ready the next arrow.
      this.setHeldArrowVisible(true);
      this.playClip('Idle', true, 1);
    }
  }

  /** Retained for a future explicit flag-lift state; current flag carrying intentionally uses Idle. */
  playLift(): void {
    this.playClip('Lift', false, 1, true);
  }

  releaseHeldArrow(): void {
    this.setHeldArrowVisible(false);
  }

  projectileOrigin(fallback: Vector3): Vector3 {
    return this.resolveBowWorldPosition() ?? this.fallbackBowWorldPosition() ?? fallback;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAll();
    this.heldArrow.dispose();
    this.entries.dispose();
    this.wrapper.dispose();
  }

  private playClip(
    name: RangerClipName,
    loop: boolean,
    speedRatio: number,
    forceRestart = false,
    pause = false,
  ): void {
    if (!forceRestart && this.currentClip === name) return;
    if (this.currentClip) this.clips.get(this.currentClip)?.stop(true);
    this.restoreHipsPosition();
    const group = this.clips.get(name);
    if (!group) return;
    group.start(loop, speedRatio);
    if (pause) group.pause();
    group.goToFrame(group.from);
    this.restoreHipsPosition();
    this.currentClip = name;
  }

  /** Seek Shoot from the gameplay attack clock so animation and projectile timing cannot drift. */
  private seekShoot(attackProgress: number, attackReleaseProgress: number): void {
    const group = this.clips.get('Shoot');
    if (!group?.isStarted) return;
    const cycleProgress = clamp01(attackProgress);
    const releaseProgress = Math.min(0.999, Math.max(0.001, attackReleaseProgress));
    const authoredProgress = cycleProgress <= releaseProgress
      ? lerp(
        RANGER_SHOOT_DRAW_START,
        RANGER_SHOOT_RELEASE,
        cycleProgress / releaseProgress,
      )
      : lerp(
        RANGER_SHOOT_RELEASE,
        1,
        (cycleProgress - releaseProgress) / (1 - releaseProgress),
      );
    group.goToFrame(lerp(group.from, group.to, authoredProgress));
    this.restoreHipsPosition();
  }

  private stopAll(): void {
    for (const group of this.clips.values()) group.stop(true);
    this.currentClip = null;
    this.restoreHipsPosition();
  }

  private setHeldArrowVisible(visible: boolean): void {
    this.heldArrow.setEnabled(visible);
  }

  /**
   * The gameplay ladder rig faces its local -Z into the rungs, while the Ranger GLB's authored
   * forward axis is local +Z. Resolve the real ladder normal through the parent transform and turn
   * only this visual wrapper, leaving the gameplay root and its normal ground/target yaw untouched.
   */
  private applyClimbFacing(surfaceNormal: Vector3 | null): void {
    if (!surfaceNormal || surfaceNormal.lengthSquared() <= 1e-8) return;
    this.visualParent.computeWorldMatrix(true);
    this.visualParent.getWorldMatrix().invertToRef(this.parentInverse);
    Vector3.TransformNormalToRef(surfaceNormal, this.parentInverse, this.climbForwardLocal);
    this.climbForwardLocal.y = 0;
    if (this.climbForwardLocal.lengthSquared() <= 1e-8) return;
    this.climbForwardLocal.normalize().scaleInPlace(-1);
    this.wrapper.rotationQuaternion = Quaternion.FromLookDirectionLH(
      this.climbForwardLocal,
      Vector3.Up(),
    );
  }

  private clearClimbFacing(): void {
    if (!this.wrapper.rotationQuaternion && this.wrapper.rotation.lengthSquared() <= 1e-8) return;
    this.wrapper.rotationQuaternion = null;
    this.wrapper.rotation.set(0, 0, 0);
  }

  private resolveBowWorldPosition(): Vector3 | null {
    if (!this.bowHand || !this.bowHand.isEnabled()) return null;
    this.bowHand.computeWorldMatrix(true);
    this.bowWorld.copyFrom(this.bowHand.getAbsolutePosition());
    const rootPosition = this.visualParent.getAbsolutePosition();
    const relativeY = this.bowWorld.y - rootPosition.y;
    const relativeXZ = Math.hypot(this.bowWorld.x - rootPosition.x, this.bowWorld.z - rootPosition.z);
    return Number.isFinite(this.bowWorld.x)
      && Number.isFinite(this.bowWorld.y)
      && Number.isFinite(this.bowWorld.z)
      && relativeY >= 1.5
      && relativeY <= 6.5
      && relativeXZ <= 4.5
      ? this.bowWorld.clone()
      : null;
  }

  private fallbackBowWorldPosition(): Vector3 | null {
    this.visualParent.computeWorldMatrix(true);
    Vector3.TransformCoordinatesToRef(RANGER_BOW_FALLBACK, this.visualParent.getWorldMatrix(), this.bowWorld);
    return Number.isFinite(this.bowWorld.x) && Number.isFinite(this.bowWorld.y) && Number.isFinite(this.bowWorld.z)
      ? this.bowWorld.clone()
      : null;
  }

  private findAnimatedNode(expectedName: string): TransformNode | null {
    for (const group of this.entries.animationGroups) {
      for (const targeted of group.targetedAnimations) {
        const target = targeted.target;
        if (
          target
          && sourceName(target.name) === expectedName
          && target.position
          && typeof target.position.clone === 'function'
          && typeof target.getAbsolutePosition === 'function'
        ) return target as TransformNode;
      }
    }
    return null;
  }

  /**
   * Every clip keys Hips translation, including large clip-space offsets (especially Death and the
   * ladder clips). Removing only that per-instance channel keeps all bone rotations/scales while
   * guaranteeing the imported animation cannot displace the gameplay-owned unit root.
   */
  private removeRootTranslationTracks(): void {
    for (const group of this.clips.values()) {
      const rootTranslations = group.targetedAnimations.filter((targeted) => (
        targeted.target === this.hips
        && (targeted.animation.targetProperty === 'position'
          || targeted.animation.targetProperty.startsWith('position.'))
      ));
      for (const targeted of rootTranslations) group.removeTargetedAnimation(targeted.animation);
    }
  }

  private restoreHipsPosition(): void {
    if (this.hips && this.hipsRestPosition) this.hips.position.copyFrom(this.hipsRestPosition);
  }

  /**
   * Force final skin/world bounds once and fail closed for imported GLB auxiliaries only. Custom
   * held arrows/projectiles never enter this list, and body layers are excluded before the call.
   */
  private guardImportedAuxiliaryBounds(meshes: readonly AbstractMesh[]): void {
    this.visualParent.computeWorldMatrix(true);
    this.wrapper.computeWorldMatrix(true);
    for (const root of this.entries.rootNodes) root.computeWorldMatrix(true);
    for (const skeleton of this.entries.skeletons) skeleton.prepare();
    const logicalRootPosition = this.visualParent.getAbsolutePosition();

    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      mesh.refreshBoundingInfo({
        applySkeleton: mesh.skeleton !== null,
        applyMorph: mesh.morphTargetManager !== null,
      });
      mesh.computeWorldMatrix(true);

      const bounds = mesh.getBoundingInfo().boundingBox;
      const dimensions = bounds.maximumWorld.subtract(bounds.minimumWorld);
      const center = bounds.centerWorld;
      const centerDistance = Vector3.Distance(center, logicalRootPosition);
      const values = [dimensions.x, dimensions.y, dimensions.z, center.x, center.y, center.z, centerDistance];
      const impossible = values.some((value) => !Number.isFinite(value))
        || Math.max(dimensions.x, dimensions.y, dimensions.z) > RANGER_AUXILIARY_BOUNDS_LIMIT
        || centerDistance > RANGER_AUXILIARY_BOUNDS_LIMIT;
      if (!impossible) continue;

      const metrics = {
        mesh: sourceName(mesh.name),
        parent: mesh.parent ? sourceName(mesh.parent.name) : null,
        material: mesh.material?.name ?? null,
        skeleton: mesh.skeleton?.name ?? null,
        localScaling: mesh.scaling.asArray(),
        absoluteScaling: mesh.absoluteScaling.asArray(),
        worldDimensions: dimensions.asArray(),
        worldCenter: center.asArray(),
        centerDistance,
      };
      mesh.setEnabled(false);
      console.warn('Disabled Ranger auxiliary mesh with impossible world bounds.', metrics);
    }
  }
}

function inverseFiniteScale(value: number): number {
  return Number.isFinite(value) && Math.abs(value) > 1e-6 ? 1 / Math.abs(value) : 1;
}

function authoredShootProgress(frame: number): number {
  return (frame - RANGER_SHOOT_FIRST_FRAME) / (RANGER_SHOOT_LAST_FRAME - RANGER_SHOOT_FIRST_FRAME);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function influencingBoneIndices(mesh: AbstractMesh): ReadonlySet<number> {
  const result = new Set<number>();
  collectInfluences(
    mesh.getVerticesData(VertexBuffer.MatricesIndicesKind),
    mesh.getVerticesData(VertexBuffer.MatricesWeightsKind),
    result,
  );
  if (mesh.numBoneInfluencers > 4) {
    collectInfluences(
      mesh.getVerticesData(VertexBuffer.MatricesIndicesExtraKind),
      mesh.getVerticesData(VertexBuffer.MatricesWeightsExtraKind),
      result,
    );
  }
  return result;
}

function collectInfluences(
  indices: ArrayLike<number> | null,
  weights: ArrayLike<number> | null,
  result: Set<number>,
): void {
  if (!indices || !weights) return;
  const length = Math.min(indices.length, weights.length);
  for (let index = 0; index < length; index += 1) {
    if (weights[index] > 1e-6) result.add(Math.floor(indices[index]));
  }
}

function identifyBodyMeshes(
  meshes: readonly AbstractMesh[],
  boneInfluences: ReadonlyMap<AbstractMesh, ReadonlySet<number>>,
): ReadonlySet<AbstractMesh> {
  const bodyMeshes = new Set(meshes.filter((mesh) => (
    (boneInfluences.get(mesh)?.size ?? 0) >= RANGER_BODY_MIN_INFLUENCING_BONES
  )));
  if (bodyMeshes.size > 0) return bodyMeshes;

  // Defensive fallback for a future export without skin weights: protect its densest geometry.
  const maxVertices = Math.max(0, ...meshes.map((mesh) => mesh.getTotalVertices()));
  for (const mesh of meshes) {
    if (mesh.getTotalVertices() === maxVertices) bodyMeshes.add(mesh);
  }
  return bodyMeshes;
}

function isRigidlySkinnedToBone(
  mesh: AbstractMesh,
  influences: ReadonlySet<number> | undefined,
  boneName: string,
): boolean {
  if (!mesh.skeleton || !influences || influences.size !== 1) return false;
  const [boneIndex] = influences;
  return mesh.skeleton.bones[boneIndex]?.name === boneName;
}

function sourceName(instanceName: string): string {
  const marker = '-ranger-';
  const index = instanceName.indexOf(marker);
  return index >= 0 ? instanceName.slice(index + marker.length) : instanceName;
}
