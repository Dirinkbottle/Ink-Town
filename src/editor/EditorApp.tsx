import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { CanvasRenderer } from "../renderer/canvasRenderer";
import type { ChunkCoord, ChunkData, PixelCell, RegistrySnapshot, WorldMeta } from "../renderer/types";
import { hexToRgb, rgbToHex } from "../lib/color";
import {
  applyPixelPatch,
  loadChunks,
  loadRegistry,
  loadWorld,
  saveRegistry,
  saveWorld,
  validatePixelPayload
} from "../lib/tauriApi";
import { buildAttributeOptions, buildPixelPatch, chunkKey, markDirtyChunks, worldToChunkLocal } from "../lib/worldMath";

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

function normalizeId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function parseCsvValues(raw: string): string[] {
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function buildBrushOffsets(size: number): Array<{ dx: number; dy: number }> {
  const offsets: Array<{ dx: number; dy: number }> = [];
  const radius = Math.floor(size / 2);
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (x * x + y * y <= radius * radius + 0.25) {
        offsets.push({ dx: x, dy: y });
      }
    }
  }
  return offsets.length > 0 ? offsets : [{ dx: 0, dy: 0 }];
}

export function EditorApp() {
  const [metaPath, setMetaPath] = useState("data/world/world.json");
  const [meta, setMeta] = useState<WorldMeta>(defaultMeta);
  const [registry, setRegistry] = useState<RegistrySnapshot | null>(null);
  const [chunks, setChunks] = useState<Map<string, ChunkData>>(new Map());
  const [dirtyChunkSet, setDirtyChunkSet] = useState(new Set<string>());
  const [status, setStatus] = useState("Ready");
  const [showGrid, setShowGrid] = useState(true);
  const [selectedPixel, setSelectedPixel] = useState<PixelCell>(defaultPixel);
  const [selectedCoord, setSelectedCoord] = useState<{ x: number; y: number } | null>(null);
  const [cameraInfo, setCameraInfo] = useState({ x: 0, y: 0, zoom: 1 });

  const [brushColor, setBrushColor] = useState("#ffffff");
  const [brushMaterial, setBrushMaterial] = useState("soil");
  const [brushDurability, setBrushDurability] = useState(20);
  const [brushSize, setBrushSize] = useState(1);
  const [brushAttrs, setBrushAttrs] = useState<Record<string, string>>({});

  const [registryVersionInput, setRegistryVersionInput] = useState("1.0.0");
  const [newMaterialId, setNewMaterialId] = useState("");
  const [newMaterialLabel, setNewMaterialLabel] = useState("");
  const [newMaterialMaxDurability, setNewMaterialMaxDurability] = useState(50);

  const [newAttributeId, setNewAttributeId] = useState("");
  const [newAttributeLabel, setNewAttributeLabel] = useState("");
  const [newAttributeRequired, setNewAttributeRequired] = useState(false);
  const [newAttributeValues, setNewAttributeValues] = useState("plain, forest, rock");

  const [selectedAttributeForValue, setSelectedAttributeForValue] = useState("");
  const [newValueForAttribute, setNewValueForAttribute] = useState("");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const paintingRef = useRef(false);
  const panningRef = useRef(false);
  const lastPaintRef = useRef<string>("");
  const loadedChunkKeysRef = useRef<Set<string>>(new Set());
  const loadingVisibleRef = useRef(false);
  const queuedVisibleRef = useRef(false);
  const worldLoadedRef = useRef(false);

  const attributeOptions = useMemo(() => {
    if (!registry) {
      return {};
    }
    return buildAttributeOptions(registry);
  }, [registry]);

  const syncCameraInfo = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) {
      return;
    }
    const camera = renderer.getCamera();
    setCameraInfo({
      x: Math.floor(camera.x),
      y: Math.floor(camera.y),
      zoom: renderer.getZoom()
    });
  }, []);

  const applyLoadedChunks = useCallback((loaded: ChunkData[]) => {
    if (loaded.length === 0) {
      return;
    }

    rendererRef.current?.upsertChunks(loaded);
    setChunks((prev) => {
      const next = new Map(prev);
      for (const chunk of loaded) {
        const key = chunkKey(chunk.coord);
        next.set(key, chunk);
        loadedChunkKeysRef.current.add(key);
      }
      return next;
    });
    setDirtyChunkSet((prev) => markDirtyChunks(prev, loaded.map((chunk) => chunk.coord)));
  }, []);

  const ensureVisibleChunks = useCallback(async () => {
    if (!worldLoadedRef.current) {
      return;
    }

    const renderer = rendererRef.current;
    if (!renderer) {
      return;
    }

    if (loadingVisibleRef.current) {
      queuedVisibleRef.current = true;
      return;
    }

    loadingVisibleRef.current = true;
    try {
      const visible = renderer.getVisibleChunkCoords(1);
      const required = visible.filter((coord) => !loadedChunkKeysRef.current.has(chunkKey(coord)));
      if (required.length > 0) {
        const loaded = await loadChunks(required);
        applyLoadedChunks(loaded);
      }
    } catch (error) {
      setStatus(`Load visible chunks failed: ${String(error)}`);
    } finally {
      loadingVisibleRef.current = false;
      if (queuedVisibleRef.current) {
        queuedVisibleRef.current = false;
        void ensureVisibleChunks();
      }
    }
  }, [applyLoadedChunks]);

  const hydrateBrushDefaults = useCallback(
    (snapshot: RegistrySnapshot) => {
      if (!snapshot.materials.some((m) => m.id === brushMaterial)) {
        setBrushMaterial(snapshot.materials[0]?.id ?? "");
      }
      setBrushAttrs((prev) => {
        const next: Record<string, string> = {};
        for (const attr of snapshot.attributes) {
          const values = snapshot.value_sets[attr.value_set] ?? [];
          const curr = prev[attr.id];
          if (curr && values.includes(curr)) {
            next[attr.id] = curr;
          } else if (values[0]) {
            next[attr.id] = values[0];
          }
        }
        return next;
      });
      setSelectedAttributeForValue((prev) => {
        if (prev && snapshot.attributes.some((a) => a.id === prev)) {
          return prev;
        }
        return snapshot.attributes[0]?.id ?? "";
      });
      setRegistryVersionInput(snapshot.version);
    },
    [brushMaterial]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const renderer = new CanvasRenderer({ canvas });
    renderer.configure(meta);
    renderer.setGridVisible(showGrid);
    renderer.setCamera(0, 0);
    rendererRef.current = renderer;

    const parent = canvas.parentElement;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const box = entry.contentRect;
        renderer.setCanvasSize(box.width, box.height);
        syncCameraInfo();
        void ensureVisibleChunks();
      }
    });
    if (parent) {
      observer.observe(parent);
      const rect = parent.getBoundingClientRect();
      renderer.setCanvasSize(rect.width, rect.height);
    }

    let raf = 0;
    const frame = () => {
      renderer.renderFrame();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      rendererRef.current = null;
    };
  }, [ensureVisibleChunks, syncCameraInfo]);

  useEffect(() => {
    rendererRef.current?.configure(meta);
  }, [meta]);

  useEffect(() => {
    rendererRef.current?.setGridVisible(showGrid);
  }, [showGrid]);

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

  const handleOpenWorld = async (): Promise<void> => {
    try {
      worldLoadedRef.current = false;
      setStatus("Loading world...");
      const [world, snapshot] = await Promise.all([loadWorld(metaPath), loadRegistry()]);
      setMeta(world.meta);
      setRegistry(snapshot);
      hydrateBrushDefaults(snapshot);

      const initialMap = new Map(world.initial_chunks.map((chunk) => [chunkKey(chunk.coord), chunk]));
      setChunks(initialMap);
      loadedChunkKeysRef.current = new Set(initialMap.keys());

      const renderer = rendererRef.current;
      if (renderer) {
        renderer.configure(world.meta);
        renderer.setCamera(0, 0);
        renderer.resetChunks(world.initial_chunks);
        syncCameraInfo();
      }

      worldLoadedRef.current = true;
      await ensureVisibleChunks();
      setStatus("World loaded");
    } catch (error) {
      worldLoadedRef.current = false;
      setStatus(`Failed to load world: ${String(error)}`);
    }
  };

  const handleBrowseWorld = async (): Promise<void> => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "World Meta", extensions: ["json"] }]
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      setMetaPath(selected);
      setStatus(`Selected map: ${selected}`);
    } catch (error) {
      setStatus(`Select file failed: ${String(error)}`);
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

  const saveRegistrySnapshot = async (snapshot: RegistrySnapshot): Promise<boolean> => {
    try {
      const saved = await saveRegistry(snapshot);
      setRegistry(saved);
      hydrateBrushDefaults(saved);
      setStatus("Registry saved");
      return true;
    } catch (error) {
      setStatus(`Save registry failed: ${String(error)}`);
      return false;
    }
  };

  const handleAddMaterial = async (): Promise<void> => {
    if (!registry) {
      return;
    }
    const id = normalizeId(newMaterialId);
    const label = newMaterialLabel.trim();
    if (!id || !label) {
      setStatus("Material id/label cannot be empty");
      return;
    }
    if (registry.materials.some((m) => m.id === id)) {
      setStatus(`Material '${id}' already exists`);
      return;
    }

    const next: RegistrySnapshot = {
      ...registry,
      version: registryVersionInput.trim() || registry.version,
      materials: [
        ...registry.materials,
        {
          id,
          label,
          max_durability: Math.max(0, Math.floor(newMaterialMaxDurability))
        }
      ]
    };

    const ok = await saveRegistrySnapshot(next);
    if (ok) {
      setNewMaterialId("");
      setNewMaterialLabel("");
      setNewMaterialMaxDurability(50);
    }
  };

  const handleAddAttribute = async (): Promise<void> => {
    if (!registry) {
      return;
    }
    const id = normalizeId(newAttributeId);
    const label = newAttributeLabel.trim();
    const values = parseCsvValues(newAttributeValues);
    if (!id || !label) {
      setStatus("Attribute id/label cannot be empty");
      return;
    }
    if (values.length === 0) {
      setStatus("Attribute values cannot be empty");
      return;
    }
    if (registry.attributes.some((a) => a.id === id)) {
      setStatus(`Attribute '${id}' already exists`);
      return;
    }

    let valueSetId = `${id}_set`;
    let seed = 1;
    while (registry.value_sets[valueSetId]) {
      seed += 1;
      valueSetId = `${id}_set_${seed}`;
    }

    const next: RegistrySnapshot = {
      ...registry,
      version: registryVersionInput.trim() || registry.version,
      attributes: [
        ...registry.attributes,
        {
          id,
          label,
          value_set: valueSetId,
          required: newAttributeRequired
        }
      ],
      value_sets: {
        ...registry.value_sets,
        [valueSetId]: values
      }
    };

    const ok = await saveRegistrySnapshot(next);
    if (ok) {
      setNewAttributeId("");
      setNewAttributeLabel("");
      setNewAttributeRequired(false);
      setNewAttributeValues("plain, forest, rock");
      setSelectedAttributeForValue(id);
    }
  };

  const handleAddValueToAttribute = async (): Promise<void> => {
    if (!registry || !selectedAttributeForValue) {
      return;
    }

    const value = newValueForAttribute.trim();
    if (!value) {
      setStatus("New value cannot be empty");
      return;
    }

    const attr = registry.attributes.find((a) => a.id === selectedAttributeForValue);
    if (!attr) {
      setStatus("Selected attribute not found");
      return;
    }

    const currentValues = registry.value_sets[attr.value_set] ?? [];
    if (currentValues.includes(value)) {
      setStatus(`Value '${value}' already exists`);
      return;
    }

    const next: RegistrySnapshot = {
      ...registry,
      version: registryVersionInput.trim() || registry.version,
      value_sets: {
        ...registry.value_sets,
        [attr.value_set]: [...currentValues, value]
      }
    };

    const ok = await saveRegistrySnapshot(next);
    if (ok) {
      setNewValueForAttribute("");
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
    const stampKey = `${point.worldX},${point.worldY},${brushSize}`;
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

    const offsets = buildBrushOffsets(Math.max(1, Math.floor(brushSize)));
    const patches = offsets.map(({ dx, dy }) => buildPixelPatch(point.worldX + dx, point.worldY + dy, pixel));

    try {
      const changedCoords = await applyPixelPatch(patches);
      const refreshed = await loadChunks(changedCoords);
      applyLoadedChunks(refreshed);
      setSelectedCoord({ x: point.worldX, y: point.worldY });
      setSelectedPixel(pixel);
      lastPaintRef.current = stampKey;
      setStatus(`Painted ${patches.length} px around (${point.worldX}, ${point.worldY})`);
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
        <h1 className="title">Ink Town Editor</h1>

        <div className="section">
          <strong>World</strong>
          <div className="row">
            <label>Meta Path</label>
            <input value={metaPath} onChange={(e) => setMetaPath(e.target.value)} />
          </div>
          <div className="row row-buttons">
            <button onClick={() => void handleBrowseWorld()}>Browse</button>
            <button className="primary" onClick={() => void handleOpenWorld()}>
              Open
            </button>
            <button onClick={() => void handleSave()}>Save</button>
          </div>
          <div className="status">{status}</div>
        </div>

        <div className="section">
          <strong>Camera</strong>
          <div className="status">
            world=({cameraInfo.x}, {cameraInfo.y}) zoom={cameraInfo.zoom.toFixed(2)}x
          </div>
          <div className="status">Middle mouse drag: pan | Wheel: zoom | Left mouse: paint</div>
          <div className="row">
            <label>Grid</label>
            <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
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
              onChange={(e) => setBrushDurability(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <div className="row">
            <label>Brush Size</label>
            <input
              type="range"
              min={1}
              max={15}
              step={1}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value) || 1)}
            />
            <span className="value-badge">{brushSize}</span>
          </div>
        </div>

        <div className="section">
          <strong>Brush Attributes</strong>
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
          <strong>Registry Editor</strong>
          <div className="row">
            <label>Version</label>
            <input value={registryVersionInput} onChange={(e) => setRegistryVersionInput(e.target.value)} />
          </div>

          <div className="sub-title">Add Material</div>
          <div className="row">
            <label>ID</label>
            <input value={newMaterialId} onChange={(e) => setNewMaterialId(e.target.value)} placeholder="e.g. metal" />
          </div>
          <div className="row">
            <label>Label</label>
            <input value={newMaterialLabel} onChange={(e) => setNewMaterialLabel(e.target.value)} placeholder="Metal" />
          </div>
          <div className="row">
            <label>Max Durability</label>
            <input
              type="number"
              min={0}
              value={newMaterialMaxDurability}
              onChange={(e) => setNewMaterialMaxDurability(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <div className="row row-buttons">
            <button onClick={() => void handleAddMaterial()}>Add Material</button>
          </div>

          <div className="sub-title">Add Attribute</div>
          <div className="row">
            <label>ID</label>
            <input value={newAttributeId} onChange={(e) => setNewAttributeId(e.target.value)} placeholder="e.g. biome" />
          </div>
          <div className="row">
            <label>Label</label>
            <input value={newAttributeLabel} onChange={(e) => setNewAttributeLabel(e.target.value)} placeholder="Biome" />
          </div>
          <div className="row">
            <label>Values (CSV)</label>
            <input value={newAttributeValues} onChange={(e) => setNewAttributeValues(e.target.value)} />
          </div>
          <div className="row">
            <label>Required</label>
            <input type="checkbox" checked={newAttributeRequired} onChange={(e) => setNewAttributeRequired(e.target.checked)} />
          </div>
          <div className="row row-buttons">
            <button onClick={() => void handleAddAttribute()}>Add Attribute</button>
          </div>

          <div className="sub-title">Append Value</div>
          <div className="row">
            <label>Attribute</label>
            <select value={selectedAttributeForValue} onChange={(e) => setSelectedAttributeForValue(e.target.value)}>
              <option value="">Select...</option>
              {(registry?.attributes ?? []).map((attr) => (
                <option key={attr.id} value={attr.id}>
                  {attr.label} ({attr.id})
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <label>New Value</label>
            <input value={newValueForAttribute} onChange={(e) => setNewValueForAttribute(e.target.value)} placeholder="e.g. swamp" />
          </div>
          <div className="row row-buttons">
            <button onClick={() => void handleAddValueToAttribute()}>Add Value</button>
          </div>
        </div>

        <div className="section">
          <strong>Inspect</strong>
          <div className="status">{selectedCoord ? `(${selectedCoord.x}, ${selectedCoord.y})` : "no cell selected"}</div>
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
          onContextMenu={(e) => e.preventDefault()}
          onWheel={(e) => {
            e.preventDefault();
            const renderer = rendererRef.current;
            if (!renderer) {
              return;
            }
            const factor = e.deltaY < 0 ? 1.15 : 0.88;
            renderer.zoomAt(factor, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
            syncCameraInfo();
            void ensureVisibleChunks();
          }}
          onPointerDown={(e) => {
            if (e.button === 1) {
              panningRef.current = true;
              e.preventDefault();
              return;
            }
            if (e.button === 0) {
              paintingRef.current = true;
              void paintAt(e.clientX, e.clientY);
            }
          }}
          onPointerMove={(e) => {
            inspectAt(e.clientX, e.clientY);
            if (panningRef.current) {
              rendererRef.current?.panByPixels(e.movementX, e.movementY);
              syncCameraInfo();
              void ensureVisibleChunks();
              return;
            }
            if (paintingRef.current) {
              void paintAt(e.clientX, e.clientY);
            }
          }}
          onPointerUp={(e) => {
            if (e.button === 1) {
              panningRef.current = false;
            }
            if (e.button === 0) {
              paintingRef.current = false;
              lastPaintRef.current = "";
            }
          }}
          onPointerLeave={() => {
            paintingRef.current = false;
            panningRef.current = false;
            lastPaintRef.current = "";
          }}
        />
      </main>
    </div>
  );
}
