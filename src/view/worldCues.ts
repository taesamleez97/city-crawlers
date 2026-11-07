// Cues live in the city, in the spirit of Beat Saber: you react to things in the
// scene, not to a HUD.
//
// Each web cue is a ring hanging where the web will stick, blue for the left arm
// and pink for the right, always on that side of the view. It shows up four beats
// out, pulses on every beat, and an outer ring closes onto it to land exactly on
// its beat. There it locks on with a flash and holds: a solid disc drains over the
// judge's late window, and the web counts until it empties. A hit splats a web
// across it; a miss greys it out. Webs the hero fires by itself get no ring.
//
// Each lean is a chevron board bolted to the face of its girder, right in front of
// the hero, pointing at the open gap: it stays in view all the way in, even as
// the swing dives. Its chevrons march toward the gap, fill up over the last beat
// and a half, and flash when it's time to lean.
//
// Grades and other callouts pop up where they happened.

import {
  AdditiveBlending, CanvasTexture, CircleGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial,
  type PerspectiveCamera, PlaneGeometry, SRGBColorSpace, Shape, ShapeGeometry, Sprite, SpriteMaterial, TorusGeometry, Vector3,
} from "three";

import { clamp } from "../core/math";
import { type CueRt, HAND_HOLD, type Judgment } from "../rhythm/judge";
import { BEAM_DELAY, BEAM_REACH, DODGE_OFFSET, type Route } from "../rhythm/route";
import { BEAT, type Side } from "../rhythm/song";
import { LEAN_COLOR, LEFT_COLOR, RIGHT_COLOR } from "./cueStyle";

/** Beats ahead a ring shows up, and how long its approach ring takes to close. */
const RING_LEAD = 4;
const APPROACH = 2;
/** Beats a ring holds after its beat, waiting for the web. */
const HOLD = HAND_HOLD / BEAT;
/** Beats ahead a lean sign shows up, and how long its chevrons take to fill. */
const SIGN_LEAD = 5;
const FILL = 1.5;
/** Rings never draw smaller than this fraction of their distance, so they read from far off. */
const MIN_ANGULAR = 0.05;
/** Callout lifetime, beats. */
const POP_LIFE = 1.6;
const SIGN_W = 7;
const SIGN_H = 2.2;
const CHEVRON_SCALE = 0.85;
/** Board center: same height as the girder (the hero's eye line), just in front of its face. */
const SIGN_LIFT = 0.3;
const SIGN_STANDOFF = 0.6;
const INK = "#1d2244";
const GREY = new Color(0x8a90a6);
const WHITE = new Color(0xffffff);
const RED = new Color(0xff4b55);
const MINT = new Color(0x4fd1a5);
const UP = new Vector3(0, 1, 0);

export type CalloutKind = "perfect" | "great" | "good" | "miss" | "bad" | "score" | "info";
const CALLOUT_COLOR: Record<CalloutKind, string> = {
  perfect: "#ffcc2e", great: "#9be7ff", good: "#4fd1a5", miss: "#b9bdd0", bad: "#ff4b55", score: "#ffcc2e", info: "#ffffff",
};

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

/** cueStyle's shootSvg arm on its 48-unit grid: a right arm punching up and out. */
function drawArm(g: CanvasRenderingContext2D, color: string, grow: number) {
  g.strokeStyle = g.fillStyle = color;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.lineWidth = 7 + grow;
  g.beginPath();
  g.moveTo(9, 42);
  g.lineTo(29, 20);
  g.stroke();
  g.beginPath();
  g.arc(31.5, 17, 6 + grow / 2, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 3.2 + grow;
  g.beginPath();
  g.moveTo(38, 10);
  g.lineTo(44, 4);
  g.moveTo(40.5, 15.5);
  g.lineTo(46, 14);
  g.moveTo(33, 7.5);
  g.lineTo(34, 2);
  g.stroke();
}

/** Tinted disc with the arm to use, mirrored for the left. */
const faceTexture = (side: Side, color: string) =>
  canvasTexture(256, 256, (g) => {
    g.translate(128, 128);
    const fill = g.createRadialGradient(0, 0, 30, 0, 0, 124);
    fill.addColorStop(0, rgba(color, 0.2));
    fill.addColorStop(1, rgba(color, 0.62));
    g.fillStyle = fill;
    g.beginPath();
    g.arc(0, 0, 124, 0, Math.PI * 2);
    g.fill();
    g.scale(side * 3.3, 3.3);
    g.translate(-27.5, -22);
    drawArm(g, rgba(INK, 0.75), 4);
    drawArm(g, "#ffffff", 0);
  });

/** A web stuck across the ring. */
const splatTexture = () =>
  canvasTexture(256, 256, (g) => {
    g.translate(128, 128);
    g.strokeStyle = g.fillStyle = "#ffffff";
    g.lineCap = "round";
    g.lineJoin = "round";
    const n = 10;
    const at = (i: number, r: number): [number, number] => [Math.cos((i / n) * Math.PI * 2) * r, Math.sin((i / n) * Math.PI * 2) * r];
    g.lineWidth = 7;
    for (let i = 0; i < n; i++) {
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(...at(i, 122));
      g.stroke();
    }
    g.lineWidth = 5;
    for (const r of [36, 68, 100]) {
      g.beginPath();
      g.moveTo(...at(0, r));
      for (let i = 0; i < n; i++) g.quadraticCurveTo(...at(i + 0.5, r * 0.82), ...at(i + 1, r));
      g.stroke();
    }
    g.beginPath();
    g.arc(0, 0, 16, 0, Math.PI * 2);
    g.fill();
  });

const haloTexture = () =>
  canvasTexture(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });

const boardTexture = () =>
  canvasTexture(512, 196, (g) => {
    const x0 = 8, y0 = 8, x1 = 504, y1 = 188, r = 40;
    g.beginPath();
    g.moveTo(x0 + r, y0);
    g.arcTo(x1, y0, x1, y1, r);
    g.arcTo(x1, y1, x0, y1, r);
    g.arcTo(x0, y1, x0, y0, r);
    g.arcTo(x0, y0, x1, y0, r);
    g.closePath();
    g.fillStyle = rgba(INK, 0.82);
    g.fill();
    g.lineWidth = 12;
    g.strokeStyle = LEAN_COLOR;
    g.stroke();
  });

/** A chevron pointing +X, 1.6 wide and 2.2 tall. */
function chevronGeometry() {
  const s = new Shape();
  s.moveTo(-0.75, 1.1);
  s.lineTo(0.05, 1.1);
  s.lineTo(0.85, 0);
  s.lineTo(0.05, -1.1);
  s.lineTo(-0.75, -1.1);
  s.lineTo(0.05, 0);
  s.closePath();
  return new ShapeGeometry(s);
}

const basic = (opts: ConstructorParameters<typeof MeshBasicMaterial>[0]) =>
  new MeshBasicMaterial({ transparent: true, fog: false, ...opts });

type Ring = {
  root: Group;
  body: Mesh<TorusGeometry, MeshBasicMaterial>;
  /** Faint copy drawn through walls, so a ring behind a skybridge can still be followed. */
  ghost: Mesh<TorusGeometry, MeshBasicMaterial>;
  face: Mesh<CircleGeometry, MeshBasicMaterial>;
  /** Solid disc behind the face that drains over the hold. */
  timer: Mesh<CircleGeometry, MeshBasicMaterial>;
  approach: Mesh<TorusGeometry, MeshBasicMaterial>;
  halo: Sprite;
  cue: number;
  swing: number;
  fade: number;
};

type Sign = {
  root: Group;
  board: Mesh<PlaneGeometry, MeshBasicMaterial>;
  chevrons: Array<Mesh<ShapeGeometry, MeshBasicMaterial>>;
  cue: number;
  beam: number;
  fade: number;
};

type Popup = { sprite: Sprite; pos: Vector3; born: number; px: number; aspect: number; live: boolean };

export class WorldCues {
  readonly group = new Group();
  private readonly rings: Ring[] = [];
  private readonly signs: Sign[] = [];
  private readonly popups: Popup[] = [];
  private readonly swingOf = new Map<number, number>();
  private readonly beamOf = new Map<number, number>();
  private readonly labels = new Map<string, { tex: CanvasTexture; aspect: number; lines: number }>();
  private readonly faces: Record<Side, CanvasTexture> = { [-1]: faceTexture(-1, LEFT_COLOR), [1]: faceTexture(1, RIGHT_COLOR) } as Record<Side, CanvasTexture>;
  private readonly splat = splatTexture();
  private readonly colors: Record<Side, Color> = { [-1]: new Color(LEFT_COLOR), [1]: new Color(RIGHT_COLOR) } as Record<Side, Color>;
  private readonly lean = new Color(LEAN_COLOR);
  private readonly leanDim = new Color(LEAN_COLOR).multiplyScalar(0.28);
  private readonly camPos = new Vector3();
  private readonly camUp = new Vector3();
  private readonly camFwd = new Vector3();
  private readonly v = new Vector3();
  private tanHalf = 0.7;
  private beat = 0;

  constructor(private readonly route: Route) {
    route.swings.forEach((w, i) => this.swingOf.set(w.cue.id, i));
    route.beams.forEach((b, i) => this.beamOf.set(b.cue.id, i));

    const torus = new TorusGeometry(1, 0.1, 10, 56);
    const thin = new TorusGeometry(1, 0.055, 6, 72);
    const disc = new CircleGeometry(0.93, 48);
    const halo = haloTexture();
    for (let i = 0; i < 5; i++) {
      const root = new Group();
      const h = new Sprite(new SpriteMaterial({ map: halo, blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      h.renderOrder = 9;
      const face = new Mesh(disc, basic({ map: this.faces[1], depthWrite: false, side: DoubleSide }));
      face.renderOrder = 10;
      const timer = new Mesh(disc, basic({ depthWrite: false, side: DoubleSide }));
      timer.renderOrder = 9.8;
      const ghost = new Mesh(torus, basic({ depthTest: false, depthWrite: false }));
      ghost.renderOrder = 9.5;
      const body = new Mesh(torus, basic({}));
      body.renderOrder = 11;
      // The timing signal is never hidden.
      const approach = new Mesh(thin, basic({ depthTest: false, depthWrite: false }));
      approach.renderOrder = 12;
      root.add(h, ghost, timer, face, body, approach);
      root.visible = false;
      this.group.add(root);
      this.rings.push({ root, body, ghost, face, timer, approach, halo: h, cue: -1, swing: -1, fade: 0 });
    }

    const board = new PlaneGeometry(SIGN_W, SIGN_H);
    const boardTex = boardTexture();
    const chevron = chevronGeometry();
    for (let i = 0; i < 4; i++) {
      const root = new Group();
      const b = new Mesh(board, basic({ map: boardTex, depthWrite: false, side: DoubleSide }));
      b.renderOrder = 8;
      root.add(b);
      const chevrons = [-2.2, 0, 2.2].map((x) => {
        const m = new Mesh(chevron, basic({ side: DoubleSide }));
        m.position.set(x, 0, 0.05);
        m.scale.setScalar(CHEVRON_SCALE);
        m.renderOrder = 9;
        root.add(m);
        return m;
      });
      root.visible = false;
      this.group.add(root);
      this.signs.push({ root, board: b, chevrons, cue: -1, beam: -1, fade: 0 });
    }

    const first = this.label("PERFECT", CALLOUT_COLOR.perfect).tex;
    for (let i = 0; i < 8; i++) {
      const sprite = new Sprite(new SpriteMaterial({ map: first, depthTest: false, depthWrite: false, transparent: true, fog: false }));
      sprite.renderOrder = 20;
      sprite.visible = false;
      this.group.add(sprite);
      this.popups.push({ sprite, pos: new Vector3(), born: 0, px: 0, aspect: 1, live: false });
    }
  }

  /** Everything drawable at once, so a compile pass builds every shader up front. */
  prewarm(on: boolean) {
    for (const r of this.rings) r.root.visible = on;
    for (const s of this.signs) s.root.visible = on;
    for (const p of this.popups) p.sprite.visible = on;
  }

  reset() {
    for (const r of this.rings) this.freeRing(r);
    for (const s of this.signs) this.freeSign(s);
    for (const p of this.popups) {
      p.live = false;
      p.sprite.visible = false;
    }
  }

  /** Grade callout where the cue was: under its ring (clear of the score), or out in the gap the lean heads for. */
  judged(j: Judgment) {
    const cue = j.rt.cue;
    // A missed lean ends in a bonk, which calls itself out.
    if (cue.kind === "lean" && j.grade === "miss") return;
    const at = this.v;
    if (cue.kind === "hand") {
      const w = this.route.swings[this.swingOf.get(cue.id)!];
      at.copy(w.anchor).addScaledVector(this.camUp, -Math.max(w.ring, w.anchor.distanceTo(this.camPos) * MIN_ANGULAR) * 1.9);
    } else {
      // Past the girder, down the gap: still ahead of the hero after the dodge.
      const b = this.route.beams[this.beamOf.get(cue.id)!];
      at.set(b.right.z, 0, -b.right.x).multiplyScalar(14).add(b.pos).addScaledVector(b.right, cue.side * DODGE_OFFSET);
      at.y += 1.8;
    }
    const sub = j.grade === "great" || j.grade === "good" ? (j.offset < 0 ? "EARLY" : "LATE") : undefined;
    this.say(j.grade.toUpperCase(), j.grade, at, { sub, px: j.grade === "perfect" ? 118 : 96 });
  }

  /** A web that didn't count, called out just above the ring it was meant for. */
  nudge(rt: CueRt, text: string) {
    const i = this.swingOf.get(rt.cue.id);
    if (rt.cue.kind !== "hand" || i === undefined) return;
    const w = this.route.swings[i];
    const at = this.v.copy(w.anchor).addScaledVector(this.camUp, Math.max(w.ring, w.anchor.distanceTo(this.camPos) * MIN_ANGULAR) * 1.9);
    this.say(text, "info", at, { px: 64 });
  }

  /** A callout floating in the city at `at`, about `px` tall on a 1080p screen. */
  say(text: string, kind: CalloutKind, at: Vector3, opts: { sub?: string; px?: number } = {}) {
    let p = this.popups.find((k) => !k.live);
    if (!p) p = this.popups.reduce((a, b) => (a.born < b.born ? a : b));
    const l = this.label(text, CALLOUT_COLOR[kind], opts.sub);
    p.sprite.material.map = l.tex;
    p.pos.copy(at);
    p.born = this.beat;
    p.px = (opts.px ?? 96) * (l.lines > 1 ? 1.45 : 1);
    p.aspect = l.aspect;
    p.live = true;
  }

  update(dt: number, beat: number, rts: readonly CueRt[], cam: PerspectiveCamera, webSwing: number) {
    this.beat = beat;
    this.tanHalf = Math.tan((cam.fov * Math.PI) / 360);
    this.camPos.copy(cam.position);
    this.camUp.copy(UP).applyQuaternion(cam.quaternion);
    cam.getWorldDirection(this.camFwd);

    for (const rt of rts) {
      const ahead = rt.cue.beat - beat;
      if (ahead > SIGN_LEAD) break;
      if (rt.state !== "pending" || rt.cue.auto || ahead < -0.3) continue;
      if (rt.cue.kind === "hand") {
        if (ahead > RING_LEAD || this.rings.some((r) => r.cue === rt.cue.id)) continue;
        const r = this.rings.find((k) => k.cue < 0);
        if (r) {
          r.cue = rt.cue.id;
          r.swing = this.swingOf.get(rt.cue.id)!;
          r.fade = 0;
          r.root.visible = true;
        }
      } else if (!this.signs.some((s) => s.cue === rt.cue.id)) {
        const s = this.signs.find((k) => k.cue < 0);
        if (s) this.placeSign(s, rt.cue.id);
      }
    }

    const frac = beat - Math.floor(beat);
    const pulse = Math.exp(-frac * 7);
    for (const r of this.rings) if (r.cue >= 0) this.updateRing(r, rts[r.cue], dt, beat, pulse, cam, webSwing);
    for (const s of this.signs) if (s.cue >= 0) this.updateSign(s, rts[s.cue], dt, beat, pulse);
    this.updatePopups(beat);
  }

  // ---------------------------------------------------------------- rings
  private freeRing(r: Ring) {
    r.cue = r.swing = -1;
    r.root.visible = false;
  }

  private updateRing(r: Ring, rt: CueRt, dt: number, beat: number, pulse: number, cam: PerspectiveCamera, webSwing: number) {
    const w = this.route.swings[r.swing];
    const side = rt.cue.side;
    const ahead = rt.cue.beat - beat;
    const R = Math.max(w.ring, w.anchor.distanceTo(this.camPos) * MIN_ANGULAR);
    r.root.position.copy(w.anchor);
    r.root.quaternion.copy(cam.quaternion);

    const body = r.body.material, face = r.face.material, ap = r.approach.material, halo = r.halo.material;
    const timer = r.timer.material;
    let scale = 1, opacity: number, haloOp: number;
    let apScale = 1, apOp = 0, timerK = 0;
    face.color.copy(WHITE);
    ap.color.copy(this.colors[side]).lerp(WHITE, 0.65);

    if (rt.state === "pending" && ahead > 0) {
      // Closing: the outer ring shrinks at a steady rate and touches the ring on the beat.
      const appear = clamp((RING_LEAD - ahead) / 0.6, 0, 1);
      const near = clamp(1 - ahead, 0, 1);
      r.fade = appear;
      opacity = 1;
      scale = (0.55 + 0.45 * appear) * (1 + (ahead < 3.05 ? pulse * 0.1 : 0));
      body.color.copy(this.colors[side]).lerp(WHITE, near * near * 0.5);
      face.map = this.faces[side];
      haloOp = 0.3 + 0.7 * near * near;
      halo.color.copy(this.colors[side]);
      if (ahead < APPROACH + 0.4) {
        apScale = 1 + 1.7 * Math.min(ahead / APPROACH, 1.2);
        apOp = clamp((APPROACH + 0.4 - ahead) / 0.5, 0, 1);
      }
    } else if (rt.state === "pending") {
      // Holding: locked on with a flash, then the disc drains over the late window. Shoot!
      const since = -ahead;
      const flash = Math.exp(-since * 9);
      r.fade = 1;
      opacity = 1;
      scale = 1.12 + 0.18 * flash;
      body.color.copy(this.colors[side]).lerp(WHITE, 0.45 + 0.55 * flash);
      face.map = this.faces[side];
      haloOp = 1;
      halo.color.copy(this.colors[side]).lerp(WHITE, flash);
      apScale = 1;
      apOp = 1;
      ap.color.copy(WHITE);
      timerK = clamp(1 - since / HOLD, 0, 1);
      timer.color.copy(this.colors[side]).lerp(WHITE, 0.15 + 0.85 * flash);
    } else if (rt.state === "miss") {
      const since = beat - rt.cue.beat;
      r.fade = webSwing === r.swing || since < 1.2 ? 1 : Math.max(0, r.fade - dt * 4);
      opacity = 0.75;
      scale = 0.85;
      body.color.copy(GREY);
      face.map = this.faces[side];
      face.color.copy(GREY);
      haloOp = 0;
    } else {
      // Hit, or waved through after a resume: the web is stuck to it until it lets go.
      const since = rt.state === "hit" ? beat - (rt.cue.beat + (rt.offset ?? 0) / BEAT) : 1;
      const k = Math.exp(-Math.max(0, since) * 6);
      r.fade = webSwing === r.swing || since < 0.6 ? 1 : Math.max(0, r.fade - dt * 5);
      opacity = 1;
      scale = 1 + 0.4 * k;
      body.color.copy(this.colors[side]).lerp(WHITE, 0.25 + 0.75 * k);
      face.map = this.splat;
      haloOp = 0.25 + 0.75 * k;
      halo.color.copy(WHITE).lerp(this.colors[side], 1 - k);
      if (since < 0.6) {
        apScale = 1 + since * 3.5;
        apOp = 1 - since / 0.6;
        ap.color.copy(WHITE);
      }
    }

    if (r.fade <= 0 && rt.state !== "pending") {
      this.freeRing(r);
      return;
    }
    const f = r.fade;
    r.root.scale.setScalar(R * scale * (rt.state === "pending" ? 1 : 0.6 + 0.4 * f));
    body.opacity = opacity * f;
    r.ghost.material.color.copy(body.color);
    r.ghost.material.opacity = 0.35 * opacity * f;
    face.opacity = (rt.state === "miss" ? 0.4 : 1) * f;
    halo.opacity = haloOp * f;
    r.halo.scale.setScalar(3.4);
    r.approach.visible = apOp > 0;
    r.approach.scale.setScalar(apScale);
    ap.opacity = apOp * f;
    r.timer.visible = timerK > 0;
    r.timer.scale.setScalar(Math.max(1e-3, timerK));
    timer.opacity = 0.92 * f;
  }

  // ---------------------------------------------------------------- lean signs
  private placeSign(s: Sign, cueId: number) {
    const beam = this.beamOf.get(cueId)!;
    const b = this.route.beams[beam];
    s.cue = cueId;
    s.beam = beam;
    s.fade = 0;
    // On the girder, ending at its tip, facing the oncoming hero; mirrored so the chevrons point at the gap.
    const back = this.v.set(-b.right.z, 0, b.right.x);
    s.root.position.copy(b.pos).addScaledVector(b.right, b.cue.side * (BEAM_REACH - SIGN_W / 2 - 0.3)).addScaledVector(back, SIGN_STANDOFF);
    s.root.position.y = b.pos.y + SIGN_LIFT;
    s.root.lookAt(back.add(s.root.position));
    s.root.scale.set(b.cue.side, 1, 1);
    s.root.visible = true;
  }

  private freeSign(s: Sign) {
    s.cue = s.beam = -1;
    s.root.visible = false;
  }

  private updateSign(s: Sign, rt: CueRt, dt: number, beat: number, pulse: number) {
    const ahead = rt.cue.beat - beat;
    const passed = beat > rt.cue.beat + BEAM_DELAY + 0.3;
    if (rt.state === "pending" && !passed) s.fade = clamp((SIGN_LEAD - ahead) / 0.6, 0, 1);
    else s.fade = Math.max(0, s.fade - dt * (passed ? 6 : 2.5));
    if (s.fade <= 0 && (rt.state !== "pending" || passed)) {
      this.freeSign(s);
      return;
    }

    const march = Math.floor(beat * 2) % 3;
    s.chevrons.forEach((m, k) => {
      const c = m.material.color;
      if (rt.state === "hit" || rt.state === "skipped") {
        const since = Math.max(0, -ahead);
        c.copy(MINT).lerp(WHITE, Math.exp(-since * 5));
      } else if (rt.state === "miss") {
        c.copy(RED);
      } else if (Math.abs(ahead) < 0.15) {
        c.copy(WHITE);
      } else if (ahead > FILL) {
        c.copy(this.leanDim).lerp(this.lean, k === march ? 0.85 : 0.15);
      } else {
        const lit = ahead <= FILL - (k * FILL) / 3;
        c.copy(lit ? this.lean : this.leanDim);
      }
      m.material.opacity = s.fade;
    });
    // Up close the backing thins out so the board doesn't wall off the view; the chevrons stay solid.
    const near = clamp((s.root.position.distanceTo(this.camPos) - 6) / 12, 0, 1);
    s.board.material.opacity = s.fade * (0.3 + 0.7 * near);
    const beatPulse = rt.state === "pending" && ahead < 3.05 ? pulse * 0.07 : 0;
    const flash = rt.state === "pending" ? Math.max(0, 1 - Math.abs(ahead) / 0.25) * 0.12 : 0;
    const side = s.root.scale.x < 0 ? -1 : 1;
    const k = 1 + beatPulse + flash;
    s.root.scale.set(side * k, k, k);
  }

  // ---------------------------------------------------------------- callouts
  private label(text: string, color: string, sub?: string) {
    const key = `${text}|${color}|${sub ?? ""}`;
    let l = this.labels.get(key);
    if (l) return l;
    const W = 640, H = sub ? 220 : 150;
    const tex = canvasTexture(W, H, (g) => {
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineJoin = "round";
      let size = 104;
      g.font = `${size}px Bungee, Fredoka, sans-serif`;
      const w = g.measureText(text).width;
      if (w > W - 60) {
        size = Math.floor((size * (W - 60)) / w);
        g.font = `${size}px Bungee, Fredoka, sans-serif`;
      }
      const y = sub ? 80 : H / 2;
      g.lineWidth = 20;
      g.strokeStyle = g.fillStyle = INK;
      g.strokeText(text, W / 2, y + 9);
      g.fillText(text, W / 2, y + 9);
      g.strokeText(text, W / 2, y);
      g.fillStyle = color;
      g.fillText(text, W / 2, y);
      if (sub) {
        g.font = "50px Bungee, Fredoka, sans-serif";
        g.lineWidth = 13;
        g.strokeText(sub, W / 2, 172);
        g.fillStyle = "#ffffff";
        g.fillText(sub, W / 2, 172);
      }
    });
    l = { tex, aspect: W / H, lines: sub ? 2 : 1 };
    this.labels.set(key, l);
    return l;
  }

  private updatePopups(beat: number) {
    for (const p of this.popups) {
      if (!p.live) continue;
      const k = (beat - p.born) / POP_LIFE;
      const d = this.v.subVectors(p.pos, this.camPos).dot(this.camFwd);
      if (k >= 1 || k < 0) {
        p.live = false;
        p.sprite.visible = false;
        continue;
      }
      p.sprite.visible = d > 2;
      const pop = k < 0.1 ? 0.55 + (k / 0.1) * 0.6 : k < 0.22 ? 1.15 - ((k - 0.1) / 0.12) * 0.15 : 1;
      const h = Math.max(d, 2) * this.tanHalf * 2 * (p.px / 1080) * pop;
      p.sprite.scale.set(h * p.aspect, h, 1);
      p.sprite.position.copy(p.pos).addScaledVector(this.camUp, h * k * 0.5);
      p.sprite.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    }
  }
}
