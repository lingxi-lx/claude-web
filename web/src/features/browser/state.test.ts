import { beforeEach, describe, expect, it } from 'vitest';
import { AGENT_PARTITION, SESSION_PARTITION, USER_PARTITION, browsingPartitions, cookiesMode, newTab, openUrl, partitionsFor, setPartitionSource, tabOf, useBrowser, userPartition } from './state';

describe('keep cookies: which profile the user and Claude browse in', () => {
  it('web.browser.cookies when it is one of the three', () => {
    expect(cookiesMode({ 'web.browser.cookies': 'shared' })).toBe('shared');
    expect(cookiesMode({ 'web.browser.cookies': 'separate' })).toBe('separate');
    expect(cookiesMode({ 'web.browser.cookies': 'session' })).toBe('session');
    // the new key wins over the old one
    expect(cookiesMode({ 'web.browser.cookies': 'shared', 'web.browser.isolated': true })).toBe('shared');
  });
  it('else the old web.browser.isolated: true → separate, anything else → shared', () => {
    expect(cookiesMode({ 'web.browser.isolated': true })).toBe('separate');
    expect(cookiesMode({ 'web.browser.isolated': false })).toBe('shared');
    expect(cookiesMode({})).toBe('shared');
    expect(cookiesMode(undefined)).toBe('shared');
    expect(cookiesMode({ 'web.browser.cookies': 'nonsense', 'web.browser.isolated': true })).toBe('separate');
    expect(cookiesMode({ 'web.browser.cookies': 42 })).toBe('shared');
  });
  it('shared: both in the user profile; separate: Claude in its own; session: both in one that is not kept', () => {
    expect(partitionsFor('shared')).toEqual({ user: USER_PARTITION, agent: USER_PARTITION });
    expect(partitionsFor('separate')).toEqual({ user: USER_PARTITION, agent: AGENT_PARTITION });
    expect(partitionsFor('session')).toEqual({ user: SESSION_PARTITION, agent: SESSION_PARTITION });
    expect(SESSION_PARTITION.startsWith('persist:')).toBe(false);
    expect(USER_PARTITION).toBe('persist:cw-browser');
    expect(AGENT_PARTITION).toBe('persist:cw-agent');
  });
});

describe('a tab takes the profile of the moment its page is made', () => {
  beforeEach(() => { useBrowser.setState({ tabs: [], active: null }); setPartitionSource(() => USER_PARTITION); });

  it('new tabs follow the source; an explicit partition (an Agent tab) wins', () => {
    setPartitionSource(() => SESSION_PARTITION);
    expect(userPartition()).toBe(SESSION_PARTITION);
    expect(tabOf(newTab({ url: 'https://a.com/' }))!.partition).toBe(SESSION_PARTITION);
    expect(tabOf(newTab({ url: 'https://a.com/', agent: 's1', partition: AGENT_PARTITION }))!.partition).toBe(AGENT_PARTITION);
  });
  it('a blank tab made before the mode changed gets the new profile with its first address', () => {
    const id = newTab();
    expect(tabOf(id)!.partition).toBe(USER_PARTITION);
    setPartitionSource(() => SESSION_PARTITION);
    expect(openUrl('https://b.com/')).toBe(id);
    expect(tabOf(id)!.partition).toBe(SESSION_PARTITION);
  });
  it('what 清除浏览数据 clears: the mode\'s profiles and those open tabs still use', () => {
    newTab({ url: 'https://a.com/', partition: AGENT_PARTITION, agent: 's1' });
    expect(browsingPartitions('session').sort()).toEqual([AGENT_PARTITION, SESSION_PARTITION].sort());
    expect(browsingPartitions('shared')).toEqual([USER_PARTITION, AGENT_PARTITION]);
    useBrowser.setState({ tabs: [], active: null });
    expect(browsingPartitions('separate')).toEqual([USER_PARTITION, AGENT_PARTITION]);
    expect(browsingPartitions('shared')).toEqual([USER_PARTITION]);
  });
});
