// 预览服务器 tools (spec 2026-10-16 pages §3): Claude starts the project's dev server from .claude/launch.json, it opens
// in the app's browser, and Claude can read its output or stop it. In-process, like the sessions tools. preview_start
// runs a command, so it is NOT pre-allowed: the first time, the user approves it (the CLI then remembers 总是允许).
import fs from 'node:fs';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { launchPath, readLaunch } from './launch.js';
import type { PreviewService } from './service.js';

export const PREVIEW_SERVER = 'preview';
export const PREVIEW_ALLOWED = ['preview_logs', 'preview_stop'].map((t) => `mcp__${PREVIEW_SERVER}__${t}`);

interface Deps { service: PreviewService; open(sessionId: string, url: string): Promise<void> }
let deps: Deps | null = null;
export function setPreviewDeps(d: Deps | null) { deps = d; }
export function previewEnabled() { return !!deps; }

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true });

export function previewMcpServer(cwd: string, self: () => string, d: Deps = deps!) {
  return createSdkMcpServer({
    name: PREVIEW_SERVER,
    version: '1.0.0',
    tools: [
      tool('preview_start', 'Start this project\'s dev server from .claude/launch.json (the first configuration, or the one named), wait until it listens, and open it in the app\'s built-in browser. Then check it with browser_screenshot / browser_read and preview_logs.', {
        name: z.string().optional().describe('the configuration name in .claude/launch.json'),
      }, async (a) => {
        try {
          const r = await d.service.start(cwd, a.name);
          await d.open(self(), r.url).catch(() => { /* no window hosts the browser: the URL is still right */ });
          return text(`${r.already ? 'Already running' : 'Started'}: "${r.name}" at ${r.url}${r.already ? '' : ' (opened in the browser)'}.`);
        } catch (e) {
          return fail((e as Error).message);
        }
      }),
      tool('preview_logs', 'The latest output of this project\'s running preview server (errors, warnings, requests).', {
        name: z.string().optional(),
        lines: z.number().int().min(1).max(2000).optional().describe('how many recent lines (default 200)'),
      }, async (a) => text(d.service.logs(cwd, a.name, a.lines ?? 200))),
      tool('preview_stop', 'Stop this project\'s preview server.', { name: z.string().optional() }, async (a) =>
        text((await d.service.stop(cwd, a.name)) ? 'Stopped.' : 'No preview server of this project is running.')),
    ],
  });
}

/**
 * 自动验证: what the conversation is told when its project has a launch.json (and autoVerify is not false) — check
 * the change in the running app before ending the turn. Nothing for a project without one.
 */
export function verifyInstructions(cwd: string): string | null {
  if (!fs.existsSync(launchPath(cwd))) return null;
  let auto = true;
  try { auto = readLaunch(cwd)?.autoVerify !== false; } catch { /* a broken file: preview_start will say what is wrong */ }
  if (!auto) return null;
  return [
    'This project has a preview server (.claude/launch.json).',
    'After changing code that affects what the app shows or serves: start it with preview_start, check the result with browser_screenshot or browser_read, look at preview_logs for errors, fix what is broken, and only then end your turn.',
    'Skip this for changes that cannot affect the running app (docs, tests only, config the server does not read).',
  ].join(' ');
}
