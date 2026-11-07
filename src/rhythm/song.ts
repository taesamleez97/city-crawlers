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
  /** A web the hero fires by itself (the dodge level): no ring, no score. */
  auto?: boolean;
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
  { name: "Midtown", bar: 10, pace: 1 },
  { name: "Canal St", bar: 18, pace: 1.1 },
  { name: "Tower Ave", bar: 26, pace: 1.2 },
  { name: "Finish", bar: 30, pace: 1 },
];

export function sectionAt(beat: number): Section {
  let s = SECTIONS[0];
  for (const sec of SECTIONS) if (beat >= sec.bar * BEATS_PER_BAR) s = sec;
  return s;
}

// Three levels on the same song and route, one move at a time: webs, then
// dodging (the hero fires its own webs), then both, mixed in gradually. Any two
// cues are at least two beats apart, so each gesture has room.
//
// One string per bar from bar 2, one character per beat:
// L / R = left / right web, l / r = a web the hero fires by itself,
// < / > = lean left / right, . = rest.
// Corner swings are flipped to the inside of the turn by the route builder.
const CHART_START_BAR = 2;

export type LevelId = 1 | 2 | 3;

export interface Level {
  id: LevelId;
  name: string;
  /** One line for the menu and the announcer. */
  blurb: string;
  /** What the player does here (drives the tutorial steps and hints). */
  shoots: boolean;
  leans: boolean;
  chart: string[];
}

export const LEVELS: Level[] = [
  {
    id: 1,
    name: "Web Shooter",
    blurb: "Shoot a web at every ring",
    shoots: true,
    leans: false,
    chart: [
      // Main Ave: one web a bar, alternating arms, then two.
      "R...", "L...", "R...", "L...",
      "R...", "L...", "R.L.", "R.L.",
      // Midtown: two a bar.
      "R.L.", "R.L.", "R.L.", "R...",
      "L.R.", "L.R.", "L.R.", "L...",
      // Canal St
      "R.L.", "R.L.", "R.L.", "R.L.",
      "L.R.", "L.R.", "L.R.", "L.R.",
      // Tower Ave
      "R.L.", "R.L.", "R.L.", "R...",
    ],
  },
  {
    id: 2,
    name: "Dodge",
    blurb: "Your webs fire themselves: lean round the girders",
    shoots: false,
    leans: true,
    chart: [
      // Main Ave: watch the swing, then a girder every other bar.
      "r...", "l...", "r...", "l.>.",
      "r...", "l.<.", "r...", "l.>.",
      // Midtown: a girder every bar.
      "r.<.", "l.>.", "r.<.", "l.>.",
      "r.>.", "l.<.", "r.>.", "l.<.",
      // Canal St: two a bar.
      "r.<.", "l.>.", "r<.>", "l>.<",
      "r.<.", "l.>.", "r<.>", "l>.<",
      // Tower Ave
      "r.<.", "l.>.", "r.<.", "l...",
    ],
  },
  {
    id: 3,
    name: "Full Crawl",
    blurb: "Webs and girders together",
    shoots: true,
    leans: true,
    chart: [
      // Main Ave: webs first.
      "R...", "L...", "R...", "L...",
      "R.L.", "R.L.", "R.L.", "R...",
      // Midtown: a girder in the middle of each swing.
      "L.>.", "R.<.", "L.<.", "R.>.",
      "L.>.", "R.<.", "L...", "R.<.",
      // Canal St: quicker swings with girders between.
      "L.R.", ">.<.", "L.R.", "L.R.",
      "L.>.", "R.<.", "L.R.", "L.>.",
      // Tower Ave: the big finish.
      "R.L.", "R.>.", "L.<.", "R.L.",
    ],
  },
];

export const levelById = (id: number): Level | undefined => LEVELS.find((l) => l.id === id);

export function buildChart(level: Level): Cue[] {
  const cues: Cue[] = [];
  level.chart.forEach((bar, i) => {
    for (let k = 0; k < bar.length; k++) {
      const ch = bar[k];
      if (ch === ".") continue;
      const beat = (CHART_START_BAR + i) * BEATS_PER_BAR + k;
      const web = "LRlr".includes(ch);
      const side: Side = ch === "L" || ch === "l" || ch === "<" ? -1 : 1;
      cues.push({ id: cues.length, beat, kind: web ? "hand" : "lean", side, auto: ch === "l" || ch === "r" || undefined });
    }
  });
  return cues;
}
