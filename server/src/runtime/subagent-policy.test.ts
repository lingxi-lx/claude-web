import { describe, expect, it } from 'vitest';
import { subagentModelName, subagentPolicyPrompt } from './subagent-policy.js';

describe('subagent policy (子代理硬绑定)', () => {
  it('names the model of a pick, from another provider too', () => {
    expect(subagentModelName('cw-x:ntuxdq7p:deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash');
    expect(subagentModelName('claude-haiku-4-5')).toBe('claude-haiku-4-5');
  });

  it('a picked model: a section telling the main model to delegate, without being asked', () => {
    const p = subagentPolicyPrompt('cw-x:ds:deepseek-v4.1-flash');
    expect(p).toMatch(/^# Subagents\n/);
    expect(p).toContain('(deepseek-v4.1-flash)');
    expect(p).toContain('does not need to ask for subagents');
    expect(p).toContain('Agent tool');
  });

  it('same as the main model: nothing', () => {
    expect(subagentPolicyPrompt('')).toBe('');
    expect(subagentPolicyPrompt(undefined)).toBe('');
  });
});
