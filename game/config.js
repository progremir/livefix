// Tuning constants. Content lives in code (hot-reloads instantly);
// progress lives in `state` (survives every reload).

export const TILE = 32;

// The 2D maps extrude into a canyon this many tiles wide, along the z axis.
export const CORRIDOR_TILES = 7;
export const CORRIDOR_DEPTH = CORRIDOR_TILES * TILE;
export const CENTER_Z = CORRIDOR_DEPTH / 2;

export const PLAYER = {
  w: 22,
  h: 28,
  eye: 5,   // eye height below the top of the player's box, in px
};

export const LOOK = {
  sensitivity: 0.0025, // radians per mouse pixel
  keyTurn: 0.045,      // radians per tick for Q and E
  maxPitch: 1.45,
};

export const PHYSICS = {
  gravity: 0.8,      // px / tick^2
  groundAccel: 0.6,
  airAccel: 0.4,
  friction: 0.78,     // velocity multiplier per tick on the ground with no input
  maxRun: 4.2,        // px / tick
  jumpVelocity: 10.2, // initial upward speed
  jumpCut: 0.55,      // multiply upward speed when jump is released early
  jumpCutFrom: 7,     // a jump can only be cut once upward speed has dropped below this
  doubleJumpVelocity: 9.2, // initial upward speed of the mid-air jump
  jetThrust: 1.5,         // upward accel while jetting (applied before gravity)
  jetMaxRise: 6,          // max upward speed while jetting
  jetFuelMax: 90,         // max fuel ticks (~1.5 s of jetting)
  jetRecharge: 2.0,       // fuel regained per tick while on the ground
  flySpeed: 5.5,           // max vertical speed while flying
  flyMaxRun: 7,           // max horizontal speed while flying
  dashSpeed: 8,           // px/tick during dash
  dashTicks: 8,           // how long the dash lasts
  dashCooldown: 40,       // ticks between dashes
  coyoteTicks: 6,     // can still ground-jump this long after walking off a ledge
  jumpBufferTicks: 7, // a press this long before landing still jumps on landing
};

export const ENEMY = {
  w: 26,
  h: 22,
  speed: 1.1,
  weave: 2.4,    // how far enemies sway across the canyon, in tiles
  stompPad: 10,  // how far outside the enemy a falling player still stomps it
  hurtInset: 3,  // how far the player must overlap the enemy to get hurt
};

export const BULLET = {
  speed: 14,
  life: 36,
  cooldown: 8,
};

export const ARROW = {
  speed: 12,
  life: 50,
  cooldown: 20,
  gravity: 0.15,
};

export const BOMB = {
  speed: 9,
  gravity: 0.3,
  fuse: 50,
  radius: 80,
  maxCharge: 60,
};

export const HOOK = {
  speed: 22,
  maxRange: 600,
};

export const CHASE = {
  speed: 1.2,
  startOffset: 4,
};

export const RESPAWN_TICKS = 45;
export const RESPAWN_SAFE_TICKS = 180; // enemies can't hurt the player this long after respawning
export const BANNER_TICKS = 150; // how long a new level's name stays on screen

export const COLORS = {
  skyTop: '#1d2b53',
  skyBottom: '#7e5f9c',
  hillFar: '#3b3f74',
  hillNear: '#2b2d5a',
  ground: '#5b3a29',
  groundDark: '#3e2619',
  grass: '#4caf50',
  plank: '#c58b4b',
  spike: '#d8dee9',
  coin: '#ffd23f',
  coinEdge: '#c7951b',
  player: '#ff7a45',
  playerDark: '#c4502a',
  crownGem: '#ff4d6d',
  enemy: '#8e44ad',
  enemyDark: '#5e2d73',
  flag: '#ff4d6d',
  flagReached: '#4cd964',
  text: '#ffffff',
};
