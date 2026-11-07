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
/** How far ahead (in beats) a cue appears in its lane. */
export const LEAD_BEATS = 3;

export type Side = -1 | 1;
export type CueKind = "hand" | "lean";

export interface Cue {
  id: number;
  beat: number;
  kind: CueKind;
  side: Side;
}

export interface Section {
  name: string;
  bar: number;
  /** Relative travel speed; the route is shared out by beats × pace. */
  pace: number;
}

export const SECTIONS: Section[] = [
  { name: "Get ready", bar: 0, pace: 1 },
  { name: "Main Ave", bar: 2, pace: 0.85 },
  { name: "Lean in", bar: 10, pace: 1 },
  { name: "Canal St", bar: 18, pace: 1.1 },
  { name: "Tower Ave", bar: 26, pace: 1.2 },
  { name: "Finish", bar: 30, pace: 1 },
];

export function sectionAt(beat: number): Section {
  let s = SECTIONS[0];
  for (const sec of SECTIONS) if (beat >= sec.bar * BEATS_PER_BAR) s = sec;
  return s;
}

// One string per bar from bar 2, one character per beat:
// L / R = left / right hand (web), < / > = lean left / right, . = rest.
// Corner swings are flipped to the inside of the turn by the route builder.
const CHART_START_BAR = 2;
const CHART = [
  // Main Ave: webs only, one per bar, then two.
  "R...", "L...", "R...", "L...",
  "R.L.", "R.L.", "R.L.", "R...",
  // Leans join in, one in the middle of each swing.
  "L.>.", "R.<.", "L.<.", "R.>.",
  "L.>.", "R.<.", "L...", "R.<.",
  // Canal St: quicker swings with leans between.
  "L.R.", ">.<.", "L.R.", "L.R.",
  "L>R.", "<.>.", "L.R.", "L.>.",
  // Tower Ave: the big finish.
  "R.L.", "R<L>", "R.L.", "R.L.",
];

export function buildChart(): Cue[] {
  const cues: Cue[] = [];
  CHART.forEach((bar, i) => {
    for (let k = 0; k < bar.length; k++) {
      const ch = bar[k];
      if (ch === ".") continue;
      const beat = (CHART_START_BAR + i) * BEATS_PER_BAR + k;
      const kind: CueKind = ch === "L" || ch === "R" ? "hand" : "lean";
      const side: Side = ch === "L" || ch === "<" ? -1 : 1;
      cues.push({ id: cues.length, beat, kind, side });
    }
  });
  return cues;
}
