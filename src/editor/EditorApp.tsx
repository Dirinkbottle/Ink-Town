import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { CanvasRenderer } from "../renderer/canvasRenderer";
import type { ChunkData, PixelCell, PixelPrimitive, PropertyType, RegistrySnapshot, WorldMeta } from "../renderer/types";
import { hexToRgb } from "../lib/color";
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
import { PanelSection } from "./components/PanelSection";
import { SidebarHeader } from "./components/SidebarHeader";
import { InspectSection } from "./components/sections/InspectSection";
import { BrushPropertiesSection } from "./components/sections/BrushPropertiesSection";
import { BrushSection } from "./components/sections/BrushSection";
import { MapStatusSection } from "./components/sections/MapStatusSection";
import { RegistryEditorSection } from "./components/sections/RegistryEditorSection";
import { UpdateSection } from "./components/sections/UpdateSection";
import { ViewSection } from "./components/sections/ViewSection";
import { corePixelKeys, defaultMeta, defaultPixel } from "./constants";
import type { PanelSectionId } from "./types/panel";
import {
  buildBrushOffsets,
  coerceValueByProperty,
  formatPropertyValue,
  getPixelDynamicProperties,
  normalizeId,
  parseCsvValues,
  parseDefaultValue
} from "./utils/propertyHelpers";
type InteractionMode = "idle" | "painting" | "panning";

export function EditorApp() {
  const [metaPath, setMetaPath] = useState("data/world/world.json");
  const [meta, setMeta] = useState<WorldMeta>(defaultMeta);
  const [registry, setRegistry] = useState<RegistrySnapshot | null>(null);
  const [chunks, setChunks] = useState<Map<string, ChunkData>>(new Map());
  const [dirtyChunkSet, setDirtyChunkSet] = useState(new Set<string>());
  const [status, setStatus] = useState("就绪");
  const [isWorldLoaded, setIsWorldLoaded] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sectionCollapsed, setSectionCollapsed] = useState<Record<PanelSectionId, boolean>>({
    map: false,
    update: false,
    view: false,
    brush: false,
    brushProps: false,
    registry: false,
    inspect: false
  });
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("idle");
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
  const brushCursor = useMemo(() => {
    const svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'><rect x='3' y='1' width='4' height='10' fill='%23222'/><rect x='2' y='0' width='6' height='2' fill='%23ffffff'/><rect x='1' y='11' width='8' height='6' rx='1' fill='%232b7fff'/><rect x='3' y='13' width='4' height='2' fill='%23ffffff'/></svg>";
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 3 16, crosshair`;
  }, []);
  const canvasCursor = useMemo(() => {
    if (!isWorldLoaded) {
      return "not-allowed";
    }
    if (interactionMode === "panning") {
      return "grabbing";
    }
    return brushCursor;
  }, [brushCursor, interactionMode, isWorldLoaded]);

  const toggleSection = useCallback((id: PanelSectionId) => {
    setSectionCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

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
    <div className={`app ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <SidebarHeader collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((prev) => !prev)} />

        {sidebarCollapsed ? (
          <div className="sidebar-collapsed-help">点击右上角按钮展开功能栏</div>
        ) : (
          <>
            <PanelSection title="地图" collapsed={sectionCollapsed.map} onToggle={() => toggleSection("map")}>
              <MapStatusSection metaPath={metaPath} status={status} />
            </PanelSection>

            <PanelSection title="更新" collapsed={sectionCollapsed.update} onToggle={() => toggleSection("update")}>
              <UpdateSection
                appVersion={appVersion}
                updateStatus={updateStatus}
                updateInfo={updateInfo}
                isCheckingUpdate={isCheckingUpdate}
                onCheckUpdate={() => void handleCheckUpdates()}
                onOpenUpdatePage={() => void handleOpenUpdatePage()}
              />
            </PanelSection>

            <PanelSection title="视角" collapsed={sectionCollapsed.view} onToggle={() => toggleSection("view")}>
              <ViewSection
                cameraX={cameraInfo.x}
                cameraY={cameraInfo.y}
                zoom={cameraInfo.zoom}
                showGrid={showGrid}
                onToggleGrid={setShowGrid}
              />
            </PanelSection>

            <PanelSection title="画笔" collapsed={sectionCollapsed.brush} onToggle={() => toggleSection("brush")}>
              <BrushSection
                brushColor={brushColor}
                brushMaterial={brushMaterial}
                brushDurability={brushDurability}
                brushSize={brushSize}
                materials={registry?.materials ?? []}
                onChangeColor={setBrushColor}
                onChangeMaterial={setBrushMaterial}
                onChangeDurability={(value) => setBrushDurability(Math.max(0, value))}
                onChangeBrushSize={(value) => setBrushSize(Math.max(1, Math.floor(value)))}
              />
            </PanelSection>

            <PanelSection title="画笔属性" collapsed={sectionCollapsed.brushProps} onToggle={() => toggleSection("brushProps")}>
              <BrushPropertiesSection
                properties={registry?.properties ?? []}
                brushProperties={brushProperties}
                enumOptions={enumOptions}
                onChangeProperty={(name, value) => setBrushProperties((prev) => ({ ...prev, [name]: value }))}
              />
            </PanelSection>

            <PanelSection title="索引库编辑" collapsed={sectionCollapsed.registry} onToggle={() => toggleSection("registry")}>
              <RegistryEditorSection
                registryVersionInput={registryVersionInput}
                newMaterialId={newMaterialId}
                newMaterialLabel={newMaterialLabel}
                newMaterialMaxDurability={newMaterialMaxDurability}
                newPropertyName={newPropertyName}
                newPropertyLabel={newPropertyLabel}
                newPropertyType={newPropertyType}
                newPropertyDefault={newPropertyDefault}
                newPropertyEnumValues={newPropertyEnumValues}
                onSetRegistryVersionInput={setRegistryVersionInput}
                onSetNewMaterialId={setNewMaterialId}
                onSetNewMaterialLabel={setNewMaterialLabel}
                onSetNewMaterialMaxDurability={setNewMaterialMaxDurability}
                onAddMaterial={() => void handleAddMaterial()}
                onSetNewPropertyName={setNewPropertyName}
                onSetNewPropertyLabel={setNewPropertyLabel}
                onSetNewPropertyType={setNewPropertyType}
                onSetNewPropertyDefault={setNewPropertyDefault}
                onSetNewPropertyEnumValues={setNewPropertyEnumValues}
                onAddProperty={() => void handleAddProperty()}
              />
            </PanelSection>

            <PanelSection title="检视" collapsed={sectionCollapsed.inspect} onToggle={() => toggleSection("inspect")}>
              <InspectSection
                selectedCoord={selectedCoord}
                selectedPixel={selectedPixel}
                selectedDynamicProps={selectedDynamicProps}
                formatPropertyValue={formatPropertyValue}
              />
            </PanelSection>
          </>
        )}
      </aside>

      <main className="canvas-wrap">
        <canvas
          ref={canvasRef}
          className="world-canvas"
          style={{ cursor: canvasCursor }}
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
              setInteractionMode("panning");
              e.currentTarget.setPointerCapture(e.pointerId);
              e.preventDefault();
              return;
            }
            if (e.button === 0) {
              if (!worldLoadedRef.current) {
                setStatus("请先打开或新建地图");
                return;
              }
              paintingRef.current = true;
              setInteractionMode("painting");
              e.currentTarget.setPointerCapture(e.pointerId);
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
            if (!panningRef.current && !paintingRef.current) {
              setInteractionMode("idle");
            }
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          onPointerCancel={(e) => {
            paintingRef.current = false;
            panningRef.current = false;
            lastPaintRef.current = "";
            setInteractionMode("idle");
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          onPointerLeave={() => {
            paintingRef.current = false;
            panningRef.current = false;
            lastPaintRef.current = "";
            setInteractionMode("idle");
          }}
        />
      </main>
    </div>
  );
}
