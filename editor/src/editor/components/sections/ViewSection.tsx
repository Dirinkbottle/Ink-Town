interface ViewSectionProps {
  cameraX: number;
  cameraY: number;
  zoom: number;
  showGrid: boolean;
  onToggleGrid: (next: boolean) => void;
}

export function ViewSection(props: ViewSectionProps) {
  const { cameraX, cameraY, zoom, showGrid, onToggleGrid } = props;
  return (
    <>
      <div className="status">
        坐标=({cameraX}, {cameraY}) 缩放={zoom.toFixed(2)}x
      </div>
      <div className="status">中键拖拽平移 | 滚轮缩放 | 左键绘制</div>
      <div className="row">
        <label>网格</label>
        <input type="checkbox" checked={showGrid} onChange={(e) => onToggleGrid(e.target.checked)} />
      </div>
    </>
  );
}
