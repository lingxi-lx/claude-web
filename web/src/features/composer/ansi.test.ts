import { describe, expect, it } from 'vitest';
import { parseAnsi } from './ansi';

const E = '\u001b';

describe('statusLine ANSI', () => {
  it('SGR colours become styles; reset ends them', () => {
    expect(parseAnsi(`${E}[1;32mok${E}[0m done`)).toEqual([{ text: 'ok', style: { bold: true, fg: 'var(--ansi-2)' } }, { text: ' done', style: {} }]);
  });
  it('256 and true colour; bright colours', () => {
    expect(parseAnsi(`${E}[38;5;196mA${E}[38;2;1;2;3mB${E}[94mC`).map((r) => r.style.fg)).toEqual(['rgb(255,0,0)', 'rgb(1,2,3)', 'var(--ansi-12)']);
  });
  it('other escapes (cursor, OSC links / titles) are dropped, their text kept', () => {
    const ST = `${E}\\`;
    expect(parseAnsi(`${E}]8;;https://x${ST}link${E}]8;;${ST}${E}[2K end`)).toEqual([{ text: 'link end', style: {} }]);
    expect(parseAnsi('plain')).toEqual([{ text: 'plain', style: {} }]);
  });
  it('tput sgr0 (ESC ( B, then ESC [ m) resets without leaving text behind', () => {
    expect(parseAnsi(`${E}[32mgreen${E}(B${E}[m x`)).toEqual([{ text: 'green', style: { fg: 'var(--ansi-2)' } }, { text: ' x', style: {} }]);
  });
  it('colon-form colours stay one colour (38:2::R:G:B, 38:2:R:G:B, 38:5:N)', () => {
    expect(parseAnsi(`${E}[38:2::10:20:30mA${E}[38:2:1:2:0mB${E}[38:5:21mC`).map((r) => r.style.fg)).toEqual(['rgb(10,20,30)', 'rgb(1,2,0)', 'rgb(0,0,255)']);
    expect(parseAnsi(`${E}[1;38:2::0:0:30mX`)[0].style).toEqual({ bold: true, fg: 'rgb(0,0,30)' });
  });
});
