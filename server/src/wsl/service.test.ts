import { describe, expect, it } from 'vitest';
import { WslService } from './service';

const out = (s: string, enc: BufferEncoding = 'utf8') => ({ code: 0, stdout: Buffer.from(s, enc), stderr: '' });

describe('WslService', () => {
  it('not Windows: unavailable, lists nothing, runs nothing', async () => {
    let ran = 0;
    const w = new WslService({ platform: 'linux', run: async () => { ran++; return out(''); } });
    expect(w.available()).toBe(false);
    expect(await w.list()).toEqual([]);
    expect(ran).toBe(0);
  });
  it('lists distros, checks one, knows its UNC roots and transcript folder', async () => {
    const calls: string[][] = [];
    const w = new WslService({ platform: 'win32', run: async (args) => {
      calls.push(args);
      if (args[0] === '-l') return out('\ufeffUbuntu\r\n', 'utf16le');
      return out('/home/me\nCW_NO_CLAUDE\nenabled\n');
    } });
    expect((await w.list()).map((d) => d.name)).toEqual(['Ubuntu']);
    expect(await w.check('Ubuntu')).toEqual({ name: 'Ubuntu', home: '/home/me', claude: false, interop: true });
    expect(calls[1].slice(0, 4)).toEqual(['-d', 'Ubuntu', '--', 'sh']);
    expect(w.roots()).toEqual(['\\\\wsl.localhost\\Ubuntu', '\\\\wsl$\\Ubuntu']);
    expect(w.projectsRoot('Ubuntu')).toBe('\\\\wsl.localhost\\Ubuntu\\home\\me\\.claude\\projects');
    await expect(w.check('Nope')).rejects.toThrow();
  });
  it('install runs only the shown command, in a login shell of that distro', async () => {
    const calls: string[][] = [];
    const w = new WslService({ platform: 'win32', run: async (args) => { calls.push(args); return args[0] === '-l' ? out('Ubuntu\n') : out('done'); } });
    await w.list();
    await w.install('Ubuntu');
    expect(calls.at(-1)).toEqual(['-d', 'Ubuntu', '--', 'bash', '-lc', 'curl -fsSL https://claude.ai/install.sh | bash']);
  });
});
