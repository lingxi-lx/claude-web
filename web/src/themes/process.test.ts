import { describe, expect, it } from 'vitest';
import { PROCESSES, processOf } from './process';

describe('processOf', () => {
  const cmd = (command: string) => processOf('Bash', { command });
  it('maps tools by name', () => {
    expect(processOf('Read', {})).toBe('read');
    expect(processOf('Grep', {})).toBe('search');
    expect(processOf('Glob', {})).toBe('search');
    expect(processOf('Edit', {})).toBe('edit');
    expect(processOf('Write', {})).toBe('edit');
    expect(processOf('MultiEdit', {})).toBe('edit');
    expect(processOf('NotebookEdit', {})).toBe('edit');
    expect(processOf('WebSearch', {})).toBe('web');
    expect(processOf('WebFetch', {})).toBe('web');
    expect(processOf('mcp__web__search', {})).toBe('web');
    expect(processOf('Agent', {})).toBe('agent');
    expect(processOf('Task', {})).toBe('agent');
    expect(processOf('Workflow', {})).toBe('agent');
    expect(processOf('TodoWrite', {})).toBe('plan');
    expect(processOf('ExitPlanMode', {})).toBe('plan');
    expect(processOf('mcp__github__create_issue', {})).toBe('tool');
    expect(processOf('Skill', {})).toBe('tool');
  });
  it('reads a command for test / git / install', () => {
    expect(cmd('npm test -w web')).toBe('test');
    expect(cmd('cd web && npx vitest run')).toBe('test');
    expect(cmd('pytest -q')).toBe('test');
    expect(cmd('cargo test')).toBe('test');
    expect(cmd('git push origin main')).toBe('git');
    expect(cmd('git commit -m "x" && npm test')).toBe('git');
    expect(cmd('npm install')).toBe('install');
    expect(cmd('npm i -D vitest')).toBe('install');
    expect(cmd('pip install requests')).toBe('install');
    expect(cmd('ls -la')).toBe('cmd');
    expect(processOf('PowerShell', { command: 'Get-ChildItem' })).toBe('cmd');
    expect(processOf('Bash', undefined)).toBe('cmd');
  });
  it('has sixteen processes', () => expect(PROCESSES.length).toBe(16));
});
