interface MapStatusSectionProps {
  metaPath: string;
  status: string;
}

export function MapStatusSection(props: MapStatusSectionProps) {
  const { metaPath, status } = props;
  return (
    <>
      <div className="row">
        <label>Meta Path</label>
        <input value={metaPath} readOnly />
      </div>
      <div className="status">请使用窗口菜单：新建 / 打开 / 保存</div>
      <div className="status">{status}</div>
    </>
  );
}
