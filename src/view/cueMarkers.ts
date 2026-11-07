// In-world cue markers: a target on each upcoming web anchor with an approach ring
// that closes on the beat, and an arrow on the safe side of each girder.

import { CanvasTexture, Color, Group, type PerspectiveCamera, Sprite, SpriteMaterial, Vector3 } from "three";

import type { CueRt } from "../rhythm/judge";
import { DODGE_OFFSET, type Route } from "../rhythm/route";
import { LEAD_BEATS } from "../rhythm/song";
import { HAND_PATH, LEFT_COLOR, LEAN_COLOR, RIGHT_COLOR } from "./cueStyle";

const SIZE = 0.085;

function canvasTexture(draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.translate(64, 64);
  draw(g);
  return new CanvasTexture(c);
}

const targetTexture = () =>
  canvasTexture((g) => {
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.beginPath();
    g.arc(0, 0, 50, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 10;
    g.strokeStyle = "#ffffff";
    g.stroke();
    g.save();
    g.scale(2.6, 2.6);
    g.translate(-12, -12);
    g.fillStyle = "#ffffff";
    g.fill(new Path2D(HAND_PATH));
    g.restore();
  });

const ringTexture = () =>
  canvasTexture((g) => {
    g.lineWidth = 7;
    g.strokeStyle = "#ffffff";
    g.beginPath();
    g.arc(0, 0, 58, 0, Math.PI * 2);
    g.stroke();
  });

const arrowTexture = () =>
  canvasTexture((g) => {
    g.lineJoin = "round";
    g.lineCap = "round";
    for (const [x, w] of [[-22, 14], [14, 14]] as const) {
      g.beginPath();
      g.moveTo(x - 16, -36);
      g.lineTo(x + 18, 0);
      g.lineTo(x - 16, 36);
      g.lineWidth = w + 12;
      g.strokeStyle = "rgba(29,34,68,0.85)";
      g.stroke();
      g.lineWidth = w;
      g.strokeStyle = "#ffffff";
      g.stroke();
    }
  });

type Marker = { target: Sprite; ring: Sprite; cue: number; pop: number };

export class CueMarkers {
  readonly group = new Group();
  private readonly markers: Marker[] = [];
  private readonly arrows: Sprite[] = [];
  private readonly swingOf = new Map<number, number>();
  private readonly beamOf = new Map<number, number>();
  private readonly colors = { L: new Color(LEFT_COLOR), R: new Color(RIGHT_COLOR), lean: new Color(LEAN_COLOR), grey: new Color(0x8a90a6) };

  constructor(private readonly route: Route) {
    route.swings.forEach((w, i) => this.swingOf.set(w.cue.id, i));
    route.beams.forEach((b, i) => this.beamOf.set(b.cue.id, i));
    const target = targetTexture(), ring = ringTexture(), arrow = arrowTexture();
    const sprite = (map: CanvasTexture) => {
      const s = new Sprite(new SpriteMaterial({ map, depthTest: false, depthWrite: false, transparent: true, fog: false }));
      s.renderOrder = 12;
      s.visible = false;
      this.group.add(s);
      return s;
    };
    for (let i = 0; i < 4; i++) this.markers.push({ target: sprite(target), ring: sprite(ring), cue: -1, pop: 0 });
    for (let i = 0; i < 3; i++) this.arrows.push(sprite(arrow));
  }

  reset() {
    for (const m of this.markers) {
      m.cue = -1;
      m.pop = 0;
    }
  }

  /** A web connected: the marker bursts instead of fading. */
  pop(cueId: number) {
    const m = this.markers.find((k) => k.cue === cueId);
    if (m) m.pop = 1;
  }

  update(dt: number, beat: number, rts: CueRt[], cam: PerspectiveCamera) {
    const px = Math.tan((cam.fov * Math.PI) / 360);
    const sizeAt = (p: Vector3) => p.distanceTo(cam.position) * px * SIZE;

    // Free markers whose cue has finished animating.
    for (const m of this.markers) {
      if (m.cue < 0) continue;
      const rt = rts[m.cue];
      if (m.pop > 0) m.pop = Math.max(0, m.pop - dt * 3.5);
      const done = rt.state !== "pending" && m.pop <= 0 && (rt.state !== "miss" || beat - rt.cue.beat > 0.6);
      if (done || beat - rt.cue.beat > 1.5) {
        m.cue = -1;
        m.target.visible = m.ring.visible = false;
      }
    }

    let arrow = 0;
    for (const rt of rts) {
      const ahead = rt.cue.beat - beat;
      if (ahead > LEAD_BEATS + 0.5) break;
      if (rt.cue.kind === "lean") {
        if (rt.state !== "pending" || ahead < -0.5 || arrow >= this.arrows.length) continue;
        const b = this.route.beams[this.beamOf.get(rt.cue.id)!];
        const s = this.arrows[arrow++];
        s.position.copy(b.pos).addScaledVector(b.right, rt.cue.side * DODGE_OFFSET);
        s.position.y += 2.4;
        s.material.color.copy(this.colors.lean);
        s.material.rotation = rt.cue.side > 0 ? 0 : Math.PI;
        s.material.opacity = Math.min(1, (LEAD_BEATS + 0.5 - ahead) / 1);
        s.scale.setScalar(sizeAt(s.position) * 1.1 * (1 + 0.08 * Math.sin(beat * Math.PI * 2)));
        s.visible = true;
        continue;
      }
      if (ahead < -1.5) continue;
      let m = this.markers.find((k) => k.cue === rt.cue.id);
      if (!m) {
        if (rt.state !== "pending") continue;
        m = this.markers.find((k) => k.cue < 0);
        if (!m) continue;
        m.cue = rt.cue.id;
        m.pop = 0;
      }
      const w = this.route.swings[this.swingOf.get(rt.cue.id)!];
      const color = rt.state === "miss" ? this.colors.grey : rt.cue.side < 0 ? this.colors.L : this.colors.R;
      const base = sizeAt(w.anchor);
      const fadeIn = Math.min(1, (LEAD_BEATS + 0.5 - ahead) / 1);
      m.target.position.copy(w.anchor);
      m.target.material.color.copy(color);
      m.ring.position.copy(w.anchor);
      m.ring.material.color.copy(color);
      if (rt.state === "hit") {
        m.target.scale.setScalar(base * (1 + (1 - m.pop) * 1.4));
        m.target.material.opacity = m.pop;
        m.ring.visible = false;
      } else if (rt.state === "miss") {
        m.target.scale.setScalar(base * 0.8);
        m.target.material.opacity = Math.max(0, 0.6 - (beat - rt.cue.beat));
        m.ring.visible = false;
      } else {
        m.target.scale.setScalar(base * (ahead < 1 ? 1 + 0.15 * (1 - Math.abs(ahead)) : 1));
        m.target.material.opacity = fadeIn;
        const k = Math.max(0, ahead) / LEAD_BEATS;
        m.ring.scale.setScalar(base * (1 + k * 2.2));
        m.ring.material.opacity = fadeIn * (ahead > -0.2 ? 1 : 0);
        m.ring.visible = true;
      }
      m.target.visible = true;
    }
    for (let i = arrow; i < this.arrows.length; i++) this.arrows[i].visible = false;
  }
}
