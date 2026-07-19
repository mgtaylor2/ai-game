# Roadmap

Staged milestones for the Mario-Kart-Wii-style web racer, in intended order. Each is meant to be a playable increment, not a big-bang rewrite.

1. **Drivable kart + 1 track** (done) — single kart, one rectangular-ring track, WASD/arrow controls, wall collision, chase camera, lap counter.
2. **AI-controlled opponents** — lap-based race against bots, placement/finish standings.
3. **Items** — banana peel, green/red shell, mushroom boost, item boxes on the track.
4. **Additional tracks + track-select menu.**
5. **Local split-screen** (2-player, shared keyboard/gamepad split).
6. **Battle mode.**
7. **Online multiplayer** (stretch) — likely needs a lightweight relay/game server, which affects the "free static hosting" plan (Vercel/Netlify/GitHub Pages/Cloudflare Pages all serve static files only). Treat this as a later decision point, not a default.

## Asset strategy

Milestone 1 uses zero external asset files — track and kart are built from Three.js primitive geometry (`BoxGeometry`, `PlaneGeometry`, `CylinderGeometry`, `ConeGeometry`) with solid-color materials. This is deliberate: Claude can read/write text formats natively (code, SVG, JSON, `.obj`/`.mtl`, `.gltf`) but not generate binary image/model files (PNG/JPG, `.glb`, `.fbx`), so those would arrive as opaque binaries neither agent could hand-edit.

When a later milestone wants real art, prefer CC0/free packs distributed in text-editable formats — e.g. Kenney.nl's kart/racing kits ship `.obj`+`.mtl` (plain text) rather than `.glb` — so both agents can still hand-edit geometry/materials directly. If binary assets (textures, `.glb` models) become unavoidable, treat them as vendored third-party files: drop them in `public/` as-is and reference them by path rather than trying to edit their contents.

See `HANDOFF.md` for current state and where to pick up.
