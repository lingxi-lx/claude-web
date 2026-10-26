import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaStore } from '../meta/store.js';
import { ProviderService } from '../providers/service.js';
import { SecretService } from '../secrets/service.js';
import { UpstreamService } from '../upstreams/service.js';
import { SidecarManager, assetFor } from '../upstreams/sidecar.js';
import { GeminiAdapter } from '../upstreams/gemini.js';
import { WorkBuddyAdapter } from '../upstreams/workbuddy.js';
import { ClaudeAdapter } from '../upstreams/claude.js';
import { EventEmitter } from 'node:events';
import type { SidecarId } from '../upstreams/types.js';
import { ChannelService } from './service.js';

let dir = '';
let server: http.Server;
let requests: string[] = [];
let sidecars: SidecarManager;
let meta: MetaStore;
let upstreams: UpstreamService;
let channels: ChannelService;
let providerId = '';

let previousDir: string | undefined;

beforeEach(async () => {
  previousDir = process.env.CLAUDE_WEB_DIR;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-channels-smoke-'));
  process.env.CLAUDE_WEB_DIR = dir;
  requests = [];
  server = http.createServer((request, response) => {
    requests.push(request.url ?? '');
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      data: [{ id: 'claude-sonnet-test', object: 'model', created: 1, owned_by: 'test' }],
    }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  meta = new MetaStore(path.join(dir, 'meta.json'));
  await meta.load();
  const secrets = new SecretService();
  const providers = new ProviderService(meta, secrets);
  sidecars = new SidecarManager({ dir: path.join(dir, 'no-installed-sidecars') });
  for (const method of ['ensure', 'install', 'start'] as const) vi.spyOn(sidecars, method);
  vi.spyOn(sidecars, 'stopAll');
  const claude = new ClaudeAdapter({ fetch: vi.fn(async () => new Response('{}', { status: 200 })) });
  upstreams = new UpstreamService({ meta, secrets, sidecars, claude, gemini: new GeminiAdapter(sidecars), workbuddy: new WorkBuddyAdapter(sidecars) });
  channels = new ChannelService({ providers, upstreams });
  const address = server.address() as { port: number };
  const provider = await meta.upsertProvider({
    name: 'Legacy Relay', type: 'anthropic',
    baseUrl: `http://127.0.0.1:${address.port}`, apiKey: 'test-key', models: ['stale-model'],
  });
  providerId = provider.id;
  await upstreams.add({
    kind: 'claude', name: 'Legacy Claude', credential: { kind: 'setup-token', token: 'test-token' }, probe: false,
  });
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  server.closeAllConnections?.();
  if (previousDir === undefined) delete process.env.CLAUDE_WEB_DIR;
  else process.env.CLAUDE_WEB_DIR = previousDir;
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

const snapshot = () => structuredClone({
  providers: meta.providers(),
  upstreamAccounts: meta.upstreamAccounts(),
  upstreamGroups: meta.upstreamGroups(),
  gatewayGroups: meta.gatewayGroups(),
});

describe('ChannelService with real legacy services', () => {
  it('reads legacy configuration without writing or exposing account credentials', async () => {
    const first = await channels.status();
    expect(first.sources.map((source) => source.id)).toEqual(expect.arrayContaining([
      `provider:${providerId}`, 'upstream:claude', 'upstream:gemini', 'upstream:workbuddy',
    ]));
    const before = snapshot();
    await channels.status();
    await channels.status();
    expect(snapshot()).toEqual(before);
    const serialized = JSON.stringify(first);
    const stored = meta.upstreamAccounts()[0];
    for (const privateValue of ['test-key', 'test-token', 'Legacy Claude', stored.credentialMasked]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('refreshes empty upstream families without installing, starting, probing, or endpoints', async () => {
    await upstreams.remove(meta.upstreamAccounts()[0].id);
    const before = snapshot();

    await expect(channels.refresh('upstream:gemini')).rejects.toThrow('组件未运行，请先启动');
    await expect(channels.refresh('upstream:workbuddy')).rejects.toThrow('组件未运行，请先启动');
    await channels.refresh('upstream:claude');

    for (const method of ['ensure', 'install', 'start'] as const) expect(sidecars[method]).not.toHaveBeenCalled();
    expect(sidecars.stopAll).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  it.each(['gemini', 'workbuddy'] as const)('rejects a stopped installed %s component without restarting it', async (kind) => {
    const asset = assetFor(kind)!;
    const installed = path.join(sidecars.dir(kind), 'installed', asset.entry);
    await fs.mkdir(path.dirname(installed), { recursive: true });
    await fs.writeFile(installed, '');
    const binary = vi.spyOn(sidecars, 'binary').mockReturnValue(installed);

    await expect(channels.refresh(`upstream:${kind}`)).rejects.toThrow('组件未运行，请先启动');
    expect(binary).toHaveBeenCalledWith(kind);
    for (const method of ['ensure', 'install', 'start'] as const) expect(sidecars[method]).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it.each(['gemini', 'workbuddy'] as const)('refreshes a running %s component through its real adapter without lifecycle calls', async (kind) => {
    const sidecarServer = http.createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(
        request.url === '/v1/models' ? { data: [{ id: 'glm-5.2' }] }
          : request.url === '/panel/api/overview' ? { accounts: [] }
            : { models: ['gemini-3.6-flash'], items: [] },
      ));
    });
    await new Promise<void>((resolve, reject) => { sidecarServer.once('error', reject); sidecarServer.listen(0, '127.0.0.1', resolve); });
    try {
      const port = (sidecarServer.address() as { port: number }).port;
      (sidecars as any).runs.set(kind, {
        child: new EventEmitter(), port, stopping: false, restarts: 0, health: 'ok', healthFails: 0, checking: false,
      });

      await channels.refresh(`upstream:${kind}`);

      for (const method of ['ensure', 'install', 'start'] as const) expect(sidecars[method]).not.toHaveBeenCalled();
    } finally {
      sidecarServer.closeAllConnections();
      await new Promise<void>((resolve, reject) => sidecarServer.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('refreshes the existing provider through exactly one loopback model-list request', async () => {
    const before = snapshot();
    const result = await channels.refresh(`provider:${providerId}`);

    expect(requests).toEqual(['/v1/models']);
    expect(meta.providers()).toHaveLength(1);
    expect(meta.providers()[0]).toMatchObject({ id: providerId, models: ['claude-sonnet-test'] });
    expect(result.sources.filter((source) => source.id === `provider:${providerId}`)).toHaveLength(1);
    for (const key of ['upstreamAccounts', 'upstreamGroups', 'gatewayGroups'] as const) {
      expect(snapshot()[key]).toEqual(before[key]);
    }
  });
});
