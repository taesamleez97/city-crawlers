"""Builds the City Crawlers first-person arms: blocky, rigged, skinned, with hand-pose clips.

    blender -b --factory-startup -P tools/blender/build_arms.py -- \
        --out assets-build/arms.glb --blend assets-src/blender/arms.blend

Rig contract (shared with any purchased arms pack, see src/view/armsRig.ts):
    root
      upperarm_{L,R} > forearm_{L,R} > hand_{L,R}
        > {thumb,index,middle,ring,pinky}_01_{L,R} > *_02_{L,R}
Rest pose: both arms pointing straight forward from the shoulders (camera space),
which keeps the in-engine two-bone IK trivial.
Clips: relax_{L,R}, grip_{L,R}, open_{L,R} (finger poses; arm pose is procedural).
"""

import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Vector

sys.path.append(os.path.dirname(__file__))
import cc_common as cc  # noqa: E402

args = cc.parse_args([
    ("--out", {"default": os.path.join(cc.ROOT, "assets-build", "arms.glb")}),
    ("--blend", {"default": os.path.join(cc.ROOT, "assets-src", "blender", "arms.blend")}),
])

cc.reset_scene()
mat = cc.palette_material()

# ---------------------------------------------------------------- proportions
SHOULDER = Vector((0.20, -0.10, -0.30))  # right side; left is mirrored on X
UPPER_LEN = 0.30
FORE_LEN = 0.27
PALM_LEN = 0.085
FINGERS = {
    #          x offset, base y offset, len1,  len2
    "index":  (-0.036, 0.000, 0.042, 0.036),
    "middle": (-0.012, 0.002, 0.046, 0.038),
    "ring":   (0.012, -0.002, 0.043, 0.036),
    "pinky":  (0.036, -0.009, 0.034, 0.030),
}
THUMB_BASE = Vector((-0.050, -0.040, -0.006))  # relative to palm head, right hand
THUMB_DIR = Vector((-0.55, 0.75, -0.30)).normalized()
THUMB_LENS = (0.040, 0.034)


def side_vec(v, side):
    return Vector((v.x if side == "R" else -v.x, v.y, v.z))


# ---------------------------------------------------------------- armature
arm_data = bpy.data.armatures.new("ArmsRig")
arm_obj = bpy.data.objects.new("Arms", arm_data)
bpy.context.scene.collection.objects.link(arm_obj)
bpy.context.view_layer.objects.active = arm_obj
arm_obj.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")

eb = arm_data.edit_bones
root = eb.new("root")
root.head = (0, 0, 0)
root.tail = (0, 0.05, 0)

bone_frames = {}  # bone name -> (head, direction, length) for mesh placement

for side in ("R", "L"):
    s = side_vec(SHOULDER, side)
    upper = eb.new(f"upperarm_{side}")
    upper.head = s
    upper.tail = s + Vector((0, UPPER_LEN, 0))
    upper.parent = root
    upper.roll = 0

    fore = eb.new(f"forearm_{side}")
    fore.head = upper.tail
    fore.tail = upper.tail + Vector((0, FORE_LEN, 0))
    fore.parent = upper
    fore.use_connect = True

    hand = eb.new(f"hand_{side}")
    hand.head = fore.tail
    hand.tail = fore.tail + Vector((0, PALM_LEN, 0))
    hand.parent = fore
    hand.use_connect = True

    for b in (upper, fore, hand):
        bone_frames[b.name] = (b.head.copy(), (b.tail - b.head).normalized(), b.length)

    for fname, (fx, fy, l1, l2) in FINGERS.items():
        base = hand.tail + side_vec(Vector((fx, fy, 0)), side)
        f1 = eb.new(f"{fname}_01_{side}")
        f1.head = base
        f1.tail = base + Vector((0, l1, 0))
        f1.parent = hand
        f2 = eb.new(f"{fname}_02_{side}")
        f2.head = f1.tail
        f2.tail = f1.tail + Vector((0, l2, 0))
        f2.parent = f1
        f2.use_connect = True
        for b in (f1, f2):
            bone_frames[b.name] = (b.head.copy(), (b.tail - b.head).normalized(), b.length)

    tdir = side_vec(THUMB_DIR, side)
    tbase = hand.head + Vector((0, PALM_LEN * 0.55, 0)) + side_vec(THUMB_BASE, side) + Vector((0, 0.04, 0))
    t1 = eb.new(f"thumb_01_{side}")
    t1.head = tbase
    t1.tail = tbase + tdir * THUMB_LENS[0]
    t1.parent = hand
    t1.align_roll(Vector((0, 0, 1)))
    t2 = eb.new(f"thumb_02_{side}")
    t2.head = t1.tail
    t2.tail = t1.tail + tdir * THUMB_LENS[1]
    t2.parent = t1
    t2.use_connect = True
    t2.align_roll(Vector((0, 0, 1)))
    for b in (t1, t2):
        bone_frames[b.name] = (b.head.copy(), (b.tail - b.head).normalized(), b.length)

bpy.ops.object.mode_set(mode="OBJECT")


# ---------------------------------------------------------------- mesh
def along(bone, t, offset=(0, 0, 0)):
    """Matrix placing a +Y-aligned primitive at fraction t along a bone."""
    head, d, length = bone_frames[bone]
    rot = Vector((0, 1, 0)).rotation_difference(d).to_matrix().to_4x4()
    return Matrix.Translation(head + d * (length * t)) @ rot @ Matrix.Translation(Vector(offset))


mesh = cc.BoxMesh()
suit, suit_dark, suit_light = cc.P("suit"), cc.P("suit_dark"), cc.P("suit_light")
glove, glove_light = cc.P("glove"), cc.P("glove_light")
gadget, gadget_light = cc.P("gadget"), cc.P("gadget_light")

for side in ("R", "L"):
    sx = 1 if side == "R" else -1
    up, fo, ha = f"upperarm_{side}", f"forearm_{side}", f"hand_{side}"

    # Upper arm sleeve with an accent band near the elbow.
    mesh.box((0, 0, 0), (0.118, UPPER_LEN + 0.02, 0.118), suit, group=up, matrix=along(up, 0.5),
             face_colors={"top": suit_light, "bottom": suit_dark})
    mesh.box((0, 0, 0), (0.126, 0.036, 0.126), suit_light, group=up, matrix=along(up, 0.78))

    # Elbow cap hides the joint when the arm bends.
    mesh.box((0, 0, 0), (0.112, 0.07, 0.112), suit_dark, group=fo, matrix=along(fo, 0.02))
    # Forearm.
    mesh.box((0, 0, 0), (0.104, FORE_LEN * 0.72, 0.104), suit, group=fo, matrix=along(fo, 0.38),
             face_colors={"top": suit_light, "bottom": suit_dark})
    # Web gauntlet: chunky device ringing the wrist end of the forearm.
    mesh.box((0, 0, 0), (0.132, 0.105, 0.126), gadget, group=fo, matrix=along(fo, 0.80))
    mesh.box((0, 0, 0), (0.138, 0.018, 0.132), suit_dark, group=fo, matrix=along(fo, 0.62))
    mesh.box((0, 0, 0.066), (0.05, 0.05, 0.014), gadget_light, group=fo, matrix=along(fo, 0.80))
    mesh.box((sx * 0.069, 0, 0.0), (0.012, 0.06, 0.05), gadget_light, group=fo, matrix=along(fo, 0.80))
    mesh.box((0, 0.03, -0.066), (0.034, 0.04, 0.02), glove, group=fo, matrix=along(fo, 0.86))

    # Wrist block + palm + back-of-hand plate.
    mesh.box((0, 0, 0), (0.078, 0.03, 0.05), glove_light, group=ha, matrix=along(ha, 0.0))
    mesh.box((0, 0, 0), (0.102, PALM_LEN + 0.004, 0.044), glove, group=ha, matrix=along(ha, 0.5))
    mesh.box((0, 0, 0.024), (0.078, 0.055, 0.008), suit_dark, group=ha, matrix=along(ha, 0.48))
    mesh.box((0, 0, 0.0285), (0.03, 0.02, 0.004), gadget, group=ha, matrix=along(ha, 0.48))

    for fname in FINGERS:
        for seg, (w, t) in (("01", (0.021, 0.027)), ("02", (0.020, 0.024))):
            bname = f"{fname}_{seg}_{side}"
            _, _, length = bone_frames[bname]
            mesh.box((0, 0, 0), (w, length + (0.004 if seg == "01" else 0.0), t), glove,
                     group=bname, matrix=along(bname, 0.5),
                     face_colors={"front": glove_light} if seg == "02" else None)
    for seg, (w, t) in (("01", (0.026, 0.028)), ("02", (0.024, 0.025))):
        bname = f"thumb_{seg}_{side}"
        _, _, length = bone_frames[bname]
        mesh.box((0, 0, 0), (w, length + 0.006, t), glove, group=bname, matrix=along(bname, 0.5),
                 face_colors={"front": glove_light} if seg == "02" else None)

arms_mesh = mesh.to_object("ArmsMesh", mat)
arms_mesh.parent = arm_obj
mod = arms_mesh.modifiers.new("Armature", "ARMATURE")
mod.object = arm_obj

# ---------------------------------------------------------------- hand poses
# (curl1, curl2, spread) in degrees. Curl is about the bone X axis (toward the
# palm), spread about Z. Spread sign is mirrored for the left hand.
POSES = {
    "relax": {"index": (16, 20, 3), "middle": (21, 25, 0), "ring": (26, 30, -3), "pinky": (31, 34, -6),
              "thumb": (12, 16, 0)},
    "grip": {"index": (86, 98, 0), "middle": (90, 100, 0), "ring": (93, 100, 0), "pinky": (95, 98, 0),
             "thumb": (38, 48, -10)},
    "open": {"index": (-6, -2, 10), "middle": (-6, -2, 2), "ring": (-6, -2, -6), "pinky": (-6, -2, -13),
             "thumb": (-12, -4, 14)},
}

pose_bones = arm_obj.pose.bones
for pb in pose_bones:
    pb.rotation_mode = "QUATERNION"

arm_obj.animation_data_create()
bpy.context.view_layer.objects.active = arm_obj
for pose_name, fingers in POSES.items():
    for side in ("R", "L"):
        mirror = 1 if side == "R" else -1
        act = bpy.data.actions.new(f"{pose_name}_{side}")
        act.use_fake_user = True
        arm_obj.animation_data.action = act
        for frame in (1, 8):
            for fname, (c1, c2, spread) in fingers.items():
                for seg, curl in (("01", c1), ("02", c2)):
                    pb = pose_bones[f"{fname}_{seg}_{side}"]
                    sp = math.radians(spread * mirror) if seg == "01" else 0.0
                    pb.rotation_quaternion = Euler((-math.radians(curl), 0.0, sp), "XYZ").to_quaternion()
                    pb.keyframe_insert("rotation_quaternion", frame=frame, group=pb.name)
        for pb in pose_bones:
            pb.rotation_quaternion = (1, 0, 0, 0)

arm_obj.animation_data.action = None
for pb in pose_bones:
    pb.rotation_quaternion = (1, 0, 0, 0)

if args.blend:
    cc.save_blend(os.path.abspath(args.blend))
cc.export_glb(os.path.abspath(args.out), animations=True, animation_mode="ACTIONS", force_sampling=False)
