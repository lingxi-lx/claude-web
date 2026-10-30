import { describe, expect, it } from 'vitest';
import { buildMcpConfig, renamesOf, toPairs } from './mcp-edit-model';

describe('renamesOf', () => {
  it('only renamed rows that came from the stored config', () => {
    const rows = toPairs({ API_KEY: '••••••', HOME: '/h' });
    rows[0].k = 'PEN_API_KEY';
    expect(renamesOf(rows, [{ k: 'NEW', v: '1' }])).toEqual({ PEN_API_KEY: 'API_KEY' });
  });
});

describe('buildMcpConfig', () => {
  const orig = { type: 'stdio', command: 'old.exe', args: ['--mcp'], env: { A: '1' }, timeout: 30000 };

  it('stdio: args one per line, empty env names dropped, other fields kept', () => {
    expect(buildMcpConfig(orig, { kind: 'stdio', command: ' C:/Pencil/pencil.exe ', args: '--mcp\n\n --port=1 ', env: [{ k: 'A', v: '2' }, { k: ' ', v: 'x' }, { k: 'B', v: '' }], url: '', headers: [] }))
      .toEqual({ type: 'stdio', command: 'C:/Pencil/pencil.exe', args: ['--mcp', '--port=1'], env: { A: '2', B: '' }, timeout: 30000 });
  });
  it('switching to http drops command / args / env', () => {
    expect(buildMcpConfig(orig, { kind: 'http', command: 'x', args: 'y', env: [{ k: 'A', v: '1' }], url: 'https://x/mcp', headers: [] }))
      .toEqual({ type: 'http', url: 'https://x/mcp', timeout: 30000 });
  });
});
