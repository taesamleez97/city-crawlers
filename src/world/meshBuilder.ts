import { Box3, BufferAttribute, BufferGeometry, Matrix3, type Matrix4, Vector3 } from "three";

import type { RGB } from "./palette";

/** Window pattern ids understood by the world material's facade shader. */
export const enum Facade {
  None = 0,
  Wall = 1, // plain wall with ground-contact AO
  Grid = 2, // punched windows
  Ribbon = 3, // continuous horizontal window bands
  Curtain = 4, // glass curtain wall with mullions
  Piers = 5, // tall vertical window strips
}

export type FacadeSpec = {
  style: Facade;
  seed: number;
  groundH: number; // storefront band height (0 = none)
  window: RGB;
  baseY: number; // ground level the floors count from
  topY: number; // windows stop below this
};

export type BoxColors = RGB | { top?: RGB; bottom?: RGB; sides?: RGB; n?: RGB; s?: RGB; e?: RGB; w?: RGB };

const NO_WINDOW: RGB = [0, 0, 0];

/** Twice the signed area of a ring of x, z pairs: negative = counter-clockwise seen from above (north up). */
export function ringArea(poly: ArrayLike<number>) {
  let a = 0;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) a += poly[j] * poly[i + 1] - poly[i] * poly[j + 1];
  return a;
}

/**
 * Accumulates flat-shaded, vertex-colored geometry (non-indexed) with the facade
 * attributes the world shader reads. Output is merged into a handful of draw calls.
 */
export class MeshBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private facA: number[] = [];
  private facB: number[] = [];
  private win: number[] = [];

  get vertexCount() {
    return this.pos.length / 3;
  }

  private quad(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    n: [number, number, number],
    color: RGB,
    fac?: { spec: FacadeSpec; u0: number; u1: number; halfW: number },
  ) {
    const verts = [a, b, c, a, c, d];
    for (const v of verts) {
      this.pos.push(v[0], v[1], v[2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.col.push(color[0], color[1], color[2]);
    }
    if (fac) {
      const { spec, u0, u1, halfW } = fac;
      // a,d are at u0; b,c at u1 (see box()).
      const us = [u0, u1, u1, u0, u1, u0];
      for (let i = 0; i < 6; i++) {
        const v = verts[i];
        this.facA.push(us[i], v[1] - spec.baseY, halfW, spec.topY - spec.baseY);
        this.facB.push(spec.style, spec.seed, spec.groundH, 0);
        this.win.push(spec.window[0], spec.window[1], spec.window[2]);
      }
    } else {
      for (let i = 0; i < 6; i++) {
        this.facA.push(0, 0, 0, 0);
        this.facB.push(0, 0, 0, 0);
        this.win.push(NO_WINDOW[0], NO_WINDOW[1], NO_WINDOW[2]);
      }
    }
  }

  /**
   * Axis-aligned box. `facade` decorates the four side faces; `skip` omits faces
   * that can never be seen (e.g. bottoms resting on the ground).
   */
  box(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    colors: BoxColors,
    opts: { facade?: FacadeSpec; skipBottom?: boolean; skipTop?: boolean } = {},
  ) {
    const c = Array.isArray(colors) ? { top: colors, bottom: colors, sides: colors } : colors;
    const side = c.sides ?? c.top ?? ([1, 0, 1] as RGB);
    const top = c.top ?? side;
    const bottom = c.bottom ?? side;
    const f = opts.facade;
    const hx = (x1 - x0) / 2;
    const hz = (z1 - z0) / 2;
    // +Y top
    if (!opts.skipTop) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], top);
    if (!opts.skipBottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], bottom);
    // +Z (south) face, u runs west→east
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], c.s ?? side,
      f && { spec: f, u0: -hx, u1: hx, halfW: hx });
    // -Z (north) face, u runs east→west
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], c.n ?? side,
      f && { spec: f, u0: -hx, u1: hx, halfW: hx });
    // +X (east) face, u runs south→north
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], c.e ?? side,
      f && { spec: f, u0: -hz, u1: hz, halfW: hz });
    // -X (west) face, u runs north→south
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], c.w ?? side,
      f && { spec: f, u0: -hz, u1: hz, halfW: hz });
  }

  /** Horizontal rectangle (ground decals: lane marks, crossings, water stripes). */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, color: RGB) {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], color);
  }

  /** A horizontal strip of width `w` from (ax, az) to (bx, bz): roads, lane marks. */
  strip(ax: number, az: number, bx: number, bz: number, w: number, y: number, color: RGB) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-3) return;
    const px = (-(bz - az) / len) * (w / 2), pz = ((bx - ax) / len) * (w / 2);
    this.quad([ax + px, y, az + pz], [bx + px, y, bz + pz], [bx - px, y, bz - pz], [ax - px, y, az - pz], [0, 1, 0], color);
  }

  /** Horizontal polygon (x, z pairs) from precomputed triangles: parks, plazas, water, roofs (`down`: undersides). */
  polygon(poly: ArrayLike<number>, tris: ArrayLike<number>, y: number, color: RGB, down = false) {
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i], b = tris[i + 1], c = tris[i + 2];
      // Face up (or down) whatever order the triangulator chose.
      const cross = (poly[b * 2] - poly[a * 2]) * (poly[c * 2 + 1] - poly[a * 2 + 1]) - (poly[b * 2 + 1] - poly[a * 2 + 1]) * (poly[c * 2] - poly[a * 2]);
      for (const k of cross > 0 !== down ? [a, c, b] : [a, b, c]) {
        this.pos.push(poly[k * 2], y, poly[k * 2 + 1]);
        this.nrm.push(0, down ? -1 : 1, 0);
        this.col.push(color[0], color[1], color[2]);
        this.facA.push(0, 0, 0, 0);
        this.facB.push(0, 0, 0, 0);
        this.win.push(0, 0, 0);
      }
    }
  }

  /**
   * Vertical prism over a footprint (x, z pairs, counter-clockwise seen from above with
   * +x east and -z north: see `ringArea`), each wall with its own window layout.
   * `tris` caps the roof.
   */
  prism(poly: ArrayLike<number>, tris: ArrayLike<number> | null, y0: number, y1: number, wall: RGB, roof: RGB, facade?: FacadeSpec) {
    const n = poly.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = poly[i * 2], az = poly[i * 2 + 1], bx = poly[j * 2], bz = poly[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const nrm: [number, number, number] = [-(bz - az) / len, 0, (bx - ax) / len];
      const half = len / 2;
      this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], nrm, wall,
        facade && { spec: facade, u0: -half, u1: half, halfW: half });
    }
    if (tris) this.polygon(poly, tris, y1, roof);
  }

  /** A flat-shaded quad facing whichever way a→b→c turns counter-clockwise. */
  face(a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number], color: RGB) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    this.quad(a, b, c, d, [nx, ny, nz], color);
  }

  /**
   * A box turned to face (fx, fz) (unit, ground plane): `hr` half-width across it,
   * `hf` half-depth along it. Tapers to `hr1`/`hf1` at the top (hip roofs, spires).
   */
  obox(
    cx: number, cz: number, fx: number, fz: number, hr: number, hf: number, y0: number, y1: number,
    side: RGB, top: RGB = side, taper?: { hr1: number; hf1: number }, bottom?: RGB,
  ) {
    const rx = -fz, rz = fx;
    const ring = (r: number, f: number) => [
      [cx - rx * r - fx * f, cz - rz * r - fz * f],
      [cx + rx * r - fx * f, cz + rz * r - fz * f],
      [cx + rx * r + fx * f, cz + rz * r + fz * f],
      [cx - rx * r + fx * f, cz - rz * r + fz * f],
    ];
    let lo = ring(hr, hf), hi = taper ? ring(taper.hr1, taper.hf1) : lo;
    if (ringArea(lo.flat()) > 0) {
      lo = lo.reverse();
      hi = hi === lo ? lo : hi.reverse();
    }
    if (!taper) {
      this.prism(lo.flat(), [0, 1, 2, 0, 2, 3], y0, y1, side, top);
    } else {
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        this.face([lo[i][0], y0, lo[i][1]], [lo[j][0], y0, lo[j][1]], [hi[j][0], y1, hi[j][1]], [hi[i][0], y1, hi[i][1]], side);
      }
      if (taper.hr1 > 0.01 || taper.hf1 > 0.01) this.polygon(hi.flat(), [0, 1, 2, 0, 2, 3], y1, top);
    }
    if (bottom) this.polygon(lo.flat(), [0, 1, 2, 0, 2, 3], y0, bottom, true);
  }

  /** A flat n-gon (road joints, round pads). */
  disc(cx: number, cz: number, r: number, y: number, color: RGB, sides = 6) {
    const poly: number[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      poly.push(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
    }
    const tris: number[] = [];
    for (let i = 1; i + 1 < sides; i++) tris.push(0, i, i + 1);
    this.polygon(poly, tris, y, color);
  }

  /** Appends an existing (non-indexed or indexed) geometry with a flat color. */
  appendGeometry(geo: BufferGeometry, color: RGB, offset: Vector3) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i) + offset.x, p.getY(i) + offset.y, p.getZ(i) + offset.z);
      this.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(color[0], color[1], color[2]);
      this.facA.push(0, 0, 0, 0);
      this.facB.push(0, 0, 0, 0);
      this.win.push(0, 0, 0);
    }
  }

  /** Bakes a vertex-colored mesh (e.g. a prop) into this builder with a full transform. */
  appendMesh(geo: BufferGeometry, matrix: Matrix4) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    const c = g.getAttribute("color");
    const nm = new Matrix3().getNormalMatrix(matrix);
    const v = new Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.nrm.push(v.x, v.y, v.z);
      if (c) this.col.push(c.getX(i), c.getY(i), c.getZ(i));
      else this.col.push(1, 1, 1);
      this.facA.push(0, 0, 0, 0);
      this.facB.push(0, 0, 0, 0);
      this.win.push(0, 0, 0);
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute("aFacadeA", new BufferAttribute(new Float32Array(this.facA), 4));
    g.setAttribute("aFacadeB", new BufferAttribute(new Float32Array(this.facB), 4));
    g.setAttribute("aWin", new BufferAttribute(new Float32Array(this.win), 3));
    g.computeBoundingSphere();
    g.boundingBox = new Box3().setFromBufferAttribute(g.getAttribute("position") as BufferAttribute);
    return g;
  }
}
