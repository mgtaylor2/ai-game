# Handoff

Shared "pick up here" note between Claude and Codex working in this repo. Whoever finishes a work session should update this file as part of their last commit — don't make the other agent re-derive state from commit history.

## Last updated

- By: Claude
- When: 2026-07-19
- What: Scaffolded the project and built Milestone 1 (drivable kart on one track).

## Current state

Milestone 1 from `ROADMAP.md` is done: one kart, one rectangular-ring track, keyboard controls, arcade physics, wall collision, chase camera, HUD lap counter. No AI, no items, no menus, one track only.

## How to run

```
npm install
npm run dev      # dev server
npm run build    # tsc typecheck + production build to dist/
npm run preview  # serve the production build locally
```

## Key conventions / where things live

- `src/game/scene.ts` — renderer/camera/lights setup, resize handling.
- `src/game/loop.ts` — the `requestAnimationFrame` loop; wires input → physics → camera → lap detection → render each frame. This is the one place that ties the other modules together.
- `src/kart/kart.ts` — kart mesh + state (`position`, `heading`, `speed`). Pure primitives, no external model.
- `src/kart/controller.ts` — **all physics tuning constants live here** (`MAX_SPEED`, `ACCELERATION`, `TURN_RATE_MAX`, etc.). Change kart feel here, not in `loop.ts`.
- `src/kart/input.ts` — WASD + arrow key mapping. Listens on `window`, not the canvas.
- `src/track/track.ts` — track geometry, wall collision (`resolveCollision`, a position clamp rather than a discrete step check — see gotchas), and finish-line crossing detection (`crossesFinishLine`).
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

**See `NEXT-STEPS.md` for the full task board** — bite-size tasks with a dependency graph, sized for one agent session each. Claim a task there, note it here while you work on it. No task is currently claimed.

The near-term arc is Milestone 2 from `ROADMAP.md` (AI opponents + placement), broken down as T1→T5 on the board. Natural entry points:
- Add an `ai/` module that reuses `kart/controller.ts`'s `updateKart` with a synthetic `InputState` derived from track waypoints, rather than keyboard input.
- `Kart` and `updateKart` are already input-source-agnostic (just take an `InputState`), so this shouldn't require changing `kart.ts`/`controller.ts` — just producing `InputState` from an AI policy instead of `InputController`.
- Lap tracking currently lives inline in `game/loop.ts` for a single kart; multi-kart racing will need per-kart lap/position state, likely worth extracting into its own `race/` module before bolting AI on.
