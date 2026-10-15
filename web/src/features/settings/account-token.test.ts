import { describe, expect, it } from 'vitest';
import { tokenIn } from './account-token';

const tok = 'sk-ant-oat01-' + 'Q'.repeat(30) + 'Zz9_-' + 'W'.repeat(40);

describe('the token claude setup-token prints, read off the terminal', () => {
  it('on one line, with colours and padding around it', () => {
    expect(tokenIn(`\x1b[32m✓\x1b[0m Long-lived authentication token created successfully!\r\n\r\nYour OAuth token (valid for 1 year):\r\n\r\n\x1b[1m${tok}\x1b[22m    \r\n\r\nStore this token securely.\r\n`)).toBe(tok);
  });
  it('wrapped over two lines (a narrow terminal), cmd.exe padding the lines with a space (a real capture)', () => {
    const raw = `\u001b[?25hecho x & echo ${tok.slice(0, 50)} & echo ${tok.slice(50)} & echo Store this token securely.\r\n\u001b[?25lYour OAuth token: \r\n${tok.slice(0, 50)} \r\n${tok.slice(50)} \r\nStore this token securely.\u001b[12;1HC:/x>`;
    expect(tokenIn(raw)).toBe(tok);
  });
  it('rows a Windows console moved to with the cursor instead of a line break', () => {
    expect(tokenIn(`Your token:\u001b[5;1H${tok.slice(0, 60)}\u001b[6;1H${tok.slice(60)}\u001b[7;1HStore this token securely.\u001b[8;1H`)).toBe(tok);
  });
  it('not yet: a line still arriving, no token at all, a token cut short', () => {
    expect(tokenIn(`Your token:\r\n${tok.slice(0, 70)}`)).toBeNull();
    expect(tokenIn('Opening browser to sign in…\r\n')).toBeNull();
    expect(tokenIn('sk-ant-oat01-short\r\n')).toBeNull();
  });
});
