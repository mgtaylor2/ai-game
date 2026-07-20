import './style.css';
import * as THREE from 'three';
import { createScene } from './game/scene';
import { startGameLoop } from './game/loop';
import { Kart } from './kart/kart';
import { AiDriver } from './ai/driver';
import { InputController } from './kart/input';
import { Track } from './track/track';
import { createWaypointDebugGroup } from './track/waypoints';
import { ringTrack } from './tracks/ring';
import { Race, TOTAL_LAPS } from './race/race';
import { ScreenManager, type Screen } from './ui/screens';

const COUNTDOWN_SECONDS = 3;
const GO_TEXT_SECONDS = 0.7;
/** Multiplier turning kart units/sec (~26 max) into a satisfying km/h readout. */
const SPEED_DISPLAY_SCALE = 4.5;
const CPU_START_OFFSETS = [3, 6, 9];
const CPU_PAINTS = [
  { color: 0x7b2cbf, accent: 0xf72585 },
  { color: 0x00a896, accent: 0xf4d35e },
  { color: 0xf77f00, accent: 0x90be6d },
];
const TRACK_THEMES: Record<string, { grass: number; road: number; wall: number }> = {
  seaside: { grass: 0x3a7d44, road: 0x4a4a4a, wall: 0xcc3333 },
  sunset: { grass: 0xa85a31, road: 0x553b4b, wall: 0xf4a261 },
  forest: { grass: 0x174d38, road: 0x38434a, wall: 0x70a44a },
  candy: { grass: 0xf29ab2, road: 0x7255a3, wall: 0xffe066 },
};
const DRIVER_PAINTS: Record<string, { suit: number; helmet: number }> = {
  star: { suit: 0x2d7dd2, helmet: 0xf9c74f },
  dash: { suit: 0xe63946, helmet: 0xf1faee },
  bloom: { suit: 0x9b5de5, helmet: 0xffafcc },
};

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

  const track = new Track(ringTrack);
  gameScene.scene.add(track.group);

  const waypoints = track.definition.waypoints;
  const waypointDebugGroup = createWaypointDebugGroup(waypoints);
  waypointDebugGroup.visible = false;
  gameScene.scene.add(waypointDebugGroup);

  const kart = new Kart();
  kart.reset(track.definition.start.x, track.definition.start.z, track.definition.start.heading);
  gameScene.scene.add(kart.mesh);

  const input = new InputController();
  const hudEl = document.querySelector<HTMLDivElement>('#hud');
  const lapCountEl = document.querySelector<HTMLDivElement>('#lap-count');
  const speedometerEl = document.querySelector<HTMLDivElement>('#speedometer');
  const debugEl = document.querySelector<HTMLDivElement>('#debug');

  let screens: ScreenManager;
  const race = new Race(track, waypoints, {
    // CPUs are allowed to finish without stealing the player's results screen.
    onFinish: (finisher) => { if (finisher === kart) setScreen('results'); },
  });
  race.addKart(kart);

  const cpuRacers = CPU_START_OFFSETS.map((offset, index) => {
    const cpuKart = new Kart();
    const paint = CPU_PAINTS[index];
    cpuKart.setPaint(paint.color, paint.accent);
    cpuKart.setDriverPaint(paint.accent, paint.color);
    cpuKart.reset(track.definition.start.x, track.definition.start.z + offset, track.definition.start.heading);
    gameScene.scene.add(cpuKart.mesh);
    race.addKart(cpuKart);
    return { kart: cpuKart, driver: new AiDriver(race, waypoints) };
  });

  screens = new ScreenManager(app);

  const setOverviewCamera = (): void => {
    gameScene.camera.position.set(0, 45, 55);
    gameScene.camera.lookAt(0, 0, 0);
  };

  const resetRaceState = (): void => {
    const { start } = track.definition;
    kart.reset(start.x, start.z, start.heading);
    cpuRacers.forEach((cpu, index) => {
      cpu.kart.reset(start.x, start.z + CPU_START_OFFSETS[index], start.heading);
    });
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

  const startCountdown = (): void => {
    resetRaceState();
    countdownRemaining = COUNTDOWN_SECONDS;
    goTextRemaining = 0;
    screens.setCountdownText(`${COUNTDOWN_SECONDS}`);
    setScreen('countdown');
  };

  screens.onStart(startCountdown);
  screens.onRestart(startCountdown);
  screens.onMenu(() => {
    resetRaceState();
    setOverviewCamera();
    setScreen('menu');
  });
  screens.onVehicleSelected((vehicle) => {
    const paints = vehicle === 'bike'
      ? { color: 0x3a86ff, accent: 0x8ecae6 }
      : { color: 0xe63946, accent: 0xffb703 };
    kart.setPaint(paints.color, paints.accent);
  });
  screens.onCharacterSelected((character) => {
    const paint = DRIVER_PAINTS[character] || DRIVER_PAINTS.star;
    kart.setDriverPaint(paint.suit, paint.helmet);
  });
  screens.onTrackSelected((trackId) => {
    const theme = TRACK_THEMES[trackId] || TRACK_THEMES.seaside;
    track.setTheme(theme.grass, theme.road, theme.wall);
    previewElapsed = 0;
  });
  screens.onResume(() => {
    setScreen('racing');
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === '0') {
      waypointDebugGroup.visible = !waypointDebugGroup.visible;
      debugEl?.classList.toggle('hidden');
    }
    const current = screens.getCurrent();
    if (event.key === 'Escape' && current === 'racing') {
      // The loop continues to render but does not update physics/race state on
      // the paused screen, so the race is completely frozen.
      setScreen('paused');
    } else if (event.key === 'Escape' && current === 'paused') {
      setScreen('racing');
    } else if (event.key === 'Escape' && current === 'countdown') {
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

  let wrongWayElapsed = 0;
  const updateWrongWay = (dt: number): void => {
    if (screens.getCurrent() !== 'racing') {
      wrongWayElapsed = 0;
      screens.setWrongWayVisible(false);
      return;
    }
    wrongWayElapsed = race.isWrongWay(kart) ? wrongWayElapsed + dt : Math.max(0, wrongWayElapsed - dt * 2);
    screens.setWrongWayVisible(wrongWayElapsed > 0.45);
  };

  let previewElapsed = 0;
  const PREVIEW_SECONDS = 4.2;
  const updateTrackPreview = (dt: number): void => {
    if (screens.getCurrent() !== 'preview') return;
    previewElapsed += dt;
    const spots = [
      { x: 0, z: 0, height: 58 },
      { x: -28, z: -14, height: 38 },
      { x: 29, z: 11, height: 28 },
    ];
    if (previewElapsed < 3) {
      const spot = spots[Math.min(spots.length - 1, Math.floor(previewElapsed / 1.25))];
      gameScene.camera.position.set(spot.x, spot.height, spot.z + 12);
      gameScene.camera.lookAt(spot.x, 0, spot.z);
    } else {
      const target = kart.position.clone().add(new THREE.Vector3(0, 6, 10));
      gameScene.camera.position.lerp(target, 0.09);
      gameScene.camera.lookAt(kart.position.x, 0, kart.position.z);
    }
    if (previewElapsed >= PREVIEW_SECONDS) {
      setScreen('character');
    }
  };

  const onFrame = (dt: number): void => {
    updateCountdown(dt);
    updateTrackPreview(dt);
    updateWrongWay(dt);
    updateHud();
    updateDebug();
  };

  // Boot into the menu: world built and rendered behind the overlay, nothing moving.
  setOverviewCamera();
  setScreen('menu');

  startGameLoop(gameScene, kart, track, input, race, cpuRacers, () => screens.getCurrent(), onFrame);
}

bootstrap();
