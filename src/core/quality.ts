// Adaptive quality for unknown TV GPUs: start conservative, then step up or down
// from measured frame times. Tiers only change render scale, shadow resolution
// and draw distance, so the art direction holds at every level.

export type Tier = {
  name: string;
  renderScale: number;
  shadowMap: number; // 0 disables shadows
  fogFar: number;
};

export const TIERS: Tier[] = [
  { name: "low", renderScale: 0.6, shadowMap: 0, fogFar: 340 },
  { name: "medium", renderScale: 0.75, shadowMap: 1024, fogFar: 420 },
  { name: "high", renderScale: 0.9, shadowMap: 2048, fogFar: 500 },
  { name: "ultra", renderScale: 1.0, shadowMap: 2048, fogFar: 560 },
];

export class QualityManager {
  index: number;
  private locked: boolean;
  private dts: number[] = [];
  private window = 0;
  private goodStreak = 0;
  private cooldown = 2.5;
  private ceiling = TIERS.length - 1;
  /** Average frame rate over the last measurement window. */
  fps = 0;
  onChange: (tier: Tier) => void = () => {};

  constructor() {
    const q = new URLSearchParams(location.search).get("quality");
    const forced = TIERS.findIndex((t) => t.name === q);
    this.locked = forced >= 0;
    this.index = forced >= 0 ? forced : 1;
  }

  get tier() {
    return TIERS[this.index];
  }

  /** Feed real frame deltas (seconds). Ignores hitches from tab switches. */
  sample(dt: number) {
    if (this.locked || dt > 0.25) return;
    this.cooldown -= dt;
    this.window += dt;
    this.dts.push(dt);
    if (this.window < 2) return;
    // TV WebViews miss vsync even with an empty scene (a Mali-G52 box drops ~25% of
    // frames at idle), so the average reflects the platform more than our load.
    // Judge by the median: most frames late means the scene itself is too heavy.
    const d = this.dts.sort((a, b) => a - b);
    const at = (q: number) => d[Math.floor(q * (d.length - 1))];
    this.fps = d.length / this.window;
    const median = at(0.5);
    const p75 = at(0.75);
    this.dts = [];
    this.window = 0;
    if (this.cooldown > 0) return;
    if (median > 1 / 47 && this.index > 0) {
      // Never climb back into a tier that already proved too heavy.
      this.ceiling = this.index - 1;
      this.set(this.index - 1);
    } else if (median < 1 / 58 && p75 < 1 / 52) {
      if (++this.goodStreak >= 4 && this.index < this.ceiling) this.set(this.index + 1);
    } else {
      this.goodStreak = 0;
    }
  }

  private set(i: number) {
    this.index = i;
    this.goodStreak = 0;
    this.cooldown = 3;
    this.onChange(this.tier);
  }
}
