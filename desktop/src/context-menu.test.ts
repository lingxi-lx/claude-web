import { describe, expect, it } from 'vitest';
import { menuItems, type MenuParams } from './context-menu';

const flags = { canCut: false, canCopy: false, canPaste: false, canDelete: false, canSelectAll: false };
const base: MenuParams = { isEditable: false, selectionText: '', linkURL: '', mediaType: 'none', misspelledWord: '', dictionarySuggestions: [], editFlags: flags };
const at = (p: Partial<MenuParams>) => menuItems({ ...base, ...p });
const kinds = (items: ReturnType<typeof menuItems>) => items.map((i) => (i.type === 'edit' ? i.role : i.type));

describe('右键菜单', () => {
  it('nothing selected, no link, no picture: no menu', () => {
    expect(at({})).toEqual([]);
    expect(at({ selectionText: '  \n ' })).toEqual([]);
  });

  it('selected text outside an input box: copy, quote it into the input box, select all', () => {
    const items = at({ selectionText: 'hello\nworld' });
    expect(kinds(items)).toEqual(['copy', 'quote', 'separator', 'selectAll']);
    expect(items.find((i) => i.type === 'quote')).toMatchObject({ text: 'hello\nworld', label: '引用到输入框' });
  });

  it('an input box: cut / copy / paste / delete / select all, enabled as the field allows', () => {
    const items = at({ isEditable: true, editFlags: { ...flags, canPaste: true, canSelectAll: true } });
    expect(kinds(items)).toEqual(['cut', 'copy', 'paste', 'delete', 'separator', 'selectAll']);
    expect(items.filter((i) => i.type === 'edit' && i.enabled).map((i) => (i as { role: string }).role)).toEqual(['paste', 'selectAll']);
    // a selection inside an input box does not offer the quote (it is already text being written)
    expect(kinds(at({ isEditable: true, selectionText: 'x' }))).not.toContain('quote');
  });

  it('a misspelt word: the suggestions and 添加到字典 come first', () => {
    const items = at({ isEditable: true, misspelledWord: 'helo', dictionarySuggestions: ['hello', 'help'] });
    expect(kinds(items).slice(0, 4)).toEqual(['replace', 'replace', 'addWord', 'separator']);
    expect(items[0]).toMatchObject({ word: 'hello' });
    expect(items[2]).toMatchObject({ word: 'helo' });
  });

  it('a link: copy its address; javascript: links are not offered', () => {
    expect(kinds(at({ linkURL: 'https://example.com/a' }))).toEqual(['copyLink']);
    expect(at({ linkURL: 'https://example.com/a' })[0]).toMatchObject({ url: 'https://example.com/a' });
    expect(at({ linkURL: 'javascript:void(0)' })).toEqual([]);
    expect(kinds(at({ linkURL: 'https://x.y', selectionText: 'x' }))).toEqual(['copy', 'quote', 'separator', 'selectAll', 'separator', 'copyLink']);
  });

  it('a picture: copy it', () => {
    expect(kinds(at({ mediaType: 'image' }))).toEqual(['copyImage']);
    expect(at({ mediaType: 'image', hasImageContents: false })).toEqual([]);
    expect(at({ mediaType: 'video' })).toEqual([]);
  });
});
