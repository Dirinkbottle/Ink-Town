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

export type PixelPrimitive = string | number | boolean;

export type PixelCell = {
  color: RGB;
  material: string;
  durability: number;
} & Record<string, unknown>;

export interface ChunkData {
  coord: ChunkCoord;
  cells: Record<string, PixelCell>;
}

export interface MaterialDefinition {
  id: string;
  label: string;
  max_durability: number;
}

export type PropertyType = "int" | "float" | "bool" | "string" | "enum";

export interface PropertyDefinition {
  name: string;
  label: string;
  type: PropertyType;
  default_value: PixelPrimitive;
  enum_values: string[];
}

export interface RegistrySnapshot {
  version: string;
  materials: MaterialDefinition[];
  properties: PropertyDefinition[];
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
