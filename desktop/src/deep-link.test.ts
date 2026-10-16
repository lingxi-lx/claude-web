import { describe, expect, it } from 'vitest';
import { linkFromArgv, parseDeepLink } from './deep-link';

const dirs = new Set(['C:\\proj', '/home/me/proj']);
const isDir = (p: string) => dirs.has(p);

describe('deep links', () => {
  it('new: a folder that exists, the text (never sent — the page only fills it), a machine', () => {
    expect(parseDeepLink('claude-web://new?folder=C%3A%5Cproj&q=fix%20the%20tests&peer=desk-2', isDir)).toEqual({ kind: 'new', folder: 'C:\\proj', q: 'fix the tests', peer: 'desk-2' });
    expect(parseDeepLink('claude-web:new?folder=/home/me/proj', isDir)).toEqual({ kind: 'new', folder: '/home/me/proj' });
  });
  it('a folder that is not there, a strange machine name and unknown parameters are dropped', () => {
    expect(parseDeepLink('claude-web://new?folder=C%3A%5Cnope&peer=a%20b&x=1', isDir)).toEqual({ kind: 'new' });
  });
  it('a network or relative folder is never even looked up (Windows would log in to that host over SMB)', () => {
    const asked: string[] = [];
    const spy = (p: string) => { asked.push(p); return true; };
    for (const f of ['\\\\attacker.example\\share', '//attacker.example/share', '\\\\?\\UNC\\attacker\\s', '\\\\.\\pipe\\x', '/\\attacker\\s', 'relative\\dir', 'C:relative', '..\\up']) {
      expect(parseDeepLink(`claude-web://new?folder=${encodeURIComponent(f)}`, spy)).toEqual({ kind: 'new' });
    }
    expect(asked).toEqual([]);
    expect(parseDeepLink(`claude-web://new?folder=${encodeURIComponent('D:/work/x')}`, spy)).toEqual({ kind: 'new', folder: 'D:/work/x' });
    expect(asked).toEqual(['D:/work/x']);
  });
  it('the text is cut at 10 000 characters', () => {
    const r = parseDeepLink(`claude-web://new?q=${'a'.repeat(12_000)}`, isDir);
    expect(r?.kind === 'new' && r.q?.length).toBe(10_000);
  });
  it('session/<id>, also a remote one', () => {
    expect(parseDeepLink('claude-web://session/5a0e0e0e-0000-4000-8000-00000000c0e1', isDir)).toEqual({ kind: 'session', id: '5a0e0e0e-0000-4000-8000-00000000c0e1' });
    expect(parseDeepLink('claude-web://session/peer_ab~123', isDir)).toEqual({ kind: 'session', id: 'peer_ab~123' });
    expect(parseDeepLink('claude-web://session/..%2F..%2Fx%3Cy', isDir)).toBeNull();
  });
  it('anything else is not ours', () => {
    expect(parseDeepLink('https://example.com', isDir)).toBeNull();
    expect(parseDeepLink('claude-web://settings', isDir)).toBeNull();
    expect(parseDeepLink('not a url', isDir)).toBeNull();
  });
  it('the link among the launch arguments', () => {
    expect(linkFromArgv(['C:\\app\\Claude Web.exe', '--hidden', 'claude-web://new?q=hi'])).toBe('claude-web://new?q=hi');
    expect(linkFromArgv(['app.exe'])).toBeNull();
  });
});
