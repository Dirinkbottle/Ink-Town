import type { MaterialDefinition } from "../../../renderer/types";

interface BrushSectionProps {
  brushColor: string;
  brushMaterial: string;
  brushDurability: number;
  brushSize: number;
  materials: MaterialDefinition[];
  onChangeColor: (value: string) => void;
  onChangeMaterial: (value: string) => void;
  onChangeDurability: (value: number) => void;
  onChangeBrushSize: (value: number) => void;
}

export function BrushSection(props: BrushSectionProps) {
  const {
    brushColor,
    brushMaterial,
    brushDurability,
    brushSize,
    materials,
    onChangeColor,
    onChangeMaterial,
    onChangeDurability,
    onChangeBrushSize
  } = props;
  return (
    <>
      <div className="row">
        <label>颜色</label>
        <input type="color" value={brushColor} onChange={(e) => onChangeColor(e.target.value)} />
      </div>
      <div className="row">
        <label>材质</label>
        <select value={brushMaterial} onChange={(e) => onChangeMaterial(e.target.value)}>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} ({m.id})
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <label>耐久</label>
        <input type="number" min={0} value={brushDurability} onChange={(e) => onChangeDurability(Number(e.target.value) || 0)} />
      </div>
      <div className="row">
        <label>画笔大小</label>
        <input type="range" min={1} max={15} step={1} value={brushSize} onChange={(e) => onChangeBrushSize(Number(e.target.value) || 1)} />
        <span className="value-badge">{brushSize}</span>
      </div>
    </>
  );
}
