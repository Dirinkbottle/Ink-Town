interface SidebarHeaderProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function SidebarHeader(props: SidebarHeaderProps) {
  const { collapsed, onToggle } = props;
  return (
    <div className="sidebar-header">
      {!collapsed ? <h1 className="title">Ink Town Editor</h1> : <span className="sidebar-collapsed-title">工具</span>}
      <button
        type="button"
        className="sidebar-toggle"
        onClick={onToggle}
        aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
        title={collapsed ? "展开侧边栏" : "收起侧边栏"}
      >
        {collapsed ? ">>" : "<<"}
      </button>
    </div>
  );
}
