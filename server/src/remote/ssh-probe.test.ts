import { describe, expect, it } from 'vitest';
import { addedHostKey, classifySshProbe, keygenFingerprints, knownHostSpec, sshProbeArgs } from './ssh-probe';

describe('sshProbeArgs', () => {
  it('batch mode, a short timeout, then the health check on the remote loopback', () => {
    expect(sshProbeArgs({ target: 'me@box', sshPort: 2222, identityFile: 'C:\\k\\id', remotePort: 3091 })).toEqual([
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new', '-p', '2222', '-i', 'C:\\k\\id', 'me@box',
      'curl -fsS --max-time 5 http://127.0.0.1:3091/api/health || wget -qO- -T 5 http://127.0.0.1:3091/api/health || echo CW_NO_SERVER',
    ]);
    expect(sshProbeArgs({ target: 'box' }).at(-1)).toContain('127.0.0.1:3090');
  });
  it('a target that ssh would read as an option is refused', () => {
    expect(() => sshProbeArgs({ target: '-oProxyCommand=calc' })).toThrow();
  });
});

describe('first trust of a host key (E-minor)', () => {
  it('ssh saying it added the key is noticed, whatever the login did', () => {
    expect(addedHostKey("Warning: Permanently added 'box' (ED25519) to the list of known hosts.\r\n{\"version\":\"1\"}")).toBe(true);
    expect(addedHostKey('{"version":"1"}')).toBe(false);
  });
  it('the known_hosts name ssh-keygen -F looks up: the host, [host]:port off port 22', () => {
    expect(knownHostSpec('me@box.example', undefined)).toBe('box.example');
    expect(knownHostSpec('box', 22)).toBe('box');
    expect(knownHostSpec('me@10.0.0.2', 2222)).toBe('[10.0.0.2]:2222');
  });
  it('the fingerprint out of ssh-keygen -l -F', () => {
    const out = '# Host box found: line 12\nbox ED25519 SHA256:abcDEF0123456789+/xyz\n# Host box found: line 13\n|1|hashed= RSA SHA256:rsaKey000\n';
    expect(keygenFingerprints(out)).toEqual([{ type: 'ED25519', fingerprint: 'SHA256:abcDEF0123456789+/xyz' }, { type: 'RSA', fingerprint: 'SHA256:rsaKey000' }]);
    expect(keygenFingerprints('')).toEqual([]);
  });
});

describe('classifySshProbe', () => {
  it('logged in and the server answers / does not', () => {
    expect(classifySshProbe({ code: 0, output: '{"ok":true,"version":"0.42.0","serverIdHash":"ab"}' })).toEqual({ ssh: 'ok', serverUp: true, version: '0.42.0' });
    expect(classifySshProbe({ code: 0, output: 'CW_NO_SERVER\n' })).toEqual({ ssh: 'ok', serverUp: false });
    expect(classifySshProbe({ code: 1, output: '' })).toEqual({ ssh: 'ok', serverUp: false });
  });
  it('the ways ssh itself fails', () => {
    expect(classifySshProbe({ code: 255, output: 'me@box: Permission denied (publickey).' })).toMatchObject({ ssh: 'auth' });
    expect(classifySshProbe({ code: 255, output: 'ssh: Could not resolve hostname box: Name or service not known' })).toMatchObject({ ssh: 'unreachable' });
    expect(classifySshProbe({ code: 255, output: 'ssh: connect to host box port 22: Connection timed out' })).toMatchObject({ ssh: 'unreachable' });
    expect(classifySshProbe({ code: 255, output: 'Host key verification failed.' })).toMatchObject({ ssh: 'hostkey' });
    expect(classifySshProbe({ code: -1, output: 'spawn ssh ENOENT', enoent: true })).toMatchObject({ ssh: 'no-ssh' });
    expect(classifySshProbe({ code: 255, output: 'kex_exchange_identification: read: Connection reset' })).toMatchObject({ ssh: 'error', detail: 'kex_exchange_identification: read: Connection reset' });
  });
});
