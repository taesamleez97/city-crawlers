// The two cue lanes at the screen edges: cues fall toward a hit zone and land on
// their beat. Left lane = left hand / lean left, right lane = right.

import type { CueRt, Grade } from "../rhythm/judge";
import { LEAD_BEATS, type Side } from "../rhythm/song";
import { leanSvg, shootSvg } from "./cueStyle";

const HIT_Y = 800;
const TOP_Y = 190;
const BEAT_LINES = 4;

const el = (cls: string, html = "") => {
  const e = document.createElement("div");
  e.className = cls;
  e.innerHTML = html;
  return e;
};

class Lane {
  readonly root: HTMLElement;
  private readonly cues: HTMLElement;
  private readonly hit: HTMLElement;
  private readonly judgeEl: HTMLElement;
  private readonly lines: HTMLElement[] = [];
  readonly nodes = new Map<number, HTMLElement>();

  constructor(readonly side: Side) {
    this.root = el(`lane ${side < 0 ? "l" : "r"}`);
    this.root.dataset.little = "region";
    this.root.dataset.littleLabel = side < 0 ? "Left cues" : "Right cues";
    const track = el("lane-track");
    for (let i = 0; i < BEAT_LINES; i++) {
      const l = el("beat-line");
      track.append(l);
      this.lines.push(l);
    }
    this.hit = el("hit", `<span>${side < 0 ? "LEFT" : "RIGHT"}</span>`);
    this.cues = el("lane-cues");
    this.judgeEl = el("judge");
    this.root.append(track, this.hit, this.cues, this.judgeEl);
  }

  node(rt: CueRt) {
    let n = this.nodes.get(rt.cue.id);
    if (!n) {
      const hand = rt.cue.kind === "hand";
      n = el(`cue ${hand ? "hand" : "lean"}`, hand ? shootSvg(this.side) : `${leanSvg(this.side)}<b>LEAN</b>`);
      this.cues.append(n);
      this.nodes.set(rt.cue.id, n);
    }
    return n;
  }

  drop(id: number) {
    this.nodes.get(id)?.remove();
    this.nodes.delete(id);
  }

  update(beat: number) {
    const frac = beat - Math.floor(beat);
    const pulse = 1 + 0.1 * Math.exp(-frac * 7);
    this.hit.style.transform = `translate(-50%, -50%) scale(${pulse.toFixed(3)})`;
    for (let i = 0; i < BEAT_LINES; i++) {
      const ahead = Math.ceil(beat) + i - beat;
      const y = HIT_Y - (ahead / LEAD_BEATS) * (HIT_Y - TOP_Y);
      this.lines[i].style.transform = `translateY(${y.toFixed(1)}px)`;
      this.lines[i].style.opacity = String(Math.max(0, Math.min(1, (LEAD_BEATS + 0.6 - ahead) / 0.8)) * 0.5);
    }
  }

  judge(grade: Grade, offset: number) {
    const late = offset > 0;
    const sub = grade === "perfect" || grade === "miss" ? "" : `<small>${late ? "LATE" : "EARLY"}</small>`;
    this.judgeEl.className = `judge ${grade}`;
    this.judgeEl.innerHTML = `${grade.toUpperCase()}${sub}`;
    this.judgeEl.style.animation = "none";
    void this.judgeEl.offsetWidth;
    this.judgeEl.style.animation = "";
    if (grade !== "miss") {
      this.hit.classList.remove("flash");
      void this.hit.offsetWidth;
      this.hit.classList.add("flash");
    }
  }
}

export class Lanes {
  readonly root = el("lanes");
  private readonly lanes: Record<Side, Lane> = { [-1]: new Lane(-1), [1]: new Lane(1) } as Record<Side, Lane>;
  private readonly exiting = new Map<number, number>();

  constructor() {
    this.root.append(this.lanes[-1].root, this.lanes[1].root);
  }

  show(on: boolean) {
    this.root.classList.toggle("hidden", !on);
  }

  clear() {
    for (const lane of Object.values(this.lanes)) for (const id of [...lane.nodes.keys()]) lane.drop(id);
    this.exiting.clear();
  }

  update(beat: number, rts: CueRt[], now = performance.now()) {
    this.lanes[-1].update(beat);
    this.lanes[1].update(beat);
    for (const rt of rts) {
      const ahead = rt.cue.beat - beat;
      if (ahead > LEAD_BEATS + 0.5) break;
      const lane = this.lanes[rt.cue.side];
      const has = lane.nodes.has(rt.cue.id);
      if (rt.state !== "pending") {
        if (!has) continue;
        // Judged: play the exit animation once, then drop the node.
        if (!this.exiting.has(rt.cue.id)) {
          this.exiting.set(rt.cue.id, now);
          lane.node(rt).classList.add(rt.state === "miss" ? "missed" : "done");
        } else if (now - this.exiting.get(rt.cue.id)! > 380) {
          lane.drop(rt.cue.id);
          this.exiting.delete(rt.cue.id);
        }
        if (rt.state === "miss") this.place(lane.node(rt), ahead);
        continue;
      }
      if (ahead < -1) continue;
      const n = lane.node(rt);
      this.place(n, ahead);
      n.style.opacity = String(Math.max(0, Math.min(1, (LEAD_BEATS + 0.5 - ahead) / 0.6)));
      n.classList.toggle("soon", ahead < 1);
    }
  }

  private place(n: HTMLElement, ahead: number) {
    const y = HIT_Y - (ahead / LEAD_BEATS) * (HIT_Y - TOP_Y);
    n.style.transform = `translate(-50%, -50%) translateY(${y.toFixed(1)}px)`;
  }

  judge(side: Side, grade: Grade, offset: number) {
    this.lanes[side].judge(grade, offset);
  }
}
