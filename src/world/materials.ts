import { Color, MeshBasicMaterial, MeshLambertMaterial } from "three";

import { pal } from "./palette";

// One lit material for the whole world: vertex colors + Lambert (cheap on TV GPUs)
// + a facade pass that paints anti-aliased windows from per-vertex facade data.
// Geometry without facade attributes (props, kit models, instanced meshes) reads
// WebGL's default (0,0,0,1) and renders as plain flat color.

const FACADE_VERTEX_PARS = /* glsl */ `
attribute vec4 aFacadeA;
attribute vec4 aFacadeB;
attribute vec3 aWin;
varying vec4 vFacA;
varying vec4 vFacB;
varying vec3 vWin;
`;

const FACADE_VERTEX = /* glsl */ `
vFacA = aFacadeA;
vFacB = aFacadeB;
vWin = aWin;
`;

const FACADE_FRAGMENT_PARS = /* glsl */ `
varying vec4 vFacA;
varying vec4 vFacB;
varying vec3 vWin;
uniform vec3 uGlassLight;
uniform vec3 uFrame;

float ccHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ccBand(float x, float a, float b, float w) { return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x); }

vec3 ccFacade(vec3 wall) {
  float style = floor(vFacB.x + 0.5);
  float u = vFacA.x, v = vFacA.y, halfW = vFacA.z, topV = vFacA.w;
  float seed = vFacB.y, groundH = vFacB.z;
  // Ground-contact occlusion: facades darken toward the street, which seats
  // buildings in the city and deepens the street canyons.
  float ao = mix(0.70, 1.0, smoothstep(0.0, 11.0, v));
  if (style < 1.5) return wall * ao;

  float cellW = 3.2;
  float floorH = 3.6;
  vec4 win = vec4(0.2, 0.8, 0.3, 0.84);           // window rect inside a cell (x0,x1,y0,y1)
  float margin = 1.3;
  if (style > 2.5 && style < 3.5) { win = vec4(-0.05, 1.05, 0.34, 0.80); margin = 0.9; }
  else if (style > 3.5 && style < 4.5) { cellW = 2.4; win = vec4(0.08, 0.92, 0.07, 0.93); margin = 0.35; }
  else if (style > 4.5) { cellW = 3.0; win = vec4(0.27, 0.73, -0.05, 1.05); margin = 1.0; }

  float n = max(floor((2.0 * halfW - 2.0 * margin) / cellW), 1.0);
  float lx = (u + 0.5 * n * cellW) / cellW;
  float ly = (v - groundH) / floorH;
  float ix = floor(lx), iy = floor(ly);
  float fx = lx - ix, fy = ly - iy;
  vec2 w = fwidth(vec2(lx, ly)) * 0.75 + 1e-4;

  float inCols = ccBand(lx, 0.0, n, w.x);
  float inRows = ccBand(v, groundH + 0.3, topV - 0.9, w.y * floorH);
  float mx = ccBand(fx, win.x, win.y, w.x);
  float my = ccBand(fy, win.z, win.w, w.y);
  float mask = mx * my * inCols * inRows;

  float h = ccHash(vec2(ix, iy) + seed * 17.0);
  vec3 glass = mix(vWin, uGlassLight, step(0.86, h) * 0.6);
  // Fake depth: the top of every window sits in its lintel's shadow.
  float lintelY = win.w - (win.w - win.z) * 0.26;
  glass *= mix(1.0, 0.68, smoothstep(lintelY - w.y, lintelY + w.y, fy));
  vec3 c = mix(wall, glass, mask);
  if (style < 2.5) {
    float sill = ccBand(fy, win.z - 0.08, win.z, w.y) * mx * inCols * inRows;
    c = mix(c, min(wall * 1.22, vec3(1.0)), sill);
  }

  if (groundH > 0.5 && v < groundH) {
    float sw = 4.2;
    float sn = max(floor((2.0 * halfW - 1.2) / sw), 1.0);
    float sl = (u + 0.5 * sn * sw) / sw;
    vec2 sw2 = fwidth(vec2(sl, v)) * 0.75 + 1e-4;
    float shop = ccBand(fract(sl), 0.09, 0.91, sw2.x) * ccBand(sl, 0.0, sn, sw2.x) * ccBand(v, 0.6, groundH - 1.0, sw2.y);
    c = mix(wall * 0.8, vWin * 0.85, shop);
    c = mix(c, uFrame, ccBand(v, groundH - 0.95, groundH - 0.4, sw2.y) * 0.9);
  }

  // Far away, resolve to the facade's average so nothing shimmers on a TV.
  float coverage = clamp((win.y - win.x) * (win.w - win.z), 0.0, 1.0);
  vec3 avg = mix(wall, vWin, coverage * 0.8);
  c = mix(c, avg, smoothstep(0.3, 0.75, max(w.x, w.y)));
  return c * ao;
}
`;

export function createWorldMaterial() {
  const mat = new MeshLambertMaterial({ vertexColors: true });
  const uniforms = {
    uGlassLight: { value: new Color().copy(pal("glass_light")) },
    uFrame: { value: new Color().copy(pal("frame")) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${FACADE_VERTEX_PARS}`)
      .replace("#include <color_vertex>", `#include <color_vertex>\n${FACADE_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FACADE_FRAGMENT_PARS}`)
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\nif (vFacB.x > 0.5) diffuseColor.rgb = ccFacade(diffuseColor.rgb);",
      );
  };
  mat.customProgramCacheKey = () => "cc-world-v1";
  return mat;
}

export function createUnlitMaterial(color = 0xffffff, opts: { fog?: boolean; transparent?: boolean; opacity?: number } = {}) {
  return new MeshBasicMaterial({
    color,
    fog: opts.fog ?? true,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  });
}
