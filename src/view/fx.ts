import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, DynamicDrawUsage, Group,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, type PerspectiveCamera, Quaternion, Sprite, SpriteMaterial,
  Vector3,
} from "three";

import { mulberry32 } from "../core/math";
import { pal } from "../world/palette";

const tmp = new Vector3(), tmp2 = new Vector3(), side = new Vector3();

/** Camera-facing tapered ribbon from the hand to the anchor. */
export class WebLine {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly pos = new Float32Array(4 * 3);
  private travel = 0;
  private widthScale = 1;
  private readonly recoveryColor = new Color(0x9aa3b8);
  visible = false;

  constructor() {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    this.mesh = new Mesh(geo, new MeshBasicMaterial({ color: pal("web"), fog: false, side: DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  /** A recovery web (after a missed cue) is grey and thinner than an earned one. */
  shoot(recovery = false) {
    this.travel = 0;
    this.visible = true;
    this.widthScale = recovery ? 0.55 : 1;
    this.mesh.material.color.copy(recovery ? this.recoveryColor : pal("web"));
  }

  hide() {
    this.visible = false;
    this.mesh.visible = false;
  }

  update(dt: number, from: Vector3, to: Vector3, cam: PerspectiveCamera) {
    if (!this.visible) return;
    this.travel = Math.min(1, this.travel + dt * 14);
    const end = tmp.lerpVectors(from, to, this.travel);
    const dir = tmp2.subVectors(end, from);
    side.subVectors(cam.position, from).cross(dir).normalize();
    const w0 = 0.022 * this.widthScale, w1 = 0.24 * this.widthScale;
    const p = this.pos;
    p[0] = from.x + side.x * w0; p[1] = from.y + side.y * w0; p[2] = from.z + side.z * w0;
    p[3] = from.x - side.x * w0; p[4] = from.y - side.y * w0; p[5] = from.z - side.z * w0;
    p[6] = end.x + side.x * w1; p[7] = end.y + side.y * w1; p[8] = end.z + side.z * w1;
    p[9] = end.x - side.x * w1; p[10] = end.y - side.y * w1; p[11] = end.z - side.z * w1;
    (this.mesh.geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
    this.mesh.visible = true;
  }
}

function reticleTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.translate(64, 64);
  g.lineWidth = 14;
  g.strokeStyle = "rgba(20,24,48,0.55)";
  g.beginPath();
  g.arc(0, 0, 44, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 8;
  g.strokeStyle = "#ffffff";
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.arc(0, 0, 44, i * (Math.PI / 2) + 0.25, (i + 1) * (Math.PI / 2) - 0.25);
    g.stroke();
  }
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(0, 0, 10, 0, Math.PI * 2);
  g.fill();
  const tex = new CanvasTexture(c);
  tex.anisotropy = 1;
  return tex;
}

/** Shows where a web would stick right now. Constant on-screen size. */
export class Reticle {
  readonly sprite: Sprite;
  private shown = 0;
  private readonly target = new Vector3();
  private t = 0;

  constructor() {
    this.sprite = new Sprite(new SpriteMaterial({ map: reticleTexture(), depthTest: false, transparent: true, fog: false }));
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
  }

  update(dt: number, point: Vector3 | null, cam: PerspectiveCamera) {
    this.t += dt;
    if (point) this.target.copy(point);
    this.shown += ((point ? 1 : 0) - this.shown) * (1 - Math.exp(-14 * dt));
    this.sprite.visible = this.shown > 0.02;
    if (!this.sprite.visible) return;
    this.sprite.position.lerp(this.target, point ? 1 - Math.exp(-20 * dt) : 0);
    const dist = this.sprite.position.distanceTo(cam.position);
    const s = dist * Math.tan((cam.fov * Math.PI) / 360) * 0.085 * (0.85 + this.shown * 0.15 + Math.sin(this.t * 7) * 0.04);
    this.sprite.scale.setScalar(s);
    this.sprite.material.opacity = this.shown;
    this.sprite.material.rotation = this.t * 0.8;
  }

  snapTo(point: Vector3) {
    this.sprite.position.copy(point);
  }
}

type Particle = { pos: Vector3; vel: Vector3; life: number; max: number; size: number; spin: number; color: Color; gravity: number };

/** Pooled cube particles: the low-poly answer to sparks and splashes. */
export class Particles {
  readonly mesh: InstancedMesh;
  private readonly pool: Particle[] = [];
  private next = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly rng = mulberry32(99);

  constructor(capacity = 260) {
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0xffffff }), capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) {
      this.pool.push({ pos: new Vector3(), vel: new Vector3(), life: 0, max: 1, size: 0, spin: 0, color: new Color(), gravity: 0 });
      this.mesh.setColorAt(i, new Color(1, 1, 1));
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
  }

  burst(at: Vector3, count: number, colors: Color[], opts: { speed?: number; size?: number; life?: number; gravity?: number; up?: number; inherit?: Vector3 } = {}) {
    const { speed = 8, size = 0.35, life = 0.8, gravity = 14, up = 3 } = opts;
    for (let i = 0; i < count; i++) {
      const p = this.pool[this.next];
      this.next = (this.next + 1) % this.pool.length;
      const r = this.rng;
      p.pos.copy(at);
      p.vel.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize().multiplyScalar(speed * (0.4 + r() * 0.6));
      p.vel.y += up;
      if (opts.inherit) p.vel.addScaledVector(opts.inherit, 0.6);
      p.max = p.life = life * (0.6 + r() * 0.4);
      p.size = size * (0.6 + r() * 0.6);
      p.spin = r() * 10;
      p.gravity = gravity;
      p.color.copy(colors[i % colors.length]);
    }
  }

  update(dt: number) {
    this.pool.forEach((p, i) => {
      if (p.life <= 0) {
        if (p.size !== 0) {
          p.size = 0;
          this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        }
        return;
      }
      p.life -= dt;
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(1 - 1.5 * dt);
      p.pos.addScaledVector(p.vel, dt);
      p.spin += dt * 6;
      const k = Math.max(0, p.life / p.max);
      this.q.setFromAxisAngle(tmp.set(0.6, 1, 0.3).normalize(), p.spin);
      this.m.compose(p.pos, this.q, this.s.setScalar(p.size * (k < 0.3 ? k / 0.3 : 1)));
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, p.color);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** Streaks around the screen edge that sell speed without moving the camera. Camera space. */
export class SpeedLines {
  readonly group = new Group();
  private readonly mesh: InstancedMesh;
  private readonly lines: Array<{ a: number; r: number; z: number; len: number }> = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly mat: MeshBasicMaterial;
  private readonly rng = mulberry32(5);

  constructor(count = 36) {
    this.mat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: AdditiveBlending });
    this.mesh = new InstancedMesh(new BoxGeometry(0.006, 0.006, 1), this.mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    for (let i = 0; i < count; i++) this.lines.push(this.spawn(true));
    this.group.add(this.mesh);
  }

  private spawn(anywhere: boolean) {
    const r = this.rng;
    return { a: r() * Math.PI * 2, r: 0.55 + r() * 0.5, z: anywhere ? -r() * 3 : -3, len: 0.4 + r() * 0.8 };
  }

  update(dt: number, speed: number) {
    const k = Math.max(0, (speed - 24) / 20);
    this.mat.opacity += (Math.min(0.32, k * 0.32) - this.mat.opacity) * (1 - Math.exp(-6 * dt));
    this.mesh.visible = this.mat.opacity > 0.01;
    if (!this.mesh.visible) return;
    this.lines.forEach((l, i) => {
      l.z += dt * (6 + speed * 0.25);
      if (l.z > 0.2) Object.assign(l, this.spawn(false));
      const x = Math.cos(l.a) * l.r * 1.6, y = Math.sin(l.a) * l.r * 0.95;
      this.q.identity();
      this.m.compose(tmp.set(x, y, l.z - l.len / 2), this.q, tmp2.set(1, 1, l.len));
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
