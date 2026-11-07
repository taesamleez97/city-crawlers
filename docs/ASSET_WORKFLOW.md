# Asset workflow

Every model in `public/models/` is rebuilt from source by one command:

```bash
npm run assets                       # arms, props, kit
npm run assets -- arms               # one target
npm run assets -- props --from-blend # re-export a .blend you edited by hand
npm run assets:inspect public/models/arms-psx.glb   # triangles, attributes, size
```

The pipeline is **Blender (author or adapt) → glTF-Transform (dedup, weld, quantize,
meshopt) → `public/models/*.glb`**. Blender runs headless (`blender -b`), so builds are
reproducible and work in CI. You only open the Blender UI to edit something by hand.

## The style rules the pipeline enforces

- **Flat color, no textures.** Every asset uses one material, and colors live in a vertex
  color attribute named `Color` (glTF `COLOR_0`). The game draws the whole world with one
  `MeshLambertMaterial` plus vertex colors, so adding assets costs no extra shader programs.
- **One palette.** `assets-src/palette.json` holds 66 named sRGB colors (`b_brick`, `suit`,
  `hoop`, …), mirrored in `src/world/palette.ts`. Third-party colors snap to it, which
  keeps packs from different artists cohesive.
- **Real-world scale in meters**, origin at the base center, Z-up in Blender (the exporter
  converts to glTF Y-up).
- **Names use underscores.** three.js strips `.` from node names, so `hand.R` becomes `hand_R`.
- **Budgets:** props under about 300 triangles, vehicles under about 1.2k, arms under 1.5k.
  The frame budget is about 100 draw calls and about 250k triangles on TV hardware.

## Targets

| Target | Script | Source | Output |
|---|---|---|---|
| `props` | `tools/blender/build_props.py` | procedural (hoops, coins, AC units, water towers, antennas, lamps, …) | `props.glb` (named nodes the game instances) |
| `kit` | `tools/blender/flatten_palette.py` | Kenney GLBs in `assets-src/third_party/kenney/` | `kit/*.glb` (trucks, park trees, fountain, shopfronts) |
| `arms` | `build_arms.py`, then `adapt_arms_pack.py` | procedural blocky arms; the Drillimpact PSX arms pack | `arms.glb`, `arms-psx.glb` |

Each build also saves an editable `.blend` in `assets-src/blender/`. Open it in Blender,
tweak shapes, colors (vertex paint the `Color` attribute) or poses, save, then run the
target with `--from-blend` to export your edits with the project settings.

## Adapting a third-party pack (environment)

`flatten_palette.py` handles packs that color faces through a palette or atlas texture
(Kenney, KayKit, Synty, Quaternius, most itch.io low-poly kits) or plain material colors:

1. It samples each face's texture color at its UV centroid.
2. With `--remap nearest`, it snaps that color to the nearest project color in CIELAB space,
   limited to `--keys` so a truck can't turn into a building color.
3. It writes the result as flat vertex colors, drops textures and UVs, and assigns the
   palette material.
4. It applies `--scale` and `--origin bottom`, and joins each model into one mesh.

To add a pack, drop its GLB/FBX files under `assets-src/third_party/<pack>/`, add a preset
to `KIT` in `tools/pipeline/build-assets.mjs` (inputs, palette keys, scale), run
`npm run assets -- kit`, and check the render with:

```bash
blender -b --factory-startup -P tools/blender/preview.py -- --glb public/models/kit/<name>.glb --out previews/<name>.png
```

Decimation (`--decimate`) is available but rarely worth it on low-poly sources. On the
Kenney trucks it produced spikes and smeared colors, so cut instance counts instead.

## First-person arms: the rig contract

Both arms files follow one contract, so the game code doesn't care which one loads:

```
root > (shoulder) > upperarm_{L,R} > forearm_{L,R} > hand_{L,R} > any finger/palm bones
```

- **Rest pose:** both arms straight forward (+Y in Blender), palms down, shoulders at
  (±0.18–0.20, −0.10, −0.30) m from the eye. The arm bone rolls point +Z.
- **Clips:** `relax_{L,R}`, `grip_{L,R}`, `open_{L,R}`, `thwip_{L,R}` (the web-shooter
  hand: middle and ring curled, index, pinky and thumb out). These are single-frame hand
  poses keying the hand's descendants. The game blends them: thwip as a web fires and as
  the player's real arm punches out, grip while holding a web, open for the release fling
  and crashes.
- **The arm itself is procedural.** `src/view/arms.ts` runs two-bone IK toward the web
  anchor, adds wrist flicks, sway from acceleration and a speed bob. That keeps the arms
  responsive to steering instead of playing canned swings.

`tools/blender/adapt_arms_pack.py` converts a purchased or free arms pack to this contract:

1. Samples `relax`/`grip`/`open` from the pack's own clips with its constraints evaluated
   (the PSX pack drives finger segments 2–3 through copy-rotation constraints).
2. Removes constraints, IK/camera bones, widgets and props, and turns off X-mirror editing.
3. Moves the rig into camera space, scales the upper arm to 0.30 m, and re-rests both arms
   forward with palms down.
4. Renames bones (`upper_arm.R` → `upperarm_R`, `f_index.01.R` → `index_01_R`, …).
5. Repaints the mesh by bone region: suit sleeves (lighter on top, darker underneath), a
   gold web gauntlet over the last 22% of the forearm, black gloves, and an orange button.
   It inflates the mesh slightly for chunkier proportions.

To support another pack, add a preset to `PRESETS` in that script with the pack's
facing, its bone-name pattern, the bones to drop, and which clips and frames give the three
poses. Mixamo-style rigs need a different `side_re` (`mixamorig:RightHand`) and base mapping.

**Work still to do for a richer set:** the pack has no web-shooter, hang-loop or
wave clips. Next would be a dedicated `thwip` pose (index and pinky out, middle fingers
curled) and a two-handed "both webs" pose, keyed in `arms-psx.blend`.

## Checking your work

- `previews/` holds orbit renders made with `tools/blender/preview.py`.
  `previews/shots/` holds in-game captures, including `arms-psx.jpg` and `arms-custom.jpg`,
  which compare the two arms rigs at the same moments.
- In the game, `?debug&autopilot&quality=high` flies the route. `window.game.renderer.info`
  gives draw calls and triangles.
