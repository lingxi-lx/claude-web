import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { linuxPickDir, terminalShell } from './service.js';

describe('terminalShell: the terminal panel is a real shell, not the claude TUI', () => {
  const claudeExe = path.join('C:', 'app', 'sdk-win32-x64', 'claude.exe');

  it('Windows: cmd.exe (no PowerShell execution policy between the user and npm), bundled claude reachable on PATH', () => {
    const s = terminalShell('win32', { ComSpec: 'C:\\Windows\\system32\\cmd.exe', Path: 'C:\\Windows;C:\\nodejs' }, claudeExe);
    expect(s.file).toBe('C:\\Windows\\system32\\cmd.exe');
    // Windows spells it `Path`: the same key is extended, not a second PATH beside it
    expect(s.env.Path.split(';')).toEqual(['C:\\Windows', 'C:\\nodejs', path.dirname(claudeExe)]);
    expect(s.env.PATH).toBeUndefined();
  });

  it('macOS / Linux: the user login shell, falling back to zsh / bash', () => {
    expect(terminalShell('darwin', { SHELL: '/opt/homebrew/bin/fish', PATH: '/usr/bin' }, '/app/claude')).toMatchObject({ file: '/opt/homebrew/bin/fish', args: ['-l'] });
    expect(terminalShell('darwin', { PATH: '/usr/bin' }, '/app/claude').file).toBe('/bin/zsh');
    expect(terminalShell('linux', { PATH: '/usr/bin' }, '/app/claude').file).toBe('/bin/bash');
    expect(terminalShell('linux', { PATH: '/usr/bin' }, '/app/claude').env.PATH).toBe('/usr/bin:/app');
  });

  it("the user's own claude on PATH wins over the bundled one; an already-listed dir is not added twice", () => {
    expect(terminalShell('linux', { PATH: '/app:/usr/bin' }, '/app/claude').env.PATH).toBe('/app:/usr/bin');
    expect(terminalShell('linux', { PATH: '/usr/local/bin' }, '/app/claude').env.PATH!.split(':')[0]).toBe('/usr/local/bin');
  });

  it('no bundled claude: PATH untouched', () => {
    expect(terminalShell('linux', { PATH: '/usr/bin' }, null).env.PATH).toBe('/usr/bin');
  });
});

// issue #12: on Linux a missing zenity or display used to answer null — the same as "cancelled" — and the button did nothing
describe('linuxPickDir: the native folder dialog on Linux, or why there is none', () => {
  type R = { code: number | string | null; out: string; err: string };
  const runner = (answers: Record<string, R>) => {
    const calls: string[] = [];
    const run = async (file: string) => { calls.push(file); return answers[file] ?? { code: 'ENOENT', out: '', err: '' }; };
    return { run, calls };
  };

  it('no DISPLAY / WAYLAND_DISPLAY: unavailable without trying a program', async () => {
    const r = runner({ zenity: { code: 0, out: '/home/u/p\n', err: '' } });
    expect(await linuxPickDir({ HOME: '/home/u' }, r.run)).toEqual({ unavailable: 'no-display' });
    expect(r.calls).toEqual([]);
  });

  it('zenity picks a folder (trailing slash dropped); Wayland counts as a display', async () => {
    expect(await linuxPickDir({ DISPLAY: ':0' }, runner({ zenity: { code: 0, out: '/home/u/p/\n', err: '' } }).run)).toBe('/home/u/p');
    expect(await linuxPickDir({ WAYLAND_DISPLAY: 'wayland-0' }, runner({ zenity: { code: 0, out: '/srv\n', err: '' } }).run)).toBe('/srv');
  });

  it('cancelled: null (zenity exits 1 with nothing printed, Gtk warnings on stderr do not matter)', async () => {
    expect(await linuxPickDir({ DISPLAY: ':0' }, runner({ zenity: { code: 1, out: '', err: 'Gtk-Message: GtkDialog mapped without a transient parent' } }).run)).toBeNull();
  });

  it('no zenity: kdialog; neither installed: unavailable (no-dialog)', async () => {
    const k = runner({ kdialog: { code: 0, out: '/home/u/k\n', err: '' } });
    expect(await linuxPickDir({ DISPLAY: ':0' }, k.run)).toBe('/home/u/k');
    expect(k.calls).toEqual(['zenity', 'kdialog']);
    expect(await linuxPickDir({ DISPLAY: ':0' }, runner({}).run)).toEqual({ unavailable: 'no-dialog' });
    // something named zenity on PATH that cannot be run (WSL: the Windows folders are on PATH) is not "cancelled"
    expect(await linuxPickDir({ DISPLAY: ':0' }, runner({ zenity: { code: 'EACCES', out: '', err: '' }, kdialog: { code: 'EACCES', out: '', err: '' } }).run)).toEqual({ unavailable: 'no-dialog' });
  });

  it('a DISPLAY nobody can open (ssh without forwarding, a service): unavailable (no-display)', async () => {
    expect(await linuxPickDir({ DISPLAY: ':9' }, runner({ zenity: { code: 1, out: '', err: '(zenity:42): Gtk-WARNING **: cannot open display: :9' } }).run)).toEqual({ unavailable: 'no-display' });
  });
});
