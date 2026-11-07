"""Renders a quick review image of any GLB (flat vertex colors, Workbench).

    blender -b --factory-startup -P tools/blender/preview.py -- \
        --glb public/models/arms.glb --out previews/arms.png [--camera fp|orbit] [--action grip_R]
"""

import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.append(os.path.dirname(__file__))
import cc_common as cc  # noqa: E402

args = cc.parse_args([
    ("--glb", {"required": True}),
    ("--out", {"required": True}),
    ("--camera", {"default": "orbit"}),
    ("--action", {"action": "append", "default": []}),
    ("--size", {"default": "960x540"}),
])

cc.reset_scene()
bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.glb))
scene = bpy.context.scene

for name in args.action:
    act = bpy.data.actions.get(name)
    arm = next((o for o in scene.objects if o.type == "ARMATURE"), None)
    if act and arm:
        # Apply each requested pose clip on top of the previous one (L and R are disjoint).
        arm.animation_data_create()
        arm.animation_data.action = act
        if act.slots:
            arm.animation_data.action_slot = act.slots[0]
        scene.frame_set(1)
        for pb in arm.pose.bones:
            pb.matrix_basis = pb.matrix_basis.copy()
        arm.animation_data.action = None

w, h = (int(v) for v in args.size.split("x"))
scene.render.resolution_x, scene.render.resolution_y = w, h
scene.render.engine = "BLENDER_WORKBENCH"
scene.view_settings.view_transform = "Standard"
shading = scene.display.shading
shading.light = "STUDIO"
shading.color_type = "VERTEX"
shading.show_shadows = True
shading.show_cavity = False
scene.display.light_direction = (0.45, -0.35, 0.82)
world = bpy.data.worlds.new("w")
scene.world = world
world.color = (0.6, 0.82, 0.95)
scene.render.film_transparent = False

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

if args.camera == "fp":
    cam.location = (0, 0, 0)
    cam.rotation_euler = (math.radians(90), 0, 0)  # look +Y (glTF -Z)
    cam_data.sensor_fit = "VERTICAL"
    cam_data.angle = math.radians(58)
    cam_data.clip_start = 0.01
else:
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for o in scene.objects:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            mins = Vector(map(min, mins, p))
            maxs = Vector(map(max, maxs, p))
    center = (mins + maxs) / 2
    radius = max((maxs - mins).length / 2, 0.01)
    direction = Vector((1.0, -1.3, 0.9)).normalized()
    cam.location = center + direction * radius * 2.6
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_data.clip_end = radius * 20

scene.render.filepath = os.path.abspath(args.out)
os.makedirs(os.path.dirname(scene.render.filepath), exist_ok=True)
bpy.ops.render.render(write_still=True)
print(f"[cc] preview {scene.render.filepath}")
