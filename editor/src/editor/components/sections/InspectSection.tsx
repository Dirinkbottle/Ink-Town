import { rgbToHex } from "../../../lib/color";
import type { PixelCell } from "../../../renderer/types";

interface InspectSectionProps {
  selectedCoord: { x: number; y: number } | null;
  selectedPixel: PixelCell;
  selectedDynamicProps: Array<[string, unknown]>;
  formatPropertyValue: (value: unknown) => string;
}

export function InspectSection(props: InspectSectionProps) {
  const { selectedCoord, selectedPixel, selectedDynamicProps, formatPropertyValue } = props;
  return (
    <>
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
    </>
  );
}
