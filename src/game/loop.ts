import type { GameScene } from './scene';
import type { Kart } from '../kart/kart';
import type { InputController } from '../kart/input';
import type { Track } from '../track/track';
import type { Race } from '../race/race';
import type { Screen } from '../ui/screens';
import { updateKart, resolveKartCollisions } from '../kart/controller';
import type { AiDriver } from '../ai/driver';

const CAMERA_BACK_OFFSET = 8;
const CAMERA_UP_OFFSET = 4;
const CAMERA_LERP = 0.1;

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

  let lastTime = performance.now();
  let running = true;

  function updateChaseCamera(): void {
    const forwardX = Math.sin(kart.heading);
    const forwardZ = Math.cos(kart.heading);
    const desiredX = kart.position.x - forwardX * CAMERA_BACK_OFFSET;
    const desiredY = kart.position.y + CAMERA_UP_OFFSET;
    const desiredZ = kart.position.z - forwardZ * CAMERA_BACK_OFFSET;
    camera.position.x += (desiredX - camera.position.x) * CAMERA_LERP;
    camera.position.y += (desiredY - camera.position.y) * CAMERA_LERP;
    camera.position.z += (desiredZ - camera.position.z) * CAMERA_LERP;
    camera.lookAt(kart.position.x, kart.position.y + 1, kart.position.z);
  }

  function tick(now: number): void {
    if (!running) return;

    // Always advance the clock so paused/menu time never accumulates into a
    // future physics step.
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    switch (getScreen()) {
      case 'racing':
        updateKart(kart, input.getState(), track, dt);
        kart.animateWheels(dt);
        for (const cpu of cpuRacers) {
          updateKart(cpu.kart, cpu.driver.getInput(cpu.kart), track, dt);
          cpu.kart.animateWheels(dt);
        }
        resolveKartCollisions(allKarts, track);
        updateChaseCamera();
        race.update(dt);
        break;
      case 'countdown':
        // Kart frozen, input ignored; camera settles into chase position so
        // the view is already correct when racing begins. Countdown timing
        // itself is owned by main.ts via onFrame(dt).
        updateChaseCamera();
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
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  return {
    stop: () => {
      running = false;
    },
  };
}
