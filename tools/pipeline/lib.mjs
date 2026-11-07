import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, quantize, resample, weld } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BUILD = join(ROOT, "assets-build");
export const PUBLIC_MODELS = join(ROOT, "public", "models");

export function findBlender() {
  const candidates = [
    process.env.BLENDER,
    join(homedir(), "Applications/Blender.app/Contents/MacOS/Blender"),
    "/Applications/Blender.app/Contents/MacOS/Blender",
    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe",
    "/usr/bin/blender",
    "/snap/bin/blender",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (found) return found;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["blender"], { encoding: "utf8" });
  if (which.status === 0) return which.stdout.trim().split("\n")[0];
  throw new Error("Blender not found. Install Blender 4.2+ or set BLENDER=/path/to/blender.");
}

export function runBlender(script, args = [], { blend } = {}) {
  const blender = findBlender();
  const argv = ["-b", ...(blend ? [blend] : ["--factory-startup"]), "-P", join(ROOT, "tools", "blender", script), "--", ...args];
  console.log(`\n▶ blender ${script} ${args.join(" ")}`);
  const res = spawnSync(blender, argv, { cwd: ROOT, encoding: "utf8" });
  const out = `${res.stdout}\n${res.stderr}`;
  for (const line of out.split("\n")) {
    if (/\[cc\]|Error|Traceback|Exception|^\s+File "/.test(line)) console.log("  " + line.trim());
  }
  if (res.status !== 0 || /Traceback/.test(out)) {
    throw new Error(`Blender script ${script} failed (exit ${res.status}).`);
  }
}

let ioPromise;
async function getIO() {
  if (!ioPromise) {
    ioPromise = (async () => {
      await MeshoptEncoder.ready;
      return new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
    })();
  }
  return ioPromise;
}

/** Web/TV-ready GLB: dedup, weld, quantize, meshopt. Flat colors survive untouched. */
export async function optimizeGlb(input, output) {
  const io = await getIO();
  const doc = await io.read(input);
  await doc.transform(
    dedup(),
    prune({ keepLeaves: true, keepAttributes: true }),
    resample(),
    weld(),
    quantize({ quantizeColor: 8, quantizeNormal: 10, quantizePosition: 14 }),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  mkdirSync(dirname(output), { recursive: true });
  await io.write(output, doc);
  const before = statSync(input).size;
  const after = statSync(output).size;
  console.log(`  ✓ ${output.replace(ROOT + "/", "")}  ${(before / 1024).toFixed(1)} KB → ${(after / 1024).toFixed(1)} KB`);
}
