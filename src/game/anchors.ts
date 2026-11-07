import { Vector3 } from "three";

import { TUNING } from "../config";
import type { CollisionWorld } from "../world/collision";

export type AnchorCandidate = { point: Vector3; normal: Vector3; dist: number; side: number; score: number };

const ELEVATIONS = [34, 47, 60, 72].map((d) => (d * Math.PI) / 180);
const YAWS = [-44, -26, -10, 10, 26, 44].map((d) => (d * Math.PI) / 180);
const dir = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * Auto-targeting for a couch: no aiming stick, so the game picks the web point.
 * Casts a fan of rays up and ahead, then scores hits by how good a swing they make.
 * `steer` biases the fan toward the side the player is leaning.
 */
export function findAnchor(
  world: CollisionWorld,
  pos: Vector3,
  heading: Vector3,
  steer: number,
  nextHoop: Vector3 | null,
): AnchorCandidate | null {
  const right = new Vector3().crossVectors(heading, UP).normalize();
  let best: AnchorCandidate | null = null;
  for (const elev of ELEVATIONS) {
    for (const yaw0 of YAWS) {
      const yaw = yaw0 + steer * 0.22; // positive yaw = to the player's right
      const c = Math.cos(yaw), s = Math.sin(yaw);
      // Rotate heading around Y by yaw, then tilt up by elev.
      const hx = heading.x * c - heading.z * s;
      const hz = heading.x * s + heading.z * c;
      dir.set(hx * Math.cos(elev), Math.sin(elev), hz * Math.cos(elev)).normalize();
      const hit = world.raycast(pos, dir, TUNING.anchorMaxDist, true);
      if (!hit || hit.dist < TUNING.anchorMinDist) continue;
      const rise = hit.point.y - pos.y;
      if (rise < TUNING.anchorMinRise) continue;

      const lateral = new Vector3().subVectors(hit.point, pos).dot(right);
      let score = 0;
      score -= Math.abs(hit.dist - TUNING.anchorIdealDist) / 26;
      score -= Math.abs(elev - 0.86) * 0.9;
      // Prefer the side the player leans to; mildly prefer alternating sides.
      score -= Math.abs(yaw0 / 0.77 - steer * 0.9) * 0.45;
      // Undersides (skybridges, banners) make dead, tiny swings.
      if (hit.normal.y < -0.5) score -= 2.5;
      // A wall squarely ahead would swing us into it.
      if (hit.normal.dot(heading) < -0.8) score -= hit.dist < 40 ? 1.2 : 0.5;
      // Swing bottom should clear the street.
      const bottom = hit.point.y - hit.dist * TUNING.ropeCatch;
      if (bottom < 10) score -= (10 - bottom) * 0.1;
      // Gentle hoop assist: favor anchors whose swing passes the next hoop's height.
      if (nextHoop) {
        const toHoop = new Vector3().subVectors(nextHoop, pos);
        const ahead = toHoop.dot(heading);
        if (ahead > 8 && ahead < 70) {
          score -= Math.abs(bottom - nextHoop.y) * 0.06;
          const anchorAhead = new Vector3().subVectors(hit.point, pos).dot(heading);
          score -= Math.abs(anchorAhead - ahead) * 0.012;
        }
      }
      if (!best || score > best.score) {
        best = { point: hit.point, normal: hit.normal, dist: hit.dist, side: Math.sign(lateral) || 1, score };
      }
    }
  }
  return best;
}
