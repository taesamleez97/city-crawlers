"""Adapts a third-party first-person arms pack to the City Crawlers rig contract.

    blender -b <pack>.blend -P tools/blender/adapt_arms_pack.py -- \
        --preset psx --out assets-build/arms-psx.glb [--blend assets-src/blender/arms-psx.blend]

What it does, in order:
  1. Samples hand poses (relax / grip / open per side) from the pack's own clips,
     with constraints evaluated, so artist-authored finger curls survive, and
     composes the web-shooter "thwip" hand from them.
  2. Strips constraints, control bones, widgets and props.
  3. Moves the rig into camera space (eye at the origin, +Y forward, right arm on +X,
     shoulders where build_arms.py puts them) and scales the upper arm to 0.30 m.
  4. Re-rests both arms pointing straight forward, palms down (the in-engine IK
     assumes this), and aligns the arm bone rolls to +Z so the wrist flexes about X.
  5. Renames bones to the contract (see build_arms.py) and repaints the mesh in flat
     palette colors by bone region: suit sleeves, gadget gauntlet, gloves.
  6. Writes the pose clips and exports a GLB with vertex colors, no textures.

Rig contract: upperarm_{L,R} > forearm_{L,R} > hand_{L,R} > (any finger bones);
clips relax_{L,R}, grip_{L,R}, open_{L,R}, thwip_{L,R} key the hand's descendants.
"""

import math
import os
import re
import sys

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.append(os.path.dirname(__file__))
import cc_common as cc  # noqa: E402

args = cc.parse_args([
    ("--preset", {"default": "psx"}),
    ("--out", {"required": True}),
    ("--blend", {"default": ""}),
    ("--inflate", {"type": float, "default": 1.0}),
])

PRESETS = {
    # Drillimpact "PSX First Person Arms" v1.1, CC0: https://drillimpact.itch.io/psx-first-person-arms-free
    "psx": {
        "facing": "-Y",
        "side_re": r"^(?P<base>.+)\.(?P<side>[LR])$",
        "upper": "upper_arm", "fore": "forearm", "hand": "hand", "thumb": "thumb.01",
        "drop": ("camera", "handIK", "elbowIK"),
        # pose -> (action name, frame rule). {s} is the side letter.
        "poses": {"relax": ("relax", "first"), "grip": ("grab.{s}", "max_curl"), "open": ("push.{s}", "min_curl")},
        # Web-shooter hand, composed from the sampled poses: these (contract-named) bones take
        # the grip curl, pushed a little further into the palm; the rest take the open pose.
        "thwip_curled": ("middle_", "ring_", "palm_02_", "palm_03_"),
        "thwip_boost": 1.25,
    },
}
P = PRESETS[args.preset]

# Matches build_arms.py so ArmsView's IK targets line up with either rig.
SHOULDER_MID = Vector((0.0, -0.10, -0.30))
UPPER_LEN = 0.30
INFLATE = {"upper": 0.006, "fore": 0.007, "hand": 0.004}
GAUNTLET_START = 0.78  # fraction along the forearm where the web gauntlet begins

scene = bpy.context.scene
view_layer = bpy.context.view_layer


def side_name(base, side):
    return f"{base}.{side}"


def contract_name(name):
    m = re.match(P["side_re"], name)
    if not m:
        return name
    base = m.group("base").replace("upper_arm", "upperarm")
    if base.startswith("f_"):
        base = base[2:]
    return f"{base.replace('.', '_')}_{m.group('side')}"


def set_mode(obj, mode):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for o in view_layer.objects:
        o.select_set(False)
    view_layer.objects.active = obj
    obj.select_set(True)
    if mode != "OBJECT":
        bpy.ops.object.mode_set(mode=mode)


# ---------------------------------------------------------------- find rig + mesh
arm = next(o for o in scene.objects if o.type == "ARMATURE"
           and any(c.type == "MESH" and any(m.type == "ARMATURE" for m in c.modifiers) for c in o.children))
meshes = [c for c in arm.children if c.type == "MESH" and any(m.type == "ARMATURE" for m in c.modifiers)]
for pb in arm.pose.bones:
    pb.custom_shape = None
for o in list(bpy.data.objects):
    if o is not arm and o not in meshes:
        bpy.data.objects.remove(o, do_unlink=True)
if len(meshes) > 1:
    with bpy.context.temp_override(active_object=meshes[0], selected_editable_objects=meshes):
        bpy.ops.object.join()
mesh = meshes[0]
mesh.name = "ArmsMesh"
arm.name = "Arms"
# Packs often ship with X-mirror editing on, which would apply every edit twice.
arm.data.use_mirror_x = False
arm.pose.use_mirror_x = False


# ---------------------------------------------------------------- 1. sample poses
def local_basis(ev, name):
    pb = ev.pose.bones[name]
    b = pb.bone
    if b.parent:
        parent = ev.pose.bones[b.parent.name]
        rest_rel = b.parent.matrix_local.inverted() @ b.matrix_local
        m = rest_rel.inverted() @ parent.matrix.inverted() @ pb.matrix
    else:
        m = b.matrix_local.inverted() @ pb.matrix
    q = m.to_quaternion().normalized()
    if q.w < 0:
        q.negate()
    return q


def hand_descendants(side):
    return [c.name for c in arm.pose.bones[side_name(P["hand"], side)].children_recursive]


def sample_pose(action_name, side, rule):
    act = bpy.data.actions[action_name]
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = act
    if getattr(ad, "action_slot", "n/a") is None and len(act.slots):
        ad.action_slot = act.slots[0]
    names = hand_descendants(side)
    f0, f1 = (int(round(f)) for f in act.frame_range)
    best = None
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        ev = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
        qs = {n: local_basis(ev, n) for n in names}
        if rule == "first":
            return qs
        curl = sum(min(q.angle, 2 * math.pi - q.angle) for n, q in qs.items() if not n.startswith("palm"))
        score = curl if rule == "max_curl" else -curl
        if best is None or score > best[0]:
            best = (score, qs, f)
    print(f"[cc] pose {action_name} ({side}): frame {best[2]}")
    return best[1]


poses = {}
for pose_name, (action, rule) in P["poses"].items():
    for side in ("L", "R"):
        poses[(pose_name, side)] = sample_pose(action.format(s=side), side, rule)


def curl_more(q, k):
    axis, angle = q.to_axis_angle()
    return Quaternion(axis, angle * k)


for side in ("L", "R"):
    thwip = {}
    for src, q in poses[("open", side)].items():
        name = contract_name(src)
        if name.startswith(P["thwip_curled"]):
            g = poses[("grip", side)][src]
            q = g if name.startswith("palm_") else curl_more(g, P["thwip_boost"])
        thwip[src] = q
    poses[("thwip", side)] = thwip

ad = arm.animation_data
ad.action = None
for act in list(bpy.data.actions):
    bpy.data.actions.remove(act)
for pb in arm.pose.bones:
    for c in list(pb.constraints):
        pb.constraints.remove(c)
    pb.matrix_basis = Matrix.Identity(4)
scene.frame_set(1)

# ---------------------------------------------------------------- 2-3. camera space
set_mode(arm, "EDIT")
eb = arm.data.edit_bones
for b in list(eb):
    if b.name.split(".")[0] in P["drop"]:
        if mesh.vertex_groups.get(b.name):
            print(f"[cc] warning: dropping weighted bone {b.name}")
        eb.remove(b)
heads = [eb[side_name(P["upper"], s)].head.copy() for s in ("L", "R")]
mid = (heads[0] + heads[1]) / 2
scale = UPPER_LEN / eb[side_name(P["upper"], "R")].length
turn = Matrix.Rotation(math.pi, 4, "Z") if P["facing"] == "-Y" else Matrix.Identity(4)
M = Matrix.Translation(SHOULDER_MID) @ Matrix.Scale(scale, 4) @ turn @ Matrix.Translation(-mid)
# Connected children share their parent's tail; transform each joint exactly once.
connected = [b for b in eb if b.use_connect]
for b in connected:
    b.use_connect = False
for b in eb:
    b.transform(M)
for b in connected:
    b.use_connect = True
set_mode(arm, "OBJECT")
mesh.data.transform(M)
mesh.matrix_parent_inverse = Matrix.Identity(4)
mesh.matrix_world = Matrix.Identity(4)
arm.matrix_world = Matrix.Identity(4)

# ---------------------------------------------------------------- 4. re-rest forward, palms down
FORWARD = Vector((0, 1, 0))
set_mode(arm, "POSE")
for side in ("L", "R"):
    sx = 1 if side == "R" else -1
    for base in (P["upper"], P["fore"], P["hand"]):
        pb = arm.pose.bones[side_name(base, side)]
        view_layer.update()
        cur = pb.matrix.copy()
        axis = (cur.to_3x3() @ Vector((0, 1, 0))).normalized()
        head = cur.translation.copy()
        rot = axis.rotation_difference(FORWARD).to_matrix().to_4x4()
        pb.matrix = Matrix.Translation(head) @ rot @ Matrix.Translation(-head) @ cur
    upper = arm.pose.bones[side_name(P["upper"], side)]
    target = math.atan2(-0.35, -sx)
    for _ in range(2):
        view_layer.update()
        t = arm.pose.bones[side_name(P["thumb"], side)].head - arm.pose.bones[side_name(P["hand"], side)].head
        delta = math.atan2(t.z, t.x) - target
        head = upper.matrix.translation.copy()
        upper.matrix = Matrix.Translation(head) @ Matrix.Rotation(delta, 4, "Y") @ Matrix.Translation(-head) @ upper.matrix
view_layer.update()
set_mode(mesh, "OBJECT")
mod = next(m for m in mesh.modifiers if m.type == "ARMATURE")
with bpy.context.temp_override(object=mesh, active_object=mesh):
    bpy.ops.object.modifier_apply(modifier=mod.name)
set_mode(arm, "POSE")
bpy.ops.pose.armature_apply(selected=False)
set_mode(arm, "EDIT")
for side in ("L", "R"):
    for base in (P["upper"], P["fore"], P["hand"]):
        arm.data.edit_bones[side_name(base, side)].align_roll(Vector((0, 0, 1)))
set_mode(arm, "OBJECT")
mod = mesh.modifiers.new("Armature", "ARMATURE")
mod.object = arm

# ---------------------------------------------------------------- 5. rename + repaint
for b in arm.data.bones:
    b.name = contract_name(b.name)


def region(group_name):
    if group_name.startswith("forearm_"):
        return "fore"
    if group_name.startswith(("hand_", "palm_", "thumb_", "index_", "middle_", "ring_", "pinky_")):
        return "hand"
    return "upper"


me = mesh.data
for uv in list(me.uv_layers):
    me.uv_layers.remove(uv)
me.materials.clear()
me.materials.append(cc.palette_material())
for a in list(me.color_attributes):
    me.color_attributes.remove(a)

bm = bmesh.new()
bm.from_mesh(me)
deform = bm.verts.layers.deform.verify()
col = bm.loops.layers.float_color.new("Color")
gnames = {g.index: g.name for g in mesh.vertex_groups}


def vert_region(v):
    w = v[deform]
    if not w:
        return "upper"
    return region(gnames[max(w.items(), key=lambda kv: kv[1])[0]])


bm.normal_update()
offsets = [(v, v.normal * INFLATE[vert_region(v)] * args.inflate) for v in bm.verts]
for v, off in offsets:
    v.co += off
bm.normal_update()

fore = {s: arm.data.bones[f"forearm_{s}"] for s in ("L", "R")}
suit, suit_light, suit_dark = cc.P("suit"), cc.P("suit_light"), cc.P("suit_dark")
glove, glove_light = cc.P("glove"), cc.P("glove_light")
gadget, gadget_light = cc.P("gadget"), cc.P("gadget_light")


def along_forearm(p):
    s = "R" if p.x > 0 else "L"
    b = fore[s]
    d = (b.tail_local - b.head_local)
    return (p - b.head_local).dot(d.normalized()) / d.length


for f in bm.faces:
    f.smooth = False
    regions = [vert_region(v) for v in f.verts]
    reg = max(set(regions), key=regions.count)
    n = f.normal
    if reg == "hand":
        c = glove_light if n.z > 0.75 else glove
    elif reg == "fore" and along_forearm(f.calc_center_median()) > GAUNTLET_START:
        c = gadget
    else:
        c = suit_light if n.z > 0.6 else suit_dark if n.z < -0.6 else suit
    for loop in f.loops:
        loop[col] = c

# Web-shooter button on top of each gauntlet, rigid to the forearm.
for side in ("L", "R"):
    b = fore[side]
    gi = mesh.vertex_groups[b.name].index
    d = (b.tail_local - b.head_local)
    center = b.head_local + d * 0.86
    top = max((v.co.z for v in bm.verts if vert_region(v) == "fore" and 0.75 < along_forearm(v.co) < 0.95
               and (v.co.x > 0) == (side == "R")), default=center.z + 0.04)
    size = Vector((0.042, 0.048, 0.016))
    c0 = Vector((center.x, center.y, top + size.z * 0.35))
    corners = [c0 + Vector((sx_ * size.x / 2, sy * size.y / 2, sz * size.z / 2))
               for sz in (-1, 1) for sy in (-1, 1) for sx_ in (-1, 1)]
    vs = [bm.verts.new(c) for c in corners]
    for v in vs:
        v[deform][gi] = 1.0
    for idx, c in (((0, 2, 3, 1), gadget), ((4, 5, 7, 6), gadget_light), ((0, 1, 5, 4), gadget),
                   ((2, 6, 7, 3), gadget), ((0, 4, 6, 2), gadget), ((1, 3, 7, 5), gadget)):
        face = bm.faces.new([vs[i] for i in idx])
        face.smooth = False
        for loop in face.loops:
            loop[col] = c
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.to_mesh(me)
bm.free()
me.color_attributes.active_color_name = "Color"
try:
    me.color_attributes.render_color_index = me.color_attributes.active_color_index
except Exception:
    pass

# ---------------------------------------------------------------- 6. pose clips + export
for pb in arm.pose.bones:
    pb.rotation_mode = "QUATERNION"
    pb.matrix_basis = Matrix.Identity(4)
ad = arm.animation_data or arm.animation_data_create()
set_mode(arm, "POSE")
for (pose_name, side), qs in poses.items():
    act = bpy.data.actions.new(f"{pose_name}_{side}")
    act.use_fake_user = True
    ad.action = act
    for frame in (1, 8):
        for src, q in qs.items():
            pb = arm.pose.bones[contract_name(src)]
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=frame, group=pb.name)
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
ad.action = None
set_mode(arm, "OBJECT")

tris = sum(len(p.vertices) - 2 for p in me.polygons)
print(f"[cc] adapted {args.preset}: {len(arm.data.bones)} bones, {tris} tris, scale {scale:.3f}")
if args.blend:
    cc.save_blend(os.path.abspath(args.blend))
cc.export_glb(os.path.abspath(args.out), animations=True, animation_mode="ACTIONS", force_sampling=False)
