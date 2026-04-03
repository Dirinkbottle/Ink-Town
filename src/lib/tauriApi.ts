import { invoke } from "@tauri-apps/api/core";
import type {
  ChunkCoord,
  ChunkData,
  LoadWorldResponse,
  PixelCell,
  PixelPatch,
  RegistrySnapshot,
  ValidatePixelResponse
} from "../renderer/types";

export async function loadWorld(metaPath: string): Promise<LoadWorldResponse> {
  return invoke("load_world", { metaPath });
}

export async function createWorld(metaPath: string): Promise<LoadWorldResponse> {
  return invoke("create_world", { metaPath });
}

export async function loadChunks(chunkCoords: ChunkCoord[]): Promise<ChunkData[]> {
  return invoke("load_chunks", { chunkCoords });
}

export async function applyPixelPatch(patches: PixelPatch[]): Promise<ChunkCoord[]> {
  return invoke("apply_pixel_patch", { patches });
}

export async function loadRegistry(): Promise<RegistrySnapshot> {
  return invoke("load_registry");
}

export async function saveRegistry(snapshot: RegistrySnapshot): Promise<RegistrySnapshot> {
  return invoke("save_registry", { snapshot });
}

export async function validatePixelPayload(payload: PixelCell): Promise<ValidatePixelResponse> {
  return invoke("validate_pixel_payload", { payload });
}

export async function saveWorld(): Promise<void> {
  return invoke("save_world");
}
