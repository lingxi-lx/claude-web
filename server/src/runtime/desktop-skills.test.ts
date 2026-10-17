import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findSkillsPlugin, officialAppDir } from './desktop-skills.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function plugin(app: string, acct: string, id: string, name: string, mtime: number) {
  const dir = path.join(app, 'local-agent-mode-sessions', 'skills-plugin', acct, id);
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'skills', 'xlsx'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }));
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
  const t = new Date(mtime);
  fs.utimesSync(path.join(dir, 'manifest.json'), t, t);
  fs.utimesSync(dir, t, t);
  return dir;
}

describe('the official app’s anthropic-skills plugin', () => {
  it('the newest anthropic-skills folder of any account; other plugins and no folder at all → none', () => {
    const app = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-dskills-'));
    tmp.push(app);
    expect(findSkillsPlugin(app)).toBeNull();
    plugin(app, 'a', '1', 'anthropic-skills', 1_700_000_000_000);
    const newer = plugin(app, 'b', '2', 'anthropic-skills', 1_800_000_000_000);
    plugin(app, 'c', '3', 'something-else', 1_900_000_000_000);
    expect(findSkillsPlugin(app)).toBe(newer);
  });
  it('the official app’s data folder per OS', () => {
    expect(officialAppDir({ APPDATA: 'C:\\U\\AppData\\Roaming' }, 'win32', 'C:\\U')).toBe(path.join('C:\\U\\AppData\\Roaming', 'Claude'));
    expect(officialAppDir({}, 'darwin', '/Users/u')).toBe(path.join('/Users/u', 'Library', 'Application Support', 'Claude'));
    expect(officialAppDir({}, 'linux', '/home/u')).toBe(path.join('/home/u', '.config', 'Claude'));
  });
});

describe('the mirror loaded here: the official plugin without the app-only skills', () => {
  it('links every other skill, drops the app-only ones, follows the source, and never touches it', async () => {
    const { mirrorSkills } = await import('./desktop-skills.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-dmirror-'));
    tmp.push(root);
    const src = path.join(root, 'src');
    for (const s of ['xlsx', 'pdf', 'computer-use', 'chrome-browser']) {
      fs.mkdirSync(path.join(src, 'skills', s), { recursive: true });
      fs.writeFileSync(path.join(src, 'skills', s, 'SKILL.md'), `---\nname: ${s}\n---\n`);
    }
    fs.mkdirSync(path.join(src, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(src, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'anthropic-skills' }));
    const dest = path.join(root, 'dest');
    expect(mirrorSkills(src, dest)).toBe(dest);
    expect(fs.readdirSync(path.join(dest, 'skills')).sort()).toEqual(['pdf', 'xlsx']);
    expect(fs.readFileSync(path.join(dest, 'skills', 'xlsx', 'SKILL.md'), 'utf8')).toContain('name: xlsx');
    expect(JSON.parse(fs.readFileSync(path.join(dest, '.claude-plugin', 'plugin.json'), 'utf8')).name).toBe('anthropic-skills');
    // again: nothing changes; a skill gone from the source goes here as a link only
    expect(mirrorSkills(src, dest)).toBe(dest);
    fs.rmSync(path.join(src, 'skills', 'pdf'), { recursive: true });
    fs.mkdirSync(path.join(dest, 'skills', 'stray'));
    mirrorSkills(src, dest);
    expect(fs.readdirSync(path.join(dest, 'skills')).sort()).toEqual(['xlsx']);
    expect(fs.readdirSync(path.join(src, 'skills')).sort()).toEqual(['chrome-browser', 'computer-use', 'xlsx']);
    expect(fs.existsSync(path.join(src, 'skills', 'xlsx', 'SKILL.md'))).toBe(true);
    // the mirror's own folders replaced by links into the source: refused, the source keeps its app-only skills
    const kind = process.platform === 'win32' ? 'junction' : 'dir';
    const viaSkills = path.join(root, 'd2');
    fs.mkdirSync(viaSkills);
    fs.symlinkSync(path.join(src, 'skills'), path.join(viaSkills, 'skills'), kind);
    expect(mirrorSkills(src, viaSkills)).toBeNull();
    const viaDest = path.join(root, 'd3');
    fs.symlinkSync(src, viaDest, kind);
    expect(mirrorSkills(src, viaDest)).toBeNull();
    expect(fs.readdirSync(path.join(src, 'skills')).sort()).toEqual(['chrome-browser', 'computer-use', 'xlsx']);
  });
});
