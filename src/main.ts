import './style.css';
import { createScene } from './game/scene';
import { startGameLoop } from './game/loop';
import { Kart } from './kart/kart';
import { InputController } from './kart/input';
import { Track } from './track/track';
import { createRingWaypoints, createWaypointDebugGroup } from './track/waypoints';
import { Race } from './race/race';

function bootstrap(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('Missing #app root element');

  app.innerHTML = `
    <canvas id="game-canvas"></canvas>
    <div id="hud">
      <span id="lap-count">Lap: 0</span>
    </div>
    <div id="debug" class="hidden"></div>
  `;

  const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
  if (!canvas) throw new Error('Missing canvas element');

  const gameScene = createScene(canvas);

  const track = new Track();
  gameScene.scene.add(track.group);

  const waypoints = createRingWaypoints();
  const waypointDebugGroup = createWaypointDebugGroup(waypoints);
  waypointDebugGroup.visible = false;
  gameScene.scene.add(waypointDebugGroup);

  const kart = new Kart();
  kart.reset(30, 14, Math.PI); // right straight, just past the finish line, facing -Z
  gameScene.scene.add(kart.mesh);

  const input = new InputController();
  const lapCountEl = document.querySelector<HTMLSpanElement>('#lap-count');
  const debugEl = document.querySelector<HTMLDivElement>('#debug');

  const race = new Race(track, waypoints, {
    onLap: (_kart, laps) => {
      if (lapCountEl) lapCountEl.textContent = `Lap: ${laps}`;
    },
  });
  race.addKart(kart);

  window.addEventListener('keydown', (event) => {
    if (event.key === '0') {
      waypointDebugGroup.visible = !waypointDebugGroup.visible;
      debugEl?.classList.toggle('hidden');
    }
  });

  const updateDebug = (): void => {
    if (!debugEl || debugEl.classList.contains('hidden')) return;
    const progress = race.getProgress(kart).toFixed(2);
    debugEl.textContent = `progress: ${progress} | next wp: ${race.getNextWaypointIndex(kart)}`;
  };

  startGameLoop(gameScene, kart, track, input, race, updateDebug);
}

bootstrap();
