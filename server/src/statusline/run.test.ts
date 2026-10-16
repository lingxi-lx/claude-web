import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { clipStatus, parseStatusLine, runStatusLine } from './run.js';

describe('statusLine', () => {
  it('only a command statusLine counts', () => {
    expect(parseStatusLine({ type: 'command', command: '~/.claude/statusline.sh', padding: 0 })).toEqual({ command: '~/.claude/statusline.sh', padding: 0 });
    expect(parseStatusLine({ command: 'echo hi' })).toEqual({ command: 'echo hi', padding: undefined });
    expect(parseStatusLine({ type: 'static', command: 'x' })).toBeNull();
    expect(parseStatusLine({ type: 'command', command: '  ' })).toBeNull();
    expect(parseStatusLine('echo')).toBeNull();
  });
  it('output: CRLF folded, trailing blank lines dropped, 20 lines at most', () => {
    expect(clipStatus('a\r\nb\r\n\r\n')).toBe('a\nb');
    expect(clipStatus(Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n')).split('\n')).toHaveLength(20);
  });
  it('runs with the conversation as JSON on stdin; a failing or silent command is null', async () => {
    const node = JSON.stringify(process.execPath.replace(/\\/g, '/'));
    const echo = `${node} -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('sid='+JSON.parse(s).session_id))"`;
    expect(await runStatusLine(echo, { session_id: 'abc' }, os.tmpdir())).toBe('sid=abc');
    expect(await runStatusLine(`${node} -e "process.exit(3)"`, {}, os.tmpdir())).toBeNull();
    expect(await runStatusLine(`${node} -e ""`, {}, os.tmpdir())).toBeNull();
    expect(await runStatusLine(`${node} -e "setTimeout(()=>{},5000)"`, {}, os.tmpdir(), 300)).toBeNull();
  }, 20000);
});
