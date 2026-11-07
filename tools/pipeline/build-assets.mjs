#!/usr/bin/env node
// Rebuilds every shipped model: Blender (author/adapt) → glTF-Transform (optimize).
//
//   npm run assets                 # everything
//   npm run assets -- arms props   # some targets
//   npm run assets -- props --from-blend   # re-export a hand-edited assets-src/blender/*.blend
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { BUILD, PUBLIC_MODELS, ROOT, optimizeGlb, runBlender } from "./lib.mjs";

const KENNEY = join(ROOT, "assets-src", "third_party", "kenney");

// Third-party adaptation presets. `keys` restricts palette snapping so each
// group lands on the right family of project colors.
const KIT = [
  {
    name: "trucks",
    inputs: ["red", "yellow", "green", "purple"].map((c) => join(KENNEY, "racing", `vehicle-truck-${c}.glb`)),
    keys: "truck_red,truck_yellow,truck_green,truck_purple,glass,glass_light,tire,metal,metal_dark,b_white,frame,wood,warning_red,hazard_dark",
    scale: 1.7,
  },
  {
    name: "park",
    inputs: ["grass-trees-tall", "grass-trees"].map((f) => join(KENNEY, "city-builder", `${f}.glb`)),
    keys: "grass,grass_dark,leaf_a,leaf_b,leaf_c,trunk",
    scale: 10,
  },
  {
    name: "fountain",
    inputs: [join(KENNEY, "city-builder", "pavement-fountain.glb")],
    keys: "plaza,plaza_dark,water,water_light,sidewalk,curb,b_white,metal",
    scale: 14,
  },
  {
    name: "shops",
    inputs: ["a", "b", "c", "d"].map((c) => join(KENNEY, "city-builder", `building-small-${c}.glb`)),
    keys: "b_brick,b_terracotta,b_cream,b_mint,b_teal,b_sky,b_butter,b_salmon,b_white,glass,glass_light,frame,roof,roof_dark,metal_dark,grass,leaf_a,warning_red",
    scale: 12,
  },
];

const targets = {
  async arms(fromBlend) {
    const out = join(BUILD, "arms.glb");
    const blend = join(ROOT, "assets-src", "blender", "arms.blend");
    if (fromBlend && existsSync(blend)) runBlender("export_blend.py", ["--out", out, "--keyed-only"], { blend });
    else runBlender("build_arms.py", ["--out", out, "--blend", blend]);
    await optimizeGlb(out, join(PUBLIC_MODELS, "arms.glb"));

    // Artist-made pack, adapted to the same rig contract (see tools/blender/adapt_arms_pack.py).
    const pack = join(ROOT, "assets-src", "third_party", "drillimpact-psx-arms", "arms_rig.blend");
    if (!existsSync(pack)) {
      console.warn("  ! PSX arms pack missing; download it from https://drillimpact.itch.io/psx-first-person-arms-free");
      return;
    }
    const psxOut = join(BUILD, "arms-psx.glb");
    const psxBlend = join(ROOT, "assets-src", "blender", "arms-psx.blend");
    if (fromBlend && existsSync(psxBlend)) runBlender("export_blend.py", ["--out", psxOut, "--keyed-only"], { blend: psxBlend });
    else runBlender("adapt_arms_pack.py", ["--preset", "psx", "--out", psxOut, "--blend", psxBlend], { blend: pack });
    await optimizeGlb(psxOut, join(PUBLIC_MODELS, "arms-psx.glb"));
  },
  async props(fromBlend) {
    const out = join(BUILD, "props.glb");
    const blend = join(ROOT, "assets-src", "blender", "props.blend");
    if (fromBlend && existsSync(blend)) runBlender("export_blend.py", ["--out", out], { blend });
    else runBlender("build_props.py", ["--out", out, "--blend", blend]);
    await optimizeGlb(out, join(PUBLIC_MODELS, "props.glb"));
  },
  async kit() {
    for (const group of KIT) {
      const outDir = join(BUILD, "kit", group.name);
      const args = ["--out-dir", outDir, "--remap", "nearest", "--keys", group.keys, "--scale", String(group.scale), "--origin", "bottom", "--join"];
      if (group.decimate) args.push("--decimate", String(group.decimate));
      for (const input of group.inputs) args.push("--in", input);
      runBlender("flatten_palette.py", args);
      for (const file of readdirSync(outDir).filter((f) => f.endsWith(".glb"))) {
        await optimizeGlb(join(outDir, file), join(PUBLIC_MODELS, "kit", `${basename(file, ".glb")}.glb`));
      }
    }
  },
};

const argv = process.argv.slice(2);
const fromBlend = argv.includes("--from-blend");
const wanted = argv.filter((a) => !a.startsWith("--"));
const run = wanted.length ? wanted : Object.keys(targets);

for (const name of run) {
  if (!targets[name]) {
    console.error(`Unknown target "${name}". Targets: ${Object.keys(targets).join(", ")}`);
    process.exit(1);
  }
  await targets[name](fromBlend);
}
console.log("\nAssets ready in public/models.");
