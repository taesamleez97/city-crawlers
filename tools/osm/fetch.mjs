// Downloads each city's play area into tools/osm/cache (not committed):
//   node tools/osm/fetch.mjs [city…]
//
// The data is OpenStreetMap's buildings and streets as packaged by Overture Maps
// (which merges in building heights and publishes bbox-queryable files on S3), read
// with DuckDB from a local venv:
//   python3 -m venv tools/osm/.venv && tools/osm/.venv/bin/pip install duckdb
//
// © OpenStreetMap contributors (ODbL 1.0) and Overture Maps Foundation.

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CITIES } from "./cities.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = join(here, "cache");

export function bboxOf(city) {
  const [lat, lon] = city.center;
  const r = city.radius;
  const dLat = r / 111_320;
  const dLon = r / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
}

const wanted = process.argv.slice(2);
mkdirSync(CACHE, { recursive: true });
for (const city of CITIES) {
  if (wanted.length && !wanted.includes(city.id)) continue;
  console.log(`${city.id}:`);
  const args = [join(here, "fetch_overture.py"), join(CACHE, `${city.id}.json`), ...bboxOf(city).map((v) => v.toFixed(6))];
  const res = spawnSync(join(here, ".venv/bin/python"), args, { stdio: "inherit" });
  if (res.status !== 0) throw new Error(`${city.id}: fetch failed`);
}
