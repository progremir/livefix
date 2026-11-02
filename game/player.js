import { TILE, PLAYER, PHYSICS, RESPAWN_TICKS, RESPAWN_SAFE_TICKS, CENTER_Z, CORRIDOR_DEPTH, LOOK, CHASE } from './config.js';
import { tileAt, isSolid, getLevel } from './level.js';
import { burst, jumpDust, airJumpBurst } from './fx.js';
import { playSound } from './audio.js';

export function createPlayer(at) {
  return {
    x: at.x, y: at.y, z: CENTER_Z, vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0, // yaw 0 looks along +x, the direction the level runs
    w: PLAYER.w, h: PLAYER.h,
    onGround: false,
    alive: true, respawnTimer: 0,
    squash: 0,
    coyote: 0, jumpBuffer: 0, airJumps: 1, jetFuel: PHYSICS.jetFuelMax, jets: false,
    safeTicks: 0,
    dashCooldown: 0, dashTicks: 0, dashX: 1, dashZ: 0,
    fireCooldown: 0,
    wallSide: 0,
    hook: null,
    hookRightPrev: false,
    flying: false,
    flyTapTimer: 0,
    usingBow: false,
    stepTimer: 0,
  };
}

const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const JUMP = ['Space'];
const JET = ['ShiftLeft', 'ShiftRight'];
const DASH = ['KeyX', 'KeyK'];
const any = (set, keys) => keys.some((k) => set[k]);

export function updatePlayer(state, input, ctx) {
  const p = state.player;
  p.yaw += input.look.dx * LOOK.sensitivity + (input.down.KeyE ? LOOK.keyTurn : 0) - (input.down.KeyQ ? LOOK.keyTurn : 0);
  p.pitch = Math.max(-LOOK.maxPitch, Math.min(LOOK.maxPitch, p.pitch - input.look.dy * LOOK.sensitivity));
  if (!p.alive) {
    if (--p.respawnTimer <= 0) respawn(state, ctx);
    return;
  }
  if (p.safeTicks > 0) p.safeTicks--;

  // Fly mode: double-tap Space to toggle
  if (input.pressed.Space) {
    if (p.flyTapTimer > 0) {
      p.flying = !p.flying;
      p.vy = 0;
      ctx.emit(p.flying ? 'fly_on' : 'fly_off', { x: Math.round(p.x), y: Math.round(p.y) });
    } else {
      p.flyTapTimer = 10;
    }
  }
  if (p.flyTapTimer > 0) p.flyTapTimer--;

  // Movement, relative to where the player is looking
  const forward = any(input.down, FORWARD) - any(input.down, BACK);
  const strafe = any(input.down, RIGHT) - any(input.down, LEFT);
  const len = Math.hypot(forward, strafe) || 1;
  const cos = Math.cos(p.yaw), sin = Math.sin(p.yaw);
  const cosP = Math.cos(p.pitch);
  const wishX = (cos * cosP * forward - sin * strafe) / len;
  const wishY = (-Math.sin(p.pitch) * forward) / len;
  const wishZ = (sin * cosP * forward + cos * strafe) / len;
  const moving = forward !== 0 || strafe !== 0;

  const terrain = getLevel();
  const maxSpd = p.flying ? PHYSICS.flyMaxRun : PHYSICS.maxRun;
  const accel = p.flying ? 0.8 : (p.onGround ? terrain.groundAccel : PHYSICS.airAccel);
  if (moving) { p.vx += wishX * accel; p.vz += wishZ * accel; p.vy += wishY * accel; }
  else if (p.onGround && !p.flying) { p.vx *= terrain.friction; p.vz *= terrain.friction; }
  else if (p.flying) { p.vx *= 0.92; p.vz *= 0.92; }
  const speed = Math.hypot(p.vx, p.vz);
  if (speed > maxSpd) { p.vx *= maxSpd / speed; p.vz *= maxSpd / speed; }
  if (Math.abs(p.vx) < 0.05) p.vx = 0;
  if (Math.abs(p.vz) < 0.05) p.vz = 0;

  // Dash: toward the movement keys, or straight ahead if none are held
  if (p.dashCooldown > 0) p.dashCooldown--;
  if (p.flying) p.dashTicks = 0;
  if (p.dashTicks > 0 && !p.flying) {
    p.dashTicks--;
    p.vx = PHYSICS.dashSpeed * p.dashX;
    p.vz = PHYSICS.dashSpeed * p.dashZ;
  } else if (!p.flying && any(input.pressed, DASH) && p.dashCooldown <= 0) {
    p.dashX = moving ? wishX : cos;
    p.dashZ = moving ? wishZ : sin;
    p.dashTicks = PHYSICS.dashTicks;
    p.dashCooldown = PHYSICS.dashCooldown;
    p.vx = PHYSICS.dashSpeed * p.dashX;
    p.vz = PHYSICS.dashSpeed * p.dashZ;
    p.airJumps = 1;
    p.squash = -0.2;
    burst(state, ctx, p.x + p.w / 2, p.y + p.h / 2, '#9fe8ff', 8, 2);
    ctx.emit('dash', { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) });
  }

  // Wall running: stick to canyon walls when pressing into them while airborne
  p.wallSide = 0;
  if (!p.onGround && !p.flying) {
    if (p.z <= p.w / 2 + 1 && wishZ < 0) p.wallSide = -1;
    else if (p.z >= CORRIDOR_DEPTH - p.w / 2 - 1 && wishZ > 0) p.wallSide = 1;
  }

  // Jumping
  if (p.onGround) {
    p.coyote = PHYSICS.coyoteTicks;
    p.airJumps = 1;
  } else if (p.coyote > 0) {
    p.coyote--;
  }
  const jumpPressed = any(input.pressed, JUMP);
  const jumpHeld = any(input.down, JUMP);
  p.jumpBuffer = jumpPressed ? PHYSICS.jumpBufferTicks : Math.max(0, p.jumpBuffer - 1);

  if (!p.flying && p.wallSide !== 0 && jumpPressed) {
    const side = p.wallSide;
    p.vy = -5;
    p.vz = side * -5;
    p.wallSide = 0;
    p.airJumps = Math.max(0, p.airJumps - 1);
    p.squash = -0.4;
    airJumpBurst(state, ctx, p.x + p.w / 2, p.y + p.h);
    ctx.emit('wall_jump', { side, x: Math.round(p.x), y: Math.round(p.y) });
  } else if (!p.flying && p.jumpBuffer > 0 && p.coyote > 0) {
    p.vy = -PHYSICS.jumpVelocity;
    p.onGround = false;
    p.coyote = 0;
    p.jumpBuffer = 0;
    p.squash = -0.35;
    jumpDust(state, ctx, p.x + p.w / 2, p.y + p.h);
    playSound('jump');
    ctx.emit('jump', { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) });
  } else if (!p.flying && jumpPressed && p.airJumps > 0) {
    p.vy = -PHYSICS.doubleJumpVelocity;
    p.airJumps--;
    p.jumpBuffer = 0;
    p.squash = -0.5;
    airJumpBurst(state, ctx, p.x + p.w / 2, p.y + p.h);
    playSound('double_jump');
    ctx.emit('double_jump', { x: Math.round(p.x), y: Math.round(p.y) });
  }
  if (!p.flying && !jumpHeld && p.vy < -3 && p.vy > -PHYSICS.jumpCutFrom) p.vy *= PHYSICS.jumpCut;

  if (p.flying) {
    const fa = 0.7;
    if (any(input.down, JUMP)) p.vy -= fa;
    if (any(input.down, JET)) p.vy += fa;
    if (!any(input.down, JUMP) && !any(input.down, JET)) p.vy *= 0.9;
    p.vy = Math.max(-PHYSICS.flySpeed, Math.min(PHYSICS.flySpeed, p.vy));
    p.jets = false;
  } else {
    if (p.wallSide !== 0) {
      p.vy += PHYSICS.gravity * 0.1;
      if (p.vy > 1.0) p.vy = 1.0;
      if (p.vy < -3) p.vy = -3;
    } else {
      p.vy += PHYSICS.gravity;
    }
    const jetHeld = any(input.down, JET);
    p.jets = jetHeld && !p.onGround;
    if (p.jets) {
      p.vy -= PHYSICS.jetThrust;
      if (p.vy < -PHYSICS.jetMaxRise) p.vy = -PHYSICS.jetMaxRise;
    }
    if (p.onGround) p.jetFuel = Math.min(PHYSICS.jetFuelMax, p.jetFuel + PHYSICS.jetRecharge);
  }

  moveX(p);
  moveZ(p);
  moveY(state, p, ctx);

  // Running footsteps
  const runSpd = Math.hypot(p.vx, p.vz);
  if (p.onGround && runSpd > 1.5 && !p.flying) {
    p.stepTimer--;
    if (p.stepTimer <= 0) {
      p.stepTimer = Math.max(8, 16 - Math.floor(runSpd * 2));
      playSound('step');
    }
  } else {
    p.stepTimer = 0;
  }

  p.squash *= 0.8;

  const level = getLevel();
  if (!p.flying && p.y > level.height + 64) killPlayer(state, ctx, 'fell');
}

function moveX(p) {
  p.x += p.vx;
  const top = Math.floor(p.y / TILE);
  const bottom = Math.floor((p.y + p.h - 1) / TILE);
  if (p.vx > 0) {
    const tx = Math.floor((p.x + p.w) / TILE);
    for (let ty = top; ty <= bottom; ty++) {
      if (isSolid(tileAt(tx, ty))) { p.x = tx * TILE - p.w; p.vx = 0; break; }
    }
  } else if (p.vx < 0) {
    const tx = Math.floor(p.x / TILE);
    for (let ty = top; ty <= bottom; ty++) {
      if (isSolid(tileAt(tx, ty))) { p.x = (tx + 1) * TILE; p.vx = 0; break; }
    }
  }
}

function moveZ(p) {
  p.z += p.vz;
  const half = p.w / 2;
  if (p.z < half || p.z > CORRIDOR_DEPTH - half) {
    p.z = Math.max(half, Math.min(CORRIDOR_DEPTH - half, p.z));
    p.vz = 0;
  }
}

function moveY(state, p, ctx) {
  const wasOnGround = p.onGround;
  const impact = p.vy;
  const prevFeet = p.y + p.h;
  p.y += p.vy;
  p.onGround = false;

  const leftT = Math.floor(p.x / TILE);
  const rightT = Math.floor((p.x + p.w - 1) / TILE);

  if (p.vy > 0) {
    const ty = Math.floor((p.y + p.h) / TILE);
    for (let tx = leftT; tx <= rightT; tx++) {
      const ch = tileAt(tx, ty);
      if (isSolid(ch)) { land(p, ty * TILE, wasOnGround, impact, ctx); return; }
    }
    // One-way platforms: catch the player if their feet crossed the top this tick,
    // however fast they are falling.
    const top = ty * TILE;
    if (prevFeet <= top + 6 && p.y + p.h >= top) {
      for (let tx = leftT; tx <= rightT; tx++) {
        if (tileAt(tx, ty) === '=') { land(p, top, wasOnGround, impact, ctx); return; }
      }
    }
  } else if (p.vy < 0) {
    const ty = Math.floor(p.y / TILE);
    for (let tx = leftT; tx <= rightT; tx++) {
      if (isSolid(tileAt(tx, ty))) { p.y = (ty + 1) * TILE; p.vy = 0; return; }
    }
  }
}

function land(p, top, wasOnGround, impact, ctx) {
  p.y = top - p.h;
  p.vy = 0;
  p.onGround = true;
  if (!wasOnGround) {
    p.squash = Math.min(0.35, impact / 30);
    ctx.emit('land', { x: Math.round(p.x), y: Math.round(p.y), impact: Math.round(impact * 10) / 10 });
  }
}

export function killPlayer(state, ctx, cause, extra = {}) {
  const p = state.player;
  if (!p.alive) return;
  p.alive = false;
  p.respawnTimer = RESPAWN_TICKS;
  state.deaths += 1;
  burst(state, ctx, p.x + p.w / 2, p.y + p.h / 2, '#ff7a45', 24);
  ctx.emit('death', { cause, x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), ...extra });
}

function respawn(state, ctx) {
  const p = state.player;
  const at = state.checkpoint ?? getLevel().start;
  Object.assign(p, createPlayer(at), { yaw: p.yaw, pitch: p.pitch, safeTicks: RESPAWN_SAFE_TICKS });
  state.chaseWallX = at.x - CHASE.startOffset * TILE;
  ctx.emit('respawn', { x: Math.round(p.x), y: Math.round(p.y), checkpoint: state.checkpoint?.id ?? 'start' });
}
