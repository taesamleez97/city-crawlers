import { Euler, type PerspectiveCamera, Vector3 } from "three";

import { TUNING as T } from "../config";
import { clamp, damp, dampAngle, smoothstep } from "../core/math";
import type { Player } from "../game/player";

const EYE = new Vector3(0, 0.3, 0);

/**
 * First-person camera. Comfort rules for a big screen: yaw and pitch are smoothed
 * toward the direction of travel (never snapped), roll is small and only from
 * steering, FOV widens with speed instead of the camera shaking.
 */
export class CameraRig {
  yaw = 0;
  pitch = -0.08;
  roll = 0;
  fov: number = T.fovBase;
  private trauma = 0;
  private t = 0;
  private readonly euler = new Euler(0, 0, 0, "YXZ");
  /** Optional look-around for the title screen. */
  idleSway = 0;

  constructor(readonly camera: PerspectiveCamera) {}

  snap(player: Player) {
    this.yaw = Math.atan2(-player.heading.x, -player.heading.z);
    this.pitch = -0.08;
    this.roll = 0;
    this.trauma = 0;
    this.apply(player.pos);
  }

  addTrauma(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number, player: Player) {
    this.t += dt;
    const hs = Math.hypot(player.vel.x, player.vel.z);
    const targetYaw = Math.atan2(-player.heading.x, -player.heading.z);
    this.yaw = dampAngle(this.yaw, targetYaw + Math.sin(this.t * 0.25) * this.idleSway, T.yawFollow, dt);

    let targetPitch = -0.1;
    if (player.state !== "perched") {
      const velPitch = Math.atan2(player.vel.y, Math.max(6, hs));
      targetPitch = clamp(velPitch * 0.4 - 0.1, -0.5, 0.22);
    } else {
      targetPitch = -0.12 + Math.sin(this.t * 0.4) * 0.04 * this.idleSway;
    }
    this.pitch = damp(this.pitch, targetPitch, T.pitchFollow, dt);

    const swingLean = player.state === "swing" ? player.swingSide * -0.04 : 0;
    this.roll = damp(this.roll, -player.steer * T.rollMax + swingLean, 4, dt);

    const sp = player.speed;
    const targetFov = T.fovBase + (T.fovFast - T.fovBase) * smoothstep(14, T.maxSpeed, sp);
    this.fov = damp(this.fov, targetFov, 3, dt);

    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.apply(player.pos);
  }

  private apply(pos: Vector3) {
    const shake = this.trauma * this.trauma;
    const n = (s: number) => Math.sin(this.t * s) * Math.sin(this.t * s * 0.37 + 1.3);
    this.camera.position.copy(pos).add(EYE);
    this.euler.set(this.pitch + n(37) * 0.05 * shake, this.yaw + n(41) * 0.05 * shake, this.roll + n(29) * 0.07 * shake);
    this.camera.quaternion.setFromEuler(this.euler);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
