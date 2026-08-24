"""Import exported Photo23D meshes inside headless Blender and count topology."""

from __future__ import annotations

import argparse
import sys
import traceback
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import bpy


def args_after_double_dash() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", type=Path)
    parser.add_argument("--faces", type=int)
    parser.add_argument("--corrupt-glb", type=Path)
    return parser.parse_args(args_after_double_dash())


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)


def import_3mf(path: Path) -> None:
    with zipfile.ZipFile(path, "r") as archive:
        payload = archive.read("3D/3dmodel.model")
    root = ET.fromstring(payload)
    namespace = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}
    vertices = [
        (float(item.attrib["x"]), float(item.attrib["y"]), float(item.attrib["z"]))
        for item in root.findall(".//m:mesh/m:vertices/m:vertex", namespace)
    ]
    faces = [
        (int(item.attrib["v1"]), int(item.attrib["v2"]), int(item.attrib["v3"]))
        for item in root.findall(".//m:mesh/m:triangles/m:triangle", namespace)
    ]
    if not vertices or not faces:
        raise ValueError("3MF has no mesh vertices/faces")
    mesh = bpy.data.meshes.new("Imported 3MF mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.validate(verbose=True)
    mesh.update()
    obj = bpy.data.objects.new("Imported 3MF", mesh)
    bpy.context.scene.collection.objects.link(obj)


def import_file(kind: str, path: Path) -> None:
    if kind == "GLB":
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif kind == "OBJ":
        bpy.ops.wm.obj_import(filepath=str(path), forward_axis="Y", up_axis="Z")
    elif kind == "STL":
        bpy.ops.wm.stl_import(filepath=str(path), forward_axis="Y", up_axis="Z")
    elif kind == "PLY":
        bpy.ops.wm.ply_import(filepath=str(path))
    elif kind == "3MF":
        import_3mf(path)
    else:
        raise ValueError(f"Unknown format: {kind}")


def topology_counts() -> tuple[int, int]:
    meshes = [obj.data for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise ValueError("Importer created no mesh objects")
    return sum(len(mesh.vertices) for mesh in meshes), sum(len(mesh.polygons) for mesh in meshes)


def validate_directory(directory: Path, expected_faces: int) -> None:
    files = (
        ("GLB", directory / "model.glb"),
        ("OBJ", directory / "model.obj"),
        ("STL", directory / "model.stl"),
        ("PLY", directory / "model.ply"),
        ("3MF", directory / "model.3mf"),
    )
    for kind, path in files:
        clear_scene()
        import_file(kind, path)
        vertices, faces = topology_counts()
        if faces != expected_faces:
            raise ValueError(f"{kind} face mismatch: expected {expected_faces}, got {faces}")
        print(f"{kind} vertices={vertices} faces={faces}")


def validate_corrupt_glb(path: Path) -> None:
    clear_scene()
    try:
        import_file("GLB", path)
    except Exception as error:
        print(f"GLB_CORRUPTION FAIL {type(error).__name__}: {error}")
        raise SystemExit(2)
    raise RuntimeError("GLB_CORRUPTION unexpected import success")


def main() -> None:
    options = parse_args()
    if options.corrupt_glb:
        validate_corrupt_glb(options.corrupt_glb)
    elif options.dir and options.faces is not None:
        validate_directory(options.dir, options.faces)
    else:
        raise ValueError("Pass --dir and --faces, or --corrupt-glb")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

