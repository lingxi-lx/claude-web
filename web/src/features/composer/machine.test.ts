// machine.test.ts
import { describe, expect, it } from 'vitest';
import { machineOf, machineValue, wslCliCommand } from './machine';

describe('machineOf / machineValue', () => {
  it('this computer, a WSL distro, a peer', () => {
    expect(machineOf('')).toEqual({ kind: 'local' });
    expect(machineOf('wsl:Ubuntu-22.04')).toEqual({ kind: 'wsl', distro: 'Ubuntu-22.04' });
    expect(machineOf('p1a2')).toEqual({ kind: 'peer', id: 'p1a2' });
    expect(machineValue({ kind: 'wsl', distro: 'Debian' })).toBe('wsl:Debian');
    expect(machineValue({ kind: 'peer', id: 'p1' })).toBe('p1');
    expect(machineValue({ kind: 'local' })).toBe('');
  });
});

describe('wslCliCommand', () => {
  it('resumes the conversation in the distro, quoting a folder with spaces', () => {
    expect(wslCliCommand('Ubuntu', '/home/me/p', 'abc')).toBe('wsl.exe -d Ubuntu --cd /home/me/p -- claude --resume abc');
    expect(wslCliCommand('Ubuntu', '/home/me/a b', 'abc')).toBe('wsl.exe -d Ubuntu --cd "/home/me/a b" -- claude --resume abc');
  });
});
