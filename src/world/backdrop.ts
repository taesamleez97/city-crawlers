// What a city's horizon looks like past the end of its map data: mountain ridges
// and far-off towers, as flat silhouettes on a ring around the camera.

import { type Color, DoubleSide, Group, Mesh, MeshBasicMaterial, type Vector3 } from "three";

import { mulberry32 } from "../core/math";
import type { CityStyle } from "./cities";
import { MeshBuilder } from "./meshBuilder";
import type { RGB } from "./palette";
import { lin } from "./realCity";

const R = 1150;
/** Below the ground at the ring from any eye height we fly at. */
const BASE = -90;
const DEG = Math.PI / 180;

/** Ground-plane point at a compass bearing (degrees clockwise from north; north is -z). */
const at = (bearing: number, r = R): [number, number] => [Math.sin(bearing * DEG) * r, -Math.cos(bearing * DEG) * r];
/** Height on the ring that shows `el` degrees above the horizon. */
const up = (el: number) => Math.tan(el * DEG) * R;

export class Backdrop {
  readonly group = new Group();
  private readonly mesh: Mesh;

  constructor(style: CityStyle, horizon: Color) {
    const b = new MeshBuilder();
    const haze = (hex: string, k: number): RGB => {
      const c = lin(hex);
      return [c[0] + (horizon.r - c[0]) * k, c[1] + (horizon.g - c[1]) * k, c[2] + (horizon.b - c[2]) * k];
    };
    for (const d of style.backdrop) {
      if (d.kind === "ridge") {
        const rng = mulberry32(d.seed);
        const peaks = Array.from({ length: d.peaks }, () => ({ at: rng(), h: 0.55 + rng() * 0.45, w: 0.12 + rng() * 0.18 }));
        const n = Math.max(10, Math.round(d.width * 1.5));
        const hs: number[] = [];
        for (let i = 0; i <= n; i++) {
          const u = i / n;
          let h = 0;
          for (const p of peaks) h = Math.max(h, p.h * Math.exp(-(((u - p.at) / p.w) ** 2)));
          // Lone peaks (Fuji) are cones; ranges taper off at their ends.
          const edge = d.peaks === 1 ? 1 : Math.min(1, u * 5, (1 - u) * 5);
          hs.push(h * edge * d.height);
        }
        const body = haze(d.color, 0.15);
        for (let i = 0; i < n; i++) {
          const b0 = d.bearing - d.width / 2 + (d.width * i) / n, b1 = d.bearing - d.width / 2 + (d.width * (i + 1)) / n;
          const [x0, z0] = at(b0), [x1, z1] = at(b1);
          b.face([x0, BASE, z0], [x1, BASE, z1], [x1, up(hs[i + 1]), z1], [x0, up(hs[i]), z0], body);
          if (d.snow) {
            const line = d.height * 0.72;
            if (hs[i] > line || hs[i + 1] > line) {
              const [sx0, sz0] = at(b0, R - 4), [sx1, sz1] = at(b1, R - 4);
              const t0 = Math.max(hs[i], line), t1 = Math.max(hs[i + 1], line);
              b.face([sx0, up(line), sz0], [sx1, up(line), sz1], [sx1, up(t1), sz1], [sx0, up(t0), sz0], [0.95, 0.96, 1]);
            }
          }
        }
      } else {
        const c = haze(d.color, 0.1);
        const [x, z] = at(d.bearing);
        // Facing the camera at the ring's center.
        const fx = -x / R, fz = -z / R;
        const deg = (w: number) => Math.tan(w * DEG) * R;
        if (d.shape === "namsan") {
          const hill = haze("#6E9E80", 0.2);
          b.obox(x, z, fx, fz, deg(7), 4, BASE, up(1.2), hill, hill, { hr1: deg(2.5), hf1: 4 });
          b.obox(x, z, fx, fz, deg(0.12), 2, up(1.2), up(3.0), c);
          b.obox(x, z, fx, fz, deg(0.32), 2.2, up(2.55), up(2.85), [0.9, 0.9, 0.92]);
          b.obox(x, z, fx, fz, deg(0.04), 2, up(3.0), up(3.6), c);
        } else if (d.shape === "tokyoTower") {
          b.obox(x, z, fx, fz, deg(0.55), 2, BASE, up(1.4), c, c, { hr1: deg(0.16), hf1: 2 });
          b.obox(x, z, fx, fz, deg(0.2), 2.4, up(1.15), up(1.3), [0.96, 0.96, 0.96]);
          b.obox(x, z, fx, fz, deg(0.16), 2, up(1.4), up(2.3), c, c, { hr1: deg(0.03), hf1: 2 });
          b.obox(x, z, fx, fz, deg(0.1), 2.4, up(1.9), up(2.0), [0.96, 0.96, 0.96]);
        } else if (d.shape === "skytree") {
          b.obox(x, z, fx, fz, deg(0.3), 2, BASE, up(2.4), c, c, { hr1: deg(0.1), hf1: 2 });
          b.obox(x, z, fx, fz, deg(0.2), 2.4, up(1.7), up(1.85), c);
          b.obox(x, z, fx, fz, deg(0.15), 2.4, up(2.25), up(2.35), c);
          b.obox(x, z, fx, fz, deg(0.05), 2, up(2.4), up(3.1), c, c, { hr1: deg(0.01), hf1: 2 });
        } else if (d.shape === "wtc") {
          b.obox(x, z, fx, fz, deg(0.7), 3, BASE, up(3.4), c, c, { hr1: deg(0.3), hf1: 3 });
          b.obox(x, z, fx, fz, deg(0.03), 2, up(3.4), up(4.4), c);
        } else {
          // A row of white blocks on the hills: the sign, without spelling it out.
          for (let k = 0; k < 9; k++) {
            const [lx, lz] = at(d.bearing - 1.6 + k * 0.4, R - 6);
            b.obox(lx, lz, fx, fz, deg(0.14), 1, up(1.1), up(1.6), [0.97, 0.97, 0.97]);
          }
        }
      }
    }
    this.mesh = new Mesh(b.build(), new MeshBasicMaterial({ vertexColors: true, fog: false, side: DoubleSide }));
    this.mesh.renderOrder = -9;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  /** Rides at eye height so a ridge's elevation reads the same from the roof and the street. */
  update(camPos: Vector3) {
    this.group.position.copy(camPos);
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}
