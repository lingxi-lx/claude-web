/** Test-only observer for the spawn guard's redacted log; no raw process arguments are needed. */
export interface SpawnLogRecord {
  role?: string;
  from?: string;
}

/** Match both slash directions: the guard normalizes Windows paths, tests and other logs need not. */
export function isEngineSpawn(record: SpawnLogRecord): boolean {
  return record.role === 'server' && /^spawnClaude .+[/\\]claude-exe\.js:\d+$/.test(record.from ?? '');
}
