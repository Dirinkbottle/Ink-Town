interface EditorStatusBarProps {
  status: string;
  selectedCoord: { x: number; y: number } | null;
  cameraInfo: { x: number; y: number; zoom: number };
  sidebarCollapsed: boolean;
}

export function EditorStatusBar(props: EditorStatusBarProps) {
  const { status, selectedCoord, cameraInfo, sidebarCollapsed } = props;
  return (
    <footer className="status-bar">
      <div className="status-main">{status}</div>
      <div className="status-meta">
        <span>Cursor: {selectedCoord ? `${selectedCoord.x}, ${selectedCoord.y}` : "--"}</span>
        <span>
          Camera: {cameraInfo.x}, {cameraInfo.y} @ {cameraInfo.zoom.toFixed(2)}x
        </span>
        <span>Sidebar: {sidebarCollapsed ? "collapsed" : "expanded"}</span>
        <span>快捷键: Ctrl+S / Ctrl+O / Ctrl+N / G / [ ]</span>
      </div>
    </footer>
  );
}
