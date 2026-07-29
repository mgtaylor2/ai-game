# ai-game

Two arcade browser games, built with Three.js + TypeScript (via Vite), generated collaboratively by Codex and Claude:

- **Kart Racer** (`index.html`) — a Mario-Kart-Wii-style kart racer.
- **Alpine Rush** (`ski.html`) — an endless downhill snowboarding runner: procedural terrain, carving physics, tricks, pickups, and slalom gates.

## Run locally

```
npm install
npm run dev
```

Then open the printed `localhost` URL for the kart racer, or `/ski.html` for Alpine Rush. Kart Racer controls: WASD or arrow keys (accelerate / brake / steer). Alpine Rush controls: A/D or arrow keys to carve, Space to jump, Q/E to spin, S to grab, W or Shift to tuck, R to respawn (touch: hold either side of the screen to carve, tap center or the on-screen buttons to jump/spin).

`npm run build` produces a static production build in `dist/` (both `index.html` and `ski.html` as separate entry points), deployable to any static host (Vercel, Netlify, GitHub Pages, Cloudflare Pages) once there's a demo worth sharing.

### Play Alpine Rush without any tooling

`npm run build:single` bundles Alpine Rush — all code, styles and procedurally generated textures — into one self-contained file at `dist-single/ski.html`. Open it directly in a browser (double-click, no server needed) or hand it to someone else to try. The kart racer needs the normal `dist/` build, since it loads model files at runtime.

## Project status and roadmap

See [`ROADMAP.md`](./ROADMAP.md) for the staged milestone plan, [`NEXT-STEPS.md`](./NEXT-STEPS.md) for the agent task board (bite-size tasks + dependency graph), and [`HANDOFF.md`](./HANDOFF.md) for current state, conventions, and known gotchas — kept up to date as a shared note between Codex and Claude sessions.
