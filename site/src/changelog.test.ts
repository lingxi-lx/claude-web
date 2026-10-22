import { describe, expect, it } from 'vitest';
import { changelogBody } from './changelog';

const SAMPLE = [
  '# Changelog',
  '',
  '**English** · [简体中文](CHANGELOG.zh-CN.md)',
  '',
  'Installers are on the [Releases](https://github.com/ypyik0669/claude-web/releases) page.',
  '',
  '## [0.3.1] — 2026-10-21',
  '',
  'See [the notes](docs/notes/gateway.md) and [above](#fixed).',
].join('\n');

describe('changelogBody', () => {
  it('drops the title and the language line (the page has its own)', () => {
    const out = changelogBody(SAMPLE);
    expect(out).not.toMatch(/^# Changelog/m);
    expect(out).not.toMatch(/CHANGELOG\.zh-CN\.md/);
    expect(out).toMatch(/^## \[0\.3\.1\]/m);
  });
  it('points repo-relative links at GitHub and leaves the others', () => {
    const out = changelogBody(SAMPLE);
    expect(out).toContain('(https://github.com/ypyik0669/claude-web/blob/main/docs/notes/gateway.md)');
    expect(out).toContain('(https://github.com/ypyik0669/claude-web/releases)');
    expect(out).toContain('(#fixed)');
  });
  it('drops the Chinese file\'s language line too', () => {
    expect(changelogBody('# 更新日志\n\n**简体中文** · [English](CHANGELOG.md)\n\n## [0.3.1]')).toBe('\n\n## [0.3.1]');
  });
});
