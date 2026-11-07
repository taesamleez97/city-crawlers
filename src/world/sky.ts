import {
  BackSide, BufferAttribute, Color, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, SphereGeometry,
  type Vector3,
} from "three";

import { type Rng, mulberry32, range } from "../core/math";
import { BOUNDS } from "./cityLayout";
import { MeshBuilder } from "./meshBuilder";
import { pal, rgb } from "./palette";

/** Gradient dome + bay water + blocky clouds. Everything here is unlit-cheap. */
export class Sky {
  readonly group = new Group();
  private readonly dome: Mesh;
  private readonly clouds: Mesh;
  private t = 0;

  constructor() {
    const geo = new SphereGeometry(1400, 24, 12);
    const top = pal("sky_top"), horizon = pal("sky_horizon");
    const pos = geo.getAttribute("position");
    const colors = new Float32Array(pos.count * 3);
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 1400;
      const t = Math.pow(Math.max(0, y), 0.55);
      c.copy(horizon).lerp(top, t);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute("color", new BufferAttribute(colors, 3));
    this.dome = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    const water = new Mesh(new PlaneGeometry(6000, 6000), new MeshLambertMaterial({ color: pal("water") }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -2.1;
    water.receiveShadow = true;
    this.group.add(water);

    // Foam ring hugging the seawall: a classic Crossy Road shoreline beat.
    const foam = new MeshBuilder();
    const fc = rgb("water_light");
    const m = 1.6;
    foam.flat(BOUNDS.x0 - m - 2, BOUNDS.z1, BOUNDS.x1 + m + 2, BOUNDS.z1 + m, -2.05, fc);
    foam.flat(BOUNDS.x0 - m - 2, BOUNDS.z0 - m, BOUNDS.x1 + m + 2, BOUNDS.z0, -2.05, fc);
    foam.flat(BOUNDS.x0 - m, BOUNDS.z0, BOUNDS.x0, BOUNDS.z1, -2.05, fc);
    foam.flat(BOUNDS.x1, BOUNDS.z0, BOUNDS.x1 + m, BOUNDS.z1, -2.05, fc);
    const foamMesh = new Mesh(foam.build(), new MeshBasicMaterial({ vertexColors: true }));
    this.group.add(foamMesh);

    this.clouds = new Mesh(buildClouds(mulberry32(42)), new MeshBasicMaterial({ vertexColors: true, fog: false }));
    this.clouds.frustumCulled = false;
    this.group.add(this.clouds);
  }

  update(dt: number, camPos: Vector3) {
    this.t += dt;
    this.dome.position.copy(camPos);
    this.clouds.position.set(camPos.x * 0.85 + this.t * 2.2, 0, camPos.z * 0.85);
  }
}

function buildClouds(rng: Rng) {
  const b = new MeshBuilder();
  const white = rgb("cloud"), shade = rgb("cloud_shade");
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const r = range(rng, 450, 900);
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const cy = range(rng, 170, 300);
    const s = range(rng, 0.8, 1.8);
    const puffs = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < puffs; k++) {
      const w = range(rng, 30, 60) * s, h = range(rng, 12, 22) * s, d = range(rng, 22, 40) * s;
      const ox = (k - puffs / 2) * 26 * s + range(rng, -6, 6);
      const oy = (k % 2) * 8 * s;
      b.box(cx + ox - w / 2, cy + oy, cz - d / 2, cx + ox + w / 2, cy + oy + h, cz + d / 2, { top: white, sides: white, bottom: shade, s: white, n: shade });
    }
  }
  return b.build();
}
