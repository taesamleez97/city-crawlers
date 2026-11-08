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

// One chart for every city. Every web in the run is a ring the player shoots; the
// hero never fires one by itself. A web carries the hero 4 beats at most, except
// over a dodge: a dodge keeps 4 beats clear on both sides, and the hero lets go at
// the bottom of that longer swing to lean through. The gaps shrink as the song goes
// on: a web every 4 beats to start, then every 3, and the last bars pair webs 2
// beats apart.
//
// One string per bar from bar 2, one character per beat:
// L / R = left / right web, < / > = lean left / right, . = rest.
// Corner swings are flipped to the inside of the turn by the route builder.
const CHART_START_BAR = 2;
const CHART = [
  // Bars 2-9: a web every 4 beats, then the first dodge.
  "R...", "L...", "R...", "L...",
  "R...", "L...", ">...", "R...",
  // Bars 10-17: still every 4 beats, with two dodges.
  "L...", "R...", "L...", "<...",
  "R...", "L...", "R...", ">...",
  // Bars 18-25: every 3 beats between the dodges.
  "L..R", "..L.", "..<.", "..R.",
  ".L..", "R...", ">...", "L.R.",
  // Bars 26-29: a quick web, a dodge, three quick webs.
  "L...", ">...", "R.L.", "R...",
].join("");

export function buildChart(): Cue[] {
  const cues: Cue[] = [];
  for (let k = 0; k < CHART.length; k++) {
    const ch = CHART[k];
    if (ch === ".") continue;
    const side: Side = ch === "L" || ch === "<" ? -1 : 1;
    cues.push({ id: cues.length, beat: CHART_START_BAR * BEATS_PER_BAR + k, kind: ch === "L" || ch === "R" ? "hand" : "lean", side });
  }
  return cues;
}
