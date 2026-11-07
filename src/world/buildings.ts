import { Vector3 } from "three";

import { type Rng, pick, range } from "../core/math";
import type { CollisionWorld } from "./collision";
import { Facade, type FacadeSpec, type MeshBuilder } from "./meshBuilder";
import { type PaletteKey, type RGB, rgb, shade } from "./palette";

export type Footprint = { x0: number; z0: number; x1: number; z1: number };
export type Recipe = "brick" | "glass" | "deco" | "modern";
export type PropPlacement = { type: string; x: number; y: number; z: number; rotY: number; scale: number };

type Ctx = {
  builder: MeshBuilder;
  world: CollisionWorld;
  props: PropPlacement[];
  rng: Rng;
};

const BRICK: PaletteKey[] = ["b_brick", "b_terracotta", "b_salmon", "b_brick", "b_cream"];
const GLASS_TINT: PaletteKey[] = ["glass", "b_sky", "b_teal", "b_navy", "glass"];
const DECO: PaletteKey[] = ["b_cream", "b_butter", "b_white", "b_lavender", "b_cream"];
const MODERN: PaletteKey[] = ["b_mint", "b_teal", "b_lavender", "b_white", "b_sky", "b_slate"];

export function chooseRecipe(rng: Rng, height: number): Recipe {
  if (height > 70) return rng() < 0.65 ? "glass" : "deco";
  if (height > 45) return pick(rng, ["glass", "deco", "modern", "brick"] as const);
  return pick(rng, ["brick", "brick", "modern", "deco"] as const);
}

function facade(style: Facade, seed: number, windowColor: RGB, topY: number, groundH = 4.6, baseY = 0): FacadeSpec {
  return { style, seed, groundH, window: windowColor, baseY, topY };
}

function mass(ctx: Ctx, f: Footprint, y0: number, y1: number, wall: RGB, roof: RGB, spec: FacadeSpec | undefined, anchor = true) {
  ctx.builder.box(f.x0, y0, f.z0, f.x1, y1, f.z1, { sides: wall, top: roof }, { facade: spec, skipBottom: y0 <= 0.01 });
  ctx.world.add(new Vector3(f.x0, y0, f.z0), new Vector3(f.x1, y1, f.z1), "building", anchor);
}

/** Thin outset band around a footprint: cornices, belt courses, roof slabs. */
function band(ctx: Ctx, f: Footprint, y0: number, y1: number, out: number, color: RGB) {
  ctx.builder.box(f.x0 - out, y0, f.z0 - out, f.x1 + out, y1, f.z1 + out, color);
}

function parapet(ctx: Ctx, f: Footprint, y: number, h: number, t: number, color: RGB) {
  const b = ctx.builder;
  b.box(f.x0, y, f.z0, f.x1, y + h, f.z0 + t, color, { skipBottom: true });
  b.box(f.x0, y, f.z1 - t, f.x1, y + h, f.z1, color, { skipBottom: true });
  b.box(f.x0, y, f.z0 + t, f.x0 + t, y + h, f.z1 - t, color, { skipBottom: true });
  b.box(f.x1 - t, y, f.z0 + t, f.x1, y + h, f.z1 - t, color, { skipBottom: true });
}

const inset = (f: Footprint, d: number): Footprint => ({ x0: f.x0 + d, z0: f.z0 + d, x1: f.x1 - d, z1: f.z1 - d });
const w = (f: Footprint) => f.x1 - f.x0;
const d = (f: Footprint) => f.z1 - f.z0;
const cx = (f: Footprint) => (f.x0 + f.x1) / 2;
const cz = (f: Footprint) => (f.z0 + f.z1) / 2;

function rooftop(ctx: Ctx, f: Footprint, y: number, recipe: Recipe, tall: boolean) {
  const r = ctx.rng;
  const area = w(f) * d(f);
  if (area < 120) return;
  // Stair/elevator hut: breaks up flat roofs and catches the sun.
  if (r() < 0.75) {
    const hx = range(r, f.x0 + 3, f.x1 - 6);
    const hz = range(r, f.z0 + 3, f.z1 - 6);
    ctx.builder.box(hx, y, hz, hx + 3.2, y + 3, hz + 3.2, { sides: rgb("roof"), top: rgb("roof_dark") }, { skipBottom: true });
  }
  const spot = () => ({ x: range(r, f.x0 + 3.5, f.x1 - 3.5), z: range(r, f.z0 + 3.5, f.z1 - 3.5) });
  if ((recipe === "brick" || recipe === "deco") && r() < 0.35 && !tall) {
    const s = spot();
    ctx.props.push({ type: "water_tower", x: s.x, y, z: s.z, rotY: r() * Math.PI, scale: 1 });
    ctx.world.add(new Vector3(s.x - 1.8, y, s.z - 1.8), new Vector3(s.x + 1.8, y + 8.4, s.z + 1.8), "prop", false);
  }
  const acCount = (r() < 0.45 ? 1 : 0) + ((recipe === "modern" || recipe === "glass") && r() < 0.3 ? 1 : 0);
  for (let i = 0; i < acCount; i++) {
    const s = spot();
    ctx.props.push({ type: "ac_unit", x: s.x, y, z: s.z, rotY: Math.floor(r() * 4) * (Math.PI / 2), scale: 1 });
  }
  if (tall && r() < 0.6) {
    ctx.props.push({ type: "antenna", x: cx(f) + range(r, -2, 2), y, z: cz(f) + range(r, -2, 2), rotY: 0, scale: range(r, 1, 1.6) });
  }
  if (!tall && r() < 0.12) {
    ctx.builder.box(f.x0 + 2, y, f.z0 + 2, f.x1 - 2, y + 0.5, f.z1 - 2, { sides: rgb("trunk"), top: rgb("grass") }, { skipBottom: true });
  }
}

export function buildBuilding(ctx: Ctx, f: Footprint, height: number, recipe: Recipe, seed: number) {
  const r = ctx.rng;
  const tall = height > 60;
  switch (recipe) {
    case "brick": {
      const wall = rgb(pick(r, BRICK));
      const trim = rgb(r() < 0.5 ? "frame" : "b_cream");
      const roofC = rgb("roof");
      mass(ctx, f, 0, height, wall, roofC, facade(Facade.Grid, seed, rgb("glass"), height - 1.2));
      band(ctx, f, 4.6, 5.2, 0.3, trim);
      band(ctx, f, height - 1.4, height - 0.5, 0.45, trim);
      parapet(ctx, f, height, 1.0, 0.5, shade(wall, 0.92));
      // Corner piers give brick blocks their chunky silhouette.
      const p = 1.3, o = 0.3;
      const piers: Array<[number, number]> = [[f.x0, f.z0], [f.x1 - p, f.z0], [f.x0, f.z1 - p], [f.x1 - p, f.z1 - p]];
      for (const [px, pz] of piers) {
        ctx.builder.box(px - o, 0, pz - o, px + p + o, height - 1.4, pz + p + o, { sides: shade(wall, 0.9), top: shade(wall, 0.9) },
          { facade: facade(Facade.Wall, seed, rgb("glass"), height), skipBottom: true });
      }
      rooftop(ctx, f, height, recipe, tall);
      break;
    }
    case "glass": {
      const podiumH = range(r, 9, 13);
      const podiumWall = rgb(pick(r, ["b_slate", "b_white", "b_navy"] as const));
      const tint = rgb(pick(r, GLASS_TINT));
      const mullion = rgb(r() < 0.6 ? "frame" : "metal");
      mass(ctx, f, 0, podiumH, podiumWall, rgb("roof"), facade(Facade.Grid, seed, rgb("glass"), podiumH - 0.8));
      band(ctx, f, podiumH - 0.6, podiumH + 0.4, 0.4, rgb("frame"));
      const towerInset = Math.min(range(r, 2, 4), Math.min(w(f), d(f)) * 0.2);
      const tower = inset(f, towerInset);
      const setback = height > 70 && Math.min(w(tower), d(tower)) > 18;
      const t1 = setback ? height * range(r, 0.72, 0.82) : height;
      mass(ctx, tower, podiumH, t1, mullion, rgb("roof"), facade(Facade.Curtain, seed, tint, t1 - 0.4, 0, podiumH));
      band(ctx, tower, t1 - 0.2, t1 + 0.6, 0.35, mullion);
      if (setback) {
        const top = inset(tower, range(r, 3, 4.5));
        mass(ctx, top, t1, height, mullion, rgb("roof"), facade(Facade.Curtain, seed + 3, tint, height - 0.4, 0, t1));
        band(ctx, top, height - 0.2, height + 0.8, 0.35, mullion);
        rooftop(ctx, top, height + 0.8, recipe, tall);
      } else {
        rooftop(ctx, tower, t1 + 0.6, recipe, tall);
      }
      break;
    }
    case "deco": {
      const wall = rgb(pick(r, DECO));
      const accent = rgb(pick(r, ["b_teal", "b_navy", "b_terracotta", "b_slate"] as const));
      const tiers = height > 70 ? 3 : height > 40 ? 2 : 1;
      let fp = f;
      let y = 0;
      const fractions = tiers === 3 ? [0.62, 0.86, 1] : tiers === 2 ? [0.78, 1] : [1];
      for (let i = 0; i < tiers; i++) {
        const top = height * fractions[i];
        mass(ctx, fp, y, top, wall, rgb("roof"), facade(Facade.Piers, seed + i, rgb("glass"), top - 1.0, i === 0 ? 4.6 : 0, i === 0 ? 0 : y));
        band(ctx, fp, top - 1.0, top, 0.4, accent);
        y = top;
        const next = inset(fp, range(r, 2.5, 4));
        if (w(next) < 8 || d(next) < 8) break;
        if (i < tiers - 1) fp = next;
      }
      if (tall) {
        const spire = inset(fp, Math.min(w(fp), d(fp)) / 2 - 1.6);
        ctx.builder.box(spire.x0, y, spire.z0, spire.x1, y + 7, spire.z1, { sides: accent, top: rgb("coin") }, { skipBottom: true });
      } else {
        rooftop(ctx, fp, y, recipe, tall);
      }
      break;
    }
    case "modern": {
      const wall = rgb(pick(r, MODERN));
      mass(ctx, f, 0, height, wall, rgb("roof"), facade(Facade.Ribbon, seed, rgb(r() < 0.7 ? "glass" : "b_navy"), height - 0.8));
      band(ctx, f, height - 0.2, height + 0.7, 0.8, rgb("frame"));
      if (height > 24) band(ctx, f, 4.4, 4.9, 0.6, rgb("frame"));
      rooftop(ctx, f, height + 0.7, recipe, tall);
      break;
    }
  }
}

/** The landmark that terminates Tower Ave: a hand-shaped silhouette, not a random lot. */
export function buildCrawlerTower(ctx: Ctx, cxp: number, czp: number) {
  const fp = (half: number): Footprint => ({ x0: cxp - half, z0: czp - half, x1: cxp + half, z1: czp + half });
  const seed = 77;
  const navy = rgb("b_navy");
  const teal = rgb("b_teal");
  const gold = rgb("coin");
  const frame = rgb("frame");
  mass(ctx, fp(26), 0, 14, navy, rgb("roof"), facade(Facade.Grid, seed, rgb("glass"), 13));
  band(ctx, fp(26), 13.2, 14.4, 0.6, gold);
  mass(ctx, fp(19), 14, 96, frame, rgb("roof"), facade(Facade.Curtain, seed, teal, 95.4, 0, 14));
  band(ctx, fp(19), 95.6, 97, 0.5, gold);
  mass(ctx, fp(15), 97, 122, frame, rgb("roof"), facade(Facade.Curtain, seed + 1, teal, 121.4, 0, 97));
  band(ctx, fp(15), 121.6, 123, 0.5, gold);
  mass(ctx, fp(10), 123, 138, navy, gold, facade(Facade.Piers, seed + 2, rgb("window_lit"), 137, 0, 123));
  band(ctx, fp(10), 137.4, 139, 0.6, gold);
  ctx.builder.box(cxp - 1.3, 139, czp - 1.3, cxp + 1.3, 172, czp + 1.3, { sides: frame, top: rgb("warning_red") });
  ctx.builder.box(cxp - 1.8, 160, czp - 1.8, cxp + 1.8, 162, czp + 1.8, gold);
  ctx.world.add(new Vector3(cxp - 1.3, 139, czp - 1.3), new Vector3(cxp + 1.3, 172, czp + 1.3), "building", true);
}
