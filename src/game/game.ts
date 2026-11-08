import {
  Color, DirectionalLight, Fog, Group, HemisphereLight, type InstancedMesh, type Material, type Mesh, type MeshBasicMaterial,
  NoToneMapping, type Object3D, PCFShadowMap, PerspectiveCamera, Quaternion, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from "three";

import { TUNING } from "../config";
import { Sfx } from "../core/audio";
import { type Action, Input } from "../core/input";
import { SpringScalar, clamp, damp } from "../core/math";
import { QualityManager, type Tier } from "../core/quality";
import { DEFAULT_AIM, type MotionEvent, MotionInput, aimToward } from "../input/motion";
import type { CameraFeed, LittlePlatform } from "../platform/little";
import { Dressing } from "../rhythm/dressing";
import { type CueRt, HAND_HOLD, Judge, type Judgment } from "../rhythm/judge";
import { Conductor } from "../rhythm/music";
import { BEAM_DELAY, DODGE_OFFSET, Route, newSample } from "../rhythm/route";
import { BEAT, type CueKind, FINISH_BEAT, LEAP_BEAT, RESULTS_BEAT, type Side, buildChart } from "../rhythm/song";
import { ArmsView, type BodyArm } from "../view/arms";
import { CameraRig } from "../view/cameraRig";
import { LEFT_COLOR, RIGHT_COLOR, figureSvg } from "../view/cueStyle";
import { Particles, SpeedLines, WebLine } from "../view/fx";
import { type Hud, type MenuItem } from "../view/hud";
import { WorldCues } from "../view/worldCues";
import { Backdrop } from "../world/backdrop";
import { CITIES, type CityId, type CityStyle, cityById } from "../world/cities";
import { buildCity } from "../world/city";
import { START } from "../world/cityLayout";
import type { CollisionWorld } from "../world/collision";
import { createWorldMaterial } from "../world/materials";
import { pal } from "../world/palette";
import type { PropLibrary } from "../world/props";
import { type CityFile, buildRealCity } from "../world/realCity";
import { Sky } from "../world/sky";
import { Traffic } from "../world/traffic";
import { HUB_ORDER, HUB_PITCH, Hub, armAim, armRaised, camDir } from "./hub";
import type { Subject, SubjectState } from "./subject";

/** hub: the rooftop city select. warp: zipping through a portal to the chosen city. */
type State = "hub" | "warp" | "ready" | "play" | "paused" | "resuming" | "results";

const HUB_SUN = new Vector3(-0.5, 0.85, 0.45).normalize();
const HUB_EYE = new Vector3(START.x, START.y + 1.2, START.z);
const FIRST_CUE_BEAT = 8;
/** After a resume, cues this close (seconds) are waved through: nobody can react that fast. */
const RESUME_GRACE = 0.75;
/** Auto-pause when the player has been out of the camera's view this long (seconds). */
const LOST_PAUSE_AFTER = 1.0;
const RECOVERY_DELAY = 0.3;
/** The camera view only comes up in play when framing needs fixing (seconds off before it shows, fine before it goes). */
const PIP_SHOW_AFTER = 0.25;
const PIP_HIDE_AFTER = 1.5;
const NO_FOCUS: [number, number] = [0, 0];
const BEST_KEY = "cc.best.v2";
/** Seconds ahead an arm starts aiming at its next ring (about when the approach circle shows). */
const AIM_LOOKAHEAD = 1.2;
/** The rooftop reticle follows the remote's choice this long after a press, even with an arm up (seconds). */
const MENU_AIM_HOLD = 2.5;
/** Mouse aim (desk testing) holds this long after the last move (seconds). */
const MOUSE_AIM_HOLD = 4;
/** Body shots on the rooftop count once the camera has followed the player this long (seconds)… */
const HUB_SETTLE = 1;
/** …and only at a portal the arm had the reticle on this recently (seconds). */
const AIMED_WITHIN = 0.6;
/** Both arms shooting this close together is OK on the ready screen and the menus between runs (seconds). */
const BOTH_ARMS_WITHIN = 0.35;
/** Through a portal: the web flies, the zip, the white-out, then the city (seconds). */
const WARP_ZIP_AT = 0.18;
const WARP_ZIP_FOR = 0.95;
const WARP_WHITE_AT = 0.72;
const WARP_ARRIVE_AT = 1.1;

type Best = Partial<Record<CityId, number>>;
type Course = { route: Route; judge: Judge; dressing: Dressing; cues: WorldCues; swingOfCue: Map<number, number> };
/** What's on stage: the rooftop (Downtown) or a city from map data. */
type Venue = {
  id: "hub" | CityId;
  group: Group;
  world: CollisionWorld;
  chunks: Mesh[];
  traffic: Traffic;
  backdrop: Backdrop | null;
  course: Course | null;
  attribution: string;
  dispose(): void;
};
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

type StepId = "frame" | "shootR" | "shootL" | "leanL" | "leanR";
type Step = { id: StepId; label: string; hint: string; done: boolean };
const STEPS: Record<StepId, Omit<Step, "done" | "id">> = {
  frame: { label: "Find your spot", hint: "Back up until the box turns green. Your fists need room above your head." },
  shootR: { label: `Shoot a web <b class="cr">RIGHT</b>`, hint: `Punch your right arm up and out to the <b class="cr">pink</b> dot. No need to lock your elbow.` },
  shootL: { label: `Shoot a web <b class="cl">LEFT</b>`, hint: `Pull back, then punch your left arm out to the <b class="cl">blue</b> dot.` },
  leanL: { label: `Lean <b class="co">LEFT</b>`, hint: "Shift your shoulders over to your left: that's how you dodge." },
  leanR: { label: `Lean <b class="co">RIGHT</b>`, hint: "And over to your right." },
};

/** Free a venue's GPU buffers, leaving what it borrowed (the prop library, the shared world material). */
function disposeTree(root: Object3D, keep: Set<object>) {
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.geometry && !keep.has(m.geometry)) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      if (keep.has(mat)) continue;
      (mat as MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
    if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose();
  });
}

class Rider implements Subject {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  readonly heading = new Vector3(0, 0, -1);
  readonly anchor = new Vector3();
  speed = 0;
  state: SubjectState = "perched";
  steer = 0;
  swingSide = 1;
}

export class Game {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(TUNING.fovBase, 16 / 9, 0.1, 1600);
  private readonly rig: CameraRig;
  private readonly arms: ArmsView;
  private readonly webLine = new WebLine();
  private readonly particles = new Particles();
  private readonly speedLines = new SpeedLines();
  private readonly sky = new Sky();
  private readonly sun = new DirectionalLight(pal("sun"), 1.8);
  private readonly hemi = new HemisphereLight(pal("hemi_sky"), pal("hemi_ground"), 2.0);
  private readonly fog: Fog;
  private readonly material: Material;
  /** Shared geometry and material that venue teardown must leave alone. */
  private readonly borrowed: Set<object>;
  private readonly hub: Hub;
  private readonly hubVenue: Venue;
  /** The one map city kept built (the last one visited). */
  private cityVenue: Venue | null = null;
  private venue: Venue;
  private readonly cityFiles = new Map<CityId, Promise<CityFile>>();
  /** The chosen city, and its course once built (route… are its parts). */
  private city: CityStyle = cityById(HUB_ORDER[0])!;
  private course: Course | null = null;
  private route!: Route;
  private dressing!: Dressing;
  private cues!: WorldCues;
  private judge!: Judge;
  private swingOfCue!: Map<number, number>;
  private readonly sunDir = HUB_SUN.clone();
  private readonly input = new Input();
  private readonly sfx = new Sfx();
  private readonly conductor: Conductor;
  private readonly motion: MotionInput;
  private readonly quality = new QualityManager();
  private readonly rider = new Rider();
  private readonly smp = newSample();
  private readonly ahead = newSample();
  /** Each arm's current aim, eased toward its next ring. */
  private readonly aim = [{ ...DEFAULT_AIM }, { ...DEFAULT_AIM }];

  private state: State = "hub";
  private stateT = 0;
  private best: Best = {};

  // ---- rooftop
  /** The portal the remote has picked (and the reticle rests on when nothing else aims). */
  private hubFocus = 0;
  private hovered = -1;
  /** Arm aiming the reticle (k: 0 left, 1 right), and the arm shown up when nothing aims. */
  private aimArm: 0 | 1 | null = null;
  private shownSide: Side = 1;
  /** Smoothed reticle direction, camera space. */
  private readonly aimCam = camDir(0, 0);
  private menuAimUntil = 0;
  private mouse = { x: 0, y: 0, at: -1e9 };
  /** Seconds the camera has followed the player without a break. */
  private trackedFor = 0;
  /** The last portal an arm held the reticle on, and when (performance.now()). */
  private armHover = { i: -1, at: -1e9 };
  /** A web shot at nothing on the rooftop: where it flies, and until when. */
  private hubWeb: { to: Vector3; until: number } | null = null;
  /** Arms that have shot a web this session: the tutorial skips them. */
  private readonly armsShown = new Set<Side>();
  private tutorialDone = false;
  /** When each arm last shot outside the song (performance.now()), to catch both at once. */
  private readonly lastShot: Record<Side, number> = { [-1]: -1e9, [1]: -1e9 };
  /** Both-arms OK on a menu only after this (performance.now()), so a celebration at the finish doesn't restart. */
  private menuGestureAfter = 0;
  private warp: { portal: number; side: Side; from: Vector3; data: CityFile | null; failed: boolean; white: boolean } | null = null;
  private travelToken = 0;
  /** motion: the camera (the game). keys: ?keys desk testing. auto: ?autoplay. */
  private mode: "motion" | "keys" | "auto" = "motion";
  private last = performance.now();
  private hostPaused = false;

  // ---- run
  private r = 0;
  private rate = 1;
  private lastBeat = 0;
  private slowLeft = 0;
  private readonly sag = new SpringScalar(45, 9);
  private sagTarget = 0;
  private lean = 0;
  private assist: { side: Side; until: number } | null = null;
  private web: { swing: number; recovery: boolean } | null = null;
  private recovery: { swing: number; at: number } | null = null;
  private beamsPassed = 0;
  private leanHeld: { side: Side; since: number } | null = null;
  private graceUntil = -Infinity;
  private finished = false;
  private countShown = 99;
  private coins = 0;
  private lostFor = 0;
  private foundFor = 0;
  private pausedForTracking = false;
  private resumeCount = 0;
  /** Seconds framing has needed help (+) or been fine (-), for the camera view. */
  private pipT = 0;
  private pipShown = false;
  private readonly prevPos = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly tmp3 = new Vector3();
  private readonly tmpQ = new Quaternion();

  // ---- ready / calibration
  private steps: Step[] = [];
  private readyStep = 0;
  private readyDoneAt = -1;
  private readyView = "";

  // ---- camera picture for the mirror
  private feed: CameraFeed | null = null;
  private feedToken = 0;
  private feedPending = false;

  private readonly autoplay = ((v) => (v === null ? null : v || "all"))(new URLSearchParams(location.search).get("autoplay"));
  private readonly debug = new URLSearchParams(location.search).has("debug");
  private debugT = 0;

  constructor(
    stage: HTMLElement,
    private readonly lib: PropLibrary,
    private readonly little: LittlePlatform,
    private readonly hud: Hud,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance", stencil: false });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setSize(1920, 1080, false);
    stage.prepend(this.renderer.domElement);

    const horizon = pal("sky_horizon");
    this.fog = new Fog(horizon.clone(), 160, 500);
    this.scene.fog = this.fog;
    this.scene.background = new Color(horizon);

    const material = createWorldMaterial();
    this.material = material;
    this.borrowed = new Set<object>([material, ...lib.geometries.values()]);
    // The rooftop is the hand-built Downtown: the start roof with buildings all round to hang portals on.
    const downtown = buildCity(material, (type) => lib.geometries.get(type));
    const chunks: Mesh[] = [];
    downtown.group.traverse((o) => {
      if (o.name.startsWith("chunk_")) {
        const m = o as Mesh;
        m.geometry.computeBoundingSphere();
        chunks.push(m);
      }
    });
    this.hub = new Hub(downtown.world, HUB_EYE);
    const hubTraffic = new Traffic(lib, material, downtown.lanes);
    const hubGroup = new Group();
    hubGroup.add(downtown.group, hubTraffic.group, this.hub.group);
    this.hubVenue = {
      id: "hub", group: hubGroup, world: downtown.world, chunks, traffic: hubTraffic, backdrop: null, course: null, attribution: "",
      dispose: () => undefined,
    };
    this.venue = this.hubVenue;
    this.scene.add(hubGroup, this.sky.group, this.webLine.mesh, this.particles.mesh);
    this.loadBest({});
    const asked = cityById(new URLSearchParams(location.search).get("city") ?? "");
    if (asked) this.city = asked;

    this.sun.castShadow = true;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target, this.hemi);

    this.arms = new ArmsView(lib.arms);
    this.arms.scene.add(this.speedLines.group);
    this.rig = new CameraRig(this.camera);
    this.conductor = new Conductor(this.sfx);
    this.motion = new MotionInput(little);

    this.logDevice();
    this.quality.onChange = (t) => this.applyQuality(t);
    this.applyQuality(this.quality.tier);

    if (this.debug) {
      console.info("[downtown]", downtown.stats);
      (window as unknown as { game: Game }).game = this;
    }
    this.wirePlatform();
    this.wireMouse();
    this.toHub();
    this.renderer.compile(this.scene, this.camera);
    if (this.autoplay) void this.travel(this.city);
  }

  // ------------------------------------------------------------------ platform
  private wirePlatform() {
    const L = this.little;
    L.tool("start_run", (args) => {
      if (this.state === "play" || this.state === "resuming") return { ok: false, detail: "A run is already in progress." };
      if (this.state === "warp") return { ok: false, detail: `Already on the way to ${this.city.name}.` };
      const city = args.city === undefined ? this.city : cityById(String(args.city));
      if (!city) return { ok: false, detail: `There is no city "${String(args.city)}": pick one of ${HUB_ORDER.join(", ")}.` };
      // From the rooftop the hero shoots that portal, as the player would.
      if (this.state === "hub") this.shootPortal(this.hub.indexOf(city.id), this.shownSide);
      else void this.travel(city);
    });
    L.tool("go_rooftop", () => {
      if (this.state === "hub" || this.state === "warp") return { ok: false, detail: "Already on the rooftop." };
      this.goRooftop();
    });
    L.tool("pause_game", () => {
      if (this.state !== "play" && this.state !== "resuming") return { ok: false, detail: "Nothing to pause." };
      this.pause();
    });
    L.tool("resume_game", () => {
      if (this.state !== "paused") return { ok: false, detail: "The game is not paused." };
      this.resume();
    });
    L.tool("restart_run", () => {
      if (!this.course || this.state === "hub" || this.state === "warp") return { ok: false, detail: "No run to restart: pick a city first." };
      this.startRun();
    });
    L.tool("quit_game", () => this.quit());
    L.onPause(() => {
      if (this.state === "play" || this.state === "resuming") this.pause();
      this.sfx.suspend();
      this.hostPaused = true;
    });
    L.onResume(() => {
      this.hostPaused = false;
      this.last = performance.now();
      this.sfx.resume();
    });
    this.renderer.domElement.addEventListener("webglcontextlost", () => {
      if (this.state === "play" || this.state === "resuming") this.pause();
    });
    L.onEnter(({ params, state }) => {
      this.loadBest(state);
      const asked = cityById(String(params.city ?? ""));
      if (asked && this.state === "hub") {
        this.city = asked;
        this.focusPortal(this.hub.indexOf(asked.id));
      }
      if (params.start === true && this.state === "hub") this.shootPortal(this.hubFocus, this.shownSide);
    });
  }

  private wireMouse() {
    const c = this.renderer.domElement;
    const at = (e: MouseEvent) => {
      const r = c.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouse.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      this.mouse.at = performance.now();
    };
    c.addEventListener("mousemove", at);
    c.addEventListener("click", (e) => {
      at(e);
      this.sfx.unlock();
      if (this.state === "hub") this.hubShot(this.mouse.x < 0 ? -1 : 1);
    });
  }

  // ------------------------------------------------------------------ cities
  /** Best score per city, from the host's saved state and this browser's. */
  private loadBest(state: unknown) {
    const s = (state ?? {}) as { best?: unknown };
    let local: unknown = null;
    try {
      local = JSON.parse(localStorage.getItem(BEST_KEY) ?? "null");
    } catch {
      local = null;
    }
    for (const src of [s.best, local]) {
      if (!src || typeof src !== "object") continue;
      for (const c of CITIES) this.best[c.id] = Math.max(this.best[c.id] ?? 0, num((src as Best)[c.id]));
    }
  }

  private saveBest() {
    localStorage.setItem(BEST_KEY, JSON.stringify(this.best));
    this.little.saveState({ best: this.best });
  }

  /** A city's map file, fetched once (the rooftop starts them all loading). */
  private loadCity(id: CityId): Promise<CityFile> {
    let p = this.cityFiles.get(id);
    if (!p) {
      p = fetch(`${import.meta.env.BASE_URL}cities/${id}.json`).then((r) => {
        if (!r.ok) throw new Error(`cities/${id}.json: HTTP ${r.status}`);
        return r.json() as Promise<CityFile>;
      });
      p.catch(() => this.cityFiles.delete(id));
      this.cityFiles.set(id, p);
    }
    return p;
  }

  /** Build a city from its map file: streets, buildings, traffic, horizon, and the song's route through it. */
  private buildCityVenue(style: CityStyle, data: CityFile): Venue {
    const rc = buildRealCity(data, style, this.material, this.lib);
    const route = new Route(rc.world, buildChart(), rc.course);
    const course: Course = {
      route,
      judge: new Judge(route.cues),
      dressing: new Dressing(this.lib, this.material, route),
      cues: new WorldCues(route),
      swingOfCue: new Map(route.swings.map((w, i) => [w.cue.id, i])),
    };
    const traffic = new Traffic(this.lib, this.material, rc.lanes, style.traffic, 0.24);
    const backdrop = new Backdrop(style, new Color(style.sky.horizon));
    const group = new Group();
    group.add(rc.group, traffic.group, backdrop.group, course.dressing.group, course.cues.group);
    if (this.debug) console.info(`[city] ${style.id}`, rc.stats, JSON.stringify(route.describe()));
    return {
      id: style.id, group, world: rc.world, chunks: rc.chunks, traffic, backdrop, course, attribution: data.attribution,
      dispose: () => disposeTree(group, this.borrowed),
    };
  }

  /** Put a venue on stage, with its sky, fog and sun. */
  private useVenue(v: Venue) {
    if (this.venue !== v) {
      this.scene.remove(this.venue.group);
      this.scene.add(v.group);
      this.venue = v;
    }
    const style = v.id === "hub" ? null : cityById(v.id)!;
    const top = style ? new Color(style.sky.top) : pal("sky_top");
    const horizon = style ? new Color(style.sky.horizon) : pal("sky_horizon");
    this.sky.setColors(top, horizon);
    this.sky.shoreVisible = !style;
    this.fog.color.copy(horizon);
    (this.scene.background as Color).copy(horizon);
    this.sun.color.copy(style ? new Color(style.sky.sun) : pal("sun"));
    this.sun.intensity = style?.sky.sunIntensity ?? 1.8;
    this.hemi.color.copy(style ? new Color(style.sky.hemiSky) : pal("hemi_sky"));
    this.hemi.groundColor.copy(style ? new Color(style.sky.hemiGround) : pal("hemi_ground"));
    if (style) this.sunDir.set(...style.sky.sunDir).normalize();
    else this.sunDir.copy(HUB_SUN);
    this.hud.setCredit(v.attribution || null);
  }

  /** Into a city (built now if it isn't the one kept), ready to run. */
  private enterCity(style: CityStyle, data: CityFile) {
    if (this.cityVenue?.id !== style.id) {
      const old = this.cityVenue;
      if (old) {
        if (this.venue === old) this.useVenue(this.hubVenue);
        old.dispose();
      }
      this.cityVenue = this.buildCityVenue(style, data);
    }
    const v = this.cityVenue!;
    this.city = style;
    this.course = v.course;
    ({ route: this.route, judge: this.judge, dressing: this.dressing, cues: this.cues, swingOfCue: this.swingOfCue } = v.course!);
    this.useVenue(v);
    // Compile shaders now, behind the fade, rather than on the leap.
    this.cues.prewarm(true);
    this.renderer.compile(this.scene, this.camera);
    this.cues.prewarm(false);
    this.startRun();
  }

  /** Straight to a city from a menu: white out, load, build, run. */
  private async travel(style: CityStyle) {
    const token = ++this.travelToken;
    this.conductor.stop();
    this.hud.close();
    this.hud.fade(1, 300, "#ffffff");
    try {
      const [data] = await Promise.all([this.loadCity(style.id), new Promise((r) => setTimeout(r, 320))]);
      if (token !== this.travelToken) return;
      this.enterCity(style, data);
    } catch (err) {
      console.error(err);
      if (token !== this.travelToken) return;
      this.toHub();
      this.hud.callout(`COULDN'T LOAD ${style.name.toUpperCase()}`, "bad");
    }
    this.hud.fade(0, 450);
  }

  /** Back up to the rooftop to pick another city. */
  private goRooftop() {
    const token = ++this.travelToken;
    this.conductor.stop();
    this.hud.close();
    this.hud.fade(1, 260);
    setTimeout(() => {
      if (token !== this.travelToken) return;
      this.toHub();
      this.hud.fade(0, 400);
    }, 280);
  }

  private setTools(names: string[]) {
    this.little.setActiveTools(names);
  }

  // ------------------------------------------------------------------ rooftop
  /** The rooftop: portals to every city on the buildings around, an arm up to aim at them. */
  private toHub() {
    this.travelToken++;
    this.state = "hub";
    this.stateT = 0;
    this.warp = null;
    this.conductor.stop();
    this.resetRun();
    this.useVenue(this.hubVenue);
    this.placeHubRider();
    this.rig.perchPitch = HUB_PITCH;
    this.rig.snap(this.rider);
    this.rig.pitch = HUB_PITCH;
    this.rig.idleSway = 0;
    this.hud.showRunHud(false);
    this.hud.hideGuide();
    this.hud.setHint(null);
    this.hud.setPrompt(null);
    this.hud.setCenter(null);
    this.closeCamera();
    // The rooftop is aimed with the body, so the camera watches from here on (autoplay plays itself).
    if (!this.autoplay) this.motion.start();
    this.resetAim();
    this.aimArm = null;
    this.hubFocus = Math.max(0, this.hub.indexOf(this.city.id));
    this.aimCam.copy(this.hubDirOf(this.hubFocus));
    this.showHubMenu();
    this.setTools(["start_run", "quit_game"]);
    for (const id of HUB_ORDER) this.loadCity(id).catch(() => undefined);
  }

  private showHubMenu() {
    const items: MenuItem[] = this.hub.portals.map((p, i) => {
      const best = this.best[p.city.id] ?? 0;
      const sub = [p.city.local ?? p.city.area, best > 0 ? `best ${best.toLocaleString("en-US")}` : ""].filter(Boolean).join(" · ");
      return {
        id: p.city.id,
        label: p.city.name,
        html: `<span class="city-name"><i style="background:${p.city.color}"></i>${p.city.name}</span><small>${sub}</small>`,
        action: "start_run",
        onSelect: () => this.shootPortal(i, this.shownSide),
      };
    });
    this.hud.showHub(items, this.hubFocus, "Cities built from OpenStreetMap data © OpenStreetMap contributors, via Overture Maps");
  }

  private placeHubRider() {
    const rd = this.rider;
    rd.pos.set(START.x, START.y + 0.9, START.z);
    rd.vel.set(0, 0, 0);
    rd.speed = 0;
    rd.heading.set(0, 0, -1);
    rd.steer = 0;
    rd.state = "perched";
  }

  /** Camera-space direction to a portal from the rooftop view. */
  private hubDirOf(i: number) {
    this.camera.updateMatrixWorld();
    return this.camera.worldToLocal(this.tmp.copy(this.hub.portals[i].center)).normalize();
  }

  private focusPortal(i: number) {
    if (i < 0) return;
    this.hubFocus = i;
    this.hud.menu.setFocus(i);
  }

  /**
   * Aim from, in order: an arm the player holds up, the remote's last pick (for a moment),
   * the mouse (desk testing), else the remote's pick.
   */
  private updateHub(dt: number, now: number) {
    const m = this.motion;
    const live = m.tracking;
    const raised = ([0, 1] as const).filter((k) => live && armRaised(m.arms[k]));
    if (this.aimArm === null || !raised.includes(this.aimArm)) {
      this.aimArm = raised.length ? raised.reduce((a, b) => (m.arms[b].reach > m.arms[a].reach ? b : a)) : null;
    }
    let goal: Vector3;
    let source: "arm" | "menu" | "mouse";
    if (this.aimArm !== null && now / 1000 > this.menuAimUntil) {
      const side: Side = this.aimArm === 0 ? -1 : 1;
      const { yaw, el } = armAim(side, m.arms[this.aimArm].angle);
      goal = camDir(yaw, el, this.tmp2);
      source = "arm";
      this.shownSide = side;
    } else if (now - this.mouse.at < MOUSE_AIM_HOLD * 1000 && now / 1000 > this.menuAimUntil) {
      goal = this.tmp2.set(this.mouse.x, this.mouse.y, 0.5).unproject(this.camera).sub(this.camera.position);
      goal.applyQuaternion(this.tmpQ.copy(this.camera.quaternion).invert()).normalize();
      source = "mouse";
      this.shownSide = this.mouse.x < 0 ? -1 : 1;
    } else {
      goal = this.tmp2.copy(this.hubDirOf(this.hubFocus));
      source = "menu";
    }
    this.aimCam.lerp(goal, 1 - Math.exp(-(source === "arm" ? 14 : 20) * dt)).normalize();
    const aimWorld = this.tmp3.copy(this.aimCam).applyQuaternion(this.camera.quaternion);
    const hovered = this.hub.pick(this.camera.position, aimWorld);
    if (hovered !== this.hovered && hovered >= 0) this.sfx.ui("move");
    this.hovered = hovered;
    this.trackedFor = live ? this.trackedFor + dt : 0;
    if (source === "arm" && hovered >= 0) this.armHover = { i: hovered, at: now };
    if (source !== "menu" && hovered >= 0 && hovered !== this.hubFocus) this.focusPortal(hovered);
    this.hub.update(dt, hovered);
    this.arms.setHub(this.shownSide, this.aimCam);
    this.showReticle(aimWorld, hovered);

    for (const e of m.drain()) if (e.type === "shoot") this.hubShot(e.side, true);
    if (this.hubWeb && now > this.hubWeb.until) this.hubWeb = null;
    if (!this.hubWeb && !this.web) this.webLine.hide();

    let prompt: string;
    const hoverName = hovered >= 0 ? this.hub.portals[hovered].city.name : "";
    if (source === "arm") prompt = hovered >= 0 ? `Punch to shoot a web at <b>${hoverName}</b>!` : "Aim at a portal";
    else if (live) prompt = "Raise an arm to aim at a city, then punch to shoot a web";
    else if (m.available) prompt = "Step in front of the camera, then raise an arm to aim";
    else prompt = `Pick a city and press <b>OK</b> to shoot a web at it`;
    this.hud.setHubPrompt(prompt);
    this.hud.showPip(m.available);
    if (m.available) this.hud.pip.draw(m, NO_FOCUS, now);
  }

  /** The reticle on screen, where the aim meets the portal wall. */
  private showReticle(aimWorld: Vector3, hovered: number) {
    const p = this.tmp.copy(this.camera.position).addScaledVector(aimWorld, 40).project(this.camera);
    if (p.z > 1) {
      this.hud.setReticle(null);
      return;
    }
    this.hud.setReticle({ x: (p.x + 1) * 960, y: (1 - p.y) * 540 }, hovered >= 0 ? this.hub.portals[hovered].city.color : null);
  }

  /**
   * A web from the rooftop. With a body shot the arm's own direction decides; otherwise
   * the reticle does. On a portal it's the trip there; on nothing it just flies.
   */
  private hubShot(side: Side, body = false) {
    if (this.state !== "hub") return;
    // Someone just stepping in, or passing by, mustn't pick a city by accident.
    if (body && this.trackedFor < HUB_SETTLE) return;
    this.armsShown.add(side);
    let dir = this.tmp3.copy(this.aimCam);
    const k = side < 0 ? 0 : 1;
    if (body) {
      const { yaw, el } = armAim(side, this.motion.arms[k].angle);
      dir = camDir(yaw, el, this.tmp3);
      this.menuAimUntil = 0;
    }
    this.shownSide = side;
    const world = dir.applyQuaternion(this.camera.quaternion);
    let i = this.hub.pick(this.camera.position, world);
    // A body shot only takes a portal the reticle was already resting on.
    if (body && !(i >= 0 && this.armHover.i === i && performance.now() - this.armHover.at < AIMED_WITHIN * 1000)) i = -1;
    if (i >= 0) {
      this.shootPortal(i, side);
      return;
    }
    this.sfx.thwip();
    this.arms.puff(side);
    this.arms.flick(side);
    this.webLine.shoot(true);
    this.hubWeb = { to: this.camera.position.clone().addScaledVector(world, 60), until: performance.now() + 260 };
  }

  /** Shoot the portal and go: the web, the zip toward it, a white-out, then the city. */
  private shootPortal(i: number, side: Side) {
    if (this.state !== "hub" || i < 0) return;
    const p = this.hub.portals[i];
    this.sfx.unlock();
    this.sfx.thwip();
    this.sfx.attach();
    this.arms.puff(side);
    this.arms.flick(side);
    this.shownSide = side;
    this.focusPortal(i);
    this.aimCam.copy(this.hubDirOf(i));
    this.arms.setHub(side, this.aimCam);
    this.city = p.city;
    this.hud.close();
    this.hud.setReticle(null);
    this.hud.showPip(false);
    this.hubWeb = { to: p.center.clone(), until: Infinity };
    this.webLine.shoot();
    this.rig.addKick(0.8);
    this.state = "warp";
    this.stateT = 0;
    this.setTools([]);
    const warp = { portal: i, side, from: this.rider.pos.clone(), data: null as CityFile | null, failed: false, white: false };
    this.warp = warp;
    this.loadCity(p.city.id).then(
      (d) => (warp.data = d),
      (err) => {
        console.error(err);
        warp.failed = true;
      },
    );
  }

  private updateWarp(dt: number) {
    const w = this.warp!;
    const p = this.hub.portals[w.portal];
    const t = this.stateT;
    this.hub.update(dt, w.portal, w.portal);
    // Zip along the web, accelerating, and turn to look straight through the portal.
    const u = clamp((t - WARP_ZIP_AT) / WARP_ZIP_FOR, 0, 1);
    const to = this.tmp.subVectors(p.center, w.from);
    const rd = this.rider;
    this.prevPos.copy(rd.pos);
    rd.pos.copy(w.from).addScaledVector(to, 0.92 * u * u * u);
    if (dt > 0) rd.vel.subVectors(rd.pos, this.prevPos).divideScalar(dt);
    rd.speed = rd.vel.length();
    rd.heading.set(to.x, 0, to.z).normalize();
    this.rig.perchPitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
    this.arms.setHub(w.side, this.hubDirOf(w.portal));
    if (t > WARP_WHITE_AT && !w.white) {
      w.white = true;
      this.hud.fade(1, 320, "#ffffff");
      this.sfx.whoosh();
    }
    if (w.failed) {
      this.toHub();
      this.hud.fade(0, 300);
      this.hud.callout(`COULDN'T LOAD ${p.city.name.toUpperCase()}`, "bad");
      return;
    }
    if (t > WARP_ARRIVE_AT && w.data) {
      this.warp = null;
      this.hubWeb = null;
      this.webLine.hide();
      this.enterCity(p.city, w.data);
      this.hud.fade(0, 500);
    }
  }

  // ------------------------------------------------------------------ states
  private resetRun() {
    this.webLine.hide();
    this.setPip(false);
    if (!this.course) return;
    this.judge.reset();
    this.dressing.reset();
    this.cues.reset();
    this.r = 0;
    this.rate = 1;
    this.lastBeat = 0;
    this.slowLeft = 0;
    this.sag.value = this.sag.velocity = 0;
    this.sagTarget = 0;
    this.lean = 0;
    this.assist = null;
    this.web = null;
    this.recovery = null;
    this.beamsPassed = 0;
    this.leanHeld = null;
    this.graceUntil = -Infinity;
    this.finished = false;
    this.countShown = 99;
    this.coins = 0;
    this.lostFor = 0;
    this.pausedForTracking = false;
  }

  private setPip(on: boolean) {
    this.pipShown = on;
    this.pipT = 0;
    this.hud.showPip(on);
  }

  /**
   * Get ready on the city's start roof: the camera mirror, finding your spot and, the
   * first time, a quick go at the moves the rooftop didn't already teach. Then the song.
   */
  private startRun() {
    if (!this.course) return;
    this.travelToken++;
    this.sfx.unlock();
    this.hud.close();
    this.hud.setReticle(null);
    this.conductor.stop();
    this.resetRun();
    this.arms.setHub(null);
    this.hubWeb = null;
    this.placeRider(0, 0);
    this.rig.perchPitch = -0.12;
    this.rig.snap(this.rider);
    this.rig.idleSway = 0;
    this.hud.showRunHud(false);
    this.hud.setPrompt(null);
    this.hud.setHint(null);
    this.hud.setCenter(null);
    this.mode = this.autoplay ? "auto" : "motion";
    this.state = "ready";
    this.stateT = 0;
    this.readyStep = 0;
    this.readyDoneAt = -1;
    const ids: StepId[] = ["frame"];
    if (!this.tutorialDone) {
      if (!this.armsShown.has(1)) ids.push("shootR");
      if (!this.armsShown.has(-1)) ids.push("shootL");
      ids.push("leanL", "leanR");
    }
    this.steps = ids.map((id) => ({ id, ...STEPS[id], done: false }));
    this.setTools(["start_run", "go_rooftop", "quit_game"]);
    if (this.autoplay) {
      this.beginPlay();
      return;
    }
    this.motion.start();
    this.openCamera();
    this.readyView = "";
    this.renderReady();
  }

  /** The camera never came up: say so plainly (there is no other way to play). */
  private get cameraBlocked() {
    return this.motion.state === "unavailable" || this.motion.state === "off";
  }

  private renderReady() {
    if (this.cameraBlocked) {
      const why = this.motion.reason ? `<small>(${this.motion.reason})</small>` : "";
      this.hud.showGuide({
        title: "CAMERA NEEDED",
        side: `<div class="guide-msg"><b>City Crawlers is played with your body.</b>
          <p>The TV camera watches your arms and leans. Allow the camera for City Crawlers, then press OK to try again.</p>${why}</div>`,
        footer: this.input.keys
          ? "<kbd>OK</kbd> play with the keyboard &nbsp; <kbd>BACK</kbd> rooftop"
          : "<kbd>OK</kbd> try again &nbsp; <kbd>BACK</kbd> rooftop",
        data: { camera: "unavailable", reason: this.motion.reason },
      });
      return;
    }
    const cur = this.steps[this.readyStep];
    const all = this.readyStep >= this.steps.length;
    const now = all
      ? `<div class="step-now done"><i class="step-fig">${figureSvg("frame")}</i><div><b>You're ready!</b><p>Here comes the song.</p></div></div>`
      : `<div class="step-now"><i class="step-fig">${figureSvg(cur.id)}</i><div><b>${cur.label}</b><p>${cur.hint}</p></div></div>`;
    const list = this.steps
      .map((s, i) => `<li class="${s.done ? "done" : i === this.readyStep ? "cur" : ""}">${s.label}</li>`)
      .join("");
    this.hud.showGuide({
      title: `${this.city.name.toUpperCase()} · ${this.city.area.toUpperCase()}`,
      side: `${now}<ol class="steps">${list}</ol>`,
      footer: `<kbd>OK</kbd> or punch both arms: ${this.steps.length > 1 ? "skip the tutorial" : "start"} &nbsp; <kbd>BACK</kbd> rooftop`,
      data: { steps: this.steps.map((s) => ({ step: s.label.replace(/<[^>]+>/g, ""), done: s.done })) },
    });
  }

  private updateReady() {
    const m = this.motion;
    const events = m.drain();
    // Re-render when the camera comes up or goes away.
    const view = this.cameraBlocked ? "blocked" : "steps";
    if (view !== this.readyView) {
      this.readyView = view;
      this.renderReady();
    }
    if (view === "blocked" || this.readyStep >= this.steps.length) {
      if (this.readyDoneAt >= 0 && this.stateT - this.readyDoneAt > 0.9) this.beginPlay();
      return;
    }
    if (events.some((e) => this.bothArms(e))) {
      this.sfx.thwip();
      for (const side of [-1, 1] as const) {
        this.arms.puff(side);
        this.arms.flick(side);
      }
      this.readyOk();
      return;
    }
    const id = this.steps[this.readyStep].id;
    if (id === "frame") {
      if (m.framed && m.framingOkFor > 1) {
        m.calibrateLean();
        this.advanceReady();
      }
    } else {
      for (const e of events) {
        const ok =
          (e.type === "shoot" && ((id === "shootR" && e.side === 1) || (id === "shootL" && e.side === -1))) ||
          (e.type === "lean" && ((id === "leanL" && e.side === -1) || (id === "leanR" && e.side === 1)));
        if (ok) {
          if (e.type === "shoot") this.thwipFeedback(e.side);
          this.advanceReady();
          break;
        }
      }
    }
  }

  private advanceReady() {
    if (this.readyStep >= this.steps.length) return;
    this.steps[this.readyStep].done = true;
    this.sfx.tick(this.readyStep);
    this.readyStep++;
    if (this.readyStep >= this.steps.length) {
      this.readyDoneAt = this.stateT;
      this.tutorialDone = true;
    }
    this.renderReady();
  }

  /** True when this shot and one from the other arm land together: the body's OK. */
  private bothArms(e: MotionEvent): boolean {
    if (e.type !== "shoot") return false;
    this.lastShot[e.side] = e.t;
    if (Math.abs(e.t - this.lastShot[e.side === 1 ? -1 : 1]) > BOTH_ARMS_WITHIN * 1000) return false;
    this.lastShot[-1] = this.lastShot[1] = -1e9;
    return true;
  }

  /** A shot outside the song (tutorial): the sound and the 3D arm, no web. */
  private thwipFeedback(side: Side) {
    this.sfx.thwip();
    this.arms.puff(side);
    this.arms.flick(side);
  }

  /** Which targets to light in the camera view during setup. */
  private readyFocus(): [number, number] {
    const id = this.steps[this.readyStep]?.id;
    const pulse = 0.55 + 0.45 * Math.sin(this.stateT * 6);
    if (this.state === "ready" && id === "shootR") return [0, pulse];
    if (this.state === "ready" && id === "shootL") return [pulse, 0];
    return [0, 0];
  }

  private beginPlay() {
    if (this.mode !== "auto") {
      if (this.motion.tracking) this.mode = "motion";
      else if (this.input.keys) this.mode = "keys";
      else return;
    }
    this.sfx.unlock();
    this.hud.hideGuide();
    this.closeCamera();
    this.resetRun();
    this.state = "play";
    this.stateT = 0;
    this.hud.showRunHud(true);
    this.hud.setStats(0, 0, 1, 1);
    this.hud.setHint(this.runHint());
    this.resetAim();
    this.conductor.start(-0.3);
    this.setTools(["pause_game", "restart_run", "quit_game"]);
    this.little.emit("run_started", { city: this.city.id, input: this.mode, cues: this.judge.rts.filter((rt) => !rt.cue.auto).length });
  }

  /** What to do, shown over the opening bars. */
  private runHint() {
    const name = `<span><b>${this.city.name}</b></span>`;
    if (this.mode === "keys") return `${name}<span><kbd>Q</kbd><kbd>E</kbd>webs</span><span><kbd>A</kbd><kbd>D</kbd>leans</span>`;
    if (this.mode !== "motion") return null;
    return `${name}<span>Punch at each ring <b>when its circle locks on</b></span><span>Lean where the <b class="co">arrows</b> point</span>`;
  }

  private pause(forTracking = false) {
    if (this.state !== "play" && this.state !== "resuming") return;
    this.conductor.pause();
    this.state = "paused";
    this.pausedForTracking = forTracking;
    this.foundFor = 0;
    this.sfx.setWind(0);
    this.hud.setCenter(null);
    if (forTracking) this.showLostGuide();
    else this.showPauseMenu();
    this.setTools(["resume_game", "restart_run", "go_rooftop", "quit_game"]);
  }

  private showPauseMenu() {
    this.hud.hideGuide();
    this.closeCamera();
    this.menuGestureAfter = performance.now() + 600;
    this.hud.showPause([
      { id: "resume", label: "Resume", action: "resume_game", onSelect: () => this.resume() },
      { id: "restart", label: "Restart", action: "restart_run", onSelect: () => this.startRun() },
      { id: "rooftop", label: "Rooftop", action: "go_rooftop", onSelect: () => this.goRooftop() },
      { id: "quit", label: "Quit", action: "quit_game", onSelect: () => this.quit() },
    ]);
  }

  /** Lost the player: show them the mirror until they are back in their spot. */
  private showLostGuide() {
    this.hud.close();
    this.setPip(false);
    this.openCamera();
    this.hud.showGuide({
      title: "STEP BACK INTO VIEW",
      side: `<div class="guide-msg"><b>We lost sight of you.</b>
        <p>Stand where the box turns green, fists up, and the song picks up where it stopped.</p></div>`,
      footer: "<kbd>BACK</kbd> menu",
      data: { lost: true },
    });
  }

  /** Resume with a beat-long 3-2-1 so the next cue is always makeable. */
  private resume() {
    if (this.state !== "paused") return;
    this.sfx.unlock();
    this.hud.close();
    this.hud.hideGuide();
    this.closeCamera();
    this.hud.setPrompt(null);
    this.pausedForTracking = false;
    this.state = "resuming";
    this.stateT = 0;
    this.resumeCount = 4;
    this.last = performance.now();
    this.setTools(["pause_game", "restart_run", "quit_game"]);
  }

  private updateResuming() {
    const n = 3 - Math.floor(this.stateT / BEAT);
    if (n !== this.resumeCount) {
      this.resumeCount = n;
      if (n > 0) {
        this.hud.setCenter(String(n));
        this.sfx.countdown(false);
      } else {
        this.hud.setCenter(null);
        this.conductor.resume();
        this.graceUntil = this.conductor.songTime() + RESUME_GRACE;
        this.state = "play";
        this.lastBeat = this.conductor.beat();
      }
    }
  }

  private quit() {
    this.conductor.stop();
    this.closeCamera();
    this.motion.close();
    this.little.exit();
    if (this.little.isStub) this.toHub();
  }

  // ------------------------------------------------------------------ camera picture
  /** The mirror's live picture. Only held while a guide is up: the city needs the TV's attention in play. */
  private openCamera() {
    if (this.feed || this.feedPending) return;
    const token = ++this.feedToken;
    this.feedPending = true;
    void this.little.camera().then((feed) => {
      if (token !== this.feedToken) {
        feed.stop();
        return;
      }
      this.feedPending = false;
      this.feed = feed;
      if (feed.stream) this.hud.mirror.setStream(feed.stream);
      else console.info(`[camera] no picture: ${feed.reason}`);
    });
  }

  private closeCamera() {
    this.feedToken++;
    this.feedPending = false;
    this.feed?.stop();
    this.feed = null;
    this.hud.mirror.setStream(null);
  }

  private endRun() {
    this.state = "results";
    this.sfx.setWind(0);
    const j = this.judge;
    const acc = j.accuracy;
    const grade = acc >= 0.95 ? "S" : acc >= 0.85 ? "A" : acc >= 0.7 ? "B" : acc >= 0.55 ? "C" : "D";
    const stars = acc >= 0.85 ? 3 : acc >= 0.65 ? 2 : 1;
    const final = j.score;
    const city = this.city;
    const newBest = final > (this.best[city.id] ?? 0);
    if (newBest) {
      this.best[city.id] = final;
      this.saveBest();
    }
    this.hud.showRunHud(false);
    this.setPip(false);
    this.hud.setHint(null);
    this.hud.setPrompt(null);
    // The camera keeps watching: both arms at once is OK on the results menu.
    this.menuGestureAfter = performance.now() + 1500;
    const n = (v: number) => v.toLocaleString("en-US");
    const rows: Array<[string, string]> = [
      ["Accuracy", `${(acc * 100).toFixed(1)}%`],
      ["Max combo", n(j.maxCombo)],
      ["Perfect · Great · Good", `${j.counts.perfect} · ${j.counts.great} · ${j.counts.good}`],
      ["Missed", n(j.counts.miss)],
      ["Dodge coins", n(this.coins)],
    ];
    const items: MenuItem[] = [
      { id: "again", label: "Play again", action: "restart_run", onSelect: () => this.startRun() },
      { id: "rooftop", label: "Rooftop", action: "go_rooftop", onSelect: () => this.goRooftop() },
    ];
    this.hud.showResults(
      { heading: `${city.name.toUpperCase()} COMPLETE`, score: final, best: this.best[city.id] ?? final, newBest, stars, grade, rows },
      items,
    );
    this.setTools(["start_run", "restart_run", "go_rooftop", "quit_game"]);
    this.little.emit("run_finished", {
      city: city.id, score: final, grade, stars, accuracy: Math.round(acc * 1000) / 10, maxCombo: j.maxCombo, ...j.counts,
      input: this.mode,
    });
  }

  // ------------------------------------------------------------------ input
  private handleInput() {
    const presses = this.input.drainPresses();
    for (const ev of this.input.drain()) {
      if (ev.type !== "down") continue;
      this.sfx.unlock();
      if (this.hud.menuOpen) {
        this.menuInput(ev.action);
        continue;
      }
      if (this.state === "ready") {
        if (ev.action === "select") this.readyOk();
        else if (ev.action === "back") this.goRooftop();
      } else if ((this.state === "play" || this.state === "resuming") && ev.action === "back") {
        this.pause();
      } else if (this.state === "paused" && ev.action === "back") {
        this.showPauseMenu();
      }
    }
    if (this.state === "hub") {
      // Desk testing: Q / E shoot the left / right arm at whatever the reticle is on.
      for (const p of presses) if (p.kind === "hand") this.hubShot(p.side);
      return;
    }
    if (this.state !== "play") {
      // Between runs the only gesture is both arms at once, as OK on a menu (the ready screen reads its own).
      if (this.state !== "ready") {
        const ok = this.motion.drain().some((e) => this.bothArms(e));
        const menu = this.hud.menuOpen && (this.state === "results" || this.state === "paused");
        if (ok && menu && performance.now() > this.menuGestureAfter) {
          this.sfx.ui("select");
          this.hud.menu.activate();
        }
      }
      return;
    }
    if (this.mode === "keys") for (const p of presses) this.onPress(p.kind, p.side, p.time);
    for (const e of this.motion.drain()) {
      if (this.mode !== "motion") continue;
      if (e.type === "shoot") {
        this.onPress("hand", e.side, e.t);
      } else if (e.type === "lean") {
        const hit = this.onPress("lean", e.side, e.t);
        this.leanHeld = hit ? null : { side: e.side, since: this.conductor.songTime(e.t) };
      } else this.leanHeld = null;
    }
  }

  private menuInput(a: Action) {
    const step = a === "up" || a === "left" ? -1 : a === "down" || a === "right" ? 1 : 0;
    if (step) {
      this.hud.menu.move(step);
      this.sfx.ui("move");
      if (this.state === "hub") {
        // The remote moves the reticle to the next portal over.
        this.hubFocus = (this.hubFocus + step + this.hub.portals.length) % this.hub.portals.length;
        this.menuAimUntil = performance.now() / 1000 + MENU_AIM_HOLD;
      }
    } else if (a === "select") {
      this.sfx.ui("select");
      this.hud.menu.activate();
    } else if (a === "back") {
      this.sfx.ui("back");
      if (this.state === "paused") this.resume();
      else if (this.state === "results") this.goRooftop();
      else if (this.state === "hub") this.quit();
    }
  }

  /** OK on the ready screen: retry a refused camera, or skip the tutorial once we can see you. */
  private readyOk() {
    if (this.cameraBlocked) {
      if (this.input.keys) {
        this.beginPlay();
        return;
      }
      this.motion.close();
      this.motion.start();
      this.closeCamera();
      this.openCamera();
      this.readyView = "";
      return;
    }
    if (this.motion.tracking) {
      this.motion.calibrateLean();
      this.beginPlay();
    } else {
      this.hud.callout("STEP INTO VIEW FIRST", "info");
    }
  }

  private onPress(kind: CueKind, side: Side, perfTime: number): boolean {
    const t = this.conductor.songTime(perfTime);
    const j = this.judge.input(kind, side, t);
    // Every web that registers flares at the wrist at once, so the player knows the punch counted.
    if (kind === "hand") this.arms.puff(side);
    if (j) this.onJudged(j);
    else if (kind === "hand") this.whiff(side, t);
    return !!j;
  }

  /** A web that registered but had no ring to hit: still a shot, and the ring it was meant for says why. */
  private whiff(side: Side, t: number) {
    this.sfx.thwip();
    this.arms.flick(side);
    let mine: CueRt | null = null, other: CueRt | null = null;
    for (const rt of this.judge.rts) {
      if (rt.time > t + 1.5) break;
      if (rt.state !== "pending" || rt.cue.auto || rt.cue.kind !== "hand") continue;
      if (rt.cue.side === side) mine ??= rt;
      else if (Math.abs(rt.time - t) < HAND_HOLD + 0.1) other ??= rt;
    }
    if (other && (!mine || Math.abs(other.time - t) < mine.time - t)) this.cues.nudge(other, "OTHER ARM");
    else if (mine && mine.time > t) this.cues.nudge(mine, "EARLY");
  }

  // ------------------------------------------------------------------ judgments
  private onJudged(j: Judgment) {
    const cue = j.rt.cue;
    this.cues.judged(j);
    if (j.grade !== "miss" && j.multiplier > 1 && j.combo === (j.multiplier - 1) * 8) this.hud.callout(`x${j.multiplier} COMBO!`, "good");
    if (cue.kind === "hand") {
      const swing = this.swingOfCue.get(cue.id)!;
      if (j.grade === "miss") {
        this.missHand(swing);
        this.sfx.fizzle();
      } else {
        this.fireWeb(swing, false);
        this.sfx.thwip();
        this.sfx.attach();
        this.rig.addKick(j.grade === "perfect" ? 0.8 : 0.5);
        const w = this.route.swings[swing];
        const color = new Color(cue.side < 0 ? LEFT_COLOR : RIGHT_COLOR);
        this.particles.burst(w.anchor, j.grade === "perfect" ? 22 : 12, [pal("web"), color], { speed: 9, size: 0.5, gravity: 4, up: 0 });
      }
    } else if (j.grade !== "miss") {
      this.assist = { side: cue.side, until: cue.beat + BEAM_DELAY + 0.8 };
      this.sfx.whoosh();
    }
  }

  private fireWeb(swing: number, recovery: boolean) {
    const w = this.route.swings[swing];
    this.web = { swing, recovery };
    this.rider.anchor.copy(w.anchor);
    this.rider.swingSide = w.cue.side;
    this.webLine.shoot(recovery);
    this.arms.onAttach(w.cue.side);
    if (this.recovery && this.recovery.swing <= swing) this.recovery = null;
  }

  private releaseWeb() {
    if (!this.web) return;
    this.web = null;
    this.webLine.hide();
    this.arms.onRelease();
  }

  /** A missed web: drop, slow down, and a grey recovery web catches you. */
  private missHand(swing: number) {
    this.sagTarget = -TUNING.missSag;
    this.slowLeft = TUNING.slowBeats;
    this.recovery = { swing, at: this.conductor.songTime() + RECOVERY_DELAY };
    this.releaseWeb();
  }

  private bonk(beam: number) {
    const b = this.route.beams[beam];
    this.dressing.knock(beam);
    this.sfx.bonk();
    this.rig.addTrauma(0.55);
    this.hud.flash("rgba(255,60,80,0.9)", 0.5);
    this.cues.say("OUCH!", "bad", this.aheadOfRider(9, 0), { px: 120 });
    this.slowLeft = TUNING.slowBeats;
    this.sag.velocity -= 9;
    this.particles.burst(this.tmp.copy(b.pos).setY(b.pos.y + 0.3), 12, [pal("hazard"), pal("hazard_dark"), pal("warning_red")], { speed: 7, size: 0.3 });
  }

  private dodge(beam: number) {
    const got = this.dressing.collect(beam);
    if (!got.length) return;
    const pts = 50 * got.length * this.judge.multiplier;
    this.judge.score += pts;
    this.coins += got.length;
    this.sfx.coin(this.judge.combo);
    this.cues.say(`+${pts}`, "score", this.aheadOfRider(10, -1.2), { px: 64 });
    for (const p of got) this.particles.burst(p, 5, [pal("coin"), pal("coin_rim")], { speed: 4, size: 0.22, gravity: 4, up: 1 });
  }

  /** A point in front of the hero for callouts about what just happened to them. */
  private aheadOfRider(dist: number, lift: number) {
    return this.tmp.copy(this.rider.pos).addScaledVector(this.rider.heading, dist).setY(this.rider.pos.y + 0.3 + lift);
  }

  // ------------------------------------------------------------------ loop
  frame() {
    // Off screen: the host may keep rAF running, so burn nothing until resume.
    if (this.hostPaused) return;
    const now = performance.now();
    const rawDt = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(rawDt, 1 / 20);
    this.quality.sample(rawDt);
    this.conductor.update();
    this.motion.update(now);
    this.handleInput();
    this.stateT += dt;

    if (this.state === "hub") this.updateHub(dt, now);
    else if (this.state === "warp") this.updateWarp(dt);
    else if (this.state === "ready") this.updateReady();
    else if (this.state === "resuming") this.updateResuming();
    else if (this.state === "paused") this.updatePaused(dt);
    if (this.state === "play") this.updatePlay(dt, now);
    else if (this.state === "results") this.updateRide(dt, this.conductor.beat(now));
    else if (this.state === "ready") this.placeRider(0, dt);

    const frozen = this.state === "paused" || this.state === "resuming";
    const simDt = frozen ? 0 : dt;
    if (!frozen) {
      this.venue.traffic.update(dt);
      if (this.venue.course) this.dressing.update(dt);
      this.particles.update(dt);
    }
    this.rig.update(simDt, this.rider);
    this.sky.update(dt, this.camera.position);
    this.venue.backdrop?.update(this.camera.position);
    this.updateShadowFrustum();
    this.updateChunkVisibility();
    this.driveArmsFromBody();
    this.arms.update(frozen ? dt : simDt, this.rider, this.camera, this.sunDir);
    const zipping = this.state === "warp";
    this.speedLines.update(simDt, this.rider.state === "perched" && !zipping ? 0 : this.rider.speed * 1.6);
    const webTo = this.web ? this.rider.anchor : this.hubWeb?.to;
    if (webTo) this.webLine.update(dt, this.arms.webOrigin(this.camera, this.tmp), webTo, this.camera);

    const beat = this.conductor.beat(now);
    if (this.state === "play" || frozen) this.cues.update(simDt, beat, this.judge.rts, this.camera, this.web?.swing ?? -1);
    if (this.hud.guideOpen) this.hud.mirror.draw(this.motion, this.readyFocus(), now);
    if (this.mode === "motion" && (this.state === "play" || this.state === "resuming")) this.updatePip(dt, now);
    if (this.debug) this.updateDebug(dt, beat);

    this.render();
    if (import.meta.env.DEV) this.logPerf(rawDt, performance.now() - now);
  }

  /** The city is the screen; the camera view only comes up while the player's framing needs fixing. */
  private updatePip(dt: number, now: number) {
    this.pipT = this.motion.framed ? Math.min(0, this.pipT) - dt : Math.max(0, this.pipT) + dt;
    const show = this.pipShown ? this.pipT > -PIP_HIDE_AFTER : this.pipT > PIP_SHOW_AFTER;
    if (show !== this.pipShown) {
      this.pipShown = show;
      this.hud.showPip(show);
    }
    if (show) this.hud.pip.draw(this.motion, NO_FOCUS, now);
  }

  /** The 3D arms copy the player's while the camera can see them. */
  private driveArmsFromBody() {
    const m = this.motion;
    const live = m.tracking && this.mode === "motion";
    const arm = (k: 0 | 1): BodyArm | null => {
      const a = m.arms[k];
      return live && (a.ok || a.power > 0) ? { out: a.out, up: a.up, reach: a.reach } : null;
    };
    this.arms.setBody(arm(0), arm(1));
  }

  private updateDebug(dt: number, beat: number) {
    this.debugT -= dt;
    if (this.debugT > 0) return;
    this.debugT = 0.2;
    // No judge until the first city is entered.
    const recent = this.course ? this.judge.rts.filter((r) => r.state === "hit" && r.offset !== undefined).slice(-6) : [];
    const offs = recent.map((r) => `${r.cue.kind === "hand" ? "W" : "L"}${Math.round(r.offset! * 1000)}`).join(" ");
    this.hud.setDebug(
      `${this.motion.debugText()}\n${this.state} mode ${this.mode} beat ${beat.toFixed(2)} audio ${this.conductor.audible ? "on" : "off"}\n` +
        `last offsets ms (+late): ${offs || "-"}`,
    );
  }

  private updatePaused(dt: number) {
    if (!this.pausedForTracking || !this.hud.guideOpen) return;
    this.foundFor = this.motion.framed ? this.foundFor + dt : 0;
    if (this.foundFor > 0.8) this.resume();
  }

  private updatePlay(dt: number, now: number) {
    const song = this.conductor.songTime(now);
    const beat = song / BEAT;

    if (this.autoplay) this.autoplayInputs(song, now);

    // Waved-through cues after a resume.
    for (const rt of this.judge.rts) {
      if (rt.time > this.graceUntil) break;
      if (rt.state === "pending") this.skipCue(rt);
    }
    // Webs the hero fires by itself go off on the beat.
    for (const rt of this.judge.rts) {
      if (rt.time > song) break;
      if (rt.state === "pending" && rt.cue.auto) {
        this.skipCue(rt);
        this.sfx.thwip();
      }
    }
    // A lean already held when its beat arrives still counts.
    if (this.leanHeld) {
      for (const rt of this.judge.rts) {
        if (rt.time > song) break;
        if (rt.state === "pending" && rt.cue.kind === "lean" && rt.cue.side === this.leanHeld.side) {
          this.onJudged(this.judge.grant(rt, "good", this.leanHeld.since - rt.time));
          this.leanHeld = null;
          break;
        }
      }
    }
    const missed: Judgment[] = [];
    this.judge.sweep(song, missed);
    for (const j of missed) this.onJudged(j);

    if (this.recovery && song >= this.recovery.at) {
      const swing = this.recovery.swing;
      this.recovery = null;
      if ((this.web?.swing ?? -1) < swing) {
        this.fireWeb(swing, true);
        this.sfx.recover();
        this.cues.say("RECOVER", "info", this.route.swings[swing].anchor, { px: 64 });
      }
      this.sagTarget = 0;
    }

    this.updateCountIn(beat);
    this.updateRide(dt, beat);

    // Girders: settle each one as the hero reaches it.
    while (this.beamsPassed < this.route.beams.length && this.r >= this.route.beams[this.beamsPassed].r) {
      const i = this.beamsPassed++;
      const rt = this.judge.rts[this.route.beams[i].cue.id];
      if (rt.state === "pending") {
        if (this.leanHeld?.side === rt.cue.side) this.onJudged(this.judge.grant(rt, "good", this.leanHeld.since - rt.time));
        else {
          const j = this.judge.missNow(rt, song);
          if (j) this.onJudged(j);
        }
      }
      if (rt.state === "hit" || rt.state === "skipped") this.dodge(i);
      else this.bonk(i);
    }

    if (!this.finished && this.r >= FINISH_BEAT) {
      this.finished = true;
      this.releaseWeb();
      this.dressing.passFinish();
      this.sfx.fanfare();
      this.hud.callout("FINISH!", "big");
      this.particles.burst(this.route.finish, 60, [pal("coin"), pal("hoop"), pal("suit_light"), pal("b_white")], { speed: 16, size: 0.5, gravity: 8, up: 4 });
    }
    if (beat >= RESULTS_BEAT) {
      this.endRun();
      return;
    }

    if (beat > FIRST_CUE_BEAT + 8) this.hud.setHint(null);
    // The street the hero is over, by its real name.
    const where = this.r <= LEAP_BEAT ? this.city.area : this.route.streetAt(this.r);
    this.hud.setProgress((beat - FIRST_CUE_BEAT) / (FINISH_BEAT - FIRST_CUE_BEAT), where);
    this.hud.setStats(this.judge.score, this.judge.combo, this.judge.multiplier, this.judge.accuracy);
    this.sfx.setWind(clamp((this.rider.speed - 12) / 18, 0, 1) * 0.6);

    // Motion players who walk out of view get a pause, not a wall of misses.
    if (this.mode === "motion") {
      this.updateAim(song, dt);
      this.lostFor = this.motion.tracking ? 0 : this.lostFor + dt;
      if (this.lostFor > LOST_PAUSE_AFTER && beat > 2) this.pause(true);
    }
  }

  /**
   * Point each arm's next shot at its ring as it comes up: a ring nearer the middle of
   * the view or lower down needs a shorter punch, one further out or higher a longer one.
   */
  private updateAim(song: number, dt: number) {
    for (const k of [0, 1] as const) {
      const side: Side = k === 0 ? -1 : 1;
      let goal = DEFAULT_AIM;
      for (const rt of this.judge.rts) {
        if (rt.time > song + AIM_LOOKAHEAD) break;
        if (rt.state !== "pending" || rt.cue.auto || rt.cue.kind !== "hand" || rt.cue.side !== side) continue;
        const p = this.camera.worldToLocal(this.tmp.copy(this.route.swings[this.swingOfCue.get(rt.cue.id)!].anchor));
        if (p.z < -1) goal = aimToward(Math.atan2(p.x * side, -p.z), Math.atan2(p.y, Math.hypot(p.x, p.z)));
        break;
      }
      const a = this.aim[k];
      a.out = damp(a.out, goal.out, 8, dt);
      a.up = damp(a.up, goal.up, 8, dt);
      this.motion.setAim(k, a.out, a.up);
    }
  }

  private resetAim() {
    for (const k of [0, 1] as const) {
      Object.assign(this.aim[k], DEFAULT_AIM);
      this.motion.setAim(k, DEFAULT_AIM.out, DEFAULT_AIM.up);
    }
  }

  private skipCue(rt: CueRt) {
    this.judge.skip(rt);
    if (rt.cue.kind === "hand") this.fireWeb(this.swingOfCue.get(rt.cue.id)!, false);
    else this.assist = { side: rt.cue.side, until: rt.cue.beat + BEAM_DELAY + 0.8 };
  }

  private updateCountIn(beat: number) {
    if (beat >= FIRST_CUE_BEAT) {
      // Off the screen before the first ring lands.
      if (this.countShown !== -1) {
        this.countShown = -1;
        this.hud.setCenter(null);
      }
      return;
    }
    const n = beat < 4 ? 99 : 7 - Math.floor(beat);
    if (n === this.countShown) return;
    this.countShown = n;
    if (n === 99) return;
    if (n >= 1 && n <= 3) this.hud.setCenter(String(n));
    else if (n === 0) this.hud.setCenter("SWING!", "go");
    else this.hud.setCenter(null);
  }

  /** Advance along the rails: locked to the music, except for a brief stumble after a mistake. */
  private updateRide(dt: number, beat: number) {
    const dBeat = clamp(beat - this.lastBeat, 0, 0.5);
    this.lastBeat = beat;
    if (beat < LEAP_BEAT || this.state !== "play") {
      if (this.state === "play" || this.state === "results") this.r = Math.max(this.r, beat < LEAP_BEAT ? beat : this.r + dBeat);
    } else {
      const lag = beat - this.r;
      let target: number;
      if (this.slowLeft > 0) {
        target = TUNING.slowRate;
        this.slowLeft -= dBeat;
      } else target = 1 + clamp(1.2 * lag, -0.3, TUNING.catchUpMax);
      this.rate = damp(this.rate, target, 7, dt);
      this.r = Math.max(this.r + this.rate * dBeat, LEAP_BEAT);
      if (Math.abs(beat - this.r) > 1.5) this.r = beat - Math.sign(beat - this.r) * 1.5;
    }

    // Lean: a judged lean forces the dodge; otherwise the body (or nothing) steers a little.
    let leanTarget = 0;
    if (this.assist && this.r < this.assist.until) leanTarget = this.assist.side * DODGE_OFFSET;
    else {
      this.assist = null;
      if (this.mode === "motion" && this.motion.tracking) leanTarget = clamp(this.motion.lean / 0.3, -1, 1) * 2.2;
    }
    this.lean = damp(this.lean, leanTarget, this.assist ? 12 : 6, dt);
    this.sag.step(this.sagTarget, dt);

    if (this.web) {
      const w = this.route.swings[this.web.swing];
      if ((this.r - w.start) / (w.end - w.start) > 0.86) this.releaseWeb();
    }
    this.placeRider(this.r, dt);
  }

  private placeRider(r: number, dt: number) {
    const s = this.route.sample(r, this.smp);
    const rd = this.rider;
    this.prevPos.copy(rd.pos);
    let y = s.pos.y + this.sag.value;
    y = Math.max(y, Math.min(s.pos.y, s.floor));
    y = Math.min(y, Math.max(s.pos.y, s.ceil));
    rd.pos.copy(s.pos).addScaledVector(s.right, this.lean).setY(y);
    if (dt > 0) {
      this.tmp.subVectors(rd.pos, this.prevPos).divideScalar(dt);
      if (this.tmp.lengthSq() > 80 * 80) this.tmp.set(0, 0, 0);
      rd.vel.lerp(this.tmp, 1 - Math.exp(-12 * dt));
    } else if (r === 0) rd.vel.set(0, 0, 0);
    rd.speed = rd.vel.length();
    this.route.sample(r + 0.8, this.ahead);
    this.tmp.subVectors(this.ahead.pos, s.pos).setY(0);
    if (this.tmp.lengthSq() > 1) rd.heading.copy(this.tmp.normalize());
    else rd.heading.copy(s.fwd);
    rd.steer = this.lean / DODGE_OFFSET;
    rd.state = r <= LEAP_BEAT ? "perched" : this.web ? "swing" : "air";
  }

  /** ?autoplay plays every cue on the beat (?autoplay=miss skips some) to test the whole run. */
  private autoplayInputs(song: number, now: number) {
    for (const rt of this.judge.rts) {
      if (rt.time > song) break;
      if (rt.state !== "pending" || rt.cue.auto) continue;
      if (this.autoplay === "miss" && rt.cue.id % 4 === 1) continue;
      this.onPress(rt.cue.kind, rt.cue.side, now - (song - rt.time) * 1000);
    }
  }

  private perf = { t: 0, frames: 0, cpu: 0 };
  private logPerf(dt: number, cpuMs: number) {
    const p = this.perf;
    p.t += dt;
    p.frames++;
    p.cpu += cpuMs;
    if (p.t < 6) return;
    const { calls, triangles } = this.renderer.info.render;
    const m = this.motion.tracking ? ` motion ${this.motion.rateHz.toFixed(0)} Hz` : "";
    console.info(
      `[perf] ${this.state} ${this.quality.tier.name} ${(p.frames / p.t).toFixed(1)} fps, ` +
        `cpu ${(p.cpu / p.frames).toFixed(1)} ms, ${calls} calls, ${(triangles / 1000).toFixed(0)}k tris${m}`,
    );
    p.t = p.frames = p.cpu = 0;
  }

  // ------------------------------------------------------------------ rendering
  private applyQuality(t: Tier) {
    this.renderer.setPixelRatio(t.renderScale);
    this.renderer.setSize(1920, 1080, false);
    this.fog.far = t.fogFar;
    this.fog.near = t.fogFar * 0.32;
    const shadows = t.shadowMap > 0;
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(t.shadowMap, t.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      const half = t.shadowMap >= 2048 ? 120 : 90;
      const cam = this.sun.shadow.camera;
      cam.left = cam.bottom = -half;
      cam.right = cam.top = half;
      cam.updateProjectionMatrix();
    }
    // Materials must recompile when shadows toggle.
    this.scene.traverse((o) => {
      const m = (o as Mesh).material;
      if (m && !Array.isArray(m)) m.needsUpdate = true;
    });
    console.info(`[quality] ${t.name}${this.quality.fps ? ` (was ${this.quality.fps.toFixed(1)} fps)` : ""}`);
  }

  private logDevice() {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const webgl = this.renderer.capabilities.isWebGL2 ? "webgl2" : "webgl1";
    console.info(`[device] ${gpu} | ${webgl} | dpr ${devicePixelRatio} | ${innerWidth}x${innerHeight} | ${navigator.userAgent}`);
  }

  private updateShadowFrustum() {
    if (!this.sun.castShadow) return;
    // Center the shadow box ahead of the hero and snap it to shadow texels so
    // edges don't crawl as we swing.
    const center = this.tmp.copy(this.rider.pos).addScaledVector(this.rider.heading, 45);
    center.y = 0;
    const cam = this.sun.shadow.camera;
    const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    const lx = new Vector3().crossVectors(new Vector3(0, 1, 0), this.sunDir).normalize();
    const ly = new Vector3().crossVectors(this.sunDir, lx);
    const u = Math.round(center.dot(lx) / texel) * texel;
    const v = Math.round(center.dot(ly) / texel) * texel;
    const w = center.dot(this.sunDir);
    center.set(0, 0, 0).addScaledVector(lx, u).addScaledVector(ly, v).addScaledVector(this.sunDir, w);
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(this.sunDir, 200);
    this.sun.target.updateMatrixWorld();
  }

  private updateChunkVisibility() {
    const far = this.fog.far + 20;
    const cp = this.camera.position;
    for (const m of this.venue.chunks) {
      const s = m.geometry.boundingSphere!;
      m.visible = cp.distanceTo(s.center) - s.radius < far;
    }
  }

  private render() {
    const r = this.renderer;
    r.info.reset();
    r.clear();
    r.render(this.scene, this.camera);
    r.clearDepth();
    r.render(this.arms.scene, this.arms.camera);
  }
}
