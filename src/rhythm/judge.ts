// Timing judgment. Inputs and cues are compared in song seconds (what the viewer
// hears), never in frames, so a slow frame can't cost a Perfect.

import { BEAT, type Cue, type CueKind, type Side } from "./song";

export type Grade = "perfect" | "great" | "good" | "miss";
export type CueState = "pending" | "hit" | "miss" | "skipped";

/**
 * Seconds a ring holds still after its beat, waiting for the web (longer by the
 * player's punch lag). The late side of a web's window ends exactly when the hold
 * does, so what you see is what counts.
 */
export const HAND_HOLD = 0.4;

type Tiers = readonly [perfect: number, great: number, good: number];
/**
 * Window widths in seconds either side of the beat. A web is a whole-arm punch that
 * lands a little after the player decides to throw it, so its late side is longer.
 */
export const WINDOWS: Record<CueKind, { early: Tiers; late: Tiers }> = {
  hand: { early: [0.09, 0.17, 0.26], late: [0.14, 0.26, HAND_HOLD] },
  lean: { early: [0.12, 0.22, 0.34], late: [0.12, 0.22, 0.34] },
};
const tiers = (kind: CueKind, offset: number) => (offset < 0 ? WINDOWS[kind].early : WINDOWS[kind].late);
const POINTS: Record<Grade, number> = { perfect: 300, great: 200, good: 100, miss: 0 };
const ACCURACY: Record<Grade, number> = { perfect: 1, great: 0.75, good: 0.5, miss: 0 };

export interface CueRt {
  cue: Cue;
  /** Song seconds. */
  time: number;
  state: CueState;
  grade?: Grade;
  /** Seconds, positive = late. */
  offset?: number;
}

export interface Judgment {
  rt: CueRt;
  grade: Grade;
  offset: number;
  points: number;
  combo: number;
  multiplier: number;
}

export class Judge {
  readonly rts: CueRt[];
  /** Seconds a punch is moved back before it's judged: how late this player's punches land (see PunchLag). */
  handLag = 0;
  score = 0;
  combo = 0;
  maxCombo = 0;
  readonly counts: Record<Grade, number> = { perfect: 0, great: 0, good: 0, miss: 0 };
  private accSum = 0;
  private judged = 0;

  constructor(cues: Cue[]) {
    this.rts = cues.map((cue) => ({ cue, time: cue.beat * BEAT, state: "pending" }));
  }

  reset() {
    for (const rt of this.rts) {
      rt.state = "pending";
      rt.grade = undefined;
      rt.offset = undefined;
    }
    this.score = this.combo = this.maxCombo = this.accSum = this.judged = 0;
    for (const k of Object.keys(this.counts) as Grade[]) this.counts[k] = 0;
  }

  get multiplier() {
    return Math.min(4, 1 + Math.floor(this.combo / 8));
  }

  get accuracy() {
    return this.judged ? this.accSum / this.judged : 1;
  }

  /** A gesture at song time `t`: the nearest open cue of that kind and side takes it. */
  input(kind: CueKind, side: Side, at: number): Judgment | null {
    const t = kind === "hand" ? at - this.handLag : at;
    let best: CueRt | null = null;
    let bestD = Infinity;
    for (const rt of this.rts) {
      if (rt.time > t + 1) break;
      if (rt.state !== "pending" || rt.cue.side !== side || rt.cue.kind !== kind) continue;
      const d = Math.abs(t - rt.time);
      if (d <= tiers(kind, t - rt.time)[2] && d < bestD) {
        best = rt;
        bestD = d;
      }
    }
    return best ? this.resolve(best, t - best.time) : null;
  }

  /** Grade a cue directly, e.g. a lean that was already held when its beat arrived. */
  grant(rt: CueRt, grade: Grade, offset: number): Judgment {
    return this.finish(rt, grade, offset);
  }

  /**
   * Cues whose window has closed by song time `t` become misses. Pass the time of the
   * newest input that could still be on its way, not the time now.
   */
  sweep(at: number, out: Judgment[]) {
    for (const rt of this.rts) {
      if (rt.time - 1 > at) break;
      const t = rt.cue.kind === "hand" ? at - this.handLag : at;
      if (rt.state === "pending" && t > rt.time + WINDOWS[rt.cue.kind].late[2]) {
        out.push(this.finish(rt, "miss", t - rt.time));
      }
    }
  }

  /** The hero reached the obstacle before the viewer leaned: settle it now. */
  missNow(rt: CueRt, t: number): Judgment | null {
    return rt.state === "pending" ? this.finish(rt, "miss", t - rt.time) : null;
  }

  /** Cues the viewer could not fairly make (just after a resume): no score, no penalty. */
  skip(rt: CueRt) {
    if (rt.state === "pending") rt.state = "skipped";
  }

  private resolve(rt: CueRt, offset: number) {
    const [p, g] = tiers(rt.cue.kind, offset);
    const d = Math.abs(offset);
    return this.finish(rt, d <= p ? "perfect" : d <= g ? "great" : "good", offset);
  }

  private finish(rt: CueRt, grade: Grade, offset: number): Judgment {
    rt.state = grade === "miss" ? "miss" : "hit";
    rt.grade = grade;
    rt.offset = offset;
    this.counts[grade]++;
    this.judged++;
    this.accSum += ACCURACY[grade];
    if (grade === "miss") this.combo = 0;
    else {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
    }
    const multiplier = this.multiplier;
    const points = POINTS[grade] * multiplier;
    this.score += points;
    return { rt, grade, offset, points, combo: this.combo, multiplier };
  }
}
