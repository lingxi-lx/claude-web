import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installConsoleMask, maskForOutput, maskOutput, OutputMaskStream, outputCompiled } from './output.js';
import { PrivacyService } from './service.js';
import { DEFAULT_PRIVACY, type PrivacySettings } from './types.js';

const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH';
const on: PrivacySettings = { ...DEFAULT_PRIVACY, enabled: true, words: ['Bluefin'], actions: { ...DEFAULT_PRIVACY.actions, email: 'warn', name: 'redact' } };

let undo: (() => void) | null = null;
afterEach(() => { undo?.(); undo = null; });

describe('output-side masking (logs, diagnostics, exports)', () => {
  it('secrets always; the user\'s types only with privacy and 日志和导出也遮住 on', () => {
    const text = `key ${KEY} mail bob@example.com project Bluefin 客户陈建国反馈`;
    const none = maskOutput(text, outputCompiled({ ...on, enabled: false }));
    expect(none).not.toContain(KEY);
    expect(none).toContain('bob@example.com');
    const all = maskOutput(text, outputCompiled(on));
    expect(all).not.toContain(KEY);
    // a warn-only type is still masked in an output: nothing is ever restored there
    expect(all).toContain('[EMAIL]');
    expect(all).toContain('[CUSTOM]');
    expect(all).toContain('[NAME]');
    expect(all).not.toContain('陈建国');
    expect(maskOutput(text, outputCompiled({ ...on, output: false }))).toContain('bob@example.com');
  });

  it('a stream masks values cut across chunks', async () => {
    const parts = ['line one bob@exa', 'mple.com\nkey sk-ant-api03-abcdefghij', 'klmnopqrstuvwxyz0123456789ABCDEFGH\n', 'tail'];
    const c = outputCompiled(on);
    const out: string[] = [];
    await new Promise<void>((resolve, reject) => Readable.from(parts).pipe(new OutputMaskStream((s) => maskOutput(s, c))).on('data', (d) => out.push(String(d))).on('end', resolve).on('error', reject));
    const all = out.join('');
    expect(all).not.toContain('bob@example.com');
    expect(all).not.toContain(KEY);
    expect(all.endsWith('tail')).toBe(true);
  });

  it('the console is masked, a clean line goes out untouched, and a settings change applies at once', () => {
    const cfg: any = { ...on };
    const privacy = new PrivacyService({ privacyConfig: () => cfg, savePrivacy: async () => {} } as any);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    undo = installConsoleMask((l) => privacy.maskOutput(l));
    const obj = { a: 1 };
    console.log('nothing here', obj);
    expect(spy).toHaveBeenLastCalledWith('nothing here', obj);
    console.log('mail %s', 'bob@example.com');
    expect(spy).toHaveBeenLastCalledWith('mail [EMAIL]');
    cfg.enabled = false;
    console.log('mail bob@example.com');
    expect(spy).toHaveBeenLastCalledWith('mail bob@example.com');
    expect(maskForOutput(`k ${KEY}`)).not.toContain(KEY);
    undo();
    undo = null;
    spy.mockRestore();
  });
});
