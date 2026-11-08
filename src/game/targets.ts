// The choices after a run (next area, replay, choose a city), hung in the sky over
// the street the hero just swung down. Like the rooftop portals they are aimed at
// with an arm and taken with a web shot; they draw over the buildings so a tall
// block beside the street never hides one.

import {
  AdditiveBlending, CanvasTexture, CircleGeometry, Color, Euler, Group, Mesh, MeshBasicMaterial, SRGBColorSpace, Sprite,
  SpriteMaterial, type Texture, TorusGeometry, Vector3,
} from "three";

import { damp, smoothstep } from "../core/math";
import { camDir, swirlTexture } from "./hub";

export type TargetIcon = "next" | "replay" | "city";
export type TargetSpec = { id: string; label: string; sub: string; color: string; icon: TargetIcon };

/** Camera-space spots by count, on the arcs an arm sweeps (see `armAim`): the middle one high. */
const SLOTS: Record<number, Array<{ yaw: number; el: number }>> = {
  1: [{ yaw: 0, el: 0.2 }],
  2: [{ yaw: -0.36, el: 0.2 }, { yaw: 0.36, el: 0.2 }],
  3: [{ yaw: -0.52, el: 0.12 }, { yaw: 0, el: 0.27 }, { yaw: 0.52, el: 0.12 }],
};
const RADIUS = 6;
const DIST = 44;
const SCALE = 0.82;
/** An aim this close (radians) to a target's center picks it. */
const PICK = 0.34;
const LABEL_W = 560, LABEL_H = 220;
const LABEL_SIZE = 15;
const LABEL_Y = -(RADIUS + 0.7 + (LABEL_SIZE * LABEL_H) / LABEL_W / 2);
/** Each target grows in this long after the one before it (seconds). */
const STAGGER = 0.14;
const GROW = 0.45;

type Target = {
  spec: TargetSpec;
  group: Group;
  center: Vector3;
  ring: MeshBasicMaterial;
  rim: MeshBasicMaterial;
  face: MeshBasicMaterial;
  swirl: Mesh;
  label: Sprite;
  color: Color;
  hover: number;
  textures: Texture[];
};

const WHITE = new Color(0xffffff);

export class Targets {
  readonly group = new Group();
  items: Target[] = [];
  private t = 0;
  private readonly v = new Vector3();
  private readonly torus = new TorusGeometry(RADIUS, 0.55, 10, 56);
  private readonly rimGeo = new TorusGeometry(RADIUS + 0.95, 0.16, 6, 56);
  private readonly disc = new CircleGeometry(RADIUS - 0.25, 48);
  private readonly swirlTex = swirlTexture();

  constructor() {
    this.group.visible = false;
  }

  /** Hang the choices in view from `eye`, for a camera turned to `yaw` and pitched to `pitch`. */
  show(specs: TargetSpec[], eye: Vector3, yaw: number, pitch: number) {
    this.clear();
    const view = new Euler(pitch, yaw, 0, "YXZ");
    const slots = SLOTS[specs.length] ?? SLOTS[3];
    specs.forEach((spec, i) => {
      const slot = slots[i] ?? slots[slots.length - 1];
      const dir = camDir(slot.yaw, slot.el).applyEuler(view);
      const center = eye.clone().addScaledVector(dir, DIST);
      const group = new Group();
      group.position.copy(center);
      group.lookAt(eye);
      const color = new Color(spec.color);
      const onTop = { depthTest: false, depthWrite: false, transparent: true, fog: false };
      const ring = new MeshBasicMaterial({ color: color.clone(), ...onTop });
      const rim = new MeshBasicMaterial({ color: 0xffffff, opacity: 0.7, ...onTop });
      const faceTex = iconTexture(spec);
      const face = new MeshBasicMaterial({ map: faceTex, ...onTop });
      const ringMesh = new Mesh(this.torus, ring);
      const rimMesh = new Mesh(this.rimGeo, rim);
      const faceMesh = new Mesh(this.disc, face);
      const swirl = new Mesh(this.disc, new MeshBasicMaterial({ map: this.swirlTex, blending: AdditiveBlending, opacity: 0.4, ...onTop }));
      swirl.position.z = 0.06;
      faceMesh.renderOrder = 30;
      swirl.renderOrder = 31;
      ringMesh.renderOrder = 32;
      rimMesh.renderOrder = 32;
      const labelTex = labelTexture(spec);
      const label = new Sprite(new SpriteMaterial({ map: labelTex, depthTest: false, depthWrite: false, transparent: true, fog: false }));
      label.renderOrder = 33;
      label.position.set(0, LABEL_Y, 0.3);
      group.add(faceMesh, swirl, ringMesh, rimMesh, label);
      group.scale.setScalar(0.001);
      this.group.add(group);
      this.items.push({ spec, group, center, ring, rim, face, swirl, label, color, hover: 0, textures: [faceTex, labelTex] });
    });
    this.t = 0;
    this.group.visible = true;
  }

  hide() {
    this.clear();
    this.group.visible = false;
  }

  /** True once every target has grown in and can be taken. */
  get ready() {
    return this.group.visible && this.t > GROW + STAGGER * (this.items.length - 1);
  }

  /** The target nearest a world-space aim from `eye`, within reach, or -1. */
  pick(eye: Vector3, dir: Vector3): number {
    let best = -1, bestA = PICK;
    this.items.forEach((p, i) => {
      const a = this.v.subVectors(p.center, eye).normalize().angleTo(dir);
      if (a < bestA) {
        bestA = a;
        best = i;
      }
    });
    return best;
  }

  indexOf(id: string) {
    return this.items.findIndex((p) => p.spec.id === id);
  }

  /** `hovered` grows and brightens; `chosen` (shot) pulls harder still. */
  update(dt: number, hovered: number, chosen = -1) {
    if (!this.group.visible) return;
    this.t += dt;
    this.items.forEach((p, i) => {
      const grow = smoothstep(0, 1, (this.t - i * STAGGER) / GROW);
      const pop = grow < 1 ? 1 + 0.18 * Math.sin(grow * Math.PI) : 1;
      const goal = i === chosen ? 1.6 : i === hovered ? 1 : 0;
      p.hover = damp(p.hover, goal, 10, dt);
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 3 + i * 1.7);
      p.group.scale.setScalar(Math.max(0.001, SCALE * grow * pop * (1 + 0.16 * p.hover + 0.015 * pulse)));
      p.ring.color.copy(p.color).lerp(WHITE, 0.12 * pulse + 0.3 * Math.min(1, p.hover));
      p.rim.opacity = 0.35 + 0.25 * pulse + 0.4 * Math.min(1, p.hover);
      p.swirl.rotation.z -= dt * (0.7 + 2.2 * p.hover);
      (p.swirl.material as MeshBasicMaterial).opacity = 0.3 + 0.35 * Math.min(1, p.hover);
      const s = LABEL_SIZE * (1 + 0.1 * p.hover);
      p.label.scale.set(s, (s * LABEL_H) / LABEL_W, 1);
    });
  }

  private clear() {
    for (const p of this.items) {
      for (const t of p.textures) t.dispose();
      p.ring.dispose();
      p.rim.dispose();
      p.face.dispose();
      (p.swirl.material as MeshBasicMaterial).dispose();
      (p.label.material as SpriteMaterial).dispose();
      this.group.remove(p.group);
    }
    this.items = [];
  }
}

// ---------------------------------------------------------------- art
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

/** A bold white glyph on the target's color: an arrow on, a loop round, or a portal for each city. */
function iconTexture(spec: TargetSpec) {
  const S = 256;
  const { c, g } = canvas(S, S);
  const bg = g.createRadialGradient(S / 2, S * 0.4, 10, S / 2, S / 2, S * 0.6);
  bg.addColorStop(0, new Color(spec.color).lerp(WHITE, 0.35).getStyle());
  bg.addColorStop(1, spec.color);
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);
  g.translate(S / 2, S / 2);
  g.lineJoin = "round";
  g.lineCap = "round";
  const ink = "#1d2244";
  const draw = (stroke: (w: number, color: string) => void) => {
    stroke(34, ink);
    stroke(18, "#ffffff");
  };
  if (spec.icon === "next") {
    draw((w, color) => {
      g.strokeStyle = color;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(-58, 0);
      g.lineTo(52, 0);
      g.moveTo(14, -40);
      g.lineTo(56, 0);
      g.lineTo(14, 40);
      g.stroke();
    });
  } else if (spec.icon === "replay") {
    draw((w, color) => {
      g.strokeStyle = color;
      g.lineWidth = w;
      g.beginPath();
      g.arc(0, 4, 50, -Math.PI * 0.35, Math.PI * 1.45);
      g.stroke();
      g.beginPath();
      g.moveTo(10, -66);
      g.lineTo(34, -40);
      g.lineTo(2, -28);
      g.stroke();
    });
  } else {
    // Four little portals, one per city, in their colors.
    const colors = ["#46B4FF", "#FFC23D", "#FF5DA2", "#FF8A3D"];
    [[-34, -34], [34, -34], [-34, 34], [34, 34]].forEach(([x, y], i) => {
      g.fillStyle = ink;
      g.beginPath();
      g.arc(x, y + 4, 30, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = colors[i];
      g.beginPath();
      g.arc(x, y, 27, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#ffffff";
      g.lineWidth = 7;
      g.stroke();
    });
  }
  return texture(c);
}

/** The choice in big outlined type, what it leads to under it. */
function labelTexture(spec: TargetSpec) {
  const { c, g } = canvas(LABEL_W, LABEL_H);
  const mid = LABEL_W / 2;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.strokeStyle = "#1d2244";
  const name = spec.label.toUpperCase();
  let size = 84;
  g.font = `${size}px Bungee, sans-serif`;
  while (g.measureText(name).width > 520 && size > 40) g.font = `${(size -= 4)}px Bungee, sans-serif`;
  g.lineWidth = 18;
  g.fillStyle = "#1d2244";
  g.fillText(name, mid, 64 + 9);
  g.strokeText(name, mid, 64);
  g.fillStyle = "#ffffff";
  g.fillText(name, mid, 64);
  let sub = 52;
  g.font = `700 ${sub}px Fredoka, sans-serif`;
  while (g.measureText(spec.sub).width > 530 && sub > 28) g.font = `700 ${(sub -= 2)}px Fredoka, sans-serif`;
  g.lineWidth = 14;
  g.strokeText(spec.sub, mid, 150);
  g.fillStyle = spec.color;
  g.fillText(spec.sub, mid, 150);
  return texture(c);
}
