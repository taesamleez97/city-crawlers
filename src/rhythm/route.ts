// The on-rails route: the chart turned into a path down a city's streets.
//
// Each hand cue starts one swing that lasts until the next hand cue. Position is
// a function of "route beats" r: on time, r equals the music beat; after a miss
// the hero falls behind for a moment and catches up, but the path itself never
// changes. Swing tops land on the beats (that's when the next web fires), the
// bottoms fall in between, and every swing leans toward its web's anchor.
//
// A web's anchor is the ring the player shoots at. It is placed by looking out
// from the hero at the moment of the cue: up and out to the cue's side, where a
// fist lands at full stretch, so every left ring shows in the same spot on screen
// (upper left) and every right ring in its mirror.

import { Vector3 } from "three";

import { TUNING } from "../config";
import { clamp, damp, dampAngle, smoothstep } from "../core/math";
import { flightPitch } from "../view/cameraRig";
import type { CollisionWorld } from "../world/collision";
import { BEAT, type Cue, FINISH_BEAT, LEAP_BEAT, RESULTS_BEAT, type Side, sectionAt } from "./song";

const UP = new Vector3(0, 1, 0);
const SAMPLES_PER_BEAT = 16;
const LEAP_DIST = 16;
/** Forward speed varies ±40% over a swing: slow at the tops, fast through the bottom. */
const SWING_EASE = 0.4;
const CLEARANCE = 1.6;
/** Bends gentler than this (radians) don't count as corners: no forced swing side. */
const CORNER_MIN_TURN = 0.45;

/** Something across the street the rail rises over or ducks under (meters). */
export type Obstacle = { x: number; z: number; half: number; lo: number; hi: number; mode: "over" | "under" };

/** Where a city's route runs. */
export interface CourseDef {
  /** Street centerline from the start perch to the finish ring (x, z; ground plane). */
  path: Array<[number, number]>;
  /** Name of the street each path segment runs along. */
  streets: string[];
  /** Roof the hero leaps from. */
  perchY: number;
  finishY: number;
  cornerRadius: number;
  /** Height the swings top out at (default 30 m). */
  topY?: number;
  obstacles?: Obstacle[];
}

/** Lean obstacles sit this far (beats) after their cue, so an on-time lean is already clear. */
export const BEAM_DELAY = 0.5;
/** Sideways shift of a successful lean, meters. */
export const DODGE_OFFSET = 5.5;
/** How far past the path center a beam reaches. */
export const BEAM_REACH = 1.5;
const COIN_DROP = 1.6;

/** Where a ring sits in the hero's view at its cue: radians toward the cue's side, and above the view. */
export const RING_YAW = 0.5;
export const RING_EL = 0.26;
/** Camera height over the rail (see CameraRig). */
const EYE_Y = 0.3;
const RING_NEAR = 14;
const RING_FAR = 44;
/** Floating rings (no facade in the right spot) hang this far out. */
const RING_AIR = 22;
/** Ring radius for a distance: about the same size on screen wherever it hangs. */
const ringRadius = (dist: number) => clamp(dist * 0.105, 2, 4.4);

export interface Swing {
  cue: Cue;
  start: number;
  end: number;
  s0: number;
  dist: number;
  dip: number;
  sway: number;
  /** Center of the ring the web sticks to. */
  anchor: Vector3;
  /** Ring radius, meters. */
  ring: number;
}

export interface Beam {
  cue: Cue;
  /** Route beat at which the hero passes it. */
  r: number;
  /** Path point (center of the street) where it crosses. */
  pos: Vector3;
  right: Vector3;
}

export interface Coin {
  pos: Vector3;
  beam: number;
}

export interface RailSample {
  pos: Vector3;
  fwd: Vector3;
  right: Vector3;
  /** Swing index, -1 during the leap, -2 perched, -3 after the finish. */
  swing: number;
  u: number;
  /** Lowest / highest the hero may be pushed here without hitting an obstacle. */
  floor: number;
  ceil: number;
}

export const newSample = (): RailSample => ({
  pos: new Vector3(), fwd: new Vector3(0, 0, -1), right: new Vector3(1, 0, 0), swing: -2, u: 0, floor: -Infinity, ceil: Infinity,
});

/** Street centerline: the layout polyline with rounded corners, by arc length. */
class Centerline {
  private readonly xs: number[] = [];
  private readonly zs: number[] = [];
  private readonly ss: number[] = [];
  /** One per interior path point, at the middle of its rounded bend; `angle` is how far it turns. */
  readonly corners: Array<{ s: number; turn: Side; angle: number }> = [];
  length = 0;

  constructor(poly: Array<[number, number]>, radius: number) {
    const push = (x: number, z: number) => {
      const n = this.xs.length;
      if (n) {
        const d = Math.hypot(x - this.xs[n - 1], z - this.zs[n - 1]);
        if (d < 1e-6) return;
        this.ss.push(this.ss[n - 1] + d);
      } else this.ss.push(0);
      this.xs.push(x);
      this.zs.push(z);
    };
    const lineTo = (x: number, z: number) => {
      const n = this.xs.length;
      const x0 = this.xs[n - 1], z0 = this.zs[n - 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(x - x0, z - z0)));
      for (let k = 1; k <= steps; k++) push(x0 + ((x - x0) * k) / steps, z0 + ((z - z0) * k) / steps);
    };
    push(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      const [bx, bz] = poly[i];
      if (i === poly.length - 1) {
        lineTo(bx, bz);
        break;
      }
      const [ax, az] = poly[i - 1];
      const [cx, cz] = poly[i + 1];
      const l1 = Math.hypot(bx - ax, bz - az), l2 = Math.hypot(cx - bx, cz - bz);
      const d1x = (bx - ax) / l1, d1z = (bz - az) / l1, d2x = (cx - bx) / l2, d2z = (cz - bz) / l2;
      const t = Math.min(radius, l1 / 2, l2 / 2);
      const p1x = bx - d1x * t, p1z = bz - d1z * t, p2x = bx + d2x * t, p2z = bz + d2z * t;
      lineTo(p1x, p1z);
      const steps = 48;
      for (let k = 1; k <= steps; k++) {
        const q = k / steps, a = (1 - q) * (1 - q), b = 2 * (1 - q) * q, c = q * q;
        push(a * p1x + b * bx + c * p2x, a * p1z + b * bz + c * p2z);
        if (k === steps / 2) {
          // right(d1) · d2 > 0 means a right turn.
          const angle = Math.acos(clamp(d1x * d2x + d1z * d2z, -1, 1));
          this.corners.push({ s: this.ss[this.ss.length - 1], turn: -d1z * d2x + d1x * d2z > 0 ? 1 : -1, angle });
        }
      }
    }
    this.length = this.ss[this.ss.length - 1];
  }

  /** Position and unit tangent at arc length s (extrapolates past either end). */
  at(s: number, pos: Vector3, tan: Vector3) {
    const n = this.ss.length;
    let i: number;
    if (s <= 0) i = 0;
    else if (s >= this.length) i = n - 2;
    else {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (this.ss[mid] <= s) lo = mid;
        else hi = mid;
      }
      i = lo;
    }
    const seg = this.ss[i + 1] - this.ss[i];
    const t = (s - this.ss[i]) / seg;
    tan.set(this.xs[i + 1] - this.xs[i], 0, this.zs[i + 1] - this.zs[i]).divideScalar(seg);
    pos.set(this.xs[i] + (this.xs[i + 1] - this.xs[i]) * t, 0, this.zs[i] + (this.zs[i + 1] - this.zs[i]) * t);
    // Smooth the tangent across the 1 m polyline steps.
    if (i > 0 && i < n - 2) {
      const k = t - 0.5;
      const j = k < 0 ? i - 1 : i + 1;
      const sj = this.ss[j + 1] - this.ss[j];
      const w = Math.abs(k);
      tan.multiplyScalar(1 - w).add(new Vector3(this.xs[j + 1] - this.xs[j], 0, this.zs[j + 1] - this.zs[j]).multiplyScalar(w / sj));
      tan.normalize();
    }
    return pos;
  }

  project(x: number, z: number): number {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.xs.length; i++) {
      const d = (this.xs[i] - x) ** 2 + (this.zs[i] - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = this.ss[i];
      }
    }
    return best;
  }
}

type RailObstacle = { s: number; half: number; lo: number; hi: number; mode: "over" | "under" };

export class Route {
  readonly cues: Cue[];
  readonly swings: Swing[] = [];
  readonly beams: Beam[] = [];
  readonly coins: Coin[] = [];
  readonly length: number;
  readonly finish: Vector3;
  /** Direction of travel through the finish ring. */
  readonly finishDir: Vector3;
  private readonly perchY: number;
  private readonly finishY: number;
  private readonly line: Centerline;
  private readonly r0 = LEAP_BEAT;
  private readonly r1 = RESULTS_BEAT + 4;
  private readonly sS: Float32Array;
  private readonly sX: Float32Array;
  private readonly sY: Float32Array;
  private readonly sZ: Float32Array;
  private readonly sFloor: Float32Array;
  private readonly sCeil: Float32Array;
  private readonly tmpP = new Vector3();
  private readonly tmpT = new Vector3();

  constructor(world: CollisionWorld, cues: Cue[], private readonly course: CourseDef) {
    const poly = course.path;
    this.line = new Centerline(poly, course.cornerRadius);
    this.length = this.line.length;
    this.cues = cues;
    this.perchY = course.perchY + 0.9;
    this.finishY = course.finishY;
    const [fx, fz] = poly[poly.length - 1], [px, pz] = poly[poly.length - 2];
    this.finish = new Vector3(fx, course.finishY, fz);
    this.finishDir = new Vector3(fx - px, 0, fz - pz).normalize();

    this.planSwings();
    const obstacles = this.planObstacles();

    // Sample the whole ride once; the game only interpolates.
    const n = Math.ceil((this.r1 - this.r0) * SAMPLES_PER_BEAT) + 1;
    this.sS = new Float32Array(n);
    this.sX = new Float32Array(n);
    this.sY = new Float32Array(n);
    this.sZ = new Float32Array(n);
    this.sFloor = new Float32Array(n);
    this.sCeil = new Float32Array(n);
    const yRaw = new Float32Array(n);
    const lat = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const raw = this.rawAt(this.r0 + i / SAMPLES_PER_BEAT);
      this.sS[i] = raw.s;
      yRaw[i] = raw.y;
      lat[i] = raw.lat;
    }
    // Duck under / rise over the banners and skybridges with smooth bumps.
    const bump = new Float32Array(n);
    this.sFloor.fill(-1e4);
    this.sCeil.fill(1e4);
    for (const o of obstacles) {
      let need = 0;
      for (let i = 0; i < n; i++) {
        if (Math.abs(this.sS[i] - o.s) > o.half) continue;
        need = o.mode === "over" ? Math.max(need, o.lo + CLEARANCE - yRaw[i]) : Math.min(need, o.hi - CLEARANCE - yRaw[i]);
      }
      for (let i = 0; i < n; i++) {
        const w = this.window(this.sS[i], o);
        if (w <= 0) continue;
        bump[i] += need * w;
        if (o.mode === "over") this.sFloor[i] = Math.max(this.sFloor[i], o.lo + CLEARANCE - (1 - w) * 40);
        else this.sCeil[i] = Math.min(this.sCeil[i], o.hi - CLEARANCE + (1 - w) * 40);
      }
    }
    for (let i = 0; i < n; i++) {
      this.line.at(this.sS[i], this.tmpP, this.tmpT);
      const rx = -this.tmpT.z, rz = this.tmpT.x;
      this.sX[i] = this.tmpP.x + rx * lat[i];
      this.sZ[i] = this.tmpP.z + rz * lat[i];
      this.sY[i] = yRaw[i] + bump[i];
    }

    this.placeAnchors(world);
    this.placeBeams();
  }

  // ---------------------------------------------------------------- planning
  private planSwings() {
    const hands = this.cues.filter((c) => c.kind === "hand");
    const spans = hands.map((c, i) => ({ cue: c, start: c.beat, end: i + 1 < hands.length ? hands[i + 1].beat : FINISH_BEAT }));
    const weights = spans.map((sp) => (sp.end - sp.start) * sectionAt(sp.start).pace);
    const total = weights.reduce((a, b) => a + b, 0);
    let s = LEAP_DIST;
    spans.forEach((sp, i) => {
      const dist = (weights[i] / total) * (this.length - LEAP_DIST);
      this.swings.push({
        cue: sp.cue, start: sp.start, end: sp.end, s0: s, dist,
        dip: clamp(dist * 0.28, 4, 11),
        sway: clamp(dist * 0.1, 1.5, 3.5),
        anchor: new Vector3(),
        ring: 2.5,
      });
      s += dist;
    });
    // Corner swings web the inside of the turn.
    for (const c of this.line.corners) {
      if (c.angle < CORNER_MIN_TURN) continue;
      const i = this.swings.findIndex((w) => c.s >= w.s0 && c.s < w.s0 + w.dist);
      if (i < 0) continue;
      const u = (c.s - this.swings[i].s0) / this.swings[i].dist;
      const force = [i];
      if (u < 0.3 && i > 0) force.push(i - 1);
      if (u > 0.7 && i + 1 < this.swings.length) force.push(i + 1);
      for (const k of force) this.swings[k].cue.side = c.turn;
    }
  }

  private planObstacles(): RailObstacle[] {
    return (this.course.obstacles ?? []).map((o) => ({ s: this.line.project(o.x, o.z), half: o.half, lo: o.lo, hi: o.hi, mode: o.mode }));
  }

  /** 1 across the obstacle, easing to 0 over 24 m either side. */
  private window(s: number, o: RailObstacle) {
    const d = Math.abs(s - o.s) - o.half;
    if (d <= 0) return 1;
    if (d >= 24) return 0;
    return 0.5 + 0.5 * Math.cos((Math.PI * d) / 24);
  }

  private topY(s: number) {
    return (this.course.topY ?? 30) - 3 * smoothstep(this.length - 140, this.length, s);
  }

  private swingIndex(r: number) {
    let lo = 0, hi = this.swings.length - 1;
    if (r < this.swings[0].start) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.swings[mid].start <= r) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private rawAt(r: number): { s: number; y: number; lat: number } {
    const first = this.swings[0];
    const perch = this.perchY;
    if (r <= LEAP_BEAT) return { s: 0, y: perch, lat: 0 };
    if (r < first.start) {
      const u = (r - LEAP_BEAT) / (first.start - LEAP_BEAT);
      const top = this.topY(LEAP_DIST);
      const hop = 5;
      return { s: LEAP_DIST * u, y: perch + hop * u - (perch - top + hop) * u * u, lat: 0 };
    }
    if (r >= FINISH_BEAT) {
      const last = this.swings[this.swings.length - 1];
      const vEnd = ((1 - SWING_EASE) * last.dist) / (last.end - last.start);
      const e = r - FINISH_BEAT;
      return { s: this.length + vEnd * 1.6 * (1 - Math.exp(-e / 1.6)), y: this.finishY + 2.5 * (1 - Math.exp(-e / 1.2)), lat: 0 };
    }
    const w = this.swings[this.swingIndex(r)];
    const u = (r - w.start) / (w.end - w.start);
    const s = w.s0 + w.dist * (u - (SWING_EASE * Math.sin(2 * Math.PI * u)) / (2 * Math.PI));
    const sin2 = Math.sin(Math.PI * u) ** 2;
    return { s, y: this.topY(s) - w.dip * sin2, lat: w.cue.side * w.sway * sin2 };
  }

  /** The hero's eye at route beat r, shifted over if an on-time lean has it dodging then. */
  private eyeAt(r: number, leans: Cue[], smp: RailSample, out: Vector3) {
    this.sample(r, smp);
    out.copy(smp.pos);
    out.y += EYE_Y;
    const lean = leans.find((c) => r >= c.beat && r < c.beat + BEAM_DELAY + 0.8);
    if (lean) out.addScaledVector(smp.right, lean.side * DODGE_OFFSET);
    return out;
  }

  /** The camera's yaw and pitch along an on-time ride, per sample: CameraRig's smoothing replayed. */
  private simulateView() {
    const n = this.sS.length;
    const yaw = new Float32Array(n), pitch = new Float32Array(n);
    const dt = BEAT / SAMPLES_PER_BEAT;
    const at = newSample(), ahead = newSample();
    const vel = new Vector3(), step = new Vector3(), prev = new Vector3(), head = new Vector3();
    let y = 0, p = -0.1;
    for (let i = 0; i < n; i++) {
      const r = this.r0 + i / SAMPLES_PER_BEAT;
      this.sample(r, at);
      this.sample(r + 0.8, ahead);
      head.subVectors(ahead.pos, at.pos).setY(0);
      if (head.lengthSq() > 1) head.normalize();
      else head.copy(at.fwd);
      const targetYaw = Math.atan2(-head.x, -head.z);
      if (i === 0) {
        y = targetYaw;
        prev.copy(at.pos);
      }
      step.subVectors(at.pos, prev).divideScalar(dt);
      prev.copy(at.pos);
      vel.lerp(step, 1 - Math.exp(-12 * dt));
      y = dampAngle(y, targetYaw, TUNING.yawFollow, dt);
      const targetPitch = r <= LEAP_BEAT ? -0.12 : flightPitch(vel.y, Math.hypot(vel.x, vel.z));
      p = damp(p, targetPitch, TUNING.pitchFollow, dt);
      yaw[i] = y;
      pitch[i] = p;
    }
    return { yaw, pitch };
  }

  private placeAnchors(world: CollisionWorld) {
    const leans = this.cues.filter((c) => c.kind === "lean");
    const view = this.simulateView();
    const smp = newSample();
    const eye = new Vector3(), from = new Vector3(), fwd = new Vector3(), out = new Vector3();
    const dir = new Vector3(), p = new Vector3(), v = new Vector3();
    const clear = (a: Vector3, b: Vector3) => {
      v.subVectors(b, a);
      const d = v.length();
      return !world.raycast(a, v.divideScalar(d), d - 1, false);
    };
    // Is p on screen (with margin for the ring) from the on-time camera at route beat r? Narrowest FOV, to be safe.
    const tanV = Math.tan(((TUNING.fovBase / 2) * Math.PI) / 180), tanH = tanV * (16 / 9);
    const onScreen = (r: number, p: Vector3) => {
      const i = clamp(Math.round((r - this.r0) * SAMPLES_PER_BEAT), 0, view.yaw.length - 1);
      const y = view.yaw[i], pt = view.pitch[i];
      this.eyeAt(r, leans, smp, from);
      v.subVectors(p, from);
      const f = -Math.cos(pt) * Math.sin(y) * v.x + Math.sin(pt) * v.y - Math.cos(pt) * Math.cos(y) * v.z;
      if (f <= 1) return false;
      const x = (Math.cos(y) * v.x - Math.sin(y) * v.z) / f / tanH;
      const u = (Math.sin(pt) * Math.sin(y) * v.x + Math.cos(pt) * v.y + Math.sin(pt) * Math.cos(y) * v.z) / f / tanV;
      return Math.abs(x) < 0.92 && Math.abs(u) < 0.88;
    };
    for (const w of this.swings) {
      const b = w.start;
      this.eyeAt(b, leans, smp, eye);
      const vi = clamp(Math.round((b - this.r0) * SAMPLES_PER_BEAT), 0, view.yaw.length - 1);
      const viewPitch = view.pitch[vi];
      fwd.set(-Math.sin(view.yaw[vi]), 0, -Math.cos(view.yaw[vi]));
      out.set(-fwd.z, 0, fwd.x).multiplyScalar(w.cue.side);
      let best: { p: Vector3; r: number; score: number } | null = null;
      for (const dy of [0, 0.08, -0.08, 0.16, -0.16]) {
        for (const de of [0, -0.07, 0.07, -0.14, -0.21]) {
          const yaw = RING_YAW + dy, el = RING_EL + de + viewPitch;
          dir.copy(fwd).multiplyScalar(Math.cos(yaw)).addScaledVector(out, Math.sin(yaw));
          dir.multiplyScalar(Math.cos(el)).addScaledVector(UP, Math.sin(el)).normalize();
          // On a facade if one is in the right spot (stood off it so the ring never cuts in), else in the air.
          const hit = world.raycast(eye, dir, RING_FAR, true);
          if (hit && hit.dist < RING_NEAR) continue;
          let r: number;
          if (hit) {
            r = ringRadius(hit.dist);
            p.copy(hit.point).addScaledVector(hit.normal, r + 0.4);
          } else {
            r = ringRadius(RING_AIR);
            p.copy(eye).addScaledVector(dir, RING_AIR);
          }
          if (!clear(eye, p)) continue;
          // Score where it really ends up in the view, then how well it shows on the way in.
          v.subVectors(p, eye);
          const d = v.length();
          v.divideScalar(d);
          const fy = Math.atan2(v.dot(out), v.dot(fwd));
          const fe = Math.asin(v.y) - viewPitch;
          let score = Math.abs(fy - RING_YAW) * 10 + Math.abs(fe - RING_EL) * 8 + Math.abs(d - 26) * 0.05 + (hit ? 0 : 1.5);
          // The approach ring closes over the last two beats: the ring must be in sight for all of it.
          for (const k of [0.5, 1, 1.5, 2, 2.5, 3]) {
            const at = b - k;
            if (at <= LEAP_BEAT) continue;
            if (!onScreen(at, p) || !clear(this.eyeAt(at, leans, smp, from), p)) score += k <= 2 ? 3 : 1;
          }
          if (!best || score < best.score) best = { p: p.clone(), r, score };
        }
      }
      if (best) {
        w.anchor.copy(best.p);
        w.ring = best.r;
      } else {
        w.anchor.copy(eye).addScaledVector(fwd, 18).addScaledVector(out, 10).addScaledVector(UP, 6);
        w.ring = ringRadius(RING_AIR);
      }
    }
  }

  private placeBeams() {
    const smp = newSample();
    for (const cue of this.cues) {
      if (cue.kind !== "lean") continue;
      const r = cue.beat + BEAM_DELAY;
      this.sample(r, smp);
      const index = this.beams.length;
      this.beams.push({ cue, r, pos: smp.pos.clone(), right: smp.right.clone() });
      // Coins trail through the gap past the girder, hung low and far enough ahead that they're
      // collected (at r) before the hero reaches them instead of sweeping through the view.
      for (const dr of [0.45, 0.8, 1.15]) {
        this.sample(r + dr, smp);
        const pos = smp.pos.clone().addScaledVector(smp.right, cue.side * DODGE_OFFSET);
        pos.y -= COIN_DROP;
        this.coins.push({ pos, beam: index });
      }
    }
  }

  // ---------------------------------------------------------------- runtime
  sample(r: number, out: RailSample): RailSample {
    const f = clamp((r - this.r0) * SAMPLES_PER_BEAT, 0, this.sS.length - 1.001);
    const i = Math.floor(f), t = f - i;
    const L = (a: Float32Array) => a[i] + (a[i + 1] - a[i]) * t;
    out.pos.set(L(this.sX), L(this.sY), L(this.sZ));
    out.floor = L(this.sFloor);
    out.ceil = L(this.sCeil);
    this.line.at(L(this.sS), this.tmpP, out.fwd);
    out.right.set(-out.fwd.z, 0, out.fwd.x);
    if (r <= LEAP_BEAT) {
      out.swing = -2;
      out.u = 0;
    } else if (r >= FINISH_BEAT) {
      out.swing = -3;
      out.u = 0;
    } else {
      out.swing = this.swingIndex(r);
      const w = this.swings[out.swing];
      out.u = w ? (r - w.start) / (w.end - w.start) : (r - LEAP_BEAT) / (this.swings[0].start - LEAP_BEAT);
    }
    return out;
  }

  /** The street the hero is over at route beat r. */
  streetAt(r: number): string {
    const f = clamp((r - this.r0) * SAMPLES_PER_BEAT, 0, this.sS.length - 1);
    const s = this.sS[Math.round(f)];
    let k = 0;
    while (k < this.line.corners.length && this.line.corners[k].s <= s) k++;
    const names = this.course.streets;
    return names[Math.min(k, names.length - 1)] ?? "";
  }

  /** Debug summary: where corners and obstacles fall. */
  describe() {
    return {
      length: Math.round(this.length),
      swings: this.swings.length,
      beams: this.beams.length,
      corners: this.line.corners.map((c) => {
        const i = this.swings.findIndex((w) => c.s >= w.s0 && c.s < w.s0 + w.dist);
        return { s: Math.round(c.s), turn: c.turn, swing: i, beat: this.swings[i]?.start };
      }),
      speed: this.swings.map((w) => +(w.dist / ((w.end - w.start) * 0.5)).toFixed(1)),
    };
  }
}
