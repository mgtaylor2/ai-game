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
import { ScreenManager, formatOrdinal, type Screen } from './ui/screens';
import { Minimap } from './ui/minimap';
import { CHARACTERS, VEHICLES, getCharacter, getVehicle, combineStats, statsToTuning, type CharacterId, type VehicleId } from './game/roster';
import { preloadAllModels } from './game/assets';

const COUNTDOWN_SECONDS = 3;
const GO_TEXT_SECONDS = 0.7;
/** Multiplier turning kart units/sec (~26 max) into a satisfying km/h readout. */
const SPEED_DISPLAY_SCALE = 4.5;
/** Matches the fixed 3-lane x 4-row grid the track data provides (slot 0 = player). */
const TOTAL_RACERS = 12;
const PLAYER_MINIMAP_COLOR = 0xffd700;
/** Cycles through every character/vehicle combo so CPUs feel different from each other and the player. */
const CPU_LOADOUTS: Array<{ character: CharacterId; vehicle: VehicleId }> = [
  { character: 'star', vehicle: 'kart' }, { character: 'star', vehicle: 'bike' },
  { character: 'dash', vehicle: 'kart' }, { character: 'dash', vehicle: 'bike' },
  { character: 'bloom', vehicle: 'kart' }, { character: 'bloom', vehicle: 'bike' },
  { character: 'star', vehicle: 'kart' }, { character: 'star', vehicle: 'bike' },
  { character: 'dash', vehicle: 'kart' }, { character: 'dash', vehicle: 'bike' },
  { character: 'bloom', vehicle: 'kart' },
];
/** Explicit per-CPU paint so repeated character/vehicle combos still look distinct. */
const CPU_COLORS = [
  0xe63946, 0x3a86ff, 0x7b2cbf, 0x00a896, 0xf77f00, 0x90be6d,
  0xf72585, 0xf4d35e, 0x2ec4b6, 0xff006e, 0x8338ec,
];

/** A lighter, desaturated version of `color` for the vehicle's accent trim. */
function deriveAccent(color: number): number {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(color).getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.7), Math.min(0.85, hsl.l + 0.35)).getHex();
}
const TRACK_THEMES: Record<string, { grass: number; road: number; wall: number }> = {
  seaside: { grass: 0x3a7d44, road: 0x4a4a4a, wall: 0xcc3333 },
  sunset: { grass: 0xa85a31, road: 0x553b4b, wall: 0xf4a261 },
  forest: { grass: 0x174d38, road: 0x38434a, wall: 0x70a44a },
  candy: { grass: 0xf29ab2, road: 0x7255a3, wall: 0xffe066 },
};

async function bootstrap(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('Missing #app root element');

  app.innerHTML = `
    <canvas id="game-canvas"></canvas>
    <div id="hud">
      <div id="lap-count">Lap 1/${TOTAL_LAPS}</div>
      <div id="position">1st</div>
      <div id="speedometer">0 km/h</div>
    </div>
    <canvas id="minimap"></canvas>
    <div id="debug" class="hidden"></div>
  `;

  const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
  if (!canvas) throw new Error('Missing canvas element');

  const gameScene = createScene(canvas);
  // Shows the 'loading' screen (its default initial state) immediately, before
  // building any karts, so real vehicle/character models are ready before
  // anything that displays a kart mesh gets constructed -- avoids a visible
  // pop from procedural fallback to real model right after the menu appears.
  const screens = new ScreenManager(app);
  await preloadAllModels();

  const track = new Track(ringTrack);
  gameScene.scene.add(track.group);

  const waypoints = track.definition.waypoints;
  const waypointDebugGroup = createWaypointDebugGroup(waypoints);
  waypointDebugGroup.visible = false;
  gameScene.scene.add(waypointDebugGroup);

  const kart = new Kart();
  kart.reset(track.definition.start.x, track.definition.start.z, track.definition.start.heading, track.getHeightAt(track.definition.start.x, track.definition.start.z));
  gameScene.scene.add(kart.mesh);

  const input = new InputController();
  const hudEl = document.querySelector<HTMLDivElement>('#hud');
  const lapCountEl = document.querySelector<HTMLDivElement>('#lap-count');
  const positionEl = document.querySelector<HTMLDivElement>('#position');
  const speedometerEl = document.querySelector<HTMLDivElement>('#speedometer');
  const debugEl = document.querySelector<HTMLDivElement>('#debug');
  const minimapCanvas = document.querySelector<HTMLCanvasElement>('#minimap');
  if (!minimapCanvas) throw new Error('Missing minimap canvas');
  const minimap = new Minimap(minimapCanvas);
  minimap.setTrack(track.definition, track.definition.roadColor, track.definition.grassColor);

  const race = new Race(track, waypoints, {
    // CPUs are allowed to finish without stealing the player's results screen.
    onFinish: (finisher) => {
      if (finisher === kart) {
        screens.setResults(race.getPosition(kart), TOTAL_RACERS);
        setScreen('results');
      }
    },
  });
  race.addKart(kart);

  // startGrid[0] is pole position, reserved for the player; CPUs take the rest.
  const cpuStartSlots = track.definition.startGrid.slice(1);
  const cpuRacers = cpuStartSlots.map((slot, index) => {
    const cpuKart = new Kart();
    const loadout = CPU_LOADOUTS[index];
    const character = getCharacter(loadout.character);
    const vehicle = getVehicle(loadout.vehicle);
    const color = CPU_COLORS[index % CPU_COLORS.length];
    cpuKart.setVehicleType(loadout.vehicle);
    cpuKart.setPaint(color, deriveAccent(color));
    cpuKart.setDriverPaint(character.paint.suit, character.paint.helmet);
    cpuKart.setTuning(statsToTuning(combineStats(character, vehicle)));
    cpuKart.reset(slot.x, slot.z, slot.heading, track.getHeightAt(slot.x, slot.z));
    gameScene.scene.add(cpuKart.mesh);
    race.addKart(cpuKart);
    return { kart: cpuKart, driver: new AiDriver(race, waypoints), color };
  });

  const setOverviewCamera = (): void => {
    gameScene.camera.position.set(0, 45, 55);
    gameScene.camera.lookAt(0, 0, 0);
  };

  const resetRaceState = (): void => {
    const { start } = track.definition;
    kart.reset(start.x, start.z, start.heading, track.getHeightAt(start.x, start.z));
    cpuRacers.forEach((cpu, index) => {
      const slot = cpuStartSlots[index];
      cpu.kart.reset(slot.x, slot.z, slot.heading, track.getHeightAt(slot.x, slot.z));
    });
    race.reset();
  };

  const setScreen = (screen: Screen): void => {
    screens.show(screen);
    const hudVisible = screen === 'racing' || screen === 'countdown';
    hudEl?.classList.toggle('hidden', !hudVisible);
    minimapCanvas.classList.toggle('hidden', !hudVisible);
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

  screens.onRestart(startCountdown);
  screens.onMenu(() => {
    resetRaceState();
    setOverviewCamera();
    setScreen('menu');
  });

  // Character/vehicle selection applies to the live kart immediately (paint,
  // driver colours, and physics tuning) so the garage showcase and the race
  // itself always reflect the current picks, not just what's chosen last.
  let selectedCharacterId: CharacterId = CHARACTERS[0].id;
  let selectedVehicleId: VehicleId = VEHICLES[0].id;
  const applyPlayerLoadout = (): void => {
    const character = getCharacter(selectedCharacterId);
    const vehicle = getVehicle(selectedVehicleId);
    kart.setVehicleType(selectedVehicleId);
    kart.setPaint(vehicle.paint.color, vehicle.paint.accent);
    kart.setDriverPaint(character.paint.suit, character.paint.helmet);
    kart.setTuning(statsToTuning(combineStats(character, vehicle)));
  };
  applyPlayerLoadout();

  screens.onCharacterSelected((character) => {
    selectedCharacterId = character;
    applyPlayerLoadout();
  });
  screens.onVehicleSelected((vehicle) => {
    selectedVehicleId = vehicle;
    applyPlayerLoadout();
  });
  screens.onTrackSelected((trackId) => {
    const theme = TRACK_THEMES[trackId] || TRACK_THEMES.seaside;
    track.setTheme(theme.grass, theme.road, theme.wall);
    minimap.setTrack(track.definition, theme.road, theme.grass);
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
  let shownPosition = -1;
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
    const position = race.getPosition(kart);
    if (position !== shownPosition) {
      shownPosition = position;
      if (positionEl) positionEl.textContent = formatOrdinal(position);
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

  const updateMinimap = (): void => {
    const screen = screens.getCurrent();
    if (screen !== 'racing' && screen !== 'countdown') return;
    minimap.update([
      { kart, color: PLAYER_MINIMAP_COLOR, isPlayer: true },
      ...cpuRacers.map((cpu) => ({ kart: cpu.kart, color: cpu.color })),
    ]);
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
      startCountdown();
    }
  };

  // Slowly orbits the camera around the kart on the pre-race selection screens
  // so paint/model/stat changes are visible as soon as they're picked.
  let showcaseAngle = 0;
  const SHOWCASE_SCREENS: Screen[] = ['mode', 'character', 'vehicle'];
  const updateShowcase = (dt: number): void => {
    if (!SHOWCASE_SCREENS.includes(screens.getCurrent())) return;
    showcaseAngle += dt * 0.4;
    const radius = 9;
    gameScene.camera.position.set(
      kart.position.x + Math.sin(showcaseAngle) * radius,
      kart.position.y + 3.5,
      kart.position.z + Math.cos(showcaseAngle) * radius,
    );
    gameScene.camera.lookAt(kart.position.x, kart.position.y + 1, kart.position.z);
    kart.heading += dt * 0.6;
    kart.syncMesh();
  };

  const onFrame = (dt: number): void => {
    updateCountdown(dt);
    updateTrackPreview(dt);
    updateShowcase(dt);
    updateWrongWay(dt);
    updateHud();
    updateDebug();
    updateMinimap();
  };

  // Boot into the menu: world built and rendered behind the overlay, nothing moving.
  setOverviewCamera();
  setScreen('menu');

  startGameLoop(gameScene, kart, track, input, race, cpuRacers, () => screens.getCurrent(), onFrame);
}

bootstrap();
