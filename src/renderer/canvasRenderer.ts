import type { ChunkCoord, ChunkData, WorldMeta } from "./types";
import { chunkKey, parseCellKey } from "../lib/worldMath";

interface RendererConfig {
  canvas: HTMLCanvasElement;
  viewportWidthChunks: number;
  viewportHeightChunks: number;
}

export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly viewportWidthChunks: number;
  private readonly viewportHeightChunks: number;
  private chunks = new Map<string, ChunkData>();
  private dirty = new Set<string>();
  private needsFullRedraw = true;
  private showGrid = true;
  private camera: ChunkCoord = { x: 0, y: 0 };
  private meta: WorldMeta = {
    version: "1",
    registry_version: "1",
    small_pixel_size: 2,
    big_grid_size: 32,
    chunk_size: 32
  };

  constructor(config: RendererConfig) {
    this.canvas = config.canvas;
    this.viewportWidthChunks = config.viewportWidthChunks;
    this.viewportHeightChunks = config.viewportHeightChunks;
    const context = this.canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("Canvas 2D context is unavailable");
    }
    this.ctx = context;
    this.ctx.imageSmoothingEnabled = false;
    this.resizeCanvas();
  }

  configure(meta: WorldMeta): void {
    this.meta = meta;
    this.resizeCanvas();
    this.needsFullRedraw = true;
  }

  setCamera(camera: ChunkCoord): void {
    this.camera = camera;
    this.needsFullRedraw = true;
  }

  setGridVisible(visible: boolean): void {
    this.showGrid = visible;
    this.needsFullRedraw = true;
  }

  upsertChunks(chunks: ChunkData[]): void {
    for (const chunk of chunks) {
      const key = chunkKey(chunk.coord);
      this.chunks.set(key, chunk);
      this.dirty.add(key);
    }
  }

  markDirty(coords: ChunkCoord[]): void {
    for (const coord of coords) {
      this.dirty.add(chunkKey(coord));
    }
  }

  renderFrame(): void {
    if (this.needsFullRedraw) {
      this.clearCanvas();
      this.drawVisibleChunks();
      if (this.showGrid) {
        this.drawGrid();
      }
      this.needsFullRedraw = false;
      this.dirty.clear();
      return;
    }

    if (this.dirty.size === 0) {
      return;
    }

    const dirtyNow = [...this.dirty];
    this.dirty.clear();
    for (const key of dirtyNow) {
      const chunk = this.chunks.get(key);
      if (!chunk) {
        continue;
      }
      if (!this.isChunkVisible(chunk.coord)) {
        continue;
      }
      this.clearChunkArea(chunk.coord);
      this.drawChunk(chunk);
      if (this.showGrid) {
        this.drawChunkGrid(chunk.coord);
      }
    }
  }

  canvasToWorld(clientX: number, clientY: number): { worldX: number; worldY: number } {
    const rect = this.canvas.getBoundingClientRect();
    const px = Math.floor(clientX - rect.left);
    const py = Math.floor(clientY - rect.top);
    const small = this.meta.small_pixel_size;
    const cellX = Math.floor(px / small);
    const cellY = Math.floor(py / small);
    const worldX = this.camera.x * this.meta.chunk_size + cellX;
    const worldY = this.camera.y * this.meta.chunk_size + cellY;
    return { worldX, worldY };
  }

  private drawVisibleChunks(): void {
    for (const chunk of this.chunks.values()) {
      if (this.isChunkVisible(chunk.coord)) {
        this.drawChunk(chunk);
      }
    }
  }

  private drawChunk(chunk: ChunkData): void {
    const chunkPx = this.meta.chunk_size * this.meta.small_pixel_size;
    const sx = (chunk.coord.x - this.camera.x) * chunkPx;
    const sy = (chunk.coord.y - this.camera.y) * chunkPx;

    for (const [key, pixel] of Object.entries(chunk.cells)) {
      const local = parseCellKey(key);
      const x = sx + local.x * this.meta.small_pixel_size;
      const y = sy + local.y * this.meta.small_pixel_size;
      this.ctx.fillStyle = `rgb(${pixel.color[0]}, ${pixel.color[1]}, ${pixel.color[2]})`;
      this.ctx.fillRect(x, y, this.meta.small_pixel_size, this.meta.small_pixel_size);
    }
  }

  private drawGrid(): void {
    const chunkPx = this.meta.chunk_size * this.meta.small_pixel_size;
    this.ctx.strokeStyle = "rgba(160, 190, 220, 0.15)";
    this.ctx.lineWidth = 1;

    for (let cx = 0; cx <= this.viewportWidthChunks; cx += 1) {
      const x = cx * chunkPx + 0.5;
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvas.height);
      this.ctx.stroke();
    }

    for (let cy = 0; cy <= this.viewportHeightChunks; cy += 1) {
      const y = cy * chunkPx + 0.5;
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas.width, y);
      this.ctx.stroke();
    }

    const major = this.meta.big_grid_size * this.meta.small_pixel_size;
    if (major > 3) {
      this.ctx.strokeStyle = "rgba(98, 210, 162, 0.2)";
      for (let x = 0; x <= this.canvas.width; x += major) {
        const px = x + 0.5;
        this.ctx.beginPath();
        this.ctx.moveTo(px, 0);
        this.ctx.lineTo(px, this.canvas.height);
        this.ctx.stroke();
      }
      for (let y = 0; y <= this.canvas.height; y += major) {
        const py = y + 0.5;
        this.ctx.beginPath();
        this.ctx.moveTo(0, py);
        this.ctx.lineTo(this.canvas.width, py);
        this.ctx.stroke();
      }
    }
  }

  private drawChunkGrid(coord: ChunkCoord): void {
    const chunkPx = this.meta.chunk_size * this.meta.small_pixel_size;
    const sx = (coord.x - this.camera.x) * chunkPx;
    const sy = (coord.y - this.camera.y) * chunkPx;
    this.ctx.strokeStyle = "rgba(98, 210, 162, 0.25)";
    this.ctx.strokeRect(sx + 0.5, sy + 0.5, chunkPx, chunkPx);
  }

  private clearChunkArea(coord: ChunkCoord): void {
    const chunkPx = this.meta.chunk_size * this.meta.small_pixel_size;
    const sx = (coord.x - this.camera.x) * chunkPx;
    const sy = (coord.y - this.camera.y) * chunkPx;
    this.ctx.fillStyle = "#0b0f16";
    this.ctx.fillRect(sx, sy, chunkPx, chunkPx);
  }

  private clearCanvas(): void {
    this.ctx.fillStyle = "#0b0f16";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private isChunkVisible(coord: ChunkCoord): boolean {
    return (
      coord.x >= this.camera.x &&
      coord.y >= this.camera.y &&
      coord.x < this.camera.x + this.viewportWidthChunks &&
      coord.y < this.camera.y + this.viewportHeightChunks
    );
  }

  private resizeCanvas(): void {
    const chunkPx = this.meta.chunk_size * this.meta.small_pixel_size;
    this.canvas.width = chunkPx * this.viewportWidthChunks;
    this.canvas.height = chunkPx * this.viewportHeightChunks;
  }
}
