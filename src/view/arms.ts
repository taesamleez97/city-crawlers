import {
  AdditiveBlending, type Bone, CanvasTexture, DirectionalLight, Group, HemisphereLight, type Interpolant, type KeyframeTrack,
  MathUtils, Mesh, MeshLambertMaterial, type Object3D, PerspectiveCamera, Quaternion, SRGBColorSpace, Scene, Sprite,
  SpriteMaterial, Vector3,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { SpringScalar, SpringVec3, clamp } from "../core/math";
import type { Subject } from "../game/subject";
import { pal } from "../world/palette";

type Side = "L" | "R";
type PoseName = "relax" | "grip" | "open" | "thwip";
const POSES: PoseName[] = ["relax", "grip", "open", "thwip"];
/** How long the web-shooter hand holds after a web fires, before it closes on the line. */
const THWIP_HOLD = 0.28;
/** Lifetime of the flare at the wrist when a shot registers, seconds. */
const PUFF_LIFE = 0.24;
const ARMS_FOV = 58;

const v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3(), v4 = new Vector3(), v5 = new Vector3();
const q1 = new Quaternion(), q2 = new Quaternion(), q3 = new Quaternion();
const X_AXIS = new Vector3(1, 0, 0);
/** Shoulders sit a little ahead of and below the eye. */
const ROOT_OFFSET = new Vector3(0, -0.02, -0.06);

/** A white starburst: the web-shooter going off. */
function puffTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 40);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.lineCap = "round";
  g.lineWidth = 7;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    g.beginPath();
    g.moveTo(64 + Math.cos(a) * 30, 64 + Math.sin(a) * 30);
    g.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A track's first key, through its interpolant: cubic-spline keys store in-tangent, value, out-tangent. */
function firstKey(track: KeyframeTrack) {
  const interp = (track as KeyframeTrack & { createInterpolant(): Interpolant }).createInterpolant();
  return new Quaternion().fromArray(interp.evaluate(track.times[0])).normalize();
}

class Arm {
  readonly sx: number;
  readonly upper: Bone;
  readonly fore: Bone;
  readonly hand: Bone;
  private readonly restUpper: Quaternion;
  private readonly restFore: Quaternion;
  private readonly restHand: Quaternion;
  private readonly fingers: Bone[] = [];
  private readonly poses: Record<PoseName, Quaternion[]> = { relax: [], grip: [], open: [], thwip: [] };
  readonly target = new SpringVec3(260, 30);
  readonly grip = new SpringScalar(260, 30);
  readonly open = new SpringScalar(260, 30);
  readonly thwip = new SpringScalar(320, 34);
  readonly wrist = new SpringScalar(200, 24);

  constructor(root: Object3D, gltf: GLTF, readonly side: Side) {
    this.sx = side === "R" ? 1 : -1;
    const bone = (n: string) => {
      const b = root.getObjectByName(`${n}_${side}`) as Bone | undefined;
      if (!b) throw new Error(`arms rig is missing bone ${n}_${side}`);
      return b;
    };
    this.upper = bone("upperarm");
    this.fore = bone("forearm");
    this.hand = bone("hand");
    this.restUpper = this.upper.quaternion.clone();
    this.restFore = this.fore.quaternion.clone();
    this.restHand = this.hand.quaternion.clone();
    // Everything under the hand is posed from the clips, whatever the finger layout.
    this.hand.traverse((o) => {
      if (o !== this.hand && (o as Bone).isBone) this.fingers.push(o as Bone);
    });
    // Clips are single-frame poses: sample them once into a pose library.
    for (const pose of POSES) {
      const find = (p: PoseName) => gltf.animations.find((c) => c.name === `${p}_${side}`);
      // Rigs without a web-shooter hand splay open instead.
      const clip = find(pose) ?? (pose === "thwip" ? find("open") : undefined);
      this.poses[pose] = this.fingers.map((b) => {
        const track = clip?.tracks.find((t) => t.name === `${b.name}.quaternion`);
        return track ? firstKey(track) : b.quaternion.clone();
      });
    }
  }

  /** Two-bone IK in arms-scene space (= camera space). */
  solve(target: Vector3, pole: Vector3) {
    this.upper.quaternion.copy(this.restUpper);
    this.fore.quaternion.copy(this.restFore);
    this.upper.updateWorldMatrix(true, true);
    const S = this.upper.getWorldPosition(v1);
    const E0 = this.fore.getWorldPosition(v2);
    const H0 = this.hand.getWorldPosition(v3);
    const a = S.distanceTo(E0), b = E0.distanceTo(H0);
    const toT = v4.subVectors(target, S);
    const d = clamp(toT.length(), Math.abs(a - b) + 1e-3, (a + b) * 0.995);
    const u = toT.normalize();
    const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const p = v5.copy(pole).addScaledVector(u, -pole.dot(u)).normalize();
    const E = new Vector3().copy(S).addScaledVector(u, a * cosA).addScaledVector(p, a * sinA);
    const T = new Vector3().copy(S).addScaledVector(u, d);

    q1.setFromUnitVectors(E0.sub(S).normalize(), new Vector3().subVectors(E, S).normalize());
    this.upper.getWorldQuaternion(q2);
    q2.premultiply(q1);
    this.upper.parent!.getWorldQuaternion(q3).invert();
    this.upper.quaternion.copy(q3.multiply(q2));
    this.upper.updateWorldMatrix(false, true);

    const E1 = this.fore.getWorldPosition(v2);
    const H1 = this.hand.getWorldPosition(v3);
    q1.setFromUnitVectors(H1.sub(E1).normalize(), T.sub(E1).normalize());
    this.fore.getWorldQuaternion(q2);
    q2.premultiply(q1);
    this.upper.getWorldQuaternion(q3).invert();
    this.fore.quaternion.copy(q3.multiply(q2));

    this.hand.quaternion.copy(this.restHand).multiply(q1.setFromAxisAngle(X_AXIS, this.wrist.value));
  }

  applyPose() {
    const g = clamp(this.grip.value, 0, 1), o = clamp(this.open.value, 0, 1), t = clamp(this.thwip.value, 0, 1);
    this.fingers.forEach((b, i) => {
      b.quaternion.copy(this.poses.relax[i]).slerp(this.poses.grip[i], g).slerp(this.poses.open[i], o)
        .slerp(this.poses.thwip[i], t);
    });
  }
}

/** Arms state the game drives; the view turns it into motion. */
type Gesture = "none" | "shoot" | "release" | "crash";

/** The player's real arm from the camera: direction in arm lengths (out to its side, up) and reach. */
export type BodyArm = { out: number; up: number; reach: number };

export class ArmsView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(ARMS_FOV, 16 / 9, 0.02, 10);
  private readonly root = new Group();
  private readonly arms: Record<Side, Arm>;
  private readonly sun = new DirectionalLight(pal("sun"), 2.1);
  private readonly hemi = new HemisphereLight(pal("hemi_sky"), pal("hemi_ground"), 1.25);
  private readonly sway = new SpringVec3(60, 11);
  private gesture: Gesture = "none";
  private gestureT = 0;
  private gestureSide: Side = "R";
  private activeSide: Side | null = null;
  private t = 0;
  private lastVel = new Vector3();
  private readonly body: Record<Side, BodyArm | null> = { L: null, R: null };
  /** Seconds since each arm's last shot flick and wrist flare. */
  private readonly flickT: Record<Side, number> = { L: 9, R: 9 };
  private readonly puffT: Record<Side, number> = { L: 9, R: 9 };
  private readonly puffs: Record<Side, Sprite>;
  /** Hand position of the web-holding arm, in arms-camera NDC (for the web line). */
  readonly handNdc = new Vector3();
  /** Rooftop aiming: which arm is up and the camera-space direction it points. */
  private hub: { side: Side; dir: Vector3 } | null = null;

  constructor(gltf: GLTF) {
    const model = gltf.scene;
    const mat = new MeshLambertMaterial({ vertexColors: true });
    model.traverse((o) => {
      if ((o as Mesh).isMesh) {
        const m = o as Mesh;
        m.material = mat;
        m.frustumCulled = false;
      }
    });
    this.root.add(model);
    this.scene.add(this.root, this.sun, this.hemi, this.sun.target);
    this.arms = { L: new Arm(model, gltf, "L"), R: new Arm(model, gltf, "R") };
    for (const arm of Object.values(this.arms)) {
      arm.target.snap(this.restTarget(arm, 0));
      arm.grip.value = 0;
    }
    const puffMap = puffTexture();
    const puff = () => {
      const s = new Sprite(new SpriteMaterial({ map: puffMap, blending: AdditiveBlending, depthTest: false, depthWrite: false, transparent: true }));
      s.renderOrder = 30;
      s.visible = false;
      this.scene.add(s);
      return s;
    };
    this.puffs = { L: puff(), R: puff() };
  }

  /** A shot registered: the web-shooter flares at the wrist, whether or not it hit anything. */
  puff(side: number) {
    this.puffT[side > 0 ? "R" : "L"] = 0;
  }

  /** The web-shooter hand snaps out for a shot that missed, without letting go of a held web. */
  flick(side: number) {
    this.flickT[side > 0 ? "R" : "L"] = 0;
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  onAttach(side: number) {
    this.gestureSide = side > 0 ? "R" : "L";
    this.activeSide = this.gestureSide;
    this.gesture = "shoot";
    this.gestureT = 0;
  }
  onRelease() {
    if (this.activeSide) this.gestureSide = this.activeSide;
    this.activeSide = null;
    this.gesture = "release";
    this.gestureT = 0;
  }
  onCrash() {
    this.activeSide = null;
    this.gesture = "crash";
    this.gestureT = 0;
  }

  /**
   * Rooftop: one arm held out in the web-shooter pose along `dir` (camera space), the
   * other dropped out of frame. Null hands the arms back to the run.
   */
  setHub(side: number | null, dir?: Vector3) {
    if (side === null || !dir) {
      this.hub = null;
      return;
    }
    this.hub ??= { side: "R", dir: new Vector3() };
    this.hub.side = side > 0 ? "R" : "L";
    this.hub.dir.copy(dir);
  }

  /** Mirror the player's arms (null = not seen: the arm animates on its own). */
  setBody(left: BodyArm | null, right: BodyArm | null) {
    this.body.L = left;
    this.body.R = right;
  }

  /** Camera-space point for a mirrored real arm: hanging low, fists up mid-frame, thrown up into the corners. */
  private bodyTarget(b: BodyArm, sx: number) {
    const halfH = Math.tan(MathUtils.degToRad(ARMS_FOV / 2));
    const halfW = halfH * this.camera.aspect;
    const depth = 0.42 + 0.16 * clamp(b.reach, 0, 1);
    const fx = clamp(0.5 + 0.36 * b.out, 0.34, 0.8);
    const fy = -1.05 + 1.55 * clamp((b.up + 0.95) / 1.65, 0, 1);
    return new Vector3(sx * fx * halfW * depth, fy * halfH * depth, -depth);
  }

  private restTarget(arm: Arm, speed: number) {
    const tuck = clamp(speed / 40, 0, 1);
    return new Vector3(arm.sx * (0.27 - tuck * 0.03), -0.27 - tuck * 0.03, -0.45);
  }

  /**
   * Camera-space point the hand reaches for. Each hand stays on its own side of
   * the frame and well away from the lens, so a reaching arm never walls off the view.
   */
  private reachTarget(dirCam: Vector3, depth: number, sx: number, inner = 0.3) {
    const halfH = Math.tan(MathUtils.degToRad(ARMS_FOV / 2));
    const halfW = halfH * this.camera.aspect;
    const fwd = Math.max(0.25, -dirCam.z);
    let x = clamp(dirCam.x / fwd, -halfW * 0.72, halfW * 0.72);
    x = sx > 0 ? Math.max(x, halfW * inner) : Math.min(x, -halfW * inner);
    const y = clamp(dirCam.y / fwd, -halfH * 0.3, halfH * 0.58);
    return new Vector3(x * depth, y * depth, -depth);
  }

  update(dt: number, player: Subject, mainCamera: PerspectiveCamera, sunDirWorld: Vector3) {
    this.t += dt;
    this.gestureT += dt;
    this.flickT.L += dt;
    this.flickT.R += dt;
    const speed = player.speed;

    // Light the arms like the world: sun direction expressed in camera space.
    q1.copy(mainCamera.quaternion).invert();
    this.sun.position.copy(sunDirWorld).applyQuaternion(q1).multiplyScalar(5);

    // Body lag: arms swing opposite to acceleration, and bob with speed.
    const accel = v1.subVectors(player.vel, this.lastVel).divideScalar(Math.max(dt, 1e-3)).applyQuaternion(q1);
    this.lastVel.copy(player.vel);
    const lag = v2.set(clamp(-accel.x * 0.0015, -0.04, 0.04), clamp(-accel.y * 0.0012, -0.04, 0.04), 0);
    const bob = Math.sin(this.t * (2 + speed * 0.08)) * 0.006 * (1 + speed / 30);
    lag.y += bob;
    this.root.position.copy(this.sway.step(lag, dt)).add(ROOT_OFFSET);
    this.root.rotation.z = player.steer * 0.05;

    const anchorCam = player.state === "swing" ? v3.copy(player.anchor).sub(mainCamera.position).applyQuaternion(q1).normalize() : null;

    for (const side of ["L", "R"] as Side[]) {
      const arm = this.arms[side];
      let target = this.restTarget(arm, speed);
      let grip = 0.15, open = 0, thwip = 0, wrist = 0.1;
      const isActive = this.activeSide === side && anchorCam;
      const isGesture = this.gestureSide === side;
      const body = this.body[side];

      if (body && !isActive) {
        // A fist while loaded; the web-shooter hand forms as the real arm punches out.
        target = this.bodyTarget(body, arm.sx);
        const out = clamp((body.reach - 0.4) / 0.3, 0, 1);
        grip = 1 - out;
        thwip = out;
        wrist = 0.1 + out * 0.6;
      } else if (isActive) {
        target = this.reachTarget(anchorCam!, 0.6, arm.sx);
        grip = 1;
        wrist = -0.15;
        if (this.gesture === "shoot" && this.gestureT < THWIP_HOLD) {
          // Thwip: arm punches out, wrist snaps back, middle and ring fingers hit the trigger.
          target = this.reachTarget(anchorCam!, 0.68, arm.sx);
          grip = 0;
          thwip = 1;
          wrist = 0.85;
        }
      } else if (this.activeSide && !isActive) {
        // Free arm counterbalances the swing: low and back.
        target.set(arm.sx * 0.25, -0.3, -0.4);
        grip = 0.35;
      }
      if (this.flickT[side] < THWIP_HOLD && !isActive) {
        if (!body) target.set(arm.sx * 0.3, 0.06, -0.62);
        grip = 0;
        thwip = 1;
        wrist = 0.85;
      }

      if (!body && isGesture && this.gesture === "release" && this.gestureT < 0.35) {
        const k = this.gestureT / 0.35;
        target.set(arm.sx * (0.22 + k * 0.05), -0.05 - k * 0.2, -0.48 + k * 0.1);
        open = 1 - k;
        grip = 0;
        wrist = 0.4 * (1 - k);
      }
      if (this.gesture === "crash" && this.gestureT < 0.6) {
        target.set(arm.sx * 0.16, 0.02, -0.34);
        open = 1;
        grip = 0;
        wrist = 0.9;
      }
      if (player.state === "perched" && !body) {
        // Crouched on the ledge, hands braced on the parapet.
        target.set(arm.sx * 0.26, -0.21 + Math.sin(this.t * 1.3 + arm.sx) * 0.006, -0.42);
        grip = 0.75;
        wrist = -0.35;
      }
      if (this.hub) {
        if (side === this.hub.side) {
          // Held in the thwip pose; a shot snaps the wrist back and jolts the hand toward the eye.
          // Kept to its own side and low, so it points the way without covering the portals.
          const kick = clamp(1 - this.flickT[side] / 0.3, 0, 1);
          target = this.reachTarget(this.hub.dir, 0.7 - 0.09 * kick, arm.sx, 0.5);
          // Held low so the hand stays under the portal labels, whatever it aims at.
          target.y = -0.19 + 0.025 * kick;
          grip = 0;
          open = 0;
          thwip = 1;
          wrist = 0.35 + 0.5 * kick;
        } else {
          target.set(arm.sx * 0.32, -0.62, -0.32);
          grip = 0.4;
          open = 0;
          thwip = 0;
          wrist = 0;
        }
      }

      arm.target.step(target, dt);
      arm.grip.step(grip, dt);
      arm.open.step(open, dt);
      arm.thwip.step(thwip, dt);
      arm.wrist.step(wrist, dt);
      arm.applyPose();
      arm.solve(arm.target.value, v4.set(arm.sx * 0.8, -1, 0.35));
    }

    this.root.updateMatrixWorld(true);
    const holdSide = this.activeSide ?? this.hub?.side;
    const holding = holdSide ? this.arms[holdSide] : null;
    if (holding) holding.hand.getWorldPosition(this.handNdc).project(this.camera);
    this.updatePuffs(dt);
  }

  /** Flares just past each wrist, toward the fingers. */
  private updatePuffs(dt: number) {
    for (const side of ["L", "R"] as Side[]) {
      const s = this.puffs[side];
      const k = (this.puffT[side] += dt) / PUFF_LIFE;
      s.visible = k < 1;
      if (!s.visible) continue;
      const arm = this.arms[side];
      const hand = arm.hand.getWorldPosition(v1);
      const along = arm.fore.getWorldPosition(v2).sub(hand).normalize().multiplyScalar(-0.07);
      s.position.copy(hand).add(along);
      s.scale.setScalar(0.06 + 0.13 * Math.sqrt(k));
      s.material.opacity = 1 - k * k;
      s.material.rotation = arm.sx * k * 0.8;
    }
  }

  /** World-space point where the web leaves the hand, as seen through the main camera. */
  webOrigin(mainCamera: PerspectiveCamera, out: Vector3) {
    out.set(this.handNdc.x, this.handNdc.y, 0.5).unproject(mainCamera);
    out.sub(mainCamera.position).normalize().multiplyScalar(0.7).add(mainCamera.position);
    return out;
  }

  get holdingSide(): Side | null {
    return this.activeSide;
  }
}
