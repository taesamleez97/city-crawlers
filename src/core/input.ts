// Remote and keyboard input. City Crawlers is played with the body (see
// input/motion.ts); the remote only drives menus.
//
// Two streams come out: menu actions (arrows / OK / Back) and, for desk testing
// with ?keys, rhythm presses stamped with the event's own time:
//   Q E  left / right web     A D  lean left / right

import type { CueKind, Side } from "../rhythm/song";

export type Action = "left" | "right" | "up" | "down" | "select" | "back";
export type InputEvent = { action: Action; type: "down" | "up"; repeat: boolean; time: number };
export type Press = { kind: CueKind; side: Side; time: number };

const KEYMAP: Record<string, Action> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Enter: "select",
  Escape: "back",
  // Desktop conveniences; the TV only ever sends the six keys above.
  KeyW: "up",
  KeyS: "down",
  Space: "select",
};

const PRESSES: Record<string, { kind: CueKind; side: Side }> = {
  KeyQ: { kind: "hand", side: -1 },
  KeyE: { kind: "hand", side: 1 },
  KeyA: { kind: "lean", side: -1 },
  KeyD: { kind: "lean", side: 1 },
};

export class Input {
  /** Keyboard cue presses for testing without a camera. */
  readonly keys = new URLSearchParams(location.search).has("keys");
  private readonly queue: InputEvent[] = [];
  private readonly presses: Press[] = [];

  constructor(target: Window = window) {
    target.addEventListener("keydown", (e) => this.onKey(e, "down"), { capture: true });
    target.addEventListener("keyup", (e) => this.onKey(e, "up"), { capture: true });
  }

  private onKey(e: KeyboardEvent, type: "down" | "up") {
    if (e.target instanceof HTMLInputElement) return;
    const action = KEYMAP[e.code] ?? KEYMAP[e.key];
    const press = this.keys ? PRESSES[e.code] : undefined;
    if (!action && !press) return;
    e.preventDefault();
    const now = performance.now();
    // Event timestamps share performance.now()'s origin; guard against hosts that don't.
    const time = Math.abs(e.timeStamp - now) < 1000 ? e.timeStamp : now;
    if (action) this.queue.push({ action, type, repeat: e.repeat, time });
    if (press && type === "down" && !e.repeat) this.presses.push({ ...press, time });
  }

  drain(): InputEvent[] {
    return this.queue.splice(0, this.queue.length);
  }

  drainPresses(): Press[] {
    return this.presses.splice(0, this.presses.length);
  }
}
