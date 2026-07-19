import './style.css';
import { createScene } from './game/scene';
import { startGameLoop } from './game/loop';
import { Kart } from './kart/kart';
import { InputController } from './kart/input';
import { Track } from './track/track';

function bootstrap(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('Missing #app root element');

  app.innerHTML = `
    <canvas id="game-canvas"></canvas>
    <div id="hud">
      <span id="lap-count">Lap: 0</span>
    </div>
  `;

  const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
  if (!canvas) throw new Error('Missing canvas element');

  const gameScene = createScene(canvas);

  const track = new Track();
  gameScene.scene.add(track.group);

  const kart = new Kart();
  kart.reset(0, 20, 0);
  gameScene.scene.add(kart.mesh);

  const input = new InputController();
  const lapCountEl = document.querySelector<HTMLSpanElement>('#lap-count');

  startGameLoop(gameScene, kart, track, input, (lapCount) => {
    if (lapCountEl) lapCountEl.textContent = `Lap: ${lapCount}`;
  });
}

bootstrap();
