// The camera mirror: what the TV sees, drawn so players can tell at a glance
// where to stand and where to throw their webs.
//
//   - the live camera picture (when the host grants `media.camera`), mirrored
//   - the tracked skeleton, arms in their cue colors, glowing when extended
//   - a target ring per arm where the fist lands at full stretch, 45° up and out;
//     it lights up as that side's cue approaches and bursts on a shot
//   - an outline of the ideal spot while the framing is off, plus a coaching line
//
// Coordinates come from MotionInput's mirrored picture space, so the overlay
// lines up with the video drawn into the same frame rectangle.

import type { MotionInput, ViewPoint } from "../input/motion";
import { LEAN_COLOR, LEFT_COLOR, RIGHT_COLOR } from "./cueStyle";

const BONES: Array<[number, number]> = [[5, 6], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];
const ARMS: Array<[number, number, number]> = [[5, 7, 9], [6, 8, 10]];
const SIDE_COLOR = [LEFT_COLOR, RIGHT_COLOR];
const MINT = "#4fd1a5";
const WARN = "#ffb020";

const STATUS: Record<string, string> = {
  off: "Camera off",
  unavailable: "Camera off",
  starting: "Starting the camera…",
  "no-body": "Step in front of the TV",
  "too-close": "Step back so both raised fists fit",
  "too-far": "Come a little closer",
  "move-left": "← Move to your left",
  "move-right": "Move to your right →",
  "hands-hidden": "Show both hands",
  none: "Great spot!",
};

export interface GuideOptions {
  /** Small in-game version: no outline, coaching only when something is wrong. */
  compact?: boolean;
}

export class BodyGuide {
  readonly root: HTMLElement;
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly status: HTMLElement;
  private readonly s: number;
  private lastStatus = "";
  private hasVideo = false;
  private readonly frame = { x: 0, y: 0, w: 0, h: 0 };

  constructor(private readonly w: number, private readonly h: number, private readonly opts: GuideOptions = {}) {
    this.s = h / 450;
    this.root = document.createElement("div");
    this.root.className = `body-guide${opts.compact ? " compact" : ""}`;
    this.root.style.width = `${w}px`;
    this.root.style.height = `${h}px`;
    this.root.dataset.little = "readout";
    this.root.dataset.littleLabel = "Camera view";
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
    this.canvas = document.createElement("canvas");
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = this.canvas.getContext("2d")!;
    this.status = document.createElement("div");
    this.status.className = "guide-status";
    this.root.append(this.video, this.canvas, this.status);
  }

  setStream(stream: MediaStream | null) {
    this.hasVideo = !!stream;
    this.root.classList.toggle("has-video", this.hasVideo);
    this.video.srcObject = stream;
    if (stream) this.video.play().catch(() => {});
  }

  /** `focus[k]` (0…1) lights arm k's target: how close that side's next web cue is. */
  draw(m: MotionInput, focus: readonly [number, number] = [0, 0], now = performance.now()) {
    const { g, w, h, s } = this;
    const f = this.frame;
    const v = this.video;
    const aspect = m.frames > 0 ? m.aspect : v.videoHeight > 0 ? v.videoWidth / v.videoHeight : 16 / 9;
    f.w = w;
    f.h = w / aspect;
    if (f.h > h) {
      f.h = h;
      f.w = h * aspect;
    }
    f.x = (w - f.w) / 2;
    f.y = (h - f.h) / 2;
    if (this.hasVideo) {
      const st = this.video.style;
      st.left = `${f.x}px`;
      st.top = `${f.y}px`;
      st.width = `${f.w}px`;
      st.height = `${f.h}px`;
    }

    g.clearRect(0, 0, w, h);
    if (!this.hasVideo) this.drawBackdrop();

    const tracking = m.tracking;
    const framed = m.framed;
    if (!this.opts.compact && !framed) this.drawIdeal(now);
    if (tracking) {
      this.drawTargets(m, focus, now);
      this.drawSkeleton(m);
    } else if (this.opts.compact) {
      this.drawIdealTargets(focus);
    }

    // Frame border: green when the player is in a good spot.
    g.lineWidth = 4 * s;
    g.strokeStyle = framed ? MINT : tracking ? WARN : "rgba(255,255,255,0.35)";
    g.strokeRect(f.x + 2 * s, f.y + 2 * s, f.w - 4 * s, f.h - 4 * s);

    const key = m.state === "tracking" ? m.framing : m.state === "searching" ? "no-body" : m.state;
    const text = this.opts.compact && key === "none" ? "" : STATUS[key] ?? "";
    if (text !== this.lastStatus) {
      this.lastStatus = text;
      this.status.textContent = text;
      this.status.classList.toggle("hidden", !text);
      this.status.classList.toggle("ok", key === "none");
      this.root.dataset.littleData = JSON.stringify({ state: m.state, framing: m.framing });
    }
  }

  private px(p: { x: number; y: number }): [number, number] {
    const f = this.frame;
    return [f.x + p.x * f.w, f.y + p.y * f.h];
  }

  private drawBackdrop() {
    const { g, s } = this;
    const f = this.frame;
    const grad = g.createLinearGradient(0, f.y, 0, f.y + f.h);
    grad.addColorStop(0, "rgba(40,48,92,0.92)");
    grad.addColorStop(1, "rgba(18,22,48,0.92)");
    g.fillStyle = grad;
    g.fillRect(f.x, f.y, f.w, f.h);
    g.strokeStyle = "rgba(255,255,255,0.06)";
    g.lineWidth = 1.5 * s;
    g.beginPath();
    for (let i = 1; i < 8; i++) {
      const x = f.x + (f.w * i) / 8;
      g.moveTo(x, f.y);
      g.lineTo(x, f.y + f.h);
    }
    for (let i = 1; i < 5; i++) {
      const y = f.y + (f.h * i) / 5;
      g.moveTo(f.x, y);
      g.lineTo(f.x + f.w, y);
    }
    g.stroke();
  }

  /** The ideal spot: a Y-pose outline sized for standing about 2.5 m back. */
  private idealPose() {
    const f = this.frame;
    const u = f.h * 0.21;
    const cx = f.x + f.w / 2, sy = f.y + f.h * 0.52;
    const half = u * 0.38, reach = u * 1.1 * Math.SQRT1_2;
    return {
      u, cx, sy, half,
      head: [cx, sy - u * 0.5] as [number, number],
      hips: sy + u,
      targets: [[cx - half - reach, sy - reach], [cx + half + reach, sy - reach]] as Array<[number, number]>,
    };
  }

  private drawIdeal(now: number) {
    const { g, s } = this;
    const p = this.idealPose();
    const a = 0.55 + 0.2 * Math.sin(now / 300);
    g.save();
    g.globalAlpha = a;
    g.strokeStyle = MINT;
    g.lineWidth = 3.5 * s;
    g.setLineDash([10 * s, 8 * s]);
    g.lineCap = "round";
    g.beginPath();
    g.arc(p.head[0], p.head[1], p.u * 0.2, 0, Math.PI * 2);
    g.moveTo(p.cx - p.half, p.sy);
    g.lineTo(p.cx + p.half, p.sy);
    g.lineTo(p.cx + p.half * 0.7, p.hips);
    g.lineTo(p.cx - p.half * 0.7, p.hips);
    g.closePath();
    g.moveTo(p.cx - p.half, p.sy);
    g.lineTo(p.targets[0][0], p.targets[0][1]);
    g.moveTo(p.cx + p.half, p.sy);
    g.lineTo(p.targets[1][0], p.targets[1][1]);
    g.moveTo(p.cx - p.half * 0.7, p.hips);
    g.lineTo(p.cx - p.half * 0.8, p.hips + p.u * 0.9);
    g.moveTo(p.cx + p.half * 0.7, p.hips);
    g.lineTo(p.cx + p.half * 0.8, p.hips + p.u * 0.9);
    g.stroke();
    g.setLineDash([]);
    for (const t of p.targets) {
      g.beginPath();
      g.arc(t[0], t[1], 16 * s, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  private drawIdealTargets(focus: readonly [number, number]) {
    const p = this.idealPose();
    p.targets.forEach((t, k) => this.ring(t[0], t[1], k, focus[k], 0, false));
  }

  private drawTargets(m: MotionInput, focus: readonly [number, number], now: number) {
    const { g, s } = this;
    for (const k of [0, 1] as const) {
      const tg = m.targets[k];
      const [tx, ty] = this.px(tg);
      const arm = m.arms[k];
      const shot = Math.max(0, 1 - (now - arm.shotAt) / 380);
      // A guide line from the shoulder: the direction to punch.
      if (focus[k] > 0.05 && m.view[5 + k].ok) {
        const [sx, sy] = this.px(m.view[5 + k]);
        g.save();
        g.globalAlpha = Math.min(1, focus[k] * 1.4) * 0.8;
        g.strokeStyle = SIDE_COLOR[k];
        g.lineWidth = 4 * s;
        g.setLineDash([8 * s, 7 * s]);
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(tx, ty);
        g.stroke();
        g.restore();
      }
      this.ring(tx, ty, k, focus[k], shot, arm.extended);
    }
  }

  private ring(x: number, y: number, k: number, focus: number, shot: number, lit: boolean) {
    const { g, s } = this;
    const r = (this.opts.compact ? 30 : 26) * s;
    const color = SIDE_COLOR[k];
    g.save();
    if (focus > 0 || lit) {
      g.globalAlpha = lit ? 0.85 : 0.25 + focus * 0.5;
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, y, r * (1 + 0.15 * focus), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 0.9;
    g.strokeStyle = color;
    g.lineWidth = 5 * s;
    if (!lit && focus < 0.05) g.setLineDash([9 * s, 7 * s]);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    if (shot > 0) {
      g.globalAlpha = shot;
      g.strokeStyle = "#fff";
      g.lineWidth = 6 * s * shot;
      g.beginPath();
      g.arc(x, y, r * (1 + (1 - shot) * 1.6), 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  private drawSkeleton(m: MotionInput) {
    const { g, s } = this;
    const V = m.view;
    const P = (i: number) => this.px(V[i]);
    const line = (a: ViewPoint, b: ViewPoint) => {
      const [ax, ay] = this.px(a), [bx, by] = this.px(b);
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.stroke();
    };
    g.save();
    g.lineCap = "round";
    g.lineJoin = "round";
    const leaning = m.leanSide !== 0;
    for (const [a, b] of BONES) {
      if (!V[a].ok || !V[b].ok) continue;
      const torso = a <= 6 && b <= 12;
      g.strokeStyle = torso && leaning ? LEAN_COLOR : "rgba(255,255,255,0.85)";
      g.lineWidth = (torso ? 7 : 5) * s;
      line(V[a], V[b]);
    }
    // Shoulders are body indices 5/6 = the player's left/right.
    for (const k of [0, 1] as const) {
      const [sh, el, wr] = ARMS[k];
      const arm = m.arms[k];
      const color = SIDE_COLOR[k];
      g.strokeStyle = color;
      g.lineWidth = (arm.extended ? 11 : 8) * s;
      if (arm.extended) {
        g.shadowColor = color;
        g.shadowBlur = 18 * s;
      }
      if (V[sh].ok && V[el].ok) line(V[sh], V[el]);
      if (V[el].ok && V[wr].ok) line(V[el], V[wr]);
      g.shadowBlur = 0;
      if (V[wr].ok) {
        const [x, y] = P(wr);
        g.fillStyle = color;
        g.strokeStyle = "#1d2244";
        g.lineWidth = 3 * s;
        g.beginPath();
        g.arc(x, y, (arm.extended ? 13 : 10) * s, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        if (arm.armed && !arm.extended) {
          // Loaded: a white ring says this arm is ready to shoot.
          g.strokeStyle = "#fff";
          g.lineWidth = 2.5 * s;
          g.beginPath();
          g.arc(x, y, 16 * s, 0, Math.PI * 2);
          g.stroke();
        }
      }
    }
    if (V[0].ok && V[5].ok && V[6].ok) {
      const [x, y] = P(0);
      const [ax, ay] = P(5), [bx, by] = P(6);
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(x, y, Math.max(8 * s, Math.hypot(ax - bx, ay - by) * 0.28), 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
}
