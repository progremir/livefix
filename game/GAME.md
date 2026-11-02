# Game contract (read me before editing)

This folder is the **only** code the live fixer edits. The engine loads `main.js`
as an ES module and hot-swaps it while the player is playing. The running game
**state is never thrown away**, so your change shows up instantly, right where
the player is.

## Exports of `main.js`

| export | when it runs | rules |
|---|---|---|
| `init(ctx) → state` | brand-new game only | return plain JSON-safe data (no classes, functions, Maps, DOM) |
| `migrate(state, ctx)` | after **every** hot reload, resume and rewind | idempotent; add defaults for any new state fields; reconcile state with level content |
| `update(state, input, ctx)` | 60 times per second | mutate `state` in place; deterministic: use `ctx.rng()` not `Math.random()`, `ctx.dt` not `Date.now()`; no DOM |
| `render(state, g, view)` | every animation frame | draw with Canvas2D `g`; **read-only** on state |
| `describe(state) → object` | 10×/sec | compact summary that is recorded to the telemetry stream |

`input` = `{ down, pressed, released, look }`. The first three are objects keyed by `KeyboardEvent.code`
(`ArrowLeft`, `Space`, `KeyA`, …). `pressed`/`released` are true only on the tick it happened.
`look` = `{ dx, dy }`, the mouse movement in pixels this tick, while the pointer is locked.
Set `pointerLock: true` in `meta` to lock the pointer.
Keys `T`, `Enter`, `Backspace`, `Escape` are reserved by the engine and never reach the game.

`ctx` = `{ dt, tick, rng(), emit(type, data) }`. Call `ctx.emit()` for meaningful
moments (jump, death, pickup…). Events are recorded with timestamps and are the
best clue the fixer has about what happened when the player spoke.

## The 3D view

The game is first person. The levels are still 2D tile maps, in `level.js`. Each map is extruded along
z into a canyon `CORRIDOR_TILES` wide, so a tile fills the canyon's whole width. `x` runs along the level,
`y` points **down**, `z` runs across it, all in px, with `TILE` = 32 px. Physics stays in those units.

`render.js` draws with Three.js, which is the global `THREE` (`render()` only; `update()` also runs in
Node, where it doesn't exist). It renders to its own WebGL canvas, then copies the picture into `g` and
draws the 2D HUD on top. The scene uses 1 unit = 1 tile and `y = -gameY / TILE`. It rebuilds whenever
this code reloads or the level changes.

## Content vs. progress

* **Content** (level layout, tuning numbers, rules, art) lives in code. Changing it
  takes effect on the next tick.
* **Progress** (player position, collected coins, deaths, enemies alive…) lives in
  `state`. Keep it keyed by stable ids (`c_12_11`, `e_34_14`) so content edits
  don't scramble it.
* Adding a feature that needs new state (double jump → `player.jumpsLeft`)? Add the
  default in `migrate()` as well as `init()`.
