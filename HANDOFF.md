# Handoff

Shared "pick up here" note between Claude and Codex working in this repo. Whoever finishes a work session should update this file as part of their last commit — don't make the other agent re-derive state from commit history.

## Last updated

- By: Claude
- When: 2026-07-28
- What: Added a second, fully independent game — **Alpine Rush** (`ski.html` / `src/ski/`) — an endless downhill snowboarding runner. See "Alpine Rush" section below; everything under "Current state" through "Next up" is about the kart racer only and is unchanged.

## Alpine Rush (new game, `src/ski/`)

A separate single-page app (`ski.html` → `src/ski/main.ts`) sharing this repo's Three.js/TypeScript/Vite tooling but with its own scene, physics, and asset pipeline — it does not touch `src/game`, `src/kart`, `src/track`, etc. `vite.config.ts` builds both `index.html` and `ski.html` as separate Rollup entries. The kart racer's menu links to it (`src/ui/screens.ts`); Alpine Rush's own start overlay does not currently link back.

**Architecture**: everything is procedural, no external assets. `terrain.ts`'s `Mountain` class is the single analytic height field (`heightAt(x,z)` / `getHeightAndNormal(x,z)`) that the spline (`spline.ts`), chunk streaming (`chunks.ts`), pickups (`pickups.ts`), gates (`gates.ts`), physics (`physics.ts`/`air.ts`), camera (`camera.ts`), and rider (`rider.ts`) all sample — there is no physics engine and no raycasting. `config.ts` holds every tuning constant grouped by system with a fixed seed (`1337`) so the mountain is deterministic. `postprocessing.ts` runs its own `EffectComposer` chain (bloom → DOF/god-rays/motion-blur uber pass → SMAA → ACES `OutputPass` → chromatic-aberration/grade/vignette/grain uber pass) — SMAA must run *before* `OutputPass` (needs linear-srgb input; this is a hard three.js constraint, not a style choice) so it does not match the pass order implied by a literal reading of some design docs. `snowShader.ts` extends the one shared terrain material (`snowMaterial.ts`) via `onBeforeCompile`.

**Known gotchas specific to Alpine Rush:**

- **`THREE.Clock.getDelta()` returns ~0 on its first call** (it starts the clock and immediately diffs against itself). `main.ts`'s `dt` clamp is `Math.max(0.001, Math.min(0.05, clock.getDelta()))` — the *lower* clamp matters as much as the upper one here: a `dt` of exactly `0` produces a `0/0` in `physics.ts`'s takeoff-detection division, which reads as `NaN`, which makes every `<=` comparison false, which silently forces an incorrect "takeoff" on frame one. If position/height ever come back `NaN` again, check this first.
- **MeshDepthMaterial's RGBA depth packing has a specific byte order** (`postprocessing.ts`'s `readDepth`) — use three's own `#include <packing>` chunk (`unpackRGBAToDepth` / `perspectiveDepthToViewZ`) rather than hand-rolling the bit-shift dot product; a plausible-looking-but-backwards byte order compiles fine and just produces garbage depth (manifested as the whole frame looking permanently defocused).
- **Per-vertex normal perturbation on the low-density terrain grid facets badly.** An earlier version of `snowShader.ts` nudged `objectNormal` per-vertex for corduroy/off-piste micro-detail; since terrain vertices are 1.65–6.5 m apart, any noise finer than that spacing is uncorrelated between adjacent vertices and reads as a harsh faceted lattice, not smooth micro-detail. That detail now lives only in the fragment shader (`color_fragment`, smooth per-pixel), driven by the `lateralDistance` varying. Don't reintroduce per-vertex high-frequency noise on this mesh.
- **`HemisphereLight`'s sky color should not be the full-saturation sky-dome blue.** Using `CONFIG.visual.skyTop` (`0x2e6fd1`) directly as the hemisphere sky color oversaturates every shadowed/ambient-lit surface into deep navy. `scenery.ts` uses a pale desaturated blue (`0xdce8f5`) at a modest intensity instead — treat the hemisphere light's colors as "ambient tint," not "literal sky color."
- **Point-sprite `gl_PointSize` needs a minimum-distance clamp.** `size * (280.0 / -mvPosition.z)` blows up for a particle very close to (or behind) the camera. Both `ParticlePool` and `Snowfall` in `effects.ts` clamp with `max(1.0, -mvPosition.z)` and an outer `clamp(..., 0.0, N)` — don't remove these when tuning particle sizes.
- **`BANK_GAIN` in `terrain.ts` is load-bearing and easy to get wrong by an order of magnitude.** It's a `dH/dx`-per-unit-curvature multiplier, not a cosmetic constant; a too-large value (55 was tried and was wrong) produces near-vertical terrain at ordinary turn curvatures, which cascades into spurious takeoffs and `NaN` position within a few frames. If retuning banking, sanity-check `mountain.getHeightAndNormal(x, z).normal.y` near the centerline stays close to 1 (i.e. mildly tilted, not near-vertical).
- **Headless/software-GL testing (`--use-gl=swiftshader`) reliably closes the page after ~15–20s of any Three.js content in this container**, including the pre-existing kart racer's menu screen alone — this is a sandbox limitation (confirmed: it reproduces on `index.html` too, unrelated to any Alpine Rush code), not a game bug. Keep automated screenshot/interaction scripts short (a few seconds) and don't chase this as a regression.
- Mirrors the kart racer's existing gotchas too: `dt` clamping, `@types/three`/`three` version pinning, and the software-WebGL screenshot requirement all apply here as well.

**Not yet done / possible follow-ups**: no automated tests; bloom/exposure/particle tuning is "looks reasonable in a quick pass," not carefully calibrated; no reverse link from Alpine Rush's menu back to the kart racer; large `BufferGeometryUtils` chunk in the production build (harmless, just a bundle-size warning) could be split out if that ever matters.

## Current state

Milestone 1 is complete. T1/T2 extracted multi-kart-ready race state and ring waypoint progress; T3 adds an AI policy that produces standard kart input from the next waypoint. T6/T9 add a start menu, race countdown, speedometer, and lap HUD. T8 adds Escape pause with Resume and quit-to-menu controls. T13 moves the ring's geometry, collision, finish line, waypoints, and starting position into `src/tracks/ring.ts`.

The current branch also contains the Milestone 2 race-flow work: the loop now simulates the player plus three AI karts, and the player reaching three laps opens a results screen with Race Again and Back to Menu actions. This is **not yet a complete T4/T5 implementation**: there is no live placement/standings UI, no kart-to-kart collision, and the results copy is hard-coded to "1st place" rather than calculated from finish order. The track-selection flow currently changes the ring track's palette only; it does not select distinct track definitions. No items or additional playable tracks exist yet.

The current visual pass deliberately targets an original, bright arcade-kart-racer look rather than copying Nintendo-owned characters, tracks, UI, or assets. It adds procedural grass/asphalt/checker textures, soft shadows, filmic colour treatment, distance fog, rounded kart bodywork, and speed-driven wheel animation. Keep future art and audio original or appropriately licensed.

## How to run

```
npm install
npm run dev      # dev server
npm run build    # tsc typecheck + production build to dist/
npm run preview  # serve the production build locally
```

## Key conventions / where things live

- `src/game/scene.ts` — renderer/camera/lights setup, resize handling.
- `src/game/loop.ts` — the `requestAnimationFrame` loop; wires input → physics → camera → race update → render each frame. It freezes simulation on non-racing screens while continuing to render.
- `src/kart/kart.ts` — kart mesh + state (`position`, `heading`, `speed`). Pure primitives, no external model.
- `src/kart/controller.ts` — **all physics tuning constants live here** (`MAX_SPEED`, `ACCELERATION`, `TURN_RATE_MAX`, etc.). Change kart feel here, not in `loop.ts`.
- `src/kart/input.ts` — WASD + arrow key mapping. Listens on `window`, not the canvas.
- `src/race/race.ts` — per-kart lap counting, waypoint progress, finish-line validation, and reset support.
- `src/ui/screens.ts` — menu, countdown, and pause overlay DOM/state; game-specific callbacks live in `main.ts`.
- `src/track/track.ts` — track geometry, wall collision (`resolveCollision`, a position clamp rather than a discrete step check — see gotchas), and finish-line crossing detection (`crossesFinishLine`).
- `src/track/definition.ts` — plain-data vocabulary used by all tracks (surfaces, walls, collision rectangles, finish line, waypoints, and start grid).
- `src/tracks/ring.ts` — the current rectangular-ring `TrackDefinition`. Add future tracks here without modifying `Track`'s geometry builder.
- No external binary assets (images/models) are used yet — see the "Asset strategy" section in `ROADMAP.md` before adding any.

## Known gotchas

- **Physics is delta-time based and clamped.** `controller.ts` clamps `dt` to `MAX_DT` (0.05s) so a stalled/backgrounded tab frame can't cause a huge position jump. Keep using `dt`-scaled math for anything new (don't add a per-frame-constant hack).
- **Turn rate has a floor, not a hard zero at rest** (`TURN_RATE_MIN_FACTOR` in `controller.ts`), so a near-stationary kart can still pivot — matches arcade kart feel, not real car physics.
- **Wall collision is a position clamp, not a swept check.** `Track.resolveCollision` clamps the kart's position into the outer rectangle and out of the inner island every frame, which sidesteps high-speed tunneling by construction (final position is always valid) rather than needing continuous collision detection. If track shapes get more complex than two axis-aligned rectangles, this approach will need to become segment-based.
- **`@types/three` version must match `three`'s version** (both pinned to `0.185.1` right now) — they don't always track 1:1 across releases; check `npm view @types/three versions` against the installed `three` version before bumping either.
- **Local Node version may differ from this container's.** This container ran Node 22.22.2 with no issues. If `npm install`/`npm run dev` fails elsewhere with `EBADENGINE` on Vite 8 (which wants `^20.19 || >=22.12`), pin `vite` to a version supporting the older Node (e.g. Vite 5/6) — don't ask the human to upgrade Node mid-task.
- **Headless verification needs software WebGL.** Default headless Chromium can lack a GPU context and render a blank canvas. If automating a screenshot check, launch with software-rendering flags (e.g. `--use-gl=swiftshader`) before concluding the game itself is broken.
- **`npm create vite` in a non-empty directory** can hit an interactive prompt with no TTY to answer. Scaffold into a scratch dir and copy files over instead of running it in the repo root directly.

## Next up

**T3 is complete.** `src/ai/driver.ts` exposes `AiDriver#getInput(kart)`, which uses `Race#getNextWaypointIndex(kart)` and track waypoints to produce the normal `InputState`. It applies a dead zone to prevent steering oscillation and slows/brakes for sharp turns. Feed its output directly to `updateKart` when adding AI karts.

**T13 is complete.** `Track` now accepts a `TrackDefinition`; the current ring's geometry, collision bounds, finish line, waypoints, and player start position all live in `src/tracks/ring.ts`. A future track only needs another definition object, plus menu selection work in T14.

**T8 is complete.** Escape pauses a race with Resume and Quit to Menu controls; Race Again from the results screen resets the race and begins a fresh countdown.

The core critical path resumes with the remaining parts of **T4/T5**: calculate and display live placement/standings from laps plus `Race#getProgress`, record finish order, and use that order in the results screen. Kart-to-kart collision remains deferred. After those are complete, T14 can add genuinely distinct track definitions to the existing selection flow.

See `NEXT-STEPS.md` for the task board. Keep one task per branch/PR and update both documents on completion.
