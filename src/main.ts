import './style.css';
import { createScene } from './game/scene';
import { startGameLoop } from './game/loop';
import { Kart } from './kart/kart';
import { InputController } from './kart/input';
import { Track } from './track/track';
import { createRingWaypoints, createWaypointDebugGroup } from './track/waypoints';
import { Race } from './race/race';
import { ScreenManager, type Screen } from './ui/screens';

const START_X = 30;
const START_Z = 14;
const START_HEADING = Math.PI; // right straight, just past the finish line, facing -Z

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
  kart.reset(START_X, START_Z, START_HEADING);
  gameScene.scene.add(kart.mesh);

  const input = new InputController();
  const hudEl = document.querySelector<HTMLDivElement>('#hud');
  const lapCountEl = document.querySelector<HTMLSpanElement>('#lap-count');
  const debugEl = document.querySelector<HTMLDivElement>('#debug');

  const race = new Race(track, waypoints, {
    onLap: (_kart, laps) => {
      if (lapCountEl) lapCountEl.textContent = `Lap: ${laps}`;
    },
  });
  race.addKart(kart);

  const screens = new ScreenManager(app);

  const setOverviewCamera = (): void => {
    gameScene.camera.position.set(0, 45, 55);
    gameScene.camera.lookAt(0, 0, 0);
  };

  const resetRaceState = (): void => {
    kart.reset(START_X, START_Z, START_HEADING);
    race.reset();
    if (lapCountEl) lapCountEl.textContent = 'Lap: 0';
  };

  const setScreen = (screen: Screen): void => {
    screens.show(screen);
    hudEl?.classList.toggle('hidden', screen !== 'racing');
  };

  screens.onStart(() => {
    resetRaceState();
    setScreen('racing');
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === '0') {
      waypointDebugGroup.visible = !waypointDebugGroup.visible;
      debugEl?.classList.toggle('hidden');
    }
    if (event.key === 'Escape' && screens.getCurrent() === 'racing') {
      resetRaceState();
      setOverviewCamera();
      setScreen('menu');
    }
  });

  const updateDebug = (): void => {
    if (!debugEl || debugEl.classList.contains('hidden')) return;
    const progress = race.getProgress(kart).toFixed(2);
    debugEl.textContent = `progress: ${progress} | next wp: ${race.getNextWaypointIndex(kart)}`;
  };

  // Boot into the menu: world built and rendered behind the overlay, nothing moving.
  setOverviewCamera();
  setScreen('menu');

  startGameLoop(gameScene, kart, track, input, race, () => screens.getCurrent(), updateDebug);
}

bootstrap();
