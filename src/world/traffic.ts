import { Euler, Group, InstancedMesh, type Material, Matrix4, Quaternion, Vector3 } from "three";

import { mulberry32 } from "../core/math";
import type { TrafficLane } from "./city";
import type { PropLibrary } from "./props";

const MODELS = ["vehicle-truck-red", "vehicle-truck-yellow", "vehicle-truck-green", "vehicle-truck-purple"];
/** Kenney's vehicles face +z; rotate so they drive along their lane. */
const MODEL_YAW = 0;

type Car = { lane: TrafficLane; t: number; speed: number; model: number; slot: number; yaw: number; len: number };

/** Ambient street traffic: pure decoration that sells scale from up high. */
export class Traffic {
  readonly group = new Group();
  private readonly cars: Car[] = [];
  private readonly meshes: InstancedMesh[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly p = new Vector3();
  private readonly one = new Vector3(1, 1, 1);

  /** `models` may repeat a name to make it more common. */
  constructor(lib: PropLibrary, material: Material, lanes: TrafficLane[], models: readonly string[] = MODELS, private readonly y = 0.05) {
    const rng = mulberry32(7);
    const names = [...new Set(models)];
    const counts = names.map(() => 0);
    for (const lane of lanes) {
      const len = Math.hypot(lane.bx - lane.ax, lane.bz - lane.az);
      const yaw = Math.atan2(lane.bx - lane.ax, lane.bz - lane.az) + MODEL_YAW;
      for (let i = 0; i < lane.count; i++) {
        const model = names.indexOf(models[Math.floor(rng() * models.length)]);
        this.cars.push({ lane, t: (i + rng() * 0.6) / lane.count, speed: 9 + rng() * 5, model, slot: counts[model]++, yaw, len });
      }
    }
    names.forEach((name, i) => {
      const mesh = new InstancedMesh(lib.get(`kit:${name}`), material, Math.max(1, counts[i]));
      mesh.count = counts[i];
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
    });
    this.update(0);
  }

  update(dt: number) {
    for (const c of this.cars) {
      c.t = (c.t + (c.speed * dt) / c.len) % 1;
      const { lane } = c;
      this.p.set(lane.ax + (lane.bx - lane.ax) * c.t, this.y, lane.az + (lane.bz - lane.az) * c.t);
      this.q.setFromEuler(this.e.set(0, c.yaw, 0));
      this.m.compose(this.p, this.q, this.one);
      this.meshes[c.model].setMatrixAt(c.slot, this.m);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }

  /** The vehicle geometry belongs to the prop library: only the instance buffers go. */
  dispose() {
    for (const m of this.meshes) m.dispose();
  }
}
