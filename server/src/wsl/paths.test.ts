import { describe, expect, it } from 'vitest';
import { isWslUnc, parseWslUnc, toWslPath, wslSafeDirArgs, wslToWin } from './paths';

describe('parseWslUnc', () => {
  it('both host names, either slash, any case', () => {
    expect(parseWslUnc('\\\\wsl.localhost\\Ubuntu-22.04\\home\\me\\proj')).toEqual({ distro: 'Ubuntu-22.04', path: '/home/me/proj' });
    expect(parseWslUnc('\\\\wsl$\\Debian\\')).toEqual({ distro: 'Debian', path: '/' });
    expect(parseWslUnc('\\\\wsl$\\Debian')).toEqual({ distro: 'Debian', path: '/' });
    expect(parseWslUnc('//WSL.LOCALHOST/Ubuntu/etc/hosts')).toEqual({ distro: 'Ubuntu', path: '/etc/hosts' });
    expect(parseWslUnc('\\\\nas\\share\\x')).toBeNull();
    expect(parseWslUnc('C:\\x')).toBeNull();
    expect(isWslUnc('\\\\wsl.localhost\\Ubuntu\\x')).toBe(true);
    expect(isWslUnc('\\\\nas\\s')).toBe(false);
  });
  it('a .. that climbs out of the distro is refused', () => {
    expect(parseWslUnc('\\\\wsl.localhost\\Ubuntu\\home\\..\\..\\Other\\x')).toBeNull();
    expect(parseWslUnc('\\\\wsl.localhost\\Ubuntu\\home\\me\\..\\you')).toEqual({ distro: 'Ubuntu', path: '/home/you' });
  });
});

describe('toWslPath', () => {
  it('drive paths under /mnt, the distro UNC to its own path, another distro / a network share → null', () => {
    expect(toWslPath('C:\\Users\\Me\\proj', 'Ubuntu')).toBe('/mnt/c/Users/Me/proj');
    expect(toWslPath('d:/work', 'Ubuntu')).toBe('/mnt/d/work');
    expect(toWslPath('E:\\', 'Ubuntu')).toBe('/mnt/e');
    expect(toWslPath('\\\\wsl.localhost\\Ubuntu\\home\\me', 'Ubuntu')).toBe('/home/me');
    expect(toWslPath('\\\\wsl.localhost\\ubuntu\\home\\me', 'Ubuntu')).toBe('/home/me');
    expect(toWslPath('\\\\wsl.localhost\\Debian\\home\\me', 'Ubuntu')).toBeNull();
    expect(toWslPath('/home/me', 'Ubuntu')).toBe('/home/me');
    expect(toWslPath('\\\\nas\\share', 'Ubuntu')).toBeNull();
    expect(toWslPath('relative\\x', 'Ubuntu')).toBeNull();
  });
});

describe('wslToWin', () => {
  it('/mnt/<drive> back to the drive, the rest under \\\\wsl.localhost', () => {
    expect(wslToWin('/mnt/c/Users/Me', 'Ubuntu')).toBe('C:\\Users\\Me');
    expect(wslToWin('/mnt/d', 'Ubuntu')).toBe('D:\\');
    expect(wslToWin('/home/me/proj', 'Ubuntu')).toBe('\\\\wsl.localhost\\Ubuntu\\home\\me\\proj');
    expect(wslToWin('/', 'Ubuntu')).toBe('\\\\wsl.localhost\\Ubuntu\\');
    expect(wslToWin('/mnt/wsl/x', 'Ubuntu')).toBe('\\\\wsl.localhost\\Ubuntu\\mnt\\wsl\\x');
  });
  it('round-trips', () => {
    for (const p of ['/home/me/a b/c', '/mnt/c/x/y', '/opt']) expect(toWslPath(wslToWin(p, 'Ubuntu'), 'Ubuntu')).toBe(p);
  });
});

describe('wslSafeDirArgs (E-minor)', () => {
  it('the folder and the ones above it inside the distro, never *', () => {
    const a = wslSafeDirArgs(String.raw`\\wsl.localhost\Ubuntu\home\me\p`);
    expect(wslSafeDirArgs('//wsl.localhost/Ubuntu/home/me/p')).toEqual(a);
    expect(a).not.toContain('safe.directory=*');
    expect(a).toEqual([
      '-c', 'safe.directory=%(prefix)///wsl.localhost/Ubuntu/home/me/p', '-c', 'safe.directory=//wsl.localhost/Ubuntu/home/me/p',
      '-c', 'safe.directory=%(prefix)///wsl.localhost/Ubuntu/home/me', '-c', 'safe.directory=//wsl.localhost/Ubuntu/home/me',
      '-c', 'safe.directory=%(prefix)///wsl.localhost/Ubuntu/home', '-c', 'safe.directory=//wsl.localhost/Ubuntu/home',
    ]);
  });
  it('not a WSL path: nothing', () => {
    expect(wslSafeDirArgs(String.raw`C:\repo`)).toEqual([]);
    expect(wslSafeDirArgs(String.raw`\\nas\share\x`)).toEqual([]);
  });
});
