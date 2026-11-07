// Body gestures from the television camera's pose evidence (`sense.motion`).
//
// A rhythm game needs *when* a gesture happened, not just that it did, so this
// reads the raw keypoints and timestamps each gesture where it crosses its
// threshold (interpolated between frames). Everything is measured against the
// player's own body (torso and arm length), so it works near the screen or
// across the room.
//
//   shoot: the web-shooter. An arm that was pulled in snaps out straight, up and
//          out to its own side. Holding it out does nothing; pull back to reload.
//   lean:  the shoulders shift sideways over the hips.
//
// It also judges the framing (can the camera follow both fists at full
// stretch?) so the UI can coach the player into place.

import type { LittlePlatform } from "../platform/little";
import type { Side } from "../rhythm/song";

type Handlers = Parameters<LittlePlatform["motion"]>[0];
type Frame = Parameters<NonNullable<Handlers["onFrame"]>>[0];
type Caps = Parameters<NonNullable<Handlers["onCapabilities"]>>[0];
type Status = Parameters<NonNullable<Handlers["onStatus"]>>[0];

export type TrackState = "off" | "starting" | "searching" | "tracking" | "unavailable";
export type MotionEvent =
  | { type: "shoot"; side: Side; t: number }
  | { type: "lean"; side: Side; t: number }
  | { type: "leanEnd"; t: number };
export type FrameIssue = "none" | "no-body" | "too-close" | "too-far" | "move-left" | "move-right" | "hands-hidden";

export const LANDMARKS = [
  "nose", "left_eye", "right_eye", "left_ear", "right_ear",
  "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist",
  "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle",
] as const;
const INDEX = new Map<string, number>(LANDMARKS.map((n, i) => [n, i]));
const [LS, RS, LE, RE, LW, RW, LH, RH] = [5, 6, 7, 8, 9, 10, 11, 12];

const MIN_CONFIDENCE = 0.3;
/** A shot: the wrist reaches this share of the arm's length… */
const SHOOT_REACH = 0.8;
/** …with the elbow this straight (shoulder→wrist over shoulder→elbow→wrist)… */
const SHOOT_STRAIGHT = 0.9;
/** …pointing between a little below straight out and a little past straight up (radians). */
const AIM_MIN = -0.5;
const AIM_MAX = 2.0;
/** The arm must come back in (bent or pulled close) before it can shoot again. */
const REARM_REACH = 0.62;
const REARM_STRAIGHT = 0.8;
/** Wrist out of the picture (thrown high): the upper arm at this share of its length counts. */
const ELBOW_REACH = 0.85;
/** Where coaching puts the fists: full stretch, 45° up and out. */
const TARGET_ANGLE = Math.PI / 4;
const LEAN_ON = 0.16;
const LEAN_OFF = 0.08;
const LOST_AFTER_MS = 700;
const HANDS_HIDDEN_AFTER_MS = 600;
/** Picture margins (share of the frame) the fists must stay inside. */
const EDGE = 0.03;

export interface ArmState {
  /** Shoulder, elbow and wrist all seen this frame. */
  ok: boolean;
  /** Shoulder→wrist distance over the player's arm length. */
  reach: number;
  /** Shoulder→wrist over shoulder→elbow→wrist: 1 = elbow locked straight. */
  straight: number;
  /** Arm direction, radians: 0 = straight out to its side, π/2 = straight up. */
  angle: number;
  /** The shot trigger; a shot fires as it crosses 1. */
  power: number;
  /** Pulled in since the last shot, so the next extension fires. */
  armed: boolean;
  /** Out straight in a shooting direction right now. */
  extended: boolean;
  /** Arm vector in arm lengths: toward its own side, and up. */
  out: number;
  up: number;
  /** performance.now() of the last shot, for the UI. */
  shotAt: number;
}

/** A point in the mirrored camera picture: 0…1 across and down, the player's right on the right. */
export interface ViewPoint {
  x: number;
  y: number;
  ok: boolean;
}

const newArm = (): ArmState => ({
  ok: false, reach: 0, straight: 0, angle: -Math.PI / 2, power: 0, armed: false, extended: false, out: 0, up: -1, shotAt: -1e9,
});

export class MotionInput {
  state: TrackState = "off";
  reason = "";
  /** Calibrated lean in torso lengths; positive = the player's right. */
  lean = 0;
  leanSide: 0 | Side = 0;
  /** [left, right] */
  readonly arms: [ArmState, ArmState] = [newArm(), newArm()];
  /** Keypoints in the mirrored camera picture. */
  readonly view: ViewPoint[] = LANDMARKS.map(() => ({ x: 0, y: 0, ok: false }));
  /** Where each fist lands at full stretch (mirrored picture coordinates). */
  readonly targets: [ViewPoint, ViewPoint] = [{ x: 0.3, y: 0.2, ok: false }, { x: 0.7, y: 0.2, ok: false }];
  /** Camera picture width / height. */
  aspect = 16 / 9;
  framing: FrameIssue = "no-body";
  /** Seconds the framing has been good. */
  framingOkFor = 0;
  /** Learned arm lengths in torso lengths [left, right]. */
  readonly armLen: [number, number] = [1.1, 1.1];
  frames = 0;
  rateHz = 0;
  latencyMs = 0;
  private lastBodyAt = 0;
  private lastFrameAt = 0;
  private wristsSeenAt = 0;
  private stop: (() => void) | null = null;
  private readonly queue: MotionEvent[] = [];
  private readonly X = new Float32Array(17);
  private readonly Y = new Float32Array(17);
  private readonly ok = new Uint8Array(17);
  private readonly upperLen: [number, number] = [0.6, 0.6];
  private prevT = 0;
  private readonly prevM: [number, number] = [NaN, NaN];
  private prevLean = 0;
  private baseline = 0;
  private readonly recentLean: number[] = [];
  private clock: "epoch" | "perf" | "unknown" | null = null;
  private minDelta = Infinity;
  private expectedLatency = 60;
  private readonly extraLatency = Number(new URLSearchParams(location.search).get("motionOffset") ?? 0) || 0;
  private readonly accuracy = new URLSearchParams(location.search).get("accuracy") === "high" ? "high" : "standard";
  private rateWindow = { t: 0, n: 0 };

  constructor(private readonly little: LittlePlatform) {}

  get available() {
    return this.state !== "unavailable" && this.state !== "off";
  }
  get tracking() {
    return this.state === "tracking";
  }
  get framed() {
    return this.tracking && this.framing === "none";
  }

  start() {
    if (this.stop) return;
    if (!this.little.can("sense.motion")) {
      this.state = "unavailable";
      this.reason = "not granted";
      return;
    }
    this.state = "starting";
    this.reason = "";
    this.stop = this.little.motion(
      {
        onCapabilities: (c) => this.onCapabilities(c),
        onStatus: (s) => this.onStatus(s),
        onFrame: (f) => this.onFrame(f),
      },
      { channels: ["body.pose-2d"], rateHz: 30, maximumEntities: 1, accuracy: this.accuracy },
    );
  }

  close() {
    this.stop?.();
    this.stop = null;
    this.state = "off";
  }

  drain(): MotionEvent[] {
    return this.queue.splice(0, this.queue.length);
  }

  /** Call every frame: notices when the player has left the camera's view. */
  update(now = performance.now()) {
    if (this.state === "tracking" && now - this.lastBodyAt > LOST_AFTER_MS) {
      this.state = "searching";
      for (const a of this.arms) {
        a.ok = a.extended = a.armed = false;
        a.power = 0;
      }
      this.prevM[0] = this.prevM[1] = NaN;
      if (this.leanSide !== 0) this.queue.push({ type: "leanEnd", t: now });
      this.leanSide = 0;
    }
    if (this.state !== "tracking") {
      this.framing = "no-body";
      this.framingOkFor = 0;
      for (const p of this.view) p.ok = false;
    }
  }

  /** Take the current standing posture as "not leaning" (call while the player stands still). */
  calibrateLean() {
    if (this.recentLean.length < 5) return;
    const sorted = [...this.recentLean].sort((a, b) => a - b);
    this.baseline = sorted[Math.floor(sorted.length / 2)];
  }

  debugText() {
    const f = (v: number) => v.toFixed(2);
    const arm = (a: ArmState, k: number) =>
      `${k ? "R" : "L"} ${a.ok ? "ok" : "--"} reach ${f(a.reach)} str ${f(a.straight)} ang ${Math.round((a.angle * 180) / Math.PI)}° ` +
      `pow ${f(a.power)} ${a.armed ? "ARMED" : "     "} len ${f(this.armLen[k])}`;
    return [
      `motion ${this.state}${this.reason ? ` (${this.reason})` : ""} ${this.rateHz.toFixed(0)} Hz, latency ${this.latencyMs.toFixed(0)} ms, clock ${this.clock ?? "?"}, ${this.accuracy}`,
      `framing ${this.framing} ${this.framingOkFor.toFixed(1)}s, aspect ${this.aspect.toFixed(2)}`,
      arm(this.arms[0], 0),
      arm(this.arms[1], 1),
      `lean ${f(this.lean)} side ${this.leanSide}`,
    ].join("\n");
  }

  // ---------------------------------------------------------------- host callbacks
  private onCapabilities(c: Caps) {
    const ch = c.channels.find((x) => x.id === "body.pose-2d");
    if (ch?.expectedLatencyMs) this.expectedLatency = ch.expectedLatencyMs;
    console.info(`[motion] ${ch ? `${ch.nominalRateHz} Hz, ~${ch.expectedLatencyMs} ms` : "no body.pose-2d channel"}; clocks ${JSON.stringify(c.clocks)}`);
  }

  private onStatus(s: Status) {
    console.info(`[motion] status ${s.state}${s.reason ? ` (${s.reason})` : ""}`);
    if (s.state === "unavailable" || s.state === "ended") {
      this.state = "unavailable";
      this.reason = s.reason ?? s.state;
      this.stop = null;
    } else if (s.state === "starting") {
      this.state = "starting";
    } else if (this.state !== "tracking") {
      this.state = "searching";
    }
  }

  private onFrame(f: Frame) {
    const receipt = performance.now();
    this.countRate(receipt);
    const frameDt = this.lastFrameAt ? Math.min(0.2, (receipt - this.lastFrameAt) / 1000) : 0;
    this.lastFrameAt = receipt;
    const entity = f.entities[0];
    const pose = entity?.state !== "missing" ? entity?.channels.find((c) => c.channelId === "body.pose-2d")?.bodyPose2d : undefined;
    if (!pose) return;

    const w = f.image.width || 16, h = f.image.height || 9;
    const rot = ((f.image.rotationDegrees % 360) + 360) % 360;
    const aspect = rot === 90 || rot === 270 ? h / w : w / h;
    this.aspect = aspect;
    const mirrorView = !f.image.mirrored;
    // Pixels or 0..1? Off-picture joints can be extrapolated well past 1, so only confident ones decide.
    let pixels = false;
    for (const l of pose.landmarks) {
      if (l.position && l.state !== "missing" && l.confidence >= MIN_CONFIDENCE && (l.position.x > 4 || l.position.y > 4)) pixels = true;
    }
    this.ok.fill(0);
    for (const l of pose.landmarks) {
      const i = INDEX.get(l.name);
      if (i === undefined || !l.position || l.state === "missing" || l.confidence < MIN_CONFIDENCE) continue;
      let x = pixels ? l.position.x / w : l.position.x;
      let y = pixels ? l.position.y / h : l.position.y;
      if (rot === 90) [x, y] = [1 - y, x];
      else if (rot === 180) [x, y] = [1 - x, 1 - y];
      else if (rot === 270) [x, y] = [y, 1 - x];
      // X is in picture heights so distances are true; view is the mirrored picture.
      this.X[i] = x * aspect;
      this.Y[i] = y;
      this.ok[i] = 1;
      const v = this.view[i];
      v.x = mirrorView ? 1 - x : x;
      v.y = y;
    }
    for (let i = 0; i < 17; i++) this.view[i].ok = !!this.ok[i];
    if (!this.ok[LS] || !this.ok[RS]) return;

    const t = this.toPerf(f.capturedAtMs, receipt);
    this.latencyMs += (receipt - t - this.latencyMs) * 0.1;
    this.lastBodyAt = receipt;
    this.frames++;
    if (this.state !== "tracking") {
      this.state = "tracking";
      this.prevT = t;
    }

    const { X, Y, ok } = this;
    const msX = (X[LS] + X[RS]) / 2, msY = (Y[LS] + Y[RS]) / 2;
    const shoulderW = Math.hypot(X[RS] - X[LS], Y[RS] - Y[LS]);
    const hasHips = !!(ok[LH] && ok[RH]);
    const mhX = (X[LH] + X[RH]) / 2, mhY = (Y[LH] + Y[RH]) / 2;
    const tl = Math.max(1e-3, hasHips ? Math.hypot(msX - mhX, msY - mhY) : shoulderW * 1.35);
    // Direction of the player's right in the picture (the camera may or may not mirror).
    const rightX = X[RS] >= X[LS] ? 1 : -1;

    // ---- arms
    for (const k of [0, 1] as const) {
      const side: Side = k === 0 ? -1 : 1;
      const sh = k === 0 ? LS : RS, el = k === 0 ? LE : RE, wr = k === 0 ? LW : RW;
      const outX = rightX * side;
      const a = this.arms[k];
      let m = NaN;
      a.ok = !!(ok[el] && ok[wr]);
      if (a.ok) {
        const upper = Math.hypot(X[el] - X[sh], Y[el] - Y[sh]) / tl;
        const fore = Math.hypot(X[wr] - X[el], Y[wr] - Y[el]) / tl;
        const vx = ((X[wr] - X[sh]) * outX) / tl, vy = (Y[sh] - Y[wr]) / tl;
        const d = Math.hypot(vx, vy);
        a.straight = d / Math.max(1e-3, upper + fore);
        if (a.straight > 0.85) this.learnArm(k, upper, upper + fore);
        const len = this.armLen[k];
        a.reach = d / len;
        a.angle = Math.atan2(vy, vx);
        a.out = vx / len;
        a.up = vy / len;
        m = Math.min(a.reach / SHOOT_REACH, a.straight / SHOOT_STRAIGHT);
        if (a.angle < AIM_MIN || a.angle > AIM_MAX) m = Math.min(m, 0.6);
        if (!a.armed && (a.reach < REARM_REACH || a.straight < REARM_STRAIGHT)) a.armed = true;
      } else if (ok[el]) {
        const vx = ((X[el] - X[sh]) * outX) / tl, vy = (Y[sh] - Y[el]) / tl;
        a.angle = Math.atan2(vy, vx);
        a.reach = Math.hypot(vx, vy) / this.upperLen[k];
        a.out = (vx / this.upperLen[k]) * 0.5;
        a.up = (vy / this.upperLen[k]) * 0.5;
        m = a.angle > 0.15 && a.angle <= AIM_MAX ? a.reach / ELBOW_REACH : Math.min(0.6, a.reach);
        if (!a.armed && a.angle < -0.6) a.armed = true;
      }
      if (Number.isFinite(m)) {
        const pm = this.prevM[k];
        if (a.armed && m >= 1 && !(pm >= 1)) {
          let tc = t;
          if (Number.isFinite(pm) && m > pm && t > this.prevT) tc = this.prevT + ((1 - pm) / (m - pm)) * (t - this.prevT);
          this.queue.push({ type: "shoot", side, t: tc });
          a.armed = false;
          a.shotAt = receipt;
        }
        a.power = m;
        a.extended = m >= 1;
      } else {
        a.power = 0;
        a.extended = false;
      }
      this.prevM[k] = m;
    }

    // ---- framing: can both fists reach full stretch inside the picture?
    if (ok[LW] || ok[RW]) this.wristsSeenAt = receipt;
    let out = 0, outSide = 0;
    for (const k of [0, 1] as const) {
      const sh = k === 0 ? LS : RS;
      const outX = rightX * (k === 0 ? -1 : 1);
      const reach = this.armLen[k] * tl;
      const px = (X[sh] + outX * reach * Math.cos(TARGET_ANGLE)) / aspect;
      const py = Y[sh] - reach * Math.sin(TARGET_ANGLE);
      const tg = this.targets[k];
      tg.x = mirrorView ? 1 - px : px;
      tg.y = py;
      tg.ok = px >= EDGE && px <= 1 - EDGE && py >= EDGE;
      if (!tg.ok) {
        out++;
        outSide = tg.x < 0.5 ? -1 : 1;
      }
    }
    let issue: FrameIssue = "none";
    const headCut = !ok[0] && msY < 0.25;
    if (tl > 0.45 || headCut || out === 2 || (out === 1 && this.targets.some((tg) => tg.y < EDGE))) issue = "too-close";
    else if (out === 1) issue = outSide < 0 ? "move-right" : "move-left";
    else if (tl < 0.1) issue = "too-far";
    else if (receipt - this.wristsSeenAt > HANDS_HIDDEN_AFTER_MS) issue = "hands-hidden";
    this.framing = issue;
    this.framingOkFor = issue === "none" ? this.framingOkFor + frameDt : 0;

    // ---- lean
    const raw = hasHips ? ((msX - mhX) * rightX) / tl : (0.7 * (Y[RS] - Y[LS])) / Math.max(1e-3, shoulderW);
    const armsIn = !this.arms[0].extended && !this.arms[1].extended;
    if (armsIn) {
      this.recentLean.push(raw);
      if (this.recentLean.length > 30) this.recentLean.shift();
    }
    const lean = raw - this.baseline;
    const prev = this.prevLean;
    if (this.leanSide === 0) {
      if (Math.abs(lean) >= LEAN_ON) {
        const side: Side = lean > 0 ? 1 : -1;
        const target = side * LEAN_ON;
        let tc = t;
        if (Math.abs(lean - prev) > 1e-4 && t > this.prevT) tc = this.prevT + Math.min(1, Math.max(0, (target - prev) / (lean - prev))) * (t - this.prevT);
        this.leanSide = side;
        this.queue.push({ type: "lean", side, t: tc });
      } else if (armsIn && Math.abs(lean) < 0.05) {
        // Slowly follow posture drift while standing straight.
        this.baseline += (raw - this.baseline) * 0.01;
      }
    } else if (lean * this.leanSide < LEAN_OFF) {
      this.leanSide = 0;
      this.queue.push({ type: "leanEnd", t });
    }
    this.lean = lean;
    this.prevLean = lean;
    this.prevT = t;
  }

  /** Arm length: grows quickly toward the longest a straight arm has looked, shrinks slowly. */
  private learnArm(k: 0 | 1, upper: number, total: number) {
    const L = this.armLen[k];
    this.armLen[k] = Math.min(1.6, Math.max(0.75, L + (total - L) * (total > L ? 0.25 : 0.003)));
    const U = this.upperLen[k];
    this.upperLen[k] = Math.min(0.9, Math.max(0.35, U + (upper - U) * (upper > U ? 0.25 : 0.003)));
  }

  /** Map the provider's capture time onto performance.now(). */
  private toPerf(ms: number, receipt: number): number {
    let t: number;
    if (!Number.isFinite(ms) || ms <= 0) {
      t = receipt - this.expectedLatency;
    } else {
      if (this.clock === null) {
        if (Math.abs(ms - Date.now()) < 10_000) this.clock = "epoch";
        else if (Math.abs(ms - receipt) < 10_000) this.clock = "perf";
        else this.clock = "unknown";
        console.info(`[motion] capture clock: ${this.clock}`);
      }
      if (this.clock === "epoch") t = ms - performance.timeOrigin;
      else if (this.clock === "perf") t = ms;
      else {
        // Unknown epoch: the smallest receipt delay seen is offset + minimum latency.
        this.minDelta = Math.min(this.minDelta + 0.05, receipt - ms);
        t = ms + this.minDelta - this.expectedLatency * 0.8;
      }
    }
    return Math.min(t, receipt) - this.extraLatency;
  }

  private countRate(now: number) {
    const r = this.rateWindow;
    if (!r.t) r.t = now;
    r.n++;
    if (now - r.t >= 2000) {
      this.rateHz = (r.n * 1000) / (now - r.t);
      r.t = now;
      r.n = 0;
    }
  }
}
