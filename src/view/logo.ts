// The City Crawlers logo: CITY stacked over CRAWLERS in Bungee, each letter a chunky
// block with a deep ink extrusion, tilted up to the right, in front of a blocky
// skyline with a landmark from every city in the game (N Seoul Tower on Namsan,
// the Empire State Building, Tokyo Tower, and LA's US Bank Tower among palms),
// and a comic-book web spun across the sky behind it all.
//
// Built as one inline SVG so it stays sharp at any size; the art is drawn in a
// 1280-wide box and the CSS sizes it. Its parts carry classes for the intro to
// animate: lg-web, lg-sun, lg-cloud, lg-b (each building), lg-crawlers, lg-city.

import { mulberry32 } from "../core/math";

const INK = "#1d2244";
const W = 1280;
const TOP = 96;
const H = 710;
const CX = W / 2;
/** The whole logo leans up to the right (degrees). */
const TILT = -5;
/** Letter extrusion, down and a little right. */
const DEPTH_X = 8;
const DEPTH_Y = 28;
/** Ink outline around every letter (twice the visible width). */
const LETTER_STROKE = 22;
/** Buildings show their right side and their roof. */
const SIDE_X = 14;
const SIDE_Y = -9;
const LINE = 5;
/** Building bottoms: always hidden behind CRAWLERS. */
const GROUND = 660;

let instances = 0;

type Pt = [number, number];

function mix(a: string, b: string, k: number) {
  const p = parseInt(a.slice(1), 16), q = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((p >> s) & 255) * (1 - k) + ((q >> s) & 255) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}
const side = (c: string) => mix(c, INK, 0.32);
const roof = (c: string) => mix(c, "#ffffff", 0.3);

const poly = (pts: Pt[], fill: string) => `<polygon points="${pts.map(([x, y]) => `${x},${y}`).join(" ")}" fill="${fill}"/>`;
const rect = (x: number, y: number, w: number, h: number, fill: string) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/** A box seen from the front, with its right side and roof showing. */
function block(x: number, top: number, w: number, bottom: number, color: string) {
  return (
    poly([[x + w, top], [x + w + SIDE_X, top + SIDE_Y], [x + w + SIDE_X, bottom + SIDE_Y], [x + w, bottom]], side(color)) +
    poly([[x, top], [x + SIDE_X, top + SIDE_Y], [x + w + SIDE_X, top + SIDE_Y], [x + w, top]], roof(color)) +
    rect(x, top, w, bottom - top, color)
  );
}

/** A grid of windows on a front face, a few of them lit. */
function windows(x: number, top: number, w: number, bottom: number, color: string, rng: () => number, size: Pt = [9, 12]) {
  const [ww, wh] = size;
  const cols = Math.max(1, Math.floor((w - 10) / (ww + 9)));
  const gap = (w - cols * ww) / (cols + 1);
  const dark = mix(color, INK, 0.45);
  let s = "";
  for (let y = top + 12; y + wh < Math.min(bottom, 600); y += wh + 11) {
    for (let i = 0; i < cols; i++) s += rect(+(x + gap + i * (ww + gap)).toFixed(1), y, ww, wh, rng() < 0.22 ? "#fff1b0" : dark);
  }
  return `<g stroke="none">${s}</g>`;
}

/** A stack of boxes, widest at the bottom, centered on `cx`: [width, top, color] from the bottom up. */
function tiers(cx: number, bottom: number, list: Array<[number, number, string]>) {
  let s = "", b = bottom;
  for (const [w, top, color] of list) {
    s += block(cx - w / 2 - SIDE_X / 2, top, w, b, color);
    b = top;
  }
  return s;
}

/** One piece of the skyline, for the intro to raise into place. */
const piece = (s: string) => `<g class="lg-b">${s}</g>`;

function seoul() {
  const hill = "#5fb36c", white = "#f4f6ff";
  let s = tiers(186, GROUND, [[148, 548, hill], [108, 512, hill], [66, 484, hill]]);
  // Pine tufts on the hill steps.
  for (const [x, y] of [[124, 548], [234, 548], [140, 512], [218, 512]] as Pt[]) s += block(x, y - 16, 16, y, "#3f8f52");
  s += block(170, 262, 18, 484, white);
  s += block(150, 228, 58, 266, white) + `<g stroke="none">${rect(150, 242, 58, 10, "#46b4ff")}</g>`;
  s += block(158, 210, 42, 228, white);
  s += block(175, 132, 8, 210, white) + block(175, 118, 8, 132, "#ff4b55");
  return piece(s);
}

function empireState(rng: () => number) {
  const stone = "#f1e2c2", lit = "#ffc23d";
  let s = block(236, 332, 92, GROUND, stone) + windows(236, 332, 92, GROUND, stone, rng);
  s += block(248, 290, 68, 332, stone) + windows(248, 290, 68, 332, stone, rng);
  s += block(261, 252, 42, 290, stone);
  s += block(270, 222, 24, 252, lit);
  s += block(277, 168, 10, 222, stone);
  s += block(280, 126, 4, 168, stone);
  return piece(s);
}

function tokyoTower() {
  const red = "#ff6a3d", white = "#f7f7f2";
  return piece(tiers(1006, GROUND, [
    [120, 586, red], [96, 548, white], [78, 512, red],
    [92, 492, white],
    [58, 456, red], [46, 422, white], [36, 390, red],
    [44, 374, white],
    [26, 334, red], [16, 290, white], [8, 238, red],
  ]));
}

function usBank(rng: () => number) {
  const glass = "#9db7d6";
  let s = block(1086, 262, 62, GROUND, glass) + windows(1086, 262, 62, GROUND, glass, rng, [7, 16]);
  s += block(1092, 240, 50, 262, glass) + block(1100, 222, 34, 240, roof(glass));
  return piece(s);
}

/** A pixel palm: a curved trunk of offset squares under four drooping fronds of blocks. */
function palm(x: number, top: number, lean: number) {
  const trunk = "#b07a4a", leaf = "#4cbb5e", leafDark = "#2f9447";
  let s = "";
  for (let i = 8; i >= 0; i--) s += rect(x + Math.round(lean * i * i * 0.12), top + i * 15, 12, 16, i % 2 ? trunk : mix(trunk, INK, 0.18));
  const cx = x + 6, cy = top + 2;
  // Each frond: blocks stepping out and down from the crown.
  for (const dir of [-1, 1]) {
    for (const [dx, dy, c] of [[10, -10, leaf], [24, -12, leaf], [38, -8, leaf], [50, 0, leafDark], [58, 12, leafDark]] as Array<[number, number, string]>) {
      s += rect(cx + dir * dx - 8, cy + dy - 6, 16, 12, c);
    }
    for (const [dx, dy] of [[12, 4], [24, 10], [32, 22]]) s += rect(cx + dir * dx - 7, cy + dy - 5, 14, 11, leafDark);
  }
  return s + rect(cx - 10, cy - 18, 20, 16, leaf);
}

/** A blocky cloud. */
function cloud(x: number, y: number, k: number) {
  const c = "#ffffff";
  return (
    `<g class="lg-cloud"><g transform="translate(${x} ${y}) scale(${k})">` +
    `<path d="M0 30 H22 V12 H48 V0 H86 V16 H108 V30 H128 V58 H0 Z" fill="${c}"/>` +
    `<path d="M0 50 H128 V58 H0 Z" fill="#dfeaf7" stroke="none"/></g></g>`
  );
}

const SUN: Pt = [CX, 322];
const SUN_R = 200;
/** Where the web is spun: over the top of the sun, clear of the towers. */
const WEB_HUB: Pt = [CX, 214];

/** The art box and its anchor points, in the SVG's own units, for the intro to animate around. */
export const LOGO_ART = { width: W, top: TOP, height: H, webHub: WEB_HUB, cityAt: [CX, 470] as Pt };
/** The web is wider than it is tall, to fill the sky over the skyline. */
const WEB_SX = 1.35;
const WEB_SY = 0.8;
const WEB_REACH = 620;

/**
 * A comic web behind the skyline: threads radiating from the hub, crossed by rings
 * that sag in toward the hub between threads, fading out toward its edge. White
 * line with a thick ink edge.
 */
function web(id: string, rng: () => number) {
  const spokes = 16;
  const rings = [74, 136, 206, 286, 374, 470];
  const angles = Array.from({ length: spokes }, (_, i) => ((i + 0.5 + (rng() - 0.5) * 0.35) / spokes) * Math.PI * 2);
  const at = (a: number, r: number): Pt => [WEB_HUB[0] + Math.cos(a) * r * WEB_SX, WEB_HUB[1] + Math.sin(a) * r * WEB_SY];
  const f = (p: Pt) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  let d = "";
  for (const a of angles) d += `M${f(WEB_HUB)}L${f(at(a, WEB_REACH * (0.9 + rng() * 0.2)))}`;
  for (const r of rings) {
    // Each thread holds its ring a little nearer or further, like a web strung by hand.
    const rs = angles.map(() => r * (0.95 + rng() * 0.1));
    d += `M${f(at(angles[0], rs[0]))}`;
    for (let k = 1; k <= spokes; k++) {
      const i = k % spokes;
      const a0 = angles[k - 1], a1 = k === spokes ? angles[0] + Math.PI * 2 : angles[i];
      const sag = ((rs[k - 1] + rs[i]) / 2) * (0.8 + rng() * 0.05);
      d += `Q${f(at((a0 + a1) / 2, sag))} ${f(at(a1, rs[i]))}`;
    }
  }
  // Fades out over its outer rings, so it has no hard edge on any background, and
  // sooner upward, so it stays about the logo's own height.
  const box = `maskUnits="userSpaceOnUse" x="-400" y="-600" width="2080" height="1800"`;
  const cover = (fill: string) => `<rect x="-400" y="-600" width="2080" height="1800" fill="${fill}"/>`;
  const fade =
    `<radialGradient id="${id}-webfade" gradientUnits="userSpaceOnUse" cx="${WEB_HUB[0]}" cy="${WEB_HUB[1]}" r="${WEB_REACH}" ` +
    `gradientTransform="translate(${WEB_HUB[0]} ${WEB_HUB[1]}) scale(${WEB_SX} ${WEB_SY}) translate(${-WEB_HUB[0]} ${-WEB_HUB[1]})">` +
    `<stop offset="0.5" stop-color="#fff"/><stop offset="0.92" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="${id}-webtop" gradientUnits="userSpaceOnUse" x1="0" y1="${TOP - 70}" x2="0" y2="${TOP + 60}">` +
    `<stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>` +
    `<mask id="${id}-webmask" ${box}>${cover(`url(#${id}-webfade)`)}</mask>` +
    `<mask id="${id}-webtopmask" ${box}>${cover(`url(#${id}-webtop)`)}</mask>`;
  return {
    defs: fade,
    art:
      `<g class="lg-web"><g mask="url(#${id}-webtopmask)"><g mask="url(#${id}-webmask)" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="${d}" stroke="${INK}" stroke-width="13"/><path d="${d}" stroke="#ffffff" stroke-width="5.5"/></g></g></g>`,
  };
}

function skyline(rng: () => number) {
  // Behind CITY: plainer towers, cooler colors, so the letters stay on top.
  const back: Array<[number, number, number, string]> = [
    [338, 344, 74, "#8f7fe0"], [420, 300, 64, "#5fa8e8"], [492, 352, 84, "#e889b6"], [584, 268, 58, "#4fc6a5"],
    [650, 318, 86, "#7f92e6"], [744, 286, 62, "#f2a865"], [814, 340, 80, "#b58be8"], [900, 318, 52, "#62b8d8"],
  ];
  let s = "";
  for (const [x, top, w, c] of back) s += piece(block(x, top, w, GROUND, c) + windows(x, top, w, GROUND, c, rng));
  return s + seoul() + empireState(rng) + tokyoTower() + usBank(rng) + piece(palm(1060, 444, 0.4)) + piece(palm(1176, 420, -0.5));
}

/** The logo as an inline SVG string. */
export function logoSvg(className = "logo-art") {
  const id = `cc-logo-${++instances}`;
  const rng = mulberry32(1107);
  const line = (key: string, text: string, size: number, y: number) =>
    `<text id="${id}-${key}" x="${CX}" y="${y}" font-family="Bungee" font-size="${size}" text-anchor="middle">${text}</text>`;
  /** One word: the extrusion and outline in ink, then the face. */
  const word = (key: string, face: string) => {
    let depth = "";
    for (let i = DEPTH_Y; i > 0; i -= 2) depth += `<use href="#${id}-${key}" x="${((i * DEPTH_X) / DEPTH_Y).toFixed(1)}" y="${i}"/>`;
    return (
      `<g fill="${INK}" stroke="${INK}" stroke-width="${LETTER_STROKE}" stroke-linejoin="round">${depth}<use href="#${id}-${key}"/></g>` +
      `<use href="#${id}-${key}" fill="url(#${id}-${face})"/>`
    );
  };
  /** Two-tone letter face: a hard step across the middle, like a lit top and a shaded bottom. */
  const faceFill = (key: string, top: string, bottom: string, y0: number, y1: number) =>
    `<linearGradient id="${id}-${key}" gradientUnits="userSpaceOnUse" x1="0" y1="${y0}" x2="0" y2="${y1}">` +
    `<stop offset="0" stop-color="${top}"/><stop offset="0.56" stop-color="${top}"/><stop offset="0.56" stop-color="${bottom}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;

  const cityY = 548, crawlY = 712, citySize = 236, crawlSize = 195;
  const spun = web(id, mulberry32(31));
  const tilt = (s: string) => `<g transform="translate(${CX} 0) skewY(${TILT}) translate(${-CX} 0)">${s}</g>`;
  return (
    `<svg class="${className}" viewBox="0 ${TOP} ${W} ${H}" role="img" aria-label="City Crawlers" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>${line("l1", "CITY", citySize, cityY)}${line("l2", "CRAWLERS", crawlSize, crawlY)}` +
    faceFill("gold", "#ffd84a", "#ffb11f", cityY - citySize * 0.72, cityY) +
    faceFill("white", "#ffffff", "#d6e2ff", crawlY - crawlSize * 0.72, crawlY) +
    spun.defs +
    // Cut at the ground line (hidden behind CRAWLERS anyway), so the intro can raise buildings out of it.
    `<clipPath id="${id}-ground"><rect x="-400" y="-600" width="2080" height="${GROUND + 600 + LINE}"/></clipPath>` +
    `</defs>` +
    `<g class="lg-sun"><circle cx="${SUN[0]}" cy="${SUN[1]}" r="${SUN_R}" fill="#ffe08a" stroke="${INK}" stroke-width="${LINE}"/></g>` +
    spun.art +
    `<g stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round" clip-path="url(#${id}-ground)">` +
    cloud(352, 150, 0.7) + cloud(842, 176, 0.6) +
    skyline(rng) +
    `</g>` +
    `<g class="lg-crawlers">${tilt(word("l2", "white"))}</g><g class="lg-city">${tilt(word("l1", "gold"))}</g>` +
    `</svg>`
  );
}
