import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { CanvasRenderer } from "../renderer/canvasRenderer";
import type {
  ChunkData,
  PixelCell,
  PixelPrimitive,
  PropertyDefinition,
  PropertyType,
  RegistrySnapshot,
  WorldMeta
} from "../renderer/types";
import { hexToRgb, rgbToHex } from "../lib/color";
import {
  applyPixelPatch,
  createWorld,
  loadChunks,
  loadRegistry,
  loadWorld,
  openReleaseUrl,
  saveRegistry,
  saveWorld,
  validatePixelPayload
} from "../lib/tauriApi";
import { buildAttributeOptions, buildPixelPatch, chunkKey, markDirtyChunks, worldToChunkLocal } from "../lib/worldMath";
import { getGithubUpdateConfig } from "../updater/config";
import { checkGithubReleaseUpdate } from "../updater/githubReleaseUpdater";
import type { UpdateCheckResult } from "../updater/types";

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
  durability: 20
};

const corePixelKeys = new Set(["color", "material", "durability"]);

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

function parseBoolText(raw: string): boolean | null {
  const text = raw.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(text)) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(text)) {
    return false;
  }
  return null;
}

function parseDefaultValue(propertyType: PropertyType, raw: string, enumValues: string[]): PixelPrimitive | null {
  switch (propertyType) {
    case "int": {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        return null;
      }
      return parsed;
    }
    case "float": {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        return null;
      }
      return parsed;
    }
    case "bool": {
      return parseBoolText(raw);
    }
    case "string":
      return raw;
    case "enum": {
      if (enumValues.length === 0) {
        return null;
      }
      if (!enumValues.includes(raw)) {
        return null;
      }
      return raw;
    }
    default:
      return null;
  }
}

function coerceValueByProperty(property: PropertyDefinition, candidate: unknown): PixelPrimitive {
  const fallback = property.default_value;
  switch (property.type) {
    case "int": {
      const source = typeof candidate === "number" ? candidate : typeof candidate === "string" ? Number(candidate) : Number(fallback);
      if (!Number.isFinite(source)) {
        return Number(fallback) || 0;
      }
      return Math.trunc(source);
    }
    case "float": {
      const source = typeof candidate === "number" ? candidate : typeof candidate === "string" ? Number(candidate) : Number(fallback);
      if (!Number.isFinite(source)) {
        return Number(fallback) || 0;
      }
      return source;
    }
    case "bool": {
      if (typeof candidate === "boolean") {
        return candidate;
      }
      if (typeof candidate === "string") {
        const parsed = parseBoolText(candidate);
        if (parsed !== null) {
          return parsed;
        }
      }
      return Boolean(fallback);
    }
    case "string": {
      if (typeof candidate === "string") {
        return candidate;
      }
      return String(fallback ?? "");
    }
    case "enum": {
      const values = property.enum_values ?? [];
      const fallbackValue = typeof fallback === "string" ? fallback : values[0] ?? "";
      if (typeof candidate === "string" && values.includes(candidate)) {
        return candidate;
      }
      if (values.includes(fallbackValue)) {
        return fallbackValue;
      }
      return values[0] ?? "";
    }
    default:
      return String(fallback ?? "");
  }
}

function getPixelDynamicProperties(pixel: PixelCell): Array<[string, unknown]> {
  return Object.entries(pixel).filter(([key]) => !corePixelKeys.has(key));
}

function formatPropertyValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
  const [status, setStatus] = useState("就绪");
  const [isWorldLoaded, setIsWorldLoaded] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [selectedPixel, setSelectedPixel] = useState<PixelCell>(defaultPixel);
  const [selectedCoord, setSelectedCoord] = useState<{ x: number; y: number } | null>(null);
  const [cameraInfo, setCameraInfo] = useState({ x: 0, y: 0, zoom: 1 });

  const [brushColor, setBrushColor] = useState("#ffffff");
  const [brushMaterial, setBrushMaterial] = useState("soil");
  const [brushDurability, setBrushDurability] = useState(20);
  const [brushSize, setBrushSize] = useState(1);
  const [brushProperties, setBrushProperties] = useState<Record<string, PixelPrimitive>>({});

  const [registryVersionInput, setRegistryVersionInput] = useState("1.0.0");
  const [newMaterialId, setNewMaterialId] = useState("");
  const [newMaterialLabel, setNewMaterialLabel] = useState("");
  const [newMaterialMaxDurability, setNewMaterialMaxDurability] = useState(50);

  const [newPropertyName, setNewPropertyName] = useState("");
  const [newPropertyLabel, setNewPropertyLabel] = useState("");
  const [newPropertyType, setNewPropertyType] = useState<PropertyType>("string");
  const [newPropertyDefault, setNewPropertyDefault] = useState("");
  const [newPropertyEnumValues, setNewPropertyEnumValues] = useState("plain,rock");

  const [appVersion, setAppVersion] = useState("0.0.0");
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("未检查");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const paintingRef = useRef(false);
  const panningRef = useRef(false);
  const lastPaintRef = useRef<string>("");
  const loadedChunkKeysRef = useRef<Set<string>>(new Set());
  const loadingVisibleRef = useRef(false);
  const queuedVisibleRef = useRef(false);
  const worldLoadedRef = useRef(false);

  const enumOptions = useMemo(() => {
    if (!registry) {
      return {};
    }
    return buildAttributeOptions(registry);
  }, [registry]);

  const selectedDynamicProps = useMemo(() => getPixelDynamicProperties(selectedPixel), [selectedPixel]);

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
      setStatus(`加载可视区分块失败：${String(error)}`);
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
      setBrushProperties((prev) => {
        const next: Record<string, PixelPrimitive> = {};
        for (const property of snapshot.properties) {
          next[property.name] = coerceValueByProperty(property, prev[property.name]);
        }
        return next;
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
  }, [ensureVisibleChunks, meta, showGrid, syncCameraInfo]);

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

  const loadWorldFromPath = useCallback(
    async (path: string): Promise<void> => {
      try {
        worldLoadedRef.current = false;
        setIsWorldLoaded(false);
        setMetaPath(path);
        setStatus("正在加载地图...");
        const world = await loadWorld(path);
        const snapshot = await loadRegistry();
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
        setIsWorldLoaded(true);
        await ensureVisibleChunks();
        setStatus("地图加载完成");
      } catch (error) {
        worldLoadedRef.current = false;
        setIsWorldLoaded(false);
        setStatus(`地图加载失败：${String(error)}`);
      }
    },
    [ensureVisibleChunks, hydrateBrushDefaults, syncCameraInfo]
  );

  const handleOpenWorld = useCallback(async (): Promise<void> => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "地图元文件", extensions: ["json"] }]
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      await loadWorldFromPath(selected);
    } catch (error) {
      setStatus(`打开地图失败：${String(error)}`);
    }
  }, [loadWorldFromPath]);

  const handleCreateWorld = useCallback(async (): Promise<void> => {
    try {
      const selected = await save({
        title: "新建地图",
        defaultPath: "world.json",
        filters: [{ name: "地图元文件", extensions: ["json"] }]
      });
      if (!selected) {
        return;
      }

      worldLoadedRef.current = false;
      setIsWorldLoaded(false);
      setMetaPath(selected);
      setStatus("正在创建地图...");

      const world = await createWorld(selected);
      const snapshot = await loadRegistry();
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
      setIsWorldLoaded(true);
      await ensureVisibleChunks();
      setStatus("地图创建并加载完成");
    } catch (error) {
      worldLoadedRef.current = false;
      setIsWorldLoaded(false);
      setStatus(`创建地图失败：${String(error)}`);
    }
  }, [ensureVisibleChunks, hydrateBrushDefaults, syncCameraInfo]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!worldLoadedRef.current) {
      setStatus("请先打开或新建地图");
      return;
    }
    try {
      await saveWorld();
      setStatus("地图保存成功");
    } catch (error) {
      setStatus(`保存失败：${String(error)}`);
    }
  }, []);

  const handleCheckUpdates = useCallback(async (): Promise<void> => {
    setIsCheckingUpdate(true);
    try {
      const config = getGithubUpdateConfig();
      const current = (await getVersion()) || appVersion;
      if (current && current !== appVersion) {
        setAppVersion(current);
      }
      const result = await checkGithubReleaseUpdate(current || appVersion, config);
      setUpdateInfo(result);
      if (result.hasUpdate) {
        setUpdateStatus(`发现新版本 ${result.latestVersion}`);
      } else {
        setUpdateStatus(`已是最新版本 (${result.currentVersion})`);
      }
    } catch (error) {
      setUpdateStatus(`检查失败：${String(error)}`);
    } finally {
      setIsCheckingUpdate(false);
    }
  }, [appVersion]);

  const handleOpenUpdatePage = useCallback(async (): Promise<void> => {
    const target = updateInfo?.downloadUrl || updateInfo?.releaseUrl;
    if (!target) {
      setUpdateStatus("没有可打开的更新链接");
      return;
    }
    try {
      await openReleaseUrl(target);
    } catch (error) {
      setUpdateStatus(`打开链接失败：${String(error)}`);
    }
  }, [updateInfo]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const version = await getVersion();
        if (!alive) {
          return;
        }
        setAppVersion(version);
        setUpdateStatus(`当前版本 ${version}`);
      } catch (error) {
        if (alive) {
          setUpdateStatus(`读取版本失败：${String(error)}`);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: UnlistenFn[] = [];

    const bindMenuEvents = async () => {
      const bind = async (eventName: string, handler: () => Promise<void>) => {
        const unlisten = await listen(eventName, () => {
          void handler();
        });
        if (!active) {
          unlisten();
          return;
        }
        unlisteners.push(unlisten);
      };

      await bind("menu:new-world", handleCreateWorld);
      await bind("menu:open-world", handleOpenWorld);
      await bind("menu:save-world", handleSave);
    };

    void bindMenuEvents();

    return () => {
      active = false;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [handleCreateWorld, handleOpenWorld, handleSave]);

  const saveRegistrySnapshot = async (snapshot: RegistrySnapshot): Promise<boolean> => {
    try {
      const saved = await saveRegistry(snapshot);
      setRegistry(saved);
      hydrateBrushDefaults(saved);
      setStatus("索引库保存成功");
      return true;
    } catch (error) {
      setStatus(`索引库保存失败：${String(error)}`);
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
      setStatus("材质 ID 和名称不能为空");
      return;
    }
    if (registry.materials.some((m) => m.id === id)) {
      setStatus(`材质 '${id}' 已存在`);
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

  const handleAddProperty = async (): Promise<void> => {
    if (!registry) {
      return;
    }

    const name = normalizeId(newPropertyName);
    const label = newPropertyLabel.trim();
    if (!name || !label) {
      setStatus("属性名和属性标签不能为空");
      return;
    }
    if (corePixelKeys.has(name) || name === "attrs") {
      setStatus(`属性名 '${name}' 是保留字段`);
      return;
    }
    if (registry.properties.some((property) => property.name === name)) {
      setStatus(`属性 '${name}' 已存在`);
      return;
    }

    const enumValues = newPropertyType === "enum" ? parseCsvValues(newPropertyEnumValues) : [];
    const defaultSeed =
      newPropertyType === "enum" && newPropertyDefault.trim().length === 0 ? enumValues[0] ?? "" : newPropertyDefault.trim();

    const parsedDefault = parseDefaultValue(newPropertyType, defaultSeed, enumValues);
    if (parsedDefault === null) {
      setStatus("默认值与属性类型不匹配");
      return;
    }

    const next: RegistrySnapshot = {
      ...registry,
      version: registryVersionInput.trim() || registry.version,
      properties: [
        ...registry.properties,
        {
          name,
          label,
          type: newPropertyType,
          default_value: parsedDefault,
          enum_values: enumValues
        }
      ]
    };

    const ok = await saveRegistrySnapshot(next);
    if (ok) {
      setNewPropertyName("");
      setNewPropertyLabel("");
      setNewPropertyType("string");
      setNewPropertyDefault("");
      setNewPropertyEnumValues("plain,rock");
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
      durability: brushDurability
    };

    for (const property of registry.properties) {
      pixel[property.name] = coerceValueByProperty(property, brushProperties[property.name]);
    }

    const valid = await validatePixelPayload(pixel);
    if (!valid.ok) {
      setStatus(`校验失败：${valid.errors.map((e) => `${e.field}: ${e.message}`).join("；")}`);
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
      setStatus(`已绘制 ${patches.length} 像素，中心 (${point.worldX}, ${point.worldY})`);
    } catch (error) {
      setStatus(`绘制失败：${String(error)}`);
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
        <h1 className="title">墨镇编辑器</h1>

        <div className="section">
          <strong>地图</strong>
          <div className="row">
            <label>元文件路径</label>
            <input value={metaPath} readOnly />
          </div>
          <div className="status">请使用顶部菜单：新建 / 打开 / 保存</div>
          <div className="status">{status}</div>
        </div>

        <div className="section">
          <strong>更新</strong>
          <div className="status">当前版本：{appVersion}</div>
          <div className="status">{updateStatus}</div>
          {updateInfo ? (
            <div className="status">
              最新发布：{updateInfo.releaseName} ({updateInfo.latestVersion})
            </div>
          ) : null}
          <div className="row row-buttons">
            <button onClick={() => void handleCheckUpdates()} disabled={isCheckingUpdate}>
              {isCheckingUpdate ? "检查中..." : "检查更新"}
            </button>
            <button onClick={() => void handleOpenUpdatePage()} disabled={!updateInfo}>
              打开下载页
            </button>
          </div>
        </div>

        <div className="section">
          <strong>视角</strong>
          <div className="status">
            坐标=({cameraInfo.x}, {cameraInfo.y}) 缩放={cameraInfo.zoom.toFixed(2)}x
          </div>
          <div className="status">中键拖拽平移 | 滚轮缩放 | 左键绘制</div>
          <div className="row">
            <label>网格</label>
            <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
          </div>
        </div>

        <div className="section">
          <strong>画笔</strong>
          <div className="row">
            <label>颜色</label>
            <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} />
          </div>
          <div className="row">
            <label>材质</label>
            <select value={brushMaterial} onChange={(e) => setBrushMaterial(e.target.value)}>
              {(registry?.materials ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.id})
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <label>耐久</label>
            <input
              type="number"
              min={0}
              value={brushDurability}
              onChange={(e) => setBrushDurability(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <div className="row">
            <label>画笔大小</label>
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
          <strong>画笔属性</strong>
          {(registry?.properties ?? []).map((property) => {
            const value = brushProperties[property.name];
            if (property.type === "enum") {
              return (
                <div className="row" key={property.name}>
                  <label>{property.label}</label>
                  <select
                    value={typeof value === "string" ? value : String(property.default_value ?? "")}
                    onChange={(e) => setBrushProperties((prev) => ({ ...prev, [property.name]: e.target.value }))}
                  >
                    {(enumOptions[property.name] ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }

            if (property.type === "bool") {
              return (
                <div className="row" key={property.name}>
                  <label>{property.label}</label>
                  <input
                    type="checkbox"
                    checked={Boolean(value ?? property.default_value)}
                    onChange={(e) => setBrushProperties((prev) => ({ ...prev, [property.name]: e.target.checked }))}
                  />
                </div>
              );
            }

            const isNumber = property.type === "int" || property.type === "float";
            return (
              <div className="row" key={property.name}>
                <label>{property.label}</label>
                <input
                  type={isNumber ? "number" : "text"}
                  step={property.type === "float" ? "0.01" : "1"}
                  value={value === undefined ? String(property.default_value ?? "") : String(value)}
                  onChange={(e) => {
                    const nextRaw = e.target.value;
                    if (isNumber) {
                      const parsed = Number(nextRaw);
                      if (!Number.isFinite(parsed)) {
                        setBrushProperties((prev) => ({ ...prev, [property.name]: 0 }));
                        return;
                      }
                      const normalized = property.type === "int" ? Math.trunc(parsed) : parsed;
                      setBrushProperties((prev) => ({ ...prev, [property.name]: normalized }));
                      return;
                    }
                    setBrushProperties((prev) => ({ ...prev, [property.name]: nextRaw }));
                  }}
                />
              </div>
            );
          })}
        </div>

        <div className="section">
          <strong>索引库编辑</strong>
          <div className="row">
            <label>版本号</label>
            <input value={registryVersionInput} onChange={(e) => setRegistryVersionInput(e.target.value)} />
          </div>

          <div className="sub-title">新增材质</div>
          <div className="row">
            <label>标识</label>
            <input value={newMaterialId} onChange={(e) => setNewMaterialId(e.target.value)} placeholder="例如 metal" />
          </div>
          <div className="row">
            <label>名称</label>
            <input value={newMaterialLabel} onChange={(e) => setNewMaterialLabel(e.target.value)} placeholder="例如 Metal" />
          </div>
          <div className="row">
            <label>最大耐久</label>
            <input
              type="number"
              min={0}
              value={newMaterialMaxDurability}
              onChange={(e) => setNewMaterialMaxDurability(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <div className="row row-buttons">
            <button onClick={() => void handleAddMaterial()}>添加材质</button>
          </div>

          <div className="sub-title">新增属性</div>
          <div className="row">
            <label>属性名</label>
            <input value={newPropertyName} onChange={(e) => setNewPropertyName(e.target.value)} placeholder="例如 biome" />
          </div>
          <div className="row">
            <label>属性标签</label>
            <input value={newPropertyLabel} onChange={(e) => setNewPropertyLabel(e.target.value)} placeholder="例如 Biome" />
          </div>
          <div className="row">
            <label>类型</label>
            <select value={newPropertyType} onChange={(e) => setNewPropertyType(e.target.value as PropertyType)}>
              <option value="int">int</option>
              <option value="float">float</option>
              <option value="bool">bool</option>
              <option value="string">string</option>
              <option value="enum">enum</option>
            </select>
          </div>
          <div className="row">
            <label>默认值</label>
            {newPropertyType === "bool" ? (
              <select value={newPropertyDefault || "false"} onChange={(e) => setNewPropertyDefault(e.target.value)}>
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            ) : (
              <input
                value={newPropertyDefault}
                onChange={(e) => setNewPropertyDefault(e.target.value)}
                placeholder={newPropertyType === "enum" ? "必须在枚举可选值中" : "输入默认值"}
              />
            )}
          </div>
          {newPropertyType === "enum" ? (
            <div className="row">
              <label>枚举值</label>
              <input value={newPropertyEnumValues} onChange={(e) => setNewPropertyEnumValues(e.target.value)} placeholder="a,b,c" />
            </div>
          ) : null}
          <div className="row row-buttons">
            <button onClick={() => void handleAddProperty()}>添加属性</button>
          </div>
        </div>

        <div className="section">
          <strong>检视</strong>
          <div className="status">{selectedCoord ? `(${selectedCoord.x}, ${selectedCoord.y})` : "未选中像素"}</div>
          <div className="row">
            <label>颜色</label>
            <input value={rgbToHex(selectedPixel.color)} readOnly />
          </div>
          <div className="row">
            <label>材质</label>
            <input value={selectedPixel.material} readOnly />
          </div>
          <div className="row">
            <label>耐久</label>
            <input value={selectedPixel.durability} readOnly />
          </div>
          <div>
            {selectedDynamicProps.map(([key, value]) => (
              <span key={key} className="attr-pill">
                {key}:{formatPropertyValue(value)}
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
