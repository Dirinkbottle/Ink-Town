import { describe, expect, it } from "vitest";
import { buildAttributeOptions, markDirtyChunks, worldToChunkLocal } from "./worldMath";

describe("world math", () => {
  it("maps world coordinate to chunk/local correctly", () => {
    const a = worldToChunkLocal(34, 1, 32);
    expect(a.chunk).toEqual({ x: 1, y: 0 });
    expect(a.localX).toBe(2);
    expect(a.localY).toBe(1);

    const b = worldToChunkLocal(-1, -33, 32);
    expect(b.chunk).toEqual({ x: -1, y: -2 });
    expect(b.localX).toBe(31);
    expect(b.localY).toBe(31);
  });

  it("marks only affected chunks as dirty", () => {
    const dirty = markDirtyChunks(new Set(["0,0"]), [
      { x: 0, y: 0 },
      { x: 1, y: 2 }
    ]);
    expect(dirty.has("0,0")).toBe(true);
    expect(dirty.has("1,2")).toBe(true);
    expect(dirty.size).toBe(2);
  });

  it("builds attribute options from registry snapshot", () => {
    const options = buildAttributeOptions({
      attributes: [
        { id: "terrain", value_set: "terrain_set" },
        { id: "humidity", value_set: "humidity_set" }
      ],
      value_sets: {
        terrain_set: ["plain", "rock"],
        humidity_set: ["dry", "wet"]
      }
    });

    expect(options.terrain).toEqual(["plain", "rock"]);
    expect(options.humidity).toEqual(["dry", "wet"]);
  });
});
