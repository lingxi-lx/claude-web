import { describe, expect, it } from 'vitest';
import { compatiblePath, handleCompat, type CompatContext } from './index.js';

class FakeRes {
  status = 0;
  headers: Record<string, string> = {};
  body = '';
  ended = false;
  headersSent = false;
  writeHead(status: number, headers: Record<string, string> = {}) {
    this.status = status;
    this.headers = headers;
    this.headersSent = true;
    return this;
  }
  write(chunk: string) {
    this.body += chunk;
    return true;
  }
  end(chunk?: string) {
    if (chunk !== undefined) this.body += chunk;
    this.ended = true;
    return this;
  }
}

function call(method: string, path: string, ctx: CompatContext = {}) {
  const res = new FakeRes();
  const handled = handleCompat({ method, headers: {} }, res, new URL(`http://127.0.0.1:3090${path}`), ctx);
  return { handled, res, body: res.body ? JSON.parse(res.body) : undefined };
}

describe('handleCompat', () => {
  it('serves GET /v1/models in the OpenAI shape', () => {
    const { handled, res, body } = call('GET', '/v1/models', { models: ['b', 'a'], created: 1700000000 });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(body.object).toBe('list');
    expect(body.data.map((m: { id: string }) => m.id)).toEqual(['a', 'b']);
    expect(body.data[0]).toMatchObject({ object: 'model', created: 1700000000, owned_by: 'claude-web-gateway' });
  });

  it('serves GET /v1beta/models in the Gemini shape', () => {
    const { handled, res, body } = call('GET', '/v1beta/models', { models: [{ id: 'g1', displayName: 'G1' }] });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(body).toEqual({
      models: [{ name: 'models/g1', displayName: 'G1', supportedGenerationMethods: ['generateContent', 'streamGenerateContent'] }],
    });
  });

  it('builds the model list lazily when context passes a function', () => {
    let calls = 0;
    const { body } = call('GET', '/v1/models', {
      models: () => {
        calls++;
        return ['lazy'];
      },
      created: 1,
    });
    expect(calls).toBe(1);
    expect(body.data[0].id).toBe('lazy');
  });

  it('answers CORS preflight', () => {
    const { handled, res } = call('OPTIONS', '/v1/chat/completions');
    expect(handled).toBe(true);
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toContain('x-api-key');
    expect(res.ended).toBe(true);
  });

  it('leaves the chat endpoints to the gateway routes', () => {
    expect(call('POST', '/v1/chat/completions').handled).toBe(false);
    expect(call('POST', '/v1/messages').handled).toBe(false);
  });

  it('echoes one origin, or sends no CORS at all', () => {
    const one = call('OPTIONS', '/v1/messages', { corsOrigin: 'https://app.example' });
    expect(one.res.headers['access-control-allow-origin']).toBe('https://app.example');
    expect(one.res.headers.vary).toBe('origin');
    const none = call('OPTIONS', '/v1/messages', { corsOrigin: null });
    expect(none.res.status).toBe(204);
    expect(none.res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('adds the Anthropic list fields when asked', () => {
    const { body } = call('GET', '/v1/models', { models: ['b', 'a'], created: 1700000000, anthropicFields: true });
    expect(body).toMatchObject({ has_more: false, first_id: 'a', last_id: 'b' });
    expect(body.data[0]).toMatchObject({ id: 'a', type: 'model', display_name: 'a', created_at: '2023-11-14T22:13:20.000Z' });
  });

  it('handles a /gateway/<group> prefix and leaves other paths alone', () => {
    expect(compatiblePath('/gateway/work/v1/models')).toBe('/v1/models');
    expect(compatiblePath('/v1beta/models/')).toBe('/v1beta/models');
    expect(compatiblePath('/healthz')).toBe('/healthz');

    const prefixed = call('GET', '/gateway/work/v1/models', { models: ['m'], created: 1 });
    expect(prefixed.handled).toBe(true);
    expect(prefixed.body.data[0].id).toBe('m');

    const other = call('POST', '/v1/responses');
    expect(other.handled).toBe(false);
    expect(other.res.status).toBe(0);
    expect(other.res.body).toBe('');
  });

  it('leaves OPTIONS outside the API surface alone', () => {
    const { handled, res } = call('OPTIONS', '/healthz');
    expect(handled).toBe(false);
    expect(res.status).toBe(0);
  });

  it('accepts a lowercase method', () => {
    const { handled, body } = call('get', '/v1/models', { models: ['m'], created: 1 });
    expect(handled).toBe(true);
    expect(body.object).toBe('list');
  });
});
