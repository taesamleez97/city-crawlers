import {
  Color, DirectionalLight, Fog, HemisphereLight, type Mesh, NoToneMapping, PCFShadowMap, PerspectiveCamera, Scene,
  SRGBColorSpace, Vector3, WebGLRenderer,
} from "three";

import { TUNING } from "../config";
import { Sfx } from "../core/audio";
import { type Action, Input } from "../core/input";
import { clamp, damp, wrapAngle } from "../core/math";
import { QualityManager, type Tier } from "../core/quality";
import type { LittlePlatform } from "../platform/little";
import { ArmsView } from "../view/arms";
import { CameraRig } from "../view/cameraRig";
import { Particles, Reticle, SpeedLines, WebLine } from "../view/fx";
import { Hud, type MenuItem, formatTime } from "../view/hud";
import { type CityData, buildCity } from "../world/city";
import { START } from "../world/cityLayout";
import { createWorldMaterial } from "../world/materials";
import { pal } from "../world/palette";
import type { PropLibrary } from "../world/props";
import { Sky } from "../world/sky";
import { Traffic } from "../world/traffic";
import { type AnchorCandidate, findAnchor } from "./anchors";
import { Course, type CourseEvent } from "./course";
import { Player, type PlayerEvent } from "./player";

type State = "title" | "countdown" | "running" | "paused" | "results";

const SUN_DIR = new Vector3(-0.5, 0.85, 0.45).normalize();
const HOLD_RELEASE_MS = 230;
const ATTACH_BUFFER = 0.18;

export class Game {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(TUNING.fovBase, 16 / 9, 0.1, 1600);
  private readonly rig: CameraRig;
  private readonly arms: ArmsView;
  private readonly web = new WebLine();
  private readonly reticle = new Reticle();
  private readonly particles = new Particles();
  private readonly speedLines = new SpeedLines();
  private readonly sky = new Sky();
  private readonly sun = new DirectionalLight(pal("sun"), 1.8);
  private readonly hemi = new HemisphereLight(pal("hemi_sky"), pal("hemi_ground"), 2.0);
  private readonly fog: Fog;
  private readonly city: CityData;
  private readonly course: Course;
  private readonly traffic: Traffic;
  private readonly chunks: Mesh[] = [];
  private readonly player = new Player();
  private readonly input = new Input();
  private readonly sfx = new Sfx();
  private readonly hud: Hud;
  private readonly quality = new QualityManager();

  private state: State = "title";
  private stateT = 0;
  private hearts: number = TUNING.hearts;
  private score = 0;
  private combo = 0;
  private runTime = 0;
  private best = 0;
  private candidate: AnchorCandidate | null = null;
  private attachBuffer = 0;
  private pressAt = 0;
  private pressAttached = false;
  private steerSmoothed = 0;
  private respawnT = -1;
  private endT = -1;
  private grazeCooldown = 0;
  private hintStage = 0;
  private perfects = 0;
  private countShown = 4;
  private readonly autopilot = new URLSearchParams(location.search).has("autopilot");
  private botCooldown = 0;
  private readonly prevPos = new Vector3();
  private readonly tmp = new Vector3();
  private readonly playerEvents: PlayerEvent[] = [];
  private readonly courseEvents: CourseEvent[] = [];
  private last = performance.now();
  private hostPaused = false;

  constructor(
    stage: HTMLElement,
    lib: PropLibrary,
    private readonly little: LittlePlatform,
    hud: Hud,
  ) {
    this.hud = hud;
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
    this.course = new Course(lib, material, this.city);
    this.traffic = new Traffic(lib, material, this.city.lanes);
    this.scene.add(this.course.group, this.traffic.group, this.web.mesh, this.reticle.sprite, this.particles.mesh);

    this.sun.castShadow = true;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target, this.hemi);

    this.arms = new ArmsView(lib.arms);
    this.arms.scene.add(this.speedLines.group);
    this.rig = new CameraRig(this.camera);

    this.logDevice();
    this.quality.onChange = (t) => this.applyQuality(t);
    this.applyQuality(this.quality.tier);
    this.hud.setupHoopBar(this.course.hoops.length);

    if (new URLSearchParams(location.search).has("debug")) {
      console.info("[city]", this.city.stats);
      (window as unknown as { game: Game }).game = this;
    }
    this.wirePlatform();
    this.toTitle();
    // Compile shaders before the first visible frame to avoid a hitch on GO.
    this.renderer.compile(this.scene, this.camera);
  }

  // ------------------------------------------------------------------ platform
  private wirePlatform() {
    const L = this.little;
    L.tool("start_run", () => {
      if (this.state === "running" || this.state === "countdown") return { ok: false, detail: "A run is already in progress." };
      this.startRun();
    });
    L.tool("pause_game", () => {
      if (this.state !== "running" && this.state !== "countdown") return { ok: false, detail: "Nothing to pause." };
      this.pause();
    });
    L.tool("resume_game", () => {
      if (this.state !== "paused") return { ok: false, detail: "The game is not paused." };
      this.resume();
    });
    L.tool("restart_run", () => this.startRun());
    L.tool("quit_game", () => this.quit());
    L.onPause(() => {
      if (this.state === "running" || this.state === "countdown") this.pause();
      this.sfx.suspend();
      this.hostPaused = true;
    });
    L.onResume(() => {
      this.hostPaused = false;
      this.last = performance.now();
      this.sfx.resume();
    });
    this.renderer.domElement.addEventListener("webglcontextlost", () => {
      if (this.state === "running" || this.state === "countdown") this.pause();
    });
    L.onEnter(({ params, state }) => {
      const saved = Number((state as { best?: unknown }).best ?? 0);
      const local = Number(localStorage.getItem("cc.best") ?? 0);
      this.best = Math.max(Number.isFinite(saved) ? saved : 0, Number.isFinite(local) ? local : 0);
      if (this.state === "title") this.toTitle();
      if (params.start === true) this.startRun();
    });
    this.input.enableGamepad(L.can("input.gamepad"));
  }

  private setTools(names: string[]) {
    this.little.setActiveTools(names);
  }

  // ------------------------------------------------------------------ states
  private toTitle() {
    this.state = "title";
    this.stateT = 0;
    this.resetWorld();
    this.player.reset(START.x, START.y + 0.9, START.z, START.yaw, "perched");
    this.rig.snap(this.player);
    this.rig.idleSway = 0.35;
    this.hud.showRunHud(false);
    this.hud.setHint(null);
    this.hud.setCenter(null);
    const items: MenuItem[] = [
      { id: "play", label: "Play", action: "start_run", onSelect: () => this.startRun() },
      { id: "quit", label: "Quit", action: "quit_game", onSelect: () => this.quit() },
    ];
    this.hud.showTitle(this.best, items, this.little.can("input.gamepad"));
    this.setTools(["start_run", "quit_game"]);
  }

  private resetWorld() {
    this.course.reset();
    this.hearts = TUNING.hearts;
    this.score = 0;
    this.combo = 0;
    this.runTime = 0;
    this.perfects = 0;
    this.respawnT = -1;
    this.endT = -1;
    this.candidate = null;
    this.web.hide();
    for (let i = 0; i < this.course.hoops.length; i++) this.hud.setHoopState(i, "open");
  }

  private startRun() {
    this.sfx.unlock();
    this.hud.close();
    this.resetWorld();
    this.player.reset(START.x, START.y + 0.9, START.z, START.yaw, "perched");
    this.rig.snap(this.player);
    this.rig.idleSway = 0;
    this.state = "countdown";
    this.stateT = 0;
    this.countShown = 4;
    this.hud.showRunHud(true);
    this.hud.setHint(null);
    this.hintStage = 0;
    this.setTools(["pause_game", "restart_run", "quit_game"]);
    this.little.emit("run_started", { hoops: this.course.hoops.length, coins: this.course.coins.length });
  }

  private pause() {
    if (this.state !== "running" && this.state !== "countdown") return;
    this.state = "paused";
    this.sfx.setWind(0);
    this.hud.showPause([
      { id: "resume", label: "Resume", action: "resume_game", onSelect: () => this.resume() },
      { id: "restart", label: "Restart", action: "restart_run", onSelect: () => this.startRun() },
      { id: "quit", label: "Quit", action: "quit_game", onSelect: () => this.quit() },
    ]);
    this.setTools(["resume_game", "restart_run", "quit_game"]);
  }

  private resume() {
    if (this.state !== "paused") return;
    this.hud.close();
    this.state = this.player.state === "perched" ? "countdown" : "running";
    if (this.state === "countdown") {
      this.stateT = 0;
      this.countShown = 4;
    }
    this.last = performance.now();
    this.setTools(["pause_game", "restart_run", "quit_game"]);
  }

  private quit() {
    this.little.exit();
    if (this.little.isStub) this.toTitle();
  }

  private endRun(finished: boolean) {
    this.state = "results";
    this.sfx.setWind(0);
    this.web.hide();
    const hoops = this.course.hoopsHit, total = this.course.hoops.length;
    const coins = this.course.coinsTaken, coinsTotal = this.course.coins.length;
    const timeBonus = finished ? Math.max(0, Math.round((150 - this.runTime) * 10)) : 0;
    const heartBonus = finished ? this.hearts * 250 : 0;
    const final = this.score + timeBonus + heartBonus;
    let stars = 0;
    if (finished) {
      stars = 1;
      if (hoops >= total * 0.8) stars++;
      if (hoops === total && coins >= coinsTotal * 0.75) stars++;
    }
    const newBest = final > this.best;
    if (newBest) {
      this.best = final;
      localStorage.setItem("cc.best", String(final));
      this.little.saveState({ best: final });
    }
    this.hud.showRunHud(false);
    this.hud.setHint(null);
    this.hud.showResults(
      {
        finished, score: final, best: this.best, newBest, stars, hoops, hoopsTotal: total, coins, coinsTotal, time: this.runTime,
        rows: [
          ["Hoops", `${hoops} / ${total}`],
          ["Coins", `${coins} / ${coinsTotal}`],
          ["Perfect releases", `${this.perfects}`],
          ["Time", formatTime(this.runTime)],
          ["Time bonus", `+${timeBonus.toLocaleString("en-US")}`],
          ["Hearts bonus", `+${heartBonus.toLocaleString("en-US")}`],
        ],
      },
      [
        { id: "again", label: "Play again", action: "start_run", onSelect: () => this.startRun() },
        { id: "title", label: "Title", action: "quit_game", onSelect: () => this.toTitle() },
      ],
    );
    this.setTools(["start_run", "quit_game"]);
    this.little.emit("run_finished", { finished, score: final, stars, hoops, coins, seconds: Math.round(this.runTime) });
  }

  // ------------------------------------------------------------------ input
  private handleInput(now: number) {
    for (const ev of this.input.drain()) {
      if (ev.type === "down") this.sfx.unlock();
      if (this.hud.menuOpen) {
        if (ev.type !== "down") continue;
        this.menuInput(ev.action);
        continue;
      }
      if (this.state === "running" || this.state === "countdown") {
        if (ev.action === "back" && ev.type === "down") {
          this.pause();
          continue;
        }
        if (ev.action !== "select" || this.state !== "running") continue;
        if (ev.type === "down" && !ev.repeat) this.onWebPress(now);
        else if (ev.type === "up") this.onWebLift(now);
      }
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

  /** Select is a smart toggle: tap to web, tap again to let go; or hold and lift. */
  private onWebPress(now: number) {
    if (this.player.state === "swing") {
      this.releaseWeb();
      this.pressAttached = false;
      return;
    }
    this.pressAt = now;
    this.pressAttached = true;
    if (!this.tryAttach()) this.attachBuffer = ATTACH_BUFFER;
  }

  private onWebLift(now: number) {
    if (this.pressAttached && this.player.state === "swing" && now - this.pressAt > HOLD_RELEASE_MS) this.releaseWeb();
    this.pressAttached = false;
    this.attachBuffer = 0;
  }

  private tryAttach(): boolean {
    const c = this.candidate;
    if (!c || this.player.state === "stunned") {
      this.sfx.fizzle();
      return false;
    }
    if (!this.player.attach(c.point, c.side)) return false;
    this.attachBuffer = 0;
    this.arms.onAttach(c.side);
    this.web.shoot();
    this.sfx.thwip();
    this.sfx.attach();
    if (this.hintStage === 0) {
      this.hintStage = 1;
      this.hud.setHint(`<span><kbd>OK</kbd>Let go at the top</span><span><kbd>◀</kbd><kbd>▶</kbd>Lean</span>`);
    }
    return true;
  }

  private releaseWeb() {
    const r = this.player.release();
    if (!r) return;
    this.arms.onRelease();
    this.web.hide();
    this.sfx.release(r.perfect);
    if (r.perfect) {
      this.perfects++;
      this.addCombo();
      const pts = 50 * this.mult;
      this.score += pts;
      this.hud.callout(`PERFECT! +${pts}`, "perfect");
      this.rig.addTrauma(0.12);
    }
    if (this.hintStage === 1) {
      this.hintStage = 2;
      setTimeout(() => this.hintStage === 2 && this.hud.setHint(null), 2500);
    }
  }

  // ------------------------------------------------------------------ scoring
  private get mult() {
    return Math.min(5, 1 + Math.floor(this.combo / 6));
  }

  private addCombo() {
    const before = this.mult;
    this.combo++;
    if (this.mult > before) this.hud.callout(`x${this.mult} COMBO`, "good");
  }

  private breakCombo() {
    if (this.combo >= 6) this.hud.callout("COMBO LOST", "bad");
    this.combo = 0;
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
    this.handleInput(now);
    this.stateT += dt;

    if (this.state === "countdown") this.updateCountdown();
    if (this.state === "running") this.updateRunning(dt);

    const paused = this.state === "paused";
    const simDt = paused ? 0 : dt;
    if (this.state === "title") {
      this.player.update(simDt, this.city.world, this.playerEvents);
    }
    if (!paused) {
      this.traffic.update(dt);
      this.course.animate(dt, this.player.pos);
      this.particles.update(dt);
    }
    this.rig.update(simDt, this.player);
    this.sky.update(dt, this.camera.position);
    this.updateShadowFrustum();
    this.updateChunkVisibility();

    this.arms.update(simDt, this.player, this.camera, SUN_DIR);
    this.speedLines.update(simDt, this.player.state === "perched" ? 0 : this.player.speed);
    if (this.player.state === "swing") {
      this.web.update(dt, this.arms.webOrigin(this.camera, this.tmp), this.player.anchor, this.camera);
    }
    const showReticle = this.state === "running" && this.player.state !== "swing" && this.player.state !== "stunned";
    this.reticle.update(dt, showReticle ? this.candidate?.point ?? null : null, this.camera);
    this.updatePointer();

    this.render();
    if (import.meta.env.DEV) this.logPerf(rawDt, performance.now() - now);
  }

  private perf = { t: 0, frames: 0, cpu: 0 };
  private logPerf(dt: number, cpuMs: number) {
    const p = this.perf;
    p.t += dt;
    p.frames++;
    p.cpu += cpuMs;
    if (p.t < 6) return;
    const { calls, triangles } = this.renderer.info.render;
    console.info(
      `[perf] ${this.state} ${this.quality.tier.name} ${(p.frames / p.t).toFixed(1)} fps, ` +
        `cpu ${(p.cpu / p.frames).toFixed(1)} ms, ${calls} calls, ${(triangles / 1000).toFixed(0)}k tris`,
    );
    p.t = p.frames = p.cpu = 0;
  }

  private updateCountdown() {
    const n = 3 - Math.floor(this.stateT / 0.75);
    if (n !== this.countShown) {
      this.countShown = n;
      if (n > 0) {
        this.hud.setCenter(String(n));
        this.sfx.countdown(false);
      } else {
        this.hud.setCenter("GO!", "go");
        this.sfx.countdown(true);
        this.state = "running";
        this.player.leap();
        this.hud.setHint(`<span><kbd>OK</kbd>Shoot a web</span>`);
      }
    }
  }

  private updateRunning(dt: number) {
    const p = this.player;
    this.grazeCooldown -= dt;

    // Digital remote arrows ramp in so steering never feels twitchy.
    const bot = this.autopilot ? this.botInput(dt) : null;
    const steerIn = bot ? bot.steer : this.input.steerAxis();
    this.steerSmoothed = damp(this.steerSmoothed, steerIn, steerIn === 0 ? 10 : 6, dt);
    p.steer = clamp(this.steerSmoothed, -1, 1);
    p.vertical = bot ? bot.vertical : this.input.verticalAxis();
    if (this.hintStage === 2 && Math.abs(steerIn) > 0) this.hintStage = 3;

    if (p.state !== "swing") {
      this.candidate = findAnchor(this.city.world, p.pos, p.heading, p.steer, this.course.nextHoopCenter());
      if (this.attachBuffer > 0) {
        this.attachBuffer -= dt;
        if (this.candidate) this.tryAttach();
      }
    } else {
      this.candidate = null;
      if (Math.abs(p.turnSinceAttach) > 0.45) {
        const c = findAnchor(this.city.world, p.pos, p.heading, p.steer, this.course.nextHoopCenter());
        if (c) {
          p.reattach(c.point, c.side);
          this.arms.onAttach(c.side);
          this.web.shoot();
          this.sfx.thwip();
        } else {
          p.turnSinceAttach = 0;
        }
      }
    }

    if (this.respawnT >= 0) {
      this.respawnT += dt;
      if (this.respawnT > 0.45 && this.respawnT - dt <= 0.45) this.respawn();
      if (this.respawnT > 0.9) {
        this.respawnT = -1;
        this.hud.fade(0, 300);
      }
      return;
    }
    if (this.endT >= 0) {
      this.endT += dt;
      p.update(dt * 0.35, this.city.world, this.playerEvents);
      this.playerEvents.length = 0;
      if (this.endT > 1.4) this.endRun(this.course.finished);
      return;
    }

    this.runTime += dt;
    // Anti-stall: dangling motionless against a wall kicks off it automatically.
    if (p.state === "swing" && p.swingTime > 1.1 && p.speed < 7) {
      this.releaseWeb();
      p.vel.addScaledVector(p.heading, 12);
      p.vel.y += 9;
    }
    this.prevPos.copy(p.pos);
    this.playerEvents.length = 0;
    p.update(dt, this.city.world, this.playerEvents);
    for (const ev of this.playerEvents) this.onPlayerEvent(ev);

    this.courseEvents.length = 0;
    if (this.respawnT < 0) this.course.update(dt, p, this.prevPos, this.courseEvents);
    for (const ev of this.courseEvents) this.onCourseEvent(ev);

    this.sfx.setWind(clamp((p.speed - 10) / 36, 0, 1));
    this.hud.setStats({
      hearts: this.hearts, maxHearts: TUNING.hearts, score: this.score, coins: this.course.coinsTaken,
      coinsTotal: this.course.coins.length, hoops: this.course.hoopsHit, hoopsTotal: this.course.hoops.length,
      time: this.runTime, mult: this.mult, combo: this.combo,
    });
  }

  /** Debug autopilot (?autopilot): flies the route so the course can be checked end to end. */
  private botInput(dt: number) {
    const p = this.player;
    this.botCooldown -= dt;
    const target = this.course.nextHoopCenter() ?? p.pos;
    const after = this.course.hoops[this.course.nextHoop + 1]?.center;
    // Corner anticipation: near a hoop, start aiming at the one after it.
    const aim = new Vector3().copy(target);
    const dist = p.pos.distanceTo(target);
    if (after && dist < 22) aim.lerp(after, 1 - dist / 22);
    const to = this.tmp.subVectors(aim, p.pos);
    const diff = wrapAngle(Math.atan2(-to.x, -to.z) - Math.atan2(-p.heading.x, -p.heading.z));
    const steer = clamp(-diff * 2.5, -1, 1);
    let vertical = 0;
    let dy = target.y - p.pos.y;
    // Obstacle awareness: if something solid is dead ahead, go over or under it.
    const fwd = new Vector3().copy(p.vel).setY(0).normalize();
    const hit = this.city.world.raycast(p.pos, fwd, 30);
    if (hit && hit.collider.kind === "obstacle") {
      const mid = (hit.collider.min.y + hit.collider.max.y) / 2;
      dy = p.pos.y > mid ? hit.collider.max.y + 3 - p.pos.y : hit.collider.min.y - 3 - p.pos.y;
    }
    if (p.state === "air") vertical = dy > 2 && p.vel.y < 0 ? 1 : dy < -5 && to.length() < 45 ? -1 : 0;
    if (p.state === "swing") vertical = dy < -3 ? -1 : dy > 2 ? 1 : 0;
    if (this.botCooldown <= 0) {
      const now = performance.now();
      if (p.state === "air" && this.candidate && p.vel.y < 0 && p.airTime > 0.25) {
        this.onWebPress(now);
        this.botCooldown = 0.2;
      } else if (p.state === "swing" && p.swingTime > 0.4 && ((p.vel.y > 0 && p.vel.y / Math.max(1, p.speed) > 0.42) || p.swingTime > 3)) {
        this.onWebPress(now);
        this.botCooldown = 0.2;
      }
    }
    return { steer, vertical };
  }

  private onPlayerEvent(ev: PlayerEvent) {
    const p = this.player;
    switch (ev.type) {
      case "crash": {
        this.web.hide();
        this.arms.onCrash();
        this.sfx.crash();
        this.rig.addTrauma(0.85);
        this.hud.flash("rgba(255,60,80,0.9)");
        this.particles.burst(p.pos.clone().addScaledVector(ev.normal, -0.6), 14, [pal("b_white"), pal("metal"), pal("suit")], { speed: 7, size: 0.28 });
        this.breakCombo();
        this.loseHeart();
        break;
      }
      case "graze":
        if (this.grazeCooldown <= 0) {
          this.rig.addTrauma(0.12);
          this.grazeCooldown = 0.35;
        }
        break;
      case "bonk":
        this.web.hide();
        this.sfx.bonk();
        this.rig.addTrauma(0.35);
        this.particles.burst(p.pos.clone().setY(0.3), 8, [pal("sidewalk"), pal("asphalt")], { speed: 5, size: 0.3, up: 4 });
        if (this.combo > 0) this.breakCombo();
        break;
      case "splash":
        this.web.hide();
        this.sfx.splash();
        this.particles.burst(p.pos.clone().setY(-1.5), 22, [pal("water_light"), pal("b_white"), pal("water")], { speed: 9, size: 0.4, up: 9, gravity: 20 });
        this.breakCombo();
        this.hud.callout("SPLASH!", "bad");
        this.loseHeart();
        if (this.hearts > 0) {
          this.respawnT = 0;
          this.hud.fade(1, 400);
        }
        break;
      default:
        break;
    }
  }

  private loseHeart() {
    this.hearts = Math.max(0, this.hearts - 1);
    if (this.hearts === 0) {
      this.endT = 0;
      this.hud.callout("OUT OF HEARTS", "bad");
    }
  }

  private respawn() {
    const cp = this.course.checkpoint;
    this.player.reset(cp.x, cp.y, cp.z, cp.yaw, "air", 16);
    this.rig.snap(this.player);
    this.candidate = null;
    this.hud.callout("CHECKPOINT", "info");
  }

  private onCourseEvent(ev: CourseEvent) {
    switch (ev.type) {
      case "hoop": {
        this.addCombo();
        const pts = (ev.centered ? 150 : 100) * this.mult;
        this.score += pts;
        this.sfx.hoop(this.combo);
        this.hud.setHoopState(ev.index, "hit");
        this.hud.callout(ev.centered ? `BULLSEYE +${pts}` : `+${pts}`, ev.centered ? "perfect" : "score");
        this.particles.burst(ev.pos, 26, [pal("hoop"), pal("hoop_stripe"), pal("coin")], { speed: 12, size: 0.45, gravity: 6, up: 1, inherit: this.player.vel });
        this.rig.addTrauma(0.1);
        break;
      }
      case "hoopMissed":
        this.hud.setHoopState(ev.index, "missed");
        this.breakCombo();
        this.hud.callout("MISSED HOOP", "bad");
        break;
      case "coin": {
        this.addCombo();
        this.score += 10 * this.mult;
        this.sfx.coin(this.combo);
        this.particles.burst(ev.pos, 6, [pal("coin"), pal("coin_rim")], { speed: 4, size: 0.22, gravity: 4, up: 1, inherit: this.player.vel });
        break;
      }
      case "checkpoint":
        if (ev.index > 0) this.hud.callout("CHECKPOINT", "info");
        break;
      case "finish":
        this.sfx.fanfare();
        this.hud.callout("FINISH!", "big");
        this.particles.burst(ev.pos, 60, [pal("coin"), pal("hoop"), pal("suit_light"), pal("b_white")], { speed: 16, size: 0.5, gravity: 8, up: 4 });
        this.web.hide();
        if (this.player.state === "swing") this.player.release();
        this.endT = 0;
        break;
    }
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
    // Center the shadow box ahead of the player and snap it to shadow texels so
    // edges don't crawl as we fly.
    const center = this.tmp.copy(this.player.pos).addScaledVector(this.player.heading, 45);
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

  private updatePointer() {
    const target = this.state === "running" ? this.course.nextHoopCenter() : null;
    if (!target) {
      this.hud.setPointer(0, 0, false);
      return;
    }
    const v = this.tmp.copy(target).applyMatrix4(this.camera.matrixWorldInverse);
    const behind = v.z > 0;
    const ndc = this.tmp.copy(target).project(this.camera);
    const onScreen = !behind && Math.abs(ndc.x) < 0.92 && Math.abs(ndc.y) < 0.88;
    if (onScreen) {
      this.hud.setPointer(0, 0, false);
      return;
    }
    const cam = this.tmp.copy(target).applyMatrix4(this.camera.matrixWorldInverse);
    this.hud.setPointer(cam.x, behind && Math.abs(cam.x) < 1 ? -1 : cam.y, true);
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
