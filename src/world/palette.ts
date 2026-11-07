import { Color } from "three";

import raw from "../../assets-src/palette.json";

// One palette for code-built geometry and Blender-adapted assets alike.
export type PaletteKey = keyof typeof raw;

const cache = new Map<string, Color>();

/** Palette color in the linear working space (what vertex colors expect). */
export function pal(key: PaletteKey): Color {
  let c = cache.get(key);
  if (!c) {
    c = new Color(raw[key]);
    cache.set(key, c);
  }
  return c;
}

export function palHex(key: PaletteKey): string {
  return raw[key];
}

export type RGB = [number, number, number];

export function rgb(key: PaletteKey, scale = 1): RGB {
  const c = pal(key);
  return [c.r * scale, c.g * scale, c.b * scale];
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function shade(c: RGB, s: number): RGB {
  return [c[0] * s, c[1] * s, c[2] * s];
}
