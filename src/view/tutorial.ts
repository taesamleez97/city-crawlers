// Setup demos: a gameplay still per move with a looping overlay that shows it.
// Shots: the ring's approach circle closes, then the web flies from that hand
// with a splat and NOW!. Leans: arrows, then the view slides past the girder.
// The framing step: a figure steps back until the box turns green.
//
// The rings sit where the game drew them in the capture (cues hidden there, so the
// overlay is the only ring); the figure inset is the same one the camera mirror uses.

import { gsap } from "gsap";
import { LEAN_COLOR, LEFT_COLOR, RIGHT_COLOR, figureSvg } from "./cueStyle";

const base = import.meta.env.BASE_URL;
const still = (name: string) => `${base}stills/${name}.jpg`;

export type DemoId = "frame" | "shootR" | "shootL" | "leanL" | "leanR" | "ready";

/** The overlay's own units: the still's 16:9 frame. */
const VW = 1600;
const VH = 900;
/** Rings show half again their size in the game: the card is small. */
const RING_K = 1.5;

/** Where the game drew each ring (fractions of the frame; radius a fraction of the width). */
const SHOTS = {
  shootR: { img: "nyc-right", x: 0.656, y: 0.415, r: 0.0356, color: RIGHT_COLOR, hand: [1330, VH] },
  shootL: { img: "nyc-left", x: 0.394, y: 0.39, r: 0.0343, color: LEFT_COLOR, hand: [270, VH] },
} as const;
/** The lean still is dodged to the right; mirrored, it's dodged to the left. */
const LEAN_IMG = "nyc-lean";

export const TUTORIAL_STILLS = [SHOTS.shootR.img, SHOTS.shootL.img, LEAN_IMG, "nyc-swing"];

function shootHtml(id: "shootR" | "shootL") {
  const s = SHOTS[id];
  const x = s.x * VW, y = s.y * VH, r = s.r * VW * RING_K;
  const [hx, hy] = s.hand;
  const len = Math.hypot(x - hx, y - hy).toFixed(0);
  const web = (stroke: string, w: number) =>
    `<line class="demo-web" x1="${hx}" y1="${hy}" x2="${x}" y2="${y}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${len}" stroke-dashoffset="${len}"/>`;
  const blobs = Array.from({ length: 8 }, (_, i) => `<circle class="demo-blob" data-a="${(i / 8) * Math.PI * 2}" r="${(r * 0.2).toFixed(0)}" fill="#fff" stroke="#1d2244" stroke-width="6" opacity="0"/>`).join("");
  return (
    `<div class="step-demo shoot" data-demo="${id}" data-r="${r.toFixed(0)}">` +
    `<img src="${still(s.img)}" alt="">` +
    `<svg class="demo-fx" viewBox="0 0 ${VW} ${VH}">` +
    web("#1d2244", 26) + web("#ffffff", 12) +
    `<g transform="translate(${x.toFixed(0)} ${y.toFixed(0)})">` +
    `<g class="demo-target"><circle r="${r.toFixed(0)}" fill="rgba(255,255,255,0.3)" stroke="#1d2244" stroke-width="34"/>` +
    `<circle r="${r.toFixed(0)}" fill="none" stroke="${s.color}" stroke-width="20"/></g>` +
    `<circle class="demo-approach" r="${r.toFixed(0)}" fill="none" stroke="#ffffff" stroke-width="14"/>` +
    `<g class="demo-splat">${blobs}</g></g></svg>` +
    `<b class="demo-now" style="left:${(s.x * 100).toFixed(1)}%;top:${(s.y * 100).toFixed(1)}%">NOW!</b>` +
    `<i class="demo-fig ${id === "shootR" ? "at-left" : "at-right"}">${figureSvg(id)}</i>` +
    `</div>`
  );
}

function leanHtml(id: "leanL" | "leanR") {
  const side = id === "leanR" ? "right" : "left";
  return (
    `<div class="step-demo lean" data-demo="${id}">` +
    `<div class="demo-view"><img class="${side === "left" ? "mirrored" : ""}" src="${still(LEAN_IMG)}" alt=""></div>` +
    `<div class="demo-chev ${side}" style="--c:${LEAN_COLOR}"><i></i><i></i><i></i></div>` +
    `<i class="demo-fig at-${side === "right" ? "left" : "right"}">${figureSvg(id)}</i>` +
    `</div>`
  );
}

/** The demo card for a setup step. */
export function demoHtml(id: DemoId): string {
  if (id === "shootR" || id === "shootL") return shootHtml(id);
  if (id === "leanL" || id === "leanR") return leanHtml(id);
  if (id === "ready") {
    return `<div class="step-demo ready" data-demo="ready"><img src="${still("nyc-swing")}" alt=""><b class="demo-stamp">GO!</b></div>`;
  }
  return (
    `<div class="step-demo frame" data-demo="frame"><div class="demo-box"></div>` +
    `<i class="demo-person">${figureSvg("stance")}</i><b class="demo-ok">✓</b></div>`
  );
}

/** Loop the demo in `card` (from `demoHtml`); kill the timeline when the card goes. */
export function playDemo(card: HTMLElement | null): gsap.core.Timeline | null {
  if (!card) return null;
  const id = card.dataset.demo as DemoId;
  const $ = (sel: string) => card.querySelector(sel);
  const $$ = (sel: string) => Array.from(card.querySelectorAll(sel));
  const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.35 });

  if (id === "shootR" || id === "shootL") {
    const r = Number(card.dataset.r);
    const HIT = 1.3;
    tl.fromTo($(".demo-approach"), { attr: { r: r * 3 } }, { attr: { r }, duration: HIT, ease: "none" }, 0);
    tl.fromTo($(".demo-approach"), { opacity: 0 }, { opacity: 1, duration: 0.2 }, 0);
    tl.set($(".demo-approach"), { opacity: 0 }, HIT);
    tl.fromTo($$(".demo-web"), { strokeDashoffset: (_: number, el: Element) => Number(el.getAttribute("stroke-dasharray")), opacity: 1 },
      { strokeDashoffset: 0, duration: 0.12, ease: "none" }, HIT);
    tl.fromTo($(".demo-target"), { scale: 1.3, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.35, ease: "back.out(3)", immediateRender: false }, HIT + 0.08);
    tl.fromTo($$(".demo-blob"), { x: 0, y: 0, scale: 1, opacity: 1 }, {
      x: (_: number, el: Element) => Math.cos(Number((el as HTMLElement).dataset.a)) * r * 1.9,
      y: (_: number, el: Element) => Math.sin(Number((el as HTMLElement).dataset.a)) * r * 1.9,
      scale: 0.4, opacity: 0, duration: 0.45, ease: "power2.out", immediateRender: false,
    }, HIT + 0.1);
    tl.fromTo($(".demo-now"), { scale: 0, rotation: -14 }, { scale: 1, rotation: -6, duration: 0.3, ease: "back.out(3)" }, HIT + 0.08);
    tl.fromTo($(".demo-fig"), { scale: 1.25 }, { scale: 1, duration: 0.4, ease: "back.out(2.5)", immediateRender: false }, HIT);
    tl.to([$(".demo-now"), ...$$(".demo-web")], { opacity: 0, duration: 0.25 }, HIT + 0.85);
    tl.set($(".demo-now"), { scale: 0, opacity: 1 }, HIT + 1.1);
  } else if (id === "leanL" || id === "leanR") {
    // Leaning right moves the eye right, so the street slides left and rolls a little.
    const s = id === "leanR" ? 1 : -1;
    tl.fromTo($$(".demo-chev i"), { opacity: 0.15 }, { opacity: 1, duration: 0.18, stagger: 0.12, ease: "power1.out" }, 0);
    // The figure is drawn leaning; it starts turned back upright about its hips.
    tl.fromTo($(".demo-fig svg"), { rotation: -16 * s, transformOrigin: "50% 66%" }, { rotation: 0, duration: 0.45, ease: "power2.inOut" }, 0.45);
    tl.fromTo($(".demo-view"), { xPercent: 0, rotation: 0, scale: 1.25 }, { xPercent: -9 * s, rotation: -3 * s, duration: 0.55, ease: "power2.inOut" }, 0.5);
    tl.to($$(".demo-chev i"), { opacity: 0.15, duration: 0.2 }, 1.4);
    tl.to($(".demo-view"), { xPercent: 0, rotation: 0, duration: 0.5, ease: "power2.inOut" }, 1.6);
    tl.to($(".demo-fig svg"), { rotation: -16 * s, duration: 0.4, ease: "power2.inOut" }, 1.6);
  } else if (id === "frame") {
    tl.set($(".demo-box"), { borderColor: "#ffcc2e" }, 0);
    tl.set($(".demo-ok"), { scale: 0 }, 0);
    tl.fromTo($(".demo-person"), { scale: 1.9, y: 40 }, { scale: 1, y: 0, duration: 1.1, ease: "power2.inOut" }, 0.4);
    tl.set($(".demo-box"), { borderColor: "#4fd1a5" }, 1.5);
    tl.to($(".demo-ok"), { scale: 1, duration: 0.3, ease: "back.out(3)" }, 1.5);
    tl.to({}, { duration: 1.0 }, 1.8);
  } else {
    tl.fromTo($(".demo-stamp"), { scale: 2.4, opacity: 0, rotation: -20 }, { scale: 1, opacity: 1, rotation: -8, duration: 0.35, ease: "power4.in" }, 0);
    tl.fromTo($("img"), { scale: 1.12 }, { scale: 1, duration: 2.2, ease: "sine.out" }, 0);
  }
  return tl;
}
