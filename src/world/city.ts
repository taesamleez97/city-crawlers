import { type BufferGeometry, Euler, Group, Matrix4, Mesh, type Material, Quaternion, Vector3 } from "three";

import { type Rng, mulberry32, range } from "../core/math";
import { type Footprint, type PropPlacement, buildBuilding, buildCrawlerTower, chooseRecipe } from "./buildings";
import {
  AVENUES, BANNERS, BLIMP, BOUNDS, CANAL, CRANE, MIN_HEIGHT_POINTS, ROUTE, SIDEWALK, SKYBRIDGES, STREETS, ZONES,
  type Zone,
} from "./cityLayout";
import { type Collider, CollisionWorld } from "./collision";
import { Facade, MeshBuilder } from "./meshBuilder";
import { type RGB, rgb, shade } from "./palette";

export type TrafficLane = { ax: number; az: number; bx: number; bz: number; count: number };

export interface CityData {
  group: Group;
  world: CollisionWorld;
  props: PropPlacement[];
  lanes: TrafficLane[];
  blimpCollider: Collider;
  stats: { buildings: number; triangles: number; chunks: number };
}

const CHUNK = 100;
const X_LINES = [BOUNDS.x0, ...AVENUES.map((a) => a.x), BOUNDS.x1];
const Z_LINES = [BOUNDS.z1, ...STREETS.map((s) => s.z), BOUNDS.z0];
const PROMENADE = 6;

type Rect = { x0: number; z0: number; x1: number; z1: number };

function avenueAt(x: number, zMid: number) {
  return AVENUES.find((a) => a.x === x && zMid >= a.z0 - 1 && zMid <= a.z1 + 1);
}
function streetAt(z: number, xMid: number) {
  return STREETS.find((s) => s.z === z && xMid >= s.x0 - 1 && xMid <= s.x1 + 1);
}

/** Grid cells merged across missing road segments → rectangular blocks. */
function computeBlocks(): Rect[] {
  const nx = X_LINES.length - 1;
  const nz = Z_LINES.length - 1;
  const parent = Array.from({ length: nx * nz }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => (parent[find(a)] = find(b));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const zMid = (Z_LINES[j] + Z_LINES[j + 1]) / 2;
      const xMid = (X_LINES[i] + X_LINES[i + 1]) / 2;
      if (i + 1 < nx && !avenueAt(X_LINES[i + 1], zMid)) union(i * nz + j, (i + 1) * nz + j);
      if (j + 1 < nz && !streetAt(Z_LINES[j + 1], xMid)) union(i * nz + j, i * nz + j + 1);
    }
  }
  const groups = new Map<number, Rect>();
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const root = find(i * nz + j);
      const r = groups.get(root);
      const cell = { x0: X_LINES[i], x1: X_LINES[i + 1], z0: Z_LINES[j + 1], z1: Z_LINES[j] };
      groups.set(root, r ? { x0: Math.min(r.x0, cell.x0), x1: Math.max(r.x1, cell.x1), z0: Math.min(r.z0, cell.z0), z1: Math.max(r.z1, cell.z1) } : cell);
    }
  }
  return [...groups.values()].map((b) => {
    const zMid = (b.z0 + b.z1) / 2;
    const xMid = (b.x0 + b.x1) / 2;
    const west = avenueAt(b.x0, zMid);
    const east = avenueAt(b.x1, zMid);
    const north = streetAt(b.z0, xMid);
    const south = streetAt(b.z1, xMid);
    return {
      x0: b.x0 + (west ? west.w / 2 : PROMENADE),
      x1: b.x1 - (east ? east.w / 2 : PROMENADE),
      z0: b.z0 + (north ? north.w / 2 : PROMENADE),
      z1: b.z1 - (south ? south.w / 2 : PROMENADE),
    };
  });
}

function distToRoute(x: number, z: number): { dist: number; seg: number } {
  let best = { dist: Infinity, seg: 0 };
  for (let i = 0; i < ROUTE.length - 1; i++) {
    const [ax, az] = ROUTE[i];
    const [bx, bz] = ROUTE[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < best.dist) best = { dist: d, seg: i };
  }
  return best;
}

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
const inside = (x: number, z: number, r: Rect) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

function splitLots(rng: Rng, r: Rect, out: Rect[], maxLot: number) {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  if (w <= maxLot && d <= maxLot) {
    out.push(r);
    return;
  }
  const t = range(rng, 0.38, 0.62);
  if (w >= d) {
    const x = r.x0 + w * t;
    splitLots(rng, { ...r, x1: x }, out, maxLot);
    splitLots(rng, { ...r, x0: x }, out, maxLot);
  } else {
    const z = r.z0 + d * t;
    splitLots(rng, { ...r, z1: z }, out, maxLot);
    splitLots(rng, { ...r, z0: z }, out, maxLot);
  }
}

export function buildCity(material: Material, propGeometry?: (type: string) => BufferGeometry | undefined): CityData {
  const rng = mulberry32(20261107);
  const world = new CollisionWorld();
  const props: PropPlacement[] = [];
  const chunks = new Map<string, MeshBuilder>();
  const chunkFor = (x: number, z: number) => {
    const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let b = chunks.get(k);
    if (!b) chunks.set(k, (b = new MeshBuilder()));
    return b;
  };
  const ground = new MeshBuilder();
  const decals = new MeshBuilder();

  const asphalt = rgb("asphalt");
  const stone = rgb("curb");
  const sidewalk = rgb("sidewalk");

  // ---------------------------------------------------------------- island + canal
  const cz0 = CANAL.z - CANAL.halfWidth, cz1 = CANAL.z + CANAL.halfWidth;
  ground.box(BOUNDS.x0, -6, cz1, BOUNDS.x1, 0, BOUNDS.z1, { top: asphalt, sides: stone }, { skipBottom: true });
  ground.box(BOUNDS.x0, -6, BOUNDS.z0, BOUNDS.x1, 0, cz0, { top: asphalt, sides: stone }, { skipBottom: true });
  ground.box(BOUNDS.x0 - 2, -6, cz0, BOUNDS.x1 + 2, CANAL.waterY, cz1, { top: rgb("water"), sides: rgb("water") }, { skipBottom: true });
  for (let x = BOUNDS.x0; x < BOUNDS.x1; x += 9) {
    decals.flat(x, CANAL.z - 0.5, x + 4.5, CANAL.z + 0.5, CANAL.waterY + 0.02, rgb("water_light"));
  }
  // Canal railings and avenue bridges.
  const railC = rgb("metal_dark");
  for (const z of [cz0 - 0.3, cz1]) ground.box(BOUNDS.x0, 0, z, BOUNDS.x1, 1.0, z + 0.3, railC, { skipBottom: true });
  for (const a of AVENUES) {
    if (CANAL.z < a.z0 || CANAL.z > a.z1) continue;
    const bx0 = a.x - a.w / 2 - 2, bx1 = a.x + a.w / 2 + 2;
    ground.box(bx0, -1.2, cz0 - 0.4, bx1, 0.05, cz1 + 0.4, { top: asphalt, sides: stone, bottom: shade(stone, 0.7) });
    for (const x of [bx0, bx1 - 0.5]) ground.box(x, 0.05, cz0 - 0.4, x + 0.5, 1.2, cz1 + 0.4, stone, { skipBottom: true });
  }

  // ---------------------------------------------------------------- road markings
  const yellow = rgb("lane_yellow"), white = rgb("lane_white");
  const intersections: Array<{ x: number; z: number; aw: number; sw: number }> = [];
  for (const a of AVENUES) for (const s of STREETS) {
    if (s.z >= a.z0 - 1 && s.z <= a.z1 + 1 && a.x >= s.x0 - 1 && a.x <= s.x1 + 1) intersections.push({ x: a.x, z: s.z, aw: a.w, sw: s.w });
  }
  const nearIntersection = (x: number, z: number, pad: number) =>
    intersections.some((i) => Math.abs(x - i.x) < i.aw / 2 + pad && Math.abs(z - i.z) < i.sw / 2 + pad);
  for (const a of AVENUES) {
    for (let z = Math.max(a.z0, BOUNDS.z0); z < Math.min(a.z1, BOUNDS.z1); z += 9) {
      if (nearIntersection(a.x, z + 1.5, 3) || Math.abs(z - CANAL.z) < 10) continue;
      if (a.w >= 26) {
        decals.flat(a.x - 0.55, z, a.x - 0.25, z + 9, 0.02, yellow);
        decals.flat(a.x + 0.25, z, a.x + 0.55, z + 9, 0.02, yellow);
        for (const o of [-6.5, 6.5]) decals.flat(a.x + o - 0.15, z, a.x + o + 0.15, z + 3.5, 0.02, white);
      } else {
        decals.flat(a.x - 0.18, z, a.x + 0.18, z + 4, 0.02, yellow);
      }
    }
  }
  for (const s of STREETS) {
    if (s.canal) continue;
    for (let x = s.x0; x < s.x1; x += 9) {
      if (nearIntersection(x + 2, s.z, 3)) continue;
      decals.flat(x, s.z - 0.15, x + 4, s.z + 0.15, 0.02, white);
    }
  }
  for (const i of intersections) {
    // Zebra crossings on all four approaches.
    const stripes = (alongX: boolean, cx: number, cz: number, len: number) => {
      const n = Math.floor(len / 1.7);
      for (let k = 0; k < n; k++) {
        const o = -len / 2 + 0.85 + k * 1.7;
        if (alongX) decals.flat(cx + o - 0.4, cz - 1.8, cx + o + 0.4, cz + 1.8, 0.025, white);
        else decals.flat(cx - 1.8, cz + o - 0.4, cx + 1.8, cz + o + 0.4, 0.025, white);
      }
    };
    stripes(true, i.x, i.z - i.sw / 2 - 2.6, i.aw - 2);
    stripes(true, i.x, i.z + i.sw / 2 + 2.6, i.aw - 2);
    stripes(false, i.x - i.aw / 2 - 2.6, i.z, i.sw - 2);
    stripes(false, i.x + i.aw / 2 + 2.6, i.z, i.sw - 2);
  }

  // ---------------------------------------------------------------- blocks, lots, buildings
  const blocks = computeBlocks();
  const zoneOf = (r: Rect): Zone | undefined => ZONES.find((z) => overlaps(r, z));
  let buildingCount = 0;
  const ctxFor = (x: number, z: number) => ({ builder: chunkFor(x, z), world, props, rng });

  for (const b of blocks) {
    const perimeter = b.x0 < AVENUES[0].x || b.x1 > AVENUES[AVENUES.length - 1].x || b.z1 > STREETS[0].z || b.z0 < STREETS[STREETS.length - 1].z;
    ground.box(b.x0, 0, b.z0, b.x1, 0.22, b.z1, { top: sidewalk, sides: stone }, { skipBottom: true });
    const area: Rect = { x0: b.x0 + SIDEWALK, z0: b.z0 + SIDEWALK, x1: b.x1 - SIDEWALK, z1: b.z1 - SIDEWALK };
    const lots: Rect[] = [];
    splitLots(rng, area, lots, perimeter ? 40 : 34);
    for (const lot of lots) {
      if (zoneOf(lot)) continue;
      const lx = (lot.x0 + lot.x1) / 2, lz = (lot.z0 + lot.z1) / 2;
      const { dist, seg } = distToRoute(lx, lz);
      let h: number;
      if (dist < 48) h = seg === 0 ? range(rng, 42, 70) : seg === 1 ? range(rng, 48, 78) : range(rng, 62, 96);
      else if (perimeter) h = range(rng, 12, 30);
      else if (rng() < 0.05) h = range(rng, 85, 118);
      else h = range(rng, 20, 58);
      for (const p of MIN_HEIGHT_POINTS) if (inside(p.x, p.z, lot)) h = Math.max(h, p.h);
      // Small random setbacks keep street walls from looking extruded.
      const s = () => (rng() < 0.5 ? 0 : range(rng, 0.4, 1.6));
      const fp: Footprint = { x0: lot.x0 + 0.4 + s(), z0: lot.z0 + 0.4 + s(), x1: lot.x1 - 0.4 - s(), z1: lot.z1 - 0.4 - s() };
      if (fp.x1 - fp.x0 < 8 || fp.z1 - fp.z0 < 8) continue;
      buildBuilding(ctxFor(lx, lz), fp, Math.round(h * 2) / 2, chooseRecipe(rng, h), Math.floor(rng() * 1000));
      buildingCount++;
      if (dist < 48 && dist > 14 && rng() < 0.1) {
        const facing = seg === 1 ? (lz < -380 ? 0 : Math.PI) : lx < 0 || (seg === 2 && lx < 250) ? Math.PI / 2 : -Math.PI / 2;
        props.push({ type: ["billboard_a", "billboard_b", "billboard_c"][Math.floor(rng() * 3)], x: lx, y: Math.round(h * 2) / 2 + 0.7, z: lz, rotY: facing, scale: 1 });
      }
    }
  }

  // ---------------------------------------------------------------- zones
  for (const z of ZONES) {
    const zx = (z.x0 + z.x1) / 2, zz = (z.z0 + z.z1) / 2;
    if (z.kind === "start") {
      const fp: Footprint = { x0: -22, z0: 93, x1: 22, z1: 131 };
      const ctx = ctxFor(0, 112);
      const wall = rgb("b_brick");
      ctx.builder.box(fp.x0, 0, fp.z0, fp.x1, 34, fp.z1, { sides: wall, top: rgb("roof") },
        { facade: { style: Facade.Grid, seed: 5, groundH: 4.6, window: rgb("glass"), baseY: 0, topY: 33 }, skipBottom: true });
      world.add(new Vector3(fp.x0, 0, fp.z0), new Vector3(fp.x1, 34, fp.z1), "building", true);
      ctx.builder.box(fp.x0 - 0.5, 33, fp.z0 - 0.5, fp.x1 + 0.5, 33.8, fp.z1 + 0.5, rgb("frame"));
      // Launch ledge: parapet with a hazard lip, tiled roof so the foreground has texture.
      ctx.builder.box(fp.x0, 34, fp.z0, fp.x1, 34.55, fp.z0 + 0.7, { sides: rgb("b_cream"), top: rgb("b_white") }, { skipBottom: true });
      ctx.builder.box(-4, 34.55, fp.z0, 4, 34.65, fp.z0 + 0.7, rgb("hazard"), { skipBottom: true });
      for (let x = fp.x0 + 4; x < fp.x1; x += 4) ctx.builder.flat(x - 0.12, fp.z0 + 0.7, x + 0.12, fp.z1, 34.01, rgb("roof_dark"));
      for (let z = fp.z0 + 4; z < fp.z1; z += 4) ctx.builder.flat(fp.x0, z - 0.12, fp.x1, z + 0.12, 34.012, rgb("roof_dark"));
      props.push({ type: "water_tower", x: -12, y: 34, z: 120, rotY: 0.3, scale: 1 });
      props.push({ type: "ac_unit", x: 10, y: 34, z: 118, rotY: 0, scale: 1 });
      props.push({ type: "ac_unit", x: 14, y: 34, z: 110, rotY: Math.PI / 2, scale: 1 });
      props.push({ type: "antenna", x: 16, y: 34, z: 126, rotY: 0, scale: 1.2 });
      buildingCount++;
    } else if (z.kind === "plaza") {
      ground.box(z.x0, 0.22, z.z0, z.x1, 0.32, z.z1, { top: rgb("plaza"), sides: rgb("plaza_dark") }, { skipBottom: true });
      for (let x = z.x0 + 4; x < z.x1 - 4; x += 8) decals.flat(x, z.z0 + 2, x + 4, z.z1 - 2, 0.33, rgb("plaza_dark"));
      props.push({ type: "kit:pavement-fountain", x: zx - 8, y: 0.32, z: zz, rotY: 0, scale: 1 });
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        props.push({ type: ["tree_a", "tree_b", "tree_c"][k % 3], x: zx - 8 + Math.cos(a) * 22, y: 0.32, z: zz + Math.sin(a) * 22, rotY: a, scale: 1 });
      }
      ["a", "b", "c", "d"].forEach((s, k) => {
        props.push({ type: `kit:building-small-${s}`, x: z.x1 - 7, y: 0.32, z: z.z0 + 9 + k * 14, rotY: -Math.PI / 2, scale: 1 });
        world.add(new Vector3(z.x1 - 13, 0, z.z0 + 3 + k * 14), new Vector3(z.x1 - 1, 13, z.z0 + 15 + k * 14), "building", true);
      });
    } else if (z.kind === "park") {
      ground.box(z.x0, 0.22, z.z0, z.x1, 0.4, z.z1, { top: rgb("grass"), sides: rgb("grass_dark") }, { skipBottom: true });
      const cols = Math.floor((z.x1 - z.x0) / 10), rows = Math.floor((z.z1 - z.z0) / 10);
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        if (i === Math.floor(cols / 2) || j === Math.floor(rows / 2)) {
          decals.flat(z.x0 + i * 10, z.z0 + j * 10, z.x0 + i * 10 + 10, z.z0 + j * 10 + 10, 0.41, rgb("plaza"));
          continue;
        }
        props.push({ type: rng() < 0.5 ? "kit:grass-trees-tall" : "kit:grass-trees", x: z.x0 + i * 10 + 5, y: 0.4, z: z.z0 + j * 10 + 5, rotY: Math.floor(rng() * 4) * (Math.PI / 2), scale: 1 });
      }
    } else if (z.kind === "construction") {
      ground.box(z.x0, 0.22, z.z0, z.x1, 0.3, z.z1, { top: rgb("plaza_dark"), sides: rgb("plaza_dark") }, { skipBottom: true });
      const hz = rgb("hazard"), dark = rgb("hazard_dark");
      for (let x = z.x0; x < z.x1; x += 2) ground.box(x, 0.3, z.z1 - 0.3, x + 1.9, 2.2, z.z1, (x / 2) % 2 ? hz : dark, { skipBottom: true });
      ground.box(z.x0 + 3, 0.3, z.z0 + 4, z.x0 + 9, 2.5, z.z0 + 10, { sides: rgb("wood"), top: rgb("wood") }, { skipBottom: true });
      ground.box(z.x0 + 4, 2.5, z.z0 + 5, z.x0 + 8, 4.2, z.z0 + 9, { sides: rgb("metal"), top: rgb("metal") }, { skipBottom: true });
      props.push({ type: "crane", x: CRANE.x, y: 0.3, z: CRANE.z, rotY: CRANE.rotY, scale: CRANE.scale });
      const s = CRANE.scale;
      world.add(new Vector3(CRANE.x - 1.1 * s, 0, CRANE.z - 1.1 * s), new Vector3(CRANE.x + 1.1 * s, 55 * s, CRANE.z + 1.1 * s), "obstacle", true);
      world.add(new Vector3(CRANE.x - 0.9 * s, (55 - 0.85) * s, CRANE.z - 15 * s), new Vector3(CRANE.x + 0.9 * s, (55 + 0.85) * s, CRANE.z + 37 * s), "obstacle", true);
    } else if (z.kind === "tower") {
      ground.box(z.x0, 0.22, z.z0, z.x1, 0.34, z.z1, { top: rgb("plaza"), sides: rgb("plaza_dark") }, { skipBottom: true });
      buildCrawlerTower(ctxFor(250, -680), 250, -680);
      buildingCount++;
      for (const [tx, tz] of [[218, -640], [282, -640], [218, -715], [282, -715]]) props.push({ type: "tree_b", x: tx, y: 0.34, z: tz, rotY: 0, scale: 1.2 });
    }
  }

  // ---------------------------------------------------------------- obstacles
  const hz = rgb("hazard"), dark = rgb("hazard_dark");
  for (const bn of BANNERS) {
    const alongX = bn.x1 - bn.x0 > bn.z1 - bn.z0;
    const b = chunkFor((bn.x0 + bn.x1) / 2, (bn.z0 + bn.z1) / 2);
    const len = alongX ? bn.x1 - bn.x0 : bn.z1 - bn.z0;
    const n = Math.round(len / 2.4);
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const c: RGB = k % 2 ? hz : dark;
      if (alongX) b.box(bn.x0 + len * t0, bn.y, bn.z0, bn.x0 + len * t1, bn.y + bn.h, bn.z1, c);
      else b.box(bn.x0, bn.y, bn.z0 + len * t0, bn.x1, bn.y + bn.h, bn.z0 + len * t1, c);
    }
    b.box(bn.x0, bn.y + bn.h, bn.z0 - 0.1, bn.x1, bn.y + bn.h + 0.35, bn.z1 + 0.1, rgb("warning_red"));
    world.add(new Vector3(bn.x0, bn.y, bn.z0 - 0.4), new Vector3(bn.x1, bn.y + bn.h + 0.35, bn.z1 + 0.4), "obstacle", true);
  }
  for (const sb of SKYBRIDGES) {
    const b = chunkFor((sb.x0 + sb.x1) / 2, (sb.z0 + sb.z1) / 2);
    const top = sb.y1;
    b.box(sb.x0, sb.y0, sb.z0, sb.x1, top, sb.z1, { sides: rgb("frame"), top: rgb("roof"), bottom: rgb("b_slate") },
      { facade: { style: Facade.Ribbon, seed: 9, groundH: 0, window: rgb("b_sky"), baseY: sb.y0 - 1.2, topY: top + 0.6 } });
    b.box(sb.x0 - 0.3, sb.y0 - 0.5, sb.z0, sb.x1 + 0.3, sb.y0, sb.z1, rgb("hazard"));
    b.box(sb.x0 - 0.3, top, sb.z0, sb.x1 + 0.3, top + 0.5, sb.z1, rgb("frame"));
    world.add(new Vector3(sb.x0 - 0.3, sb.y0 - 0.5, sb.z0), new Vector3(sb.x1 + 0.3, top + 0.5, sb.z1), "obstacle", true);
  }
  const blimpCollider = world.add(new Vector3(-9.5, -3, -3), new Vector3(9.5, 3, 3), "obstacle", false, true);
  blimpCollider.min.set(BLIMP.x0 - 9.5, BLIMP.y - 3, BLIMP.z - 3);
  blimpCollider.max.set(BLIMP.x0 + 9.5, BLIMP.y + 3, BLIMP.z + 3);

  // ---------------------------------------------------------------- street furniture + traffic
  const furnish = (alongZ: boolean, c: number, half: number, from: number, to: number) => {
    for (let t = from; t < to; t += 16) {
      for (const side of [-1, 1]) {
        const x = alongZ ? c + side * (half + 2) : t;
        const z = alongZ ? t : c + side * (half + 2);
        if (nearIntersection(x, z, 6)) continue;
        if (ZONES.some((zn) => inside(x, z, { x0: zn.x0 - 3, z0: zn.z0 - 3, x1: zn.x1 + 3, z1: zn.z1 + 3 }))) continue;
        const k = Math.floor((t - from) / 16);
        if (k % 2 === 0) props.push({ type: ["tree_a", "tree_b", "tree_c"][(k / 2 + (side > 0 ? 1 : 0)) % 3], x, y: 0.22, z, rotY: rng() * Math.PI, scale: range(rng, 0.9, 1.1) });
        else props.push({ type: "streetlamp", x: alongZ ? c + side * (half + 0.7) : t, y: 0.22, z: alongZ ? t : c + side * (half + 0.7), rotY: alongZ ? (side > 0 ? Math.PI : 0) : (side > 0 ? Math.PI / 2 : -Math.PI / 2), scale: 1 });
      }
    }
  };
  furnish(true, 0, 14, -735, 70);
  furnish(true, 250, 11, -615, 75);
  furnish(false, -380, 15, -195, 435);
  furnish(true, 120, 10, -735, 75);
  furnish(false, -160, 9, -125, 365);

  const lanes: TrafficLane[] = [];
  for (const a of AVENUES) {
    const z0 = Math.max(a.z0, BOUNDS.z0 + 8), z1 = Math.min(a.z1, BOUNDS.z1 - 8);
    lanes.push({ ax: a.x + 3.5, az: z1, bx: a.x + 3.5, bz: z0, count: a.w > 24 ? 5 : a.w > 20 ? 3 : 2 });
    lanes.push({ ax: a.x - 3.5, az: z0, bx: a.x - 3.5, bz: z1, count: a.w > 24 ? 5 : a.w > 20 ? 3 : 2 });
  }
  for (const s of STREETS) {
    if (s.canal) {
      lanes.push({ ax: s.x0 + 8, az: s.z + 11, bx: s.x1 - 8, bz: s.z + 11, count: 3 });
      lanes.push({ ax: s.x1 - 8, az: s.z - 11, bx: s.x0 + 8, bz: s.z - 11, count: 3 });
      continue;
    }
    lanes.push({ ax: s.x0 + 8, az: s.z + 3.5, bx: s.x1 - 8, bz: s.z + 3.5, count: 1 });
    lanes.push({ ax: s.x1 - 8, az: s.z - 3.5, bx: s.x0 + 8, bz: s.z - 3.5, count: 1 });
  }

  // ---------------------------------------------------------------- static props
  // Baked into the chunk meshes: zero extra draw calls, and they cull with their block.
  if (propGeometry) {
    const cache = new Map<string, BufferGeometry | null>();
    const geoFor = (type: string) => {
      if (!cache.has(type)) {
        const g = propGeometry(type);
        cache.set(type, g ? (g.index ? g.toNonIndexed() : g) : null);
      }
      return cache.get(type)!;
    };
    const m = new Matrix4(), q = new Quaternion(), e = new Euler(), pos = new Vector3(), scl = new Vector3();
    for (const p of props) {
      const geo = geoFor(p.type);
      if (!geo) continue;
      m.compose(pos.set(p.x, p.y, p.z), q.setFromEuler(e.set(0, p.rotY, 0)), scl.setScalar(p.scale));
      chunkFor(p.x, p.z).appendMesh(geo, m);
    }
  }

  // ---------------------------------------------------------------- meshes
  const group = new Group();
  group.name = "city";
  let triangles = 0;
  const addMesh = (b: MeshBuilder, name: string, cast: boolean) => {
    if (!b.vertexCount) return;
    const m = new Mesh(b.build(), material);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    group.add(m);
    triangles += b.vertexCount / 3;
  };
  addMesh(ground, "ground", false);
  addMesh(decals, "decals", false);
  for (const [k, b] of chunks) addMesh(b, `chunk_${k}`, true);

  return { group, world, props, lanes, blimpCollider, stats: { buildings: buildingCount, triangles, chunks: chunks.size } };
}
