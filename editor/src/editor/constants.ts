import type { PixelCell, WorldMeta } from "../renderer/types";

export const defaultMeta: WorldMeta = {
  version: "1",
  registry_version: "1",
  small_pixel_size: 2,
  big_grid_size: 32,
  chunk_size: 32
};

export const defaultPixel: PixelCell = {
  color: [255, 255, 255],
  material: "soil",
  durability: 20
};

export const corePixelKeys = new Set(["color", "material", "durability"]);
