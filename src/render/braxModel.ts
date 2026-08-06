import '@babylonjs/loaders/glTF';
import type { AnimationGroup, AssetContainer, InstantiatedEntries, Node, Scene, Skeleton } from '@babylonjs/core';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';

const BRAX_MODEL_URL = '/assets/models/units/brax/brax.glb';

/** The complete hierarchy returned by AssetContainer.instantiateModelsToScene. */
export type BraxModelInstance = InstantiatedEntries;

let braxContainer: AssetContainer | null = null;
let braxScene: Scene | null = null;
let preparation: Promise<boolean> | null = null;
let instanceSerial = 0;
const activeInstances = new Set<BraxModelInstance>();

/**
 * Loads the source GLB into an AssetContainer exactly once for a scene.
 * The container is deliberately kept detached from the scene and its source roots are disabled.
 */
export function prepareBraxModel(scene: Scene): Promise<boolean> {
  if (braxContainer) {
    return Promise.resolve(braxScene === scene);
  }

  if (preparation) {
    return Promise.resolve(braxScene === scene ? preparation : false);
  }

  braxScene = scene;
  preparation = (async () => {
    let loadedContainer: AssetContainer | null = null;

    try {
      loadedContainer = await LoadAssetContainerAsync(BRAX_MODEL_URL, scene);
      if (scene.isDisposed) {
        loadedContainer.dispose();
        return false;
      }

      // AssetContainer assets remain detached; disabling the roots also guarantees the source
      // hierarchy cannot render if it is inspected or temporarily added by a caller.
      loadedContainer.rootNodes.forEach((rootNode) => rootNode.setEnabled(false));
      loadedContainer.animationGroups.forEach((animationGroup) => animationGroup.stop());
      braxContainer = loadedContainer;

      scene.onDisposeObservable.addOnce(() => {
        if (braxContainer !== loadedContainer) {
          return;
        }
        disposeBraxModelInstance();
        loadedContainer?.dispose();
        braxContainer = null;
        braxScene = null;
      });

      return true;
    } catch {
      loadedContainer?.dispose();
      braxContainer = null;
      braxScene = null;
      return false;
    } finally {
      preparation = null;
    }
  })();

  return preparation;
}

/**
 * Creates one complete, rigged BRAX hierarchy. Babylon clones the skinned meshes as part of the
 * container operation and supplies fresh skeletons and AnimationGroups for this instance.
 */
export function createBraxModelInstance(): BraxModelInstance | null {
  const container = braxContainer;
  const scene = braxScene;
  if (!container || !scene || scene.isDisposed) {
    return null;
  }

  const existingNodes = new Set(scene.getNodes());
  const existingSkeletons = new Set(scene.skeletons);
  const existingAnimationGroups = new Set(scene.animationGroups);
  let entries: BraxModelInstance | null = null;

  try {
    const instanceName = `brax-instance-${++instanceSerial}`;
    entries = container.instantiateModelsToScene(
      (sourceName) => `${instanceName}-${sourceName}`,
      false,
      { doNotInstantiate: false },
    );

    // Source roots are disabled; new roots are independent clones and are ready for their caller
    // to place. No node is attached to a gameplay BRAX here.
    entries.rootNodes.forEach((rootNode) => rootNode.setEnabled(true));

    const hasIndependentRig =
      entries.rootNodes.length === 1 &&
      entries.skeletons.length === container.skeletons.length &&
      entries.animationGroups.length === container.animationGroups.length &&
      entries.skeletons.every((skeleton) => !container.skeletons.includes(skeleton)) &&
      entries.animationGroups.every((animationGroup) => !container.animationGroups.includes(animationGroup));

    if (!hasIndependentRig) {
      throw new Error('BRAX container instancing returned an incomplete rig');
    }

    activeInstances.add(entries);
    return entries;
  } catch {
    entries?.dispose();
    disposePartialInstance(scene, existingNodes, existingSkeletons, existingAnimationGroups);
    return null;
  }
}

/** Disposes one instance, or all instances when called without an argument. */
export function disposeBraxModelInstance(instance?: BraxModelInstance | null): void {
  if (instance) {
    instance.dispose();
    activeInstances.delete(instance);
    return;
  }

  for (const activeInstance of activeInstances) {
    activeInstance.dispose();
  }
  activeInstances.clear();
}

function disposePartialInstance(
  scene: Scene,
  existingNodes: ReadonlySet<Node>,
  existingSkeletons: ReadonlySet<Skeleton>,
  existingAnimationGroups: ReadonlySet<AnimationGroup>,
): void {
  const createdNodes = scene.getNodes().filter((node) => !existingNodes.has(node));
  const createdNodeSet = new Set(createdNodes);

  // Dispose only newly-created roots; recursive disposal removes their newly-created descendants.
  createdNodes
    .filter((node) => !node.parent || !createdNodeSet.has(node.parent))
    .forEach((node) => node.dispose());
  scene.skeletons.filter((skeleton) => !existingSkeletons.has(skeleton)).forEach((skeleton) => skeleton.dispose());
  scene.animationGroups
    .filter((animationGroup) => !existingAnimationGroups.has(animationGroup))
    .forEach((animationGroup) => animationGroup.dispose());
}
