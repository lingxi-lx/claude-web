// Hub dispatch for `channels.*` requests (kept out of hub.ts).
import { tr } from '../i18n/index.js';
import type { ChannelService } from './service.js';
import type { ChannelRequest, ChannelStatus } from './types.js';

export const isChannelRequest = (req: { kind: string }): req is ChannelRequest =>
  req.kind === 'channels.status' || req.kind === 'channels.refresh';

export async function handleChannelRequest(
  svc: Pick<ChannelService, 'status' | 'refresh'>,
  req: ChannelRequest,
): Promise<ChannelStatus> {
  if (req.kind === 'channels.status') return svc.status();
  if (req.kind !== 'channels.refresh') throw new Error(`unknown channel request ${(req as { kind: string }).kind}`);
  if (typeof req.id !== 'string' || !req.id) throw new Error(tr('缺少来源'));
  return svc.refresh(req.id);
}
