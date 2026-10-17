import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The official Claude desktop app downloads Anthropic's managed skills (xlsx, pdf, docx, pptx…) for the signed-in
 * account into its own data folder, as a Claude Code plugin named `anthropic-skills`, and hands it to its Claude Code.
 * A conversation started there and continued here lists `anthropic-skills:xlsx` & co., and our engine answered
 * 「Unknown skill」. Load that same folder as a local plugin, so the names work here too. Nothing is copied: it is the
 * user's own download, read where the official app keeps it; no official app on this computer → nothing changes.
 */

let enabled = true;
export function setDesktopSkillsEnabled(on: boolean) { enabled = on; }

/** Where the official app keeps its data, per OS (`%APPDATA%\Claude`, `~/Library/Application Support/Claude`…). */
export function officialAppDir(env: NodeJS.ProcessEnv = process.env, platform = process.platform, home = os.homedir()): string {
  if (platform === 'win32') return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Claude');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude');
  return path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'Claude');
}

/** The newest `skills-plugin/<account>/<id>` folder whose plugin is `anthropic-skills` (there is one per account). */
export function findSkillsPlugin(appDir: string): string | null {
  const root = path.join(appDir, 'local-agent-mode-sessions', 'skills-plugin');
  let best: { dir: string; at: number } | null = null;
  const list = (d: string) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name)); } catch { return []; } };
  for (const acct of list(root)) {
    for (const dir of list(acct)) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8'));
        if (meta?.name !== 'anthropic-skills' || !fs.statSync(path.join(dir, 'skills')).isDirectory()) continue;
        let at = fs.statSync(dir).mtimeMs;
        try { at = Math.max(at, fs.statSync(path.join(dir, 'manifest.json')).mtimeMs); } catch { /* no manifest */ }
        if (!best || at > best.at) best = { dir, at };
      } catch { /* not a plugin folder */ }
    }
  }
  return best?.dir ?? null;
}

let cache: { at: number; dir: string | null } | null = null;

/** The folder to load, re-read at most once a minute (the official app updates it in the background); off → null. */
export function desktopSkillsPlugin(now = Date.now()): string | null {
  if (!enabled || process.env.CLAUDE_WEB_NO_DESKTOP_SKILLS) return null;
  if (!cache || now - cache.at > 60_000) cache = { at: now, dir: findSkillsPlugin(officialAppDir()) };
  return cache.dir;
}
