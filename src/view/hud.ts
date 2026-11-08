// DOM HUD + menus on the 1920×1080 canvas. Big type, high contrast, chunky shapes,
// and data-little-* annotations so the Little agent can read and drive it.

import { BodyGuide } from "./bodyGuide";

export type MenuItem = {
  id: string;
  /** Plain text: what the Little agent reads, and the button unless `html` is given. */
  label: string;
  html?: string;
  locked?: boolean;
  action: string;
  onSelect: () => void;
};
export type Results = {
  heading: string;
  score: number; best: number; newBest: boolean; stars: number; grade: string;
  rows: Array<[string, string]>;
  note?: string;
};
export type GuidePanel = {
  title: string;
  /** Right-hand column: steps, a message, whatever the moment needs. */
  side: string;
  footer: string;
  data?: Record<string, unknown>;
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
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
      const b = el("button", it.html ? "btn rich" : "btn", it.html ?? it.label);
      b.classList.toggle("locked", !!it.locked);
      b.dataset.little = "control";
      b.dataset.littleId = it.id;
      b.dataset.littleAction = it.action;
      b.dataset.littleLabel = it.locked ? `${it.label} (locked)` : it.label;
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
  /** In-game camera view (skeleton only: cheap enough to run beside the city). */
  readonly pip = new BodyGuide(400, 225, { compact: true });
  /** The big mirror for getting set up, with the live camera picture. */
  readonly mirror = new BodyGuide(864, 486);
  readonly menu: Menu;
  menuOpen = false;
  private readonly top: HTMLElement;
  private readonly score: HTMLElement;
  private readonly combo: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly section: HTMLElement;
  private readonly callouts: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly center: HTMLElement;
  private readonly ready: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly fadeEl: HTMLElement;
  private readonly loading: HTMLElement;
  private readonly pipSlot: HTMLElement;
  private readonly debugEl: HTMLElement;
  private readonly reticle: HTMLElement;
  private readonly credit: HTMLElement;
  private lastStats = "";
  private lastProgress = "";

  constructor(parent: HTMLElement) {
    this.root = el("div", "hud");
    parent.append(this.root);

    this.top = el("div", "hud-top");
    this.top.dataset.little = "region";
    this.top.dataset.littleLabel = "Run status";
    const bar = el("div", "progress", "<i></i>");
    this.progress = bar.querySelector("i") as HTMLElement;
    this.section = el("div", "section");
    this.score = el("div", "score", "0");
    this.score.dataset.little = "readout";
    this.score.dataset.littleLabel = "Score";
    this.combo = el("div", "combo");
    this.combo.dataset.little = "readout";
    this.combo.dataset.littleLabel = "Combo";
    this.top.append(bar, this.section, this.score, this.combo);

    this.callouts = el("div", "callouts");
    this.hint = el("div", "hint hidden");
    this.prompt = el("div", "prompt hidden");
    this.center = el("div", "center-text");
    this.ready = el("div", "ready hidden");
    this.ready.dataset.little = "region";
    this.ready.dataset.littleLabel = "Get ready";
    this.pipSlot = el("div", "pip-slot");
    this.pipSlot.append(this.pip.root);
    this.overlay = el("div", "overlay hidden");
    this.flashEl = el("div", "flash");
    this.fadeEl = el("div", "fade");
    this.loading = el("div", "loading", `<div class="logo"><span>CITY</span><span class="l2">CRAWLERS</span></div><div class="load-bar"><i></i></div>`);
    this.debugEl = el("pre", "motion-debug hidden");
    this.reticle = el("div", "reticle hidden", "<i></i>");
    this.credit = el("div", "credit hidden");
    this.credit.dataset.little = "readout";
    this.credit.dataset.littleLabel = "Map data credit";
    this.menu = new Menu("Menu");
    this.root.append(
      this.flashEl, this.top, this.pipSlot, this.callouts, this.center, this.prompt, this.hint, this.ready,
      this.overlay, this.reticle, this.credit, this.debugEl, this.fadeEl, this.loading,
    );
    this.showRunHud(false);
    this.showPip(false);
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

  showPip(on: boolean) {
    this.pipSlot.classList.toggle("hidden", !on);
  }

  setStats(score: number, combo: number, mult: number, accuracy: number) {
    const key = `${score}|${combo}|${mult}`;
    if (key === this.lastStats) return;
    this.lastStats = key;
    this.score.textContent = score.toLocaleString("en-US");
    this.score.dataset.littleData = JSON.stringify({ value: score, accuracy: Math.round(accuracy * 100) });
    this.combo.innerHTML = combo >= 2 ? `${mult > 1 ? `<b>x${mult}</b>` : ""}<span>${combo} COMBO</span>` : "";
    this.combo.dataset.littleData = JSON.stringify({ combo, multiplier: mult });
    this.combo.classList.toggle("hot", mult > 1);
  }

  setProgress(frac: number, section: string) {
    this.progress.style.width = `${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%`;
    if (section !== this.lastProgress) {
      this.lastProgress = section;
      this.section.textContent = section.toUpperCase();
    }
  }

  callout(text: string, kind: "perfect" | "good" | "score" | "bad" | "info" | "big" = "score") {
    const c = el("div", `callout ${kind}`, text);
    this.callouts.append(c);
    setTimeout(() => c.remove(), kind === "big" ? 1600 : 1100);
    while (this.callouts.childElementCount > 3) this.callouts.firstElementChild?.remove();
  }

  setHint(html: string | null) {
    this.hint.classList.toggle("hidden", !html);
    if (html) this.hint.innerHTML = html;
  }

  /** Big instruction above the pose mirror (tracking lost, resume countdown). */
  setPrompt(html: string | null) {
    this.prompt.classList.toggle("hidden", !html);
    if (html && this.prompt.innerHTML !== html) this.prompt.innerHTML = html;
  }

  setCenter(text: string | null, cls = "") {
    this.center.className = `center-text ${cls}`;
    this.center.textContent = text ?? "";
    if (text) {
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

  /** Fade the whole screen to `color` (white for the jump through a portal). */
  fade(to: number, ms = 250, color = "#0d1226") {
    if (to > 0) this.fadeEl.style.background = color;
    this.fadeEl.style.transition = `opacity ${ms}ms ease`;
    this.fadeEl.style.opacity = String(to);
  }

  /** The rooftop aim point, in stage pixels; `lock` colors it when it's over a portal. */
  setReticle(pos: { x: number; y: number } | null, lock: string | null = null) {
    this.reticle.classList.toggle("hidden", !pos);
    if (!pos) return;
    this.reticle.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px)`;
    this.reticle.classList.toggle("lock", !!lock);
    this.reticle.style.setProperty("--lock", lock ?? "#ffffff");
  }

  /** Whose map the city on screen is built from (OpenStreetMap's license asks for it in view). */
  setCredit(text: string | null) {
    this.credit.classList.toggle("hidden", !text);
    if (text) this.credit.textContent = `Map data ${text}`;
  }

  setHubPrompt(html: string) {
    const p = this.overlay.querySelector(".hub-prompt");
    if (p && p.innerHTML !== html) p.innerHTML = html;
  }

  setDebug(text: string | null) {
    this.debugEl.classList.toggle("hidden", text === null);
    if (text !== null && this.debugEl.textContent !== text) this.debugEl.textContent = text;
  }

  // ---------------------------------------------------------------- body guide panel
  /** The big camera mirror with coaching beside it: setup, and finding the player again. */
  showGuide(p: GuidePanel) {
    this.ready.innerHTML = `<div class="ready-card"><h2>${p.title}</h2><div class="ready-body"><div class="ready-mirror"></div><div class="ready-side">${p.side}</div></div><div class="ready-foot">${p.footer}</div></div>`;
    this.ready.dataset.littleData = JSON.stringify(p.data ?? {});
    this.ready.querySelector(".ready-mirror")!.append(this.mirror.root);
    this.ready.classList.remove("hidden");
  }

  get guideOpen() {
    return !this.ready.classList.contains("hidden");
  }

  hideGuide() {
    this.ready.classList.add("hidden");
  }

  // ---------------------------------------------------------------- menus
  private open(html: string, label: string, items: MenuItem[], focus = 0, mode = "") {
    this.overlay.innerHTML = html;
    this.overlay.className = `overlay ${mode}`;
    this.overlay.dataset.little = "region";
    this.overlay.dataset.littleLabel = label;
    this.menu.set(items, focus);
    (this.overlay.querySelector(".menu-slot") ?? this.overlay).append(this.menu.root);
    this.root.classList.toggle("on-hub", mode === "hub-mode");
    this.menuOpen = true;
  }

  close() {
    this.overlay.classList.add("hidden");
    this.root.classList.remove("on-hub");
    this.menuOpen = false;
  }

  /** The rooftop: the city stays in view, with a prompt up top and the cities as buttons along the bottom. */
  showHub(items: MenuItem[], focus: number, note: string) {
    this.open(
      `<div class="hub">
        <div class="hub-head">
          <div class="logo"><span>CITY</span><span class="l2">CRAWLERS</span></div>
          <div class="hub-title">Choose your city</div>
          <div class="hub-prompt" data-little="readout" data-little-label="Rooftop prompt"></div>
        </div>
        <div class="menu-slot hub-cities"></div>
        <div class="hub-note">${note}</div>
      </div>`,
      "City select",
      items,
      focus,
      "hub-mode",
    );
  }

  showPause(items: MenuItem[], note = "") {
    this.open(`<div class="panel"><h2>PAUSED</h2>${note ? `<div class="note">${note}</div>` : ""}<div class="menu-slot"></div></div>`, "Pause menu", items);
  }

  showResults(r: Results, items: MenuItem[]) {
    const stars = [1, 2, 3].map((i) => `<span class="star ${i <= r.stars ? "on" : ""}" style="animation-delay:${0.25 + i * 0.18}s">★</span>`).join("");
    const rows = r.rows.map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join("");
    this.open(
      `<div class="panel results">
        <h2>${r.heading}</h2>
        <div class="result-head">
          <div class="grade" data-little="readout" data-little-label="Grade" data-little-data='{"value":"${r.grade}"}'>${r.grade}</div>
          <div>
            <div class="stars" data-little="readout" data-little-label="Stars" data-little-data='{"value":${r.stars}}'>${stars}</div>
            <div class="final" data-little="readout" data-little-label="Final score" data-little-data='{"value":${r.score}}'>${r.score.toLocaleString("en-US")}</div>
          </div>
        </div>
        ${r.newBest ? `<div class="newbest">NEW BEST!</div>` : `<div class="bestline">BEST ${r.best.toLocaleString("en-US")}</div>`}
        <div class="rows">${rows}</div>
        ${r.note ? `<div class="note" data-little="readout" data-little-label="Note">${r.note}</div>` : ""}
        <div class="menu-slot"></div>
      </div>`,
      "Results",
      items,
    );
  }
}
