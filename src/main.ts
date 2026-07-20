import './style.css';
import { createScene } from './game/scene';
import { startGameLoop } from './game/loop';
import { Kart } from './kart/kart';
import { InputController } from './kart/input';
import { Track } from './track/track';
import { createRingWaypoints, createWaypointDebugGroup } from './track/waypoints';
import { Race, TOTAL_LAPS } from './race/race';
import { ScreenManager, type Screen } from './ui/screens';

const START_X = 30;
const START_Z = 14;
const START_HEADING = Math.PI; // right straight, just past the finish line, facing -Z

const COUNTDOWN_SECONDS = 3;
const GO_TEXT_SECONDS = 0.7;
/** Multiplier turning kart units/sec (~26 max) into a satisfying km/h readout. */
const SPEED_DISPLAY_SCALE = 4.5;

function bootstrap(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('Missing #app root element');

  app.innerHTML = `
    <canvas id="game-canvas"></canvas>
    <div id="hud">
      <div id="lap-count">Lap 1/${TOTAL_LAPS}</div>
      <div id="speedometer">0 km/h</div>
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
  const lapCountEl = document.querySelector<HTMLDivElement>('#lap-count');
  const speedometerEl = document.querySelector<HTMLDivElement>('#speedometer');
  const debugEl = document.querySelector<HTMLDivElement>('#debug');

  const race = new Race(track, waypoints);
  race.addKart(kart);

  const screens = new ScreenManager(app);

  const setOverviewCamera = (): void => {
    gameScene.camera.position.set(0, 45, 55);
    gameScene.camera.lookAt(0, 0, 0);
  };

  const resetRaceState = (): void => {
    kart.reset(START_X, START_Z, START_HEADING);
    race.reset();
  };

  const setScreen = (screen: Screen): void => {
    screens.show(screen);
    const hudVisible = screen === 'racing' || screen === 'countdown';
    hudEl?.classList.toggle('hidden', !hudVisible);
  };

  // Countdown/GO! timers, ticked in onFrame below. main.ts owns this logic;
  // the loop just skips physics while the screen is 'countdown'.
  let countdownRemaining = 0;
  let goTextRemaining = 0;

  screens.onStart(() => {
    resetRaceState();
    countdownRemaining = COUNTDOWN_SECONDS;
    goTextRemaining = 0;
    screens.setCountdownText(`${COUNTDOWN_SECONDS}`);
    setScreen('countdown');
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === '0') {
      waypointDebugGroup.visible = !waypointDebugGroup.visible;
      debugEl?.classList.toggle('hidden');
    }
    const current = screens.getCurrent();
    if (event.key === 'Escape' && (current === 'racing' || current === 'countdown')) {
      countdownRemaining = 0;
      goTextRemaining = 0;
      resetRaceState();
      setOverviewCamera();
      setScreen('menu'); // also hides the countdown overlay
    }
  });

  const updateCountdown = (dt: number): void => {
    if (screens.getCurrent() === 'countdown') {
      countdownRemaining -= dt;
      if (countdownRemaining <= 0) {
        // Racing starts exactly now; "GO!" lingers over the action briefly.
        goTextRemaining = GO_TEXT_SECONDS;
        screens.setCountdownText('GO!');
        setScreen('racing');
      } else {
        screens.setCountdownText(`${Math.ceil(countdownRemaining)}`);
      }
    } else if (goTextRemaining > 0 && screens.getCurrent() === 'racing') {
      goTextRemaining -= dt;
      if (goTextRemaining <= 0) screens.hideCountdown();
    }
  };

  // Cache displayed values so the DOM is only touched when the text changes.
  let shownSpeed = -1;
  let shownLap = -1;
  const updateHud = (): void => {
    const speed = Math.round(Math.abs(kart.speed) * SPEED_DISPLAY_SCALE);
    if (speed !== shownSpeed) {
      shownSpeed = speed;
      if (speedometerEl) speedometerEl.textContent = `${speed} km/h`;
    }
    const lap = Math.min(race.getLaps(kart) + 1, TOTAL_LAPS);
    if (lap !== shownLap) {
      shownLap = lap;
      if (lapCountEl) lapCountEl.textContent = `Lap ${lap}/${TOTAL_LAPS}`;
    }
  };

  const updateDebug = (): void => {
    if (!debugEl || debugEl.classList.contains('hidden')) return;
    const progress = race.getProgress(kart).toFixed(2);
    debugEl.textContent = `progress: ${progress} | next wp: ${race.getNextWaypointIndex(kart)}`;
  };

  const onFrame = (dt: number): void => {
    updateCountdown(dt);
    updateHud();
    updateDebug();
  };

  // Boot into the menu: world built and rendered behind the overlay, nothing moving.
  setOverviewCamera();
  setScreen('menu');

  startGameLoop(gameScene, kart, track, input, race, () => screens.getCurrent(), onFrame);
}

bootstrap();
