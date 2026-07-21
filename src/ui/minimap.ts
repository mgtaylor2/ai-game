import type { TrackDefinition } from '../track/definition';
import type { Kart } from '../kart/kart';

const CANVAS_SIZE = 176;
const PADDING = 16;

export interface MinimapRacer {
  kart: Kart;
  color: number;
  isPlayer?: boolean;
}

function toHexColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

/** Top-down minimap rendered to a small canvas, tracing the track's centerline path. */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly baseCanvas: HTMLCanvasElement;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is unavailable');
    this.ctx = ctx;
    this.baseCanvas = document.createElement('canvas');
    this.baseCanvas.width = CANVAS_SIZE;
    this.baseCanvas.height = CANVAS_SIZE;
  }

  /** Rebuilds the cached track layer; call again when the track or its theme changes. */
  setTrack(definition: TrackDefinition, roadColor: number, grassColor: number): void {
    const { path } = definition;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of path) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const worldSize = Math.max(maxX - minX, maxZ - minZ);
    this.scale = (CANVAS_SIZE - PADDING * 2) / worldSize;
    this.offsetX = CANVAS_SIZE / 2 - ((minX + maxX) / 2) * this.scale;
    this.offsetY = CANVAS_SIZE / 2 - ((minZ + maxZ) / 2) * this.scale;

    const ctx = this.baseCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.fillStyle = toHexColor(grassColor);
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    ctx.strokeStyle = toHexColor(roadColor);
    ctx.lineWidth = Math.max(3, definition.roadWidth * this.scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    path.forEach((p, i) => {
      const point = this.project(p.x, p.z);
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.stroke();

    this.drawFinishLine(ctx, definition);
  }

  /** Draws the cached track plus one dot per racer, player highlighted. */
  update(racers: readonly MinimapRacer[]): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.drawImage(this.baseCanvas, 0, 0);
    for (const racer of racers) {
      const point = this.project(racer.kart.position.x, racer.kart.position.z);
      const radius = racer.isPlayer ? 5.5 : 3.5;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = toHexColor(racer.color);
      ctx.fill();
      ctx.lineWidth = racer.isPlayer ? 2.5 : 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }

  private drawFinishLine(ctx: CanvasRenderingContext2D, definition: TrackDefinition): void {
    const { a, b } = definition.finishLine;
    const pa = this.project(a.x, a.z);
    const pb = this.project(b.x, b.z);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  private project(worldX: number, worldZ: number): { x: number; y: number } {
    return { x: worldX * this.scale + this.offsetX, y: worldZ * this.scale + this.offsetY };
  }
}
