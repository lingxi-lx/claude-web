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
