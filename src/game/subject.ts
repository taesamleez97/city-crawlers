import type { Vector3 } from "three";

export type SubjectState = "perched" | "air" | "swing" | "stunned";

/** What the camera rig and the first-person arms read about the hero. */
export interface Subject {
  readonly pos: Vector3;
  readonly vel: Vector3;
  /** Unit heading on the ground plane. */
  readonly heading: Vector3;
  /** Where the current web sticks (valid while swinging). */
  readonly anchor: Vector3;
  readonly speed: number;
  readonly state: SubjectState;
  /** -1..1 lean; rolls the camera and tilts the arms. */
  readonly steer: number;
  /** Side of the current web: -1 left, 1 right. */
  readonly swingSide: number;
}
