import {
  type AnimationGroup,
  type AssetContainer,
  Quaternion,
  type Scene,
  TransformNode,
  Vector3,
  type InstantiatedEntries,
} from '@babylonjs/core';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import type { UnitState } from '../core/types';

const VANGUARD_ASSET_URL = '/assets/units/vanguard/vanguard.glb';
/** The old procedural BRAX silhouette was roughly 3.6 world units from sole to helmet. */
const VANGUARD_WORLD_HEIGHT = 3.6;
/** Gameplay unit roots sit this far above the surface they are standing on. */
const GAMEPLAY_ROOT_FLOOR_OFFSET = 0.16;
const FORWARD_CORRECTION = Math.PI;
const LOOP_TRANSITION_SPEED = 0.12;

type VanguardClipState = 'idle' | 'move' | 'attack' | 'hit' | 'death';

interface VanguardClipNames {
  readonly idle?: string;
  readonly move?: string;
  readonly attack?: string;
  readonly hit?: string;
  readonly death?: string;
}

interface ModelBounds {
  readonly minimum: Vector3;
  readonly maximum: Vector3;
  readonly height: number;
}

interface RestTransform {
  readonly node: TransformNode;
  readonly position: Vector3;
  readonly rotation: Vector3;
  readonly rotationQuaternion: Quaternion | null;
  readonly scaling: Vector3;
}

export class VanguardModelLibrary {
  private readonly bounds: ModelBounds;
  private readonly clipNames: VanguardClipNames;

  private constructor(private readonly container: AssetContainer) {
    for (const group of container.animationGroups) group.stop(true);
    this.bounds = measureContainerBounds(container);
    this.clipNames = inspectAnimationGroups(container.animationGroups);
  }

  static async load(scene: Scene): Promise<VanguardModelLibrary> {
    const container = await LoadAssetContainerAsync(VANGUARD_ASSET_URL, scene);
    return new VanguardModelLibrary(container);
  }

  instantiate(parent: TransformNode, unitId: number): VanguardVisual {
    return new VanguardVisual(this.container, this.bounds, this.clipNames, parent, unitId);
  }

  dispose(): void {
    this.container.dispose();
  }
}

export async function loadVanguardModelLibrary(scene: Scene): Promise<VanguardModelLibrary> {
  return VanguardModelLibrary.load(scene);
}

export class VanguardVisual {
  private readonly entries: InstantiatedEntries;
  private readonly modelRoot: TransformNode;
  private readonly groups: AnimationGroup[];
  private readonly clips: Partial<Record<VanguardClipState, AnimationGroup>>;
  private readonly restTransforms: RestTransform[];
  private readonly restPosition: Vector3;
  private readonly restScaling: Vector3;
  private currentState: VanguardClipState | 'fall' | null = null;
  private lastAttackProgress = 0;
  private active = false;

  constructor(
    container: AssetContainer,
    bounds: ModelBounds,
    clipNames: VanguardClipNames,
    parent: TransformNode,
    unitId: number,
  ) {
    const prefix = `unit-${unitId}-vanguard-`;
    const rename = (sourceName: string): string => `${prefix}${sourceName}`;
    this.entries = container.instantiateModelsToScene(rename, false);
    this.groups = this.entries.animationGroups;
    this.modelRoot = new TransformNode(`${prefix}visual-root`, parent.getScene());
    this.modelRoot.parent = parent;

    // Counter the existing visual-root scale so the imported model gets a uniform world scale,
    // while the established flag socket and health-bar layout keep their original BRAX sizing.
    const worldScale = VANGUARD_WORLD_HEIGHT / bounds.height;
    this.modelRoot.scaling.set(
      worldScale / parent.scaling.x,
      worldScale / parent.scaling.y,
      worldScale / parent.scaling.z,
    );
    this.modelRoot.position.y = (
      -GAMEPLAY_ROOT_FLOOR_OFFSET - bounds.minimum.y * worldScale
    ) / parent.scaling.y;
    // The authored character faces -Z; gameplay yaw 0 faces +Z.
    this.modelRoot.rotation.y = FORWARD_CORRECTION;
    this.restPosition = this.modelRoot.position.clone();
    this.restScaling = this.modelRoot.scaling.clone();

    for (const rootNode of this.entries.rootNodes) {
      // Animated root/bone translation stays inside this visual-only branch. Gameplay movement,
      // routing and facing continue to own UnitRig.root exclusively.
      rootNode.parent = this.modelRoot;
      rootNode.setEnabled(true);
    }
    for (const mesh of this.modelRoot.getChildMeshes(false)) {
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.receiveShadows = true;
    }

    for (const group of this.groups) {
      group.stop(true);
      group.enableBlending = true;
      group.blendingSpeed = LOOP_TRANSITION_SPEED;
    }
    this.clips = {
      idle: findInstantiatedClip(this.groups, clipNames.idle, prefix),
      move: findInstantiatedClip(this.groups, clipNames.move, prefix),
      attack: findInstantiatedClip(this.groups, clipNames.attack, prefix),
      hit: findInstantiatedClip(this.groups, clipNames.hit, prefix),
      death: findInstantiatedClip(this.groups, clipNames.death, prefix),
    };
    this.restTransforms = captureRestTransforms(this.groups);
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active) this.play('idle', true);
    else this.stopAll();
  }

  reset(): void {
    this.stopAll();
    restoreRestTransforms(this.restTransforms);
    for (const skeleton of this.entries.skeletons) skeleton.returnToRest();
    this.modelRoot.position.copyFrom(this.restPosition);
    this.modelRoot.scaling.copyFrom(this.restScaling);
    this.modelRoot.rotation.set(0, FORWARD_CORRECTION, 0);
    this.currentState = null;
    this.lastAttackProgress = 0;
    if (this.active) this.play('idle', true);
  }

  update(state: UnitState, attackProgress: number, hitProgress: number): void {
    if (!this.active) return;

    if (state === 'attacking') {
      const attackRestarted = this.currentState !== 'attack'
        || attackProgress + 0.02 < this.lastAttackProgress;
      this.play('attack', false, attackRestarted);
      this.seek(this.clips.attack, attackProgress);
      this.lastAttackProgress = attackProgress;
      return;
    }
    this.lastAttackProgress = 0;

    if (state === 'hit') {
      this.play('hit', false);
      // The gameplay hit lock is intentionally short (0.24s), so scrub the real clip through that
      // existing window instead of extending invulnerability or combat recovery.
      this.seek(this.clips.hit, hitProgress);
      return;
    }
    if (state === 'dead') {
      // The embedded defeat is 1.167s and the existing corpse visibility window is 1.18s, so its
      // natural playback fits without changing gameplay death timing or hiding the mesh early.
      this.play('death', false);
      return;
    }
    if (state === 'falling') {
      this.play('hit', false, this.currentState !== 'fall', 'fall');
      return;
    }
    if (state === 'moving' || state === 'climbing') {
      this.play('move', true);
      return;
    }
    this.play('idle', true);
  }

  dispose(): void {
    this.stopAll();
    this.entries.dispose();
    this.modelRoot.dispose();
  }

  private play(
    requestedState: VanguardClipState,
    loop: boolean,
    restart = false,
    stateOverride?: VanguardClipState | 'fall',
  ): void {
    const state = stateOverride ?? requestedState;
    const group = this.clips[requestedState] ?? this.clips.idle;
    if (!group) return;
    if (!restart && this.currentState === state) return;

    for (const candidate of this.groups) {
      if (candidate.isStarted) candidate.stop(true);
    }
    group.start(loop, 1, group.from, group.to);
    this.currentState = state;
  }

  private seek(group: AnimationGroup | undefined, progress: number): void {
    if (!group?.isStarted) return;
    const safeProgress = Math.max(0, Math.min(1, progress));
    group.goToFrame(group.from + (group.to - group.from) * safeProgress);
  }

  private stopAll(): void {
    for (const group of this.groups) {
      if (group.isStarted) group.stop(true);
    }
  }
}

function inspectAnimationGroups(groups: AnimationGroup[]): VanguardClipNames {
  const available = groups.map((group) => `${group.name} (${group.getLength().toFixed(3)}s)`);
  const clipNames: VanguardClipNames = {
    // The combat idle also keys the animated root, preventing a run/attack root offset from being
    // left behind when the character becomes stationary. `idle_loop` remains available but does
    // not key that root channel in this asset.
    idle: pickClipName(groups, ['fightidle_loop', 'fightidle2_loop', 'idle_loop'], ['idle']),
    move: pickClipName(groups, ['run2_loop', 'run_loop', 'walk_loop'], ['run', 'walk']),
    attack: pickClipName(groups, ['Attack', 'fightidle2_Attack'], ['attack']),
    hit: pickClipName(groups, ['hurt', 'hit', 'damage'], ['hurt', 'hit', 'damage']),
    death: pickClipName(groups, ['defeat', 'death', 'die'], ['defeat', 'death', 'die']),
  };
  console.info('[Vanguard] AnimationGroups:', available);
  console.info('[Vanguard] Animation mapping:', {
    idle: clipNames.idle ?? 'missing',
    move: clipNames.move ?? 'missing',
    attack: clipNames.attack ?? 'missing',
    hit: clipNames.hit ?? 'missing',
    death: clipNames.death ?? 'missing',
  });
  for (const [state, name] of Object.entries(clipNames)) {
    if (!name) console.warn(`[Vanguard] No suitable ${state} animation exists in ${VANGUARD_ASSET_URL}`);
  }
  return clipNames;
}

function pickClipName(groups: AnimationGroup[], preferred: string[], keywords: string[]): string | undefined {
  for (const preferredName of preferred) {
    const normalizedPreferred = normalizeClipName(preferredName);
    const exact = groups.find((group) => normalizeClipName(group.name) === normalizedPreferred);
    if (exact) return exact.name;
  }
  const keywordMatch = groups.find((group) => {
    const normalized = normalizeClipName(group.name);
    return group.getLength() > 0 && keywords.some((keyword) => normalized.includes(keyword));
  });
  return keywordMatch?.name;
}

function findInstantiatedClip(
  groups: AnimationGroup[],
  sourceName: string | undefined,
  prefix: string,
): AnimationGroup | undefined {
  if (!sourceName) return undefined;
  return groups.find((group) => group.name === sourceName || group.name === `${prefix}${sourceName}`)
    ?? groups.find((group) => group.name.endsWith(sourceName));
}

function normalizeClipName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function measureContainerBounds(container: AssetContainer): ModelBounds {
  const minimum = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const maximum = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  let foundGeometry = false;
  for (const mesh of container.meshes) {
    if (mesh.getTotalVertices() === 0) continue;
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    minimum.minimizeInPlace(box.minimumWorld);
    maximum.maximizeInPlace(box.maximumWorld);
    foundGeometry = true;
  }
  if (!foundGeometry) throw new Error(`Vanguard asset contains no renderable character meshes: ${VANGUARD_ASSET_URL}`);
  const height = maximum.y - minimum.y;
  if (height <= 0.001) throw new Error(`Vanguard asset has invalid model bounds: ${VANGUARD_ASSET_URL}`);
  console.info('[Vanguard] Imported bounds:', {
    minimum: minimum.asArray(),
    maximum: maximum.asArray(),
    height,
    targetWorldHeight: VANGUARD_WORLD_HEIGHT,
  });
  return { minimum, maximum, height };
}

function captureRestTransforms(groups: AnimationGroup[]): RestTransform[] {
  const nodes = new Set<TransformNode>();
  for (const group of groups) {
    for (const targeted of group.targetedAnimations) {
      if (targeted.target instanceof TransformNode) nodes.add(targeted.target);
    }
  }
  return [...nodes].map((node) => ({
    node,
    position: node.position.clone(),
    rotation: node.rotation.clone(),
    rotationQuaternion: node.rotationQuaternion?.clone() ?? null,
    scaling: node.scaling.clone(),
  }));
}

function restoreRestTransforms(restTransforms: RestTransform[]): void {
  for (const rest of restTransforms) {
    rest.node.position.copyFrom(rest.position);
    rest.node.rotation.copyFrom(rest.rotation);
    rest.node.scaling.copyFrom(rest.scaling);
    if (rest.rotationQuaternion) {
      rest.node.rotationQuaternion ??= Quaternion.Identity();
      rest.node.rotationQuaternion.copyFrom(rest.rotationQuaternion);
    } else {
      rest.node.rotationQuaternion = null;
    }
  }
}
