import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BackgroundService, noticesIn } from './service.js';

const sys = (subtype: string, o: Record<string, unknown>) => ({ type: 'system', subtype, uuid: 'u', session_id: 's', ...o });
// the line the CLI writes when a notification is queued (as JSON, so the newlines are \n inside the string)
const queued = (id: string, status: string, summary: string) => JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: 't', sessionId: 's', content: `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>tu</tool-use-id>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>` });

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('ends read from the transcript (the stream did not carry them)', () => {
  it('noticesIn reads id, status and summary out of a queue line', () => {
    expect(noticesIn(queued('b1', 'completed', 'Background command "ls" completed (exit code 0)'))).toEqual([{ task_id: 'b1', status: 'completed', summary: 'Background command "ls" completed (exit code 0)' }]);
    expect(noticesIn('nothing here')).toEqual([]);
  });

  it('a command that ended mid-turn stops counting as 在跑; a quoted notification and an older one do not end anything', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-bgn-'));
    dirs.push(dir);
    const file = path.join(dir, 's.jsonl');
    // before the conversation had background work: an old notification for the same id is not ours
    fs.writeFileSync(file, queued('b1', 'completed', 'old') + '\n');
    const pool = new EventEmitter();
    const svc = new BackgroundService({ pool: pool as any, transcriptOf: () => file, sweepMs: 60_000 });
    pool.emit('message', 's1', sys('task_started', { task_id: 'b1', description: 'npm test', task_type: 'local_bash', is_backgrounded: true }));
    pool.emit('message', 's1', sys('task_started', { task_id: 'b2', description: 'npm run dev', task_type: 'local_bash', is_backgrounded: true }));
    expect(svc.reconcile('s1')).toBe(false);
    expect(svc.hasRunning('s1')).toBe(true);
    // a tool result that quotes a notification for b2, then the real queue line for b1, and a half-written line
    fs.appendFileSync(file, JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: '<task-notification><task-id>b2</task-id><status>completed</status></task-notification>' }] } }) + '\n');
    fs.appendFileSync(file, queued('b1', 'completed', 'Background command "npm test" completed (exit code 0)') + '\n' + '{"type":"queue-operation","content":"<task-notification><task-id>b2');
    expect(svc.reconcile('s1')).toBe(true);
    const tasks = svc.list()[0].tasks;
    expect(tasks.find((t) => t.id === 'b1')?.status).toBe('completed');
    expect(tasks.find((t) => t.id === 'b2')?.status).toBe('running');
    // the rest of the half line arrives: b2 ends too, and nothing is left running
    fs.appendFileSync(file, '</task-id>\\n<status>killed</status></task-notification>"}\n');
    expect(svc.reconcile('s1')).toBe(true);
    expect(svc.list()[0].tasks.find((t) => t.id === 'b2')?.status).toBe('stopped');
    expect(svc.hasRunning('s1')).toBe(false);
    svc.dispose();
  });
});
