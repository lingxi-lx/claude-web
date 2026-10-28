// The login families we already run (upstreams/): Claude accounts, Gemini 网页, WorkBuddy. Their accounts are added
// through the existing upstreams.* login flows; the driver only projects them and refreshes.
import { tr } from '../../i18n/index.js';
import type { UpstreamService } from '../../upstreams/service.js';
import type { UpstreamKind } from '../../upstreams/types.js';
import { projectFamily } from '../registry.js';
import type { SourceKind, SourceSummary } from '../types.js';
import type { ChannelDriver, DriverContext } from './types.js';

export type UpstreamDeps = Pick<UpstreamService, 'status' | 'syncFamily' | 'probe'>;

export class UpstreamFamilyDriver implements ChannelDriver {
  readonly needs = 'login' as const;
  readonly id: `upstream:${UpstreamKind}`;

  constructor(private upstreams: UpstreamDeps, readonly family: UpstreamKind, readonly kind: SourceKind, readonly name: string) {
    this.id = `upstream:${family}`;
  }

  owns(sourceId: string) { return sourceId === this.id; }

  list(ctx: DriverContext): SourceSummary[] {
    return [{ ...projectFamily(this.family, this.kind, this.name, ctx.upstream), needs: 'login' }];
  }

  async add(): Promise<string> {
    // logins open a browser / a sidecar page: the UI runs the family's own flow (upstreams.accounts.*)
    throw new Error(tr('这个来源要先登录账号：在来源详情里添加账号'));
  }

  async refresh(): Promise<void> {
    if (this.family === 'claude' || this.family === 'provider') {
      for (const account of this.upstreams.status().accounts) {
        if (account.kind !== this.family) continue;
        const result = await this.upstreams.probe(account.id);
        if (result.health !== 'ok') throw new Error(result.lastError || tr('账号健康检查失败'));
      }
      return;
    }
    await this.upstreams.syncFamily(this.family, { start: false });
  }
}
