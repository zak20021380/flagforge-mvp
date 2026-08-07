import '@babylonjs/loaders/glTF';
import type {
  AnimationGroup,
  AssetContainer,
  InstantiatedEntries,
  Node,
  Scene,
} from '@babylonjs/core';
import { Vector3 } from '@babylonjs/core';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';

const BRAX_MODEL_URL = '/assets/models/units/brax/brax.glb?v=minotaur-2';
const BRAX_TARGET_HEIGHT = 3.75;
const BRAX_GROUND_CLEARANCE = 0.02;
const ROOT_MOTION_EPSILON = 0.02;

export const BRAX_MODEL_ROTATION = Object.freeze({ x: 0, y: 0, z: 0 });

export interface BraxAnimationMapping {
  readonly idle: AnimationGroup | null;
  readonly move: AnimationGroup | null;
  readonly attack: AnimationGroup | null;
  readonly hit: AnimationGroup | null;
  readonly death: AnimationGroup | null;
}

export interface BraxModelInstance {
  readonly entries: InstantiatedEntries;
  readonly modelRoot: Node;
  readonly animationGroups: readonly AnimationGroup[];
  readonly animations: BraxAnimationMapping;
  readonly scale: number;
  readonly groundYOffset: number;
  readonly filteredRootMotionTracks: number;
  readonly disabledAnimationNames: readonly string[];
}

interface PreparedBraxModel {
  readonly container: AssetContainer;
  readonly scale: number;
  readonly groundYOffset: number;
}

let preparedScene: Scene | null = null;
let preparation: Promise<PreparedBraxModel | null> | null = null;
let instanceSerial = 0;
const activeInstances = new Set<BraxModelInstance>();

/** Loads and prepares the GLB AssetContainer once. A failed load is deliberately not retried. */
function prepareBraxModel(scene: Scene): Promise<PreparedBraxModel | null> {
  if (preparation) return preparedScene === scene ? preparation : Promise.resolve(null);
  preparedScene = scene;

  preparation = (async () => {
    let container: AssetContainer | null = null;
    try {
      container = await LoadAssetContainerAsync(BRAX_MODEL_URL, scene, { pluginExtension: '.glb' });
      if (scene.isDisposed) {
        container.dispose();
        return null;
      }

      const animationNames = container.animationGroups.map((group) => group.name);
      // The complete source list is emitted before any mapping or validation is performed.
      console.info('[BRAX] Minotaur AnimationGroups:', animationNames);

      const bounds = getRenderableBounds(container);
      if (!bounds) throw new Error('Minotaur GLB has no finite renderable character bounds');
      const height = bounds.maximumY - bounds.minimumY;
      if (height <= 0.001) throw new Error('Minotaur GLB character height is invalid');

      const scale = BRAX_TARGET_HEIGHT / height;
      if (!Number.isFinite(scale) || scale <= 0.1 || scale > 10) {
        throw new Error(`Minotaur GLB requires unsafe scale ${scale}`);
      }
      const groundYOffset = BRAX_GROUND_CLEARANCE - bounds.minimumY * scale;

      container.rootNodes.forEach((root) => root.setEnabled(false));
      container.animationGroups.forEach((group) => group.stop());

      const prepared = { container, scale, groundYOffset };
      scene.onDisposeObservable.addOnce(() => {
        for (const instance of [...activeInstances]) disposeBraxModelInstance(instance);
        container?.dispose();
        if (preparedScene === scene) preparedScene = null;
      });
      return prepared;
    } catch (error) {
      container?.dispose();
      console.error('[BRAX] Minotaur GLB load failed; keeping the procedural visual.', error);
      return null;
    }
  })();

  return preparation;
}

/**
 * Creates a complete cloned hierarchy through AssetContainer, including fresh Skeleton and
 * AnimationGroup objects. Internal meshes, transforms, bones, materials, and textures are left
 * exactly as Babylon imported them.
 */
export async function createBraxModelInstance(scene: Scene, unitLabel: string): Promise<BraxModelInstance | null> {
  const prepared = await prepareBraxModel(scene);
  if (!prepared || scene.isDisposed) return null;

  let entries: InstantiatedEntries | null = null;
  try {
    const prefix = `${unitLabel}-minotaur-${++instanceSerial}`;
    entries = prepared.container.instantiateModelsToScene(
      (sourceName) => `${prefix}-${sourceName}`,
      false,
      { doNotInstantiate: true },
    );

    const modelRoot = entries.rootNodes[0];
    const hasIndependentRig =
      entries.rootNodes.length === 1
      && entries.skeletons.length === prepared.container.skeletons.length
      && entries.animationGroups.length === prepared.container.animationGroups.length
      && entries.skeletons.every((skeleton) => !prepared.container.skeletons.includes(skeleton))
      && entries.animationGroups.every((group) => !prepared.container.animationGroups.includes(group));
    if (!modelRoot || !hasIndependentRig) {
      throw new Error('AssetContainer returned an incomplete or shared BRAX rig');
    }

    // The source root is disabled before instancing, so keep the clone hidden at the origin until
    // UnitRig has parented this one returned top-level root under its correction node.
    modelRoot.setEnabled(false);
    entries.animationGroups.forEach((group) => group.stop());

    const disabledAnimationNames = findUnsafeAnimationGroups(entries.animationGroups);
    const disabledSet = new Set(disabledAnimationNames);
    const usableGroups = entries.animationGroups.filter((group) => !disabledSet.has(group.name));
    const filteredRootMotionTracks = usableGroups.reduce(
      (count, group) => count + filterHorizontalRootMotion(group),
      0,
    );
    const animations = mapAnimations(usableGroups);

    const instance: BraxModelInstance = {
      entries,
      modelRoot,
      animationGroups: entries.animationGroups,
      animations,
      scale: prepared.scale,
      groundYOffset: prepared.groundYOffset,
      filteredRootMotionTracks,
      disabledAnimationNames,
    };
    activeInstances.add(instance);
    return instance;
  } catch (error) {
    entries?.dispose();
    console.error('[BRAX] Minotaur instance creation failed; keeping the procedural visual.', error);
    return null;
  }
}

export function disposeBraxModelInstance(instance: BraxModelInstance | null): void {
  if (!instance || !activeInstances.delete(instance)) return;
  instance.animationGroups.forEach((group) => group.stop());
  instance.entries.dispose();
}

function getRenderableBounds(container: AssetContainer): { minimumY: number; maximumY: number } | null {
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const mesh of container.meshes) {
    if (mesh.getTotalVertices() <= 0) continue;
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    minimumY = Math.min(minimumY, box.minimumWorld.y);
    maximumY = Math.max(maximumY, box.maximumWorld.y);
  }
  return Number.isFinite(minimumY) && Number.isFinite(maximumY) ? { minimumY, maximumY } : null;
}

function mapAnimations(groups: readonly AnimationGroup[]): BraxAnimationMapping {
  const byName = (name: string): AnimationGroup | null => groups.find((group) =>
    group.name === name || group.name.endsWith(`-${name}`),
  ) ?? null;
  return {
    idle: byName('Warrior_Idle'),
    move: byName('Warrior_Walk'),
    attack: null,
    hit: null,
    death: null,
  };
}

/** Reject only clips with objectively unsafe scale values; normal bone-scale tracks remain intact. */
function findUnsafeAnimationGroups(groups: readonly AnimationGroup[]): string[] {
  const disabled: string[] = [];
  for (const group of groups) {
    const hasUnsafeScale = group.targetedAnimations.some(({ animation }) => {
      if (!animation.targetProperty.toLowerCase().includes('scal')) return false;
      return animation.getKeys().some((key) => {
        const value = key.value;
        if (!(value instanceof Vector3)) return false;
        return [value.x, value.y, value.z].some((component) =>
          !Number.isFinite(component) || component <= 0.25 || component >= 4,
        );
      });
    });
    if (!hasUnsafeScale) continue;
    group.stop();
    disabled.push(group.name);
    console.warn(`[BRAX] Disabled animation "${group.name}" because it contains unsafe scale keys.`);
  }
  return disabled;
}

/**
 * A hips translation is root motion only when its first-to-last horizontal displacement is
 * material. Cyclic hip sway/bob is normal bone animation and is deliberately preserved.
 */
function filterHorizontalRootMotion(group: AnimationGroup): number {
  let filtered = 0;
  for (const targeted of group.targetedAnimations) {
    const targetName = typeof targeted.target?.name === 'string' ? targeted.target.name : '';
    if (!targetName.includes('mixamorig:Hips_01') || targeted.animation.targetProperty !== 'position') continue;
    const keys = targeted.animation.getKeys();
    const first = keys[0]?.value;
    const last = keys[keys.length - 1]?.value;
    if (!(first instanceof Vector3) || !(last instanceof Vector3)) continue;
    if (Math.hypot(last.x - first.x, last.z - first.z) <= ROOT_MOTION_EPSILON) continue;

    const filteredAnimation = targeted.animation.clone();
    filteredAnimation.setKeys(keys.map((key) => ({
      ...key,
      value: withoutHorizontalMotion(key.value, first),
      inTangent: withoutHorizontalTangent(key.inTangent),
      outTangent: withoutHorizontalTangent(key.outTangent),
    })));
    targeted.animation = filteredAnimation;
    filtered += 1;
  }
  return filtered;
}

function withoutHorizontalMotion(value: unknown, anchor: Vector3): unknown {
  return value instanceof Vector3 ? new Vector3(anchor.x, value.y, anchor.z) : value;
}

function withoutHorizontalTangent(value: unknown): unknown {
  return value instanceof Vector3 ? new Vector3(0, value.y, 0) : value;
}
