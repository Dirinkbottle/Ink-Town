import type { PropertyType } from "../../../renderer/types";

interface RegistryEditorSectionProps {
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
}

export function RegistryEditorSection(props: RegistryEditorSectionProps) {
  const {
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
    onAddProperty
  } = props;
  return (
    <>
      <div className="row">
        <label>版本号</label>
        <input value={registryVersionInput} onChange={(e) => onSetRegistryVersionInput(e.target.value)} />
      </div>

      <div className="sub-title">新增材质</div>
      <div className="row">
        <label>标识</label>
        <input value={newMaterialId} onChange={(e) => onSetNewMaterialId(e.target.value)} placeholder="例如 metal" />
      </div>
      <div className="row">
        <label>名称</label>
        <input value={newMaterialLabel} onChange={(e) => onSetNewMaterialLabel(e.target.value)} placeholder="例如 Metal" />
      </div>
      <div className="row">
        <label>最大耐久</label>
        <input
          type="number"
          min={0}
          value={newMaterialMaxDurability}
          onChange={(e) => onSetNewMaterialMaxDurability(Math.max(0, Number(e.target.value) || 0))}
        />
      </div>
      <div className="row row-buttons">
        <button onClick={onAddMaterial}>添加材质</button>
      </div>

      <div className="sub-title">新增属性</div>
      <div className="row">
        <label>属性名</label>
        <input value={newPropertyName} onChange={(e) => onSetNewPropertyName(e.target.value)} placeholder="例如 biome" />
      </div>
      <div className="row">
        <label>属性标签</label>
        <input value={newPropertyLabel} onChange={(e) => onSetNewPropertyLabel(e.target.value)} placeholder="例如 Biome" />
      </div>
      <div className="row">
        <label>类型</label>
        <select value={newPropertyType} onChange={(e) => onSetNewPropertyType(e.target.value as PropertyType)}>
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
          <select value={newPropertyDefault || "false"} onChange={(e) => onSetNewPropertyDefault(e.target.value)}>
            <option value="false">false</option>
            <option value="true">true</option>
          </select>
        ) : (
          <input
            value={newPropertyDefault}
            onChange={(e) => onSetNewPropertyDefault(e.target.value)}
            placeholder={newPropertyType === "enum" ? "必须在枚举可选值中" : "输入默认值"}
          />
        )}
      </div>
      {newPropertyType === "enum" ? (
        <div className="row">
          <label>枚举值</label>
          <input value={newPropertyEnumValues} onChange={(e) => onSetNewPropertyEnumValues(e.target.value)} placeholder="a,b,c" />
        </div>
      ) : null}
      <div className="row row-buttons">
        <button onClick={onAddProperty}>添加属性</button>
      </div>
    </>
  );
}
