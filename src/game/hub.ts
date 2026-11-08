// The rooftop city selector. A portal to each city hangs on the buildings around
// the start roof; the player aims an arm at one and shoots a web at it, the same
// punch the run asks for.

import {
  AdditiveBlending, CanvasTexture, CircleGeometry, Color, Euler, Group, Mesh, MeshBasicMaterial, SRGBColorSpace, Sprite,
  SpriteMaterial, type Texture, TorusGeometry, Vector3,
} from "three";

import { clamp, damp } from "../core/math";
import { AIM_MAX, AIM_MIN, type ArmState, DEFAULT_AIM, EYE_SHOULDER } from "../input/motion";
import { RING_EL, RING_YAW } from "../rhythm/route";
import type { Side } from "../rhythm/song";
import { type CityId, type CityStyle, cityById } from "../world/cities";
import type { CollisionWorld } from "../world/collision";

/** The view rests a little upward on the rooftop, so the high portals sit comfortably in frame. */
export const HUB_PITCH = 0.06;
/** Left to right, as the portals stand and the buttons line up. */
export const HUB_ORDER: CityId[] = ["seoul", "nyc", "tokyo", "la"];
/**
 * Camera-space spots (radians right of center, above center) on the arcs an arm sweeps
 * (see `armAim`): the outer pair low, the inner pair high, so no two are near each other.
 */
const SLOTS: Record<CityId, { yaw: number; el: number }> = {
  seoul: { yaw: -0.64, el: 0.1 },
  nyc: { yaw: -0.3, el: 0.21 },
  tokyo: { yaw: 0.3, el: 0.21 },
  la: { yaw: 0.64, el: 0.1 },
};
const RADIUS = 6;
/** All portals look this big, mounted near or far: scaled as if hung at this distance. */
const VIEW_DIST = 44;
/** An aim this close (radians) to a portal's center picks it. */
const PICK = 0.36;
/** A raised arm: far enough out of the shoulder to read a direction from. */
const RAISED_REACH = 0.3;

const AIM_R = Math.hypot(RING_YAW - EYE_SHOULDER.yaw, RING_EL - EYE_SHOULDER.el);
const AIM_OFFSET = Math.atan2(RING_EL - EYE_SHOULDER.el, RING_YAW - EYE_SHOULDER.yaw) - Math.atan2(DEFAULT_AIM.up, DEFAULT_AIM.out);

export const armRaised = (a: ArmState) => a.ok && a.reach > RAISED_REACH && a.angle >= AIM_MIN && a.angle <= AIM_MAX;

/**
 * Where an arm points in the view: `aimToward` run backwards, by direction only (the
 * arm's angle, not its reach, which is too jittery to steer by). Swinging the arm from
 * out to the side up over the head sweeps an arc from low on its own side to high in
 * the middle. Returns camera-space yaw (to the right) and elevation.
 */
export function armAim(side: Side, angle: number) {
  const phi = angle + AIM_OFFSET;
  return { yaw: side * (EYE_SHOULDER.yaw + AIM_R * Math.cos(phi)), el: EYE_SHOULDER.el + AIM_R * Math.sin(phi) };
}

/** Camera-space unit direction for a yaw and elevation. */
export const camDir = (yaw: number, el: number, out = new Vector3()) =>
  out.set(Math.sin(yaw) * Math.cos(el), Math.sin(el), -Math.cos(yaw) * Math.cos(el));

export interface Portal {
  city: CityStyle;
  group: Group;
  center: Vector3;
  scale: number;
  ring: MeshBasicMaterial;
  rim: MeshBasicMaterial;
  swirl: Mesh;
  label: Sprite;
  labelArt: Label;
  color: Color;
  hover: number;
}

/** A portal's label canvas, redrawn when the city's best changes. */
type Label = { c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: CanvasTexture; best: number };
const LABEL_W = 560, LABEL_H = 300;
/** World width of a label at rest; its top sits just under the ring. */
const LABEL_SIZE = 15;
const LABEL_Y = -(RADIUS + 0.65 + (LABEL_SIZE * LABEL_H) / LABEL_W / 2);

export class Hub {
  readonly group = new Group();
  readonly portals: Portal[] = [];
  private readonly textures: Texture[] = [];
  private t = 0;
  private readonly v = new Vector3();

  /** `eye` is the rooftop camera position; it faces north (-z) at HUB_PITCH. */
  constructor(world: CollisionWorld, eye: Vector3) {
    const view = new Euler(HUB_PITCH, 0, 0, "YXZ");
    const swirlTex = this.keep(swirlTexture());
    const torus = new TorusGeometry(RADIUS, 0.55, 10, 56);
    const rimGeo = new TorusGeometry(RADIUS + 0.95, 0.16, 6, 56);
    const disc = new CircleGeometry(RADIUS - 0.25, 48);
    for (const id of HUB_ORDER) {
      const city = cityById(id)!;
      const slot = SLOTS[id];
      const dir = camDir(slot.yaw, slot.el).applyEuler(view);
      // On the facade the aim lands on, if one faces us at a sensible distance; else hung in the air in front.
      const hit = world.raycast(eye, dir, 140, false);
      const center = new Vector3();
      const group = new Group();
      let dist: number;
      if (hit && hit.dist > 26 && hit.dist < 120 && hit.normal.dot(dir) < -0.55) {
        dist = hit.dist;
        center.copy(hit.point).addScaledVector(hit.normal, 0.8);
        group.position.copy(center);
        group.lookAt(this.v.copy(center).add(hit.normal));
      } else {
        dist = hit ? clamp(hit.dist - 6, 26, VIEW_DIST) : VIEW_DIST;
        center.copy(eye).addScaledVector(dir, dist);
        group.position.copy(center);
        group.lookAt(eye);
      }
      const scale = dist / VIEW_DIST;
      group.scale.setScalar(scale);

      const color = new Color(city.color);
      const ring = new MeshBasicMaterial({ color: color.clone() });
      const rim = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
      group.add(new Mesh(torus, ring), new Mesh(rimGeo, rim));
      group.add(new Mesh(disc, new MeshBasicMaterial({ map: this.keep(discTexture(city)) })));
      const swirl = new Mesh(disc, new MeshBasicMaterial({ map: swirlTex, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.55 }));
      swirl.position.z = 0.06;
      group.add(swirl);
      const labelArt = newLabel(city);
      this.keep(labelArt.tex);
      const label = new Sprite(new SpriteMaterial({ map: labelArt.tex, depthTest: false, depthWrite: false, transparent: true }));
      label.renderOrder = 20;
      label.position.set(0, LABEL_Y, 0.3);
      group.add(label);
      this.group.add(group);
      this.portals.push({ city, group, center, scale, ring, rim, swirl, label, labelArt, color, hover: 0 });
    }
  }

  private keep<T extends Texture>(t: T) {
    this.textures.push(t);
    return t;
  }

  /** The portal nearest a world-space aim from `eye`, within reach, or -1. */
  pick(eye: Vector3, dir: Vector3): number {
    let best = -1, bestA = PICK;
    this.portals.forEach((p, i) => {
      const a = this.v.subVectors(p.center, eye).normalize().angleTo(dir);
      if (a < bestA) {
        bestA = a;
        best = i;
      }
    });
    return best;
  }

  indexOf(id: string) {
    return this.portals.findIndex((p) => p.city.id === id);
  }

  /** Each city's best score, under its name (nothing until there is one). */
  setBest(best: Partial<Record<string, number>>) {
    for (const p of this.portals) {
      const b = best[p.city.id] ?? 0;
      if (b === p.labelArt.best) continue;
      p.labelArt.best = b;
      drawLabel(p.labelArt, p.city);
    }
  }

  /** `hovered` grows and brightens; `chosen` (shot) pulls harder still. */
  update(dt: number, hovered: number, chosen = -1) {
    this.t += dt;
    this.portals.forEach((p, i) => {
      const goal = i === chosen ? 1.6 : i === hovered ? 1 : 0;
      p.hover = damp(p.hover, goal, 10, dt);
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 3 + i * 1.7);
      p.group.scale.setScalar(p.scale * (1 + 0.14 * p.hover + 0.015 * pulse));
      p.ring.color.copy(p.color).lerp(WHITE, 0.12 * pulse + 0.3 * Math.min(1, p.hover));
      p.rim.opacity = 0.35 + 0.25 * pulse + 0.4 * Math.min(1, p.hover);
      p.swirl.rotation.z -= dt * (0.7 + 2.2 * p.hover);
      (p.swirl.material as MeshBasicMaterial).opacity = 0.45 + 0.35 * Math.min(1, p.hover);
      const s = LABEL_SIZE * (1 + 0.1 * p.hover);
      p.label.scale.set(s, (s * LABEL_H) / LABEL_W, 1);
    });
  }

  dispose() {
    for (const t of this.textures) t.dispose();
    this.group.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      (m.material as MeshBasicMaterial | undefined)?.dispose();
    });
  }
}

const WHITE = new Color(0xffffff);

// ---------------------------------------------------------------- portal art
function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}

function texture(c: HTMLCanvasElement) {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function newLabel(city: CityStyle): Label {
  const { c, g } = canvas(LABEL_W, LABEL_H);
  const art = { c, g, tex: texture(c), best: 0 };
  drawLabel(art, city);
  return art;
}

/** The city's name, its own script (or the district) under it, then the best score if there is one. */
function drawLabel(art: Label, city: CityStyle) {
  const { g } = art;
  const mid = LABEL_W / 2;
  g.clearRect(0, 0, LABEL_W, LABEL_H);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.strokeStyle = "#1d2244";
  const name = city.name.toUpperCase();
  let size = 92;
  g.font = `${size}px Bungee, sans-serif`;
  while (g.measureText(name).width > 520 && size > 40) g.font = `${(size -= 4)}px Bungee, sans-serif`;
  g.lineWidth = 18;
  g.fillStyle = "#1d2244";
  g.fillText(name, mid, 70 + 9);
  g.strokeText(name, mid, 70);
  g.fillStyle = "#ffffff";
  g.fillText(name, mid, 70);
  const sub = city.local ?? city.area;
  g.font = city.local
    ? `700 64px "Apple SD Gothic Neo", "Hiragino Sans", "Noto Sans CJK KR", "Noto Sans CJK JP", sans-serif`
    : `700 52px Fredoka, sans-serif`;
  g.lineWidth = 14;
  g.strokeText(sub, mid, 158);
  g.fillStyle = city.color;
  g.fillText(sub, mid, 158);
  if (art.best > 0) {
    g.font = `44px Bungee, sans-serif`;
    g.lineWidth = 12;
    const text = `BEST ${art.best.toLocaleString("en-US")}`;
    g.strokeText(text, mid, 244);
    g.fillStyle = "#ffcc2e";
    g.fillText(text, mid, 244);
  }
  art.tex.needsUpdate = true;
}

/** Spiral arms that turn over the skyline: the portal's "through here". */
export function swirlTexture() {
  const S = 256;
  const { c, g } = canvas(S, S);
  g.translate(S / 2, S / 2);
  g.lineCap = "round";
  for (let arm = 0; arm < 4; arm++) {
    const a0 = (arm / 4) * Math.PI * 2;
    for (let k = 0; k < 40; k++) {
      const r0 = (k / 40) * 124, r1 = ((k + 1) / 40) * 124;
      g.strokeStyle = `rgba(255,255,255,${(0.65 * (1 - k / 40)).toFixed(3)})`;
      g.lineWidth = 3 + (k / 40) * 14;
      g.beginPath();
      g.moveTo(Math.cos(a0 + r0 / 30) * r0, Math.sin(a0 + r0 / 30) * r0);
      g.lineTo(Math.cos(a0 + r1 / 30) * r1, Math.sin(a0 + r1 / 30) * r1);
      g.stroke();
    }
  }
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, 60);
  glow.addColorStop(0, "rgba(255,255,255,0.7)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = glow;
  g.fillRect(-S / 2, -S / 2, S, S);
  return texture(c);
}

type G = CanvasRenderingContext2D;
const poly = (g: G, color: string, pts: number[]) => {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  g.fill();
};
const rect = (g: G, color: string, x0: number, y0: number, x1: number, y1: number) => {
  g.fillStyle = color;
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
};
/** A ridge line through the given peaks, filled down to the ground. */
const ridge = (g: G, color: string, peaks: number[]) => poly(g, color, [0, 205, ...peaks, 256, 205]);
const GROUND = 205;

/** Each city's skyline, seen through its portal. */
const SKYLINES: Record<CityId, (g: G) => void> = {
  nyc(g) {
    for (const [x, w, h] of [[8, 26, 70], [30, 22, 96], [150, 24, 88], [172, 30, 60], [206, 22, 104], [226, 30, 74]]) rect(g, "#9DB1CC", x, GROUND - h, x + w, GROUND);
    // Chrysler: shaft, stepped crown, needle.
    rect(g, "#EEEBE4", 56, 92, 82, GROUND);
    poly(g, "#EEEBE4", [56, 92, 69, 62, 82, 92]);
    rect(g, "#EEEBE4", 68, 36, 70, 64);
    // Empire State: setbacks and mast.
    rect(g, "#DCD2BE", 100, 112, 156, GROUND);
    rect(g, "#DCD2BE", 110, 86, 146, 112);
    rect(g, "#DCD2BE", 118, 64, 138, 86);
    rect(g, "#DCD2BE", 124, 50, 132, 64);
    rect(g, "#DCD2BE", 127, 22, 129, 50);
    // One Vanderbilt: a tapering glass blade.
    poly(g, "#86A9C8", [176, GROUND, 180, 70, 192, 46, 200, 74, 204, GROUND]);
    for (let x = 0; x < 256; x += 30) rect(g, "#B46450", x, 176, x + 26, GROUND);
  },
  tokyo(g) {
    poly(g, "#8A9BC8", [20, GROUND, 128, 76, 236, GROUND]);
    poly(g, "#F4F6FB", [104, 98, 128, 76, 152, 98, 140, 94, 128, 100, 116, 94]);
    // Tocho: the twin-towered city hall.
    rect(g, "#C8CCD4", 84, 120, 172, GROUND);
    rect(g, "#C8CCD4", 88, 64, 120, 120);
    rect(g, "#C8CCD4", 136, 64, 168, 120);
    rect(g, "#AEB3BD", 94, 56, 114, 64);
    rect(g, "#AEB3BD", 142, 56, 162, 64);
    // Tokyo Tower.
    poly(g, "#FF6A3D", [196, GROUND, 214, 84, 232, GROUND, 224, GROUND, 214, 120, 204, GROUND]);
    rect(g, "#FFFFFF", 205, 150, 223, 156);
    rect(g, "#FF6A3D", 212, 52, 216, 86);
    for (const [x, w, h] of [[0, 30, 44], [30, 24, 60], [174, 20, 50], [236, 20, 40]]) rect(g, "#DDE1E6", x, GROUND - h, x + w, GROUND);
    const neon = ["#FF4FA3", "#36DFFF", "#FFE14D", "#6BFF8A"];
    for (let i = 0; i < 6; i++) rect(g, neon[i % 4], 6 + i * 40, 168, 12 + i * 40, 196);
  },
  seoul(g) {
    ridge(g, "#6E9E80", [0, 120, 40, 86, 70, 104, 104, 60, 132, 92, 170, 72, 206, 108, 236, 90, 256, 116]);
    // Namsan and N Seoul Tower.
    poly(g, "#78A884", [176, GROUND, 216, 150, 256, 170, 256, GROUND]);
    rect(g, "#F2F2F2", 213, 92, 219, 152);
    rect(g, "#F2F2F2", 206, 104, 226, 112);
    rect(g, "#F2F2F2", 215, 72, 217, 92);
    // Gwanghwamun: stone base with the arch, two tiers of curved roofs.
    rect(g, "#BDB4A4", 60, 168, 168, GROUND);
    g.fillStyle = "#2C3140";
    g.beginPath();
    g.arc(114, 192, 11, Math.PI, 0);
    g.fill();
    rect(g, "#2C3140", 103, 192, 125, GROUND);
    rect(g, "#B5463C", 76, 146, 152, 168);
    poly(g, "#3E4552", [56, 150, 66, 136, 162, 136, 172, 150, 150, 144, 78, 144]);
    rect(g, "#B5463C", 88, 124, 140, 138);
    poly(g, "#3E4552", [72, 128, 84, 112, 144, 112, 156, 128, 136, 122, 92, 122]);
    for (const x of [20, 44, 186, 236]) {
      rect(g, "#5B4636", x - 2, 176, x + 2, GROUND);
      g.fillStyle = "#F4C430";
      g.beginPath();
      g.arc(x, 170, 12, 0, Math.PI * 2);
      g.fill();
    }
  },
  la(g) {
    ridge(g, "#A99AB8", [0, 132, 50, 110, 96, 128, 140, 100, 190, 124, 230, 108, 256, 120]);
    for (let i = 0; i < 9; i++) rect(g, "#FFFFFF", 164 + i * 8, 116, 170 + i * 8, 124);
    // US Bank Tower with its crown, and the Wilshire Grand's sail.
    rect(g, "#CDBFA9", 92, 64, 124, GROUND);
    rect(g, "#E8DCC6", 96, 52, 120, 64);
    poly(g, "#A9C8E0", [136, GROUND, 136, 72, 156, 52, 160, 54, 162, GROUND]);
    for (const [x, w, h] of [[40, 28, 70], [66, 22, 92], [168, 26, 64], [196, 22, 80]]) rect(g, "#E3C9A0", x, GROUND - h, x + w, GROUND);
    for (const x of [18, 230]) {
      rect(g, "#6B5444", x - 2, 120, x + 2, GROUND);
      g.strokeStyle = "#3E9C44";
      g.lineWidth = 5;
      g.lineCap = "round";
      for (let k = 0; k < 6; k++) {
        const a = Math.PI + (k / 5) * Math.PI;
        g.beginPath();
        g.moveTo(x, 120);
        g.quadraticCurveTo(x + Math.cos(a) * 14, 108, x + Math.cos(a) * 22, 122 + Math.abs(Math.sin(a)) * -4 + 6);
        g.stroke();
      }
    }
  },
};

function discTexture(city: CityStyle) {
  const S = 256;
  const { c, g } = canvas(S, S);
  const sky = g.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, city.sky.top);
  sky.addColorStop(1, city.sky.horizon);
  g.fillStyle = sky;
  g.fillRect(0, 0, S, S);
  SKYLINES[city.id](g);
  rect(g, city.road, 0, GROUND, S, S);
  rect(g, city.center, 0, 228, S, 232);
  return texture(c);
}
