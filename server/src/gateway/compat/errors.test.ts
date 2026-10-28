import { describe, expect, it } from 'vitest';
import { anthropicError, errorEnvelope, geminiError, openaiError } from './errors.js';

describe('compat error envelopes', () => {
  it('OpenAI: message / type / param / code', () => {
    expect(openaiError(401, 'bad key')).toEqual({
      error: { message: 'bad key', type: 'authentication_error', param: null, code: 401 },
    });
    expect(openaiError(501, 'no')).toMatchObject({ error: { type: 'server_error', code: 501 } });
    expect(openaiError(400, 'x', { type: 'custom', code: 'invalid', param: 'model' })).toEqual({
      error: { message: 'x', type: 'custom', param: 'model', code: 'invalid' },
    });
  });

  it('Anthropic: type:error wrapper with the derived kind', () => {
    expect(anthropicError(429, 'slow')).toEqual({
      type: 'error',
      error: { type: 'rate_limit_error', message: 'slow' },
    });
    expect(anthropicError(413, 'big')).toEqual({
      type: 'error',
      error: { type: 'request_too_large', message: 'big' },
    });
    expect(anthropicError(501, 'no')).toEqual({
      type: 'error',
      error: { type: 'api_error', message: 'no' },
    });
  });

  it('Gemini: numeric code plus the canonical status string', () => {
    expect(geminiError(429, 'slow')).toEqual({
      error: { code: 429, message: 'slow', status: 'RESOURCE_EXHAUSTED' },
    });
    expect(geminiError(501, 'no')).toEqual({
      error: { code: 501, message: 'no', status: 'UNIMPLEMENTED' },
    });
    expect(geminiError(400, 'bad')).toEqual({
      error: { code: 400, message: 'bad', status: 'INVALID_ARGUMENT' },
    });
  });

  it('dispatches by protocol (Responses uses OpenAI)', () => {
    expect(errorEnvelope('openai', 404, 'x')).toEqual(openaiError(404, 'x'));
    expect(errorEnvelope('responses', 404, 'x')).toEqual(openaiError(404, 'x'));
    expect(errorEnvelope('anthropic', 404, 'x')).toEqual(anthropicError(404, 'x'));
    expect(errorEnvelope('gemini', 404, 'x')).toEqual(geminiError(404, 'x'));
  });
});
