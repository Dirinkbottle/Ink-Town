import type { ReactNode } from "react";

interface PanelSectionProps {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function PanelSection(props: PanelSectionProps) {
  const { title, collapsed, onToggle, children } = props;
  return (
    <section className={`section ${collapsed ? "is-collapsed" : ""}`}>
      <button type="button" className="section-header" onClick={onToggle}>
        <strong>{title}</strong>
        <span className="section-arrow">{collapsed ? ">" : "v"}</span>
      </button>
      {!collapsed ? <div className="section-body">{children}</div> : null}
    </section>
  );
}
