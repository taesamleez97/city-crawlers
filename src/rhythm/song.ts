// The first City Crawlers song: 32 bars at 120 BPM. The music, the route and the
// cues all hang off beats, so this file is the single timing reference.

export const BPM = 120;
/** Seconds per beat. */
export const BEAT = 60 / BPM;
export const BEATS_PER_BAR = 4;
export const SONG_BARS = 32;
export const SONG_BEATS = SONG_BARS * BEATS_PER_BAR;

/** The hero jumps off the start roof on this beat; the first web catches the fall. */
export const LEAP_BEAT = 6;
/** Crossing the finish ring. */
export const FINISH_BEAT = 120;
/** Results appear once the outro has had a moment. */
export const RESULTS_BEAT = 125;

export type Side = -1 | 1;
export type CueKind = "hand" | "lean";

export interface Cue {
  id: number;
  beat: number;
  kind: CueKind;
  side: Side;
  /** A web the hero fires by itself between the player's: no ring, no score. */
  auto?: boolean;
}

export interface Section {
  bar: number;
  /** Relative travel speed; the route is shared out by beats × pace. */
  pace: number;
}

export const SECTIONS: Section[] = [
  { bar: 0, pace: 1 },
  { bar: 2, pace: 0.85 },
  { bar: 10, pace: 1 },
  { bar: 18, pace: 1.1 },
  { bar: 26, pace: 1.2 },
  { bar: 30, pace: 1 },
];

export function sectionAt(beat: number): Section {
  let s = SECTIONS[0];
  for (const sec of SECTIONS) if (beat >= sec.bar * BEATS_PER_BAR) s = sec;
  return s;
}

// One chart for every city: webs and dodges together, with room to breathe that
// shrinks as the song goes on. The gap between the player's moves is 8 beats in
// the first section, then 6, then 4, and only the last bars pair two webs 2 beats
// apart. A dodge always has 4 beats clear on both sides.
//
// One string per bar from bar 2, one character per beat:
// L / R = left / right web, < / > = lean left / right, . = rest.
// Corner swings are flipped to the inside of the turn by the route builder.
const CHART_START_BAR = 2;
const CHART = [
  // Bars 2-9: a web every 8 beats, then the first dodge.
  "R...", "....", "L...", "....",
  "R...", "....", ">...", "....",
  // Bars 10-17: every 6 beats.
  "L.....R.", "....<...", "..L.....", "R.....>.",
  // Bars 18-25: every 4 beats.
  "..L...R.", "..<...L.", "..R...>.", "..L...R.",
  // Bars 26-29: two quick webs, a dodge, three quick webs.
  "L...>...", "R.L.R...",
].join("");

/** The longest the hero hangs on one web; longer gaps get webs it fires by itself. */
const MAX_SWING = 4;

export function buildChart(): Cue[] {
  const moves: Array<Omit<Cue, "id">> = [];
  for (let k = 0; k < CHART.length; k++) {
    const ch = CHART[k];
    if (ch === ".") continue;
    const side: Side = ch === "L" || ch === "<" ? -1 : 1;
    moves.push({ beat: CHART_START_BAR * BEATS_PER_BAR + k, kind: ch === "L" || ch === "R" ? "hand" : "lean", side });
  }
  // Fill long gaps between webs so the swinging keeps its rhythm, stepping off any dodge beat.
  const leanBeats = new Set(moves.filter((m) => m.kind === "lean").map((m) => m.beat));
  const webs = moves.filter((m) => m.kind === "hand");
  const autos: Array<Omit<Cue, "id">> = [];
  for (let i = 0; i < webs.length; i++) {
    const from = webs[i].beat, to = i + 1 < webs.length ? webs[i + 1].beat : FINISH_BEAT;
    const n = Math.ceil((to - from) / MAX_SWING) - 1;
    let side = webs[i].side;
    for (let k = 1; k <= n; k++) {
      let beat = Math.round(from + ((to - from) * k) / (n + 1));
      if (leanBeats.has(beat)) beat += beat + 1 < to ? 1 : -1;
      side = -side as Side;
      autos.push({ beat, kind: "hand", side, auto: true });
    }
  }
  return [...moves, ...autos].sort((a, b) => a.beat - b.beat).map((c, id) => ({ ...c, id }));
}
