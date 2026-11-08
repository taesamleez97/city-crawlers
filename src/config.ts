// Feel-defining numbers in one place. Units: meters, seconds, radians.

export const TUNING = {
  // Camera
  fovBase: 70,
  fovFast: 86,
  /** FOV widens between these speeds (m/s): tops of swings narrow, bottoms wide. */
  fovSpeedLo: 11,
  fovSpeedHi: 27,
  yawFollow: 5,
  pitchFollow: 3.5,
  /** Pitch tips this much toward the flight path, plus a bias, within limits: calm enough that the rings stay in view through a dive. */
  pitchFromVel: 0.22,
  pitchBias: -0.06,
  pitchMin: -0.26,
  pitchMax: 0.2,
  rollMax: 0.15,

  // Rails
  /** Route speed (route beats per music beat) right after a mistake… */
  slowRate: 0.45,
  /** …for this many beats, then a smooth catch-up of at most this much extra speed. */
  slowBeats: 0.8,
  catchUpMax: 0.6,
  /** How far the hero drops on a missed web, until the player's next web catches. */
  missSag: 5,
} as const;
