import { describe, expect, it } from 'vitest';
import { cleanUserAgent } from './user-agent';
import { isSignInPage, userAgentFor } from './sign-in-ua';
import { jpegSize } from './jpeg-size';

describe('the built-in browser as web sites see it', () => {
  it('the user agent is the Chrome it is built from: no app name, no Electron', () => {
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
    expect(cleanUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) claude-web/0.2.0 Chrome/152.0.0.0 Electron/44.0.0 Safari/537.36')).toBe(chrome);
    // a product name with a space in it, and nothing between the engine and Chrome at all
    expect(cleanUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Claude Web/0.2.0 Chrome/152.0.0.0 Electron/44.0.0 Safari/537.36')).toBe(chrome);
    expect(cleanUserAgent(chrome)).toBe(chrome);
    expect(cleanUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) claude-web/0.2.0 Chrome/152.0.0.0 Electron/44.1.2 Safari/537.36')).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36');
    // something that is not Electron's shape is left as it is
    expect(cleanUserAgent('curl/8.0')).toBe('curl/8.0');
  });

  it("Google's sign-in gets Electron's own user agent (it rejects the cleaned one), every other page the cleaned one", () => {
    const honest = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) claude-web/0.3.1 Chrome/152.0.7977.65 Electron/44.1.1 Safari/537.36';
    const clean = cleanUserAgent(honest);
    for (const u of [
      'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fmyaccount.google.com%2F',
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fexample.com',
      'https://ACCOUNTS.GOOGLE.COM/ServiceLogin',
      'https://accounts.youtube.com/accounts/SetSID',
    ]) expect(userAgentFor(u, honest, clean), u).toBe(honest);
    for (const u of [
      'https://www.google.com/search?q=x', // search keeps the cleaned one (user-agent.ts)
      'https://gemini.google.com/app',
      'https://myaccount.google.com/',
      'https://example.com/?next=https://accounts.google.com/',
      'https://accounts.google.com.example.com/',
      'http://accounts.google.com/', // not the real one
      'about:blank',
      'not a url',
    ]) expect(userAgentFor(u, honest, clean), u).toBe(clean);
    expect(isSignInPage('https://accounts.google.com/v3/signin/rejected')).toBe(true);
  });
});

describe('a picture of a page knows its own size', () => {
  /** SOI, an APP0 segment, a quantisation table, then the frame header (baseline or progressive). */
  const jpeg = (sof: number, width: number, height: number) => Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xdb, 0x00, 0x04, 0x00, 0x01,
    0xff, sof, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);

  it('reads width and height from the frame header', () => {
    expect(jpegSize(jpeg(0xc0, 1280, 843))).toEqual({ width: 1280, height: 843 });
    expect(jpegSize(jpeg(0xc2, 640, 2000))).toEqual({ width: 640, height: 2000 });
  });

  it('a Huffman table (0xC4) is not a frame, and what is not a JPEG has no size', () => {
    const withDht = Uint8Array.from([0xff, 0xd8, 0xff, 0xc4, 0x00, 0x05, 0x00, 0x01, 0x02, ...jpeg(0xc0, 300, 200).slice(2)]);
    expect(jpegSize(withDht)).toEqual({ width: 300, height: 200 });
    expect(jpegSize(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(jpegSize(new Uint8Array(0))).toBeNull();
    expect(jpegSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBeNull();
  });
});
