interface CanvasHudProps {
  interactionMode: "idle" | "painting" | "panning";
  brushSize: number;
  showGrid: boolean;
  worldLoaded: boolean;
}

function modeLabel(mode: "idle" | "painting" | "panning"): string {
  if (mode === "painting") {
    return "绘制中";
  }
  if (mode === "panning") {
    return "平移中";
  }
  return "待机";
}

export function CanvasHud(props: CanvasHudProps) {
  const { interactionMode, brushSize, showGrid, worldLoaded } = props;
  return (
    <div className="canvas-hud">
      <span className="hud-pill">{worldLoaded ? "地图已加载" : "未加载地图"}</span>
      <span className="hud-pill">模式: {modeLabel(interactionMode)}</span>
      <span className="hud-pill">画笔: {brushSize}</span>
      <span className="hud-pill">{showGrid ? "网格开启" : "网格关闭"}</span>
    </div>
  );
}
