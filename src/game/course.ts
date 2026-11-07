import {
  Color, Euler, Group, InstancedMesh, type Material, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3,
} from "three";

import { clamp } from "../core/math";
import type { CityData } from "../world/city";
import { BLIMP, CHECKPOINTS, type CheckpointDef, FINISH, HOOPS, type HoopDef, START } from "../world/cityLayout";
import type { PropLibrary } from "../world/props";
import type { Player } from "./player";

export type CourseEvent =
  | { type: "hoop"; index: number; pos: Vector3; centered: boolean }
  | { type: "hoopMissed"; index: number }
  | { type: "coin"; pos: Vector3 }
  | { type: "checkpoint"; index: number }
  | { type: "finish"; pos: Vector3 };

type HoopRt = { def: HoopDef; center: Vector3; normal: Vector3; state: "open" | "hit" | "missed"; anim: number };
type CoinRt = { pos: Vector3; taken: boolean; anim: number };

const COIN_RADIUS = 2.7;
const HOOP_HIT_SCALE = 1.3; // forgiving: the rim and a bit beyond count
const UP = new Vector3(0, 1, 0);

/** Hoops, coins, checkpoints, the finish ring and the moving blimp. */
export class Course {
  readonly group = new Group();
  readonly hoops: HoopRt[];
  readonly coins: CoinRt[] = [];
  nextHoop = 0;
  checkpoint: CheckpointDef = CHECKPOINTS[0];
  finished = false;
  private readonly hoopMesh: InstancedMesh;
  private readonly coinMesh: InstancedMesh;
  private readonly finishMesh: Mesh;
  private readonly blimp: Mesh;
  private blimpX: number = BLIMP.x0;
  private blimpDir = 1;
  private blimpYaw = 0;
  private t = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly s = new Vector3();
  private readonly sc = new Vector3();
  private readonly c = new Color();

  constructor(
    lib: PropLibrary,
    worldMaterial: Material,
    private readonly city: CityData,
  ) {
    const glow = new MeshBasicMaterial({ vertexColors: true });
    this.hoops = HOOPS.map((def) => ({
      def,
      center: new Vector3(def.x, def.y, def.z),
      normal: new Vector3(Math.sin(def.yaw), 0, Math.cos(def.yaw)),
      state: "open" as const,
      anim: 0,
    }));
    this.hoopMesh = new InstancedMesh(lib.get("hoop"), glow, this.hoops.length);
    this.hoopMesh.name = "hoops";
    this.hoopMesh.frustumCulled = false;
    this.group.add(this.hoopMesh);

    this.finishMesh = new Mesh(lib.get("hoop_gold"), glow);
    this.finishMesh.position.set(FINISH.x, FINISH.y, FINISH.z);
    this.finishMesh.rotation.y = FINISH.yaw;
    this.finishMesh.scale.setScalar(FINISH.r);
    this.group.add(this.finishMesh);

    // Coin trails sag between hoops like the bottom of a swing.
    const pts: Vector3[] = [new Vector3(START.x, START.y - 6, START.z - 14), ...this.hoops.map((h) => h.center), new Vector3(FINISH.x, FINISH.y, FINISH.z)];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dist = a.distanceTo(b);
      const n = clamp(Math.round(dist / 10), 3, 6);
      const sag = Math.min(6, dist * 0.09);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        const p = new Vector3().lerpVectors(a, b, t);
        p.y -= Math.sin(Math.PI * t) * sag;
        this.coins.push({ pos: p, taken: false, anim: 0 });
      }
    }
    this.coinMesh = new InstancedMesh(lib.get("coin"), glow, this.coins.length);
    this.coinMesh.name = "coins";
    this.coinMesh.frustumCulled = false;
    this.group.add(this.coinMesh);

    this.blimp = new Mesh(lib.get("blimp"), worldMaterial);
    this.blimp.castShadow = true;
    this.group.add(this.blimp);

    this.reset();
    this.animate(0, new Vector3(START.x, START.y, START.z));
  }

  get hoopsHit() {
    return this.hoops.filter((h) => h.state === "hit").length;
  }
  get coinsTaken() {
    return this.coins.filter((c) => c.taken).length;
  }

  reset() {
    for (const h of this.hoops) {
      h.state = "open";
      h.anim = 0;
    }
    for (const c of this.coins) {
      c.taken = false;
      c.anim = 0;
    }
    this.nextHoop = 0;
    this.checkpoint = CHECKPOINTS[0];
    this.finished = false;
    this.blimpX = BLIMP.x0;
    this.blimpDir = 1;
  }

  nextHoopCenter(): Vector3 | null {
    if (this.nextHoop < this.hoops.length) return this.hoops[this.nextHoop].center;
    return this.finished ? null : this.finishMesh.position;
  }

  update(dt: number, player: Player, prev: Vector3, events: CourseEvent[]) {
    this.t += dt;
    this.updateBlimp(dt);
    if (this.finished) return;

    // Hoop magnetism: a gentle pull toward the center in the last few meters.
    const target = this.nextHoop < this.hoops.length ? this.hoops[this.nextHoop] : null;
    if (target) {
      const to = this.s.subVectors(target.center, player.pos);
      const along = Math.abs(to.dot(target.normal));
      const lateral = Math.sqrt(Math.max(0, to.lengthSq() - along * along));
      if (along < 16 && lateral < target.def.r * 2.8 && lateral > 0.3) {
        const pull = (1 - along / 16) * 15 * dt;
        to.addScaledVector(target.normal, -to.dot(target.normal)).normalize();
        player.vel.addScaledVector(to, pull);
      }
    }

    // Pass detection: segment prev→pos crossing a hoop plane.
    for (let i = this.nextHoop; i < Math.min(this.hoops.length, this.nextHoop + 3); i++) {
      const h = this.hoops[i];
      const d0 = this.s.subVectors(prev, h.center).dot(h.normal);
      const d1 = this.s.subVectors(player.pos, h.center).dot(h.normal);
      if (d0 === 0 || Math.sign(d0) === Math.sign(d1)) continue;
      const t = d0 / (d0 - d1);
      const cross = this.s.lerpVectors(prev, player.pos, t);
      const off = cross.distanceTo(h.center);
      if (off < h.def.r * HOOP_HIT_SCALE) {
        for (let k = this.nextHoop; k < i; k++) this.miss(k, events);
        h.state = "hit";
        h.anim = 1;
        this.nextHoop = i + 1;
        events.push({ type: "hoop", index: i, pos: h.center.clone(), centered: off < h.def.r * 0.45 });
        const cp = CHECKPOINTS.find((c) => c.afterHoop === i);
        if (cp) {
          this.checkpoint = cp;
          events.push({ type: "checkpoint", index: CHECKPOINTS.indexOf(cp) });
        }
        break;
      } else if (i === this.nextHoop && off < 40) {
        this.miss(i, events);
        this.nextHoop = i + 1;
        const cp = CHECKPOINTS.find((c) => c.afterHoop === i);
        if (cp) this.checkpoint = cp;
        break;
      }
    }

    // Finish ring.
    if (this.nextHoop >= this.hoops.length - 2) {
      const n = this.s.set(Math.sin(FINISH.yaw), 0, Math.cos(FINISH.yaw));
      const fc = this.finishMesh.position;
      const d0 = prev.clone().sub(fc).dot(n);
      const d1 = player.pos.clone().sub(fc).dot(n);
      if (Math.sign(d0) !== Math.sign(d1)) {
        const t = d0 / (d0 - d1);
        const cross = prev.clone().lerp(player.pos, t);
        if (cross.distanceTo(fc) < FINISH.r * 1.35) {
          for (let k = this.nextHoop; k < this.hoops.length; k++) this.miss(k, events);
          this.finished = true;
          events.push({ type: "finish", pos: fc.clone() });
        }
      }
    }

    // Coins (swept test so fast swings never tunnel past one).
    const seg = this.s.subVectors(player.pos, prev);
    const segLen2 = Math.max(1e-6, seg.lengthSq());
    for (const c of this.coins) {
      if (c.taken) continue;
      if (Math.abs(c.pos.x - player.pos.x) > 30 || Math.abs(c.pos.z - player.pos.z) > 30) continue;
      const t = clamp(((c.pos.x - prev.x) * seg.x + (c.pos.y - prev.y) * seg.y + (c.pos.z - prev.z) * seg.z) / segLen2, 0, 1);
      const dx = prev.x + seg.x * t - c.pos.x, dy = prev.y + seg.y * t - c.pos.y, dz = prev.z + seg.z * t - c.pos.z;
      if (dx * dx + dy * dy + dz * dz < COIN_RADIUS * COIN_RADIUS) {
        c.taken = true;
        c.anim = 1;
        events.push({ type: "coin", pos: c.pos.clone() });
      }
    }
  }

  private miss(i: number, events: CourseEvent[]) {
    const h = this.hoops[i];
    if (h.state !== "open") return;
    h.state = "missed";
    events.push({ type: "hoopMissed", index: i });
  }

  private updateBlimp(dt: number) {
    this.blimpX += this.blimpDir * BLIMP.speed * dt;
    if (this.blimpX > BLIMP.x1) this.blimpDir = -1;
    if (this.blimpX < BLIMP.x0) this.blimpDir = 1;
    const targetYaw = this.blimpDir > 0 ? 0 : Math.PI;
    this.blimpYaw += (targetYaw - this.blimpYaw) * (1 - Math.exp(-1.2 * dt));
    const bob = Math.sin(this.t * 0.7) * 0.8;
    this.blimp.position.set(this.blimpX, BLIMP.y + bob, BLIMP.z);
    this.blimp.rotation.set(0, this.blimpYaw, Math.sin(this.t * 0.5) * 0.03);
    const col = this.city.blimpCollider;
    // The blimp turns end over end; a square footprint keeps the collider honest mid-turn.
    const half = 9.5 * Math.max(Math.abs(Math.cos(this.blimpYaw)), 0.32);
    const halfZ = Math.max(3, 9.5 * Math.abs(Math.sin(this.blimpYaw)));
    col.min.set(this.blimpX - half, BLIMP.y + bob - 3, BLIMP.z - halfZ);
    col.max.set(this.blimpX + half, BLIMP.y + bob + 3, BLIMP.z + halfZ);
  }

  /** Visual-only animation; call once per rendered frame. */
  animate(dt: number, playerPos: Vector3) {
    const pulse = 1 + Math.sin(this.t * 6) * 0.05;
    this.hoops.forEach((h, i) => {
      let scale = h.def.r;
      if (h.state === "hit") {
        h.anim = Math.max(0, h.anim - dt * 2.2);
        scale *= h.anim > 0 ? 1 + (1 - h.anim) * 0.6 : 0;
      } else if (h.state === "missed") {
        scale *= 0.92;
      } else if (i === this.nextHoop) {
        scale *= pulse;
      }
      this.q.setFromEuler(this.e.set(0, h.def.yaw, i === this.nextHoop ? this.t * 0.6 : 0));
      this.m.compose(h.center, this.q, this.s.setScalar(scale));
      this.hoopMesh.setMatrixAt(i, this.m);
      const tint = h.state === "missed" ? 0.38 : i === this.nextHoop ? 1 : 0.8;
      this.hoopMesh.setColorAt(i, h.state === "missed" ? this.c.setRGB(tint, tint, tint * 1.1) : this.c.setScalar(tint));
    });
    this.hoopMesh.instanceMatrix.needsUpdate = true;
    if (this.hoopMesh.instanceColor) this.hoopMesh.instanceColor.needsUpdate = true;

    this.finishMesh.rotation.z = this.t * 0.4;
    this.finishMesh.scale.setScalar(FINISH.r * (this.finished ? 1.15 : pulse));

    const spin = this.t * 2.6;
    this.coins.forEach((c, i) => {
      let scale = 1.7;
      const p = this.s.copy(c.pos);
      if (c.taken) {
        c.anim = Math.max(0, c.anim - dt * 4);
        scale = c.anim > 0 ? 1.7 * (0.4 + c.anim * 0.8) : 0;
        p.lerp(playerPos, 1 - c.anim);
        p.y += (1 - c.anim) * 1.5;
      } else {
        p.y += Math.sin(this.t * 2 + i) * 0.25;
      }
      this.q.setFromAxisAngle(UP, spin + i * 0.35);
      this.m.compose(p, this.q, this.sc.setScalar(scale));
      this.coinMesh.setMatrixAt(i, this.m);
    });
    this.coinMesh.instanceMatrix.needsUpdate = true;
  }
}
