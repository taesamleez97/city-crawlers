"""Builds the custom City Crawlers prop set as one GLB of named, instanceable nodes.

    blender -b --factory-startup -P tools/blender/build_props.py -- \
        --out assets-build/props.glb --blend assets-src/blender/props.blend

Every prop is real-world scale in meters with its origin at the base center
(hoops and coins are centered). Names here are the ids src/world/props.ts uses.
Open props.blend to tweak shapes by hand, then `npm run assets -- props --from-blend`.
"""

import math
import os
import sys

from mathutils import Matrix, Vector

sys.path.append(os.path.dirname(__file__))
import cc_common as cc  # noqa: E402

args = cc.parse_args([
    ("--out", {"default": os.path.join(cc.ROOT, "assets-build", "props.glb")}),
    ("--blend", {"default": os.path.join(cc.ROOT, "assets-src", "blender", "props.blend")}),
])

cc.reset_scene()
mat = cc.palette_material()
P = cc.P
objects = []


def finish(mesh, name, x_offset):
    obj = mesh.to_object(name, mat)
    obj.location.x = x_offset  # spread out for editing; the engine ignores node placement
    objects.append(obj)
    return obj


# ------------------------------------------------------------------ hoop
def build_hoop(name, color_a, color_b, x):
    m = cc.BoxMesh()
    r_in, r_out, depth, segs = 1.0, 1.3, 0.34, 8
    for i in range(segs):
        a0 = 2 * math.pi * (i - 0.5) / segs + math.pi / 8
        a1 = 2 * math.pi * (i + 0.5) / segs + math.pi / 8
        outline = [
            (math.cos(a0) * r_in, math.sin(a0) * r_in),
            (math.cos(a1) * r_in, math.sin(a1) * r_in),
            (math.cos(a1) * r_out, math.sin(a1) * r_out),
            (math.cos(a0) * r_out, math.sin(a0) * r_out),
        ]
        col = color_a if i % 2 == 0 else color_b
        m.quad_prism(outline, depth, col)
    # Inner glow lip: a slightly thinner ring inset for a two-tone edge.
    for i in range(segs):
        a0 = 2 * math.pi * (i - 0.5) / segs + math.pi / 8
        a1 = 2 * math.pi * (i + 0.5) / segs + math.pi / 8
        r0, r1 = r_in - 0.06, r_in + 0.02
        outline = [
            (math.cos(a0) * r0, math.sin(a0) * r0),
            (math.cos(a1) * r0, math.sin(a1) * r0),
            (math.cos(a1) * r1, math.sin(a1) * r1),
            (math.cos(a0) * r1, math.sin(a0) * r1),
        ]
        m.quad_prism(outline, depth * 0.55, color_b if i % 2 == 0 else color_a)
    return finish(m, name, x)


build_hoop("hoop", P("hoop"), P("hoop_stripe"), 0)
build_hoop("hoop_gold", P("coin"), P("coin_rim"), 3)

# ------------------------------------------------------------------ coin
m = cc.BoxMesh()
m.prism((0, 0, 0), 0.6, 0.16, 8, P("coin_rim"), cap_color=P("coin"), axis="Y", rot=math.pi / 8)
m.prism((0, 0, 0), 0.38, 0.22, 8, P("coin_rim"), cap_color=P("coin"), axis="Y", rot=math.pi / 8)
m.box((0, 0, 0), (0.12, 0.26, 0.36), P("frame"))
finish(m, "coin", 6)

# ------------------------------------------------------------------ water tower
m = cc.BoxMesh()
for sx in (-1, 1):
    for sy in (-1, 1):
        m.box((sx * 1.15, sy * 1.15, 1.6), (0.26, 0.26, 3.2), P("metal_dark"))
m.box((0, 0, 1.6), (2.5, 0.12, 0.12), P("metal_dark"))
m.box((0, 0, 1.6), (0.12, 2.5, 0.12), P("metal_dark"))
m.box((0, 0, 3.3), (3.1, 3.1, 0.22), P("metal"))
m.prism((0, 0, 5.15), 1.62, 3.5, 10, P("wood"), cap_color=P("wood"))
for z in (4.0, 5.2, 6.4):
    m.prism((0, 0, z), 1.67, 0.14, 10, P("metal_dark"))
m.frustum((0, 0, 6.9), 1.8, 0.05, 1.4, 10, P("roof_dark"))
m.box((0, 0, 8.35), (0.16, 0.16, 0.3), P("metal_dark"))
finish(m, "water_tower", 10)

# ------------------------------------------------------------------ AC unit
m = cc.BoxMesh()
m.box((0, 0, 0.6), (2.2, 1.6, 1.2), P("metal"), face_colors={"top": P("b_white")})
m.prism((0.45, 0, 1.22), 0.5, 0.06, 8, P("metal_dark"), cap_color=P("metal_dark"))
m.prism((-0.55, 0, 1.22), 0.32, 0.06, 8, P("metal_dark"), cap_color=P("metal_dark"))
for i in range(4):
    m.box((-0.75 + i * 0.5, -0.81, 0.6), (0.3, 0.04, 0.8), P("metal_dark"))
finish(m, "ac_unit", 14)

# ------------------------------------------------------------------ antenna
m = cc.BoxMesh()
m.box((0, 0, 0.3), (1.0, 1.0, 0.6), P("metal_dark"))
m.box((0, 0, 5.0), (0.22, 0.22, 9.4), P("metal"))
for z, w in ((6.2, 2.2), (7.8, 1.5)):
    m.box((0, 0, z), (w, 0.14, 0.14), P("metal"))
m.box((0, 0, 9.85), (0.42, 0.42, 0.5), P("warning_red"))
finish(m, "antenna", 18)


# ------------------------------------------------------------------ billboards
def billboard(name, bg, accent, accent2, x):
    m = cc.BoxMesh()
    for sx in (-3.2, 3.2):
        m.box((sx, 0, 3.0), (0.4, 0.4, 6.0), P("metal_dark"))
    m.box((0, 0, 3.8), (6.8, 0.25, 0.25), P("metal_dark"))
    m.box((0, 0.35, 8.3), (9.6, 0.5, 5.0), P("frame"))
    m.box((0, 0.08, 8.3), (9.0, 0.06, 4.4), bg)
    # Simple graphic: a big disc + two text bars, readable as "an ad" from far away.
    m.prism((-2.4, 0.0, 8.3), 1.5, 0.08, 8, accent, axis="Y", rot=math.pi / 8)
    m.box((1.6, 0.0, 9.1), (4.4, 0.08, 1.0), accent2)
    m.box((1.1, 0.0, 7.5), (3.4, 0.08, 0.7), P("frame"))
    m.box((0, 0.7, 5.75), (9.8, 1.3, 0.16), P("metal_dark"))
    return finish(m, name, x)


billboard("billboard_a", P("b_salmon"), P("hazard"), P("b_white"), 24)
billboard("billboard_b", P("b_mint"), P("coin"), P("b_navy"), 36)
billboard("billboard_c", P("b_sky"), P("b_white"), P("warning_red"), 48)

# ------------------------------------------------------------------ tower crane
m = cc.BoxMesh()
H = 52.0
hz, dark = P("hazard"), P("hazard_dark")
m.box((0, 0, 1.0), (5.0, 5.0, 2.0), P("roof_dark"))
m.box((0, 0, H / 2), (2.2, 2.2, H), hz)
for i in range(1, int(H // 4)):
    m.box((0, 0, i * 4.0), (2.32, 2.32, 0.45), dark)
m.box((2.6, 0, H + 1.2), (3.0, 2.8, 2.4), P("b_white"), face_colors={"right": P("glass")})
m.box((14.0, 0, H + 3.0), (46.0, 1.7, 1.7), hz)
for i in range(1, 12):
    m.box((-6 + i * 4.0, 0, H + 3.0), (0.4, 1.82, 1.82), dark)
m.box((-8.0, 0, H + 3.0), (14.0, 1.7, 1.7), hz)
m.box((-12.5, 0, H + 1.5), (4.0, 2.6, 3.2), P("roof"))
m.box((0, 0, H + 7.0), (1.4, 1.4, 6.5), hz)
apex = Vector((0.0, 0.0, H + 10.0))
for tip in (Vector((34.0, 0.0, H + 3.85)), Vector((-14.0, 0.0, H + 3.85))):
    d = tip - apex
    # Rotating +X about Y by +theta tilts it toward -Z.
    rot = Matrix.Rotation(math.atan2(-d.z, d.x), 4, "Y")
    mtx = Matrix.Translation((apex + tip) / 2) @ rot
    m.box((0, 0, 0), (d.length, 0.18, 0.18), P("metal_dark"), matrix=mtx)
m.box((30.0, 0, H - 6.0), (0.12, 0.12, 18.0), P("metal_dark"))
m.box((30.0, 0, H - 15.4), (1.2, 1.2, 1.0), P("warning_red"))
m.box((30.0, 0, H + 2.0), (2.2, 2.0, 0.6), P("metal_dark"))
finish(m, "crane", 70)

# ------------------------------------------------------------------ blimp
m = cc.BoxMesh()
white, stripe = P("b_white"), P("suit")
sections = [(-9.5, -7.5, 1.5), (-7.5, -4.5, 2.4), (-4.5, 4.5, 2.9), (4.5, 7.5, 2.4), (7.5, 9.2, 1.4)]
for x0, x1, r in sections:
    m.prism(((x0 + x1) / 2, 0, 0), r, x1 - x0, 8, white, cap_color=white, axis="X", rot=math.pi / 8)
m.prism((0, 0, 0), 2.98, 2.2, 8, stripe, cap_color=stripe, axis="X", rot=math.pi / 8)
m.prism((-2.6, 0, 0), 2.98, 0.5, 8, P("gadget"), axis="X", rot=math.pi / 8)
m.prism((2.6, 0, 0), 2.98, 0.5, 8, P("gadget"), axis="X", rot=math.pi / 8)
for ang in (0, 90, 180, 270):
    rot = Matrix.Rotation(math.radians(ang), 4, "X")
    m.box((-8.6, 0, 2.2), (2.6, 0.25, 2.2), P("warning_red"), matrix=rot)
m.box((0.5, 0, -3.2), (3.6, 1.4, 1.0), P("b_white"), face_colors={"left": P("glass"), "right": P("glass")})
finish(m, "blimp", 100)


# ------------------------------------------------------------------ cube trees (Crossy Road style)
def tree(name, layers, trunk_h, x):
    m = cc.BoxMesh()
    m.box((0, 0, trunk_h / 2), (0.55, 0.55, trunk_h), P("trunk"))
    z = trunk_h
    for size, h, col in layers:
        m.box((0, 0, z + h / 2), (size, size, h), P(col), face_colors={"top": P("leaf_c")} if col != "leaf_c" else None)
        z += h * 0.92
    return finish(m, name, x)


tree("tree_a", [(2.8, 1.6, "leaf_a"), (2.1, 1.2, "leaf_b"), (1.2, 0.8, "leaf_a")], 1.6, 120)
tree("tree_b", [(3.2, 2.2, "leaf_b"), (2.2, 1.2, "leaf_a")], 1.2, 125)
tree("tree_c", [(1.8, 1.8, "leaf_a"), (1.6, 1.8, "leaf_b"), (1.2, 1.4, "leaf_a"), (0.8, 0.8, "leaf_c")], 1.4, 130)

# ------------------------------------------------------------------ street lamp
m = cc.BoxMesh()
m.box((0, 0, 0.25), (0.5, 0.5, 0.5), P("metal_dark"))
m.box((0, 0, 3.3), (0.2, 0.2, 6.6), P("metal_dark"))
m.box((0.8, 0, 6.5), (1.8, 0.18, 0.18), P("metal_dark"))
m.box((1.55, 0, 6.3), (0.6, 0.45, 0.32), P("metal_dark"), face_colors={"bottom": P("window_lit")})
finish(m, "streetlamp", 135)

if args.blend:
    cc.save_blend(os.path.abspath(args.blend))
for o in objects:
    o.location.x = 0
cc.export_glb(os.path.abspath(args.out))
