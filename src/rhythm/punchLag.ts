// How late this player's punches land, learned from their own webs, so a punch
// thrown on the beat is judged on the beat. The camera calls a shot when the arm
// reaches its stretch, a moment after the player threw it, and that moment varies
// with the person, the room and the camera.

import { clamp } from "../core/math";

const KEY = "cc.punchLag.v1";
/** Seconds. Never assume more: a punch later than this really is late. */
const MAX_LAG = 0.25;
/** Until the player has punched at a few rings: a typical whole-arm punch. */
const START_LAG = 0.08;
/** The most recent punches learned from; their median shrugs off a stray one. */
const SAMPLES = 9;
const MIN_SAMPLES = 3;

export class PunchLag {
  value = START_LAG;
  private readonly recent: number[] = [];

  constructor() {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved !== null && Number.isFinite(Number(saved))) this.value = clamp(Number(saved), 0, MAX_LAG);
    } catch {
      // No storage: start from the default every time.
    }
  }

  get samples() {
    return this.recent.length;
  }

  /** A punch at a ring, `offset` seconds after its beat as the camera saw it (negative = early). */
  learn(offset: number) {
    this.recent.push(offset);
    if (this.recent.length > SAMPLES) this.recent.shift();
    if (this.recent.length < MIN_SAMPLES) return;
    const sorted = [...this.recent].sort((a, b) => a - b);
    this.value = clamp(sorted[sorted.length >> 1], 0, MAX_LAG);
    try {
      localStorage.setItem(KEY, this.value.toFixed(3));
    } catch {
      // Still used for this session.
    }
  }
}
