// "Downtown" — the first compact City Crawlers section. Units are meters; three.js
// axes: +x east, +y up, +z south (north is -z). Everything here is data, so the
// same builder can later take layouts generated from OpenStreetMap.

export type Avenue = { x: number; w: number; name: string; z0: number; z1: number };
export type Street = { z: number; w: number; name: string; x0: number; x1: number; canal?: boolean };

export const BOUNDS = { x0: -200, x1: 440, z0: -800, z1: 150 };
export const SIDEWALK = 4;

// Roads run to the waterfront except Main Ave (ends at the start rooftop) and
// Tower Ave (ends at Crawler Tower), which turns those blocks into set pieces.
export const AVENUES: Avenue[] = [
  { x: -130, w: 20, name: "West Ave", z0: -800, z1: 150 },
  { x: 0, w: 28, name: "Main Ave", z0: -800, z1: 80 },
  { x: 120, w: 20, name: "Harbor Ave", z0: -800, z1: 150 },
  { x: 250, w: 22, name: "Tower Ave", z0: -620, z1: 150 },
  { x: 370, w: 20, name: "East Ave", z0: -800, z1: 150 },
];

export const STREETS: Street[] = [
  { z: 80, w: 18, name: "1st St", x0: -200, x1: 440 },
  { z: -40, w: 18, name: "2nd St", x0: -200, x1: 440 },
  { z: -160, w: 18, name: "3rd St", x0: -200, x1: 440 },
  { z: -280, w: 18, name: "4th St", x0: -200, x1: 440 },
  { z: -380, w: 30, name: "Canal St", x0: -200, x1: 440, canal: true },
  { z: -500, w: 18, name: "6th St", x0: -200, x1: 440 },
  { z: -620, w: 18, name: "7th St", x0: -200, x1: 440 },
  { z: -740, w: 18, name: "8th St", x0: -200, x1: 440 },
];

export const CANAL = { z: -380, halfWidth: 6, waterY: -1.7 };

/** True over the bay or the canal (avenue bridges are solid). */
export function isWater(x: number, z: number) {
  if (x < BOUNDS.x0 || x > BOUNDS.x1 || z < BOUNDS.z0 || z > BOUNDS.z1) return true;
  if (Math.abs(z - CANAL.z) >= CANAL.halfWidth) return false;
  return !AVENUES.some((a) => CANAL.z >= a.z0 && CANAL.z <= a.z1 && Math.abs(x - a.x) < a.w / 2 + 2);
}

/** The route centerline (ground plane). Segments get harder as you go. */
export const ROUTE: Array<[number, number]> = [
  [0, 96],
  [0, -380],
  [250, -380],
  [250, -612],
];

export const START = { x: 0, y: 34, z: 94.9, yaw: 0 };

export type Zone = { kind: "start" | "plaza" | "park" | "tower" | "construction"; x0: number; z0: number; x1: number; z1: number };

export const ZONES: Zone[] = [
  { kind: "start", x0: -26, z0: 93, x1: 26, z1: 131 },
  { kind: "plaza", x0: 18, z0: -361, x1: 106, z1: -293 },
  { kind: "park", x0: 134, z0: -147, x1: 235, z1: -53 },
  { kind: "tower", x0: 210, z0: -722, x1: 290, z1: -633 },
  { kind: "construction", x0: 138, z0: -432, x1: 168, z1: -399 },
];

export type HoopDef = { x: number; y: number; z: number; yaw: number; r: number };

const N = 0; // facing north/south
const E = Math.PI / 2; // facing east/west
const NE = Math.PI / 4;

// Hoops sit in the natural swing band (~20-32 m); obstacles force the exceptions.
export const HOOPS: HoopDef[] = [
  // Segment 1 — Main Ave: big hoops on the natural swing line.
  { x: 0, y: 26, z: 30, yaw: N, r: 4.6 },
  { x: -3, y: 24, z: -32, yaw: N, r: 4.4 },
  { x: 3, y: 26, z: -96, yaw: N, r: 4.2 },
  // Under the high banner at z -130.
  { x: 0, y: 24, z: -172, yaw: N, r: 4.2 },
  // Over the low banner at z -255.
  { x: -4, y: 28, z: -226, yaw: N, r: 4.0 },
  { x: 4, y: 26, z: -292, yaw: N, r: 4.0 },
  { x: 2, y: 27, z: -340, yaw: N, r: 4.0 },
  // Corner onto Canal St.
  { x: 11, y: 27, z: -366, yaw: NE, r: 4.6 },
  // Segment 2 — Canal St: skim over one skybridge, dive under the next.
  { x: 50, y: 25, z: -378, yaw: E, r: 3.8 },
  { x: 92, y: 26.5, z: -382, yaw: E, r: 3.6 },
  { x: 136, y: 28, z: -377, yaw: E, r: 3.6 },
  { x: 184, y: 23, z: -383, yaw: E, r: 3.6 },
  { x: 222, y: 26, z: -378, yaw: E, r: 3.4 },
  // Corner onto Tower Ave.
  { x: 239, y: 27, z: -386, yaw: NE, r: 4.4 },
  // Segment 3 — Tower Ave canyon: small hoops, tight timing.
  { x: 253, y: 24, z: -424, yaw: N, r: 3.4 },
  { x: 247, y: 28, z: -470, yaw: N, r: 3.2 },
  { x: 253, y: 21, z: -508, yaw: N, r: 3.2 },
  { x: 249, y: 30, z: -545, yaw: N, r: 3.2 },
  { x: 246, y: 25, z: -578, yaw: N, r: 3.2 },
];

export const FINISH: HoopDef = { x: 250, y: 27, z: -610, yaw: N, r: 5.6 };

export type CheckpointDef = { afterHoop: number; x: number; y: number; z: number; yaw: number };

/** Respawn points: in the air, moving down the route, ready to web. */
export const CHECKPOINTS: CheckpointDef[] = [
  { afterHoop: -1, x: 0, y: 32, z: 70, yaw: 0 },
  { afterHoop: 7, x: 24, y: 34, z: -380, yaw: -Math.PI / 2 },
  { afterHoop: 13, x: 250, y: 27, z: -404, yaw: 0 },
];

export type BannerDef = { x0: number; x1: number; z0: number; z1: number; y: number; h: number };

export const BANNERS: BannerDef[] = [
  { x0: -18, x1: 18, z0: -131, z1: -129.4, y: 31, h: 3.4 }, // go under
  { x0: -18, x1: 18, z0: -256, z1: -254.4, y: 19, h: 3.4 }, // go over
  { x0: 235, x1: 265, z0: -490, z1: -488.4, y: 26, h: 3.4 }, // pick a side of it
];

export type SkybridgeDef = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };

export const SKYBRIDGES: SkybridgeDef[] = [
  { x0: 88.5, x1: 95.5, y0: 16, y1: 21, z0: -400, z1: -360 },
  { x0: 180.5, x1: 187.5, y0: 28, y1: 33, z0: -400, z1: -360 },
  { x0: 234, x1: 266, y0: 30, y1: 34, z0: -448, z1: -442 },
];

export const CRANE = { x: 152, z: -416, rotY: -Math.PI / 2, scale: 0.8 };

export const BLIMP = { z: -522, y: 46, x0: 205, x1: 300, speed: 5.5 };

/** Lots near these points are forced tall so every obstacle has walls to hang on. */
export const MIN_HEIGHT_POINTS: Array<{ x: number; z: number; h: number }> = [
  { x: 92, z: -404, h: 46 },
  { x: 92, z: -356, h: 46 },
  { x: 184, z: -404, h: 50 },
  { x: 184, z: -356, h: 50 },
  { x: 232, z: -445, h: 60 },
  { x: 268, z: -445, h: 60 },
];
