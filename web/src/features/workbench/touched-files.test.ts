// touched-files.test.ts
import { describe, expect, it } from 'vitest';
import { touchedFiles } from './touched-files';

describe('touchedFiles', () => {
  it('files Claude read or changed, first time first, no duplicates, other tools ignored', () => {
    expect(touchedFiles([
      { name: 'Read', input: { file_path: 'C:\\p\\a.ts' } },
      { name: 'Bash', input: { command: 'ls' } },
      { name: 'Edit', input: { file_path: 'C:\\p\\b.ts' } },
      { name: 'Read', input: { file_path: 'C:\\p\\a.ts' } },
      { name: 'MultiEdit', input: { file_path: 'C:\\p\\c.ts' } },
      { name: 'Write', input: { file_path: 'C:\\p\\d.md' } },
      { name: 'NotebookEdit', input: { notebook_path: 'C:\\p\\n.ipynb' } },
      { name: 'Read', input: null },
    ])).toEqual(['C:\\p\\a.ts', 'C:\\p\\b.ts', 'C:\\p\\c.ts', 'C:\\p\\d.md', 'C:\\p\\n.ipynb']);
  });
});
