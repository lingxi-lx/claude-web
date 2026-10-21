import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkDraft } from './check.js';

const builtin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web/src/themes/builtin');
const read = (id: string) => ({
  json: JSON.parse(readFileSync(path.join(builtin, id, 'theme.json'), 'utf8')),
  backdrop: readFileSync(path.join(builtin, id, 'backdrop.js'), 'utf8'),
  css: readFileSync(path.join(builtin, id, 'theme.css'), 'utf8'),
});

describe('checkDraft', () => {
  it('a built-in theme passes clean', () => {
    const r = checkDraft(read('phosphor'));
    expect(r.errors).toEqual([]);
    expect(r.pack?.id).toBe('phosphor');
  });
  it('reports a missing process, low contrast, a syntax error, an import and remote CSS', () => {
    const good = read('phosphor');
    const json = JSON.parse(JSON.stringify(good.json));
    delete json.processes.git;
    json.colors['fg-3'] = json.colors.bg;
    const r = checkDraft({ json, backdrop: 'import x from "y";\nexport default { frame( }', css: 'a{background:url(http://x/a.png)}' });
    const all = r.errors.join('\n');
    expect(all).toMatch(/缺少「git」/);
    expect(all).toMatch(/fg-3 在 bg 上对比度/);
    expect(all).toMatch(/语法错误/);
    expect(all).toMatch(/不能 import/);
    expect(all).toMatch(/theme\.css/);
  });
  it('a bad pack is no pack', () => expect(checkDraft({ json: { id: 'Bad Id' } }).pack).toBeUndefined());
});
