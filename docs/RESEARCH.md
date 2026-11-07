# Research: assets, city data, platform

Checked on Nov 7, 2026. Prices and terms change, so re-check a store page before buying.
Anything I couldn't confirm against the product page or the file itself is marked
*unverified*. This is not legal advice.

## 1. First-person arms

No store sells first-person web-shooter or swinging arms. Whichever pack you pick, plan
to key the web-specific poses yourself (shoot web, hang loop, release, wave). The game's
procedural IK covers reaching and swinging, so only static hand poses are strictly required.

| Pack | Price | License | Formats | Size | Rig and clips | Work to fit the look |
|---|---|---|---|---|---|---|
| **[PSX First Person Arms (Drillimpact)](https://drillimpact.itch.io/psx-first-person-arms-free)**, **in use** | Free | CC0 | FBX, GLB, Blend | 1.2k tris (measured after adapting) | Custom arms rig with finger bones; 17 clips: relax, push, jab, grab, guard, finger-gun, knife | Done: `tools/blender/adapt_arms_pack.py` recolors, re-rests and renames automatically |
| [Low World Base Character (silverdelivery)](https://www.fab.com/listings/37262df1-8a7c-41ea-8e65-421f0110b92c) ([female](https://www.fab.com/listings/0a62b7f7-f9f9-4d55-a9ca-7ec0574b013a)) | $4.99 Personal / $5.99 Pro | Fab Standard | fbx, glb, blend | arms 1,112 faces, one 64×64 palette | Generic arms rig, 56 first-person clips (idle, walk, run, jump, attacks, "holding"); finger bones *unverified* | Low: recolor the palette. Web clips need authoring. |
| [Low Poly FPS Arms (Oblix Studio)](https://www.fab.com/listings/6427a301-5358-462b-9fd3-3485691d7088) | $0.99 | Fab Standard | FBX only | 1,086 tris, 4 materials, no textures | Control rig with widget bones, visible finger articulation, 2 clips | Medium: merge materials, strip widgets, bake to deform bones, author clips. One 1-star review. |
| [WRAD ARMS (wriks)](https://wriks.itch.io/wrad-arms) | Free | CC0 | GLB, FBX, OBJ | 1,200 tris, 512² texture | IK armature, no clips | Recolor and author all clips |
| [Flat World Base Characters](https://www.fab.com/listings/be24bcf7-56da-43b1-a57d-3bde00c0d266) | $4.99 / $5.99 | Fab Standard | Blend, glTF | ~1.2k faces, 1 material | Mixamo/humanoid-compatible, no clips | Retarget Mixamo or Quaternius clips, crop to the forearms. Opens up big hang/climb libraries. |
| [Lowpoly FPS Arms, 3D Pixel (POLARRPANDAA)](https://www.fab.com/listings/22de203e-a284-4801-a5c5-08e5a104cd28) | $9.99 / $14.99 | Fab Standard | UE, FBX, glTF | 1,516 tris | Epic UE skeleton with full fingers; no clips in the listing | Replace textures. Fab UE-mannequin animations can be retargeted onto it (needs the Unreal editor). |
| [Customisable Low Poly Male & FPS Arms (Jimbob)](https://marketplace.unity.com/packages/3d/characters/humanoids/humans/customisable-low-poly-male-fps-arms-156624) | $4.99 | Unity EULA | FBX | 604 tris | Generic rig, no clips | Lightest and flat-shaded, but everything must be authored |
| [VR / FPS Cartoon Hands Pack (Gear Worx)](https://assetstore.unity.com/packages/3d/characters/vr-fps-cartoon-hands-pack-114114) | $15 | Unity EULA | *unverified* | *unverified* | Biped rig, 10 clips plus Fist/Grab/Point poses | Medium: drop 4K PBR textures |
| [Animated FPS Hands v3.0 (Averchenkov)](https://assetstore.unity.com/packages/3d/characters/humanoids/animated-fps-hands-v3-0-52266) | $25 | Unity EULA | FBX | 2,350 tris per mesh | Mixamo-like rig, 9 clips (punches, idle, run) | High: realistic style |

Grapple and web packs exist, but none are first-person arms: Kelint
[First Person Grapple Hook](https://www.fab.com/listings/8f957d61-0e20-4e73-8fbd-21e2b9bffdfa)
($19.99, Unreal only) and voxel vision
[Grapple Animation Pack](https://www.fab.com/listings/d4910e07-b3c5-403c-b2d6-e3e90fb6e4bb)
($14.99, third-person).

**Why Drillimpact:**
- CC0 removes the browser-extraction licensing problem entirely.
- It ships as GLB and is tiny.
- Its grab and push clips map directly onto grip and open.
- Side-by-side captures are in `previews/shots/arms-psx.jpg` and `arms-custom.jpg`.

**Extra work flagged:** a dedicated "thwip" web-shooter hand pose and a two-handed pose,
keyed in `assets-src/blender/arms-psx.blend`. Optionally, thicker fingers for couch distance.

## 2. City packs

| Pack | Price | License | Notes |
|---|---|---|---|
| [Kenney City Kit Commercial](https://kenney.nl/assets/city-kit-commercial) / [Roads](https://kenney.nl/assets/city-kit-roads) / [Industrial](https://kenney.nl/assets/city-kit-industrial) / [Suburban](https://kenney.nl/assets/city-kit-suburban) | Free | CC0 | About 210 models sharing one 512² palette texture. Median 112–876 tris. Excellent fit. |
| [Kenney Car Kit](https://kenney.nl/assets/car-kit) | Free | CC0 | 50 vehicles, median about 2k tris (heavy for traffic) |
| [KayKit City Builder Bits](https://kaylousberg.itch.io/city-builder-bits) | Free (extras $3.95+) | CC0 | Chunky buildings, 1.2k-tri cars, traffic lights, hydrants, water tower |
| [Synty SIMPLE Town](https://syntystore.com/products/simple-town-cartoon-assets) | $19.99 | Synty (buy direct, not on the Unity store) | Blocky variety; protect the GLBs |
| [Synty POLYGON City](https://syntystore.com/products/polygon-city-pack) | $19.99 | Synty | Best rooftop clutter (AC units, vents, fire escapes, billboards), more detailed style |
| [ithappy Cartoon City Free](https://www.fab.com/listings/e41364e1-c811-40db-85f5-84441192591d) | Free | Fab Standard | 80 models, rated 5.0 |
| [Mnostva Low Poly City](https://www.fab.com/listings/6aa53b37-da5a-4a93-9c0d-6efd4a12d750) | $9.99 Personal | Fab Standard | The $4.99 tier is UEFN-only, so it's useless for web |
| [Quaternius Downtown City MegaKit](https://quaternius.com/packs/downtowncitymegakit.html) | Free / $14.99 source | CC0 or QAL (check at download) | 315 models, more textured |

**What the game uses:**
- Procedural buildings for the blocks.
- In-house props (`build_props.py`).
- Kenney trucks, trees, fountain and shopfronts, palette-snapped by `flatten_palette.py`.
  The sources are the CC0 [Starter-Kit-City-Builder](https://github.com/KenneyNL/Starter-Kit-City-Builder)
  and [Starter-Kit-Racing](https://github.com/KenneyNL/Starter-Kit-Racing) repos.

### Licensing in a browser game

Web builds ship GLBs that anyone can download, and that matters for paid assets.

| License | OK in a custom three.js game? | Extraction risk |
|---|---|---|
| CC0 (Kenney, KayKit, Drillimpact, WRAD) | Yes | None |
| Fab Standard | Yes, any engine (Personal tier if under $100k revenue) | Must not let end users extract and reuse assets standalone |
| Unity Asset Store EULA | Yes, if incorporated into your product | Not "incorporated" if designed to be extractable |
| Synty (direct) | Yes | Redistribution banned; treat like Fab |
| Mixamo | Yes | Raw files can't be distributed |
| Quaternius | CC0 on pack pages; the site-wide QAL (Aug 2026) bans standalone redistribution | Check at download time |

**Mitigations for paid assets:**
- Merge them into a few bundles.
- Compress them with meshopt.
- Never expose a browsable models folder.

This isn't DRM; the requirement is only that the product isn't designed for extraction.

## 3. Google Maps and real-city data

**Short answer:** Google Maps Platform can't legally feed a "convert the city into our own
low-poly geometry" pipeline, and Google has no games program. Use OpenStreetMap or
Overture for streets and footprints, plus NYC Open Data for New York heights. Hand-model a
few landmarks per city.

### What Google's terms say

The relevant documents are the
[Maps Platform Terms](https://cloud.google.com/maps-platform/terms),
the [Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)
and the [Map Tiles API Policies](https://developers.google.com/maps/documentation/tile/policies).

- **§3.2.3(a) No scraping:** no pre-fetching, storing or bulk-downloading tiles, geocodes,
  roads or places data.
- **§3.2.3(b) No caching:** prohibited, and there's no caching exception for Map Tiles.
  Places, Roads and Geocoding coordinates may be cached for at most 30 days.
- **§3.2.3(c) No derived content:** no tracing roads or buildings, and no 3D models from
  imagery. The 3D Tiles policy bans objects "extracted, traced, or otherwise derived by
  hand or machine" from the tiles. That rules out artists tracing Google imagery too.
- **§3.2.3(e) No mixing:** Google content can't be used with or near a non-Google map.
- **Map Tiles policy:** "Offline uses" and "Geodata extraction" are explicitly prohibited.
- **Children:** §3.2.1(c)(vi) bars apps "directed to children" under COPPA. That's a risk for
  a superhero game.
- **Games program:** the Maps SDK for Unity, Playable Locations and Semantic Tiles
  [shut down on Dec 31, 2022](https://developers.google.com/maps/deprecations). The only
  route is a custom license through Google Sales; whether they'd grant one is *unverified*.

### Pricing

See the [price list](https://developers.google.com/maps/billing-and-pricing/pricing).
Since March 2025, per-SKU free caps replace the old $200 monthly credit.

| SKU | Free per month | Per 1,000 after that |
|---|---|---|
| Photorealistic 3D Tiles | 1,000 | $6.00, falling to $2.40 above 5M |
| 2D Map Tiles | 100,000 | $0.60, falling to $0.045 |
| Dynamic Maps (Maps JS) | 10,000 | $7.00, falling to $0.53 |
| Aerial View | 5,000 | $16.00, falling to $1.20 |
| Places Text Search Pro | 5,000 | $32.00, falling to $2.40 |
| Geocoding | 10,000 | $5.00, falling to $0.38 |

3D Tiles bill per root tileset request, which works out to roughly per session, with a
default quota of 10k per day. At 200k sessions a month that's about **$1,100/month**, and
it would still only be a live, attributed, always-online photoreal display layer. You
couldn't restyle it into flat colors or use it for collision.

### Open alternatives

| Source | License | Cost | Heights | Bake into a commercial game? |
|---|---|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org) via [Geofabrik](https://download.geofabrik.de/) | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) | Free | Sparse globally (about 6% have levels); good in NYC | **Yes:** credit "© OpenStreetMap contributors" and publish your processed dataset (§4.6) |
| [Overture Maps](https://docs.overturemaps.org/guides/buildings/) | ODbL (places: CDLA-P / Apache / CC0) | Free | `height`, `num_floors`, roof fields | **Yes:** same as OSM plus an Overture credit. Easiest tooling (GeoParquet, DuckDB). |
| [Microsoft ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints) | CDLA Permissive 2.0 (previously ODbL) | Free | Partial | **Yes**, for gap-filling only (5–10° rotation error) |
| [Google Open Buildings](https://sites.research.google/gr/open-buildings/) | CC BY 4.0 or ODbL | Free | 2.5D raster | Yes, but no US/EU coverage |
| [NYC Open Data BUILDING](https://github.com/CityOfNewYork/nyc-geo-metadata/blob/main/Metadata/Metadata_BuildingFootprints.md) and the [3D model](https://maps.nyc.gov/download/3dmodel/) | No use restrictions | Free | `HEIGHT_ROOF`, updated weekly | **Yes**, the best NYC height source |
| Cesium OSM Buildings | ion ToS + ODbL | ion plan | Estimated | Only through Clips, with a logo |
| OSM Buildings / ONEGEO | Non-commercial or proprietary | $50+ | Yes | No |
| Mapbox | [Product Terms](https://cdn.prod.website-files.com/609ed46055e27a02ffc0749b/6a60463142f6478d57642594_Mapbox%20Product%20Terms%20(July%2021%2C%202026).pdf) §1.6/§1.9 ban tracing and caching | Metered | In styles | No |

OSM's [attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)
explicitly allow games to credit on a splash screen, credits page or menu. The game build
is most likely a "Produced Work", but have counsel confirm that for GLB meshes.

### Pipeline for a real city (Manhattan example)

1. Download a Geofabrik `.osm.pbf`. Clip it with `osmium extract -b <bbox>` and filter with
   `osmium tags-filter` (buildings, highways, water, parks, landmarks). Add Overture buildings
   (`overturemaps download --bbox … --type=building`) and NYC `BUILDING` joined on BIN.
2. Project to a local east-north-up frame or UTM (never raw Web Mercator: it's 32% too large
   at NYC's latitude). Rotate about 29° so the grid aligns with X and Z.
3. Resolve heights in priority order: NYC `HEIGHT_ROOF`, then OSM `height`, then
   `building:levels` × 3.3 m, then Overture, then Microsoft, then a per-class default.
   Quantize to two-floor steps.
4. Simplify footprints: fix geometry, dissolve row buildings per block, run Douglas–Peucker
   at 1 m, drop slivers, orthogonalize, snap to a 0.5 m grid.
5. Extrude with flat vertex colors from the palette and merge per 256–400 m chunk. Emit
   collision prisms and web-anchor points at roof corners.
6. Compress with glTF-Transform meshopt and stream chunks around the player behind fog.
7. Hand-model 3–6 landmarks per city from your own photos, never Google imagery. Some
   landmarks are trademarked: Empire State Realty Trust licenses the Empire State Building's
   image, so license it or use "inspired-by" designs.

The current game's `src/world/cityLayout.ts` is shaped so a generated layout (avenues,
streets, blocks with heights) can replace the hand-authored one without touching the
renderer.

## 4. Little platform notes

These are the parts of [docs.little.co](https://docs.little.co) that shaped the game.

- **Canvas:** build at 1920×1080. The host scales the whole surface to the panel. Don't
  use `vw`/`vh`. The game renders into a fixed 1920×1080 canvas, and each quality tier sets
  the backbuffer scale (0.6–1.0).
- **Remote:** six trusted `keydown` keys. Directions auto-repeat; Select and Back never do.
  `keyup` is undocumented, which is why every action works with taps alone.
- **Gamepad (`input.gamepad`):** polled via `navigator.getGamepads()`. Without the grant, a
  controller acts as the remote.
- **Motion:** `torso-lateral-lean` exists but is experimental, needs the camera (HTTPS),
  and its range is undocumented. It's a natural "lean to steer" add-on once tested on a TV.
- **Lifecycle:** `onPause` doesn't stop `requestAnimationFrame` for you. The game freezes
  its loop and suspends audio itself. `saveState` holds up to 64 KiB.
- **Hardware:** the docs give no GPU, WebGL version or memory figures. Log
  `WEBGL_debug_renderer_info`, `devicePixelRatio` and frame times from
  `little dev --device` on the first real run.
- **Publishing:** `little domains add/verify` (a token at `/.well-known/little-challenge`),
  then `little publish --url https://…`. In developer mode the TV opens only
  private-network or verified origins.

## 5. Blender setup

- Blender 5.2 is installed at `~/Applications/Blender.app`. `~/.local/bin/blender` is a
  wrapper, and the pipeline also honors `BLENDER=/path`. Any 4.2+ works; the scripts handle
  5.x layered actions.
- Every script runs headless with `--factory-startup`, so user add-ons and preferences don't
  affect builds.
- For hand edits, open the `.blend` files in `assets-src/blender/`, keep the `Color`
  attribute and the single palette material, and re-export with `--from-blend`.
- The glTF exporter settings live in one place (`tools/blender/cc_common.py`): vertex colors
  set to Active, Y-up, no textures, animations as NLA clips.
