"""Re-exports a hand-edited .blend (opened by the pipeline) with project export settings.

    blender -b assets-src/blender/props.blend -P tools/blender/export_blend.py -- --out assets-build/props.glb
"""

import os
import sys

import bpy

sys.path.append(os.path.dirname(__file__))
import cc_common as cc  # noqa: E402

args = cc.parse_args([
    ("--out", {"required": True}),
    ("--keyed-only", {"action": "store_true", "help": "export only keyed channels (pose-library clips)"}),
])

has_armature = any(o.type == "ARMATURE" for o in bpy.context.scene.objects)
for o in bpy.context.scene.objects:
    if o.type == "ARMATURE" and o.animation_data:
        o.animation_data.action = None
cc.export_glb(os.path.abspath(args.out), animations=has_armature, force_sampling=not args.keyed_only)
