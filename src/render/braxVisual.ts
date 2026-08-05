import {
  LoadAssetContainerAsync,
  MeshBuilder,
  TransformNode,
  Vector3,
  type AbstractMesh,
  type AnimationGroup,
  type AssetContainer,
  type Material,
  type Scene,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { UNIT_STATS } from '../core/config';
import type { Team, UnitState } from '../core/types';

const SOURCE_HEIGHT = 380.50691720023553;
const SOURCE_FEET_Y = -0.7175971760087873;
const TARGET_HEIGHT = 3.4 * UNIT_STATS.brax.scale;

/**
 * Visual-only correction derived from the imported hierarchy. The armature carries a baked -90° X
 * rotation and 100x scale; +90° X restores Y-up while retaining the model's native +Z forward.
 */
export const BRAX_VISUAL_CONFIG = {
  assetUrl: '/assets/models/units/brax/brax.glb',
  targetHeight: TARGET_HEIGHT,
  scale: TARGET_HEIGHT / SOURCE_HEIGHT,
  rotationCorrection: {
    x: Math.PI / 2,
    y: 0,
    z: 0,
  },
  verticalOffset: -SOURCE_FEET_Y * (TARGET_HEIGHT / SOURCE_HEIGHT),
  walkSpeedRatio: 1.2,
  climbSpeedRatio: 0.78,
  movementStartSpeed: 0.08,
  movementStopDelay: 0.12,
  teamBadge: {
    width: 0.5,
    height: 0.3,
    depth: 0.05,
    position: { x: 0, y: 1.65, z: 0.72 },
  },
} as const;

export type BraxAnimationState = 'idle' | 'move' | 'attack' | 'hit' | 'death';

/** Exact, case-insensitive semantic mapping from the clips present in brax.glb. */
export const BRAX_ANIMATION_CLIPS: Readonly<Record<BraxAnimationState, string | null>> = {
  idle: null,
  move: 'walk',
  attack: null,
  hit: null,
  death: null,
};

const containers = new WeakMap<Scene, AssetContainer>();
const pendingLoads = new WeakMap<Scene, Promise<AssetContainer>>();

/** Loads the source GLB once for a scene and keeps it out of the live scene as an AssetContainer. */
export function preloadBraxModel(scene: Scene): Promise<AssetContainer> {
  const cached = containers.get(scene);
  if (cached) return Promise.resolve(cached);

  const pending = pendingLoads.get(scene);
  if (pending) return pending;

  const load = LoadAssetContainerAsync(BRAX_VISUAL_CONFIG.assetUrl, scene, { pluginExtension: '.glb' })
    .then((container) => {
      containers.set(scene, container);
      pendingLoads.delete(scene);
      scene.onDisposeObservable.addOnce(() => {
        if (containers.get(scene) === container) containers.delete(scene);
        container.dispose();
      });
      return container;
    })
    .catch((error: unknown) => {
      pendingLoads.delete(scene);
      throw error;
    });

  pendingLoads.set(scene, load);
  return load;
}

/** A cloned BRAX rig with animation state independent from every other spawned BRAX. */
export class BraxVisualInstance {
  readonly root: TransformNode;
  readonly meshes: readonly AbstractMesh[];

  private readonly animations: Readonly<Record<BraxAnimationState, AnimationGroup | null>>;
  private readonly movementRoot: TransformNode;
  private readonly lastMovementPosition = Vector3.Zero();
  private activeAnimation: AnimationGroup | null = null;
  private semanticState: BraxAnimationState | null = null;
  private deathLocked = false;
  private movementActive = false;
  private movementHoldUntil = 0;
  private lastMovementSample = Number.NaN;

  constructor(
    scene: Scene,
    visualParent: TransformNode,
    movementRoot: TransformNode,
    team: Team,
    id: number,
    teamClothMaterial: Material,
  ) {
    const container = containers.get(scene);
    if (!container) throw new Error('BRAX model must be preloaded before unit rigs are created');

    this.movementRoot = movementRoot;
    const prefix = `unit-${id}-${team}-brax-model`;
    const entries = container.instantiateModelsToScene(
      (sourceName) => `${prefix}-${sourceName}`,
      false,
      { doNotInstantiate: true },
    );

    this.root = new TransformNode(`${prefix}-visual`, scene);
    this.root.parent = visualParent;

    const correctionRoot = new TransformNode(`${prefix}-correction`, scene);
    correctionRoot.parent = this.root;
    correctionRoot.rotation.set(
      BRAX_VISUAL_CONFIG.rotationCorrection.x,
      BRAX_VISUAL_CONFIG.rotationCorrection.y,
      BRAX_VISUAL_CONFIG.rotationCorrection.z,
    );

    for (const rootNode of entries.rootNodes) rootNode.parent = correctionRoot;

    const importedMeshes = correctionRoot.getChildMeshes(false);
    const primaryShadowCaster = importedMeshes.reduce<AbstractMesh | null>((largest, mesh) => {
      if (!largest || mesh.getTotalVertices() > largest.getTotalVertices()) return mesh;
      return largest;
    }, null);
    for (const mesh of importedMeshes) {
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.receiveShadows = true;
      mesh.metadata = {
        ...(mesh.metadata ?? {}),
        skipUnitShadowCaster: mesh !== primaryShadowCaster,
      };
    }
    normalizeAndGround(correctionRoot, importedMeshes);

    // The GLB has one atlas material (`bakeTo`) across skin, beard, armor, leather and weapons, so it
    // cannot be selectively recolored. This tiny tabard badge uses MaterialLibrary's two cached team
    // cloth materials and adds no per-instance material or texture allocation.
    const badge = MeshBuilder.CreateBox(`${prefix}-team-badge-no-shadow`, {
      width: BRAX_VISUAL_CONFIG.teamBadge.width,
      height: BRAX_VISUAL_CONFIG.teamBadge.height,
      depth: BRAX_VISUAL_CONFIG.teamBadge.depth,
    }, scene);
    badge.parent = this.root;
    badge.position.set(
      BRAX_VISUAL_CONFIG.teamBadge.position.x,
      BRAX_VISUAL_CONFIG.teamBadge.position.y,
      BRAX_VISUAL_CONFIG.teamBadge.position.z,
    );
    badge.material = teamClothMaterial;
    badge.isPickable = false;
    badge.checkCollisions = false;
    badge.receiveShadows = false;
    badge.metadata = { skipUnitShadowCaster: true };

    this.meshes = [...importedMeshes, badge];
    this.animations = {
      idle: findAnimation(entries.animationGroups, BRAX_ANIMATION_CLIPS.idle),
      move: findAnimation(entries.animationGroups, BRAX_ANIMATION_CLIPS.move),
      attack: findAnimation(entries.animationGroups, BRAX_ANIMATION_CLIPS.attack),
      hit: findAnimation(entries.animationGroups, BRAX_ANIMATION_CLIPS.hit),
      death: findAnimation(entries.animationGroups, BRAX_ANIMATION_CLIPS.death),
    };

    this.lastMovementPosition.copyFrom(this.movementRoot.position);
    this.root.onDisposeObservable.addOnce(() => {
      for (const animationGroup of entries.animationGroups) animationGroup.dispose();
      for (const skeleton of entries.skeletons) skeleton.dispose();
    });
  }

  reset(): void {
    if (this.activeAnimation) {
      this.activeAnimation.stop(true);
      this.activeAnimation.reset();
    }
    this.activeAnimation = null;
    this.semanticState = null;
    this.deathLocked = false;
    this.movementActive = false;
    this.movementHoldUntil = 0;
    this.lastMovementSample = Number.NaN;
    this.lastMovementPosition.copyFrom(this.movementRoot.position);
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
  }

  updateAnimation(
    state: UnitState,
    elapsed: number,
    attackProgress: number,
    hitProgress: number,
  ): void {
    const movingEnough = this.sampleMovement(elapsed);
    const semanticState = this.resolveSemanticState(state, movingEnough);
    this.switchSemanticState(semanticState, state === 'climbing');

    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);

    if (state === 'attacking' && !this.animations.attack) {
      const arc = Math.sin(Math.min(1, attackProgress) * Math.PI);
      this.root.position.z = arc * 0.16;
      this.root.rotation.y = -0.12 + arc * 0.24;
    } else if (state === 'hit' && !this.animations.hit) {
      const recoil = Math.sin(hitProgress * Math.PI);
      this.root.position.z = -recoil * 0.12;
      this.root.rotation.x = -recoil * 0.1;
    } else if (state === 'falling') {
      this.root.rotation.x = -0.28;
    }
  }

  private resolveSemanticState(state: UnitState, movingEnough: boolean): BraxAnimationState {
    if (this.deathLocked || state === 'dead') return 'death';
    if (state === 'attacking') return 'attack';
    if (state === 'hit') return 'hit';
    if ((state === 'moving' || state === 'climbing') && movingEnough) return 'move';
    return 'idle';
  }

  private switchSemanticState(next: BraxAnimationState, climbing: boolean): void {
    if (this.deathLocked && next !== 'death') return;
    const speedRatio = next === 'move'
      ? (climbing ? BRAX_VISUAL_CONFIG.climbSpeedRatio : BRAX_VISUAL_CONFIG.walkSpeedRatio)
      : 1;

    if (this.semanticState === next) {
      if (this.activeAnimation && next === 'move') this.activeAnimation.speedRatio = speedRatio;
      return;
    }

    if (this.activeAnimation) {
      this.activeAnimation.stop(true);
      this.activeAnimation.reset();
      this.activeAnimation = null;
    }

    this.semanticState = next;
    if (next === 'death') this.deathLocked = true;

    const animation = this.animations[next];
    if (!animation) return;
    animation.start(next === 'idle' || next === 'move', speedRatio);
    this.activeAnimation = animation;
  }

  private sampleMovement(elapsed: number): boolean {
    if (!Number.isFinite(this.lastMovementSample)) {
      this.lastMovementSample = elapsed;
      this.lastMovementPosition.copyFrom(this.movementRoot.position);
      return false;
    }

    const delta = elapsed - this.lastMovementSample;
    if (delta <= 0) return this.movementActive;

    const dx = this.movementRoot.position.x - this.lastMovementPosition.x;
    const dy = this.movementRoot.position.y - this.lastMovementPosition.y;
    const dz = this.movementRoot.position.z - this.lastMovementPosition.z;
    const speed = Math.hypot(dx, dy, dz) / delta;
    this.lastMovementSample = elapsed;
    this.lastMovementPosition.copyFrom(this.movementRoot.position);

    if (speed >= BRAX_VISUAL_CONFIG.movementStartSpeed) {
      this.movementActive = true;
      this.movementHoldUntil = elapsed + BRAX_VISUAL_CONFIG.movementStopDelay;
    } else if (elapsed >= this.movementHoldUntil) {
      this.movementActive = false;
    }
    return this.movementActive;
  }
}

function findAnimation(groups: readonly AnimationGroup[], clipName: string | null): AnimationGroup | null {
  if (!clipName) return null;
  const expected = clipName.toLowerCase();
  return groups.find((group) => {
    const actual = group.name.toLowerCase();
    return actual === expected || actual.endsWith(`-${expected}`);
  }) ?? null;
}

function normalizeAndGround(root: TransformNode, meshes: readonly AbstractMesh[]): void {
  root.computeWorldMatrix(true);
  const initialBounds = hierarchyBounds(meshes);
  const measuredHeight = initialBounds.maximum.y - initialBounds.minimum.y;
  const parentScaleY = root.parent instanceof TransformNode
    ? Math.max(0.0001, Math.abs(root.parent.absoluteScaling.y))
    : 1;
  const scale = Number.isFinite(measuredHeight) && measuredHeight > 0.0001
    ? BRAX_VISUAL_CONFIG.targetHeight / measuredHeight
    : BRAX_VISUAL_CONFIG.scale / parentScaleY;
  root.scaling.setAll(scale);

  root.computeWorldMatrix(true);
  const scaledBounds = hierarchyBounds(meshes);
  const worldOffset = Number.isFinite(scaledBounds.minimum.y)
    ? -scaledBounds.minimum.y
    : BRAX_VISUAL_CONFIG.verticalOffset;
  root.position.y = worldOffset / parentScaleY;
  root.computeWorldMatrix(true);
}

function hierarchyBounds(meshes: readonly AbstractMesh[]): { minimum: Vector3; maximum: Vector3 } {
  const minimum = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const maximum = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const bounds = mesh.getBoundingInfo().boundingBox;
    minimum.x = Math.min(minimum.x, bounds.minimumWorld.x);
    minimum.y = Math.min(minimum.y, bounds.minimumWorld.y);
    minimum.z = Math.min(minimum.z, bounds.minimumWorld.z);
    maximum.x = Math.max(maximum.x, bounds.maximumWorld.x);
    maximum.y = Math.max(maximum.y, bounds.maximumWorld.y);
    maximum.z = Math.max(maximum.z, bounds.maximumWorld.z);
  }

  return { minimum, maximum };
}
