import { Euler, type PerspectiveCamera, Vector3 } from "three";

import { TUNING as T } from "../config";
import { clamp, damp, dampAngle, smoothstep } from "../core/math";
import type { Subject } from "../game/subject";

const EYE = new Vector3(0, 0.3, 0);

/** Where the camera wants to pitch for a velocity (vertical, horizontal speed). The route replays this to place rings. */
export const flightPitch = (vy: number, hs: number) =>
  clamp(Math.atan2(vy, Math.max(6, hs)) * T.pitchFromVel + T.pitchBias, T.pitchMin, T.pitchMax);

/**
 * First-person camera. Comfort rules for a big screen: yaw and pitch are smoothed
 * toward the direction of travel (never snapped), roll is small and only from
 * leaning, FOV widens with speed instead of the camera shaking.
 */
export class CameraRig {
  yaw = 0;
  pitch = -0.08;
  roll = 0;
  fov: number = T.fovBase;
  private trauma = 0;
  private kick = 0;
  private t = 0;
  private readonly euler = new Euler(0, 0, 0, "YXZ");
  /** Optional look-around for the title screen. */
  idleSway = 0;

  constructor(readonly camera: PerspectiveCamera) {}

  snap(s: Subject) {
    this.yaw = Math.atan2(-s.heading.x, -s.heading.z);
    this.pitch = -0.1;
    this.roll = 0;
    this.trauma = 0;
    this.kick = 0;
    this.apply(s.pos);
  }

  addTrauma(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** A quick FOV punch: sells a web connecting. */
  addKick(amount: number) {
    this.kick = Math.min(1.5, this.kick + amount);
  }

  update(dt: number, s: Subject) {
    this.t += dt;
    const hs = Math.hypot(s.vel.x, s.vel.z);
    const targetYaw = Math.atan2(-s.heading.x, -s.heading.z);
    this.yaw = dampAngle(this.yaw, targetYaw + Math.sin(this.t * 0.25) * this.idleSway, T.yawFollow, dt);

    let targetPitch: number;
    if (s.state !== "perched") {
      targetPitch = flightPitch(s.vel.y, hs);
    } else {
      targetPitch = -0.12 + Math.sin(this.t * 0.4) * 0.04 * this.idleSway;
    }
    this.pitch = damp(this.pitch, targetPitch, T.pitchFollow, dt);

    const swingLean = s.state === "swing" ? s.swingSide * -0.04 : 0;
    this.roll = damp(this.roll, -s.steer * T.rollMax + swingLean, 5, dt);

    const targetFov = T.fovBase + (T.fovFast - T.fovBase) * smoothstep(T.fovSpeedLo, T.fovSpeedHi, s.speed);
    this.fov = damp(this.fov, targetFov, 3, dt);
    this.kick = Math.max(0, this.kick - dt * 4);

    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.apply(s.pos);
  }

  private apply(pos: Vector3) {
    const shake = this.trauma * this.trauma;
    const n = (s: number) => Math.sin(this.t * s) * Math.sin(this.t * s * 0.37 + 1.3);
    this.camera.position.copy(pos).add(EYE);
    this.euler.set(this.pitch + n(37) * 0.05 * shake, this.yaw + n(41) * 0.05 * shake, this.roll + n(29) * 0.07 * shake);
    this.camera.quaternion.setFromEuler(this.euler);
    const fov = this.fov + this.kick * this.kick * 5;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
