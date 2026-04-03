import type { ChunkCoord, ChunkData, WorldMeta } from "./types";
import { chunkKey, parseCellKey } from "../lib/worldMath";

interface RendererConfig {
  canvas: HTMLCanvasElement;
}

export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private chunks = new Map<string, ChunkData>();
  private dirty = new Set<string>();
  private needsFullRedraw = true;
  private showGrid = true;
  private cameraX = 0;
  private cameraY = 0;
  private zoom = 1;
  private meta: WorldMeta = {
    version: "1",
    registry_version: "1",
    small_pixel_size: 2,
    big_grid_size: 32,
    chunk_size: 32
  };

  constructor(config: RendererConfig) {
    this.canvas = config.canvas;
    const context = this.canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("Canvas 2D context is unavailable");
    }
    this.ctx = context;
    this.ctx.imageSmoothingEnabled = false;
  }

  configure(meta: WorldMeta): void {
    this.meta = meta;
    this.needsFullRedraw = true;
  }

  setCanvasSize(width: number, height: number): void {
    const w = Math.max(128, Math.floor(width));
    const h = Math.max(128, Math.floor(height));
    if (this.canvas.width === w && this.canvas.height === h) {
      return;
    }
    this.canvas.width = w;
    this.canvas.height = h;
    this.needsFullRedraw = true;
  }

  setCamera(cameraX: number, cameraY: number): void {
    this.cameraX = cameraX;
    this.cameraY = cameraY;
    this.needsFullRedraw = true;
  }

  getCamera(): { x: number; y: number } {
    return { x: this.cameraX, y: this.cameraY };
  }

  panByPixels(deltaX: number, deltaY: number): void {
    const cell = this.getCellSizePx();
    this.cameraX -= deltaX / cell;
    this.cameraY -= deltaY / cell;
    this.needsFullRedraw = true;
  }

  zoomAt(factor: number, anchorCanvasX: number, anchorCanvasY: number): void {
    const nextZoom = Math.max(0.5, Math.min(24, this.zoom * factor));
    if (nextZoom === this.zoom) {
      return;
    }

    const before = this.canvasToWorldFromCanvas(anchorCanvasX, anchorCanvasY);
    this.zoom = nextZoom;
    const after = this.canvasToWorldFromCanvas(anchorCanvasX, anchorCanvasY);

    this.cameraX += before.worldX - after.worldX;
    this.cameraY += before.worldY - after.worldY;
    this.needsFullRedraw = true;
  }

  getZoom(): number {
    return this.zoom;
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

  resetChunks(chunks: ChunkData[]): void {
    this.chunks.clear();
    this.dirty.clear();
    for (const chunk of chunks) {
      const key = chunkKey(chunk.coord);
      this.chunks.set(key, chunk);
    }
    this.needsFullRedraw = true;
  }

  markDirty(coords: ChunkCoord[]): void {
    for (const coord of coords) {
      this.dirty.add(chunkKey(coord));
    }
  }

  getVisibleChunkCoords(padding = 1): ChunkCoord[] {
    const chunkSize = this.meta.chunk_size;
    const cell = this.getCellSizePx();
    const worldLeft = this.cameraX;
    const worldTop = this.cameraY;
    const worldRight = this.cameraX + this.canvas.width / cell;
    const worldBottom = this.cameraY + this.canvas.height / cell;

    const minX = Math.floor(worldLeft / chunkSize) - padding;
    const maxX = Math.floor(worldRight / chunkSize) + padding;
    const minY = Math.floor(worldTop / chunkSize) - padding;
    const maxY = Math.floor(worldBottom / chunkSize) + padding;

    const coords: ChunkCoord[] = [];
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        coords.push({ x, y });
      }
    }
    return coords;
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

    this.dirty.clear();
    // Full visible redraw on dirty updates avoids grid desync artifacts during brush painting.
    this.clearCanvas();
    this.drawVisibleChunks();
    if (this.showGrid) {
      this.drawGrid();
    }
  }

  canvasToWorld(clientX: number, clientY: number): { worldX: number; worldY: number } {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    return this.canvasToWorldFromCanvas(px, py);
  }

  private canvasToWorldFromCanvas(px: number, py: number): { worldX: number; worldY: number } {
    const cell = this.getCellSizePx();
    const worldX = this.cameraX + px / cell;
    const worldY = this.cameraY + py / cell;
    return {
      worldX: Math.floor(worldX),
      worldY: Math.floor(worldY)
    };
  }

  private getCellSizePx(): number {
    return this.meta.small_pixel_size * this.zoom;
  }

  private drawVisibleChunks(): void {
    for (const chunk of this.chunks.values()) {
      if (this.isChunkVisible(chunk.coord)) {
        this.drawChunk(chunk);
      }
    }
  }

  private drawChunk(chunk: ChunkData): void {
    const cell = this.getCellSizePx();
    const chunkBaseX = chunk.coord.x * this.meta.chunk_size;
    const chunkBaseY = chunk.coord.y * this.meta.chunk_size;

    for (const [key, pixel] of Object.entries(chunk.cells)) {
      const local = parseCellKey(key);
      const worldX = chunkBaseX + local.x;
      const worldY = chunkBaseY + local.y;
      const x = (worldX - this.cameraX) * cell;
      const y = (worldY - this.cameraY) * cell;

      if (x + cell < 0 || y + cell < 0 || x > this.canvas.width || y > this.canvas.height) {
        continue;
      }

      this.ctx.fillStyle = `rgb(${pixel.color[0]}, ${pixel.color[1]}, ${pixel.color[2]})`;
      this.ctx.fillRect(x, y, cell, cell);
    }
  }

  private drawGrid(): void {
    const cell = this.getCellSizePx();
    if (cell < 1) {
      return;
    }

    const worldLeft = Math.floor(this.cameraX);
    const worldTop = Math.floor(this.cameraY);
    const cols = Math.ceil(this.canvas.width / cell) + 1;
    const rows = Math.ceil(this.canvas.height / cell) + 1;

    this.ctx.strokeStyle = "rgba(0, 0, 0, 0.08)";
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    for (let i = 0; i <= cols; i += 1) {
      const x = Math.floor((i - (this.cameraX - worldLeft)) * cell) + 0.5;
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvas.height);
    }
    for (let i = 0; i <= rows; i += 1) {
      const y = Math.floor((i - (this.cameraY - worldTop)) * cell) + 0.5;
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas.width, y);
    }
    this.ctx.stroke();

    const majorStep = this.meta.big_grid_size;
    this.ctx.strokeStyle = "rgba(0, 124, 255, 0.22)";
    this.ctx.beginPath();
    for (let i = 0; i <= cols; i += 1) {
      const wx = worldLeft + i;
      if (wx % majorStep !== 0) {
        continue;
      }
      const x = Math.floor((i - (this.cameraX - worldLeft)) * cell) + 0.5;
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvas.height);
    }
    for (let i = 0; i <= rows; i += 1) {
      const wy = worldTop + i;
      if (wy % majorStep !== 0) {
        continue;
      }
      const y = Math.floor((i - (this.cameraY - worldTop)) * cell) + 0.5;
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas.width, y);
    }
    this.ctx.stroke();
  }

  private clearCanvas(): void {
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private isChunkVisible(coord: ChunkCoord): boolean {
    const chunkSize = this.meta.chunk_size;
    const cell = this.getCellSizePx();
    const left = coord.x * chunkSize;
    const top = coord.y * chunkSize;
    const right = left + chunkSize;
    const bottom = top + chunkSize;

    const viewLeft = this.cameraX;
    const viewTop = this.cameraY;
    const viewRight = this.cameraX + this.canvas.width / cell;
    const viewBottom = this.cameraY + this.canvas.height / cell;

    return !(right < viewLeft || left > viewRight || bottom < viewTop || top > viewBottom);
  }
}
