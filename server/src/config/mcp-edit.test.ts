import { describe, expect, it } from 'vitest';
import { MCP_MASK, findMcp, maskMcp, unmaskMcp } from './mcp-edit.js';

describe('findMcp', () => {
  const user = {
    mcpServers: { pencil: { command: 'old.exe' }, both: { command: 'user' } },
    projects: { 'C:/work/app': { mcpServers: { both: { command: 'local' } } } },
  };
  const project = { mcpServers: { repo: { command: 'repo' }, both: { command: 'project' } } };

  it('takes this project only first, then the repo, then every project', () => {
    expect(findMcp('both', user, project, 'C:/work/app')).toEqual({ scope: 'local', config: { command: 'local' } });
    expect(findMcp('both', user, project, 'C:/elsewhere')).toEqual({ scope: 'project', config: { command: 'project' } });
    expect(findMcp('pencil', user, project, 'C:/work/app')).toEqual({ scope: 'user', config: { command: 'old.exe' } });
    expect(findMcp('repo', user, project)).toEqual({ scope: 'project', config: { command: 'repo' } });
  });
  it('null when no file has it (a plugin’s server)', () => {
    expect(findMcp('plugin-x', user, null)).toBeNull();
    expect(findMcp('x', null, null)).toBeNull();
  });
});

describe('mask / unmask', () => {
  const stored = { type: 'stdio', command: 'pencil.exe', env: { API_KEY: 'sk-real', PENCIL_HOME: 'D:/pencil' }, headers: { Authorization: 'Bearer t' } };

  it('masks only credential-looking values', () => {
    expect(maskMcp(stored)).toEqual({ ...stored, env: { API_KEY: MCP_MASK, PENCIL_HOME: 'D:/pencil' }, headers: { Authorization: MCP_MASK } });
  });
  it('an untouched mask keeps the stored value; edits, additions and removals go through', () => {
    const sent = { type: 'stdio', command: 'C:/Pencil/pencil.exe', env: { API_KEY: MCP_MASK, PENCIL_HOME: 'E:/p', NEW: '1' }, headers: { Authorization: 'Bearer new' } };
    expect(unmaskMcp(sent, stored)).toEqual({ type: 'stdio', command: 'C:/Pencil/pencil.exe', env: { API_KEY: 'sk-real', PENCIL_HOME: 'E:/p', NEW: '1' }, headers: { Authorization: 'Bearer new' } });
    expect(unmaskMcp({ command: 'x', env: {} }, stored)).toEqual({ command: 'x' });
  });
  it('a renamed masked row keeps its value; a mask with nothing stored is refused, not saved as ""', () => {
    expect(unmaskMcp({ env: { PEN_API_KEY: MCP_MASK } }, stored, { PEN_API_KEY: 'API_KEY' })).toEqual({ env: { PEN_API_KEY: 'sk-real' } });
    expect(unmaskMcp({ type: 'http', headers: { API_KEY: MCP_MASK } }, stored)).toEqual({ type: 'http', headers: { API_KEY: 'sk-real' } });
    expect(() => unmaskMcp({ env: { PEN_API_KEY: MCP_MASK } }, stored)).toThrow(/PEN_API_KEY/);
    expect(() => unmaskMcp({ env: { constructor: MCP_MASK } }, stored)).toThrow();
  });
  it('a server named like a built-in property is not found on the prototype', () => {
    expect(findMcp('constructor', { mcpServers: {} }, { mcpServers: {} })).toBeNull();
  });
});
