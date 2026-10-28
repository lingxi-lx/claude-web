import { describe, expect, it } from 'vitest';
import { BoundedLru, ReplayCaches, prepareReasoning } from './replay-cache.js';
import { claudeSig, fernet, geminiSig } from './__mocks__/signatures.js';

describe('BoundedLru', () => {
  it('evicts the least recently used past the entry cap', () => {
    const l = new BoundedLru<string, number>({ maxEntries: 2 });
    l.set('a', 1); l.set('b', 2);
    expect(l.get('a')).toBe(1); // a is now newest
    l.set('c', 3);
    expect(l.get('b')).toBeUndefined();
    expect(l.get('a')).toBe(1);
    expect(l.size).toBe(2);
  });
  it('honours the byte cap and refuses a value bigger than all of it', () => {
    const l = new BoundedLru<string, string>({ maxEntries: 100, maxBytes: 10, sizeOf: (s) => s.length });
    l.set('a', '12345'); l.set('b', '12345'); l.set('c', '1');
    expect(l.has('a')).toBe(false);
    expect(l.totalBytes).toBe(6);
    l.set('huge', 'x'.repeat(11));
    expect(l.has('huge')).toBe(false);
  });
  it('expires by TTL', () => {
    let t = 0;
    const l = new BoundedLru<string, number>({ maxEntries: 10, ttlMs: 100, now: () => t });
    l.set('a', 1);
    t = 50; expect(l.get('a')).toBe(1);
    t = 151; expect(l.get('a')).toBeUndefined();
  });
});

/** Feed an Anthropic SSE answer the way the sniffer does. */
function recordAnthropic(c: ReplayCaches, session: string, thinking: string, sig: string, toolId: string) {
  const rec = c.recorder('anthropic', session);
  rec.feed({ type: 'message_start', message: { id: 'm' } });
  rec.feed({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
  rec.feed({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: thinking.slice(0, 3) } });
  rec.feed({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: thinking.slice(3) } });
  rec.feed({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: sig } });
  rec.feed({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: toolId, name: 'Read', input: {} } });
  rec.finish();
}

describe('Anthropic thinking replay', () => {
  it('puts back a thinking block the client dropped, for a Claude target that thinks', () => {
    const c = new ReplayCaches();
    const sig = claudeSig();
    recordAnthropic(c, 's1', 'let me read', sig, 'toolu_1');
    const body: any = {
      thinking: { type: 'enabled', budget_tokens: 1024 },
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'x' }] },
      ],
    };
    const out = prepareReasoning('anthropic', body, { target: 'claude', session: 's1', caches: c });
    expect(out.changed).toBe(true);
    expect(body.messages[1].content[0]).toEqual({ type: 'thinking', thinking: 'let me read', signature: sig });
    // another conversation never sees it
    const other: any = structuredClone({ ...body, messages: [body.messages[0], { role: 'assistant', content: [body.messages[1].content[1]] }] });
    expect(prepareReasoning('anthropic', other, { target: 'claude', session: 's2', caches: c }).changed).toBe(false);
  });
  it('restores a lost signature by the thinking text', () => {
    const c = new ReplayCaches();
    const sig = claudeSig();
    recordAnthropic(c, 's1', 'abcdef', sig, 'toolu_9');
    const body: any = { messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'abcdef', signature: '' }, { type: 'text', text: 'hi' }] }] };
    const out = prepareReasoning('anthropic', body, { target: 'claude', session: 'elsewhere', caches: c });
    expect(out.restore.restoredSignatures).toBe(1);
    expect(body.messages[0].content[0].signature).toBe(sig);
  });
  it('a cached block another provider would refuse is not restored', () => {
    const c = new ReplayCaches();
    recordAnthropic(c, 's1', 'plan', claudeSig(), 'toolu_2');
    const body: any = { thinking: { type: 'enabled' }, messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_2', name: 'Read', input: {} }] }] };
    expect(prepareReasoning('anthropic', body, { target: 'gpt', session: 's1', caches: c }).changed).toBe(false);
  });
  it('a non-stream answer records the same way', () => {
    const c = new ReplayCaches();
    const sig = claudeSig();
    const rec = c.recorder('anthropic', 's');
    rec.feed({ type: 'message', content: [{ type: 'thinking', thinking: 't', signature: sig }, { type: 'text', text: 'answer' }] });
    rec.finish();
    expect(c.thinking.lookup('s', [{ type: 'text', text: 'answer' }])?.[0].signature).toBe(sig);
  });
});

describe('Responses reasoning replay', () => {
  it('re-inserts an encrypted reasoning item before the call it preceded', () => {
    const c = new ReplayCaches();
    const enc = fernet();
    const rec = c.recorder('responses', 's');
    rec.feed({ type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs_1', encrypted_content: enc, summary: [] } });
    rec.feed({ type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', call_id: 'call_1', name: 'shell', arguments: '{}' } });
    rec.finish();
    const body: any = { input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'go' }] },
      { type: 'function_call', call_id: 'call_1', name: 'shell', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'ok' },
    ] };
    expect(prepareReasoning('responses', body, { target: 'gpt', session: 's', caches: c }).changed).toBe(true);
    expect(body.input.map((x: any) => x.type)).toEqual(['message', 'reasoning', 'function_call', 'function_call_output']);
    // already there → not duplicated
    expect(prepareReasoning('responses', body, { target: 'gpt', session: 's', caches: c }).changed).toBe(false);
  });
});

describe('Gemini signature cache', () => {
  it('remembers a streamed thought by its joined text', () => {
    const c = new ReplayCaches();
    const g = geminiSig();
    const rec = c.recorder('gemini', 's');
    rec.feed({ candidates: [{ content: { parts: [{ text: 'thin', thought: true }] } }] });
    rec.feed({ candidates: [{ content: { parts: [{ text: 'king', thought: true, thoughtSignature: g }] } }] });
    rec.finish();
    expect(c.signatures.lookup('gemini', 'thinking')).toBe(g);
    expect(c.signatures.lookup('claude', 'thinking')).toBeUndefined();
  });
});
