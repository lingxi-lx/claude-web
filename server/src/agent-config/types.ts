// Wire types for the agent configuration center (Codex / Gemini / Qwen / OpenCode). Re-exported from
// protocol.ts so the web client sees them through `@shared`. Types only — no runtime imports here.

export type AgentConfigKind = 'codex' | 'gemini' | 'qwen' | 'opencode';

/** One MCP server in agent-neutral form. `env` / `headers` values are masked (`••••••`) on the way out. */
export interface McpSpec {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** false = present in the config but disabled (Codex `enabled = false`, OpenCode `enabled: false`) */
  enabled?: boolean;
}

export interface AgentConfigFile {
  /** e.g. 「全局说明」「项目说明」「配置文件」 */
  label: string;
  path: string;
  exists: boolean;
  kind: 'instructions' | 'config';
  scope: 'global' | 'project';
}

export interface AgentSettingField {
  /** dotted path inside the config file (`model`, `model.name`, `general.defaultApprovalMode`) */
  key: string;
  label: string;
  type: 'enum' | 'string';
  options?: string[];
  /** suggestions for a free-text field (known model ids) */
  suggestions?: string[];
  value?: string;
  hint?: string;
}

export interface AgentConfigState {
  kind: AgentConfigKind;
  name: string;
  installed: boolean;
  version: string;
  /** the config file the settings / file-edited MCP live in */
  configPath: string;
  files: AgentConfigFile[];
  mcp: McpSpec[];
  /** set when the MCP list could not be read (CLI failed, file does not parse…) */
  mcpError?: string;
  /** how MCP changes are made: through the agent's own CLI, or a structured edit of its config file */
  mcpVia: 'cli' | 'file';
  /** transports this agent can take */
  transports: McpSpec['transport'][];
  settings: AgentSettingField[];
  settingsError?: string;
}

export interface AgentConfigBackup {
  id: string; // `<agent>/<backup file name>`
  agent: AgentConfigKind;
  /** the file that was backed up */
  path: string;
  at: number;
  reason: string;
  size: number;
  /** the file's state before the config center first touched it — never pruned */
  first?: boolean;
}

/** A Claude Code MCP server offered as a sync source (values masked). */
export interface ClaudeMcpEntry { scope: 'user' | 'local' | 'project'; spec: McpSpec }

export interface McpSyncResult { agent: AgentConfigKind; ok: boolean; message: string }

/** Where a synced MCP server comes from: a Claude server read server-side by name (secrets never reach the client), or a full spec. */
export type McpSyncSource = { claude: string; cwd?: string } | { spec: McpSpec };

export type AgentConfigRequest =
  | { kind: 'agentConfig.list'; cwd?: string }
  | { kind: 'agentConfig.get'; agent: AgentConfigKind; cwd?: string }
  | { kind: 'agentConfig.claudeMcp'; cwd?: string }
  | { kind: 'agentConfig.mcp.add'; agent: AgentConfigKind; spec: McpSpec; overwrite?: boolean }
  | { kind: 'agentConfig.mcp.remove'; agent: AgentConfigKind; name: string }
  | { kind: 'agentConfig.mcp.sync'; source: McpSyncSource; targets: AgentConfigKind[]; overwrite?: boolean }
  | { kind: 'agentConfig.set'; agent: AgentConfigKind; key: string; value: string | null }
  | { kind: 'agentConfig.createFile'; agent: AgentConfigKind; path: string; cwd?: string }
  | { kind: 'agentConfig.backups'; agent?: AgentConfigKind }
  | { kind: 'agentConfig.restore'; id: string }
  // 接入 (selections.ts): every agent in the registry, its model / effort, what claude-web wrote, drift
  | { kind: 'agentConfig.selections' }
  | { kind: 'agentConfig.selection.apply'; agent: string; model: string; effort?: string | null }
  | { kind: 'agentConfig.selection.reapply'; agent: string }
  | { kind: 'agentConfig.selection.accept'; agent: string }
  | { kind: 'agentConfig.selection.restore'; agent: string };

export type { DriftReport, DriftChange, ModelSelection } from './drift.js';
import type { DriftReport, ModelSelection } from './drift.js';

/** The same agent's config inside a WSL distro (read-only). */
export interface AgentSelectionTwin {
  distro: string;
  configPath: string;
  model: string;
  effort: string;
  /** compared with the same `expected` as the Windows side */
  drift: DriftReport | null;
}

/** One registry agent on the 接入 page. */
export interface AgentSelectionState {
  /** registry id: claude-code | codex | gemini-cli | opencode | cursor | trae | qoder */
  id: string;
  name: string;
  configPath: string;
  detected: boolean;
  /** what the config says now ('' = not set) */
  model: string;
  effort: string;
  /** this agent has a reasoning-strength key we can write */
  effortField: boolean;
  /** what claude-web last wrote; absent = never written by us */
  expected?: ModelSelection;
  appliedAt?: number;
  /** the file differs from `expected` (changed outside claude-web) */
  drift: DriftReport | null;
  /** we hold a restore point (the values before our first write) */
  restorable: boolean;
  /** the file could not be read / parsed */
  error?: string;
  wsl?: AgentSelectionTwin[];
}
