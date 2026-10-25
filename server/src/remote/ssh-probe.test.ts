import { describe, expect, it } from 'vitest';
import { classifySshProbe, sshProbeArgs } from './ssh-probe';

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
