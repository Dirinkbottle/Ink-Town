export type RGB = [number, number, number];

export interface ChunkCoord {
  x: number;
  y: number;
}

export interface WorldMeta {
  version: string;
  registry_version: string;
  small_pixel_size: number;
  big_grid_size: number;
  chunk_size: number;
}

export interface PixelCell {
  color: RGB;
  material: string;
  durability: number;
  attrs: Record<string, string>;
}

export interface ChunkData {
  coord: ChunkCoord;
  cells: Record<string, PixelCell>;
}

export interface MaterialDefinition {
  id: string;
  label: string;
  max_durability: number;
}

export interface AttributeDefinition {
  id: string;
  label: string;
  value_set: string;
  required: boolean;
}

export interface RegistrySnapshot {
  version: string;
  materials: MaterialDefinition[];
  attributes: AttributeDefinition[];
  value_sets: Record<string, string[]>;
  schema: unknown;
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface PixelPatch {
  world_x: number;
  world_y: number;
  pixel: PixelCell;
}

export interface LoadWorldResponse {
  meta: WorldMeta;
  initial_chunks: ChunkData[];
}

export interface ValidatePixelResponse {
  ok: boolean;
  errors: ValidationError[];
}
