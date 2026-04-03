import type { ChunkCoord, ChunkData, PixelCell } from "../renderer/types";

export interface ChunkLocalCoord {
  chunk: ChunkCoord;
  localX: number;
  localY: number;
}

export const VIEWPORT_CHUNKS_X = 3;
export const VIEWPORT_CHUNKS_Y = 3;

export function chunkKey(coord: ChunkCoord): string {
  return `${coord.x},${coord.y}`;
}

export function cellKey(localX: number, localY: number): string {
  return `${localX},${localY}`;
}

export function parseCellKey(key: string): { x: number; y: number } {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}

export function worldToChunkLocal(worldX: number, worldY: number, chunkSize: number): ChunkLocalCoord {
  const chunkX = Math.floor(worldX / chunkSize);
  const chunkY = Math.floor(worldY / chunkSize);
  const localX = ((worldX % chunkSize) + chunkSize) % chunkSize;
  const localY = ((worldY % chunkSize) + chunkSize) % chunkSize;
  return {
    chunk: { x: chunkX, y: chunkY },
    localX,
    localY
  };
}

export function buildVisibleCoords(camera: ChunkCoord): ChunkCoord[] {
  const coords: ChunkCoord[] = [];
  for (let y = 0; y < VIEWPORT_CHUNKS_Y; y += 1) {
    for (let x = 0; x < VIEWPORT_CHUNKS_X; x += 1) {
      coords.push({ x: camera.x + x, y: camera.y + y });
    }
  }
  return coords;
}

export function upsertChunks(map: Map<string, ChunkData>, incoming: ChunkData[]): Map<string, ChunkData> {
  const next = new Map(map);
  for (const chunk of incoming) {
    next.set(chunkKey(chunk.coord), chunk);
  }
  return next;
}

export function buildPixelPatch(
  worldX: number,
  worldY: number,
  pixel: PixelCell
): { world_x: number; world_y: number; pixel: PixelCell } {
  return {
    world_x: worldX,
    world_y: worldY,
    pixel
  };
}

export function markDirtyChunks(existing: Set<string>, coords: ChunkCoord[]): Set<string> {
  const next = new Set(existing);
  for (const coord of coords) {
    next.add(chunkKey(coord));
  }
  return next;
}

export function buildAttributeOptions(snapshot: {
  properties: { name: string; type: string; enum_values?: string[] }[];
}): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const property of snapshot.properties) {
    if (property.type !== "enum") {
      continue;
    }
    result[property.name] = property.enum_values ?? [];
  }
  return result;
}
