# City Crawlers

A first-person web-swinging rhythm game for Little TV, played with your body through the
TV camera. The hero swings down real city streets on a fixed route set to the music; you
shoot each web yourself by punching an arm up and out on the beat, and lean to dodge
girders. Three.js + Vite + TypeScript, built as a Little app (a website plus
`/little/manifest.json`).

## The rooftop

The game opens on a rooftop above the procedural downtown. Portals hang on the buildings
around you, one per city: **Seoul** (Jongno), **New York** (Midtown), **Tokyo**
(Nishi-Shinjuku) and **Los Angeles** (Bunker Hill). One hand is up in the same web-shooter
pose as in play. Raise an arm and the reticle follows it; punch to shoot a web at the
portal it's on. The web zips you through, the screen whites out, and the run starts in
that city. So the menu teaches the move the game uses.

Each portal's label shows the city, its local name or district, and your best score there.
With the remote, Left and Right move the reticle from portal to portal and OK shoots it. A
mouse click shoots wherever the pointer is. A body shot only takes a portal once you've
been tracked for a second and the reticle was already resting on it, so walking into frame
doesn't pick a city by accident.

## The cities

Each city is built from real map data: every building on its real footprint at its real
height, the real street network (divided roads as two carriageways), parks, water and
rail. The route runs down real streets. Data comes from **OpenStreetMap**, packaged by
**Overture Maps** (which merges in building heights from other open sources). It's
rendered in the game's flat-color low-poly style, with a per-city look in
`src/world/cities.ts`: sky and light, wall palettes, street trees (autumn-gold ginkgos in
Seoul, green ones in Tokyo, palms in LA), traffic, signboards (stacked boards in Seoul,
vertical neon in Tokyo), landmark dressing, and a skyline backdrop (the mountains and
N Seoul Tower; Mt Fuji, Tokyo Tower and the Skytree; the Hollywood sign).

Google Maps can't be used for this. Its terms forbid deriving geometry from map data or
imagery, and caching or bulk-downloading it (see `docs/RESEARCH.md` §3).

```bash
python3 -m venv tools/osm/.venv && tools/osm/.venv/bin/pip install duckdb   # once
node tools/osm/fetch.mjs [city…]   # Overture (S3) → tools/osm/cache (not committed)
node tools/osm/build.mjs [city…]   # cache → public/cities/<id>.json (committed, ODbL)
```

Play areas, routes and landmarks are set in `tools/osm/cities.mjs`. You can check a build
at `/tools/osm/preview.html?city=<id>` on the dev server.

## How it plays

| Move | Body | In the city |
|---|---|---|
| Ready pose | fists up by your shoulders (this "loads" each web-shooter) | a white ring around each wrist in the camera view (Get Ready screen) |
| Shoot a web | punch that arm straight up and out, about 45°, on the beat | a ring on a facade ahead, blue with the left-arm glyph or pink with the right; shoot as its outer circle closes onto it |
| Dodge | lean your shoulders left or right | a crane girder swings into the street with an orange chevron board on its face; the chevrons fill in over the last beat and a half and flash white on the beat |

There are no lanes or side panels: every cue lives in the world. Rings appear four beats
ahead, placed (using the camera's own on-time path) up and toward the side of the arm that
shoots them, and the outer approach circle closes over the last two beats. A hit leaves a
web splat with a shockwave and the grade (PERFECT / GREAT / GOOD, with EARLY or LATE) under
the ring; a miss turns the ring grey. Girders show five beats ahead, with the chevrons
marching while you wait. A clean lean carries you through the gap and collects its coins;
a late one is an OUCH and the girder swings.

A shot fires when an armed arm reaches full stretch, pointing out to the side or up (not
down or across the body). Pulling the arm back in re-arms it. A missed web makes the hero
sag and slow, then a recovery web catches up within a couple of beats.

Every city plays the same chart, with webs and dodges mixed together from the start. The
pacing eases in: early cues are 8 beats apart, then 6, then 4 as the song goes on, and
only the last few bars pair two webs 2 beats apart. Every dodge has 4 clear beats around
it, so a shot, a dodge and another shot never come back to back.

The remote never plays the game; it only drives menus (OK, Back, arrows).

### Camera guidance

- **Get Ready screen** (before every run): a live mirror of the camera with your skeleton
  drawn over it, a dashed "stand like this" outline, and the two targets where your fists
  land at full stretch. Steps: find your spot (the box turns green when both raised fists
  fit), then the first time only: shoot right, shoot left (skipping an arm you already
  used on the rooftop), lean left, lean right. After that it's just finding your spot. OK,
  or punching both arms at once, skips ahead once you're tracked. Both arms at once is
  also OK on the pause and results menus.
- **In play**: the city fills the screen and the 3D arms copy yours. A small camera view
  comes up at the bottom center only while your framing needs fixing, and hides again once
  you're back in your spot.
- **Lost you**: if the camera loses you for a moment the song pauses and the mirror comes
  back with what to fix ("Step back", "Move to your left", "Show both hands"). It resumes
  with a 3-2-1 once you're back in your spot.
- **Camera needed**: shown if the camera or pose tracking is refused, with the reason.

## Quick start

```bash
npm install                 # needs NODE_AUTH_TOKEN for @kabletv/little-sdk (see below)
npm run dev                 # http://127.0.0.1:7140 — plays with this Mac's webcam (below)
little dev                  # the Little simulator: Little's own pose service on the webcam
npm run assets              # rebuild every model with Blender (only after editing assets)
```

Node 22+ is required (Little's floor). Without the SDK installed, Vite aliases
`@kabletv/little-sdk` to `src/platform/little-stub.ts`, so the game still runs in a browser.

### Playing on the Mac

In a plain browser there is no Little host, so `src/platform/webcam.ts` stands in for it:
the page asks for the webcam and runs MediaPipe's Pose Landmarker (the "full" model, or
"heavy" with `?accuracy=high`), sending frames in the same shape as Little's
`sense.motion`. The gesture code, the camera mirror and the coaching run unchanged. The
model and its WASM load from Google's and jsDelivr's CDNs on first use. Inside a Little
host (the TV or the simulator) this path is never taken. It's a different tracker from the
TV's, so do final timing and threshold tuning on the TV.

## Run it on the TV (camera)

The television only grants `media.camera` and `sense.motion` to an **https** origin that
your publisher org has verified. A plain LAN address (`little dev --device vim4` with the
default `http://<this-mac>:7140`) loads the game but lands on "Camera needed".

```bash
little org create "<publisher name>"            # once
# serve the dev server over https (e.g. a tunnel to port 7140), then:
little domains add https://<host>
# put the token it prints in public/.well-known/little-challenge (served by Vite)
little domains verify https://<host>
little dev --device vim4 --app-url https://<host>
```

Add the tunnel's hostname to `server.allowedHosts` in `vite.config.ts` so Vite answers it.

On first launch the TV asks for the camera once; that one answer covers the camera picture
and pose tracking.

## Manual steps (yours)

| Step | Why | How |
|---|---|---|
| GitHub token for the SDK | `@kabletv/little-sdk` lives on GitHub Packages | A token with `read:packages`: `export NODE_AUTH_TOKEN=$(gh auth token)` (or a classic PAT), then `npm install`. Already done on this Mac (0.39.1). |
| Little CLI sign-in | simulator, devices, publishing | `little login`, then `little doctor`. Done on this Mac (tae@little.co). |
| JDK 17+ | `little dev` runs a JVM runtime | Present here (OpenJDK 21). The simulator toolchain installs itself on the first `little dev`. |
| Pair the TV | developer mode on the television | TV: Settings → Developer → Pair a computer. Mac: `little device pair <CODE> --name vim4`. Done (vim4). |
| Allow `node` in the macOS firewall | the TV loads the game from this Mac | Accept the prompt the first time `little dev --device` runs. |
| Publisher org + verified https origin | the TV camera, and publishing | See "Run it on the TV" above. Not done yet. |
| Blender 4.2+ | only for rebuilding assets | Installed at `~/Applications/Blender.app` (5.2), wrapper at `~/.local/bin/blender`. Elsewhere: set `BLENDER=/path/to/blender`. |

## Debug flags

| URL flag | Effect |
|---|---|
| `?debug` | exposes `window.game`; on-screen motion readout (rate, latency, framing, per-arm reach/straightness/angle/power, armed state, learned arm length, lean) plus the last hit offsets |
| `?keys` | desk testing without a camera: Q/E shoot left/right webs, A/D lean |
| `?autoplay` | a bot plays every cue perfectly (`?autoplay=miss` drops every fourth); goes straight to a city and never opens the camera |
| `?city=seoul\|nyc\|tokyo\|la` | the city to aim at on the rooftop (with `?autoplay`, the city it plays) |
| `?motionOffset=<ms>` | extra pose latency to subtract from shot times, if hits read consistently late on hardware |
| `?accuracy=high` | ask the pose tracker for its high-accuracy mode (on the Mac: the heavy model) |
| `?quality=low\|medium\|high\|ultra` | lock a quality tier (default: adaptive, starts at medium) |
| `?arms=custom` | the in-house blocky arms instead of the adapted PSX arms pack |
| `?littleDebug` | SDK debug/inspector mode |

On hardware, start with `?debug`: check the motion rate (aim for 25–30 Hz) and latency, then
watch `pow` reach 1.00 as you punch. If shots don't fire, `str` (straightness) or `ang`
(angle, 0° is out to the side, 90° is up) will say why.

## Performance

Measured on the dev Mac at the high tier: about 66 draw calls, about 190k triangles per
frame including the shadow pass, and about 1.2 ms CPU per frame. Static props are baked
into 100 m city chunks so they cull with their block. Traffic is instanced and casts no
shadows.

On unknown TV GPUs the game starts at **medium** (0.75 render scale, 1024 shadow map) and
steps up or down from measured frame times. The low tier drops shadows. When the host
pauses the app the loop stops, and losing the WebGL context pauses the run. The camera
picture is only held while a guide screen is up, so it costs nothing during play.

## Project layout

```
src/
  game/      game.ts (state machine, rooftop, travel, get-ready steps, scoring, Little
             tools), hub.ts (rooftop portals and aiming), subject.ts
  input/     motion.ts (pose → web-shoot and lean gestures, framing checks)
  rhythm/    song.ts (the chart), music.ts (synth + Conductor clock), judge.ts (timing
             windows), route.ts (rails, ring placement), dressing.ts (coins, girders, finish)
  view/      worldCues.ts (rings, girder boards and grade popups in the city), bodyGuide.ts
             (camera mirror and pip), cueStyle.ts (icons, figures), hud.ts, arms.ts (IK arms
             that copy the player), cameraRig.ts, fx.ts
  world/     realCity.ts (a city from map data), cities.ts (each city's look),
             backdrop.ts (skyline ridges and towers), cityLayout.ts / city.ts /
             buildings.ts (the procedural rooftop downtown), collision.ts, props.ts (GLB
             loading), traffic.ts, sky.ts, palette.ts
  core/      input.ts (menus and ?keys), quality.ts, audio.ts, math.ts
  platform/  little.ts (SDK wrapper: motion, camera, tools), webcam.ts (desktop stand-in),
             little-stub.ts
public/little/manifest.json   capabilities: sense.motion, media.camera
public/cities/                processed map data per city (ODbL, see Credits)
tools/osm/                    map data pipeline: cities.mjs, fetch.mjs, build.mjs, preview
tools/blender/                headless Blender scripts (build, adapt, preview)
tools/pipeline/               npm run assets: Blender → glTF-Transform → public/models
assets-src/                   palette.json, third-party packs, editable .blend files
docs/                         asset workflow, research and recommendations
previews/                     reference renders and in-game screenshots
```

## Credits

- Map data © OpenStreetMap contributors, Overture Maps Foundation, available under the
  [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/). Building
  heights and footprints also come from Microsoft ML Buildings, TomTom, USGS Lidar and
  East Asian Buildings (Shi et al. 2023), depending on the city; each city's exact sources
  are in its `public/cities/<id>.json` and are credited on screen during the run. Those
  files are the processed database the ODbL asks us to publish.
- Kenney Starter Kits (City Builder, Racing): CC0, https://kenney.nl
- PSX First Person Arms by Drillimpact: CC0, https://drillimpact.itch.io/psx-first-person-arms-free
- Bungee and Fredoka fonts: SIL Open Font License (`public/fonts/OFL-*.txt`)
