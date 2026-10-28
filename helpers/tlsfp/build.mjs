#!/usr/bin/env node
// Build the tlsfp helper: `node helpers/tlsfp/build.mjs [--os windows|darwin|linux] [--arch amd64|arm64]`.
// Needs Go (1.24+). Output: helpers/tlsfp/bin/tlsfp[.exe] — where server/src/gateway/fingerprint/helper.ts looks first
// (after CLAUDE_WEB_TLSFP); copy it to <CLAUDE_WEB_DIR>/bin/ for an installed app. Without it the gateway uses Node's TLS.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const goos = arg('os') ?? { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
const goarch = arg('arch') ?? { x64: 'amd64', arm64: 'arm64' }[process.arch];
if (!goos || !goarch) { console.error('tlsfp: unsupported platform; pass --os and --arch'); process.exit(1); }

const run = (args, extraEnv = {}) => {
  const r = spawnSync('go', args, { cwd: dir, stdio: 'inherit', windowsHide: true, env: { ...process.env, ...extraEnv } });
  if (r.error) { console.error(r.error.code === 'ENOENT' ? 'tlsfp: Go is not installed (https://go.dev/dl/); the gateway keeps using the Node TLS approximation' : `tlsfp: ${r.error.message}`); process.exit(1); }
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run(['mod', 'tidy']);
const out = path.join(dir, 'bin', goos === 'windows' ? 'tlsfp.exe' : 'tlsfp');
fs.mkdirSync(path.dirname(out), { recursive: true });
run(['build', '-trimpath', '-ldflags', '-s -w', '-o', out, '.'], { GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' });
console.log(`tlsfp: built ${path.relative(process.cwd(), out)}`);
