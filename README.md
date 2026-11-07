# City Crawlers

A first-person web-swinging game for Little TV: swing through a flat-color low-poly city,
dodge buildings and banners, steer through hoops and collect coins. Three.js + Vite +
TypeScript, built as a Little app (a website plus `/little/manifest.json`).

The first playable is one compact city section with a full route: Main Ave north, a
right turn over the canal, then a tight run up Tower Ave to the finish ring.

## Quick start

```bash
npm install                 # needs NODE_AUTH_TOKEN for @kabletv/little-sdk (see below)
npm run dev                 # http://127.0.0.1:7140 (desktop browser, keyboard)
little dev                  # the Little simulator, same server
npm run assets              # rebuild every model with Blender (only after editing assets)
```

Node 22+ is required (Little's floor). Without the SDK installed, Vite aliases
`@kabletv/little-sdk` to `src/platform/little-stub.ts`, so the game still runs in a browser.

## Manual steps (yours)

| Step | Why | How |
|---|---|---|
| GitHub token for the SDK | `@kabletv/little-sdk` lives on GitHub Packages | A token with `read:packages`: `export NODE_AUTH_TOKEN=$(gh auth token)` (or a classic PAT), then `npm install`. Already done on this Mac (0.39.1). |
| Little CLI sign-in | simulator, devices, publishing | `little login`, then `little doctor`. Done on this Mac (tae@little.co). |
| JDK 17+ | `little dev` runs a JVM runtime | Present here (OpenJDK 21). The simulator toolchain installs itself on the first `little dev`. |
| Pair the TV | developer mode on the television | TV: Settings → Developer → Pair a computer. Mac: `little device pair <CODE> --name vim4`. |
| Allow `node` in the macOS firewall | the TV loads the game from this Mac | Accept the prompt the first time `little dev --device` runs. |
| Publisher org + HTTPS origin | publishing (not needed for dev) | Create an org, deploy `npm run build` output to HTTPS, `little domains add/verify`, then `little publish --url <origin>`. |
| Blender 4.2+ | only for rebuilding assets | Installed at `~/Applications/Blender.app` (5.2), wrapper at `~/.local/bin/blender`. Elsewhere: set `BLENDER=/path/to/blender`. |

## Run it on the TV

```bash
little device ls                 # paired televisions
little dev --device vim4         # starts `npm run dev:tv`, opens the game on the TV, streams console
```

`little.config.json` runs `npm run dev:tv`, which listens on `0.0.0.0` so the TV can
reach `http://<this-mac>:7140`. The CLI swaps `127.0.0.1` in the app URL for the Mac's LAN
address. Nothing is installed on the TV. `adb` is not needed for this.

## Controls

The remote only guarantees six keys as `keydown` (Select and Back never repeat, `keyup` is
undocumented), so every action works with taps alone. Hold-to-swing is a bonus when the
host does deliver `keyup`.

| Input | While swinging | In the air | Menus |
|---|---|---|---|
| **OK / Select** | tap: release (hold > 0.23 s and lift also releases) | tap: shoot a web at the highlighted anchor (pressed up to 0.18 s early still counts) | choose |
| **Left / Right** | steer and lean into the turn; the web re-anchors through corners | steer, air-strafe, camera roll | move focus |
| **Up** | reel in (speed boost) | glide | move focus |
| **Down** | let out (swing lower) | dive | move focus |
| **Back** | pause | pause | back / quit |

Gamepad (`input.gamepad`): A = web toggle, RT/RB held = web, left stick steers and
reels, B/Start = back. Keyboard for desktop: arrows or WASD, Enter/Space, Escape.

Timing matters: releasing on the upswing, while you're moving forward and climbing, gives
a **Perfect** boost and points. Releasing at the bottom or while falling just lets go. Hoops through the center score Bullseye. Consecutive hoops and coins
build a combo multiplier up to ×5, and a crash, ground bonk or splash breaks it.

## Debug flags

| URL flag | Effect |
|---|---|
| `?debug` | exposes `window.game`, logs city stats |
| `?autopilot` | a bot flies the route (handy for profiling and screenshots) |
| `?quality=low\|medium\|high\|ultra` | lock a quality tier (default: adaptive, starts at medium) |
| `?arms=custom` | the in-house blocky arms instead of the adapted PSX arms pack |
| `?littleDebug` | SDK debug/inspector mode |

## Performance

Measured on the dev Mac during an autopilot run at the high tier: about 66 draw calls,
about 190k triangles per frame including the shadow pass (233k peak), and about 1.2 ms
CPU per frame. Static props are baked into 100 m city chunks so they cull with their
block. Traffic is instanced and casts no shadows.

On unknown TV GPUs the game starts at **medium** (0.75 render scale, 1024 shadow map) and
steps up or down from measured frame times. The low tier drops shadows. When the host
pauses the app the loop stops, and losing the WebGL context pauses the run. First thing
to do on real hardware: log `WEBGL_debug_renderer_info` and frame times from
`little dev --device` and tune the tiers.

## Project layout

```
src/
  game/      game.ts (state machine, scoring, Little tools), player.ts (rope physics),
             anchors.ts (web targeting), course.ts (hoops, coins, checkpoints)
  view/      arms.ts (IK arms), cameraRig.ts, hud.ts, fx.ts (web line, particles)
  world/     cityLayout.ts (the route), city.ts / buildings.ts (procedural blocks),
             props.ts (GLB loading), traffic.ts, sky.ts, palette.ts
  core/      input.ts, quality.ts, audio.ts, math.ts
  platform/  little.ts (SDK wrapper), little-stub.ts
public/little/manifest.json   tools: start_run, pause_game, resume_game, restart_run, quit_game
tools/blender/                headless Blender scripts (build, adapt, preview)
tools/pipeline/               npm run assets: Blender → glTF-Transform → public/models
assets-src/                   palette.json, third-party packs, editable .blend files
docs/                         asset workflow, research and recommendations
previews/                     reference renders and in-game screenshots
```

## Credits

- Kenney Starter Kits (City Builder, Racing): CC0, https://kenney.nl
- PSX First Person Arms by Drillimpact: CC0, https://drillimpact.itch.io/psx-first-person-arms-free
- Bungee and Fredoka fonts: SIL Open Font License (`public/fonts/OFL-*.txt`)
