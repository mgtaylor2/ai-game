import type { GameScene } from './scene';
import type { Kart } from '../kart/kart';
import type { InputController } from '../kart/input';
import type { Track } from '../track/track';
import type { Race } from '../race/race';
import { updateKart } from '../kart/controller';

const CAMERA_BACK_OFFSET = 8;
const CAMERA_UP_OFFSET = 4;
const CAMERA_LERP = 0.1;

export interface GameLoopHandles {
  stop: () => void;
}

export function startGameLoop(
  gameScene: GameScene,
  kart: Kart,
  track: Track,
  input: InputController,
  race: Race,
): GameLoopHandles {
  const { scene, camera, renderer } = gameScene;

  let lastTime = performance.now();
  let running = true;

  function tick(now: number): void {
    if (!running) return;

    const dt = (now - lastTime) / 1000;
    lastTime = now;

    updateKart(kart, input.getState(), track, dt);

    const forwardX = Math.sin(kart.heading);
    const forwardZ = Math.cos(kart.heading);
    const desiredX = kart.position.x - forwardX * CAMERA_BACK_OFFSET;
    const desiredY = kart.position.y + CAMERA_UP_OFFSET;
    const desiredZ = kart.position.z - forwardZ * CAMERA_BACK_OFFSET;
    camera.position.x += (desiredX - camera.position.x) * CAMERA_LERP;
    camera.position.y += (desiredY - camera.position.y) * CAMERA_LERP;
    camera.position.z += (desiredZ - camera.position.z) * CAMERA_LERP;
    camera.lookAt(kart.position.x, kart.position.y + 1, kart.position.z);

    race.update(dt);

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
