export interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
  content_type?: string;
  size?: number;
}

export interface GithubReleasePayload {
  tag_name: string;
  name?: string;
  html_url: string;
  body?: string;
  draft: boolean;
  prerelease: boolean;
  published_at?: string;
  assets: GithubReleaseAsset[];
}

export interface GithubUpdateConfig {
  owner: string;
  repo: string;
  includePrerelease: boolean;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string;
  downloadUrl: string;
  releaseName: string;
  publishedAt?: string;
}
