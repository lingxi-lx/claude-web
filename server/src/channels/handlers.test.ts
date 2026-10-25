import { describe, expect, it, vi } from 'vitest';
import type { ChannelRequest, ChannelStatus } from './types';
import { handleChannelRequest, isChannelRequest } from './handlers';

function fixture() {
  const status: ChannelStatus = { sources: [], warnings: [] };
  const svc = {
    status: vi.fn(async () => status),
    refresh: vi.fn(async () => status),
  };
  return { svc, status };
}

describe('isChannelRequest', () => {
  it.each(['channels.status', 'channels.refresh'])('recognizes %s', (kind) => {
    expect(isChannelRequest({ kind })).toBe(true);
  });

  it.each(['upstreams.status', 'gateway.status', 'channels.unknown', ''])('rejects %s', (kind) => {
    expect(isChannelRequest({ kind })).toBe(false);
  });
});

describe('handleChannelRequest', () => {
  it('dispatches status once', async () => {
    const { svc, status } = fixture();

    await expect(handleChannelRequest(svc, { kind: 'channels.status' })).resolves.toBe(status);
    expect(svc.status).toHaveBeenCalledOnce();
    expect(svc.refresh).not.toHaveBeenCalled();
  });

  it('dispatches refresh with the exact source id', async () => {
    const { svc, status } = fixture();

    await expect(handleChannelRequest(svc, { kind: 'channels.refresh', id: 'provider:p1' })).resolves.toBe(status);
    expect(svc.refresh).toHaveBeenCalledExactlyOnceWith('provider:p1');
    expect(svc.status).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 42, '', {}])('rejects invalid refresh id %j without refreshing', async (id) => {
    const { svc } = fixture();

    await expect(handleChannelRequest(svc, { kind: 'channels.refresh', id } as ChannelRequest)).rejects.toThrow('缺少来源');
    expect(svc.refresh).not.toHaveBeenCalled();
    expect(svc.status).not.toHaveBeenCalled();
  });

  it('rejects an unknown runtime kind clearly', async () => {
    const { svc } = fixture();

    await expect(handleChannelRequest(svc, { kind: 'channels.unknown' } as unknown as ChannelRequest)).rejects.toThrow('unknown channel request channels.unknown');
    expect(svc.status).not.toHaveBeenCalled();
    expect(svc.refresh).not.toHaveBeenCalled();
  });
});
