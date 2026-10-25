import { describe, expect, it } from 'vitest';
import { NODEGRAPH_HINT_KEY, nodegraphHintPrompt } from './nodegraph-hint.js';

describe('nodegraph hint (spec D4)', () => {
  it('off: nothing is added', () => expect(nodegraphHintPrompt(false)).toBe(''));
  it('on: the fence, the whole format, short, English', () => {
    const t = nodegraphHintPrompt(true);
    expect(t).toContain('```nodegraph');
    for (const w of ['nodes', 'edges', 'fromRow', 'options', 'marks', 'badge', 'okText', '{n}', 'normal', 'strong', 'error', 'dashed', 'flowchart']) expect(t).toContain(w);
    expect(t.length).toBeLessThan(2400);
    expect(/[\u4e00-\u9fff]/.test(t)).toBe(false);
  });
  it('the setting key', () => expect(NODEGRAPH_HINT_KEY).toBe('ui.nodegraphHint'));
});
