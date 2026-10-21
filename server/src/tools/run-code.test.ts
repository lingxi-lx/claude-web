import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCode, runnerFor } from './run-code.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cw-runcode-'));
// macOS: os.tmpdir() is /var/folders/… but the child reports /private/var/folders/… (symlink)
const real = (p: string) => { try { return fs.realpathSync.native(p); } catch { return p; } };

describe('runCode', () => {
  it('runs JavaScript in the folder it was given and captures both streams', async () => {
    const cwd = tmp();
    const r = await runCode('javascript', "console.log(process.cwd()); console.error('oops')", { cwd });
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
    expect(real(r.stdout.trim()).toLowerCase()).toBe(real(cwd).toLowerCase());
    expect(r.stderr).toContain('oops');
  });

  it('reports a non-zero exit', async () => {
    const r = await runCode('js', 'process.exit(3)');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(3);
  });

  it('stops a run at the timeout', async () => {
    const r = await runCode('javascript', 'setTimeout(() => {}, 5000)', { timeoutMs: 200 });
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
  }, 15_000);

  it('stops when the output passes its cap', async () => {
    const r = await runCode('javascript', "for (let i = 0; i < 20000; i++) console.log('x'.repeat(100));", { maxOutput: 500 });
    expect(r.truncated).toBe(true);
    expect(r.stdout.length + r.stderr.length).toBeLessThanOrEqual(500);
  }, 15_000);

  it('falls back to the process folder for a bad cwd', async () => {
    const r = await runCode('js', 'console.log(process.cwd())', { cwd: '/does/not/exist/anywhere' });
    expect(r.ok).toBe(true);
    expect(real(r.stdout.trim())).toBe(real(process.cwd()));
  });

  it('refuses a language it cannot start', async () => {
    await expect(runCode('brainfuck', '+++')).rejects.toThrow(/不能直接运行/);
  });

  it('knows which programs to start', () => {
    expect(runnerFor('js')?.cmd).toBe(process.execPath);
    expect(runnerFor('python')?.args('x')).toEqual(['-c', 'x']);
    expect(runnerFor('node')?.args('x')).toEqual(['-e', 'x']);
    expect(runnerFor('nope')).toBeNull();
  });
});
