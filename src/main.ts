import "./styles.css";

import { Game } from "./game/game";
import { connectLittle } from "./platform/little";
import { Hud } from "./view/hud";
import { PropLibrary } from "./world/props";

const stage = document.getElementById("stage")!;
const little = connectLittle();
const hud = new Hud(stage);

// The Little host scales the 1920×1080 canvas to the panel. Without the SDK
// (plain browser), letterbox it the same way so layout is identical.
if (little.isStub) {
  const fit = () => {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = `translate(${(window.innerWidth - 1920 * s) / 2}px, ${(window.innerHeight - 1080 * s) / 2}px) scale(${s})`;
  };
  window.addEventListener("resize", fit);
  fit();
}

async function boot() {
  // The portal labels draw with both into canvases, so they must be ready first.
  await Promise.all([document.fonts.load('40px "Bungee"'), document.fonts.load('700 40px "Fredoka"')]).catch(() => undefined);
  const lib = await PropLibrary.load((p) => hud.setLoading(p * 0.8));
  hud.setLoading(0.9);
  // Let the bar paint before the synchronous city build.
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const game = new Game(stage, lib, little, hud);
  hud.setLoading(1);
  hud.hideLoading();
  // One bad frame must not stop the loop for good; each distinct error is logged once.
  const seen = new Set<string>();
  const errors: string[] = [];
  (window as unknown as { __frameErrors: string[] }).__frameErrors = errors;
  const loop = () => {
    requestAnimationFrame(loop);
    try {
      game.frame();
    } catch (err) {
      const text = err instanceof Error ? (err.stack ?? err.message) : String(err);
      if (!seen.has(text)) {
        seen.add(text);
        errors.push(text);
        console.error("[frame]", err);
      }
    }
  };
  requestAnimationFrame(loop);
}

boot().catch((err) => {
  console.error(err);
  const msg = document.createElement("pre");
  msg.className = "boot-error";
  msg.textContent = `City Crawlers failed to start:\n${err instanceof Error ? err.message : String(err)}`;
  stage.append(msg);
});
