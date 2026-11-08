// Small geometry helpers for the city build (local meters: +x east, +z south).

const R = 6378137;

/** Local east/south meters around an origin: fine at city scale, unlike Web Mercator. */
export function projector([lat0, lon0]) {
  const k = Math.PI / 180;
  const cos = Math.cos(lat0 * k);
  return {
    xz: (lat, lon) => [R * (lon - lon0) * k * cos, -R * (lat - lat0) * k],
    latLon: (x, z) => [lat0 - z / (R * k), lon0 + x / (R * k * cos)],
  };
}

/** Twice the signed area: negative = counter-clockwise seen from above with north up (the game's winding). */
export function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a;
}

export function centroid(ring) {
  let x = 0, z = 0, a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    x += (ring[j][0] + ring[i][0]) * f;
    z += (ring[j][1] + ring[i][1]) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) return ring[0];
  return [x / (3 * a), z / (3 * a)];
}

export function perimeter(ring) {
  let p = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) p += Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]);
  return p;
}

export function insideRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function distToPolyline(px, pz, line) {
  let d = Infinity;
  for (let i = 0; i + 1 < line.length; i++) d = Math.min(d, distToSegment(px, pz, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]));
  return d;
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/** Closest approach between a closed ring and an open polyline (0 if they touch or the line enters it). */
export function ringToPolyline(ring, line) {
  let d = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    d = Math.min(d, distToPolyline(ring[i][0], ring[i][1], line));
    for (let k = 0; k + 1 < line.length; k++) {
      if (segmentsCross(ring[j], ring[i], line[k], line[k + 1])) return 0;
      d = Math.min(d, distToSegment(line[k][0], line[k][1], ring[j][0], ring[j][1], ring[i][0], ring[i][1]));
    }
  }
  for (const p of line) if (insideRing(ring, p[0], p[1])) return 0;
  return d;
}

/** Douglas–Peucker on an open polyline. */
export function simplifyLine(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Douglas–Peucker on a closed ring (no repeated end point). */
export function simplifyRing(ring, tol) {
  if (ring.length <= 4) return ring.slice();
  // Split at the point farthest from the first so both halves are well conditioned.
  let far = 0, fd = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const a = simplifyLine(ring.slice(0, far + 1), tol);
  const b = simplifyLine([...ring.slice(far), ring[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Joins way pieces that share end points into closed rings. */
export function assembleRings(pieces) {
  const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const open = pieces.map((p) => p.slice()).filter((p) => p.length >= 2);
  const rings = [];
  while (open.length) {
    let ring = open.pop();
    let guard = 0;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 500) {
      const end = key(ring[ring.length - 1]);
      const i = open.findIndex((p) => key(p[0]) === end || key(p[p.length - 1]) === end);
      if (i < 0) break;
      const next = open.splice(i, 1)[0];
      ring = ring.concat(key(next[0]) === end ? next.slice(1) : next.reverse().slice(1));
    }
    if (ring.length >= 4 && key(ring[0]) === key(ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}
