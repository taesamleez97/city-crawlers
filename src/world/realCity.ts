// A real city from map data (public/cities/<id>.json, built by tools/osm from
// OpenStreetMap via Overture Maps) in the game's flat-color look: every building
// stands on its real footprint at its real height, the streets are the real
// network, and the route runs down real streets. CityStyle decides the colors,
// trees, signs and landmark dressing that make each place read as itself.

import { type BufferGeometry, Euler, Group, Matrix4, Mesh, MeshBasicMaterial, type Material, Quaternion, ShapeUtils, Vector2, Vector3 } from "three";

import { clamp } from "../core/math";
import type { CourseDef } from "../rhythm/route";
import type { TrafficLane } from "./city";
import type { CityStyle, LandmarkLook } from "./cities";
import { CollisionWorld } from "./collision";
import { Facade, type FacadeSpec, MeshBuilder, ringArea } from "./meshBuilder";
import { type RGB, mixRgb, rgb, shade } from "./palette";
import type { PropLibrary } from "./props";

export interface CityFile {
  id: string;
  attribution: string;
  license: string;
  route: { path: Array<[number, number]>; streets: string[]; perch: number[] };
  landmarks: Array<{ id: string; x: number; z: number; y: number; yaw?: number }>;
  /** [height (dm, -1 unknown), min height (dm), type, colour 0xRRGGBB (0 none), landmark id, ring (dm)] */
  buildings: Array<[number, number, number, number, string, number[]]>;
  /** [class 1 major … 5 pedestrian, width (dm), polyline (dm), side of the other carriageway of a divided road (0 none, +1 right of travel, -1 left)] */
  roads: Array<[number, number, number[], number?]>;
  /** [1 park, 2 water, 3 plaza, ring (dm)] */
  areas: Array<[number, number[]]>;
  /** [1 waterway, 2 rail, width (dm), polyline (dm)] */
  lines: Array<[number, number, number[]]>;
}

export interface RealCity {
  group: Group;
  world: CollisionWorld;
  lanes: TrafficLane[];
  course: CourseDef;
  /** Distance-culled meshes. */
  chunks: Mesh[];
  stats: { buildings: number; trees: number; signs: number; triangles: number; chunks: number; ms: number };
  dispose(): void;
}

/** Roof of the block the hero leaps from (meters). */
export const PERCH_Y = 34;
const CHUNK = 160;
/** Buildings this close to the route get colliders (web anchors, ring sight lines). */
const COLLIDE_DIST = 260;
/** Street detail (markings, crossings, trees, signs) only this close to the route. */
const DETAIL_DIST = 330;
const TRAFFIC_DIST = 400;
const MAX_TREES = 2400;
const MAX_SIGNS = 700;
const TRUNK: RGB = [0.19, 0.11, 0.07];

const linCache = new Map<string, RGB>();
/** sRGB hex → the linear working space vertex colors use. */
export function lin(hex: string | number): RGB {
  const key = String(hex);
  let c = linCache.get(key);
  if (!c) {
    const n = typeof hex === "number" ? hex : parseInt(hex.slice(1), 16);
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    c = [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
    linCache.set(key, c);
  }
  return c;
}

/** Stable 0…1 from two integers. */
function hash(a: number, b: number) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul((b | 0) + 0x9e3779b9, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const pickOf = <T>(arr: readonly T[], r: number): T => arr[Math.floor(r * arr.length) % arr.length];

function insidePoly(poly: ArrayLike<number>, x: number, z: number) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], zi = poly[i + 1], xj = poly[j], zj = poly[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function triangulate(poly: ArrayLike<number>): number[] {
  const pts: Vector2[] = [];
  for (let i = 0; i < poly.length; i += 2) pts.push(new Vector2(poly[i], poly[i + 1]));
  return ShapeUtils.triangulateShape(pts, []).flat();
}

const dmToM = (a: number[]) => {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] / 10;
  return out;
};

/** Smallest rectangle around a footprint: center, the long side's direction, half extents. */
function fitRect(poly: ArrayLike<number>) {
  let best = { area: Infinity, cx: 0, cz: 0, rx: 1, rz: 0, hr: 1, hf: 1 };
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ux = poly[j * 2] - poly[i * 2], uz = poly[j * 2 + 1] - poly[i * 2 + 1];
    const l = Math.hypot(ux, uz);
    if (l < 0.5) continue;
    ux /= l;
    uz /= l;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = poly[k * 2], z = poly[k * 2 + 1];
      const u = x * ux + z * uz, v = -x * uz + z * ux;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area >= best.area) continue;
    const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
    const cx = um * ux - vm * uz, cz = um * uz + vm * ux;
    const longU = u1 - u0 >= v1 - v0;
    best = longU
      ? { area, cx, cz, rx: ux, rz: uz, hr: (u1 - u0) / 2, hf: (v1 - v0) / 2 }
      : { area, cx, cz, rx: -uz, rz: ux, hr: (v1 - v0) / 2, hf: (u1 - u0) / 2 };
  }
  // obox's frame: right = (-fz, fx), so forward is the long side turned back a quarter.
  return { cx: best.cx, cz: best.cz, fx: best.rz, fz: -best.rx, hr: best.hr, hf: best.hf };
}

/** Guess a height for a building the map has none for, from its size and use. */
function guessHeight(style: CityStyle, area: number, type: number, r: number) {
  const k = area < 70 ? 0.42 : area < 160 ? 0.62 : area < 450 ? 0.9 : area < 1500 ? 1.2 : 1.5;
  const t = type === 2 ? 0.85 : type === 5 ? 0.55 : type === 4 ? 0.8 : 1;
  return Math.max(4, style.defaultHeight * k * t * (0.75 + r * 0.5));
}

// ------------------------------------------------------------------ trees
function treeGeometries(style: CityStyle, lib: PropLibrary): BufferGeometry[] {
  const kind = style.trees.kind;
  if (kind === "round") {
    const lib3 = ["tree_a", "tree_b", "tree_c"].map((n) => lib.geometries.get(n)).filter((g): g is BufferGeometry => !!g);
    if (lib3.length) return lib3.map((g) => (g.index ? g.toNonIndexed() : g));
  }
  return style.trees.leaf.map((hex) => {
    const b = new MeshBuilder();
    const leaf = lin(hex), dark = shade(leaf, 0.8);
    if (kind === "palm") {
      const bark: RGB = [0.36, 0.25, 0.15];
      b.obox(0, 0, 0, -1, 0.24, 0.24, 0, 8.6, bark, bark, { hr1: 0.15, hf1: 0.15 });
      b.obox(0, 0, 0, -1, 0.38, 0.38, 8.4, 9.0, dark);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + 0.3;
        const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
        const P = (r: number, y: number, w: number, s: number): [number, number, number] => [dx * r + px * w * s, y, dz * r + pz * w * s];
        const segs: Array<[number, number, number]> = [[0, 8.9, 0.12], [1.7, 9.5, 0.6], [3.5, 7.9, 0.06]];
        for (let i = 0; i < 2; i++) {
          const [r0, y0, w0] = segs[i], [r1, y1, w1] = segs[i + 1];
          const q: Array<[number, number, number]> = [P(r0, y0, w0, -1), P(r1, y1, w1, -1), P(r1, y1, w1, 1), P(r0, y0, w0, 1)];
          b.face(q[0], q[1], q[2], q[3], i ? dark : leaf);
          b.face(q[3], q[2], q[1], q[0], i ? dark : leaf);
        }
      }
    } else if (kind === "ginkgo") {
      b.obox(0, 0, 0, -1, 0.17, 0.17, 0, 2.1, TRUNK);
      b.obox(0, 0, 0, -1, 1.3, 1.3, 1.9, 4.5, leaf, leaf, { hr1: 1.05, hf1: 1.05 }, dark);
      b.obox(0, 0, 0, -1, 1.05, 1.05, 4.5, 6.8, leaf, leaf, { hr1: 0.25, hf1: 0.25 });
    } else {
      b.obox(0, 0, 0, -1, 0.18, 0.18, 0, 2.0, TRUNK);
      b.obox(0, 0, 0, -1, 1.5, 1.5, 1.8, 4.6, leaf, leaf, undefined, dark);
      b.obox(0, 0, 0, -1, 1.0, 1.0, 4.6, 5.6, leaf);
    }
    return b.build();
  });
}

// ------------------------------------------------------------------ landmark models
const STONE = lin("#D8D0BE"), STONE_DARK = lin("#B9B09D"), TILE = lin("#4A4F59"), RED = lin("#A63A2E"), DANCHEONG = lin("#2F8774");
const BRONZE = lin("#3F5B50"), GOLD = lin("#D9A93A"), DARK = lin("#24262C");

/** Gwanghwamun: a stone base with three arches under a two-tier pavilion and its swept roofs. */
function buildGate(b: MeshBuilder, poly: ArrayLike<number>) {
  const { cx, cz, fx, fz, hr, hf } = fitRect(poly);
  b.obox(cx, cz, fx, fz, hr, hf, 0, 7.2, STONE, STONE_DARK);
  const rx = -fz, rz = fx;
  for (const [o, w, h] of [[0, 2.4, 5.4], [-hr * 0.42, 1.9, 4.6], [hr * 0.42, 1.9, 4.6]]) {
    b.obox(cx + rx * o, cz + rz * o, fx, fz, w, hf + 0.06, 0, h, DARK);
  }
  b.obox(cx, cz, fx, fz, hr * 0.72, hf * 0.62, 7.2, 10.6, RED);
  b.obox(cx, cz, fx, fz, hr * 0.94, hf * 0.98, 10.6, 12.9, TILE, TILE, { hr1: hr * 0.6, hf1: hf * 0.32 }, DANCHEONG);
  b.obox(cx, cz, fx, fz, hr * 0.56, hf * 0.42, 12.9, 15.0, RED);
  b.obox(cx, cz, fx, fz, hr * 0.78, hf * 0.72, 15.0, 19.0, TILE, TILE, { hr1: hr * 0.5, hf1: 0.35 }, DANCHEONG);
  b.obox(cx, cz, fx, fz, hr * 0.52, 0.4, 18.9, 19.6, TILE);
  return { top: 19.6 };
}

/** Admiral Yi on his tall pedestal, sword planted in front. */
function buildStatue(b: MeshBuilder, x: number, z: number, yaw: number) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
  b.obox(x, z, fx, fz, 2.8, 2.8, 0, 1.4, STONE_DARK);
  b.obox(x, z, fx, fz, 1.9, 1.9, 1.4, 10.0, STONE);
  b.obox(x, z, fx, fz, 2.2, 2.2, 10.0, 10.6, STONE_DARK);
  b.obox(x, z, fx, fz, 0.95, 0.65, 10.6, 13.6, BRONZE, BRONZE, { hr1: 0.75, hf1: 0.55 });
  b.obox(x, z, fx, fz, 0.85, 0.55, 13.6, 15.5, BRONZE);
  b.obox(x, z, fx, fz, 1.25, 0.45, 14.6, 15.3, BRONZE);
  b.obox(x, z, fx, fz, 0.36, 0.36, 15.5, 16.3, BRONZE);
  b.obox(x, z, fx, fz, 0.52, 0.52, 16.3, 16.6, BRONZE);
  b.obox(x + fx * 0.75 + rx * 0.2, z + fz * 0.75 + rz * 0.2, fx, fz, 0.07, 0.07, 10.6, 14.7, BRONZE);
  return { top: 16.6, r: 2.8 };
}

/** King Sejong, seated and golden, on a broad pedestal. */
function buildSeated(b: MeshBuilder, x: number, z: number, yaw: number) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  b.obox(x, z, fx, fz, 5.0, 3.6, 0, 4.2, STONE, STONE_DARK);
  b.obox(x - fx * 0.7, z - fz * 0.7, fx, fz, 2.3, 1.2, 4.2, 7.0, GOLD);
  b.obox(x + fx * 0.4, z + fz * 0.4, fx, fz, 1.9, 1.3, 4.2, 6.6, GOLD);
  b.obox(x, z, fx, fz, 1.5, 0.9, 6.6, 9.0, GOLD, GOLD, { hr1: 1.2, hf1: 0.8 });
  b.obox(x, z, fx, fz, 0.48, 0.48, 9.0, 9.9, GOLD);
  b.obox(x, z, fx, fz, 0.55, 0.55, 9.9, 10.3, shade(GOLD, 0.8));
  return { top: 10.3, r: 5 };
}

// ------------------------------------------------------------------ build
export function buildRealCity(data: CityFile, style: CityStyle, material: Material, lib: PropLibrary): RealCity {
  const t0 = performance.now();
  const world = new CollisionWorld();
  const group = new Group();
  group.name = `city_${data.id}`;
  const path = data.route.path.map(([x, z]) => [x / 10, z / 10] as [number, number]);
  const perch = dmToM(data.route.perch);

  const routeDist = (x: number, z: number) => {
    let best = Infinity;
    for (let i = 0; i + 1 < path.length; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    return best;
  };
  /** Nearest point on the route (for which way a wall faces the street). */
  const routePoint = (x: number, z: number): [number, number] => {
    let best = Infinity, px = x, pz = z;
    for (let i = 0; i + 1 < path.length; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(x - qx, z - qz);
      if (d < best) [best, px, pz] = [d, qx, qz];
    }
    return [px, pz];
  };

  const chunks = new Map<string, MeshBuilder>();
  const flats = new Map<string, MeshBuilder>();
  const chunkKey = (x: number, z: number) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
  const chunkFor = (x: number, z: number, set = chunks) => {
    const k = chunkKey(x, z);
    let b = set.get(k);
    if (!b) set.set(k, (b = new MeshBuilder()));
    return b;
  };
  const signs = new MeshBuilder();

  // Footprints on the ground, by 25 m cell, so trees stay out of buildings.
  const grid = new Map<string, Float32Array[]>();
  const cellKey = (x: number, z: number) => `${Math.floor(x / 25)},${Math.floor(z / 25)}`;
  const inBuilding = (x: number, z: number, pad = 1.2) => {
    for (const [ox, oz] of [[0, 0], [pad, 0], [-pad, 0], [0, pad], [0, -pad]]) {
      for (const p of grid.get(cellKey(x + ox, z + oz)) ?? []) if (insidePoly(p, x + ox, z + oz)) return true;
    }
    return false;
  };
  const inPerch = (x: number, z: number, pad = 0) => {
    if (insidePoly(perch, x, z)) return true;
    if (!pad) return false;
    return insidePoly(perch, x + pad, z) || insidePoly(perch, x - pad, z) || insidePoly(perch, x, z + pad) || insidePoly(perch, x, z - pad);
  };

  // ---------------------------------------------------------------- buildings
  type Built = { poly: Float32Array; h: number; min: number; cx: number; cz: number; dist: number; type: number };
  const built: Built[] = [];
  const tallest = new Map<string, Built>();
  const models = new Map<string, number[]>();
  const props: Array<{ type: string; x: number; y: number; z: number; rotY: number; scale: number }> = [];
  const glassFrame = lin(style.trim);

  for (const [hDm, minDm, type, colour, lm, ring] of data.buildings) {
    const look: LandmarkLook | undefined = lm ? style.landmarks?.[lm] : undefined;
    if (look?.model) {
      const pts = models.get(lm) ?? [];
      for (const v of ring) pts.push(v / 10);
      models.set(lm, pts);
      continue;
    }
    const poly = dmToM(ring);
    if (poly.length < 6) continue;
    const area = Math.abs(ringArea(poly)) / 2;
    let cx = 0, cz = 0;
    for (let i = 0; i < poly.length; i += 2) {
      cx += poly[i];
      cz += poly[i + 1];
    }
    cx /= poly.length / 2;
    cz /= poly.length / 2;
    const r1 = hash(Math.round(cx * 10), Math.round(cz * 10));
    const r2 = hash(Math.round(cz * 7), Math.round(cx * 13) + 5);
    const r3 = hash(Math.round(cx * 3) + 11, Math.round(cz * 5));
    const min = minDm / 10;
    const h = hDm >= 0 ? hDm / 10 : guessHeight(style, area, type, r1);
    if (h - min < 0.8) continue;
    const dist = routeDist(cx, cz);

    const band = h < 14 ? style.facades.low : h < 45 ? style.facades.mid : style.facades.tall;
    let fac = look?.facade ?? pickOf(band, r2);
    if (!look && type === 5) fac = Facade.Wall;
    if (!look && type === 2 && fac === Facade.Curtain) fac = Facade.Grid;
    const curtain = fac === Facade.Curtain;
    let wall: RGB;
    if (look?.wall) wall = lin(look.wall);
    else if (curtain) wall = mixRgb(glassFrame, lin(pickOf(style.walls, r3)), 0.35);
    else if (colour) wall = mixRgb(lin(colour), lin(pickOf(style.walls, r3)), 0.3);
    else wall = lin(pickOf(style.walls, r3));
    const win = look?.window ? lin(look.window) : curtain ? lin(pickOf(style.glass, r1)) : lin(style.window);
    const roof = look?.roof ? lin(look.roof) : shade(lin(pickOf(style.roof, r2)), curtain ? 0.85 : 1);
    const ground = min < 1 && h > 9 && (type === 0 || type === 1 || type === 3);
    const spec: FacadeSpec = { style: fac, seed: Math.floor(r1 * 997), groundH: ground ? 4.4 : 0, window: win, baseY: 0, topY: h - 0.7 };

    const tris = triangulate(poly);
    const b = chunkFor(cx, cz);
    b.prism(poly, tris, min, h, wall, roof, spec);
    if (min > 0.5) b.polygon(poly, tris, min, shade(wall, 0.6), true);
    const rec: Built = { poly, h, min, cx, cz, dist, type };
    built.push(rec);
    if (lm && (!tallest.has(lm) || tallest.get(lm)!.h < h)) tallest.set(lm, rec);
    if (min < 1) {
      const k = cellKey(cx, cz);
      // A footprint can span cells: file it under every cell its corners touch.
      const keys = new Set([k]);
      for (let i = 0; i < poly.length; i += 2) keys.add(cellKey(poly[i], poly[i + 1]));
      for (const key of keys) {
        const list = grid.get(key);
        if (list) list.push(poly);
        else grid.set(key, [poly]);
      }
    }
    if (dist < COLLIDE_DIST) world.addPrism(poly, min, h, "building", true);

    // Rooftop machinery on bigger roofs breaks up the skyline; New York gets its water tanks.
    if (!lm && h > 22 && area > 260 && r3 < 0.55 && dist < DETAIL_DIST * 1.5) {
      const { fx, fz } = fitRect(poly);
      const s = Math.min(12, Math.max(3.5, Math.sqrt(area) * 0.26));
      const ok = [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([a, c]) => insidePoly(poly, cx + (-fz * a + fx * c) * s, cz + (fx * a + fz * c) * s));
      if (ok) b.obox(cx, cz, fx, fz, s, s * 0.8, h, h + 2.6 + r2 * 2.5, shade(wall, 0.82), shade(roof, 0.9));
    }
    if (style.waterTowers && !lm && h > 16 && h < 110 && area > 140 && r2 < 0.28 && dist < DETAIL_DIST) {
      const ox = cx + (r1 - 0.5) * 4, oz = cz + (r3 - 0.5) * 4;
      if (insidePoly(poly, ox, oz)) props.push({ type: "water_tower", x: ox, y: h, z: oz, rotY: r1 * 6, scale: 0.85 + r2 * 0.3 });
    }
  }

  // ---------------------------------------------------------------- landmarks
  for (const lm of data.landmarks) {
    const look = style.landmarks?.[lm.id];
    if (!look) continue;
    const x = lm.x / 10, z = lm.z / 10;
    if (look.model === "gate" && models.has(lm.id)) {
      const pts = models.get(lm.id)!;
      const { top } = buildGate(chunkFor(x, z), pts);
      world.addPrism(new Float32Array(pts), 0, top, "building", true);
    } else if (look.model === "statue" || look.model === "seated") {
      const m = look.model === "statue" ? buildStatue(chunkFor(x, z), x, z, lm.yaw ?? 0) : buildSeated(chunkFor(x, z), x, z, lm.yaw ?? 0);
      const r = m.r;
      world.addPrism(new Float32Array([x - r, z - r, x - r, z + r, x + r, z + r, x + r, z - r]), 0, m.top, "obstacle", false);
    }
    const top = tallest.get(lm.id);
    if (top && look.spire) {
      const b = chunkFor(top.cx, top.cz);
      const { cx, cz, fx, fz, hr, hf } = fitRect(top.poly);
      const steel = lin("#DCE0E4");
      let y = top.h;
      let w = Math.min(hr, hf) * 0.9;
      if (look.crown) {
        for (let k = 0; k < 4; k++) {
          const w1 = w * 0.74;
          b.obox(cx, cz, fx, fz, w, w, y, y + 5.5, steel, steel, { hr1: w1, hf1: w1 });
          y += 5.5;
          w = w1;
        }
      }
      b.obox(cx, cz, fx, fz, Math.min(w, 1.6), Math.min(w, 1.6), y, y + look.spire, steel, steel, { hr1: 0.08, hf1: 0.08 });
    }
  }

  // ---------------------------------------------------------------- the perch
  {
    const [sx, sz] = path[0], [nx, nz] = path[1];
    const len = Math.hypot(nx - sx, nz - sz);
    const fx = (nx - sx) / len, fz = (nz - sz) / len, rx = -fz, rz = fx;
    let hr = 0, back = 0;
    for (let i = 0; i < perch.length; i += 2) {
      const dx = perch[i] - sx, dz = perch[i + 1] - sz;
      hr = Math.max(hr, Math.abs(dx * rx + dz * rz));
      back = Math.max(back, -(dx * fx + dz * fz));
    }
    const d = back + 1.9, hf = d / 2;
    const ccx = sx + fx * (1.9 - hf), ccz = sz + fz * (1.9 - hf);
    const b = chunkFor(sx, sz);
    const brick = style.waterTowers ? lin("#B46450") : lin(style.walls[3] ?? style.walls[0]);
    b.prism(perch, triangulate(perch), 0, PERCH_Y, brick, lin(style.roof[0]),
      { style: Facade.Grid, seed: 5, groundH: 4.6, window: lin(style.window), baseY: 0, topY: PERCH_Y - 1 });
    world.addPrism(perch, 0, PERCH_Y, "building", true);
    b.obox(ccx, ccz, fx, fz, hr + 0.5, hf + 0.5, PERCH_Y - 1, PERCH_Y - 0.2, lin(style.trim));
    const lipX = sx + fx * 1.55, lipZ = sz + fz * 1.55;
    b.obox(lipX, lipZ, fx, fz, hr, 0.35, PERCH_Y, PERCH_Y + 0.55, lin("#E7DCC3"), lin("#F4F1EA"));
    b.obox(lipX, lipZ, fx, fz, 4, 0.35, PERCH_Y + 0.55, PERCH_Y + 0.65, rgb("hazard"));
    const tile = shade(lin(style.roof[0]), 0.8);
    for (let o = -hr + 4; o < hr; o += 4) {
      b.strip(ccx + rx * o + fx * (hf - 0.8), ccz + rz * o + fz * (hf - 0.8), ccx + rx * o - fx * hf, ccz + rz * o - fz * hf, 0.24, PERCH_Y + 0.01, tile);
    }
    for (let o = 1.2; o < d; o += 4) {
      const px = sx + fx * (1.2 - o), pz = sz + fz * (1.2 - o);
      b.strip(px - rx * hr, pz - rz * hr, px + rx * hr, pz + rz * hr, 0.24, PERCH_Y + 0.012, tile);
    }
    const at = (r: number, f: number) => [sx + rx * r - fx * f, sz + rz * r - fz * f];
    const rot = Math.atan2(-fx, -fz);
    const [tx, tz] = at(-hr * 0.55, d * 0.62);
    props.push({ type: style.waterTowers ? "water_tower" : "antenna", x: tx, y: PERCH_Y, z: tz, rotY: rot + 0.3, scale: 1.1 });
    const [ax, az] = at(hr * 0.45, d * 0.5);
    props.push({ type: "ac_unit", x: ax, y: PERCH_Y, z: az, rotY: rot, scale: 1 });
    const [bx, bz] = at(hr * 0.6, d * 0.75);
    props.push({ type: "ac_unit", x: bx, y: PERCH_Y, z: bz, rotY: rot + Math.PI / 2, scale: 1 });
  }

  // ---------------------------------------------------------------- ground, areas, water, rail
  const groundB = new MeshBuilder();
  {
    const mx = (path[0][0] + path[path.length - 1][0]) / 2, mz = (path[0][1] + path[path.length - 1][1]) / 2;
    groundB.flat(mx - 1400, mz - 1400, mx + 1400, mz + 1400, 0, lin(style.ground));
  }
  for (const [kind, ring] of data.areas) {
    const poly = dmToM(ring);
    const color = kind === 1 ? lin(style.park) : kind === 2 ? lin(style.water) : lin(style.plaza);
    // Layers sit centimeters apart: seen at a grazing angle from swing height, closer would flicker.
    const y = kind === 1 ? 0.1 : kind === 2 ? 0.04 : 0.07;
    groundB.polygon(poly, triangulate(poly), y, color);
  }
  for (const [kind, wDm, pts] of data.lines) {
    const p = dmToM(pts), w = wDm / 10;
    const color = kind === 1 ? lin(style.water) : lin(style.rail);
    const y = kind === 1 ? 0.05 : 0.12;
    for (let i = 0; i + 3 < p.length; i += 2) chunkFor(p[i], p[i + 1], flats).strip(p[i], p[i + 1], p[i + 2], p[i + 3], w, y, color);
  }

  // ---------------------------------------------------------------- streets
  const road = lin(style.road), plaza = lin(style.plaza), white = lin("#F4F2EA"), center = lin(style.center);
  const lanes: TrafficLane[] = [];
  let carBudget = 260;
  type TreeSpot = { x: number; z: number; d: number };
  const treeSpots: TreeSpot[] = [];
  // Carriageways by cell too, so curb trees and the markings of a side street
  // stay off the bigger road it runs into.
  const roadGrid = new Map<string, number[][]>();
  for (const [cls, wDm, pts] of data.roads) {
    if (cls === 5) continue;
    const p = dmToM(pts), hw = wDm / 20;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const l = Math.hypot(bx - ax, bz - az) || 1;
      const seg = [ax, az, bx, bz, hw, (bx - ax) / l, (bz - az) / l];
      for (let cx = Math.floor((Math.min(ax, bx) - hw) / 25); cx <= Math.floor((Math.max(ax, bx) + hw) / 25); cx++) {
        for (let cz = Math.floor((Math.min(az, bz) - hw) / 25); cz <= Math.floor((Math.max(az, bz) + hw) / 25); cz++) {
          const k = `${cx},${cz}`;
          const list = roadGrid.get(k);
          if (list) list.push(seg);
          else roadGrid.set(k, [seg]);
        }
      }
    }
  }
  /**
   * On a road (any by default). With `across` (a unit direction), only roads that
   * cross it, so a street's own continuation and its twin carriageway don't count.
   */
  const onRoad = (x: number, z: number, than = -1, across?: [number, number]) => {
    for (const [ax, az, bx, bz, hw, ux, uz] of roadGrid.get(cellKey(x, z)) ?? []) {
      if (hw <= than + 1 || (across && Math.abs(ux * across[0] + uz * across[1]) > 0.7)) continue;
      const dx = bx - ax, dz = bz - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < hw + 0.6) return true;
    }
    return false;
  };
  for (const [cls, wDm, pts, twin = 0] of data.roads) {
    const p = dmToM(pts), w = wDm / 10;
    const n = p.length / 2;
    if (n < 2) continue;
    const y = 0.13 + (5 - cls) * 0.03;
    const color = cls === 5 ? plaza : road;
    let len = 0;
    for (let i = 0; i + 1 < n; i++) {
      const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
      chunkFor((ax + bx) / 2, (az + bz) / 2, flats).strip(ax, az, bx, bz, w, y, color);
      len += Math.hypot(bx - ax, bz - az);
    }
    for (let i = 0; i < n; i++) {
      if (i > 0 && i < n - 1) {
        // Only bends need a joint.
        const ux = p[i * 2] - p[i * 2 - 2], uz = p[i * 2 + 1] - p[i * 2 - 1], vx = p[i * 2 + 2] - p[i * 2], vz = p[i * 2 + 3] - p[i * 2 + 1];
        if ((ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz) + 1e-6) > 0.985) continue;
      }
      chunkFor(p[i * 2], p[i * 2 + 1], flats).disc(p[i * 2], p[i * 2 + 1], w / 2, y, color, w > 8 ? 8 : 6);
    }
    const mid = Math.floor(n / 2);
    const near = routeDist(p[mid * 2], p[mid * 2 + 1]);

    // Markings and crossings on the bigger streets near the route.
    if (cls <= 2 && near < DETAIL_DIST && len > 20) {
      const trim = Math.min(8, len / 4);
      let s = 0;
      for (let i = 0; i + 1 < n; i++) {
        const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
        const sl = Math.hypot(bx - ax, bz - az);
        const ux = (bx - ax) / sl, uz = (bz - az) / sl;
        const s0 = Math.max(s, trim), s1 = Math.min(s + sl, len - trim);
        if (s1 > s0) {
          const P = (t: number, off: number): [number, number] => [ax + ux * (t - s) - uz * off, az + uz * (t - s) + ux * off];
          const bld = chunkFor((ax + bx) / 2, (az + bz) / 2, flats);
          // Solid double lines go down in short pieces too, so they can stop at a wider road.
          const solid = !twin && style.doubleCenter;
          const step = solid ? 4 : 9, dash = solid ? 4 : 3.5;
          for (let t = s0; t < s1; t += step) {
            const t1 = Math.min(t + dash, s1);
            const [mx, mz] = P((t + t1) / 2, 0);
            if (onRoad(mx, mz, w / 4, [ux, uz])) continue;
            for (const off of solid ? [-0.24, 0.24] : [0]) {
              const [x0, z0] = P(t, off), [x1, z1] = P(t1, off);
              bld.strip(x0, z0, x1, z1, solid ? 0.16 : 0.18, y + 0.03, twin ? white : center);
            }
          }
        }
        s += sl;
      }
      // Zebra crossings just inside each end (Overture splits streets at junctions).
      for (const end of [0, 1]) {
        const i0 = end ? n - 1 : 0, i1 = end ? n - 2 : 1;
        const ex = p[i0 * 2], ez = p[i0 * 2 + 1];
        let ux = p[i1 * 2] - ex, uz = p[i1 * 2 + 1] - ez;
        const l = Math.hypot(ux, uz);
        if (l < 9) continue;
        ux /= l;
        uz /= l;
        // Back out of the street this one meets, onto its curb line.
        let at = 2.2;
        while (at < l - 4 && onRoad(ex + ux * (at + 1.5), ez + uz * (at + 1.5), w / 4, [ux, uz])) at += 1;
        if (at >= l - 4) continue;
        const bld = chunkFor(ex, ez, flats);
        const stripes = Math.floor((w - 1) / 1.4);
        for (let k = 0; k < stripes; k++) {
          const off = -((stripes - 1) * 1.4) / 2 + k * 1.4;
          const cx0 = ex + ux * at - uz * off, cz0 = ez + uz * at + ux * off;
          bld.strip(cx0, cz0, cx0 + ux * 3, cz0 + uz * 3, 0.6, y + 0.03, white);
        }
      }
    }

    // Street trees along both curbs.
    if (cls <= 3 && near < DETAIL_DIST && len > 16) {
      const step = style.trees.spacing;
      let s = 0;
      for (let i = 0; i + 1 < n; i++) {
        const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
        const sl = Math.hypot(bx - ax, bz - az);
        const ux = (bx - ax) / sl, uz = (bz - az) / sl;
        for (let t = Math.ceil((s + 7) / step) * step; t < Math.min(s + sl, len - 7); t += step) {
          for (const side of [-1, 1]) {
            if (side === twin) continue;
            const off = side * (w / 2 + 1.8);
            const x = ax + ux * (t - s) - uz * off, z = az + uz * (t - s) + ux * off;
            treeSpots.push({ x, z, d: routeDist(x, z) });
          }
        }
        s += sl;
      }
    }

    // Traffic on the major streets.
    if (cls <= 2 && near < TRAFFIC_DIST && carBudget > 0) {
      for (let i = 0; i + 1 < n && carBudget > 0; i++) {
        const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
        const sl = Math.hypot(bx - ax, bz - az);
        if (sl < 30) continue;
        const ux = (bx - ax) / sl, uz = (bz - az) / sl;
        let blocked = false;
        for (let t = 0; t <= sl && !blocked; t += 5) blocked = inPerch(ax + ux * t, az + uz * t, w / 2 + 2);
        if (blocked) continue;
        const off = (w / 4) * (style.driveLeft ? -1 : 1);
        const count = Math.max(1, Math.floor(sl / 55));
        // Right of travel is (-uz, ux).
        if (twin) {
          // One-way: oncoming traffic is on the other carriageway, on the driver's left (right where they drive on the left).
          const fwd = twin === (style.driveLeft ? 1 : -1);
          const [sx, sz, ex, ez] = fwd ? [ax, az, bx, bz] : [bx, bz, ax, az];
          lanes.push({ ax: sx - uz * off, az: sz + ux * off, bx: ex - uz * off, bz: ez + ux * off, count });
          lanes.push({ ax: sx + uz * off, az: sz - ux * off, bx: ex + uz * off, bz: ez - ux * off, count });
        } else {
          lanes.push({ ax: ax - uz * off, az: az + ux * off, bx: bx - uz * off, bz: bz + ux * off, count });
          lanes.push({ ax: bx + uz * off, az: bz - ux * off, bx: ax + uz * off, bz: az - ux * off, count });
        }
        carBudget -= count * 2;
      }
    }
  }

  // Park trees on a loose grid.
  for (const [kind, ring] of data.areas) {
    if (kind !== 1) continue;
    const poly = dmToM(ring);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < poly.length; i += 2) {
      x0 = Math.min(x0, poly[i]);
      x1 = Math.max(x1, poly[i]);
      z0 = Math.min(z0, poly[i + 1]);
      z1 = Math.max(z1, poly[i + 1]);
    }
    if (routeDist((x0 + x1) / 2, (z0 + z1) / 2) > DETAIL_DIST + (x1 - x0)) continue;
    for (let x = x0 + 5; x < x1; x += 11) {
      for (let z = z0 + 5; z < z1; z += 11) {
        const jx = x + (hash(x * 3, z * 7) - 0.5) * 6, jz = z + (hash(z * 5, x * 11) - 0.5) * 6;
        if (hash(Math.round(jx), Math.round(jz)) < 0.4 || !insidePoly(poly, jx, jz)) continue;
        treeSpots.push({ x: jx, z: jz, d: routeDist(jx, jz) });
      }
    }
  }

  // ---------------------------------------------------------------- trees
  const treeGeos = treeGeometries(style, lib);
  treeSpots.sort((a, b) => a.d - b.d);
  const m = new Matrix4(), q = new Quaternion(), e = new Euler(), pos = new Vector3(), scl = new Vector3();
  let trees = 0;
  for (const t of treeSpots) {
    if (trees >= MAX_TREES) break;
    if (t.d < 4 || inPerch(t.x, t.z, 3) || inBuilding(t.x, t.z) || onRoad(t.x, t.z)) continue;
    const r = hash(Math.round(t.x * 10), Math.round(t.z * 10));
    m.compose(pos.set(t.x, 0, t.z), q.setFromEuler(e.set(0, r * Math.PI * 2, 0)), scl.setScalar(0.85 + r * 0.35));
    chunkFor(t.x, t.z).appendMesh(treeGeos[Math.floor(r * 7919) % treeGeos.length], m);
    trees++;
  }

  // ---------------------------------------------------------------- signs
  let signCount = 0;
  if (style.signs) {
    const colors = style.signs.colors.map((c) => lin(c));
    const glow = (c: RGB): RGB => [Math.min(1, c[0] * 1.1 + 0.05), Math.min(1, c[1] * 1.1 + 0.05), Math.min(1, c[2] * 1.1 + 0.05)];
    for (const bd of built) {
      if (signCount >= MAX_SIGNS) break;
      if (bd.min > 0.5 || bd.h < 9 || bd.h > 80 || bd.dist > 75 || bd.type === 5) continue;
      const poly = bd.poly, n = poly.length / 2;
      for (let i = 0; i < n && signCount < MAX_SIGNS; i++) {
        const j = (i + 1) % n;
        const ax = poly[i * 2], az = poly[i * 2 + 1], bx = poly[j * 2], bz = poly[j * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 5) continue;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const nx = -(bz - az) / len, nz = (bx - ax) / len;
        const [qx, qz] = routePoint(mx, mz);
        const dq = Math.hypot(qx - mx, qz - mz);
        if (dq > 55 || dq < 1 || (nx * (qx - mx) + nz * (qz - mz)) / dq < 0.5) continue;
        const r = hash(Math.round(mx * 10), Math.round(mz * 10));
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        if (style.signs.kind === "vertical") {
          for (const t of [0.18, 0.82]) {
            if (hash(Math.round(mx * 7 + t * 100), Math.round(mz * 3)) > 0.55) continue;
            const px = ax + ux * len * t + nx * 0.9, pz = az + uz * len * t + nz * 0.9;
            const top = Math.min(4 + Math.min(14, bd.h * 0.6), bd.h - 0.5);
            const c = glow(pickOf(colors, hash(Math.round(px), Math.round(pz))));
            // Blade signs stand out from the wall: thin along it, deep away from it.
            signs.obox(px, pz, ux, uz, 0.75, 0.2, 3.6, top, c, c);
            signs.obox(px + nx * 0.02, pz + nz * 0.02, ux, uz, 0.55, 0.23, top - 1.6, top - 0.4, [1, 1, 1]);
            signCount++;
          }
        } else if (r < 0.75) {
          const floors = Math.min(4, Math.floor(bd.h / 3.4) - 1);
          const bw = Math.min(len * 0.78, 10);
          for (let k = 1; k <= floors; k++) {
            const c = glow(pickOf(colors, hash(Math.round(mx * 10) + k * 31, Math.round(mz * 10))));
            const y = 3.4 * k + 0.9;
            signs.obox(mx + nx * 0.22, mz + nz * 0.22, nx, nz, bw / 2, 0.2, y, y + 1.0, c, c);
            signCount++;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- props (baked)
  {
    const cache = new Map<string, BufferGeometry | null>();
    for (const p of props) {
      if (!cache.has(p.type)) {
        const g = lib.geometries.get(p.type);
        cache.set(p.type, g ? (g.index ? g.toNonIndexed() : g) : null);
      }
      const g = cache.get(p.type);
      if (!g) continue;
      m.compose(pos.set(p.x, p.y, p.z), q.setFromEuler(e.set(0, p.rotY, 0)), scl.setScalar(p.scale));
      chunkFor(p.x, p.z).appendMesh(g, m);
    }
  }

  // ---------------------------------------------------------------- meshes
  const meshes: Mesh[] = [];
  let triangles = 0;
  const add = (b: MeshBuilder, name: string, mat: Material, shadows: boolean, cull: boolean) => {
    if (!b.vertexCount) return;
    const mesh = new Mesh(b.build(), mat);
    mesh.name = name;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    if (cull) {
      mesh.geometry.computeBoundingSphere();
      meshes.push(mesh);
    }
    triangles += b.vertexCount / 3;
  };
  add(groundB, "ground", material, false, false);
  for (const [k, b] of flats) add(b, `chunk_flat_${k}`, material, false, true);
  for (const [k, b] of chunks) add(b, `chunk_${k}`, material, true, true);
  const signMat = new MeshBasicMaterial({ vertexColors: true });
  add(signs, "signs", signMat, false, false);

  const course: CourseDef = {
    path,
    streets: data.route.streets,
    perchY: PERCH_Y,
    finishY: (style.swingY ?? 30) - 5,
    cornerRadius: 28,
    topY: style.swingY,
  };
  return {
    group, world, lanes, course, chunks: meshes,
    stats: { buildings: built.length, trees, signs: signCount, triangles: Math.round(triangles), chunks: chunks.size, ms: Math.round(performance.now() - t0) },
    dispose() {
      group.traverse((o) => (o as Mesh).geometry?.dispose());
      signMat.dispose();
    },
  };
}
