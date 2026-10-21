// What a running step is doing, in the sixteen words the process animations are drawn for (spec 2026-10-22 §3).
export const PROCESSES = ['start', 'think', 'read', 'search', 'edit', 'cmd', 'test', 'git', 'install', 'web', 'agent', 'plan', 'tool', 'wait', 'compact', 'connect'] as const;
export type Process = (typeof PROCESSES)[number];

const BY_NAME: Record<string, Process> = {
  Read: 'read', NotebookRead: 'read', Grep: 'search', Glob: 'search', LS: 'search',
  Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  WebSearch: 'web', WebFetch: 'web', WebBrowser: 'web',
  Agent: 'agent', Task: 'agent', Workflow: 'agent',
  TodoWrite: 'plan', EnterPlanMode: 'plan', ExitPlanMode: 'plan',
};
const SHELLS = new Set(['Bash', 'PowerShell', 'BashOutput']);
const GIT = /^\s*git\s/;
const TEST = /\b(npm (run )?test|pnpm (run )?test|yarn test|bun test|deno test|vitest|jest|pytest|mocha|playwright test|cargo test|go test|dotnet test|mvn test|gradle test|phpunit|rspec)\b/;
const INSTALL = /\b(npm (i|install|ci)|pnpm (i|install|add)|yarn (add|install)|pip3? install|uv (add|sync|pip install)|cargo (add|install)|go get|bun (i|install|add)|brew install|apt(-get)? install|winget install)\b/;

export function processOf(name: string, input: Record<string, unknown> | undefined): Process {
  const byName = BY_NAME[name];
  if (byName) return byName;
  if (SHELLS.has(name)) {
    const c = typeof input?.command === 'string' ? input.command : '';
    if (GIT.test(c)) return 'git';
    // before the test words: `npm i -D vitest` installs
    if (INSTALL.test(c)) return 'install';
    if (TEST.test(c)) return 'test';
    return 'cmd';
  }
  if (name.startsWith('mcp__web__') || name.startsWith('mcp__browser')) return 'web';
  return 'tool';
}
