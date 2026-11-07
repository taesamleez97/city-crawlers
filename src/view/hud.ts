// DOM HUD + menus on the 1920×1080 canvas. Big type, high contrast, chunky shapes,
// and data-little-* annotations so the Little agent can read and drive it.

const HEART = `<svg viewBox="0 0 7 6" shape-rendering="crispEdges"><path d="M1 0h2v1h1V0h2v1h1v2H6v1H5v1H4v1H3V5H2V4H1V3H0V1h1z"/></svg>`;
const COIN = `<svg viewBox="0 0 10 10"><path d="M3 0h4l3 3v4l-3 3H3L0 7V3z" fill="#FFB020"/><path d="M3.6 1.4h2.8l2.2 2.2v2.8L6.4 8.6H3.6L1.4 6.4V3.6z" fill="#FFD43A"/><rect x="4.4" y="3" width="1.2" height="4" rx=".4" fill="#B86A00"/></svg>`;
const HOOP = `<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="3.6" fill="none" stroke="#FF7A1A" stroke-width="2"/><path d="M5 1.4a3.6 3.6 0 0 1 3.6 3.6" fill="none" stroke="#fff" stroke-width="2"/></svg>`;

export type MenuItem = { id: string; label: string; action: string; onSelect: () => void };
export type Stats = {
  hearts: number; maxHearts: number; score: number; coins: number; coinsTotal: number;
  hoops: number; hoopsTotal: number; time: number; mult: number; combo: number;
};
export type Results = {
  finished: boolean; score: number; best: number; newBest: boolean; stars: number;
  hoops: number; hoopsTotal: number; coins: number; coinsTotal: number; time: number;
  rows: Array<[string, string]>;
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export const formatTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};

class Menu {
  readonly root: HTMLElement;
  private focus = 0;
  private buttons: HTMLButtonElement[] = [];
  private items: MenuItem[] = [];

  constructor(label: string) {
    this.root = el("nav", "menu");
    this.root.dataset.little = "region";
    this.root.dataset.littleLabel = label;
  }

  set(items: MenuItem[], focus = 0) {
    this.items = items;
    this.root.innerHTML = "";
    this.buttons = items.map((it, i) => {
      const b = el("button", "btn", it.label);
      b.dataset.little = "control";
      b.dataset.littleId = it.id;
      b.dataset.littleAction = it.action;
      b.dataset.littleLabel = it.label;
      b.dataset.littleOrder = String(i + 1);
      b.addEventListener("click", () => it.onSelect());
      this.root.append(b);
      return b;
    });
    this.setFocus(focus);
  }

  setFocus(i: number) {
    this.focus = (i + this.buttons.length) % this.buttons.length;
    this.buttons.forEach((b, k) => {
      b.classList.toggle("focused", k === this.focus);
      if (k === this.focus) b.dataset.littleState = "selected";
      else delete b.dataset.littleState;
    });
  }

  move(d: number) {
    if (this.buttons.length) this.setFocus(this.focus + d);
  }

  activate() {
    this.items[this.focus]?.onSelect();
  }
}

export class Hud {
  readonly root: HTMLElement;
  private readonly hearts: HTMLElement;
  private readonly score: HTMLElement;
  private readonly coins: HTMLElement;
  private readonly hoops: HTMLElement;
  private readonly hoopBar: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly combo: HTMLElement;
  private readonly callouts: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly center: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly fadeEl: HTMLElement;
  private readonly loading: HTMLElement;
  private readonly top: HTMLElement;
  private readonly pointer: HTMLElement;
  readonly menu: Menu;
  menuOpen = false;
  private lastStats = "";
  private segs: HTMLElement[] = [];

  constructor(parent: HTMLElement) {
    this.root = el("div", "hud");
    parent.append(this.root);

    this.top = el("div", "hud-top");
    this.top.dataset.little = "region";
    this.top.dataset.littleLabel = "Run status";

    const left = el("div", "hud-left");
    this.hearts = el("div", "hearts");
    this.hearts.dataset.little = "readout";
    this.hearts.dataset.littleLabel = "Hearts";
    this.combo = el("div", "combo");
    left.append(this.hearts, this.combo);

    const mid = el("div", "hud-mid");
    this.hoops = el("div", "pill hoops");
    this.hoops.dataset.little = "readout";
    this.hoops.dataset.littleLabel = "Hoops";
    this.hoopBar = el("div", "hoop-bar");
    this.timer = el("div", "timer");
    this.timer.dataset.little = "readout";
    this.timer.dataset.littleLabel = "Time";
    mid.append(this.hoops, this.hoopBar, this.timer);

    const right = el("div", "hud-right");
    this.score = el("div", "score");
    this.score.dataset.little = "readout";
    this.score.dataset.littleLabel = "Score";
    this.coins = el("div", "pill coins");
    this.coins.dataset.little = "readout";
    this.coins.dataset.littleLabel = "Coins";
    right.append(this.score, this.coins);

    this.top.append(left, mid, right);
    this.callouts = el("div", "callouts");
    this.hint = el("div", "hint");
    this.center = el("div", "center-text");
    this.overlay = el("div", "overlay hidden");
    this.flashEl = el("div", "flash");
    this.fadeEl = el("div", "fade");
    this.loading = el("div", "loading", `<div class="logo"><span>CITY</span><span class="l2">CRAWLERS</span></div><div class="load-bar"><i></i></div>`);
    this.menu = new Menu("Menu");
    this.pointer = el("div", "pointer", `<svg viewBox="0 0 88 88"><path d="M20 14 L76 44 L20 74 L32 44 Z" fill="#FF7A1A" stroke="#1d2244" stroke-width="7" stroke-linejoin="round"/></svg>`);
    this.root.append(this.flashEl, this.pointer, this.top, this.callouts, this.center, this.hint, this.overlay, this.fadeEl, this.loading);
    this.showRunHud(false);
  }

  setLoading(p: number) {
    (this.loading.querySelector("i") as HTMLElement).style.width = `${Math.round(p * 100)}%`;
  }
  hideLoading() {
    this.loading.classList.add("gone");
    setTimeout(() => this.loading.remove(), 700);
  }

  showRunHud(on: boolean) {
    this.top.classList.toggle("hidden", !on);
  }

  setupHoopBar(total: number) {
    this.hoopBar.innerHTML = "";
    this.segs = Array.from({ length: total }, () => {
      const s = el("i");
      this.hoopBar.append(s);
      return s;
    });
  }

  setHoopState(index: number, state: "hit" | "missed" | "open") {
    const s = this.segs[index];
    if (!s) return;
    s.className = state === "open" ? "" : state;
  }

  setStats(s: Stats) {
    const key = `${s.hearts}|${s.score}|${s.coins}|${s.hoops}|${s.mult}|${Math.floor(s.time * 10)}|${s.combo}`;
    if (key === this.lastStats) return;
    this.lastStats = key;
    this.hearts.innerHTML = Array.from({ length: s.maxHearts }, (_, i) => `<span class="heart ${i < s.hearts ? "" : "empty"}">${HEART}</span>`).join("");
    this.hearts.dataset.littleData = JSON.stringify({ value: s.hearts, max: s.maxHearts });
    this.score.textContent = s.score.toLocaleString("en-US");
    this.score.dataset.littleData = JSON.stringify({ value: s.score });
    this.coins.innerHTML = `${COIN}<b>${s.coins}</b><small>/${s.coinsTotal}</small>`;
    this.coins.dataset.littleData = JSON.stringify({ value: s.coins, total: s.coinsTotal });
    this.hoops.innerHTML = `${HOOP}<b>${s.hoops}</b><small>/${s.hoopsTotal}</small>`;
    this.hoops.dataset.littleData = JSON.stringify({ value: s.hoops, total: s.hoopsTotal });
    this.timer.textContent = formatTime(s.time);
    this.timer.dataset.littleData = JSON.stringify({ seconds: Math.round(s.time * 10) / 10 });
    this.combo.innerHTML = s.mult > 1 ? `<b>x${s.mult}</b> COMBO` : s.combo > 0 ? `<span>COMBO ${s.combo}</span>` : "";
    this.combo.classList.toggle("hot", s.mult > 1);
  }

  callout(text: string, kind: "perfect" | "good" | "score" | "bad" | "info" | "big" = "score") {
    const c = el("div", `callout ${kind}`, text);
    this.callouts.append(c);
    setTimeout(() => c.remove(), kind === "big" ? 1600 : 1100);
    while (this.callouts.childElementCount > 4) this.callouts.firstElementChild?.remove();
  }

  floatScore(text: string, x: number, y: number) {
    const c = el("div", "float-score", text);
    c.style.left = `${x}px`;
    c.style.top = `${y}px`;
    this.root.append(c);
    setTimeout(() => c.remove(), 900);
  }

  /** Edge arrow toward an off-screen target; `dx, dy` is the screen-space direction (y up). */
  setPointer(dx: number, dy: number, visible: boolean) {
    this.pointer.classList.toggle("on", visible);
    if (!visible) return;
    const a = Math.atan2(dy, dx);
    const x = 960 + Math.cos(a) * 760, y = 540 - Math.sin(a) * 380;
    this.pointer.style.transform = `translate(${x - 44}px, ${y - 44}px) rotate(${-a}rad)`;
  }

  setHint(html: string | null) {
    this.hint.classList.toggle("hidden", !html);
    if (html) this.hint.innerHTML = html;
  }

  setCenter(text: string | null, cls = "") {
    this.center.className = `center-text ${cls}`;
    this.center.textContent = text ?? "";
    if (text) {
      // Restart the pop animation.
      this.center.style.animation = "none";
      void this.center.offsetWidth;
      this.center.style.animation = "";
    }
  }

  flash(color: string, strength = 0.55) {
    this.flashEl.style.transition = "none";
    this.flashEl.style.boxShadow = `inset 0 0 260px 90px ${color}`;
    this.flashEl.style.opacity = String(strength);
    void this.flashEl.offsetWidth;
    this.flashEl.style.transition = "opacity 650ms ease-out";
    this.flashEl.style.opacity = "0";
  }

  fade(to: number, ms = 250) {
    this.fadeEl.style.transition = `opacity ${ms}ms ease`;
    this.fadeEl.style.opacity = String(to);
  }

  private open(html: string, label: string, items: MenuItem[], focus = 0) {
    this.overlay.innerHTML = html;
    this.overlay.dataset.little = "region";
    this.overlay.dataset.littleLabel = label;
    this.menu.set(items, focus);
    (this.overlay.querySelector(".menu-slot") ?? this.overlay).append(this.menu.root);
    this.overlay.classList.remove("hidden");
    this.menuOpen = true;
  }

  close() {
    this.overlay.classList.add("hidden");
    this.menuOpen = false;
  }

  showTitle(best: number, items: MenuItem[], gamepad: boolean) {
    this.open(
      `<div class="title">
        <div class="logo big"><span>CITY</span><span class="l2">CRAWLERS</span></div>
        <div class="tagline">Swing the city. Thread the hoops. Grab every coin.</div>
        <div class="menu-slot"></div>
        ${best > 0 ? `<div class="best" data-little="readout" data-little-label="Best score" data-little-data='{"value":${best}}'>BEST ${best.toLocaleString("en-US")}</div>` : ""}
        ${controlsCard(gamepad)}
      </div>`,
      "Title",
      items,
    );
    this.overlay.classList.add("title-mode");
  }

  showPause(items: MenuItem[]) {
    this.overlay.classList.remove("title-mode");
    this.open(`<div class="panel"><h2>PAUSED</h2><div class="menu-slot"></div>${controlsCard(false)}</div>`, "Pause menu", items);
  }

  showResults(r: Results, items: MenuItem[]) {
    this.overlay.classList.remove("title-mode");
    const stars = [1, 2, 3].map((i) => `<span class="star ${i <= r.stars ? "on" : ""}" style="animation-delay:${0.25 + i * 0.18}s">★</span>`).join("");
    const rows = r.rows.map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join("");
    this.open(
      `<div class="panel results">
        <h2>${r.finished ? "ROUTE COMPLETE" : "OUT OF HEARTS"}</h2>
        <div class="stars" data-little="readout" data-little-label="Stars" data-little-data='{"value":${r.stars}}'>${stars}</div>
        <div class="final" data-little="readout" data-little-label="Final score" data-little-data='{"value":${r.score}}'>${r.score.toLocaleString("en-US")}</div>
        ${r.newBest ? `<div class="newbest">NEW BEST!</div>` : `<div class="bestline">BEST ${r.best.toLocaleString("en-US")}</div>`}
        <div class="rows">${rows}</div>
        <div class="menu-slot"></div>
      </div>`,
      "Results",
      items,
    );
  }
}

function controlsCard(gamepad: boolean) {
  const k = (t: string) => `<kbd>${t}</kbd>`;
  return `<div class="controls">
    <div>${k("OK")}<span>Web: tap to swing, tap again to let go</span></div>
    <div>${k("◀")}${k("▶")}<span>Steer &amp; lean</span></div>
    <div>${k("▲")}<span>Reel in / glide</span></div>
    <div>${k("▼")}<span>Let out / dive</span></div>
    <div>${k("BACK")}<span>Pause</span></div>
    ${gamepad ? `<div>${k("RT")}<span>Hold to swing (controller)</span></div>` : ""}
  </div>`;
}
