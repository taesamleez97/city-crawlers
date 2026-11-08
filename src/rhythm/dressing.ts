// Route set dressing: crane-hung girders to lean around, the coins a good lean
// collects, the finish ring and the blimp.

import { Group, InstancedMesh, type Material, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from "three";

import { MeshBuilder } from "../world/meshBuilder";
import { rgb } from "../world/palette";
import type { PropLibrary } from "../world/props";
import { BEAM_REACH, type Route } from "./route";

const BEAM_LEN = 19;
const BEAM_H = 1.7;
const CABLE_H = 46;
const FINISH_R = 5.6;
/** After the hero flies through the finish hoop: seconds it lingers, then seconds to shrink away. */
const FINISH_LINGER = 0.6;
const FINISH_SHRINK = 0.5;
const UP = new Vector3(0, 1, 0);

/** A blimp drifting back and forth along a line (x0, z0) to (x1, z1) at height y. */
export type BlimpPath = { x0: number; z0: number; x1: number; z1: number; y: number; speed: number };

type BeamRt = { pivot: Group; angle: number; vel: number };
type CoinRt = { pos: Vector3; beam: number; taken: boolean; anim: number };

function girderGeometry() {
  const b = new MeshBuilder();
  const hz = rgb("hazard"), dark = rgb("hazard_dark"), red = rgb("warning_red"), cable = rgb("metal_dark");
  const y0 = -CABLE_H - BEAM_H / 2, y1 = -CABLE_H + BEAM_H / 2;
  const n = Math.round(BEAM_LEN / 1.6);
  for (let k = 0; k < n; k++) {
    const x0 = (k / n) * BEAM_LEN, x1 = ((k + 1) / n) * BEAM_LEN;
    b.box(x0, y0, -0.55, x1, y1, 0.55, k % 2 ? hz : dark);
  }
  // Red nose on the end that reaches into the street.
  b.box(-0.35, y0 - 0.1, -0.65, 0.05, y1 + 0.1, 0.65, red);
  for (const x of [BEAM_LEN * 0.3, BEAM_LEN * 0.82]) {
    b.box(x - 0.08, y1, -0.08, x + 0.08, 0, 0.08, cable, { skipBottom: true, skipTop: true });
    b.box(x - 0.35, y1, -0.3, x + 0.35, y1 + 0.3, 0.3, cable, { skipBottom: true });
  }
  return b.build();
}

export class Dressing {
  readonly group = new Group();
  private readonly beams: BeamRt[] = [];
  private readonly coins: CoinRt[];
  private readonly coinMesh: InstancedMesh;
  private readonly finishMesh: Mesh;
  private readonly blimp: Mesh | null = null;
  /** Share of the way along the blimp's path. */
  private blimpU = 0;
  private blimpDir = 1;
  private blimpYaw = 0;
  private finishPop = 0;
  /** Seconds since the hero flew through the finish hoop; -1 before. */
  private finishAge = -1;
  private t = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly p = new Vector3();

  constructor(lib: PropLibrary, material: Material, route: Route, private readonly blimpPath?: BlimpPath) {
    const girder = girderGeometry();
    for (const beam of route.beams) {
      const side = beam.cue.side;
      // The girder comes in from the side the viewer must lean away from.
      const dir = beam.right.clone().multiplyScalar(-side);
      const pivot = new Group();
      pivot.position.copy(beam.pos).addScaledVector(beam.right, side * BEAM_REACH).addScaledVector(UP, 0.3 + CABLE_H);
      pivot.rotation.order = "YXZ";
      pivot.rotation.y = Math.atan2(-dir.z, dir.x);
      const mesh = new Mesh(girder, material);
      mesh.castShadow = true;
      pivot.add(mesh);
      this.group.add(pivot);
      this.beams.push({ pivot, angle: 0, vel: 0 });
    }

    const glow = new MeshBasicMaterial({ vertexColors: true });
    this.coins = route.coins.map((c) => ({ pos: c.pos, beam: c.beam, taken: false, anim: 0 }));
    this.coinMesh = new InstancedMesh(lib.get("coin"), glow, Math.max(1, this.coins.length));
    this.coinMesh.frustumCulled = false;
    this.group.add(this.coinMesh);

    this.finishMesh = new Mesh(lib.get("hoop_gold"), glow);
    this.finishMesh.position.copy(route.finish);
    this.finishMesh.rotation.y = Math.atan2(route.finishDir.x, route.finishDir.z);
    this.finishMesh.scale.setScalar(FINISH_R);
    this.group.add(this.finishMesh);

    if (blimpPath) {
      this.blimp = new Mesh(lib.get("blimp"), material);
      this.blimp.castShadow = true;
      this.group.add(this.blimp);
    }
    this.reset();
  }

  reset() {
    for (const b of this.beams) b.angle = b.vel = 0;
    for (const c of this.coins) {
      c.taken = false;
      c.anim = 0;
    }
    this.finishPop = 0;
    this.finishAge = -1;
  }

  /** The hero clipped this girder: set it swinging. */
  knock(index: number) {
    const b = this.beams[index];
    if (b) b.vel += 0.12;
  }

  /** A good lean collects that girder's coins; returns where they were. */
  collect(index: number): Vector3[] {
    const out: Vector3[] = [];
    for (const c of this.coins) {
      if (c.beam !== index || c.taken) continue;
      c.taken = true;
      c.anim = 1;
      out.push(c.pos);
    }
    return out;
  }

  passFinish() {
    this.finishPop = 1;
    this.finishAge = 0;
  }

  update(dt: number) {
    this.t += dt;
    for (const b of this.beams) {
      // Damped pendulum on 46 m of cable.
      b.vel += (-0.21 * b.angle - 0.35 * b.vel) * dt * 4;
      b.angle += b.vel * dt;
      b.pivot.rotation.x = b.angle;
    }

    const spin = this.t * 2.6;
    this.coins.forEach((c, i) => {
      let scale = 1.6;
      let turn = spin + i * 0.4;
      this.p.copy(c.pos);
      if (c.taken) {
        // Burst where it hangs; flying it at the camera fills the screen.
        c.anim = Math.max(0, c.anim - dt * 6);
        scale = 1.6 * c.anim;
        turn += (1 - c.anim) * 8;
      } else {
        this.p.y += Math.sin(this.t * 2 + i) * 0.2;
      }
      this.q.setFromAxisAngle(UP, turn);
      this.m.compose(this.p, this.q, this.s.setScalar(scale));
      this.coinMesh.setMatrixAt(i, this.m);
    });
    this.coinMesh.instanceMatrix.needsUpdate = true;

    this.finishPop = Math.max(0, this.finishPop - dt * 1.5);
    // Once flown through it pops, then shrinks away: the finish roof looks back over it.
    if (this.finishAge >= 0) this.finishAge += dt;
    const gone = this.finishAge < 0 ? 1 : Math.min(1, Math.max(0, 1 - (this.finishAge - FINISH_LINGER) / FINISH_SHRINK));
    this.finishMesh.visible = gone > 0;
    this.finishMesh.rotation.z = this.t * 0.4;
    this.finishMesh.scale.setScalar(FINISH_R * gone * (1 + Math.sin(this.t * 5) * 0.04 + this.finishPop * 0.5));

    const b = this.blimpPath;
    if (!b || !this.blimp) return;
    const len = Math.hypot(b.x1 - b.x0, b.z1 - b.z0);
    this.blimpU += (this.blimpDir * b.speed * dt) / len;
    if (this.blimpU > 1) this.blimpDir = -1;
    if (this.blimpU < 0) this.blimpDir = 1;
    // The model's nose points along +x.
    const heading = Math.atan2(-(b.z1 - b.z0), b.x1 - b.x0) + (this.blimpDir > 0 ? 0 : Math.PI);
    this.blimpYaw += Math.atan2(Math.sin(heading - this.blimpYaw), Math.cos(heading - this.blimpYaw)) * (1 - Math.exp(-1.2 * dt));
    this.blimp.position.set(b.x0 + (b.x1 - b.x0) * this.blimpU, b.y + Math.sin(this.t * 0.7) * 0.8, b.z0 + (b.z1 - b.z0) * this.blimpU);
    this.blimp.rotation.set(0, this.blimpYaw, Math.sin(this.t * 0.5) * 0.03);
  }
}
