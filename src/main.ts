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
  await document.fonts.load('40px "Bungee"').catch(() => undefined);
  const lib = await PropLibrary.load((p) => hud.setLoading(p * 0.8));
  hud.setLoading(0.9);
  // Let the bar paint before the synchronous city build.
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const game = new Game(stage, lib, little, hud);
  hud.setLoading(1);
  hud.hideLoading();
  const loop = () => {
    game.frame();
    requestAnimationFrame(loop);
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
