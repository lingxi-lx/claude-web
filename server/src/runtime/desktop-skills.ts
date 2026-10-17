import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataDir } from '../files/service.js';

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

/**
 * Skills written for the official app's own tools or account (its built-in browser, Claude in Chrome, computer use,
 * its memory, docs, scheduled tasks, setup…): listed here they would send the model to tools this app does not have.
 */
export const APP_ONLY = new Set(['built-in-browser', 'chrome-browser', 'computer-use', 'consolidate-memory', 'docs', 'explain-usage', 'google-workspace', 'import-memory', 'learn', 'morning', 'schedule', 'setup-claude', 'setup-cowork']);

const unprefix = (p: string) => path.resolve(p.replace(/^\\\\\?\\/, ''));

/**
 * The plugin as loaded here: the same name (so `anthropic-skills:xlsx` keeps its name) with every skill but APP_ONLY,
 * each a link to the official app's folder (a junction on Windows — no admin rights, nothing copied). Kept in step with
 * the source on every look; null when it can't be made (the caller falls back to the source itself).
 */
export function mirrorSkills(src: string, dest: string): string | null {
  try {
    const skills = path.join(dest, 'skills');
    fs.mkdirSync(skills, { recursive: true });
    // the mirror (or a folder above it) turned into a link into the source: every "stray" entry would be the source's own
    const srcReal = fs.realpathSync.native(src);
    const inSrc = (p: string) => { const r = fs.realpathSync.native(p); return r === srcReal || r.startsWith(srcReal + path.sep); };
    if (inSrc(dest) || inSrc(skills) || fs.lstatSync(dest).isSymbolicLink() || fs.lstatSync(skills).isSymbolicLink()) return null;
    fs.mkdirSync(path.join(dest, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(src, '.claude-plugin', 'plugin.json'), path.join(dest, '.claude-plugin', 'plugin.json'));
    const want = new Map(fs.readdirSync(path.join(src, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory() && !APP_ONLY.has(e.name)).map((e) => [e.name, path.join(src, 'skills', e.name)] as const));
    for (const name of fs.readdirSync(skills)) {
      const p = path.join(skills, name);
      // lstat, not readlink, decides what this is: nothing recursive may ever run on a link (it would reach the source)
      const link = fs.lstatSync(p).isSymbolicLink();
      const to = link ? fs.readlinkSync(p) : null;
      if (to !== null && want.has(name) && unprefix(to) === path.resolve(want.get(name)!)) { want.delete(name); continue; }
      // a link (or a stray entry of our own) that is no longer wanted: the link goes, never what it points at
      if (link) { try { fs.unlinkSync(p); } catch { fs.rmdirSync(p); } } else fs.rmSync(p, { recursive: true, force: true });
    }
    for (const [name, target] of want) fs.symlinkSync(target, path.join(skills, name), process.platform === 'win32' ? 'junction' : 'dir');
    return dest;
  } catch { return null; }
}

let cache: { at: number; dir: string | null } | null = null;

/** The folder to load, re-read at most once a minute (the official app updates it in the background); off → null. */
export function desktopSkillsPlugin(now = Date.now()): string | null {
  if (!enabled || process.env.CLAUDE_WEB_NO_DESKTOP_SKILLS) return null;
  if (!cache || now - cache.at > 60_000) {
    const src = findSkillsPlugin(officialAppDir());
    cache = { at: now, dir: src ? mirrorSkills(src, path.join(dataDir(), 'runtime', 'plugins', 'anthropic-skills')) ?? src : null };
  }
  return cache.dir;
}
