// One visual language for cues, shared by the rings and signs in the city, the
// title card and the body guide: web shots are round, blue (left) or pink
// (right), with an arm punching up and out; lean cues are orange arrows. Color,
// shape and icon each tell them apart on their own. Figures are drawn as a
// mirror: the player's right arm is on the right.

export const LEFT_COLOR = "#33b4ff";
export const RIGHT_COLOR = "#ff5aa8";
export const LEAN_COLOR = "#ff9a1f";

const flip = (side: number, w: number) => (side < 0 ? `transform="translate(${w} 0) scale(-1 1)"` : "");

/** An arm punching up and out with a web bursting off the fist (right side; mirrored for left). */
export const shootSvg = (side: number) =>
  `<svg viewBox="0 0 48 48"><g ${flip(side, 48)} fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M9 42 L29 20" stroke-width="7"/>` +
  `<circle cx="31.5" cy="17" r="6" fill="#fff" stroke="none"/>` +
  `<path d="M38 10 L44 4 M40.5 15.5 L46 14 M33 7.5 L34 2" stroke-width="3.2"/></g></svg>`;

/** Double chevron pointing the way to lean. */
export const leanSvg = (side: number) =>
  `<svg viewBox="0 0 48 32"><g fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" ${flip(side, 48)}><path d="M10 5l11 11-11 11"/><path d="M25 5l11 11-11 11"/></g></svg>`;

// ---------------------------------------------------------------- coaching figures
type P = [number, number];
type FigurePose = "frame" | "stance" | "shootL" | "shootR" | "leanL" | "leanR";

const rot = ([x, y]: P, [cx, cy]: P, a: number): P => {
  const c = Math.cos(a), s = Math.sin(a);
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
};

/**
 * A small stick figure showing a move, 64×64. Display left/right = the player's
 * left/right (a mirror), so "shootR" raises the arm on the right.
 */
export function figureSvg(pose: FigurePose): string {
  const hips: [P, P] = [[27, 42], [37, 42]];
  const legs: Array<[P, P]> = [[[27, 42], [25, 60]], [[37, 42], [39, 60]]];
  let sh: [P, P] = [[24, 22], [40, 22]];
  let head: P = [32, 12];
  // Arms: [shoulder, elbow, wrist] for display-left, display-right.
  const stanceArm = (s: P, dir: number): [P, P, P] => [s, [s[0] + dir * 5, s[1] + 10], [s[0] + dir * 2, s[1] - 1]];
  const shootArm = (s: P, dir: number): [P, P, P] => [s, [s[0] + dir * 8.5, s[1] - 8.5], [s[0] + dir * 17, s[1] - 17]];
  const downArm = (s: P, dir: number): [P, P, P] => [s, [s[0] + dir * 3, s[1] + 10], [s[0] + dir * 4, s[1] + 19]];
  let arms: [[P, P, P], [P, P, P]];
  let active: [string | null, string | null] = [null, null];
  let torsoColor = "#fff";

  switch (pose) {
    case "frame":
      arms = [shootArm(sh[0], -1), shootArm(sh[1], 1)];
      break;
    case "stance":
      arms = [stanceArm(sh[0], -1), stanceArm(sh[1], 1)];
      active = ["#fff", "#fff"];
      break;
    case "shootR":
      arms = [stanceArm(sh[0], -1), shootArm(sh[1], 1)];
      active = [null, RIGHT_COLOR];
      break;
    case "shootL":
      arms = [shootArm(sh[0], -1), stanceArm(sh[1], 1)];
      active = [LEFT_COLOR, null];
      break;
    case "leanL":
    case "leanR": {
      const a = pose === "leanL" ? -0.28 : 0.28;
      const pivot: P = [32, 42];
      sh = [rot(sh[0], pivot, a), rot(sh[1], pivot, a)];
      head = rot(head, pivot, a);
      arms = [downArm(sh[0], -1), downArm(sh[1], 1)];
      torsoColor = LEAN_COLOR;
      break;
    }
  }

  const line = (a: P, b: P, color: string, w: number) =>
    `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${color}" stroke-width="${w}"/>`;
  const parts: string[] = [];
  if (pose === "frame") parts.push(`<rect x="2" y="2" width="60" height="60" rx="6" fill="none" stroke="#4fd1a5" stroke-width="2.5" stroke-dasharray="5 4"/>`);
  for (const [a, b] of legs) parts.push(line(a, b, "rgba(255,255,255,0.8)", 4));
  parts.push(line(sh[0], hips[0], torsoColor, 4.5), line(sh[1], hips[1], torsoColor, 4.5), line(sh[0], sh[1], torsoColor, 4.5), line(hips[0], hips[1], "#fff", 4));
  arms.forEach(([s, e, w], i) => {
    const c = active[i] ?? "rgba(255,255,255,0.85)";
    const wd = active[i] && active[i] !== "#fff" ? 5 : 4;
    parts.push(line(s, e, c, wd), line(e, w, c, wd));
    if (active[i] && active[i] !== "#fff") parts.push(`<circle cx="${w[0].toFixed(1)}" cy="${w[1].toFixed(1)}" r="4.5" fill="${c}" stroke="#1d2244" stroke-width="1.5"/>`);
    else parts.push(`<circle cx="${w[0].toFixed(1)}" cy="${w[1].toFixed(1)}" r="3" fill="#fff"/>`);
  });
  parts.push(`<circle cx="${head[0].toFixed(1)}" cy="${head[1].toFixed(1)}" r="6" fill="#fff"/>`);
  return `<svg viewBox="0 0 64 64" stroke-linecap="round">${parts.join("")}</svg>`;
}
