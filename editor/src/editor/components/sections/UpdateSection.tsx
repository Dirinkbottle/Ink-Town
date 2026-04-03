import type { UpdateCheckResult } from "../../../updater/types";

interface UpdateSectionProps {
  appVersion: string;
  updateStatus: string;
  updateInfo: UpdateCheckResult | null;
  isCheckingUpdate: boolean;
  onCheckUpdate: () => void;
  onOpenUpdatePage: () => void;
}

export function UpdateSection(props: UpdateSectionProps) {
  const { appVersion, updateStatus, updateInfo, isCheckingUpdate, onCheckUpdate, onOpenUpdatePage } = props;
  return (
    <>
      <div className="status">当前版本：{appVersion}</div>
      <div className="status">{updateStatus}</div>
      {updateInfo ? (
        <div className="status">
          最新发布：{updateInfo.releaseName} ({updateInfo.latestVersion})
        </div>
      ) : null}
      <div className="row row-buttons">
        <button onClick={onCheckUpdate} disabled={isCheckingUpdate}>
          {isCheckingUpdate ? "检查中..." : "检查更新"}
        </button>
        <button onClick={onOpenUpdatePage} disabled={!updateInfo}>
          打开下载页
        </button>
      </div>
    </>
  );
}
