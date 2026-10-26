import { tr } from '../i18n/index.js';
import type { ProviderService } from '../providers/service.js';
import type { UpstreamService } from '../upstreams/service.js';
import { projectChannels } from './registry.js';
import type { ChannelStatus } from './types.js';

export interface ChannelDeps {
  providers: Pick<ProviderService, 'list' | 'refreshModels'>;
  upstreams: Pick<UpstreamService, 'status' | 'syncFamily' | 'probe'>;
}

export class ChannelService {
  constructor(private deps: ChannelDeps) {}

  async status(): Promise<ChannelStatus> {
    return projectChannels({ providers: this.deps.providers.list(), upstream: this.deps.upstreams.status() });
  }

  async refresh(id: string): Promise<ChannelStatus> {
    const provider = /^provider:([A-Za-z0-9_-]+)$/.exec(id);
    if (provider) {
      const providerId = provider[1];
      if (!this.deps.providers.list().some((item) => item.id === providerId)) throw new Error(tr('没有这个来源'));
      const [result] = await this.deps.providers.refreshModels([providerId]);
      if (!result.ok) throw new Error(result.error);
    } else if (id === 'upstream:claude') {
      for (const account of this.deps.upstreams.status().accounts) {
        if (account.kind !== 'claude') continue;
        const result = await this.deps.upstreams.probe(account.id);
        if (result.health !== 'ok') throw new Error(result.lastError || tr('账号健康检查失败'));
      }
    } else if (/^upstream:[A-Za-z0-9_-]+$/.test(id)) {
      if (id === 'upstream:gemini' || id === 'upstream:workbuddy') {
        await this.deps.upstreams.syncFamily(id === 'upstream:gemini' ? 'gemini' : 'workbuddy', { start: false });
      } else {
        throw new Error(tr('没有这个来源'));
      }
    } else {
      throw new Error(tr('来源地址无效'));
    }
    return this.status();
  }
}
