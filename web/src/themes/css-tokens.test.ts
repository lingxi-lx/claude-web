import { describe, expect, it } from 'vitest';
import { cssTokens } from './css-tokens';

const kinds = (css: string) => cssTokens(css).filter((t) => t.type !== 'ws').map((t) => `${t.type}:${t.value}`);

describe('cssTokens (CSS Syntax 3, the parts that decide what a browser fetches)', () => {
  it('strings: escapes decoded, a line continuation dropped, an unescaped newline makes a bad string', () => {
    expect(kinds('"a\\62 c"')).toEqual(['string:abc']);
    expect(kinds("'x\\\ny'")).toEqual(['string:xy']);
    expect(kinds('"\\a http://x"')).toEqual(['string:\nhttp://x']);
    expect(kinds('"abc\ndef"')[0]).toBe('bad-string:abc');
  });
  it('an escaped quote is part of an identifier, not a quote', () => {
    expect(kinds("[title=a\\27 b]")).toEqual(['delim:[', 'ident:title', 'delim:=', "ident:a'b", 'delim:]']);
  });
  it('url( unquoted is one url token (escapes decoded); a quote inside makes it a bad url', () => {
    expect(kinds('url( \\68ttp://x/a )')).toEqual(['url:http://x/a']);
    expect(kinds("url(data:x')")[0]).toBe('bad-url:');
    expect(kinds('url("http://x")')).toEqual(['function:url', 'string:http://x', 'delim:)']);
  });
  it('functions and at-keywords by their decoded names; comments vanish', () => {
    expect(kinds('u\\72l(x)')).toEqual(['url:x']);
    expect(kinds('@\\69mport "a";')).toEqual(['at:import', 'string:a', 'delim:;']);
    expect(kinds('image-set(/* c */"a" 1x)')).toEqual(['function:image-set', 'string:a', 'number:1x', 'delim:)']);
  });
});
