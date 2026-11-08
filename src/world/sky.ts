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
  /** Downtown's bay and seawall foam; the map cities bring their own ground. */
  private readonly shore = new Group();
  private t = 0;

  constructor() {
    const geo = new SphereGeometry(1400, 24, 12);
    geo.setAttribute("color", new BufferAttribute(new Float32Array(geo.getAttribute("position").count * 3), 3));
    this.dome = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);
    this.setColors(pal("sky_top"), pal("sky_horizon"));

    const water = new Mesh(new PlaneGeometry(6000, 6000), new MeshLambertMaterial({ color: pal("water") }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -2.1;
    water.receiveShadow = true;
    this.shore.add(water);
    this.group.add(this.shore);

    // Foam ring hugging the seawall: a classic Crossy Road shoreline beat.
    const foam = new MeshBuilder();
    const fc = rgb("water_light");
    const m = 1.6;
    foam.flat(BOUNDS.x0 - m - 2, BOUNDS.z1, BOUNDS.x1 + m + 2, BOUNDS.z1 + m, -2.05, fc);
    foam.flat(BOUNDS.x0 - m - 2, BOUNDS.z0 - m, BOUNDS.x1 + m + 2, BOUNDS.z0, -2.05, fc);
    foam.flat(BOUNDS.x0 - m, BOUNDS.z0, BOUNDS.x0, BOUNDS.z1, -2.05, fc);
    foam.flat(BOUNDS.x1, BOUNDS.z0, BOUNDS.x1 + m, BOUNDS.z1, -2.05, fc);
    const foamMesh = new Mesh(foam.build(), new MeshBasicMaterial({ vertexColors: true }));
    this.shore.add(foamMesh);

    this.clouds = new Mesh(buildClouds(mulberry32(42)), new MeshBasicMaterial({ vertexColors: true, fog: false }));
    this.clouds.frustumCulled = false;
    this.group.add(this.clouds);
  }

  setColors(top: Color, horizon: Color) {
    const attr = this.dome.geometry.getAttribute("position");
    const colors = this.dome.geometry.getAttribute("color") as BufferAttribute;
    const c = new Color();
    for (let i = 0; i < attr.count; i++) {
      const t = Math.pow(Math.max(0, attr.getY(i) / 1400), 0.55);
      c.copy(horizon).lerp(top, t);
      colors.setXYZ(i, c.r, c.g, c.b);
    }
    colors.needsUpdate = true;
  }

  set shoreVisible(v: boolean) {
    this.shore.visible = v;
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
