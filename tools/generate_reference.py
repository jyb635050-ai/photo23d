"""Generate the immutable Photo23D synthetic benchmark with Blender.

Run with:
  blender -b --factory-startup --python tools/generate_reference.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "test" / "fixtures"
RESOLUTION = 256
AZIMUTHS = tuple(range(0, 360, 45))
ELEVATIONS = (15, 35, 55)
CAMERA_DISTANCE = 7.5
VOXEL_BOUNDS = ((-2.1, -2.1, -2.1), (2.1, 2.1, 2.1))
OBJECT_NAMES = ("beveled_cube", "cylinder", "suzanne", "mug")


def reset_scene() -> bpy.types.Scene:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = RESOLUTION
    scene.render.resolution_y = RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 25
    scene.view_settings.look = "None"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    world = bpy.data.worlds.new("Pure white world")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    background.inputs["Strength"].default_value = 0.8
    scene.world = world
    return scene


def make_material(name: str) -> bpy.types.Material:
    material = bpy.data.materials.new(f"{name} benchmark material")
    material.diffuse_color = (0.04, 0.46, 0.62, 1.0)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.025, 0.32, 0.48, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.72
    bsdf.inputs["Metallic"].default_value = 0.0
    return material


def apply_modifier(obj: bpy.types.Object, modifier: bpy.types.Modifier) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def smooth(obj: bpy.types.Object) -> bpy.types.Object:
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def build_beveled_cube() -> list[bpy.types.Object]:
    bpy.ops.mesh.primitive_cube_add(location=(0.0, 0.0, 0.0))
    obj = bpy.context.object
    obj.name = "beveled_cube"
    obj.scale = (1.18, 1.18, 1.18)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = obj.modifiers.new("Fixed benchmark bevel", "BEVEL")
    bevel.width = 0.24
    bevel.segments = 4
    apply_modifier(obj, bevel)
    return [obj]


def build_cylinder() -> list[bpy.types.Object]:
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=1.2, depth=2.4)
    obj = bpy.context.object
    obj.name = "cylinder"
    bevel = obj.modifiers.new("Fixed benchmark bevel", "BEVEL")
    bevel.width = 0.08
    bevel.segments = 3
    apply_modifier(obj, bevel)
    smooth(obj)
    return [obj]


def build_suzanne() -> list[bpy.types.Object]:
    bpy.ops.mesh.primitive_monkey_add(location=(0.0, 0.0, 0.0))
    obj = bpy.context.object
    obj.name = "suzanne"
    obj.scale = (1.18, 1.18, 1.18)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    subdivision = obj.modifiers.new("Fixed benchmark subdivision", "SUBSURF")
    subdivision.subdivision_type = "CATMULL_CLARK"
    subdivision.levels = 1
    subdivision.render_levels = 1
    apply_modifier(obj, subdivision)
    smooth(obj)
    return [obj]


def build_mug() -> list[bpy.types.Object]:
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=0.92, depth=2.35)
    mug = bpy.context.object
    mug.name = "mug"

    bpy.ops.mesh.primitive_cylinder_add(
        vertices=96,
        radius=0.69,
        depth=2.18,
        location=(0.0, 0.0, 0.18),
    )
    cavity = bpy.context.object
    cavity.name = "mug_cavity_cutter"
    difference = mug.modifiers.new("Fixed inner cavity", "BOOLEAN")
    difference.operation = "DIFFERENCE"
    difference.solver = "EXACT"
    difference.object = cavity
    apply_modifier(mug, difference)
    bpy.data.objects.remove(cavity, do_unlink=True)

    bpy.ops.mesh.primitive_torus_add(
        align="WORLD",
        major_segments=72,
        minor_segments=16,
        location=(0.92, 0.0, 0.0),
        rotation=(math.radians(90.0), 0.0, 0.0),
        major_radius=0.70,
        minor_radius=0.16,
    )
    handle = bpy.context.object
    handle.name = "mug_handle"
    handle.scale = (1.0, 1.0, 1.18)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    union = mug.modifiers.new("Fixed handle union", "BOOLEAN")
    union.operation = "UNION"
    union.solver = "EXACT"
    union.object = handle
    apply_modifier(mug, union)
    bpy.data.objects.remove(handle, do_unlink=True)

    bevel = mug.modifiers.new("Fixed mug bevel", "BEVEL")
    bevel.width = 0.025
    bevel.segments = 2
    apply_modifier(mug, bevel)
    smooth(mug)
    return [mug]


BUILDERS = {
    "beveled_cube": build_beveled_cube,
    "cylinder": build_cylinder,
    "suzanne": build_suzanne,
    "mug": build_mug,
}


def add_camera(scene: bpy.types.Scene) -> bpy.types.Object:
    camera_data = bpy.data.cameras.new("Fixed benchmark camera")
    camera_data.type = "PERSP"
    camera_data.lens = 55.0
    camera_data.sensor_width = 36.0
    camera_data.sensor_fit = "HORIZONTAL"
    camera_data.dof.use_dof = False
    camera = bpy.data.objects.new("Fixed benchmark camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    return camera


def add_lights(scene: bpy.types.Scene) -> None:
    specs = (
        ((4.0, -4.0, 6.0), 900.0, 5.0),
        ((-4.0, -2.0, 3.0), 650.0, 4.0),
        ((0.0, 5.0, 1.0), 500.0, 3.0),
    )
    for index, (location, energy, size) in enumerate(specs):
        data = bpy.data.lights.new(f"Area {index}", "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        light = bpy.data.objects.new(f"Area {index}", data)
        light.location = location
        scene.collection.objects.link(light)


def rows(matrix) -> list[list[float]]:
    return [[round(float(matrix[row][column]), 10) for column in range(4)] for row in range(4)]


def export_world_obj(objects: list[bpy.types.Object], path: Path) -> None:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    vertex_offset = 1
    with path.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write("# Photo23D immutable benchmark truth mesh\n")
        for obj in objects:
            evaluated = obj.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()
            stream.write(f"o {obj.name}\n")
            for vertex in mesh.vertices:
                world = obj.matrix_world @ vertex.co
                stream.write(f"v {world.x:.9f} {world.y:.9f} {world.z:.9f}\n")
            for polygon in mesh.polygons:
                indices = " ".join(str(vertex_offset + index) for index in polygon.vertices)
                stream.write(f"f {indices}\n")
            vertex_offset += len(mesh.vertices)
            evaluated.to_mesh_clear()


def render_object(name: str) -> int:
    scene = reset_scene()
    output_dir = FIXTURES / name
    image_dir = output_dir / "images"
    image_dir.mkdir(parents=True, exist_ok=True)
    for stale in image_dir.glob("*.png"):
        stale.unlink()

    objects = BUILDERS[name]()
    material = make_material(name)
    for obj in objects:
        if len(obj.data.materials) == 0:
            obj.data.materials.append(material)
        else:
            obj.data.materials[0] = material
    export_world_obj(objects, output_dir / "truth.obj")

    camera = add_camera(scene)
    add_lights(scene)
    fx = camera.data.lens / camera.data.sensor_width * RESOLUTION
    views = []
    for elevation in ELEVATIONS:
        elevation_radians = math.radians(elevation)
        for azimuth in AZIMUTHS:
            azimuth_radians = math.radians(azimuth)
            camera.location = (
                CAMERA_DISTANCE * math.cos(elevation_radians) * math.cos(azimuth_radians),
                CAMERA_DISTANCE * math.cos(elevation_radians) * math.sin(azimuth_radians),
                CAMERA_DISTANCE * math.sin(elevation_radians),
            )
            direction = Vector((0.0, 0.0, 0.0)) - camera.location
            camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
            bpy.context.view_layer.update()
            image_name = f"e{elevation:02d}_a{azimuth:03d}.png"
            scene.render.filepath = str(image_dir / image_name)
            bpy.ops.render.render(write_still=True)
            views.append(
                {
                    "image": f"images/{image_name}",
                    "azimuth_deg": azimuth,
                    "elevation_deg": elevation,
                    "camera_matrix_world": rows(camera.matrix_world),
                    "world_to_camera": rows(camera.matrix_world.inverted()),
                }
            )

    camera_payload = {
        "schema": "photo23d-camera-v1",
        "object": name,
        "coordinate_system": "right-handed, Z-up; camera looks along local -Z; image origin top-left",
        "resolution": {"width": RESOLUTION, "height": RESOLUTION},
        "intrinsics": {
            "fx": fx,
            "fy": fx,
            "cx": RESOLUTION / 2.0,
            "cy": RESOLUTION / 2.0,
        },
        "voxel_bounds": [list(VOXEL_BOUNDS[0]), list(VOXEL_BOUNDS[1])],
        "views": views,
    }
    (output_dir / "cameras.json").write_text(
        json.dumps(camera_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return len(list(image_dir.glob("*.png")))


def main() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    print("PHOTO23D_REFERENCE_BEGIN")
    for name in OBJECT_NAMES:
        count = render_object(name)
        print(f"{name} images={count}")
    print("PHOTO23D_REFERENCE_END")


if __name__ == "__main__":
    main()

