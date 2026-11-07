// Unified input for the TV remote (six keys), a keyboard (dev), and a paired gamepad.
//
// The remote contract: ArrowUp/Down/Left/Right auto-repeat while held, Enter (Select)
// and Escape (Back) never repeat. We use keyup when the host delivers it and fall
// back to "held while repeats keep arriving" if it never does.

export type Action = "left" | "right" | "up" | "down" | "select" | "back";
export type InputEvent = { action: Action; type: "down" | "up"; repeat: boolean; time: number };

const KEYMAP: Record<string, Action> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Enter: "select",
  Escape: "back",
  // Desktop conveniences; the TV only ever sends the six keys above.
  KeyA: "left",
  KeyD: "right",
  KeyW: "up",
  KeyS: "down",
  Space: "select",
};

type HeldState = { down: boolean; lastSeen: number; repeats: number };

export class Input {
  private readonly held = new Map<Action, HeldState>();
  private readonly queue: InputEvent[] = [];
  private keyupSeen = false;
  private gamepadEnabled = false;
  private padPrev: boolean[] = [];
  private padAxes = { x: 0, y: 0 };
  private padWeb = false;

  constructor(target: Window = window) {
    target.addEventListener("keydown", (e) => this.onKey(e, "down"), { capture: true });
    target.addEventListener("keyup", (e) => this.onKey(e, "up"), { capture: true });
    target.addEventListener("blur", () => this.held.clear());
  }

  enableGamepad(on: boolean) {
    this.gamepadEnabled = on;
  }

  private onKey(e: KeyboardEvent, type: "down" | "up") {
    const action = KEYMAP[e.code] ?? KEYMAP[e.key];
    if (!action) return;
    if (e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    const now = performance.now();
    const st = this.held.get(action) ?? { down: false, lastSeen: 0, repeats: 0 };
    if (type === "down") {
      const repeat = e.repeat || st.down;
      st.repeats = repeat ? st.repeats + 1 : 0;
      st.down = true;
      st.lastSeen = now;
      this.held.set(action, st);
      this.queue.push({ action, type, repeat, time: now });
    } else {
      this.keyupSeen = true;
      st.down = false;
      this.held.set(action, st);
      this.queue.push({ action, type, repeat: false, time: now });
    }
  }

  /** True when this host reports key releases (affects hold-to-swing). */
  get hasKeyUp() {
    return this.keyupSeen || this.gamepadEnabled;
  }

  isHeld(action: Action, now = performance.now()): boolean {
    const st = this.held.get(action);
    if (st?.down) {
      if (this.keyupSeen) return true;
      // No keyup on this host: held while repeats keep arriving. The first gap covers
      // the initial auto-repeat delay; after that, repeats come every ~50-100 ms.
      const window = st.repeats > 0 ? 160 : 260;
      if (now - st.lastSeen < window) return true;
      st.down = false;
    }
    return false;
  }

  drain(): InputEvent[] {
    this.pollGamepad();
    return this.queue.splice(0, this.queue.length);
  }

  /** -1..1, analog when a pad stick is in use. */
  steerAxis(): number {
    let v = 0;
    if (this.isHeld("left")) v -= 1;
    if (this.isHeld("right")) v += 1;
    if (Math.abs(this.padAxes.x) > Math.abs(v)) v = this.padAxes.x;
    return v;
  }

  verticalAxis(): number {
    let v = 0;
    if (this.isHeld("up")) v += 1;
    if (this.isHeld("down")) v -= 1;
    if (Math.abs(this.padAxes.y) > Math.abs(v)) v = this.padAxes.y;
    return v;
  }

  private pollGamepad() {
    if (!this.gamepadEnabled || !navigator.getGamepads) return;
    const pad = Array.from(navigator.getGamepads()).find((p) => p && p.mapping === "standard") ?? null;
    if (!pad) {
      this.padAxes.x = this.padAxes.y = 0;
      return;
    }
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    this.padAxes.x = dz(pad.axes[0] ?? 0);
    this.padAxes.y = -dz(pad.axes[1] ?? 0);
    const now = performance.now();
    const pressed = pad.buttons.map((b) => b.pressed || b.value > 0.4);
    const edge = (i: number, action: Action) => {
      if (pressed[i] && !this.padPrev[i]) this.queue.push({ action, type: "down", repeat: false, time: now });
      if (!pressed[i] && this.padPrev[i]) this.queue.push({ action, type: "up", repeat: false, time: now });
    };
    edge(0, "select"); // A / Cross
    edge(1, "back"); // B / Circle
    edge(9, "back"); // Start/Options opens the pause menu
    edge(12, "up");
    edge(13, "down");
    edge(14, "left");
    edge(15, "right");
    // Right trigger is a true analog hold-to-swing.
    const rt = pressed[7] || pressed[5];
    if (rt !== this.padWeb) {
      this.queue.push({ action: "select", type: rt ? "down" : "up", repeat: false, time: now });
      this.padWeb = rt;
    }
    this.padPrev = pressed;
  }
}
