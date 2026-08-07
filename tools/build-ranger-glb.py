"""Build the Ranger character and its Mixamo animations into one GLB.

Run from Blender, not from the system Python interpreter:

    blender --background --factory-startup --python-exit-code 1 \
        --python tools/build-ranger-glb.py

The source FBX files are read-only inputs. The only asset written by this
script is public/assets/units/ranger/ranger.glb.
"""

from __future__ import annotations

import math
import re
import traceback
from pathlib import Path

import bpy


ROOT_DIR = Path(__file__).resolve().parent.parent
RANGER_DIR = ROOT_DIR / "public" / "assets" / "units" / "ranger"
BASE_FBX = RANGER_DIR / "ranger.fbx"
ANIMATION_DIR = RANGER_DIR / "animations"
OUTPUT_GLB = RANGER_DIR / "ranger.glb"

ANIMATION_FILES = (
    ("Idle.fbx", "Idle"),
    ("Shooting Arrow.fbx", "Shoot"),
    ("Standing Death Right 01.fbx", "Death"),
    ("Climbing Ladder.fbx", "ClimbUp"),
    ("Climbing Down Wall.fbx", "ClimbDown"),
    ("Lifting.fbx", "Lift"),
)
REQUIRED_CLIPS = ("Run", "Idle", "Shoot", "Death", "ClimbUp", "ClimbDown", "Lift")

_BONE_PATH_PATTERN = re.compile(r'pose\.bones\["((?:[^"\\]|\\.)*)"\]')
_TEMP_DATA_COLLECTIONS = (
    "armatures",
    "meshes",
    "materials",
    "images",
    "textures",
    "curves",
    "cameras",
    "lights",
    "collections",
)


class RangerBuildError(RuntimeError):
    """A validation error that must stop the Ranger export."""


def log(message: str) -> None:
    print(f"[Ranger GLB] {message}", flush=True)


def operator_property_ids(operator) -> set[str]:
    return {prop.identifier for prop in operator.get_rna_type().properties}


def import_fbx(path: Path) -> None:
    if not path.is_file():
        raise RangerBuildError(f"Missing FBX source: {path}")

    operator = bpy.ops.import_scene.fbx
    supported = operator_property_ids(operator)
    requested = {
        "filepath": str(path),
        "use_anim": True,
        "use_image_search": True,
        "use_custom_normals": True,
        "ignore_leaf_bones": False,
        "automatic_bone_orientation": False,
    }
    result = operator(**{key: value for key, value in requested.items() if key in supported})
    if "FINISHED" not in result:
        raise RangerBuildError(f"Blender failed to import {path}: {sorted(result)}")


def snapshot_scene_data() -> dict[str, set[str]]:
    snapshot = {
        "objects": set(bpy.data.objects.keys()),
        "actions": set(bpy.data.actions.keys()),
    }
    for collection_name in _TEMP_DATA_COLLECTIONS:
        snapshot[collection_name] = set(getattr(bpy.data, collection_name).keys())
    return snapshot


def newly_imported_objects(snapshot: dict[str, set[str]]) -> list[bpy.types.Object]:
    return [obj for obj in bpy.data.objects if obj.name not in snapshot["objects"]]


def newly_imported_actions(snapshot: dict[str, set[str]]) -> list[bpy.types.Action]:
    return [action for action in bpy.data.actions if action.name not in snapshot["actions"]]


def iter_action_fcurves(action: bpy.types.Action):
    """Yield legacy and layered-action FCurves across supported Blender versions."""
    seen: set[int] = set()

    try:
        legacy_fcurves = action.fcurves
    except (AttributeError, RuntimeError):
        legacy_fcurves = ()

    for fcurve in legacy_fcurves:
        pointer = fcurve.as_pointer()
        if pointer not in seen:
            seen.add(pointer)
            yield fcurve

    # Blender 4.4+ can store curves in channel bags inside layered actions.
    for layer in getattr(action, "layers", ()):
        for strip in getattr(layer, "strips", ()):
            channel_bags = getattr(strip, "channelbags", None)
            found_channel_bag = False
            if channel_bags is not None:
                for channel_bag in channel_bags:
                    found_channel_bag = True
                    for fcurve in getattr(channel_bag, "fcurves", ()):
                        pointer = fcurve.as_pointer()
                        if pointer not in seen:
                            seen.add(pointer)
                            yield fcurve
            if found_channel_bag:
                continue

            channel_bag_for_slot = getattr(strip, "channelbag", None)
            if channel_bag_for_slot is None:
                continue
            for slot in getattr(action, "slots", ()):
                try:
                    channel_bag = channel_bag_for_slot(slot)
                except (RuntimeError, TypeError):
                    continue
                if channel_bag is None:
                    continue
                for fcurve in getattr(channel_bag, "fcurves", ()):
                    pointer = fcurve.as_pointer()
                    if pointer not in seen:
                        seen.add(pointer)
                        yield fcurve


def action_bone_names(action: bpy.types.Action) -> set[str]:
    names: set[str] = set()
    for fcurve in iter_action_fcurves(action):
        match = _BONE_PATH_PATTERN.search(fcurve.data_path)
        if not match:
            continue
        escaped_name = match.group(1)
        try:
            names.add(bpy.utils.unescape_identifier(escaped_name))
        except AttributeError:
            names.add(escaped_name.replace(r'\"', '"').replace(r"\\", "\\"))
    return names


def action_span(action: bpy.types.Action) -> float:
    start, end = action.frame_range
    return float(end - start)


def describe_action(action: bpy.types.Action) -> str:
    start, end = action.frame_range
    bone_count = len(action_bone_names(action))
    return f"{action.name!r} frames={start:g}-{end:g} bone_channels={bone_count}"


def bound_actions(armature: bpy.types.Object) -> list[bpy.types.Action]:
    animation_data = armature.animation_data
    if animation_data is None:
        return []

    actions: list[bpy.types.Action] = []
    if animation_data.action is not None:
        actions.append(animation_data.action)
    for track in animation_data.nla_tracks:
        for strip in track.strips:
            if strip.action is not None and strip.action not in actions:
                actions.append(strip.action)
    return actions


def choose_armature_action(
    armature: bpy.types.Object,
    imported_actions: list[bpy.types.Action],
    source_label: str,
) -> bpy.types.Action:
    animation_data = armature.animation_data
    active_action = animation_data.action if animation_data is not None else None
    bound = bound_actions(armature)
    pose_actions = [action for action in imported_actions if action_bone_names(action)]

    # The action assigned by Blender's FBX importer is the strongest signal.
    if active_action in pose_actions and action_span(active_action) > 0:
        chosen = active_action
    elif len(pose_actions) == 1 and action_span(pose_actions[0]) > 0:
        chosen = pose_actions[0]
    elif active_action in bound and active_action is not None and action_span(active_action) > 0:
        # Layered actions may not expose their FCurves through every Blender API version.
        chosen = active_action
    elif len(bound) == 1 and action_span(bound[0]) > 0:
        chosen = bound[0]
    else:
        candidates = pose_actions or bound
        ranked = sorted(candidates, key=action_span, reverse=True)
        if ranked and action_span(ranked[0]) > 0:
            second_span = action_span(ranked[1]) if len(ranked) > 1 else -1.0
            if action_span(ranked[0]) > second_span:
                chosen = ranked[0]
            else:
                details = "; ".join(describe_action(action) for action in candidates)
                raise RangerBuildError(
                    f"Ambiguous armature actions in {source_label}. Candidates: {details}"
                )
        else:
            details = "; ".join(describe_action(action) for action in imported_actions)
            raise RangerBuildError(
                f"No usable armature animation found in {source_label}. "
                f"Imported actions: {details or '<none>'}"
            )

    if action_span(chosen) <= 0:
        raise RangerBuildError(
            f"The selected action {chosen.name!r} in {source_label} has no usable frame range."
        )
    return chosen


def bone_names(armature: bpy.types.Object) -> set[str]:
    return {bone.name for bone in armature.data.bones}


def validate_matching_skeletons(
    master_armature: bpy.types.Object,
    imported_armature: bpy.types.Object,
    action: bpy.types.Action,
    source_path: Path,
) -> None:
    master_bones = bone_names(master_armature)
    imported_bones = bone_names(imported_armature)
    missing_from_master = sorted(imported_bones - master_bones)
    missing_from_animation = sorted(master_bones - imported_bones)

    if missing_from_master or missing_from_animation:
        raise RangerBuildError(
            f"Skeleton mismatch in {source_path.name}; animation was not mapped. "
            f"Bones absent from master ({len(missing_from_master)}): "
            f"{missing_from_master[:12] or '<none>'}. "
            f"Bones absent from animation ({len(missing_from_animation)}): "
            f"{missing_from_animation[:12] or '<none>'}."
        )

    channel_bones = action_bone_names(action)
    unknown_channels = sorted(channel_bones - master_bones)
    if unknown_channels:
        raise RangerBuildError(
            f"Action {action.name!r} in {source_path.name} animates bones that do not "
            f"exist on the master Ranger skeleton: {unknown_channels[:12]}"
        )


def remove_action(action: bpy.types.Action) -> None:
    if bpy.data.actions.get(action.name) is action:
        bpy.data.actions.remove(action, do_unlink=True)


def rename_action_exact(action: bpy.types.Action, desired_name: str) -> None:
    collision = bpy.data.actions.get(desired_name)
    if collision is not None and collision is not action:
        raise RangerBuildError(
            f"Cannot name action {desired_name!r}: another action already uses that name."
        )
    action.name = desired_name
    if action.name != desired_name:
        raise RangerBuildError(
            f"Blender renamed action {desired_name!r} to {action.name!r}; exact clip names are required."
        )
    action.use_fake_user = True


def remove_temporary_import(
    imported_objects: list[bpy.types.Object],
    imported_actions: list[bpy.types.Action],
    snapshot: dict[str, set[str]],
) -> None:
    for obj in list(imported_objects):
        if bpy.data.objects.get(obj.name) is obj:
            bpy.data.objects.remove(obj, do_unlink=True)

    for action in list(imported_actions):
        remove_action(action)

    for collection_name in _TEMP_DATA_COLLECTIONS:
        collection = getattr(bpy.data, collection_name)
        original_names = snapshot[collection_name]
        for data_block in list(collection):
            if data_block.name in original_names or data_block.users != 0:
                continue
            try:
                collection.remove(data_block)
            except RuntimeError:
                # The block is unused and cannot affect selection-based GLB export.
                pass


def copy_action_to_master(
    source_action: bpy.types.Action,
    master_armature: bpy.types.Object,
    final_name: str,
) -> bpy.types.Action:
    # Free the exact final name in case the imported FBX action already used it.
    source_action.name = f"__RANGER_SOURCE__{final_name}"
    copied_action = source_action.copy()
    rename_action_exact(copied_action, final_name)

    animation_data = master_armature.animation_data_create()
    previous_action = animation_data.action
    try:
        # Assignment verifies that Blender can apply the copied action to the master ID.
        animation_data.action = copied_action
        bpy.context.view_layer.update()
    except (RuntimeError, TypeError) as exc:
        remove_action(copied_action)
        raise RangerBuildError(
            f"Could not reuse action {final_name!r} on the master Ranger armature: {exc}"
        ) from exc
    finally:
        animation_data.action = previous_action

    return copied_action


def configure_nla_tracks(
    master_armature: bpy.types.Object,
    actions: dict[str, bpy.types.Action],
) -> None:
    animation_data = master_armature.animation_data_create()
    animation_data.action = None
    for track in list(animation_data.nla_tracks):
        animation_data.nla_tracks.remove(track)

    starts: list[float] = []
    ends: list[float] = []
    for clip_name in REQUIRED_CLIPS:
        action = actions[clip_name]
        start, end = (float(value) for value in action.frame_range)
        starts.append(start)
        ends.append(end)

        track = animation_data.nla_tracks.new()
        track.name = clip_name
        strip = track.strips.new(clip_name, int(math.floor(start)), action)
        strip.name = clip_name
        strip.blend_type = "REPLACE"
        strip.extrapolation = "NOTHING"

        if track.name != clip_name or strip.name != clip_name:
            raise RangerBuildError(f"Could not create exact NLA clip name {clip_name!r}.")

    scene = bpy.context.scene
    scene.frame_start = int(math.floor(min(starts)))
    scene.frame_end = int(math.ceil(max(ends)))


def validate_before_export(
    master_armature: bpy.types.Object,
    base_objects: list[bpy.types.Object],
    actions: dict[str, bpy.types.Action],
) -> list[bpy.types.Object]:
    scene_objects = list(bpy.context.scene.objects)
    scene_armatures = [obj for obj in scene_objects if obj.type == "ARMATURE"]
    if scene_armatures != [master_armature]:
        raise RangerBuildError(
            "Expected exactly one armature in the conversion scene, found: "
            + (", ".join(obj.name for obj in scene_armatures) or "<none>")
        )

    export_objects = [
        obj
        for obj in base_objects
        if bpy.data.objects.get(obj.name) is obj and obj.type in {"ARMATURE", "MESH", "EMPTY"}
    ]
    export_armatures = [obj for obj in export_objects if obj.type == "ARMATURE"]
    if export_armatures != [master_armature]:
        raise RangerBuildError(
            f"Expected exactly one exported master armature, found {len(export_armatures)}."
        )

    ranger_meshes = [obj for obj in export_objects if obj.type == "MESH"]
    if not ranger_meshes:
        raise RangerBuildError("The Ranger mesh is missing from the export set.")

    skinned_meshes = [
        mesh
        for mesh in ranger_meshes
        if any(
            modifier.type == "ARMATURE" and modifier.object is master_armature
            for modifier in mesh.modifiers
        )
    ]
    if not skinned_meshes:
        raise RangerBuildError(
            "Ranger mesh objects exist, but none is skinned to the master armature."
        )

    missing_actions = [name for name in REQUIRED_CLIPS if bpy.data.actions.get(name) is None]
    if missing_actions:
        raise RangerBuildError(f"Missing required actions: {', '.join(missing_actions)}")

    for clip_name in REQUIRED_CLIPS:
        if bpy.data.actions.get(clip_name) is not actions.get(clip_name):
            raise RangerBuildError(f"Required action {clip_name!r} is not mapped exactly once.")

    tracks = master_armature.animation_data.nla_tracks
    track_names = [track.name for track in tracks]
    if track_names != list(REQUIRED_CLIPS):
        raise RangerBuildError(
            f"NLA tracks do not match required clips. Found: {track_names}"
        )
    for track, clip_name in zip(tracks, REQUIRED_CLIPS):
        if len(track.strips) != 1 or track.strips[0].action is not actions[clip_name]:
            raise RangerBuildError(f"NLA track {clip_name!r} is not bound to its action.")

    log(
        f"Validation passed: 1 armature, {len(ranger_meshes)} mesh object(s), "
        f"{len(REQUIRED_CLIPS)} animation actions."
    )
    return export_objects


def gltf_export_arguments(output_path: Path) -> dict:
    operator = bpy.ops.export_scene.gltf
    rna = operator.get_rna_type()
    supported = {prop.identifier for prop in rna.properties}
    requested = {
        "filepath": str(output_path),
        "check_existing": False,
        "export_format": "GLB",
        "use_selection": True,
        "export_animations": True,
        "export_skins": True,
        "export_materials": "EXPORT",
        "export_texcoords": True,
        "export_normals": True,
        "export_cameras": False,
        "export_lights": False,
        "export_apply": False,
        "export_force_sampling": True,
        "export_frame_range": False,
        "export_current_frame": False,
        "export_reset_pose_bones": True,
        "export_anim_single_armature": True,
    }
    arguments = {key: value for key, value in requested.items() if key in supported}

    mode_property = next(
        (prop for prop in rna.properties if prop.identifier == "export_animation_mode"),
        None,
    )
    nla_mode_available = False
    if mode_property is not None:
        enum_values = {item.identifier for item in mode_property.enum_items}
        nla_mode_available = "NLA_TRACKS" in enum_values
        if nla_mode_available:
            arguments["export_animation_mode"] = "NLA_TRACKS"

    if not nla_mode_available and "export_nla_strips" in supported:
        # Blender 3.x and early 4.x use this switch instead of export_animation_mode.
        arguments["export_nla_strips"] = True
        if "export_all_actions" in supported:
            arguments["export_all_actions"] = False
    elif not nla_mode_available:
        raise RangerBuildError(
            "This Blender glTF exporter cannot export separate NLA-track animations. "
            "Use a supported Blender 3.6 LTS or newer release."
        )

    return arguments


def export_glb(output_path: Path, export_objects: list[bpy.types.Object], master_armature) -> None:
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    for obj in export_objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = master_armature

    output_path.parent.mkdir(parents=True, exist_ok=True)
    result = bpy.ops.export_scene.gltf(**gltf_export_arguments(output_path))
    if "FINISHED" not in result or not output_path.is_file():
        raise RangerBuildError(
            f"Blender did not produce the expected GLB at {output_path}. Result: {sorted(result)}"
        )


def validate_source_files() -> None:
    missing = [BASE_FBX] + [ANIMATION_DIR / name for name, _ in ANIMATION_FILES]
    missing = [path for path in missing if not path.is_file()]
    if missing:
        raise RangerBuildError(
            "Required Ranger source files are missing:\n  - "
            + "\n  - ".join(str(path) for path in missing)
        )


def main() -> None:
    validate_source_files()
    log(f"Blender {bpy.app.version_string}")
    log(f"Base FBX: {BASE_FBX}")
    log(f"Output GLB: {OUTPUT_GLB}")

    # The command also uses --factory-startup; this guarantees a clean scene if
    # somebody invokes the script manually without that flag.
    bpy.ops.wm.read_factory_settings(use_empty=True)

    base_snapshot = snapshot_scene_data()
    import_fbx(BASE_FBX)
    base_objects = newly_imported_objects(base_snapshot)
    base_actions = newly_imported_actions(base_snapshot)
    base_armatures = [obj for obj in base_objects if obj.type == "ARMATURE"]
    base_meshes = [obj for obj in base_objects if obj.type == "MESH"]

    if len(base_armatures) != 1:
        raise RangerBuildError(
            f"Expected one master armature in {BASE_FBX.name}, found {len(base_armatures)}: "
            f"{[obj.name for obj in base_armatures]}"
        )
    if not base_meshes:
        raise RangerBuildError(f"No Ranger mesh was imported from {BASE_FBX.name}.")

    master_armature = base_armatures[0]
    run_action = choose_armature_action(master_armature, base_actions, BASE_FBX.name)
    detected_records = [
        (
            BASE_FBX.name,
            master_armature.name,
            run_action.name,
            [describe_action(action) for action in base_actions],
            "Run",
        )
    ]

    # Remove unused FBX stacks before claiming the exact Run name.
    for action in list(base_actions):
        if action is not run_action:
            remove_action(action)
    rename_action_exact(run_action, "Run")
    final_actions: dict[str, bpy.types.Action] = {"Run": run_action}

    master_bone_count = len(master_armature.data.bones)
    log(
        f"Master armature {master_armature.name!r}: {master_bone_count} bones, "
        f"{len(base_meshes)} mesh object(s)."
    )

    for filename, final_name in ANIMATION_FILES:
        source_path = ANIMATION_DIR / filename
        snapshot = snapshot_scene_data()
        import_fbx(source_path)
        imported_objects = newly_imported_objects(snapshot)
        imported_actions = newly_imported_actions(snapshot)
        copied_action = None

        try:
            imported_armatures = [obj for obj in imported_objects if obj.type == "ARMATURE"]
            if len(imported_armatures) != 1:
                raise RangerBuildError(
                    f"Expected one temporary armature in {filename}, found "
                    f"{len(imported_armatures)}: {[obj.name for obj in imported_armatures]}"
                )

            imported_armature = imported_armatures[0]
            source_action = choose_armature_action(imported_armature, imported_actions, filename)
            source_action_name = source_action.name
            candidate_descriptions = [describe_action(action) for action in imported_actions]
            validate_matching_skeletons(
                master_armature, imported_armature, source_action, source_path
            )
            copied_action = copy_action_to_master(source_action, master_armature, final_name)
            final_actions[final_name] = copied_action
            detected_records.append(
                (
                    filename,
                    imported_armature.name,
                    source_action_name,
                    candidate_descriptions,
                    final_name,
                )
            )
        finally:
            remove_temporary_import(imported_objects, imported_actions, snapshot)

        if copied_action is None:
            raise RangerBuildError(f"Failed to copy an action from {filename}.")

    configure_nla_tracks(master_armature, final_actions)
    export_objects = validate_before_export(master_armature, base_objects, final_actions)

    log("Detected animation actions:")
    for filename, armature_name, source_action_name, candidates, final_name in detected_records:
        log(
            f"  {filename}: armature={armature_name!r}, selected={source_action_name!r} "
            f"-> {final_name!r}"
        )
        log(f"    candidates: {'; '.join(candidates)}")

    export_glb(OUTPUT_GLB, export_objects, master_armature)
    log(f"Export complete: {OUTPUT_GLB} ({OUTPUT_GLB.stat().st_size:,} bytes)")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[Ranger GLB] ERROR: {exc}", flush=True)
        traceback.print_exc()
        raise
