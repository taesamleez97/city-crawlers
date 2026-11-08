"""Downloads one city's area from the Overture Maps release on S3 (OpenStreetMap
buildings and streets, with heights merged in) and writes it in the element shape
build.mjs reads.  Run through fetch.mjs:  python fetch_overture.py <out.json> S W N E
"""

import json
import sys
import time

import duckdb

RELEASE = "s3://overturemaps-us-west-2/release/2026-10-21.0"

out_path = sys.argv[1]
S, W, N, E = (float(v) for v in sys.argv[2:6])

con = duckdb.connect()
for ext in ("httpfs", "spatial"):
    con.execute(f"INSTALL {ext}; LOAD {ext};")
con.execute("SET s3_region='us-west-2';")

BBOX = f"bbox.xmin <= {E} AND bbox.xmax >= {W} AND bbox.ymin <= {N} AND bbox.ymax >= {S}"


def rows(theme, cols):
    t0 = time.time()
    q = f"SELECT {cols}, ST_AsGeoJSON(geometry) AS g FROM read_parquet('{RELEASE}/theme={theme}/*', hive_partitioning=1) WHERE {BBOX}"
    res = con.execute(q)
    names = [d[0] for d in res.description]
    data = [dict(zip(names, r)) for r in res.fetchall()]
    print(f"  {theme}: {len(data)} in {time.time() - t0:.0f} s", flush=True)
    return data


def rings(g):
    """Exterior rings of a (multi)polygon as [{lat, lon}] lists."""
    geo = json.loads(g)
    polys = [geo["coordinates"]] if geo["type"] == "Polygon" else geo["coordinates"] if geo["type"] == "MultiPolygon" else []
    return [[{"lat": p[1], "lon": p[0]} for p in poly[0]] for poly in polys if poly]


def line(g):
    geo = json.loads(g)
    if geo["type"] == "LineString":
        return [[{"lat": p[1], "lon": p[0]} for p in geo["coordinates"]]]
    if geo["type"] == "MultiLineString":
        return [[{"lat": p[1], "lon": p[0]} for p in part] for part in geo["coordinates"]]
    return []


def whole(flags, name):
    """A flag set for the full length of a segment (partial bridges and tunnels are ignored)."""
    return any(name in (f["values"] or []) and not f["between"] for f in (flags or []))


elements = []
sources = set()


def add(kind, oid, pts, tags):
    tags = {k: str(v) for k, v in tags.items() if v is not None and v != ""}
    elements.append({"type": "way", "id": f"{oid}:{len(elements)}", "geometry": pts, "tags": tags})


def name_tags(r):
    n = r.get("names") or {}
    common = n.get("common") or {}
    return {"name": n.get("primary"), "name:en": common.get("en")}


def note_sources(r):
    for s in r.get("sources") or []:
        if s.get("dataset"):
            sources.add(s["dataset"])


BUILDING_COLS = "id, names, sources, height, min_height, num_floors, min_floor, is_underground, facade_color, roof_shape"
for r in rows("buildings/type=building", BUILDING_COLS + ", subtype, class, has_parts"):
    note_sources(r)
    tags = {
        "building": r["class"] or r["subtype"] or "yes", "height": r["height"], "min_height": r["min_height"],
        "building:levels": r["num_floors"], "building:min_level": r["min_floor"], "building:colour": r["facade_color"],
        "roof:shape": r["roof_shape"], "location": "underground" if r["is_underground"] else None,
        "_id": r["id"], "_has_parts": "yes" if r["has_parts"] else None, **name_tags(r),
    }
    for ring in rings(r["g"]):
        add("building", r["id"], ring, tags)

for r in rows("buildings/type=building_part", BUILDING_COLS + ", building_id"):
    note_sources(r)
    tags = {
        "building:part": "yes", "height": r["height"], "min_height": r["min_height"], "building:levels": r["num_floors"],
        "building:min_level": r["min_floor"], "building:colour": r["facade_color"], "roof:shape": r["roof_shape"],
        "location": "underground" if r["is_underground"] else None, "_building": r["building_id"], **name_tags(r),
    }
    for ring in rings(r["g"]):
        add("part", r["id"], ring, tags)

ROAD_CLASS = {"unknown": "unclassified"}
for r in rows("transportation/type=segment", "id, names, sources, subtype, class, road_flags, rail_flags, width_rules"):
    note_sources(r)
    whole_width = next((w["value"] for w in (r["width_rules"] or []) if not w["between"]), None)
    if r["subtype"] == "road":
        tags = {
            "highway": ROAD_CLASS.get(r["class"], r["class"]), "width": whole_width,
            "tunnel": "yes" if whole(r["road_flags"], "is_tunnel") else None,
            "covered": "yes" if whole(r["road_flags"], "is_covered") else None, **name_tags(r),
        }
    elif r["subtype"] == "rail" and r["class"] in ("standard_gauge", "narrow_gauge", "light_rail"):
        tags = {"railway": "rail", "tunnel": "yes" if whole(r["rail_flags"], "is_tunnel") else None}
    else:
        continue
    for pts in line(r["g"]):
        add("road", r["id"], pts, tags)

for r in rows("base/type=water", "id, names, sources, subtype, class, source_tags"):
    note_sources(r)
    st = r["source_tags"] or {}
    if st.get("tunnel") in ("yes", "culvert") or st.get("location") == "underground":
        continue
    geo_type = json.loads(r["g"])["type"]
    if geo_type in ("Polygon", "MultiPolygon"):
        for ring in rings(r["g"]):
            add("water", r["id"], ring, {"natural": "water", **name_tags(r)})
    elif r["subtype"] in ("river", "stream", "canal") or r["class"] in ("river", "stream", "canal"):
        for pts in line(r["g"]):
            add("water", r["id"], pts, {"waterway": r["class"] if r["class"] in ("river", "stream", "canal") else r["subtype"], "width": st.get("width"), **name_tags(r)})

PARK = {"park", "garden", "grass", "recreation_ground", "village_green", "pitch", "dog_park", "playground"}
PLAZA = {"plaza", "pedestrian"}
for r in rows("base/type=land_use", "id, names, sources, subtype, class"):
    note_sources(r)
    cls = r["class"] or ""
    if cls in PARK or r["subtype"] == "park":
        tags = {"leisure": "park"}
    elif cls in PLAZA or r["subtype"] == "pedestrian":
        tags = {"place": "square"}
    else:
        continue
    for ring in rings(r["g"]):
        add("land", r["id"], ring, {**tags, **name_tags(r)})

with open(out_path, "w") as f:
    json.dump({"generator": "city-crawlers tools/osm/fetch_overture.py", "release": RELEASE, "sources": sorted(sources), "elements": elements}, f)
print(f"  {len(elements)} elements; sources: {', '.join(sorted(sources))}", flush=True)
