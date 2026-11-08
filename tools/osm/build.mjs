// Turns the raw map extracts (tools/osm/cache, from fetch.mjs: OpenStreetMap as
// packaged by Overture Maps) into the compact city files the game loads
// (public/cities/<id>.json):
//
//   node tools/osm/build.mjs [city…]            build
//   node tools/osm/build.mjs --explore <city>   list streets and tall buildings
//
// Coordinates are local meters around each city's origin (+x east, +z south),
// stored as decimeter integers. Buildings keep their real footprint and height;
// anything standing in the route's flight corridor is dropped.
//
// The output is a derivative database of OpenStreetMap, © OpenStreetMap
// contributors, available under the Open Database License 1.0. It's published
// as-is in public/cities so anyone can take it.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CITIES } from "./cities.mjs";
import {
  assembleRings, centroid, distToPolyline, insideRing, perimeter, projector, ringArea, ringToPolyline, simplifyLine, simplifyRing,
} from "./geo.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = join(here, "cache");
const OUT = join(here, "../../public/cities");

/** Buildings this far from the route are kept (fog hides the rest). */
const KEEP = 520;
const ROAD_KEEP = 650;
const LEVEL_H = 3.3;

/** Class (1 major … 5 pedestrian) and typical width (meters) when the data has none. */
const ROAD = {
  motorway: [1, 24], trunk: [1, 22], primary: [1, 20], secondary: [2, 17], tertiary: [2, 13],
  motorway_link: [3, 8], trunk_link: [3, 8], primary_link: [3, 8], secondary_link: [3, 8], tertiary_link: [3, 8],
  unclassified: [3, 9], residential: [3, 9], living_street: [3, 7], service: [4, 5],
  pedestrian: [5, 6], footway: [5, 3], path: [5, 2.5],
};
const ROAD_SKIP = /^(steps|corridor|elevator|platform|proposed|construction|bus_stop|cycleway|bridleway|track|raceway|abandoned|razed)$/;

/** What sort of building, for its look: 0 any, 1 office, 2 homes, 3 shops, 4 civic/religious, 5 utility. */
function typeCode(t) {
  if (/^(office|commercial|hotel)$/.test(t)) return 1;
  if (/^(apartments|residential|house|dormitory|terrace|detached)$/.test(t)) return 2;
  if (/^(retail|supermarket|kiosk)$/.test(t)) return 3;
  if (/^(church|cathedral|temple|shrine|chapel|mosque|synagogue|civic|government|public|museum|train_station|transportation|university|school|college|hospital|palace|gatehouse)$/.test(t)) return 4;
  if (/^(parking|garage|garages|industrial|warehouse|roof|service|construction)$/.test(t)) return 5;
  return 0;
}

function meters(v) {
  if (v === undefined) return undefined;
  const m = String(v).trim().match(/^(-?[\d.]+)\s*(m|ft|')?/);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return undefined;
  return m[2] === "ft" || m[2] === "'" ? n * 0.3048 : n;
}

function heightOf(tags) {
  const h = meters(tags.height) ?? meters(tags["building:height"]);
  const lv = parseFloat(tags["building:levels"]);
  const roofH = meters(tags["roof:height"]) ?? 0;
  let height = h;
  if (height === undefined && Number.isFinite(lv)) height = lv * LEVEL_H + roofH;
  let min = meters(tags.min_height);
  const minLv = parseFloat(tags["building:min_level"]);
  if (min === undefined && Number.isFinite(minLv)) min = minLv * LEVEL_H;
  return { height, min: min ?? 0 };
}

function colourOf(tags) {
  const c = tags["building:colour"] ?? tags.colour;
  if (!c) return 0;
  const named = { white: "#f2f2ee", grey: "#9a9a9a", gray: "#9a9a9a", beige: "#dccfb0", brown: "#8b6248", red: "#b5503c", tan: "#cfae86", yellow: "#e8cf6a", black: "#3a3a3a", silver: "#c4c8cc", blue: "#5878a8", green: "#5f8f65" };
  const hex = /^#[0-9a-f]{6}$/i.test(c) ? c : /^#[0-9a-f]{3}$/i.test(c) ? `#${[...c.slice(1)].map((h) => h + h).join("")}` : named[c.toLowerCase()];
  return hex ? parseInt(hex.slice(1), 16) : 0;
}

const dm = (v) => Math.round(v * 10);
const flat = (ring) => ring.flatMap(([x, z]) => [dm(x), dm(z)]);

async function load(city) {
  const raw = JSON.parse(await readFile(join(CACHE, `${city.id}.json`), "utf8"));
  const P = projector(city.origin ?? city.center);
  const geom = (g) => g.map((p) => P.xz(p.lat, p.lon));
  const ways = [], rels = [];
  for (const el of raw.elements) {
    if (el.type === "way" && el.geometry) ways.push({ ...el, pts: geom(el.geometry) });
    else if (el.type === "relation" && el.members) rels.push(el);
  }
  const relRings = (rel, role) => assembleRings(rel.members.filter((m) => m.type === "way" && m.role === role && m.geometry).map((m) => geom(m.geometry)));
  return { P, ways, rels, relRings, sources: raw.sources ?? ["OpenStreetMap"] };
}

/** Credit line for the data behind a city (Overture passes on its sources' terms). */
function attribution(sources) {
  const names = { "doi:10.5281/zenodo.8174931": "East Asian Buildings (Shi et al. 2023)" };
  const rest = sources.filter((s) => s !== "OpenStreetMap").map((s) => names[s] ?? s);
  return ["© OpenStreetMap contributors", "Overture Maps Foundation", ...rest].join(", ");
}

// ------------------------------------------------------------------ route
/** The ways of a named street, only its busiest class (side lanes and sidewalks share names). */
function roadNodes(ways, re) {
  const hits = ways.filter((w) => w.tags?.highway && ROAD[w.tags.highway] && (re.test(w.tags.name ?? "") || re.test(w.tags["name:en"] ?? "")));
  const top = Math.min(...hits.map((w) => ROAD[w.tags.highway][0]));
  return hits.filter((w) => ROAD[w.tags.highway][0] === top);
}

/** Middle of where two named streets meet (all carriageways). */
function crossing(ways, a, b) {
  const A = roadNodes(ways, a), B = roadNodes(ways, b);
  const keyed = new Map();
  for (const w of A) for (const p of w.geometry) keyed.set(`${p.lat},${p.lon}`, w.pts[w.geometry.indexOf(p)]);
  const hits = [];
  for (const w of B) w.geometry.forEach((p, i) => {
    if (keyed.has(`${p.lat},${p.lon}`)) hits.push(w.pts[i]);
  });
  if (!hits.length) throw new Error(`no crossing of ${a} and ${b}`);
  return [hits.reduce((s, p) => s + p[0], 0) / hits.length, hits.reduce((s, p) => s + p[1], 0) / hits.length];
}

/** Middle of a named street (all carriageways) where it crosses a line of latitude or longitude, optionally `near` a point. */
function onStreet(ways, re, { lat, lon, near }, P) {
  const hits = [];
  const [nx, nz] = near ? P.xz(near[0], near[1]) : [0, 0];
  for (const w of roadNodes(ways, re)) {
    for (let i = 0; i + 1 < w.geometry.length; i++) {
      const a = w.geometry[i], b = w.geometry[i + 1];
      const [ka, kb, v] = lon !== undefined ? [a.lon, b.lon, lon] : [a.lat, b.lat, lat];
      if ((ka - v) * (kb - v) > 0 || ka === kb) continue;
      const t = (v - ka) / (kb - ka);
      const p = [w.pts[i][0] + (w.pts[i + 1][0] - w.pts[i][0]) * t, w.pts[i][1] + (w.pts[i + 1][1] - w.pts[i][1]) * t];
      if (!near || Math.hypot(p[0] - nx, p[1] - nz) < 250) hits.push(p);
    }
  }
  if (!hits.length) throw new Error(`${re} doesn't reach ${lat ?? lon}`);
  return [hits.reduce((s, p) => s + p[0], 0) / hits.length, hits.reduce((s, p) => s + p[1], 0) / hits.length];
}

function resolvePoint(spec, ctx) {
  if (spec.cross) return crossing(ctx.ways, spec.cross[0], spec.cross[1]);
  if (spec.on) return onStreet(ctx.ways, spec.on, spec, ctx.P);
  if (spec.at) return ctx.P.xz(spec.at[0], spec.at[1]);
  throw new Error(`bad route point ${JSON.stringify(spec)}`);
}

function buildRoute(city, ctx) {
  const pts = city.route.map((p) => {
    const q = resolvePoint(p, ctx);
    return [q[0] + (p.shift?.[0] ?? 0), q[1] + (p.shift?.[1] ?? 0)];
  });
  // The start is pulled back along the first street so the perch sits at its end.
  const [a, b] = pts;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  if (city.startBack) {
    a[0] -= dir[0] * city.startBack;
    a[1] -= dir[1] * city.startBack;
  }
  const streets = city.route.slice(0, -1).map((p) => p.street);
  return { path: pts, streets, dir };
}

/** The roof the hero starts on: a block filling the street behind the start point. */
function perchRing(route, w, d) {
  const [sx, sz] = route.path[0];
  const [fx, fz] = route.dir;
  const rx = -fz, rz = fx;
  const front = 1.9;
  const corners = [
    [sx + fx * front - rx * w / 2, sz + fz * front - rz * w / 2],
    [sx + fx * front + rx * w / 2, sz + fz * front + rz * w / 2],
    [sx + fx * (front - d) + rx * w / 2, sz + fz * (front - d) + rz * w / 2],
    [sx + fx * (front - d) - rx * w / 2, sz + fz * (front - d) - rz * w / 2],
  ];
  return ringArea(corners) > 0 ? corners.reverse() : corners;
}

// ------------------------------------------------------------------ build
function closedRing(pts) {
  const r = pts.slice();
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  return r;
}

function cleanRing(pts, tol) {
  let r = simplifyRing(closedRing(pts), tol);
  if (r.length < 3) return null;
  if (ringArea(r) > 0) r = r.reverse();
  return r;
}

async function build(city) {
  const ctx = await load(city);
  const { ways, rels, relRings } = ctx;
  const route = buildRoute(city, ctx);
  const line = route.path;
  const near = (ring, max) => distToPolyline(...centroid(ring), line) < max;

  // ---- buildings and parts
  const outlines = [], parts = [];
  const addBuilding = (list, ring, tags, id) => {
    if (tags.location === "underground" || parseFloat(tags.layer) < 0 || tags["building"] === "no") return;
    const r = cleanRing(ring, 0.7);
    if (!r) return;
    const area = -ringArea(r) / 2;
    if (area < (list === parts ? 4 : 14)) return;
    if (area / perimeter(r) ** 2 < 0.006) return;
    if (!near(r, KEEP)) return;
    list.push({ ring: r, tags, id, area, ...heightOf(tags) });
  };
  for (const w of ways) {
    if (!w.tags) continue;
    if (w.tags["building:part"] && w.tags["building:part"] !== "no") addBuilding(parts, w.pts, w.tags, `w${w.id}`);
    else if (w.tags.building) addBuilding(outlines, w.pts, w.tags, `w${w.id}`);
  }
  for (const rel of rels) {
    if (!rel.tags) continue;
    const isPart = rel.tags["building:part"] && rel.tags["building:part"] !== "no";
    if (!isPart && !rel.tags.building) continue;
    for (const ring of relRings(rel, "outer")) addBuilding(isPart ? parts : outlines, ring, rel.tags, `r${rel.id}`);
  }
  // An outline mostly covered by parts is drawn by its parts.
  const byId = new Map(outlines.map((o) => [o.tags._id, o]));
  for (const o of outlines) o.partArea = 0;
  for (const p of parts) {
    const [cx, cz] = centroid(p.ring);
    let owner = p.tags._building ? byId.get(p.tags._building) : null;
    if (!owner) for (const o of outlines) if (insideRing(o.ring, cx, cz) && (!owner || o.area < owner.area)) owner = o;
    if (owner) {
      owner.partArea += p.area;
      p.owner = owner;
    }
  }
  const all = [...outlines.filter((o) => o.partArea < o.area * 0.5), ...parts];
  for (const p of parts) {
    if (p.height === undefined && p.owner?.height !== undefined) p.height = p.owner.height;
  }

  // Clear the flight corridor and the perch footprint.
  const perch = perchRing(route, city.perch?.w ?? 24, city.perch?.d ?? 30);
  const kept = [];
  let dropped = 0;
  for (const b of all) {
    const clearance = city.corridor ?? 9;
    const top = b.height ?? 10;
    if (top > 4 && ringToPolyline(b.ring, line) < clearance && b.min < 45) {
      dropped++;
      continue;
    }
    if (ringToPolyline(b.ring, [...perch, perch[0]]) < 0.5) {
      dropped++;
      continue;
    }
    kept.push(b);
  }

  // ---- landmarks named in the city spec
  const landmarks = [];
  const named = (b, re) => re.test(b.tags.name ?? "") || re.test(b.tags["name:en"] ?? "");
  for (const lm of city.landmarks ?? []) {
    if (lm.match) {
      const hits = kept.filter((b) => named(b, lm.match) || (b.owner && named(b.owner, lm.match)));
      if (!hits.length) {
        const any = [...outlines, ...parts].find((b) => named(b, lm.match));
        console.warn(`  ${city.id}: landmark ${lm.id} not found${any ? ` (dropped: ${any.id})` : ""}`);
        continue;
      }
      const top = hits.reduce((a, b) => ((b.height ?? 0) > (a.height ?? 0) ? b : a));
      const [x, z] = centroid(top.ring);
      for (const h of hits) h.landmark = lm.id;
      landmarks.push({ id: lm.id, x: dm(x), z: dm(z), y: dm(top.height ?? 0) });
    } else if (lm.at) {
      const [x, z] = ctx.P.xz(lm.at[0], lm.at[1]);
      landmarks.push({ id: lm.id, x: dm(x), z: dm(z), y: 0, yaw: lm.yaw ?? 0 });
    }
  }

  // ---- streets, rail, water, parks, plazas
  // Divided roads are mapped as two one-way carriageways with the same name a
  // few meters apart; each gets the spacing as its width so the pair spans the
  // real roadway instead of two full-width strips stacked on top of each other.
  const byName = new Map();
  for (const w of ways) {
    const t = w.tags ?? {};
    if (!t.name || !ROAD[t.highway] || ROAD[t.highway][0] > 3 || w.pts.length < 2) continue;
    if (!byName.has(t.name)) byName.set(t.name, []);
    byName.get(t.name).push(w);
  }
  const twinOf = (w) => {
    const pts = w.pts;
    const a = pts[0], b = pts[pts.length - 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 8) return null;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    const m = pts[Math.floor(pts.length / 2)];
    let best = null;
    for (const o of byName.get(w.tags.name) ?? []) {
      if (o === w) continue;
      for (let i = 0; i + 1 < o.pts.length; i++) {
        const [px, pz] = o.pts[i], [qx, qz] = o.pts[i + 1];
        const dx = qx - px, dz = qz - pz, l2 = dx * dx + dz * dz;
        if (l2 < 1) continue;
        const s = ((m[0] - px) * dx + (m[1] - pz) * dz) / l2;
        if (s <= 0 || s >= 1) continue;
        const l = Math.sqrt(l2);
        if (Math.abs((dx * ux + dz * uz) / l) < 0.9) continue;
        const fx = px + dx * s - m[0], fz = pz + dz * s - m[1];
        const d = Math.hypot(fx, fz);
        if (d < 5 || d > 35 || (best && d > best.d)) continue;
        // +1 when the twin lies to the right of travel, (-uz, ux).
        best = { d, side: fx * -uz + fz * ux > 0 ? 1 : -1 };
      }
    }
    return best;
  };
  const roads = [];
  for (const w of ways) {
    const t = w.tags ?? {};
    const hw = t.highway;
    if (!hw || ROAD_SKIP.test(hw) || t.area === "yes") continue;
    if (t.tunnel && t.tunnel !== "no") continue;
    if (t.covered === "yes" || parseFloat(t.layer) < 0) continue;
    if (hw === "footway" && (t.footway === "sidewalk" || t.footway === "crossing")) continue;
    const cls = ROAD[hw];
    if (!cls) continue;
    const pts = simplifyLine(w.pts, 0.5);
    if (pts.every((p) => distToPolyline(p[0], p[1], line) > ROAD_KEEP)) continue;
    let width = meters(t.width);
    const lanes = parseFloat(t.lanes);
    if (width === undefined && Number.isFinite(lanes) && cls[0] <= 3) width = lanes * 3.3 * (t.oneway === "yes" ? 1.15 : 1);
    width = Math.min(Math.max(width ?? cls[1] * (cls[0] <= 2 ? city.roadScale ?? 1 : 1), 2), 48);
    const twin = t.name && cls[0] <= 3 ? twinOf(w) : null;
    if (twin) width = Math.min(width, Math.max(twin.d, 6));
    roads.push([cls[0], dm(width), pts.flatMap(([x, z]) => [dm(x), dm(z)]), twin?.side ?? 0]);
  }
  const areas = [];
  const addArea = (kind, ring) => {
    const r = cleanRing(ring, 0.8);
    if (!r || -ringArea(r) / 2 < 30) return;
    if (r.every((p) => distToPolyline(p[0], p[1], line) > ROAD_KEEP)) return;
    areas.push([kind, flat(r)]);
  };
  const areaKind = (t) => {
    if (t.natural === "water" || t.waterway === "riverbank") return 2;
    if (/^(park|garden|pitch)$/.test(t.leisure ?? "") || /^(grass|recreation_ground|village_green)$/.test(t.landuse ?? "")) return 1;
    if (t.place === "square" || t["area:highway"] || (t.highway === "pedestrian" && t.area === "yes")) return 3;
    return 0;
  };
  for (const w of ways) {
    const t = w.tags ?? {};
    const kind = areaKind(t);
    if (!kind || w.pts.length < 4) continue;
    const g = w.geometry;
    if (g[0].lat !== g[g.length - 1].lat || g[0].lon !== g[g.length - 1].lon) continue;
    addArea(kind, w.pts);
  }
  for (const rel of rels) {
    const kind = areaKind(rel.tags ?? {});
    if (kind) for (const ring of relRings(rel, "outer")) addArea(kind, ring);
  }
  const lines = [];
  for (const w of ways) {
    const t = w.tags ?? {};
    if (t.tunnel && t.tunnel !== "no") continue;
    let kind = 0, width = 0;
    if (/^(river|stream|canal)$/.test(t.waterway ?? "")) {
      kind = 1;
      width = meters(t.width) ?? (t.waterway === "river" ? 30 : t.waterway === "canal" ? 10 : 6);
    } else if (t.railway === "rail" && !(parseFloat(t.layer) < 0)) {
      kind = 2;
      width = 4.2;
    }
    if (!kind) continue;
    const pts = simplifyLine(w.pts, 0.8);
    if (pts.every((p) => distToPolyline(p[0], p[1], line) > ROAD_KEEP)) continue;
    lines.push([kind, dm(width), pts.flatMap(([x, z]) => [dm(x), dm(z)])]);
  }

  // ---- write
  const missing = kept.filter((b) => b.height === undefined).length;
  const out = {
    id: city.id,
    attribution: attribution(ctx.sources),
    sources: ctx.sources,
    license: "ODbL-1.0 (https://opendatacommons.org/licenses/odbl/1-0/); derived from OpenStreetMap via Overture Maps by tools/osm/build.mjs",
    origin: city.origin ?? city.center,
    units: "decimeters, +x east, +z south",
    route: {
      path: route.path.map(([x, z]) => [dm(x), dm(z)]),
      streets: route.streets,
      perch: flat(perch),
    },
    landmarks,
    // [height or -1 if unknown, min height, type, colour (0 none), landmark id or "", ring]
    buildings: kept.map((b) => [b.height === undefined ? -1 : dm(b.height), dm(b.min), typeCode(b.tags.building ?? b.tags["building:part"] ?? ""), colourOf(b.tags), b.landmark ?? "", flat(b.ring)]),
    // [class 1 major … 5 pedestrian, width, polyline, side of the other carriageway (0 undivided, +1 right of travel, -1 left)]
    roads,
    // [1 park, 2 water, 3 plaza, ring]
    areas,
    // [1 waterway, 2 rail, width, polyline]
    lines,
  };
  await mkdir(OUT, { recursive: true });
  const text = JSON.stringify(out);
  await writeFile(join(OUT, `${city.id}.json`), text);
  const routeLen = line.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0);
  console.log(
    `${city.id}: ${kept.length} buildings (${missing} without heights, ${dropped} cleared from the route), ${roads.length} roads, ` +
      `${areas.length} areas, ${lines.length} lines, route ${routeLen.toFixed(0)} m, ${(text.length / 1024).toFixed(0)} KB`,
  );
}

// ------------------------------------------------------------------ explore
async function explore(city) {
  const { ways, P } = await load({ ...city, origin: city.center });
  const streets = new Map();
  for (const w of ways) {
    const t = w.tags ?? {};
    if (!t.highway || !t.name || !ROAD[t.highway] || ROAD[t.highway][0] > 3) continue;
    const len = w.pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - w.pts[i][0], p[1] - w.pts[i][1]), 0);
    const k = `${t.name}${t["name:en"] ? ` / ${t["name:en"]}` : ""} [${t.highway}]`;
    streets.set(k, (streets.get(k) ?? 0) + len);
  }
  console.log("streets (m):");
  for (const [k, v] of [...streets].sort((a, b) => b[1] - a[1]).slice(0, 45)) console.log(`  ${v.toFixed(0).padStart(5)}  ${k}`);
  const tall = [];
  for (const w of ways) {
    const t = w.tags ?? {};
    if (!t.building && !t["building:part"]) continue;
    const { height } = heightOf(t);
    if ((height ?? 0) < 60 && !t.name) continue;
    const [x, z] = centroid(closedRing(w.pts));
    const [lat, lon] = P.latLon(x, z);
    tall.push({ h: height ?? -1, name: t.name ?? "", en: t["name:en"] ?? "", lat, lon, part: !!t["building:part"] });
  }
  tall.sort((a, b) => b.h - a.h);
  console.log("tall or named buildings:");
  for (const b of tall.slice(0, 60)) console.log(`  ${b.h.toFixed(0).padStart(4)} m ${b.part ? "part " : ""}${b.name}${b.en ? ` / ${b.en}` : ""}  ${b.lat.toFixed(5)},${b.lon.toFixed(5)}`);
  const heights = ways.filter((w) => w.tags?.building);
  const withH = heights.filter((w) => heightOf(w.tags).height !== undefined).length;
  console.log(`${heights.length} building outlines, ${withH} with a height or levels`);
}

const args = process.argv.slice(2);
if (args[0] === "--explore") {
  const city = CITIES.find((c) => c.id === args[1]);
  if (!city) throw new Error(`unknown city ${args[1]}`);
  await explore(city);
} else {
  for (const city of CITIES) {
    if (args.length && !args.includes(city.id)) continue;
    if (!city.route) {
      console.warn(`${city.id}: no route yet`);
      continue;
    }
    await build(city);
  }
}
