import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasRenderer } from "../renderer/canvasRenderer";
import type { ChunkCoord, ChunkData, PixelCell, RegistrySnapshot, WorldMeta } from "../renderer/types";
import { hexToRgb, rgbToHex } from "../lib/color";
import { applyPixelPatch, loadChunks, loadRegistry, loadWorld, saveWorld, validatePixelPayload } from "../lib/tauriApi";
import {
  buildAttributeOptions,
  buildPixelPatch,
  buildVisibleCoords,
  chunkKey,
  markDirtyChunks,
  VIEWPORT_CHUNKS_X,
  VIEWPORT_CHUNKS_Y,
  worldToChunkLocal
} from "../lib/worldMath";

const defaultMeta: WorldMeta = {
  version: "1",
  registry_version: "1",
  small_pixel_size: 2,
  big_grid_size: 32,
  chunk_size: 32
};

const defaultPixel: PixelCell = {
  color: [255, 255, 255],
  material: "soil",
  durability: 20,
  attrs: {}
};

export function EditorApp() {
  const [metaPath, setMetaPath] = useState("data/world/world.json");
  const [meta, setMeta] = useState<WorldMeta>(defaultMeta);
  const [registry, setRegistry] = useState<RegistrySnapshot | null>(null);
  const [camera, setCamera] = useState<ChunkCoord>({ x: 0, y: 0 });
  const [chunks, setChunks] = useState<Map<string, ChunkData>>(new Map());
  const [dirtyChunkSet, setDirtyChunkSet] = useState(new Set<string>());
  const [status, setStatus] = useState("Ready");
  const [showGrid, setShowGrid] = useState(true);
  const [selectedPixel, setSelectedPixel] = useState<PixelCell>(defaultPixel);
  const [selectedCoord, setSelectedCoord] = useState<{ x: number; y: number } | null>(null);

  const [brushColor, setBrushColor] = useState("#ffffff");
  const [brushMaterial, setBrushMaterial] = useState("soil");
  const [brushDurability, setBrushDurability] = useState(20);
  const [brushAttrs, setBrushAttrs] = useState<Record<string, string>>({});

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const paintingRef = useRef(false);
  const lastPaintRef = useRef<string>("");

  const attributeOptions = useMemo(() => {
    if (!registry) {
      return {};
    }
    return buildAttributeOptions(registry);
  }, [registry]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const renderer = new CanvasRenderer({
      canvas,
      viewportWidthChunks: VIEWPORT_CHUNKS_X,
      viewportHeightChunks: VIEWPORT_CHUNKS_Y
    });
    renderer.configure(meta);
    renderer.setGridVisible(showGrid);
    rendererRef.current = renderer;

    let raf = 0;
    const frame = () => {
      renderer.renderFrame();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.configure(meta);
    rendererRef.current?.upsertChunks([...chunks.values()]);
  }, [meta, chunks]);

  useEffect(() => {
    rendererRef.current?.setGridVisible(showGrid);
  }, [showGrid]);

  useEffect(() => {
    rendererRef.current?.setCamera(camera);
  }, [camera]);

  useEffect(() => {
    if (!rendererRef.current || dirtyChunkSet.size === 0) {
      return;
    }
    const coords = [...dirtyChunkSet].map((key) => {
      const [x, y] = key.split(",").map(Number);
      return { x, y };
    });
    rendererRef.current.markDirty(coords);
    setDirtyChunkSet(new Set());
  }, [dirtyChunkSet]);

  const loadVisibleChunks = async (targetCamera: ChunkCoord): Promise<void> => {
    const coords = buildVisibleCoords(targetCamera);
    const loaded = await loadChunks(coords);
    setChunks((prev) => {
      const next = new Map(prev);
      for (const chunk of loaded) {
        next.set(chunkKey(chunk.coord), chunk);
      }
      return next;
    });
    setDirtyChunkSet((prev) => markDirtyChunks(prev, coords));
  };

  const handleOpenWorld = async (): Promise<void> => {
    try {
      setStatus("Loading world...");
      const [world, snapshot] = await Promise.all([loadWorld(metaPath), loadRegistry()]);
      setMeta(world.meta);
      setRegistry(snapshot);
      setChunks(new Map(world.initial_chunks.map((chunk) => [chunkKey(chunk.coord), chunk])));
      setCamera({ x: 0, y: 0 });
      if (snapshot.materials[0]?.id) {
        setBrushMaterial(snapshot.materials[0].id);
      }
      const initialAttrs: Record<string, string> = {};
      for (const attr of snapshot.attributes) {
        const values = snapshot.value_sets[attr.value_set] ?? [];
        if (values[0]) {
          initialAttrs[attr.id] = values[0];
        }
      }
      setBrushAttrs(initialAttrs);
      await loadVisibleChunks({ x: 0, y: 0 });
      setStatus("World loaded");
    } catch (error) {
      setStatus(`Failed to load world: ${String(error)}`);
    }
  };

  const handleSave = async (): Promise<void> => {
    try {
      await saveWorld();
      setStatus("World saved");
    } catch (error) {
      setStatus(`Save failed: ${String(error)}`);
    }
  };

  const moveCamera = async (dx: number, dy: number): Promise<void> => {
    const next = { x: camera.x + dx, y: camera.y + dy };
    setCamera(next);
    try {
      await loadVisibleChunks(next);
      setStatus(`Camera moved to chunk (${next.x}, ${next.y})`);
    } catch (error) {
      setStatus(`Camera move failed: ${String(error)}`);
    }
  };

  const readPixelAt = (worldX: number, worldY: number): PixelCell | null => {
    const local = worldToChunkLocal(worldX, worldY, meta.chunk_size);
    const chunk = chunks.get(chunkKey(local.chunk));
    if (!chunk) {
      return null;
    }
    return chunk.cells[`${local.localX},${local.localY}`] ?? null;
  };

  const paintAt = async (clientX: number, clientY: number): Promise<void> => {
    const renderer = rendererRef.current;
    if (!renderer || !registry) {
      return;
    }
    const point = renderer.canvasToWorld(clientX, clientY);
    const stampKey = `${point.worldX},${point.worldY}`;
    if (stampKey === lastPaintRef.current) {
      return;
    }

    const pixel: PixelCell = {
      color: hexToRgb(brushColor),
      material: brushMaterial,
      durability: brushDurability,
      attrs: { ...brushAttrs }
    };

    const valid = await validatePixelPayload(pixel);
    if (!valid.ok) {
      setStatus(`Validation failed: ${valid.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`);
      return;
    }

    try {
      const changedCoords = await applyPixelPatch([buildPixelPatch(point.worldX, point.worldY, pixel)]);
      const refreshed = await loadChunks(changedCoords);
      setChunks((prev) => {
        const next = new Map(prev);
        for (const chunk of refreshed) {
          next.set(chunkKey(chunk.coord), chunk);
        }
        return next;
      });
      setDirtyChunkSet((prev) => markDirtyChunks(prev, changedCoords));
      setSelectedCoord({ x: point.worldX, y: point.worldY });
      setSelectedPixel(pixel);
      lastPaintRef.current = stampKey;
      setStatus(`Painted (${point.worldX}, ${point.worldY})`);
    } catch (error) {
      setStatus(`Paint failed: ${String(error)}`);
    }
  };

  const inspectAt = (clientX: number, clientY: number): void => {
    const renderer = rendererRef.current;
    if (!renderer) {
      return;
    }
    const point = renderer.canvasToWorld(clientX, clientY);
    setSelectedCoord({ x: point.worldX, y: point.worldY });
    const pixel = readPixelAt(point.worldX, point.worldY);
    if (pixel) {
      setSelectedPixel(pixel);
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="section">
          <strong>World</strong>
          <div className="row">
            <label>Meta Path</label>
            <input value={metaPath} onChange={(e) => setMetaPath(e.target.value)} />
          </div>
          <div className="row">
            <button className="primary" onClick={() => void handleOpenWorld()}>
              Open
            </button>
            <button onClick={() => void handleSave()}>Save</button>
          </div>
          <div className="status">{status}</div>
        </div>

        <div className="section">
          <strong>Viewport</strong>
          <div className="row">
            <button onClick={() => void moveCamera(-1, 0)}>Left</button>
            <button onClick={() => void moveCamera(1, 0)}>Right</button>
          </div>
          <div className="row">
            <button onClick={() => void moveCamera(0, -1)}>Up</button>
            <button onClick={() => void moveCamera(0, 1)}>Down</button>
          </div>
          <div className="row">
            <label>Grid</label>
            <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
          </div>
          <div className="status">
            camera=({camera.x}, {camera.y}), chunk={meta.chunk_size}, px={meta.small_pixel_size}
          </div>
        </div>

        <div className="section">
          <strong>Brush</strong>
          <div className="row">
            <label>Color</label>
            <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} />
          </div>
          <div className="row">
            <label>Material</label>
            <select value={brushMaterial} onChange={(e) => setBrushMaterial(e.target.value)}>
              {(registry?.materials ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.id})
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <label>Durability</label>
            <input
              type="number"
              min={0}
              value={brushDurability}
              onChange={(e) => setBrushDurability(Number(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className="section">
          <strong>Attributes</strong>
          {(registry?.attributes ?? []).map((attr) => (
            <div className="row" key={attr.id}>
              <label>{attr.label}</label>
              <select
                value={brushAttrs[attr.id] ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  setBrushAttrs((prev) => ({ ...prev, [attr.id]: value }));
                }}
              >
                {(attributeOptions[attr.id] ?? []).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="section">
          <strong>Inspect</strong>
          <div className="status">
            {selectedCoord ? `(${selectedCoord.x}, ${selectedCoord.y})` : "no cell selected"}
          </div>
          <div className="row">
            <label>RGB</label>
            <input value={rgbToHex(selectedPixel.color)} readOnly />
          </div>
          <div className="row">
            <label>Material</label>
            <input value={selectedPixel.material} readOnly />
          </div>
          <div className="row">
            <label>Durability</label>
            <input value={selectedPixel.durability} readOnly />
          </div>
          <div>
            {Object.entries(selectedPixel.attrs).map(([k, v]) => (
              <span key={k} className="attr-pill">
                {k}:{v}
              </span>
            ))}
          </div>
        </div>
      </aside>

      <main className="canvas-wrap">
        <canvas
          ref={canvasRef}
          onPointerDown={(e) => {
            paintingRef.current = true;
            void paintAt(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            inspectAt(e.clientX, e.clientY);
            if (paintingRef.current) {
              void paintAt(e.clientX, e.clientY);
            }
          }}
          onPointerUp={() => {
            paintingRef.current = false;
            lastPaintRef.current = "";
          }}
          onPointerLeave={() => {
            paintingRef.current = false;
            lastPaintRef.current = "";
          }}
        />
      </main>
    </div>
  );
}
