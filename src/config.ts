// Every feel-defining number in one place. Units: meters, seconds, radians.

export const TUNING = {
  gravity: 30,
  playerRadius: 0.6,
  maxSpeed: 46,
  airDrag: 0.0009, // quadratic

  // Webs
  ropeMin: 9,
  ropeMax: 72,
  ropeCatch: 0.88, // rope length after the "yank", as a fraction of attach distance
  catchRate: 9, // how fast the rope reaches its catch length
  minSwingSpeed: 15, // attaching tops you up to at least this speed along your heading
  autoPump: 5.5, // tangential accel on the downswing: keeps chains alive
  reelSpeed: 9, // Up while swinging shortens the web...
  reelBoost: 7, // ...and adds speed
  letOutSpeed: 10, // Down while swinging lengthens it
  lateralKeep: 0.3, // how much of the anchor's sideways offset the pivot keeps (0 = planar swing)
  lateralKeepSteer: 0.85, // ...when leaning toward the anchor (corner swings)
  swingFloor: 7, // lowest swing bottom (m above street) unless the player holds Down

  // Release
  releaseBoost: 0.14,
  releasePop: 5,
  perfectWindow: [0.22, 0.78] as const, // vertical share of velocity that counts as a good release

  // Air control
  yawRateSwing: 1.75,
  yawRateAir: 1.45,
  maxTurnRadius: 15, // at full lean, turning never gets wider than this
  strafeAccel: 11,
  streetAssist: 0.7, // rad/s pull toward the street axis when not steering
  streetAssistCone: 0.45, // only within this angle of an axis
  glideGravity: 0.42,
  diveGravity: 1.9,

  // Hazards
  crashSpeed: 15, // impact speed into a wall that counts as a crash
  invulnTime: 1.4,
  hearts: 3,

  // Targeting
  anchorMinDist: 9,
  anchorMaxDist: 68,
  anchorIdealDist: 30,
  anchorMinRise: 6,

  // Camera
  fovBase: 70,
  fovFast: 90,
  yawFollow: 5,
  pitchFollow: 3.5,
  rollMax: 0.15,
} as const;
