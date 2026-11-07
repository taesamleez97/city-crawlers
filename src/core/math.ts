import { Vector3 } from "three";

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential approach. `rate` is 1/seconds. */
export const damp = (current: number, target: number, rate: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

export function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export const dampAngle = (current: number, target: number, rate: number, dt: number) =>
  current + wrapAngle(target - current) * (1 - Math.exp(-rate * dt));

/** Critically-damped-ish spring for vectors; `stiffness` and `damping` tuned per use. */
export class SpringVec3 {
  readonly value = new Vector3();
  readonly velocity = new Vector3();
  private readonly tmp = new Vector3();
  constructor(
    public stiffness = 120,
    public damping = 18,
  ) {}
  step(target: Vector3, dt: number) {
    // Semi-implicit Euler, sub-stepped for stability at low frame rates.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.tmp.subVectors(target, this.value).multiplyScalar(this.stiffness);
      this.tmp.addScaledVector(this.velocity, -this.damping);
      this.velocity.addScaledVector(this.tmp, h);
      this.value.addScaledVector(this.velocity, h);
    }
    return this.value;
  }
  snap(v: Vector3) {
    this.value.copy(v);
    this.velocity.set(0, 0, 0);
  }
}

export class SpringScalar {
  value = 0;
  velocity = 0;
  constructor(
    public stiffness = 120,
    public damping = 18,
  ) {}
  step(target: number, dt: number) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = (target - this.value) * this.stiffness - this.velocity * this.damping;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
}

/** Deterministic PRNG so the city is identical on every device. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;
export const range = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();
export const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];
