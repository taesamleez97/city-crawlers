// The intro: gameplay stills cut in like comic panels, one per move the game asks for;
// a page of all four cities; the logo built up piece by piece; then a portal opens
// at the hub of the logo's web and zooms through to the live rooftop underneath.
//
// It plays over the running game, timed by one GSAP timeline. `skip()` jumps to the
// portal; `skip(true)` removes it at once.

import { gsap } from "gsap";
import { swirlTexture } from "../game/hub";
import { CITIES, cityById, type CityId } from "../world/cities";
import { LOGO_ART, logoSvg } from "./logo";

const base = import.meta.env.BASE_URL;
const still = (name: string) => `${base}stills/${name}.jpg`;

/** The logo on screen: its width and top edge on the 1920×1080 stage. */
const LOGO_W = 1180;
const LOGO_TOP = 150;
const LOGO_K = LOGO_W / LOGO_ART.width;
/** The portal opens at the web's hub: high over the sun, clear of the letters. */
const PORTAL_X = (1920 - LOGO_W) / 2 + LOGO_ART.webHub[0] * LOGO_K;
const PORTAL_Y = LOGO_TOP + (LOGO_ART.webHub[1] - LOGO_ART.top) * LOGO_K;
const PORTAL_R = 124;
/** Portal rim thickness, px. */
const RIM = 40;
/** The hole grows past the screen's far corner from the portal. */
const HOLE_END = Math.hypot(Math.max(PORTAL_X, 1920 - PORTAL_X), 1080 - PORTAL_Y) + RIM + 40;

interface Shot {
  img: string;
  city: CityId;
  line: string;
  /** A ring to shoot, as a fraction of the still. */
  ring?: [number, number];
  /** Lean direction to dodge the girder. */
  lean?: -1 | 1;
}

const SHOTS: Shot[] = [
  { img: "nyc-swing", city: "nyc", line: "Swing real streets" },
  { img: "tokyo-ring", city: "tokyo", line: "Shoot on the beat", ring: [0.629, 0.25] },
  { img: "seoul-beam", city: "seoul", line: "Lean to dodge", lean: 1 },
];
/** One still per city for the page of all four. */
const PAGE: Record<CityId, string> = { nyc: "nyc-swing", tokyo: "tokyo-ring", seoul: "seoul-beam", la: "la-swing" };

export const INTRO_STILLS = [...new Set([...SHOTS.map((s) => s.img), ...Object.values(PAGE)])];

/** Fetch and decode stills, so no panel cuts in blank. */
export function preloadStills(names: string[]) {
  return Promise.all(
    names.map((n) => {
      const img = new Image();
      img.src = still(n);
      return img.decode().catch(() => undefined);
    }),
  );
}

export type IntroSound = "thwip" | "slam" | "whoosh";

export interface IntroHooks {
  sound(kind: IntroSound): void;
  /** The portal has opened all the way: the rooftop is the game again. */
  done(): void;
}

const words = (line: string) => line.split(" ").map((w) => `<span class="w">${w}</span>`).join(" ");

export class Intro {
  readonly root: HTMLElement;
  private readonly tl: gsap.core.Timeline;
  private readonly loops: gsap.core.Tween[] = [];
  private finished = false;

  constructor(parent: HTMLElement, private readonly hooks: IntroHooks) {
    this.root = document.createElement("div");
    this.root.className = "intro";
    this.root.innerHTML =
      `<div class="intro-film">${SHOTS.map((s) => this.panel(s)).join("")}</div>` +
      `<div class="intro-page">${CITIES.map((c) =>
        `<div class="intro-cell" style="--c:${c.color}"><div class="intro-cell-shot"><img src="${still(PAGE[c.id])}" alt=""></div><b>${c.name}</b></div>`,
      ).join("")}</div>` +
      `<div class="intro-title">` +
      `<div class="intro-rays" style="left:${PORTAL_X}px;top:${PORTAL_Y}px"></div>` +
      `<div class="intro-logo" style="left:${(1920 - LOGO_W) / 2}px;top:${LOGO_TOP}px;width:${LOGO_W}px">${logoSvg("logo-art")}</div>` +
      `<div class="intro-cities">${CITIES.map((c) => `<span style="--c:${c.color}">${c.name}</span>`).join("")}</div>` +
      `</div>` +
      `<div class="intro-portal" style="left:${PORTAL_X}px;top:${PORTAL_Y}px"><div class="intro-swirl"></div><div class="intro-rim"></div></div>` +
      `<div class="intro-flash"></div>` +
      `<div class="intro-skip">Punch or press <b>OK</b> to skip</div>`;
    parent.append(this.root);

    // The portal: a swirl inside a rim in every city's color.
    const swirl = this.$(".intro-swirl");
    const rim = this.$(".intro-rim");
    const inner = PORTAL_R - RIM;
    swirl.style.width = swirl.style.height = `${2 * inner + 8}px`;
    swirl.style.backgroundImage =
      `url(${(swirlTexture().image as HTMLCanvasElement).toDataURL()}), radial-gradient(circle, #b79cff 0%, #6b3fcb 55%, #2c1c6e 100%)`;
    const colors = [...CITIES.map((c) => c.color), CITIES[0].color].join(", ");
    rim.style.background =
      `radial-gradient(closest-side, transparent calc(100% - ${RIM}px), var(--ink) calc(100% - ${RIM}px) calc(100% - ${RIM - 7}px), ` +
      `transparent calc(100% - ${RIM - 7}px) calc(100% - 7px), var(--ink) calc(100% - 7px)), conic-gradient(${colors})`;
    rim.style.width = rim.style.height = `${2 * PORTAL_R}px`;
    gsap.set([swirl, rim], { xPercent: -50, yPercent: -50 });

    this.tl = this.build();
  }

  private panel(s: Shot) {
    const city = cityById(s.city)!;
    let fx = "";
    if (s.ring) {
      fx = `<div class="intro-ring" style="left:${s.ring[0] * 100}%;top:${s.ring[1] * 100}%"><i class="approach"></i><i class="burst"></i><b class="now">NOW!</b></div>`;
    }
    if (s.lean) fx = `<div class="intro-lean ${s.lean > 0 ? "right" : "left"}"><i></i><i></i><i></i></div>`;
    return (
      `<div class="intro-panel"><div class="intro-shot"><img src="${still(s.img)}" alt="">${fx}</div>` +
      `<div class="intro-tag" style="--c:${city.color}">${city.name}</div>` +
      `<div class="intro-line">${words(s.line)}</div></div>`
    );
  }

  private $(sel: string) {
    return this.root.querySelector(sel) as HTMLElement;
  }
  private $$(sel: string) {
    return Array.from(this.root.querySelectorAll(sel)) as HTMLElement[];
  }

  private build() {
    const tl = gsap.timeline({ onComplete: () => this.finish() });
    const panels = this.$$(".intro-panel");
    const sound = (kind: IntroSound) => () => this.hooks.sound(kind);

    tl.from(this.root, { opacity: 0, duration: 0.35, ease: "power1.out" }, 0);
    tl.from(this.$(".intro-skip"), { opacity: 0, y: 20, duration: 0.4 }, 0.9);

    // Three panels, each wiping in over the last.
    const BEAT = 1.65;
    panels.forEach((p, i) => {
      const t = 0.1 + i * BEAT;
      const dir = i % 2 ? -1 : 1;
      const shot = p.querySelector(".intro-shot") as HTMLElement;
      const from = dir > 0 ? "polygon(0% 0%, 0% 0%, -25% 100%, 0% 100%)" : "polygon(100% 0%, 125% 0%, 100% 100%, 100% 100%)";
      const to = dir > 0 ? "polygon(0% 0%, 125% 0%, 100% 100%, 0% 100%)" : "polygon(-25% 0%, 125% 0%, 100% 100%, 0% 100%)";
      tl.set(p, { visibility: "visible" }, t);
      tl.fromTo(p, { clipPath: from }, { clipPath: to, duration: 0.42, ease: "power3.out" }, t);
      tl.fromTo(shot, { scale: 1.22, x: 50 * dir }, { scale: 1.05, x: 0, duration: BEAT + 0.6, ease: "sine.out" }, t);
      tl.from(p.querySelector(".intro-tag"), { x: -260, duration: 0.4, ease: "back.out(1.6)" }, t + 0.18);
      tl.from(p.querySelectorAll(".intro-line .w"), {
        scale: 2.6, opacity: 0, rotation: () => gsap.utils.random(-14, 14), duration: 0.36, ease: "back.out(2.2)", stagger: 0.08,
      }, t + 0.24);
      tl.call(sound("slam"), [], t + 0.3);

      const ring = p.querySelector(".intro-ring");
      if (ring) {
        tl.fromTo(ring.querySelector(".approach"), { scale: 2.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.85, ease: "none" }, t + 0.25);
        tl.to(ring.querySelector(".approach"), { opacity: 0, duration: 0.1 }, t + 1.1);
        tl.fromTo(ring.querySelector(".burst"), { scale: 0.6, opacity: 1 }, { scale: 2.4, opacity: 0, duration: 0.5, ease: "power2.out", immediateRender: false }, t + 1.1);
        tl.fromTo(ring.querySelector(".now"), { scale: 0, rotation: -12 }, { scale: 1, rotation: -6, duration: 0.3, ease: "back.out(3)" }, t + 1.1);
        tl.call(sound("thwip"), [], t + 1.1);
      }
      const lean = p.querySelector(".intro-lean");
      if (lean) {
        // Leaning slides the view the other way and rolls it a little; the arrows stay put.
        const s = lean.classList.contains("right") ? 1 : -1;
        tl.from(lean.querySelectorAll("i"), { opacity: 0, x: -40 * s, duration: 0.25, stagger: 0.08, ease: "power2.out" }, t + 0.35);
        tl.to(shot.querySelector("img"), { x: -110 * s, rotation: -2.5 * s, scale: 1.12, duration: 0.6, ease: "power2.inOut" }, t + 0.7);
        tl.call(sound("whoosh"), [], t + 0.7);
      }
    });

    // The page of all four cities.
    const tPage = 0.1 + panels.length * BEAT;
    const cells = this.$$(".intro-cell");
    tl.set(this.$(".intro-page"), { visibility: "visible" }, tPage);
    tl.from(cells, {
      scale: 0.5, opacity: 0, rotation: (i: number) => (i % 2 ? 8 : -8), duration: 0.42, ease: "back.out(1.7)", stagger: 0.09,
    }, tPage);
    tl.from(this.$$(".intro-cell b"), { y: 60, opacity: 0, duration: 0.3, ease: "back.out(2)", stagger: 0.09 }, tPage + 0.2);
    tl.fromTo(this.$$(".intro-cell img"), { scale: 1.18 }, { scale: 1.04, duration: 1.6, ease: "sine.out" }, tPage);
    tl.call(sound("slam"), [], tPage + 0.1);

    // Flash to the title.
    const tLogo = tPage + 1.15;
    const flash = this.$(".intro-flash");
    tl.to(flash, { opacity: 1, duration: 0.12, ease: "power1.in" }, tLogo - 0.12);
    tl.set([this.$(".intro-film"), this.$(".intro-page")], { visibility: "hidden" }, tLogo);
    tl.set(this.$(".intro-title"), { visibility: "visible" }, tLogo);
    tl.to(flash, { opacity: 0, duration: 0.45, ease: "power2.out" }, tLogo);
    this.logo(tl, tLogo);

    // The portal: a swirl at the web's hub, then a hole that grows through everything.
    tl.addLabel("portal", tLogo + 2.8);
    this.portal(tl, "portal");
    return tl;
  }

  /** Build the logo: sun, web, skyline rising, clouds, CITY slammed down, CRAWLERS sliding in. */
  private logo(tl: gsap.core.Timeline, t: number) {
    const svg = this.$(".intro-logo svg");
    const q = (sel: string) => Array.from(svg.querySelectorAll(sel));
    const [hx, hy] = LOGO_ART.webHub;
    const [cx, cy] = LOGO_ART.cityAt;
    const sound = (kind: IntroSound) => () => this.hooks.sound(kind);

    this.loops.push(gsap.to(this.$(".intro-rays"), { rotation: 360, duration: 40, ease: "none", repeat: -1 }));
    tl.from(this.$(".intro-rays"), { opacity: 0, scale: 0.4, duration: 0.8, ease: "power2.out" }, t);
    tl.from(q(".lg-sun"), { scale: 0, transformOrigin: "50% 50%", duration: 0.5, ease: "back.out(1.8)" }, t + 0.05);
    tl.from(q(".lg-web"), { scale: 0.08, opacity: 0, svgOrigin: `${hx} ${hy}`, duration: 0.65, ease: "expo.out" }, t + 0.28);
    tl.call(sound("thwip"), [], t + 0.28);
    tl.from(q(".lg-b"), { y: 470, duration: 0.55, ease: "back.out(1.3)", stagger: { each: 0.035, from: "center" } }, t + 0.35);
    tl.from(q(".lg-cloud"), { x: (i: number) => (i ? 300 : -300), opacity: 0, duration: 0.7, ease: "power3.out" }, t + 0.5);
    tl.from(q(".lg-city"), { scale: 2.8, opacity: 0, svgOrigin: `${cx} ${cy}`, duration: 0.3, ease: "power4.in" }, t + 0.9);
    tl.call(sound("slam"), [], t + 1.2);
    tl.to(this.$(".intro-logo"), {
      keyframes: [{ x: -14, y: 10 }, { x: 12, y: -8 }, { x: -6, y: 4 }, { x: 0, y: 0 }], duration: 0.3, ease: "none",
    }, t + 1.2);
    tl.from(q(".lg-crawlers"), { x: 1800, skewX: -18, duration: 0.5, ease: "back.out(1.3)" }, t + 1.3);
    tl.call(sound("slam"), [], t + 1.62);
    tl.from(this.$$(".intro-cities span"), { y: 50, opacity: 0, duration: 0.35, ease: "back.out(2)", stagger: 0.08 }, t + 1.75);
    tl.to(this.$(".intro-logo"), { scale: 1.025, duration: 1.0, ease: "sine.inOut", yoyo: true, repeat: 1 }, t + 2.0);
  }

  private portal(tl: gsap.core.Timeline, at: string) {
    const portal = this.$(".intro-portal");
    const swirl = this.$(".intro-swirl");
    const rim = this.$(".intro-rim");
    const title = this.$(".intro-title");
    const origin = `${PORTAL_X}px ${PORTAL_Y}px`;
    const hole = { r: 0 };
    const draw = () => {
      const r = hole.r;
      const m = r > 0 ? `radial-gradient(circle at ${PORTAL_X}px ${PORTAL_Y}px, transparent ${r}px, #000 ${r + 1}px)` : "none";
      this.root.style.setProperty("mask-image", m);
      this.root.style.setProperty("-webkit-mask-image", m);
      const size = 2 * Math.max(r + RIM, PORTAL_R);
      rim.style.width = rim.style.height = `${size}px`;
    };

    tl.set(portal, { visibility: "visible" }, at);
    tl.to(this.$(".intro-skip"), { opacity: 0, duration: 0.2 }, at);
    tl.call(() => this.hooks.sound("whoosh"), [], at);
    tl.fromTo(swirl, { scale: 0 }, { scale: 1, duration: 0.45, ease: "back.out(1.6)" }, at);
    tl.fromTo(rim, { scale: 0 }, { scale: 1, duration: 0.45, ease: "back.out(1.6)" }, at);
    tl.call(() => {
      this.loops.push(gsap.to(swirl, { rotation: -360, duration: 1.6, ease: "none", repeat: -1 }));
      this.loops.push(gsap.to(rim, { rotation: 360, duration: 2.4, ease: "none", repeat: -1 }));
    }, [], at);
    tl.to(hole, { r: HOLE_END, duration: 1.05, ease: "power2.in", onUpdate: draw }, `${at}+=0.5`);
    tl.to(title, { scale: 4.2, transformOrigin: origin, duration: 1.05, ease: "power2.in" }, `${at}+=0.5`);
    tl.to(swirl, { scale: 1.6, duration: 0.6, ease: "power2.in" }, `${at}+=0.5`);
    tl.to(rim, { opacity: 0, duration: 0.3 }, `${at}+=1.3`);
  }

  /** Cut to the portal; `now` removes the intro without it. */
  skip(now = false) {
    if (this.finished) return;
    if (now) {
      this.finish();
      return;
    }
    // Land just before the label, so the portal's own calls (sound, spin) still fire.
    const at = this.tl.labels.portal - 0.01;
    if (this.tl.time() < at) this.tl.seek(at);
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    this.tl.kill();
    for (const t of this.loops) t.kill();
    this.root.remove();
    this.hooks.done();
  }
}
