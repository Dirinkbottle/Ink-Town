import type { GithubReleaseAsset, GithubReleasePayload, GithubUpdateConfig, UpdateCheckResult } from "./types";

const GITHUB_API_BASE = "https://api.github.com";

function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, "");
}

function parseVersion(version: string): number[] {
  const plain = normalizeVersion(version).split("-")[0] ?? "0.0.0";
  return plain.split(".").map((part) => {
    const n = Number(part);
    return Number.isFinite(n) ? n : 0;
  });
}

function compareVersions(a: string, b: string): number {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  const max = Math.max(av.length, bv.length);
  for (let i = 0; i < max; i += 1) {
    const ai = av[i] ?? 0;
    const bi = bv[i] ?? 0;
    if (ai > bi) {
      return 1;
    }
    if (ai < bi) {
      return -1;
    }
  }
  return 0;
}

function scoreAsset(asset: GithubReleaseAsset): number {
  const lower = asset.name.toLowerCase();
  if (lower.endsWith(".exe") && lower.includes("x64")) {
    return 100;
  }
  if (lower.endsWith(".exe")) {
    return 90;
  }
  if (lower.endsWith(".msi")) {
    return 80;
  }
  if (lower.endsWith(".zip")) {
    return 20;
  }
  return 0;
}

function pickDownloadUrl(release: GithubReleasePayload): string {
  if (!Array.isArray(release.assets) || release.assets.length === 0) {
    return release.html_url;
  }
  const sorted = [...release.assets].sort((a, b) => scoreAsset(b) - scoreAsset(a));
  return sorted[0]?.browser_download_url || release.html_url;
}

async function fetchLatestRelease(config: GithubUpdateConfig): Promise<GithubReleasePayload> {
  const url = `${GITHUB_API_BASE}/repos/${config.owner}/${config.repo}/releases/latest`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json"
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`GitHub API 请求失败(${response.status}): ${message}`);
  }

  const payload = (await response.json()) as GithubReleasePayload;
  if (!payload.tag_name || !payload.html_url) {
    throw new Error("GitHub Release 数据不完整");
  }
  return payload;
}

export async function checkGithubReleaseUpdate(
  currentVersion: string,
  config: GithubUpdateConfig
): Promise<UpdateCheckResult> {
  const release = await fetchLatestRelease(config);
  const latestVersion = normalizeVersion(release.tag_name);

  if (!config.includePrerelease && release.prerelease) {
    return {
      currentVersion: normalizeVersion(currentVersion),
      latestVersion,
      hasUpdate: false,
      releaseUrl: release.html_url,
      downloadUrl: release.html_url,
      releaseName: release.name || release.tag_name,
      publishedAt: release.published_at
    };
  }

  return {
    currentVersion: normalizeVersion(currentVersion),
    latestVersion,
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
    releaseUrl: release.html_url,
    downloadUrl: pickDownloadUrl(release),
    releaseName: release.name || release.tag_name,
    publishedAt: release.published_at
  };
}
