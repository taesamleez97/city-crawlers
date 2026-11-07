import { Vector3 } from "three";

import { TUNING as T } from "../config";
import { clamp } from "../core/math";
import { isWater } from "../world/cityLayout";
import type { Contact, CollisionWorld } from "../world/collision";

export type PlayerState = "perched" | "air" | "swing" | "stunned";

export type PlayerEvent =
  | { type: "attach"; side: number }
  | { type: "release"; quality: number; perfect: boolean }
  | { type: "crash"; speed: number; normal: Vector3 }
  | { type: "graze" }
  | { type: "bonk" }
  | { type: "splash" };

const UP = new Vector3(0, 1, 0);
const SUBSTEPS = 4;

export class Player {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  state: PlayerState = "perched";
  /** Where the web visually sticks. */
  readonly anchor = new Vector3();
  /** Pivot used by the simulation (anchor nudged toward the swing plane). */
  readonly pivot = new Vector3();
  ropeLength = 0;
  private ropeTarget = 0;
  swingSide = 1;
  swingTime = 0;
  airTime = 0;
  stunTime = 0;
  invuln = 0;
  /** Floaty fall after the opening leap / a respawn, until the first web. */
  grace = 0;
  /** Yaw steered since the current web attached. */
  turnSinceAttach = 0;
  /** Unit heading on the ground plane; the camera and targeting follow it. */
  readonly heading = new Vector3(0, 0, -1);
  steer = 0;
  vertical = 0;
  private readonly contacts: Contact[] = [];
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();

  reset(x: number, y: number, z: number, yaw: number, state: PlayerState, speed = 0) {
    this.pos.set(x, y, z);
    this.heading.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.vel.copy(this.heading).multiplyScalar(speed);
    this.state = state;
    this.stunTime = 0;
    this.invuln = state === "perched" ? 0 : 1.2;
    this.airTime = 0;
    this.grace = state === "air" ? 1.6 : 0;
  }

  get speed() {
    return this.vel.length();
  }

  leap() {
    if (this.state !== "perched") return;
    this.vel.copy(this.heading).multiplyScalar(17).addScaledVector(UP, 7);
    this.state = "air";
    this.grace = 2.4;
  }

  attach(point: Vector3, side: number): boolean {
    if (this.state === "stunned") return false;
    this.anchor.copy(point);
    // Pull the pivot toward the vertical plane through our heading so straight
    // swings stay in the street; leaning toward the anchor keeps the offset,
    // which is how you swing around corners.
    const right = this.tmp.crossVectors(this.heading, UP).normalize();
    const lateral = this.tmp2.subVectors(point, this.pos).dot(right);
    const leaningIn = Math.sign(this.steer) === Math.sign(lateral) && Math.abs(this.steer) > 0.2;
    const keep = leaningIn ? T.lateralKeep + (T.lateralKeepSteer - T.lateralKeep) * Math.abs(this.steer) : T.lateralKeep;
    this.pivot.copy(point).addScaledVector(right, -lateral * (1 - keep));
    const dist = this.pos.distanceTo(this.pivot);
    this.ropeLength = dist;
    this.ropeTarget = clamp(dist * T.ropeCatch, T.ropeMin, T.ropeMax);
    // Never let a swing start dead: top up speed along the heading.
    const along = this.vel.dot(this.heading);
    if (along < T.minSwingSpeed) this.vel.addScaledVector(this.heading, T.minSwingSpeed - along);
    this.swingSide = side;
    this.swingTime = 0;
    this.state = "swing";
    this.grace = 0;
    this.turnSinceAttach = 0;
    return true;
  }

  /** Mid-turn web switch: new anchor, same momentum, no yank. */
  reattach(point: Vector3, side: number) {
    if (this.state !== "swing") return;
    this.anchor.copy(point);
    const right = this.tmp.crossVectors(this.heading, UP).normalize();
    const lateral = this.tmp2.subVectors(point, this.pos).dot(right);
    this.pivot.copy(point).addScaledVector(right, -lateral * (1 - T.lateralKeepSteer));
    const dist = this.pos.distanceTo(this.pivot);
    const prev = this.ropeTarget;
    this.ropeLength = dist;
    this.ropeTarget = clamp(Math.min(dist * 0.97, prev), T.ropeMin, T.ropeMax);
    this.swingSide = side;
    this.turnSinceAttach = 0;
  }

  release(): { quality: number; perfect: boolean } | null {
    if (this.state !== "swing") return null;
    this.state = "air";
    this.airTime = 0;
    const sp = this.vel.length();
    if (sp < 1) return { quality: 0, perfect: false };
    const upShare = this.vel.y / sp;
    const [lo, hi] = T.perfectWindow;
    const mid = (lo + hi) / 2;
    const quality = upShare <= lo || upShare >= hi ? 0 : 1 - Math.abs(upShare - mid) / ((hi - lo) / 2);
    this.vel.multiplyScalar(1 + T.releaseBoost * quality);
    this.vel.y += T.releasePop * (0.35 + 0.65 * quality);
    return { quality, perfect: quality > 0.55 && sp > 12 };
  }

  update(dt: number, world: CollisionWorld, events: PlayerEvent[]) {
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.state === "perched") return;
    if (this.state === "stunned") {
      this.stunTime -= dt;
      if (this.stunTime <= 0) this.state = "air";
    }
    if (this.state === "swing") this.swingTime += dt;
    else this.airTime += dt;
    this.grace = Math.max(0, this.grace - dt);

    const h = dt / SUBSTEPS;
    for (let i = 0; i < SUBSTEPS; i++) this.step(h, world, events);

    // Heading follows horizontal velocity once we're actually moving.
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 2.5) {
      this.tmp.set(this.vel.x / hs, 0, this.vel.z / hs);
      this.heading.lerp(this.tmp, 1 - Math.exp(-8 * dt)).normalize();
    }
  }

  private step(h: number, world: CollisionWorld, events: PlayerEvent[]) {
    const v = this.vel;
    let g = T.gravity;
    if (this.state === "air") {
      if (this.vertical > 0.3 && v.y < 0) g *= T.glideGravity;
      else if (this.vertical < -0.3) g *= T.diveGravity;
      if (this.grace > 0 && v.y < 0) {
        g *= 0.3;
        v.y = Math.max(v.y, -9);
      }
    }
    v.y -= g * h;

    // Steering: rotate horizontal velocity (yaw) and, in the air, strafe (lean).
    // The rate grows with speed so the turn radius stays street-sized.
    const hs = Math.hypot(v.x, v.z);
    const base = this.state === "swing" ? T.yawRateSwing : T.yawRateAir;
    const yawRate = Math.max(base, hs / T.maxTurnRadius) * this.steer;
    if (yawRate !== 0 && this.state !== "stunned") {
      const a = yawRate * h; // positive steer turns right (toward +x when heading north)
      const c = Math.cos(a), s = Math.sin(a);
      const x = v.x * c - v.z * s;
      const z = v.x * s + v.z * c;
      v.x = x;
      v.z = z;
      if (this.state === "swing") {
        // Swing the pivot around with us so the rope doesn't fight the turn;
        // the game re-webs once the visible anchor drifts too far off.
        const px = this.pivot.x - this.pos.x, pz = this.pivot.z - this.pos.z;
        this.pivot.x = this.pos.x + px * c - pz * s;
        this.pivot.z = this.pos.z + px * s + pz * c;
        this.turnSinceAttach += a;
      }
      if (this.state === "air") {
        const right = this.tmp.crossVectors(this.heading, UP).normalize();
        v.addScaledVector(right, this.steer * T.strafeAccel * h);
      }
    }

    // Street assist: with no steering input, ease the flight line onto the
    // nearest street axis so a straight run down an avenue stays straight.
    if (Math.abs(this.steer) < 0.15 && this.state !== "stunned") {
      const yaw = Math.atan2(v.x, v.z);
      const axis = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
      const off = yaw - axis;
      if (Math.abs(off) < T.streetAssistCone && Math.abs(off) > 1e-4) {
        const a = -Math.sign(off) * Math.min(Math.abs(off), T.streetAssist * h);
        const c = Math.cos(a), s = Math.sin(a);
        const x = v.x * c + v.z * s;
        const z = -v.x * s + v.z * c;
        v.x = x;
        v.z = z;
      }
    }

    if (this.state === "swing") {
      const sp = v.length();
      if (sp > 0.1) {
        const dirx = v.x / sp, diry = v.y / sp, dirz = v.z / sp;
        // Downswing pump keeps chained swings feeling powerful.
        if (diry < -0.05) v.addScaledVector(this.tmp.set(dirx, diry, dirz), T.autoPump * -diry * h * 2);
        if (this.vertical > 0.3) {
          this.ropeTarget = Math.max(T.ropeMin, this.ropeTarget - T.reelSpeed * h);
          v.addScaledVector(this.tmp.set(dirx, diry, dirz), T.reelBoost * h);
        } else if (this.vertical < -0.3) {
          this.ropeTarget = Math.min(T.ropeMax, this.ropeTarget + T.letOutSpeed * h);
        }
      }
      // Street clearance: unless the player is deliberately letting out web,
      // the arc bottoms out above traffic.
      if (this.vertical > -0.3) this.ropeTarget = Math.max(T.ropeMin, Math.min(this.ropeTarget, this.pivot.y - T.swingFloor));
      this.ropeLength += (this.ropeTarget - this.ropeLength) * (1 - Math.exp(-T.catchRate * h));
    }

    // Quadratic drag + soft speed cap.
    const sp = v.length();
    v.multiplyScalar(Math.max(0, 1 - T.airDrag * sp * h));
    if (sp > T.maxSpeed) v.multiplyScalar(1 - (1 - T.maxSpeed / sp) * Math.min(1, 4 * h));

    this.pos.addScaledVector(v, h);

    if (this.state === "swing") {
      const d = this.tmp.subVectors(this.pos, this.pivot);
      const dist = d.length();
      if (dist > this.ropeLength) {
        d.divideScalar(dist);
        this.pos.copy(this.pivot).addScaledVector(d, this.ropeLength);
        const radial = v.dot(d);
        if (radial > 0) v.addScaledVector(d, -radial);
      }
    }

    this.collide(world, events);
  }

  private collide(world: CollisionWorld, events: PlayerEvent[]) {
    const r = T.playerRadius;
    for (const c of world.sphereContacts(this.pos, r, this.contacts)) {
      this.pos.addScaledVector(c.normal, c.depth);
      const into = -this.vel.dot(c.normal);
      if (into <= 0) continue;
      if (into > T.crashSpeed && this.invuln <= 0 && c.normal.y < 0.7) {
        events.push({ type: "crash", speed: into, normal: c.normal.clone() });
        this.vel.addScaledVector(c.normal, into * 1.25);
        this.vel.multiplyScalar(0.35);
        this.vel.y = Math.max(this.vel.y, 2);
        this.state = "stunned";
        this.stunTime = 0.55;
        this.invuln = T.invulnTime;
        return;
      }
      // Grazes and rooftop landings: slide along the surface.
      this.vel.addScaledVector(c.normal, into);
      if (c.normal.y > 0.7) {
        // Landed on a roof: hop off forward so the run never stalls.
        this.vel.y = Math.max(this.vel.y, 9);
        this.vel.addScaledVector(this.heading, 4);
        if (this.state === "swing") this.state = "air";
      } else {
        this.vel.multiplyScalar(0.985);
        events.push({ type: "graze" });
      }
    }

    // Street, canal and bay.
    if (isWater(this.pos.x, this.pos.z)) {
      if (this.pos.y < -1.2) events.push({ type: "splash" });
    } else if (this.pos.y < r + 0.3) {
      this.pos.y = r + 0.3;
      const hs = Math.hypot(this.vel.x, this.vel.z);
      this.vel.x *= 0.65;
      this.vel.z *= 0.65;
      if (hs < 6) this.vel.addScaledVector(this.heading, 6);
      this.vel.y = Math.max(8.5, Math.abs(this.vel.y) * 0.3);
      if (this.state === "swing") this.state = "air";
      events.push({ type: "bonk" });
    }
  }
}
