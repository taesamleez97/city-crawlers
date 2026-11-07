"""Adapts third-party low-poly assets to the City Crawlers flat-color style.

Works for packs that color faces through a palette/atlas texture (Kenney, Synty,
Quaternius, most itch.io low-poly kits) or plain material colors:

  1. import (glb/gltf/fbx/obj/blend)
  2. bake each face's color (texture sampled at the face UV centroid, times the
     material base color) into a FLOAT_COLOR corner attribute
  3. optionally snap every color to the nearest project palette entry (CIELAB)
  4. strip textures/UVs, assign the single shared palette material
  5. optionally join, rescale, re-origin, and export one GLB per input
     (each top-level object becomes a named node)

    blender -b --factory-startup -P tools/blender/flatten_palette.py -- \
        --in a.glb --in b.glb --out-dir assets-build/kit --remap nearest \
        --keys asphalt,sidewalk,grass --scale 10 --origin bottom --join
"""

import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.append(os.path.dirname(__file__))
import cc_common as cc  # noqa: E402

args = cc.parse_args([
    ("--in", {"dest": "inputs", "action": "append", "required": True}),
    ("--out-dir", {"required": True}),
    ("--remap", {"default": "none", "choices": ["none", "nearest"]}),
    ("--keys", {"default": ""}),
    ("--map", {"action": "append", "default": [],
               "help": "explicit 'srcHex=paletteKey' overrides, applied before --remap"}),
    ("--scale", {"type": float, "default": 1.0}),
    ("--origin", {"default": "keep", "choices": ["keep", "bottom", "center"]}),
    ("--join", {"action": "store_true"}),
    ("--decimate", {"type": float, "default": 1.0}),
    ("--name", {"default": ""}),
])


# ---------------------------------------------------------------- color math
def lin_to_lab(rgb):
    r, g, b = rgb[:3]
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = (0.2126 * r + 0.7152 * g + 0.0722 * b)
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


pal = cc.palette()
keys = [k.strip() for k in args.keys.split(",") if k.strip()] or list(pal.keys())
pal_lab = [(k, pal[k], lin_to_lab(pal[k])) for k in keys]
explicit = {}
for m in args.map:
    src, dst = m.split("=")
    explicit[src.lower().lstrip("#")] = pal[dst]


def linear_to_hex(c):
    return "".join(f"{round(max(0, min(1, cc.linear_to_srgb(v))) * 255):02x}" for v in c[:3])


def remap(c):
    hx = linear_to_hex(c)
    if hx in explicit:
        return explicit[hx]
    if args.remap == "none":
        return (c[0], c[1], c[2], 1.0)
    lab = lin_to_lab(c)
    best = min(pal_lab, key=lambda e: sum((a - b) ** 2 for a, b in zip(lab, e[2])))
    return best[1]


# ---------------------------------------------------------------- texture sampling
_image_cache = {}


def image_pixels(img):
    if img.name not in _image_cache:
        w, h = img.size
        px = list(img.pixels[:]) if w and h else []
        # Byte images store display (sRGB) values; float images are already linear.
        srgb = not img.is_float and img.colorspace_settings.name.lower().startswith("srgb")
        _image_cache[img.name] = (w, h, px, srgb)
    return _image_cache[img.name]


def uv_transform_of(tex_node):
    """Mapping node (KHR_texture_transform on import) feeding a texture, as a function."""
    vec = tex_node.inputs.get("Vector")
    mapping = None
    if vec and vec.links and vec.links[0].from_node.type == "MAPPING":
        mapping = vec.links[0].from_node
    if mapping is None:
        return lambda u, v: (u, v)
    loc = mapping.inputs["Location"].default_value
    rot = mapping.inputs["Rotation"].default_value[2]
    scl = mapping.inputs["Scale"].default_value
    c, s = math.cos(rot), math.sin(rot)

    def apply(u, v):
        x, y = u * scl[0], v * scl[1]
        return (x * c - y * s + loc[0], x * s + y * c + loc[1])

    return apply


def material_color_source(mat):
    """(image or None, base color factor, uv transform)."""
    identity = lambda u, v: (u, v)  # noqa: E731
    if mat is None:
        return None, (0.8, 0.8, 0.8, 1.0), identity
    if not mat.node_tree:
        return None, tuple(mat.diffuse_color), identity
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return None, tuple(mat.diffuse_color), identity
    sock = bsdf.inputs["Base Color"]
    factor = tuple(sock.default_value)
    tex = None
    stack = [l.from_node for l in sock.links]
    while stack:
        n = stack.pop()
        if n.type == "TEX_IMAGE" and n.image:
            tex = n
            break
        for inp in n.inputs:
            stack.extend(l.from_node for l in inp.links)
    if tex is None:
        return None, factor, identity
    return tex.image, (1.0, 1.0, 1.0, 1.0), uv_transform_of(tex)


def sample(img, uv):
    w, h, px, srgb = image_pixels(img)
    if not px:
        return (1, 1, 1, 1)
    x = min(w - 1, max(0, int((uv[0] % 1.0) * w)))
    y = min(h - 1, max(0, int((uv[1] % 1.0) * h)))
    i = (y * w + x) * 4
    c = px[i:i + 3]
    if srgb:
        c = [cc.srgb_to_linear(v) for v in c]
    return (c[0], c[1], c[2], 1.0)


def bake_object(obj, shared_mat):
    me = obj.data
    uv_layer = me.uv_layers.active
    attr = me.color_attributes.get("Color") or me.color_attributes.new("Color", "FLOAT_COLOR", "CORNER")
    sources = [material_color_source(m) for m in me.materials] or [(None, (0.8, 0.8, 0.8, 1), None)]
    for poly in me.polygons:
        img, factor, xform = sources[min(poly.material_index, len(sources) - 1)]
        if img is not None and uv_layer is not None:
            u = sum(uv_layer.data[li].uv[0] for li in poly.loop_indices) / poly.loop_total
            v = sum(uv_layer.data[li].uv[1] for li in poly.loop_indices) / poly.loop_total
            c = sample(img, xform(u, v))
            c = tuple(c[i] * factor[i] for i in range(3)) + (1.0,)
        else:
            c = factor
        c = remap(c)
        for li in poly.loop_indices:
            attr.data[li].color = c
    me.color_attributes.active_color_name = "Color"
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.materials.clear()
    me.materials.append(shared_mat)


# ---------------------------------------------------------------- main
def import_any(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=True)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == ".blend":
        with bpy.data.libraries.load(path) as (src, dst):
            dst.objects = src.objects
        for o in dst.objects:
            if o is not None:
                bpy.context.scene.collection.objects.link(o)
    else:
        raise SystemExit(f"unsupported input: {path}")


def bottom_origin(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
    cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
    cz = min(p.z for p in pts) if args.origin == "bottom" else (min(p.z for p in pts) + max(p.z for p in pts)) / 2
    return Vector((cx, cy, cz))


os.makedirs(args.out_dir, exist_ok=True)
for path in args.inputs:
    cc.reset_scene()
    shared = cc.palette_material()
    import_any(os.path.abspath(path))
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in meshes:
        bake_object(o, shared)
        if args.decimate < 1.0:
            mod = o.modifiers.new("Decimate", "DECIMATE")
            mod.ratio = args.decimate

    base = args.name or os.path.splitext(os.path.basename(path))[0]
    bpy.ops.object.select_all(action="DESELECT")
    has_armature = any(o.type == "ARMATURE" for o in bpy.context.scene.objects)
    if args.join and meshes and not has_armature:
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.convert(target="MESH")
        bpy.ops.object.join()
        joined = bpy.context.view_layer.objects.active
        # Unparent while keeping transforms, then drop empty helpers.
        bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        for o in list(bpy.context.scene.objects):
            if o != joined and o.type == "EMPTY":
                bpy.data.objects.remove(o)
        joined.name = base
        joined.data.name = base
        meshes = [joined]

    roots = [o for o in bpy.context.scene.objects if o.parent is None]
    for r in roots:
        if args.origin != "keep" and r.type == "MESH" and not has_armature:
            off = bottom_origin(r)
            r.data.transform(__import__("mathutils").Matrix.Translation(-(r.matrix_world.inverted() @ off)))
            r.location = (0, 0, 0)
        if args.scale != 1.0:
            r.scale = (r.scale[0] * args.scale, r.scale[1] * args.scale, r.scale[2] * args.scale)
    if args.scale != 1.0 and not has_armature:
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    out = os.path.join(os.path.abspath(args.out_dir), base + ".glb")
    cc.export_glb(out, animations=has_armature, force_sampling=True)
