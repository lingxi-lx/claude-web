import { describe, expect, it } from 'vitest';
import { checkGeminiCookie, parseGeminiInput } from './gemini-cookie';

const FULL = 'SID=a; HSID=b; SSID=c; APISID=d; SAPISID=e; __Secure-1PSID=f; __Secure-1PSIDTS=g';

describe('parseGeminiInput', () => {
  it('takes one account per cookie line', () => {
    expect(parseGeminiInput(`${FULL}\n\nSID=x; SAPISID=y\n`)).toEqual([FULL, 'SID=x; SAPISID=y']);
  });

  it('keeps only the cookie line of a pasted Request Headers block', () => {
    const block = [':authority: gemini.google.com', 'accept: */*', 'accept-language: zh-CN,zh;q=0.9', `cookie: ${FULL}`, 'user-agent: Mozilla/5.0'].join('\n');
    expect(parseGeminiInput(block)).toEqual([FULL]);
    expect(parseGeminiInput(`Cookie:${FULL}`)).toEqual([FULL]);
  });

  it('takes the cookie value from the line under a bare cookie: name, and ignores the other values', () => {
    const block = [':authority:', 'gemini.google.com', 'accept:', '*/*', 'cookie:', FULL, 'user-agent:', 'Mozilla/5.0'].join('\n');
    expect(parseGeminiInput(block)).toEqual([FULL]);
  });

  it('reads a cookie-export JSON array as one account', () => {
    expect(parseGeminiInput(JSON.stringify([{ name: 'SID', value: 'a', domain: '.google.com' }, { name: 'SAPISID', value: 'e' }]))).toEqual(['SID=a; SAPISID=e']);
    expect(parseGeminiInput(JSON.stringify({ cookie: FULL }))).toEqual([FULL]);
  });

  it('is empty for nothing', () => {
    expect(parseGeminiInput('  \n ')).toEqual([]);
  });
});

describe('checkGeminiCookie', () => {
  it('passes a full copy', () => {
    expect(checkGeminiCookie(FULL)).toEqual({ missing: [], onlyGeminiRow: false, noSession: false });
  });

  it('spots a copy of the gemini.google.com row alone', () => {
    const r = checkGeminiCookie('__Secure-1PSID=f; __Secure-1PSIDTS=g; NID=z');
    expect(r.missing).toEqual(['SID', 'HSID', 'SSID', 'APISID', 'SAPISID']);
    expect(r.onlyGeminiRow).toBe(true);
  });

  it('counts an empty value as missing', () => {
    const r = checkGeminiCookie(FULL.replace('SAPISID=e', 'SAPISID='));
    expect(r.missing).toEqual(['SAPISID']);
    // the .google.com ones were copied (one is just empty): not a gemini-row-only copy
    expect(r.onlyGeminiRow).toBe(false);
  });

  it('warns when the session cookie is absent', () => {
    expect(checkGeminiCookie(FULL.replace('; __Secure-1PSIDTS=g', '')).noSession).toBe(true);
  });
});
