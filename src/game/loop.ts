import type { GameScene } from './scene';
import type { Kart } from '../kart/kart';
import type { InputController } from '../kart/input';
import type { Track } from '../track/track';
import type { Race } from '../race/race';
import type { Screen } from '../ui/screens';
import { updateKart, resolveKartCollisions } from '../kart/controller';
import type { InputState } from '../kart/input';
import type { AiDriver } from '../ai/driver';
import { RacePostProcessing } from './postprocessing';

/** Collapses the two boolean steer keys into the -1..1 axis the visual model wants. */
function steerAxis(input: InputState): number {
  return (input.right ? 1 : 0) - (input.left ? 1 : 0);
}

const CAMERA_BACK_OFFSET = 9;
const CAMERA_UP_OFFSET = 2.9;
/**
 * Chase-camera follow rate, per second. Converted to a per-frame factor with an exponential so the
 * camera settles at the same real-world rate regardless of frame rate -- a raw per-frame lerp makes
 * the camera lag badly on a slow machine and snap on a fast one.
 */
const CAMERA_FOLLOW_RATE = 6;

export interface GameLoopHandles {
  stop: () => void;
}

export interface CpuRacer {
  kart: Kart;
  driver: AiDriver;
}

export function startGameLoop(
  gameScene: GameScene,
  kart: Kart,
  track: Track,
  input: InputController,
  race: Race,
  cpuRacers: readonly CpuRacer[],
  getScreen: () => Screen,
  onFrame?: (dt: number) => void,
): GameLoopHandles {
  const { scene, camera, renderer } = gameScene;
  const allKarts = [kart, ...cpuRacers.map((cpu) => cpu.kart)];

  const postFx = new RacePostProcessing(renderer, scene, camera, window.innerWidth, window.innerHeight);
  let elapsed = 0;

  // Resize lives here rather than in createScene because the composer's render targets have to be
  // resized in lockstep with the renderer; splitting them across two listeners invites them to drift.
  const handleResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    postFx.setSize(width, height);
  };
  window.addEventListener('resize', handleResize);

  let lastTime = performance.now();
  let running = true;

  function updateChaseCamera(dt: number): void {
    const forwardX = Math.sin(kart.heading);
    const forwardZ = Math.cos(kart.heading);
    const desiredX = kart.position.x - forwardX * CAMERA_BACK_OFFSET;
    const desiredY = kart.position.y + CAMERA_UP_OFFSET;
    const desiredZ = kart.position.z - forwardZ * CAMERA_BACK_OFFSET;
    const follow = 1 - Math.exp(-CAMERA_FOLLOW_RATE * dt);
    camera.position.x += (desiredX - camera.position.x) * follow;
    camera.position.y += (desiredY - camera.position.y) * follow;
    camera.position.z += (desiredZ - camera.position.z) * follow;
    camera.lookAt(kart.position.x, kart.position.y + 1, kart.position.z);
  }

  function tick(now: number): void {
    if (!running) return;

    // Always advance the clock so paused/menu time never accumulates into a
    // future physics step.
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    switch (getScreen()) {
      case 'racing': {
        const playerInput = input.getState();
        updateKart(kart, playerInput, track, dt);
        kart.animate(dt, steerAxis(playerInput));
        for (const cpu of cpuRacers) {
          const cpuInput = cpu.driver.getInput(cpu.kart);
          updateKart(cpu.kart, cpuInput, track, dt);
          cpu.kart.animate(dt, steerAxis(cpuInput));
        }
        resolveKartCollisions(allKarts, track);
        updateChaseCamera(dt);
        race.update(dt);
        break;
      }
      case 'countdown':
        // Kart frozen, input ignored; camera settles into chase position so
        // the view is already correct when racing begins. Countdown timing
        // itself is owned by main.ts via onFrame(dt).
        updateChaseCamera(dt);
        break;
      case 'paused':
        // Later: frozen simulation, pause overlay handles its own input.
        break;
      case 'results':
        // Later: results screen; maybe a slow orbit camera.
        break;
      case 'menu':
        // Static overview camera set by main.ts; nothing to simulate.
        break;
    }

    gameScene.update(dt);
    onFrame?.(dt);

    elapsed += dt;
    postFx.render(scene, camera, {
      speed01: Math.min(1, Math.abs(kart.speed) / Math.max(0.001, kart.tuning.maxSpeed)),
      // Only the outer part of the road tints, so normal racing line stays clean and it kicks in
      // as a warning when you're genuinely about to scrape.
      edgeProximity: Math.max(0, track.getEdgeProximity(kart.position.x, kart.position.z) - 0.62) / 0.38,
      elapsed,
    });
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  return {
    stop: () => {
      running = false;
      window.removeEventListener('resize', handleResize);
    },
  };
}
