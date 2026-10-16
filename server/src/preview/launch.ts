// 预览服务器 (spec 2026-10-16 pages §3; the official app's `.claude/launch.json`): which dev servers a project has,
// how to start each, where it serves. The official format: { version, autoVerify?, configurations: [{ name,
// runtimeExecutable?, runtimeArgs?, program?, args?, port?, cwd?, env?, autoPort?, url? }] }; comments allowed.
import fs from 'node:fs';
import path from 'node:path';

export interface LaunchConfig {
  name: string;
  runtimeExecutable?: string;
  runtimeArgs?: string[];
  program?: string;
  args?: string[];
  port: number;
  cwd?: string;
  env?: Record<string, string>;
  /** true: a free port when this one is taken; false: fail; unset: fail and say so */
  autoPort?: boolean;
  url?: string;
}
export interface LaunchFile { autoVerify: boolean; configurations: LaunchConfig[] }

/** Comments (`//`, block) and trailing commas out, strings left alone. */
export function stripJsonc(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i < 0) break;
      i++;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

const strs = (v: unknown, what: string): string[] | undefined => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new Error(`${what} must be a list of strings`);
  return v as string[];
};

/** A localhost URL must be the server's own origin on its own port (it is where the browser goes once the port is up). */
function checkUrl(url: string, port: number, name: string): string {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error(`"${name}": url is not a URL`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`"${name}": url must be http(s)`);
  if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) {
    if ((u.port || (u.protocol === 'https:' ? '443' : '80')) !== String(port)) throw new Error(`"${name}": url's port must be the configuration's port (${port})`);
    if (u.pathname !== '/' || u.search || u.hash) throw new Error(`"${name}": a localhost url is an origin only (no path)`);
  }
  return url;
}

export function parseLaunch(text: string): LaunchFile {
  let j: any;
  try { j = JSON.parse(stripJsonc(text)); } catch (e) { throw new Error(`launch.json is not valid JSON: ${(e as Error).message}`); }
  if (!j || typeof j !== 'object' || !Array.isArray(j.configurations)) throw new Error('launch.json needs a "configurations" list');
  const seen = new Set<string>();
  const configurations = j.configurations.map((c: any, i: number): LaunchConfig => {
    if (!c || typeof c.name !== 'string' || !c.name.trim()) throw new Error(`configuration ${i + 1} needs a "name"`);
    const name = c.name.trim();
    if (seen.has(name)) throw new Error(`two configurations are called "${name}"`);
    seen.add(name);
    if (!c.runtimeExecutable && !c.program) throw new Error(`"${name}": needs runtimeExecutable or program`);
    const port = c.port === undefined ? 3000 : Number(c.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`"${name}": port must be 1–65535`);
    const env = c.env === undefined ? undefined : Object.fromEntries(Object.entries(c.env).map(([k, v]) => [k, String(v)]));
    return {
      name,
      runtimeExecutable: typeof c.runtimeExecutable === 'string' ? c.runtimeExecutable : undefined,
      runtimeArgs: strs(c.runtimeArgs, `"${name}": runtimeArgs`),
      program: typeof c.program === 'string' ? c.program : undefined,
      args: strs(c.args, `"${name}": args`),
      port,
      cwd: typeof c.cwd === 'string' ? c.cwd : undefined,
      env,
      autoPort: typeof c.autoPort === 'boolean' ? c.autoPort : undefined,
      url: typeof c.url === 'string' ? checkUrl(c.url, port, name) : undefined,
    };
  });
  return { autoVerify: j.autoVerify !== false, configurations };
}

export const launchPath = (root: string) => path.join(root, '.claude', 'launch.json');

/** The project's launch.json, or null when it has none (an unreadable one throws — say why rather than ignore it). */
export function readLaunch(root: string): LaunchFile | null {
  let text: string;
  try { text = fs.readFileSync(launchPath(root), 'utf8'); } catch { return null; }
  return parseLaunch(text);
}

/** `program` runs with node; otherwise the executable with its arguments. */
export function commandOf(c: LaunchConfig): { cmd: string; args: string[] } {
  if (c.runtimeExecutable) return { cmd: c.runtimeExecutable, args: [...(c.runtimeArgs ?? []), ...(c.program ? [c.program] : []), ...(c.args ?? [])] };
  return { cmd: 'node', args: [c.program!, ...(c.args ?? [])] };
}
