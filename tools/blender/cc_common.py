"""Shared helpers for the City Crawlers Blender pipeline.

Every script in this folder runs headless:
    blender -b --factory-startup -P tools/blender/<script>.py -- [args]

Conventions (keep in sync with src/world/palette.ts):
  * One shared material per asset, colors live in a FLOAT_COLOR corner attribute
    named "Color" (linear values), exported as glTF COLOR_0.
  * Colors come from assets-src/palette.json (sRGB hex).
  * Blender is Z-up / -Y forward; the glTF exporter converts to Y-up / -Z forward.
  * Bone and node names use underscores: three.js strips "." from node names.
"""

import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PALETTE_PATH = os.path.join(ROOT, "assets-src", "palette.json")


def parse_args(spec):
    """spec: list of (flag, kwargs) passed to argparse. Reads args after '--'."""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    for flag, kwargs in spec:
        parser.add_argument(flag, **kwargs)
    return parser.parse_args(argv)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c):
    return c * 12.92 if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def hex_to_linear(hex_str):
    h = hex_str.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


_palette_cache = None


def palette():
    """name -> linear RGBA tuple."""
    global _palette_cache
    if _palette_cache is None:
        with open(PALETTE_PATH, "r", encoding="utf-8") as f:
            raw = json.load(f)
        _palette_cache = {k: hex_to_linear(v) for k, v in raw.items()}
    return _palette_cache


def P(name):
    return palette()[name]


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.render.fps = 30
    return scene


def palette_material(name="Palette"):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None) or nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Color"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    for key in ("Specular IOR Level", "Specular"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = 0.0
    return mat


class BoxMesh:
    """Accumulates colored boxes / prisms into one bmesh with a float color layer.

    Each primitive can carry a vertex group name for rigid skinning.
    """

    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new("Color")
        self.deform = self.bm.verts.layers.deform.verify()
        self.groups = []

    def _group_index(self, group):
        if group is None:
            return None
        if group not in self.groups:
            self.groups.append(group)
        return self.groups.index(group)

    def _finish(self, verts, faces_idx, colors, group, matrix):
        bm = self.bm
        gi = self._group_index(group)
        bverts = []
        for v in verts:
            bv = bm.verts.new(matrix @ Vector(v))
            if gi is not None:
                bv[self.deform][gi] = 1.0
            bverts.append(bv)
        for fi, idx in enumerate(faces_idx):
            face = bm.faces.new([bverts[i] for i in idx])
            c = colors[fi] if isinstance(colors, (list, tuple)) and isinstance(colors[0], (list, tuple)) else colors
            for loop in face.loops:
                loop[self.col] = c
        return bverts

    def box(self, center, size, color, group=None, matrix=None, face_colors=None):
        """Axis-aligned box in local space, then transformed by matrix.

        face_colors: optional dict with keys top,bottom,front,back,left,right.
        """
        cx, cy, cz = center
        sx, sy, sz = (s / 2 for s in size)
        verts = [
            (cx - sx, cy - sy, cz - sz), (cx + sx, cy - sy, cz - sz),
            (cx + sx, cy + sy, cz - sz), (cx - sx, cy + sy, cz - sz),
            (cx - sx, cy - sy, cz + sz), (cx + sx, cy - sy, cz + sz),
            (cx + sx, cy + sy, cz + sz), (cx - sx, cy + sy, cz + sz),
        ]
        faces = [
            (0, 3, 2, 1),  # bottom (-Z)
            (4, 5, 6, 7),  # top (+Z)
            (0, 1, 5, 4),  # back (-Y)
            (2, 3, 7, 6),  # front (+Y)
            (1, 2, 6, 5),  # right (+X)
            (3, 0, 4, 7),  # left (-X)
        ]
        if face_colors:
            order = ("bottom", "top", "back", "front", "right", "left")
            colors = [face_colors.get(k, color) for k in order]
        else:
            colors = [color] * 6
        return self._finish(verts, faces, colors, group, matrix or Matrix.Identity(4))

    def prism(self, center, radius, height, sides, color, cap_color=None, group=None, matrix=None, axis="Z", rot=0.0):
        """N-sided prism (flat shaded) along axis."""
        cx, cy, cz = center
        ring = []
        for i in range(sides):
            a = rot + 2 * math.pi * i / sides
            ring.append((math.cos(a) * radius, math.sin(a) * radius))
        verts = []
        h = height / 2
        for z in (-h, h):
            for (x, y) in ring:
                verts.append((x, y, z))
        if axis == "Y":
            verts = [(x, z, -y) for (x, y, z) in verts]
        elif axis == "X":
            verts = [(z, y, -x) for (x, y, z) in verts]
        verts = [(x + cx, y + cy, z + cz) for (x, y, z) in verts]
        faces = []
        colors = []
        for i in range(sides):
            j = (i + 1) % sides
            faces.append((i, j, sides + j, sides + i))
            colors.append(color)
        faces.append(tuple(reversed(range(sides))))
        colors.append(cap_color or color)
        faces.append(tuple(range(sides, 2 * sides)))
        colors.append(cap_color or color)
        return self._finish(verts, faces, colors, group, matrix or Matrix.Identity(4))

    def frustum(self, center, r0, r1, height, sides, color, cap_color=None, group=None, matrix=None, rot=0.0):
        """Z-axis truncated cone (r1 may be 0 for a cone). center = base center."""
        cx, cy, cz = center
        verts = []
        for z, r in ((0.0, r0), (height, max(r1, 1e-4))):
            for i in range(sides):
                a = rot + 2 * math.pi * i / sides
                verts.append((cx + math.cos(a) * r, cy + math.sin(a) * r, cz + z))
        faces, colors = [], []
        for i in range(sides):
            j = (i + 1) % sides
            faces.append((i, j, sides + j, sides + i))
            colors.append(color)
        faces.append(tuple(reversed(range(sides))))
        colors.append(cap_color or color)
        if r1 > 1e-3:
            faces.append(tuple(range(sides, 2 * sides)))
            colors.append(cap_color or color)
        return self._finish(verts, faces, colors, group, matrix or Matrix.Identity(4))

    def quad_prism(self, outline_front, depth, color, axis_y=True, group=None, matrix=None, colors=None):
        """Extrudes a convex 2D outline [(x, z), ...] along Y by depth (centered)."""
        n = len(outline_front)
        d = depth / 2
        verts = [(x, -d, z) for x, z in outline_front] + [(x, d, z) for x, z in outline_front]
        faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
        cols = [color, color]
        for i in range(n):
            j = (i + 1) % n
            faces.append((i, j, n + j, n + i))
            cols.append(colors[i] if colors else color)
        return self._finish(verts, faces, cols, group, matrix or Matrix.Identity(4))

    def to_object(self, name, material=None, collection=None):
        me = bpy.data.meshes.new(name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces[:])
        self.bm.to_mesh(me)
        self.bm.free()
        me.color_attributes.active_color_name = "Color"
        try:
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        except Exception:
            pass
        obj = bpy.data.objects.new(name, me)
        (collection or bpy.context.scene.collection).objects.link(obj)
        for g in self.groups:
            obj.vertex_groups.new(name=g)
        me.materials.append(material or palette_material())
        return obj


def export_glb(path, selection=None, animations=False, animation_mode="ACTIONS", force_sampling=True):
    """force_sampling=False keeps only keyed channels (pose libraries);
    True bakes every bone (needed for constraint/IK-driven packs)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if selection is not None:
        bpy.ops.object.select_all(action="DESELECT")
        for o in selection:
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=selection is not None,
        export_apply=True,
        export_yup=True,
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_animations=animations,
        export_animation_mode=animation_mode,
        export_skins=True,
        export_def_bones=False,
        export_leaf_bone=False,
        export_reset_pose_bones=True,
        export_rest_position_armature=True,
        export_force_sampling=force_sampling,
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=force_sampling,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
    )
    print(f"[cc] exported {path}")


def save_blend(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    print(f"[cc] saved {path}")
