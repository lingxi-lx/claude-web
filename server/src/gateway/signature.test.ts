import { describe, expect, it } from 'vitest';
import {
  GEMINI_SKIP_VALIDATOR, byteEntropyRatio, decideSignature, detectSignatureProvider, isValidClaudeCaisSignature, isValidClaudeThinkingSignature,
  isValidGeminiThoughtSignature, isValidGptReasoning, isValidGrokReasoning, isValidKimiSignature, normalizeClaudeNativeSignature,
  providerFromModel, sanitizeAnthropicMessages, sanitizeGeminiContents, sanitizeResponsesInput, signatureTargetOf,
} from './signature.js';
import { caisSig, claudeDouble, claudeSig, fernet, geminiSig, grokSig, kimiSig } from './__mocks__/signatures.js';

describe('model / target → provider', () => {
  it('reads the model name, last segment first', () => {
    expect(providerFromModel('claude-sonnet-4-5')).toBe('claude');
    expect(providerFromModel('openrouter/google/gemini-2.5-pro')).toBe('gemini');
    expect(providerFromModel('gpt-5-codex')).toBe('gpt');
    expect(providerFromModel('o3-mini')).toBe('gpt');
    expect(providerFromModel('moonshot/kimi-k2')).toBe('kimi');
    expect(providerFromModel('grok-4')).toBe('grok');
    expect(providerFromModel('deepseek-chat')).toBe('unknown');
  });
  it('falls back to first-party hosts, never guesses a relay', () => {
    expect(signatureTargetOf({ type: 'anthropic', baseUrl: 'https://api.anthropic.com' }, 'my-alias')).toBe('claude');
    expect(signatureTargetOf({ type: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic' }, 'deepseek-chat')).toBe('unknown');
    expect(signatureTargetOf({ type: 'anthropic' }, 'x')).toBe('claude');
    expect(signatureTargetOf({ type: 'openai', baseUrl: 'https://api.moonshot.cn/v1' }, 'x')).toBe('kimi');
  });
});

describe('validators', () => {
  it('Claude single / double layer and CAIS', () => {
    const e = claudeSig();
    expect(isValidClaudeThinkingSignature(e)).toBe(true);
    expect(isValidClaudeThinkingSignature(claudeDouble(e))).toBe(true);
    expect(normalizeClaudeNativeSignature(claudeDouble(e))).toBe(e);
    expect(isValidClaudeThinkingSignature('claude#' + e)).toBe(true);
    expect(isValidClaudeThinkingSignature('EqQBCkgIBhABGAIiQ')).toBe(false);
    expect(isValidClaudeThinkingSignature('')).toBe(false);
    expect(isValidClaudeCaisSignature(caisSig())).toBe(true);
    expect(detectSignatureProvider(caisSig())).toBe('claude');
  });
  it('Gemini envelopes, not the sentinels', () => {
    expect(isValidGeminiThoughtSignature(geminiSig())).toBe(true);
    expect(isValidGeminiThoughtSignature(GEMINI_SKIP_VALIDATOR)).toBe(false);
    expect(detectSignatureProvider(GEMINI_SKIP_VALIDATOR)).toBe('gemini_bypass');
    expect(isValidGeminiThoughtSignature(Buffer.from('hello world').toString('base64'))).toBe(false);
  });
  it('GPT Fernet, xAI and Kimi blobs', () => {
    const f = fernet();
    expect(f.startsWith('gAAAA')).toBe(true);
    expect(isValidGptReasoning(f)).toBe(true);
    expect(isValidGptReasoning(f + '.or1')).toBe(true);
    expect(isValidGptReasoning('gAAAAnot-valid')).toBe(false);
    expect(isValidGrokReasoning(grokSig())).toBe(true);
    expect(isValidGrokReasoning(Buffer.from('a'.repeat(64)).toString('base64').replace(/=+$/, ''))).toBe(false); // low entropy
    const k = kimiSig();
    expect(isValidKimiSignature(k)).toBe(true);
    expect(isValidKimiSignature(k.slice(1))).toBe(false);
    expect(detectSignatureProvider(k)).toBe('kimi');
    expect(byteEntropyRatio(Buffer.alloc(100))).toBe(0);
  });
  it('detects each provider and nothing for junk', () => {
    expect(detectSignatureProvider(claudeSig())).toBe('claude');
    expect(detectSignatureProvider(geminiSig())).toBe('gemini');
    expect(detectSignatureProvider(fernet())).toBe('gpt');
    expect(detectSignatureProvider(grokSig())).toBe('grok');
    expect(detectSignatureProvider('')).toBe('unknown');
    expect(detectSignatureProvider('not a signature')).toBe('unknown');
    expect(detectSignatureProvider('weird#' + claudeSig())).toBe('unknown');
  });
});

describe('decideSignature', () => {
  it('keeps a matching signature (normalized) and picks the target-specific fallback otherwise', () => {
    const e = claudeSig();
    expect(decideSignature('claude', claudeDouble(e), 'claude_thinking')).toMatchObject({ action: 'preserve', normalized: e });
    expect(decideSignature('claude', geminiSig(), 'claude_thinking').action).toBe('drop_block');
    expect(decideSignature('claude', '', 'claude_thinking').action).toBe('drop_block');
    expect(decideSignature('gemini', e, 'gemini_function_call')).toMatchObject({ action: 'replace_with_gemini_bypass', replacement: GEMINI_SKIP_VALIDATOR });
    expect(decideSignature('kimi', e).action).toBe('drop_signature');
    expect(decideSignature('gpt', e, 'gpt_reasoning').action).toBe('drop_block');
    expect(decideSignature('unknown', e).action).toBe('no_compatible_replacement');
  });
});

describe('sanitizeAnthropicMessages', () => {
  const history = (sig: string) => ({
    model: 'claude-sonnet-4-5',
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'plan', signature: sig }, { type: 'tool_use', id: 't1', name: 'x', input: {} }] },
      { role: 'assistant', content: [{ type: 'redacted_thinking', data: 'abc' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
    ],
  });
  it('drops a foreign / empty-signed block going to Claude, keeps the rest', () => {
    const b = history('');
    const r = sanitizeAnthropicMessages(b, 'claude');
    expect(r.droppedBlocks).toBe(1);
    expect(b.messages[1].content).toEqual([{ type: 'tool_use', id: 't1', name: 'x', input: {} }]);
    expect(b.messages[2].content[0].type).toBe('redacted_thinking');
  });
  it('leaves a valid Claude history byte-identical', () => {
    const b = history(claudeSig());
    const before = JSON.stringify(b);
    expect(sanitizeAnthropicMessages(b, 'claude').droppedBlocks).toBe(0);
    expect(JSON.stringify(b)).toBe(before);
  });
  it('to Kimi: signatures go, the text stays; redacted thinking goes and an emptied message with it', () => {
    const b = history(claudeSig());
    const r = sanitizeAnthropicMessages(b, 'kimi');
    expect(r.droppedSignatures).toBe(1);
    expect(b.messages[1].content[0]).toEqual({ type: 'thinking', thinking: 'plan' });
    expect(b.messages).toHaveLength(3);
  });
  it('an unknown target is untouched', () => {
    const b = history('');
    const before = JSON.stringify(b);
    sanitizeAnthropicMessages(b, 'unknown');
    expect(JSON.stringify(b)).toBe(before);
  });
  it('checks signatures a client put on tool_use', () => {
    const b = { messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'n', input: {}, extra_content: { google: { thought_signature: geminiSig() } } }] }] };
    sanitizeAnthropicMessages(b, 'claude');
    expect(b.messages[0].content[0]).toEqual({ type: 'tool_use', id: 't', name: 'n', input: {} });
  });
});

describe('sanitizeGeminiContents', () => {
  it('first call gets the bypass, siblings and text lose foreign signatures, responses carry none', () => {
    const g = geminiSig();
    const body = {
      contents: [
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [
          { text: 'thinking', thought: true, thought_signature: claudeSig() },
          { functionCall: { name: 'a', args: {} } },
          { functionCall: { name: 'b', args: {} }, thoughtSignature: claudeSig() },
          { text: 'kept', thoughtSignature: g },
        ] },
        { role: 'user', parts: [{ functionResponse: { name: 'a', response: {} }, thoughtSignature: g }] },
      ],
    };
    const r = sanitizeGeminiContents(body);
    const parts = body.contents[1].parts as any[];
    expect(parts[0].thought_signature).toBeUndefined();
    expect(parts[1].thoughtSignature).toBe(GEMINI_SKIP_VALIDATOR);
    expect(parts[2].thoughtSignature).toBeUndefined();
    expect(parts[3].thoughtSignature).toBe(g);
    expect((body.contents[2].parts[0] as any).thoughtSignature).toBeUndefined();
    expect(r.replaced).toBe(1);
  });
});

describe('sanitizeResponsesInput', () => {
  it('keeps GPT reasoning for GPT, drops it for xAI', () => {
    const f = fernet();
    const mk = () => ({ input: [{ type: 'reasoning', id: 'rs_1', encrypted_content: f, summary: [] }, { type: 'function_call', call_id: 'c1', name: 'x', arguments: '{}' }] });
    const toGpt = mk();
    expect(sanitizeResponsesInput(toGpt, 'gpt').droppedBlocks).toBe(0);
    expect(toGpt.input).toHaveLength(2);
    const toGrok = mk();
    expect(sanitizeResponsesInput(toGrok, 'grok').droppedBlocks).toBe(1);
    expect(toGrok.input.map((x) => x.type)).toEqual(['function_call']);
  });
});
