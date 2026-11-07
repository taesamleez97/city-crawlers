import {
  Color, DirectionalLight, Fog, HemisphereLight, type Mesh, NoToneMapping, PCFShadowMap, PerspectiveCamera, Scene,
  SRGBColorSpace, Vector3, WebGLRenderer,
} from "three";

import { TUNING } from "../config";
import { Sfx } from "../core/audio";
import { type Action, Input } from "../core/input";
import { SpringScalar, clamp, damp } from "../core/math";
import { QualityManager, type Tier } from "../core/quality";
import { MotionInput } from "../input/motion";
import type { CameraFeed, LittlePlatform } from "../platform/little";
import { Dressing } from "../rhythm/dressing";
import { type CueRt, Judge, type Judgment } from "../rhythm/judge";
import { Conductor } from "../rhythm/music";
import { BEAM_DELAY, DODGE_OFFSET, Route, newSample } from "../rhythm/route";
import { BEAT, type CueKind, FINISH_BEAT, LEAP_BEAT, RESULTS_BEAT, type Side, sectionAt } from "../rhythm/song";
import { ArmsView, type BodyArm } from "../view/arms";
import { CameraRig } from "../view/cameraRig";
import { LEFT_COLOR, RIGHT_COLOR, figureSvg } from "../view/cueStyle";
import { Particles, SpeedLines, WebLine } from "../view/fx";
import { type Hud, type MenuItem } from "../view/hud";
import { WorldCues } from "../view/worldCues";
import { type CityData, buildCity } from "../world/city";
import { createWorldMaterial } from "../world/materials";
import { pal } from "../world/palette";
import type { PropLibrary } from "../world/props";
import { Sky } from "../world/sky";
import { Traffic } from "../world/traffic";
import type { Subject, SubjectState } from "./subject";

type State = "title" | "ready" | "play" | "paused" | "resuming" | "results";

const SUN_DIR = new Vector3(-0.5, 0.85, 0.45).normalize();
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

type StepId = "frame" | "stance" | "shootR" | "shootL" | "leanL" | "leanR";
type Step = { id: StepId; label: string; hint: string; done: boolean };
const STEPS: Array<Omit<Step, "done">> = [
  { id: "frame", label: "Find your spot", hint: "Back up until the box turns green. Your fists need room above your head." },
  { id: "stance", label: "Fists up by your shoulders", hint: "Your ready pose: it loads your web-shooters." },
  { id: "shootR", label: `Shoot a web <b class="cr">RIGHT</b>`, hint: `Snap your right arm straight, up and out, at the <b class="cr">pink</b> ring.` },
  { id: "shootL", label: `Shoot a web <b class="cl">LEFT</b>`, hint: `Pull back, then snap your left arm at the <b class="cl">blue</b> ring.` },
  { id: "leanL", label: `Lean <b class="co">LEFT</b>`, hint: "Shift your shoulders over to your left." },
  { id: "leanR", label: `Lean <b class="co">RIGHT</b>`, hint: "And over to your right." },
];
const STEP_FIGURE: Record<StepId, Parameters<typeof figureSvg>[0]> = {
  frame: "frame", stance: "stance", shootR: "shootR", shootL: "shootL", leanL: "leanL", leanR: "leanR",
};

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
  private readonly city: CityData;
  private readonly route: Route;
  private readonly dressing: Dressing;
  private readonly cues: WorldCues;
  private readonly traffic: Traffic;
  private readonly chunks: Mesh[] = [];
  private readonly input = new Input();
  private readonly sfx = new Sfx();
  private readonly conductor: Conductor;
  private readonly motion: MotionInput;
  private readonly judge: Judge;
  private readonly quality = new QualityManager();
  private readonly rider = new Rider();
  private readonly smp = newSample();
  private readonly ahead = newSample();
  private readonly swingOfCue = new Map<number, number>();
  private readonly beamOfCue = new Map<number, number>();

  private state: State = "title";
  private stateT = 0;
  private best = 0;
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

  // ---- ready / calibration
  private steps: Step[] = [];
  private readyStep = 0;
  private readyDoneAt = -1;
  private stanceT = 0;
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
    lib: PropLibrary,
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
    this.city = buildCity(material, (type) => lib.geometries.get(type));
    this.scene.add(this.city.group, this.sky.group);
    this.city.group.traverse((o) => {
      if (o.name.startsWith("chunk_")) {
        const m = o as Mesh;
        m.geometry.computeBoundingSphere();
        this.chunks.push(m);
      }
    });

    this.route = new Route(this.city.world);
    this.route.swings.forEach((w, i) => this.swingOfCue.set(w.cue.id, i));
    this.route.beams.forEach((b, i) => this.beamOfCue.set(b.cue.id, i));
    this.judge = new Judge(this.route.cues);
    this.dressing = new Dressing(lib, material, this.route);
    this.cues = new WorldCues(this.route);
    this.traffic = new Traffic(lib, material, this.city.lanes);
    this.scene.add(this.dressing.group, this.cues.group, this.traffic.group, this.webLine.mesh, this.particles.mesh);

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
      console.info("[city]", this.city.stats);
      console.info("[route]", JSON.stringify(this.route.describe()));
      (window as unknown as { game: Game }).game = this;
    }
    this.wirePlatform();
    this.toTitle();
    // Compile shaders before the first visible frame to avoid a hitch on the leap.
    this.cues.prewarm(true);
    this.renderer.compile(this.scene, this.camera);
    this.cues.prewarm(false);
    if (this.autoplay) this.startRun();
  }

  // ------------------------------------------------------------------ platform
  private wirePlatform() {
    const L = this.little;
    L.tool("start_run", () => {
      if (this.state === "play" || this.state === "resuming") return { ok: false, detail: "A run is already in progress." };
      this.startRun();
    });
    L.tool("pause_game", () => {
      if (this.state !== "play" && this.state !== "resuming") return { ok: false, detail: "Nothing to pause." };
      this.pause();
    });
    L.tool("resume_game", () => {
      if (this.state !== "paused") return { ok: false, detail: "The game is not paused." };
      this.resume();
    });
    L.tool("restart_run", () => this.startRun());
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
      const saved = Number((state as { best?: unknown }).best ?? 0);
      const local = Number(localStorage.getItem("cc.best") ?? 0);
      this.best = Math.max(Number.isFinite(saved) ? saved : 0, Number.isFinite(local) ? local : 0);
      if (this.state === "title") this.toTitle();
      if (params.start === true && this.state === "title") this.startRun();
    });
  }

  private setTools(names: string[]) {
    this.little.setActiveTools(names);
  }

  // ------------------------------------------------------------------ states
  private toTitle() {
    this.state = "title";
    this.stateT = 0;
    this.conductor.stop();
    this.resetRun();
    this.placeRider(0, 0);
    this.rig.snap(this.rider);
    this.rig.idleSway = 0.35;
    this.hud.showRunHud(false);
    this.hud.hideGuide();
    this.hud.setHint(null);
    this.hud.setPrompt(null);
    this.hud.setCenter(null);
    this.closeCamera();
    this.motion.close();
    const items: MenuItem[] = [
      { id: "play", label: "Play", action: "start_run", onSelect: () => this.startRun() },
      { id: "quit", label: "Quit", action: "quit_game", onSelect: () => this.quit() },
    ];
    const note = this.input.keys
      ? "Desk test: <kbd>Q</kbd><kbd>E</kbd> webs, <kbd>A</kbd><kbd>D</kbd> leans"
      : this.little.can("sense.motion") ? "" : "City Crawlers needs the TV camera, which isn't available here.";
    this.hud.showTitle(this.best, items, note);
    this.setTools(["start_run", "quit_game"]);
  }

  private resetRun() {
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
    this.webLine.hide();
    this.setPip(false);
  }

  private setPip(on: boolean) {
    this.pipShown = on;
    this.pipT = 0;
    this.hud.showPip(on);
  }

  /** Play → get ready: the camera mirror, finding your spot and a quick move tutorial, then the song. */
  private startRun() {
    this.sfx.unlock();
    this.hud.close();
    this.conductor.stop();
    this.resetRun();
    this.placeRider(0, 0);
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
    this.stanceT = 0;
    this.steps = STEPS.map((s) => ({ ...s, done: false }));
    this.setTools(["start_run", "quit_game"]);
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
          ? "<kbd>OK</kbd> play with the keyboard &nbsp; <kbd>BACK</kbd> title"
          : "<kbd>OK</kbd> try again &nbsp; <kbd>BACK</kbd> title",
        data: { camera: "unavailable", reason: this.motion.reason },
      });
      return;
    }
    const cur = this.steps[this.readyStep];
    const all = this.readyStep >= this.steps.length;
    const now = all
      ? `<div class="step-now done"><i class="step-fig">${figureSvg("frame")}</i><div><b>You're ready!</b><p>Here comes the song.</p></div></div>`
      : `<div class="step-now"><i class="step-fig">${figureSvg(STEP_FIGURE[cur.id])}</i><div><b>${cur.label}</b><p>${cur.hint}</p></div></div>`;
    const list = this.steps
      .map((s, i) => `<li class="${s.done ? "done" : i === this.readyStep ? "cur" : ""}">${s.label}</li>`)
      .join("");
    this.hud.showGuide({
      title: "GET READY",
      side: `${now}<ol class="steps">${list}</ol>`,
      footer: "<kbd>OK</kbd> skip the tutorial &nbsp; <kbd>BACK</kbd> title",
      data: { steps: this.steps.map((s) => ({ step: s.label.replace(/<[^>]+>/g, ""), done: s.done })) },
    });
  }

  private updateReady(dt: number) {
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
    const id = this.steps[this.readyStep].id;
    if (id === "frame") {
      if (m.framed && m.framingOkFor > 1) {
        m.calibrateLean();
        this.advanceReady();
      }
    } else if (id === "stance") {
      const loaded = m.arms.every((a) => a.ok && a.armed && a.reach < 0.75);
      this.stanceT = loaded ? this.stanceT + dt : 0;
      if (this.stanceT > 0.3) this.advanceReady();
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
    if (this.readyStep >= this.steps.length) this.readyDoneAt = this.stateT;
    this.renderReady();
  }

  /** A shot outside the song (tutorial): the sound and the 3D arm, no web. */
  private thwipFeedback(side: Side) {
    this.sfx.thwip();
    this.arms.onAttach(side);
    setTimeout(() => this.arms.onRelease(), 250);
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
    this.hud.setHint(
      this.mode === "motion"
        ? `<span>Punch at each ring <b>as its outer circle closes</b></span><span><b class="cl">Blue</b> left arm, <b class="cr">pink</b> right</span><span>Lean where the <b class="co">arrows</b> point</span>`
        : this.mode === "keys"
          ? `<span><kbd>Q</kbd><kbd>E</kbd>webs</span><span><kbd>A</kbd><kbd>D</kbd>leans</span>`
          : null,
    );
    this.conductor.start(-0.3);
    this.setTools(["pause_game", "restart_run", "quit_game"]);
    this.little.emit("run_started", { input: this.mode, cues: this.judge.rts.length });
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
    this.setTools(["resume_game", "restart_run", "quit_game"]);
  }

  private showPauseMenu() {
    this.hud.hideGuide();
    this.closeCamera();
    this.hud.showPause([
      { id: "resume", label: "Resume", action: "resume_game", onSelect: () => this.resume() },
      { id: "restart", label: "Restart", action: "restart_run", onSelect: () => this.startRun() },
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
    if (this.little.isStub) this.toTitle();
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
    const newBest = final > this.best;
    if (newBest) {
      this.best = final;
      localStorage.setItem("cc.best", String(final));
      this.little.saveState({ best: final });
    }
    this.hud.showRunHud(false);
    this.setPip(false);
    this.hud.setHint(null);
    this.hud.setPrompt(null);
    this.motion.close();
    const n = (v: number) => v.toLocaleString("en-US");
    this.hud.showResults(
      {
        score: final, best: this.best, newBest, stars, grade,
        rows: [
          ["Accuracy", `${(acc * 100).toFixed(1)}%`],
          ["Max combo", n(j.maxCombo)],
          ["Perfect · Great · Good", `${j.counts.perfect} · ${j.counts.great} · ${j.counts.good}`],
          ["Missed", n(j.counts.miss)],
          ["Dodge coins", n(this.coins)],
        ],
      },
      [
        { id: "again", label: "Play again", action: "start_run", onSelect: () => this.startRun() },
        { id: "title", label: "Title", action: "quit_game", onSelect: () => this.toTitle() },
      ],
    );
    this.setTools(["start_run", "quit_game"]);
    this.little.emit("run_finished", {
      score: final, grade, stars, accuracy: Math.round(acc * 1000) / 10, maxCombo: j.maxCombo, ...j.counts, input: this.mode,
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
        else if (ev.action === "back") this.toTitle();
      } else if ((this.state === "play" || this.state === "resuming") && ev.action === "back") {
        this.pause();
      } else if (this.state === "paused" && ev.action === "back") {
        this.showPauseMenu();
      }
    }
    if (this.state !== "play") {
      // Gestures between runs are not inputs (the ready screen reads its own).
      if (this.state !== "ready") this.motion.drain();
      return;
    }
    if (this.mode === "keys") for (const p of presses) this.onPress(p.kind, p.side, p.time);
    for (const e of this.motion.drain()) {
      if (this.mode !== "motion") continue;
      if (e.type === "shoot") this.onPress("hand", e.side, e.t);
      else if (e.type === "lean") {
        const hit = this.onPress("lean", e.side, e.t);
        this.leanHeld = hit ? null : { side: e.side, since: this.conductor.songTime(e.t) };
      } else this.leanHeld = null;
    }
  }

  private menuInput(a: Action) {
    if (a === "up" || a === "left") {
      this.hud.menu.move(-1);
      this.sfx.ui("move");
    } else if (a === "down" || a === "right") {
      this.hud.menu.move(1);
      this.sfx.ui("move");
    } else if (a === "select") {
      this.sfx.ui("select");
      this.hud.menu.activate();
    } else if (a === "back") {
      this.sfx.ui("back");
      if (this.state === "paused") this.resume();
      else if (this.state === "results") this.toTitle();
      else if (this.state === "title") this.quit();
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
    const j = this.judge.input(kind, side, this.conductor.songTime(perfTime));
    if (j) this.onJudged(j);
    return !!j;
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

    if (this.state === "ready") this.updateReady(dt);
    else if (this.state === "resuming") this.updateResuming();
    else if (this.state === "paused") this.updatePaused(dt);
    if (this.state === "play") this.updatePlay(dt, now);
    else if (this.state === "results") this.updateRide(dt, this.conductor.beat(now));
    else if (this.state === "title" || this.state === "ready") this.placeRider(0, dt);

    const frozen = this.state === "paused" || this.state === "resuming";
    const simDt = frozen ? 0 : dt;
    if (!frozen) {
      this.traffic.update(dt);
      this.dressing.update(dt);
      this.particles.update(dt);
    }
    this.rig.update(simDt, this.rider);
    this.sky.update(dt, this.camera.position);
    this.updateShadowFrustum();
    this.updateChunkVisibility();
    this.driveArmsFromBody();
    this.arms.update(frozen ? dt : simDt, this.rider, this.camera, SUN_DIR);
    this.speedLines.update(simDt, this.rider.state === "perched" ? 0 : this.rider.speed * 1.6);
    if (this.web) this.webLine.update(dt, this.arms.webOrigin(this.camera, this.tmp), this.rider.anchor, this.camera);

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
    const j = this.judge;
    const recent = j.rts.filter((r) => r.state === "hit" && r.offset !== undefined).slice(-6);
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

    const sec = sectionAt(beat);
    if (beat > FIRST_CUE_BEAT + 8) this.hud.setHint(null);
    this.hud.setProgress((beat - FIRST_CUE_BEAT) / (FINISH_BEAT - FIRST_CUE_BEAT), sec.name);
    this.hud.setStats(this.judge.score, this.judge.combo, this.judge.multiplier, this.judge.accuracy);
    this.sfx.setWind(clamp((this.rider.speed - 12) / 18, 0, 1) * 0.6);

    // Motion players who walk out of view get a pause, not a wall of misses.
    if (this.mode === "motion") {
      this.lostFor = this.motion.tracking ? 0 : this.lostFor + dt;
      if (this.lostFor > LOST_PAUSE_AFTER && beat > 2) this.pause(true);
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
      if (rt.state !== "pending") continue;
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
    const lx = new Vector3().crossVectors(new Vector3(0, 1, 0), SUN_DIR).normalize();
    const ly = new Vector3().crossVectors(SUN_DIR, lx);
    const u = Math.round(center.dot(lx) / texel) * texel;
    const v = Math.round(center.dot(ly) / texel) * texel;
    const w = center.dot(SUN_DIR);
    center.set(0, 0, 0).addScaledVector(lx, u).addScaledVector(ly, v).addScaledVector(SUN_DIR, w);
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(SUN_DIR, 200);
    this.sun.target.updateMatrixWorld();
  }

  private updateChunkVisibility() {
    const far = this.fog.far + 20;
    const cp = this.camera.position;
    for (const m of this.chunks) {
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
