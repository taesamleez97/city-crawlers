import { Vector3 } from "three";

export type ColliderKind = "building" | "obstacle" | "prop";

export interface Collider {
  min: Vector3;
  max: Vector3;
  kind: ColliderKind;
  /** Webs can stick to it. */
  anchor: boolean;
  id: number;
  dynamic?: boolean;
}

export type RayHit = { point: Vector3; normal: Vector3; dist: number; collider: Collider };
export type Contact = { normal: Vector3; depth: number; collider: Collider };

const CELL = 40;
const key = (cx: number, cz: number) => (cx + 1024) * 4096 + (cz + 1024);

/** Static AABBs in a uniform XZ hash plus a short list of moving ones. */
export class CollisionWorld {
  private readonly grid = new Map<number, Collider[]>();
  private readonly dynamicColliders: Collider[] = [];
  readonly all: Collider[] = [];
  private stamp = 0;
  private readonly seen = new Map<Collider, number>();

  add(min: Vector3, max: Vector3, kind: ColliderKind, anchor: boolean, dynamic = false): Collider {
    const c: Collider = { min: min.clone(), max: max.clone(), kind, anchor, id: this.all.length, dynamic };
    this.all.push(c);
    if (dynamic) {
      this.dynamicColliders.push(c);
      return c;
    }
    for (let cx = Math.floor(c.min.x / CELL); cx <= Math.floor(c.max.x / CELL); cx++) {
      for (let cz = Math.floor(c.min.z / CELL); cz <= Math.floor(c.max.z / CELL); cz++) {
        const k = key(cx, cz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(c);
      }
    }
    return c;
  }

  /** Visits each collider overlapping the XZ rectangle exactly once. */
  forEachIn(x0: number, z0: number, x1: number, z1: number, fn: (c: Collider) => void) {
    const s = ++this.stamp;
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const list = this.grid.get(key(cx, cz));
        if (!list) continue;
        for (const c of list) {
          if (this.seen.get(c) === s) continue;
          this.seen.set(c, s);
          fn(c);
        }
      }
    }
    for (const c of this.dynamicColliders) fn(c);
  }

  raycast(origin: Vector3, dir: Vector3, maxDist: number, anchorOnly = false): RayHit | null {
    const end = origin.clone().addScaledVector(dir, maxDist);
    let best: RayHit | null = null;
    const inv = new Vector3(1 / dir.x, 1 / dir.y, 1 / dir.z);
    this.forEachIn(
      Math.min(origin.x, end.x), Math.min(origin.z, end.z),
      Math.max(origin.x, end.x), Math.max(origin.z, end.z),
      (c) => {
        if (anchorOnly && !c.anchor) return;
        const hit = rayBox(origin, inv, c.min, c.max);
        if (!hit || hit.t > maxDist || hit.t < 0) return;
        if (!best || hit.t < best.dist) {
          best = {
            dist: hit.t,
            point: origin.clone().addScaledVector(dir, hit.t),
            normal: hit.normal,
            collider: c,
          };
        }
      },
    );
    return best;
  }

  sphereContacts(center: Vector3, r: number, out: Contact[]): Contact[] {
    out.length = 0;
    this.forEachIn(center.x - r, center.z - r, center.x + r, center.z + r, (c) => {
      const px = Math.max(c.min.x, Math.min(center.x, c.max.x));
      const py = Math.max(c.min.y, Math.min(center.y, c.max.y));
      const pz = Math.max(c.min.z, Math.min(center.z, c.max.z));
      const dx = center.x - px, dy = center.y - py, dz = center.z - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r) return;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        out.push({ normal: new Vector3(dx / d, dy / d, dz / d), depth: r - d, collider: c });
      } else {
        // Center inside the box: push out along the shallowest axis.
        const opts: Array<[number, Vector3]> = [
          [center.x - c.min.x, new Vector3(-1, 0, 0)], [c.max.x - center.x, new Vector3(1, 0, 0)],
          [center.y - c.min.y, new Vector3(0, -1, 0)], [c.max.y - center.y, new Vector3(0, 1, 0)],
          [center.z - c.min.z, new Vector3(0, 0, -1)], [c.max.z - center.z, new Vector3(0, 0, 1)],
        ];
        opts.sort((a, b) => a[0] - b[0]);
        out.push({ normal: opts[0][1], depth: opts[0][0] + r, collider: c });
      }
    });
    return out;
  }
}

function rayBox(o: Vector3, inv: Vector3, min: Vector3, max: Vector3): { t: number; normal: Vector3 } | null {
  let tmin = -Infinity, tmax = Infinity;
  let axis = -1, sign = 0;
  const lo = [min.x, min.y, min.z], hi = [max.x, max.y, max.z];
  const oo = [o.x, o.y, o.z], ii = [inv.x, inv.y, inv.z];
  for (let a = 0; a < 3; a++) {
    if (!isFinite(ii[a])) {
      if (oo[a] < lo[a] || oo[a] > hi[a]) return null;
      continue;
    }
    let t1 = (lo[a] - oo[a]) * ii[a];
    let t2 = (hi[a] - oo[a]) * ii[a];
    let s = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = a;
      sign = s;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmin < 0 || axis < 0) return null;
  const n = new Vector3();
  n.setComponent(axis, sign);
  return { t: tmin, normal: n };
}
