import { describe, expect, it } from 'vitest';
import { SSE_HEADERS, sseDone, sseHead, sseSend } from './sse.js';

class Sink {
  status = 0;
  headers: Record<string, string> = {};
  body = '';
  ended = false;
  headersSent = false;
  flushed = false;
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
  flushHeaders() {
    this.flushed = true;
  }
}

describe('compat SSE', () => {
  it('writes the event-stream head once, extra headers win', () => {
    const res = new Sink();
    sseHead(res, { 'x-test': '1' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(SSE_HEADERS['content-type']);
    expect(res.headers['cache-control']).toBe(SSE_HEADERS['cache-control']);
    expect(res.headers['x-test']).toBe('1');
    expect(res.flushed).toBe(true);
  });

  it('sends objects, raw strings and named events', () => {
    const res = new Sink();
    sseSend(res, { ok: true });
    sseSend(res, '[DONE]');
    sseSend(res, { type: 'message_start' }, 'message_start');
    expect(res.body).toBe(
      'data: {"ok":true}\n\n' +
        'data: [DONE]\n\n' +
        'event: message_start\ndata: {"type":"message_start"}\n\n',
    );
  });

  it('closes with [DONE] by default', () => {
    const res = new Sink();
    sseDone(res);
    expect(res.body).toBe('data: [DONE]\n\n');
    expect(res.ended).toBe(true);
  });

  it('can close without a payload (Gemini)', () => {
    const res = new Sink();
    sseDone(res, null);
    expect(res.body).toBe('');
    expect(res.ended).toBe(true);
  });
});
