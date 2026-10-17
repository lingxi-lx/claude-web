import { describe, expect, it } from 'vitest';
import { codexConfigHint, stripAnsi } from './codex-config-hint.js';

// what Codex printed on 2026-10-17 (the screenshot), colour codes and all
const REAL = 'failed to load configuration: failed to parse model_catalog_json path `C:\\Users\\YPY\\.codex\\codexmate\\relay\\codex_router_catalog.json` as JSON: missing field `supports_reasoning_summaries` at line 91 column 20\n'
  + '\u001b[2m2026-10-17T04:59:38.249208Z\u001b[0m \u001b[31mERROR\u001b[0m \u001b[2mcodex_app_server\u001b[0m\u001b[2m:\u001b[0m Invalid configuration; using defaults.';

describe('Codex could not read its configuration', () => {
  it('a model catalog another tool wrote: which file, who wrote it, what is wrong, and what to do', () => {
    const h = codexConfigHint(REAL)!;
    expect(h).toContain('model_catalog_json');
    expect(h).toContain('C:\\Users\\YPY\\.codex\\codexmate\\relay\\codex_router_catalog.json');
    expect(h).toContain('codexmate');
    expect(h).toContain('missing field `supports_reasoning_summaries`');
    expect(h).not.toContain('\u001b');
  });
  it('another config error gets the general advice; anything else gets none', () => {
    expect(codexConfigHint('Error loading configuration: invalid type: string, expected a boolean in `C:\\u\\.codex\\config.toml`')).toContain('config.toml');
    expect(codexConfigHint('request timed out after 60000 ms')).toBeNull();
    // Codex warns about config.toml on every start; an unrelated failure is not a config problem (verifier, real 0.162)
    const warn = 'ERROR codex_app_server: Codex is ignoring 1 unrecognized configuration setting\n  user (C:\\h\\config.toml): `experimental_use_rmcp_client` is ignored.';
    expect(codexConfigHint('Invalid request: unknown variant `bogus-mode`, expected one of `read-only`', warn)).toBeNull();
    expect(codexConfigHint('Not logged in', 'INFO loaded config.toml from C:\\h')).toBeNull();
  });
  it('colour codes come off', () => {
    expect(stripAnsi('\u001b[2mtime\u001b[0m \u001b[31mERROR\u001b[0m x')).toBe('time ERROR x');
  });
});
