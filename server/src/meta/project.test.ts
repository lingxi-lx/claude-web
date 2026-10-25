import { describe, it, expect } from 'vitest';
import { projectOf, instructionsSection, inProjectScope, projectFilesDir, safeProjectFile, MAX_INSTRUCTIONS } from './project.js';

const W = [
  { id: 'w1', path: 'C:\\code\\app', name: 'App', instructions: 'Use pnpm.' },
  { id: 'w2', path: 'C:\\code\\site', name: 'Site' },
];
describe('project', () => {
  it('finds the project by meta id, then by the main folder (case-insensitively on Windows)', () => {
    expect(projectOf({ cwd: 'c:/code/app/' }, W, true)?.id).toBe('w1');
    expect(projectOf({ cwd: 'C:\\elsewhere', workspaceId: 'w2' }, W, true)?.id).toBe('w2');
    expect(projectOf({ cwd: 'C:\\wt\\x', groupCwd: 'C:\\code\\site' }, W, true)?.id).toBe('w2');
    expect(projectOf({ cwd: 'C:\\code\\app\\sub' }, W, true)).toBeUndefined();
    expect(projectOf({ cwd: 'C:\\x', workspaceId: 'gone' }, W, true)).toBeUndefined();
  });
  it('instructions become an appended block, empty ones nothing', () => {
    expect(instructionsSection(W[1])).toBe('');
    expect(instructionsSection({ ...W[1], instructions: '   ' })).toBe('');
    const s = instructionsSection(W[0]);
    expect(s).toContain('App');
    expect(s).toContain('Use pnpm.');
    expect(instructionsSection({ ...W[0], instructions: 'x'.repeat(MAX_INSTRUCTIONS + 50) }).length).toBeLessThan(MAX_INSTRUCTIONS + 300);
  });
  it('project scope: same project only; outside every project sees only the outside', () => {
    expect(inProjectScope('w1', 'w1')).toBe(true);
    expect(inProjectScope('w1', 'w2')).toBe(false);
    expect(inProjectScope('w1', undefined)).toBe(false);
    expect(inProjectScope(undefined, undefined)).toBe(true);
    expect(inProjectScope(undefined, 'w1')).toBe(false);
  });
  it('project files live under the data dir, names are plain file names', () => {
    expect(projectFilesDir('/d', 'w1').replace(/\\/g, '/')).toBe('/d/projects/w1');
    expect(() => projectFilesDir('/d', '../x')).toThrow();
    expect(safeProjectFile('notes.md')).toBe('notes.md');
    for (const bad of ['../x', 'a/b', 'a\\b', '', '..', 'x\u0000', 'CON']) expect(safeProjectFile(bad), bad).toBeNull();
  });
});
