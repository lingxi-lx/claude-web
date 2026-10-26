import { describe, expect, it } from 'vitest';
import { isEngineSpawn } from './engine-spawn-log.js';

describe('E2E engine spawn observer', () => {
  it('counts server engine spawns after redaction removes a long worktree path', () => {
    expect(isEngineSpawn({ role: 'server', from: 'spawnClaude dist/claude-exe.js:207' })).toBe(true);
    expect(isEngineSpawn({ role: 'server', from: 'spawnClaude dist\\claude-exe.js:207' })).toBe(true);
  });

  it('does not count engine children, other server processes, or other callers', () => {
    expect(isEngineSpawn({ role: 'cli-node.js', from: 'chunks/execa.js:34' })).toBe(false);
    expect(isEngineSpawn({ role: 'server', from: 'versionOf dist/claude-exe.js:121' })).toBe(false);
    expect(isEngineSpawn({ role: 'server', from: 'resolveSpawn agents/resolve.ts:15' })).toBe(false);
    expect(isEngineSpawn({ role: 'server' })).toBe(false);
    expect(isEngineSpawn({ role: 'server', from: 'other spawnClaude dist/claude-exe.js:207' })).toBe(false);
    expect(isEngineSpawn({ role: 'server', from: 'spawnClaude dist/claude-exe.js:207 extra' })).toBe(false);
  });
});
