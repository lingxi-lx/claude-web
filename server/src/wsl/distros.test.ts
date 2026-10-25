// distros.test.ts
import { describe, expect, it } from 'vitest';
import { parseDistroList, parseWslCheck } from './distros';

describe('parseDistroList', () => {
  it('reads wsl -l -q (UTF-16LE with a BOM), drops blanks and docker-desktop', () => {
    const buf = Buffer.from('\ufeffUbuntu\r\nDebian\r\n\r\ndocker-desktop\r\ndocker-desktop-data\r\n', 'utf16le');
    expect(parseDistroList(buf)).toEqual(['Ubuntu', 'Debian']);
    expect(parseDistroList(Buffer.from('Ubuntu\n', 'utf8'))).toEqual(['Ubuntu']); // WSL_UTF8=1
    expect(parseDistroList(Buffer.alloc(0))).toEqual([]);
  });
});

describe('parseWslCheck', () => {
  it('home, whether claude is on PATH, whether Windows interop is on', () => {
    expect(parseWslCheck('/home/me\n/home/me/.local/bin/claude\nenabled\n')).toEqual({ home: '/home/me', claude: true, interop: true });
    expect(parseWslCheck('/root\nCW_NO_CLAUDE\ndisabled\n')).toEqual({ home: '/root', claude: false, interop: false });
    expect(parseWslCheck('/root\nCW_NO_CLAUDE\n')).toEqual({ home: '/root', claude: false, interop: null });
    expect(parseWslCheck('')).toEqual({ home: null, claude: null, interop: null });
  });
});
