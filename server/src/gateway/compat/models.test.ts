import { describe, expect, it } from 'vitest';
import { buildGeminiModelList, buildOpenAIModelList, normalizeModels } from './models.js';

describe('compat model lists', () => {
  it('normalizes ids: trims, drops blanks / duplicates, keeps the first descriptor', () => {
    expect(normalizeModels([' b ', '', 'a', 'a', { id: ' b ', ownedBy: 'x' }, { id: 'c' }])).toEqual([
      { id: 'b' },
      { id: 'a' },
      { id: 'c' },
    ]);
  });

  it('builds the OpenAI /v1/models list sorted by id, with capability fields', () => {
    const body = buildOpenAIModelList(
      ['zeta', { id: 'alpha', created: 11, ownedBy: 'me', capabilities: { vision: true, contextWindow: 200000 } }],
      { created: 42, ownedBy: 'default-owner' },
    );
    expect(body.object).toBe('list');
    expect(body.data).toEqual([
      { id: 'alpha', object: 'model', created: 11, owned_by: 'me', capabilities: { vision: true, contextWindow: 200000 } },
      { id: 'zeta', object: 'model', created: 42, owned_by: 'default-owner' },
    ]);
  });

  it('fills the OpenAI defaults', () => {
    const body = buildOpenAIModelList(['m'], { created: 7 });
    expect(body.data[0]).toMatchObject({ object: 'model', created: 7, owned_by: 'claude-web-gateway' });
  });

  it('builds the Gemini /v1beta/models list', () => {
    const body = buildGeminiModelList([
      { id: 'gemini-3-pro', displayName: 'Gemini 3 Pro', capabilities: { contextWindow: 1000000, maxOutputTokens: 64000 } },
      'gemini-2.5-flash',
    ]);
    expect(body).toEqual({
      models: [
        { name: 'models/gemini-2.5-flash', displayName: 'gemini-2.5-flash', supportedGenerationMethods: ['generateContent', 'streamGenerateContent'] },
        {
          name: 'models/gemini-3-pro',
          displayName: 'Gemini 3 Pro',
          inputTokenLimit: 1000000,
          outputTokenLimit: 64000,
          supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
        },
      ],
    });
  });

  it('handles an absent list', () => {
    expect(buildOpenAIModelList(undefined, { created: 1 }).data).toEqual([]);
    expect(buildGeminiModelList(undefined).models).toEqual([]);
  });
});
