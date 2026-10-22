// The latest release and its installers, from the GitHub API (site/scripts/releases.ts writes ./site-data.json at
// build time; the pages read that file, so a visitor's browser never calls the API).
export interface GhAsset { name: string; browser_download_url: string; size: number }
export interface GhRelease { tag_name: string; draft: boolean; prerelease: boolean; published_at: string | null; html_url: string; assets: GhAsset[] }

export interface Asset { name: string; url: string; size: number }
export interface ReleaseInfo {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  url: string;
  win: { installer: Asset | null; portable: Asset | null };
  mac: { arm64: Asset | null; x64: Asset | null };
}
export interface SiteData { release: ReleaseInfo | null; stars: number | null; releases: number | null; fetchedAt: string }

/** The app's own releases: v1.2.3 tags, published (engine-v… and site-media are other things in the same repo). */
export function isAppRelease(r: GhRelease): boolean {
  return !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+$/.test(r.tag_name);
}

function pick(r: GhRelease, re: RegExp): Asset | null {
  const a = r.assets.find((x) => re.test(x.name));
  return a ? { name: a.name, url: a.browser_download_url, size: a.size } : null;
}

/** electron-builder.yml's artifact names: ClaudeWeb-<v>-win-x64.exe, -portable.exe, -mac-<arch>.dmg. */
export function releaseInfo(r: GhRelease): ReleaseInfo {
  return {
    version: r.tag_name.slice(1),
    date: (r.published_at ?? '').slice(0, 10),
    url: r.html_url,
    win: { installer: pick(r, /-win-x64\.exe$/), portable: pick(r, /-portable\.exe$/) },
    mac: { arm64: pick(r, /-mac-arm64\.dmg$/), x64: pick(r, /-mac-x64\.dmg$/) },
  };
}

export function siteData(list: GhRelease[], stars: number | null, fetchedAt: string): SiteData {
  const apps = list.filter(isAppRelease).sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
  return { release: apps[0] ? releaseInfo(apps[0]) : null, stars, releases: apps.length, fetchedAt };
}

export const mb = (bytes: number): string => `${Math.round(bytes / 1048576)} MB`;
