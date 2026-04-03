import type { PixelCell, PixelPrimitive, PropertyType, RegistrySnapshot } from "../../renderer/types";
import type { UpdateCheckResult } from "../../updater/types";
import type { PanelSectionId } from "../types/panel";
import { PanelSection } from "./PanelSection";
import { SidebarHeader } from "./SidebarHeader";
import { BrushPropertiesSection } from "./sections/BrushPropertiesSection";
import { BrushSection } from "./sections/BrushSection";
import { InspectSection } from "./sections/InspectSection";
import { MapStatusSection } from "./sections/MapStatusSection";
import { RegistryEditorSection } from "./sections/RegistryEditorSection";
import { UpdateSection } from "./sections/UpdateSection";
import { ViewSection } from "./sections/ViewSection";

interface EditorSidebarProps {
  sidebarCollapsed: boolean;
  sectionCollapsed: Record<PanelSectionId, boolean>;
  onToggleSidebar: () => void;
  onToggleSection: (id: PanelSectionId) => void;
  metaPath: string;
  status: string;
  appVersion: string;
  updateStatus: string;
  updateInfo: UpdateCheckResult | null;
  isCheckingUpdate: boolean;
  onCheckUpdates: () => void;
  onOpenUpdatePage: () => void;
  cameraInfo: { x: number; y: number; zoom: number };
  showGrid: boolean;
  onToggleGrid: (next: boolean) => void;
  brushColor: string;
  brushMaterial: string;
  brushDurability: number;
  brushSize: number;
  onChangeBrushColor: (value: string) => void;
  onChangeBrushMaterial: (value: string) => void;
  onChangeBrushDurability: (value: number) => void;
  onChangeBrushSize: (value: number) => void;
  registry: RegistrySnapshot | null;
  brushProperties: Record<string, PixelPrimitive>;
  enumOptions: Record<string, string[]>;
  onChangeBrushProperty: (name: string, value: PixelPrimitive) => void;
  registryVersionInput: string;
  newMaterialId: string;
  newMaterialLabel: string;
  newMaterialMaxDurability: number;
  newPropertyName: string;
  newPropertyLabel: string;
  newPropertyType: PropertyType;
  newPropertyDefault: string;
  newPropertyEnumValues: string;
  onSetRegistryVersionInput: (value: string) => void;
  onSetNewMaterialId: (value: string) => void;
  onSetNewMaterialLabel: (value: string) => void;
  onSetNewMaterialMaxDurability: (value: number) => void;
  onAddMaterial: () => void;
  onSetNewPropertyName: (value: string) => void;
  onSetNewPropertyLabel: (value: string) => void;
  onSetNewPropertyType: (value: PropertyType) => void;
  onSetNewPropertyDefault: (value: string) => void;
  onSetNewPropertyEnumValues: (value: string) => void;
  onAddProperty: () => void;
  selectedCoord: { x: number; y: number } | null;
  selectedPixel: PixelCell;
  selectedDynamicProps: Array<[string, unknown]>;
  formatPropertyValue: (value: unknown) => string;
}

export function EditorSidebar(props: EditorSidebarProps) {
  const {
    sidebarCollapsed,
    sectionCollapsed,
    onToggleSidebar,
    onToggleSection,
    metaPath,
    status,
    appVersion,
    updateStatus,
    updateInfo,
    isCheckingUpdate,
    onCheckUpdates,
    onOpenUpdatePage,
    cameraInfo,
    showGrid,
    onToggleGrid,
    brushColor,
    brushMaterial,
    brushDurability,
    brushSize,
    onChangeBrushColor,
    onChangeBrushMaterial,
    onChangeBrushDurability,
    onChangeBrushSize,
    registry,
    brushProperties,
    enumOptions,
    onChangeBrushProperty,
    registryVersionInput,
    newMaterialId,
    newMaterialLabel,
    newMaterialMaxDurability,
    newPropertyName,
    newPropertyLabel,
    newPropertyType,
    newPropertyDefault,
    newPropertyEnumValues,
    onSetRegistryVersionInput,
    onSetNewMaterialId,
    onSetNewMaterialLabel,
    onSetNewMaterialMaxDurability,
    onAddMaterial,
    onSetNewPropertyName,
    onSetNewPropertyLabel,
    onSetNewPropertyType,
    onSetNewPropertyDefault,
    onSetNewPropertyEnumValues,
    onAddProperty,
    selectedCoord,
    selectedPixel,
    selectedDynamicProps,
    formatPropertyValue
  } = props;

  return (
    <aside className="sidebar">
      <SidebarHeader collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />

      {sidebarCollapsed ? (
        <div className="sidebar-collapsed-help">点击右上角按钮展开功能栏</div>
      ) : (
        <>
          <PanelSection title="地图" collapsed={sectionCollapsed.map} onToggle={() => onToggleSection("map")}>
            <MapStatusSection metaPath={metaPath} status={status} />
          </PanelSection>

          <PanelSection title="更新" collapsed={sectionCollapsed.update} onToggle={() => onToggleSection("update")}>
            <UpdateSection
              appVersion={appVersion}
              updateStatus={updateStatus}
              updateInfo={updateInfo}
              isCheckingUpdate={isCheckingUpdate}
              onCheckUpdate={onCheckUpdates}
              onOpenUpdatePage={onOpenUpdatePage}
            />
          </PanelSection>

          <PanelSection title="视角" collapsed={sectionCollapsed.view} onToggle={() => onToggleSection("view")}>
            <ViewSection
              cameraX={cameraInfo.x}
              cameraY={cameraInfo.y}
              zoom={cameraInfo.zoom}
              showGrid={showGrid}
              onToggleGrid={onToggleGrid}
            />
          </PanelSection>

          <PanelSection title="画笔" collapsed={sectionCollapsed.brush} onToggle={() => onToggleSection("brush")}>
            <BrushSection
              brushColor={brushColor}
              brushMaterial={brushMaterial}
              brushDurability={brushDurability}
              brushSize={brushSize}
              materials={registry?.materials ?? []}
              onChangeColor={onChangeBrushColor}
              onChangeMaterial={onChangeBrushMaterial}
              onChangeDurability={onChangeBrushDurability}
              onChangeBrushSize={onChangeBrushSize}
            />
          </PanelSection>

          <PanelSection title="画笔属性" collapsed={sectionCollapsed.brushProps} onToggle={() => onToggleSection("brushProps")}>
            <BrushPropertiesSection
              properties={registry?.properties ?? []}
              brushProperties={brushProperties}
              enumOptions={enumOptions}
              onChangeProperty={onChangeBrushProperty}
            />
          </PanelSection>

          <PanelSection title="索引库编辑" collapsed={sectionCollapsed.registry} onToggle={() => onToggleSection("registry")}>
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
              onSetRegistryVersionInput={onSetRegistryVersionInput}
              onSetNewMaterialId={onSetNewMaterialId}
              onSetNewMaterialLabel={onSetNewMaterialLabel}
              onSetNewMaterialMaxDurability={onSetNewMaterialMaxDurability}
              onAddMaterial={onAddMaterial}
              onSetNewPropertyName={onSetNewPropertyName}
              onSetNewPropertyLabel={onSetNewPropertyLabel}
              onSetNewPropertyType={onSetNewPropertyType}
              onSetNewPropertyDefault={onSetNewPropertyDefault}
              onSetNewPropertyEnumValues={onSetNewPropertyEnumValues}
              onAddProperty={onAddProperty}
            />
          </PanelSection>

          <PanelSection title="检视" collapsed={sectionCollapsed.inspect} onToggle={() => onToggleSection("inspect")}>
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
  );
}
