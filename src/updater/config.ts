import type { GithubUpdateConfig } from "./types";

const FALLBACK_OWNER = "inkbottle";
const FALLBACK_REPO = "Ink-Town";

export function getGithubUpdateConfig(): GithubUpdateConfig {
  return {
    owner: (import.meta.env.VITE_GITHUB_OWNER as string | undefined)?.trim() || FALLBACK_OWNER,
    repo: (import.meta.env.VITE_GITHUB_REPO as string | undefined)?.trim() || FALLBACK_REPO,
    includePrerelease: (import.meta.env.VITE_GITHUB_INCLUDE_PRERELEASE as string | undefined) === "true"
  };
}
