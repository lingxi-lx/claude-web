import { describe, expect, it } from 'vitest';
import { askQuestions, assemble, askKey, answerOf, EMPTY_DRAFT, OTHER, pick, skip, skippedAnswer, step, type AskQ } from './ask-card';

const single: AskQ = { question: '用哪个库？', header: '库', options: [{ label: 'zod' }, { label: 'yup', description: '老一点' }], multiSelect: false };
const multi: AskQ = { question: '要哪些检查？', options: [{ label: 'lint' }, { label: 'test' }, { label: 'build' }], multiSelect: true };

describe('askQuestions', () => {
  it('keeps well-formed questions, drops junk, defaults multiSelect to false', () => {
    const qs = askQuestions({ questions: [{ question: 'A?', options: [{ label: 'x', preview: 'p' }, { nope: 1 }] }, { header: 'no question' }, null] });
    expect(qs).toEqual([{ question: 'A?', header: undefined, options: [{ label: 'x', description: undefined, preview: 'p' }], multiSelect: false }]);
    expect(askQuestions(undefined)).toEqual([]);
  });
});

describe('pick / answerOf', () => {
  it('single choice: one label; picking another replaces it; 其它 clears the pick', () => {
    let d = pick(single, EMPTY_DRAFT, 'zod');
    d = pick(single, d, 'yup');
    expect(answerOf(single, d)).toBe('yup');
    d = pick(single, d, OTHER);
    expect(d.picked).toEqual([]);
    expect(answerOf(single, d)).toBeNull(); // 其它 on, nothing typed yet
    expect(answerOf(single, { ...d, other: '  valibot ' })).toBe('valibot');
  });
  it('multi choice: toggles, joined in option order with ", ", 其它 last', () => {
    let d = pick(multi, EMPTY_DRAFT, 'build');
    d = pick(multi, d, 'lint');
    d = pick(multi, d, OTHER);
    expect(answerOf(multi, { ...d, other: 'e2e' })).toBe('lint, build, e2e');
    d = pick(multi, d, 'lint');
    expect(answerOf(multi, { ...d, other: 'e2e' })).toBe('build, e2e');
  });
  it('nothing picked → null; skipped → 「（用户跳过）」', () => {
    expect(answerOf(single, EMPTY_DRAFT)).toBeNull();
    expect(answerOf(single, undefined)).toBeNull();
    expect(answerOf(single, skip(EMPTY_DRAFT))).toBe(skippedAnswer());
  });
  it('picking after a skip un-skips', () => {
    expect(pick(single, skip(EMPTY_DRAFT), 'zod').skipped).toBe(false);
  });
});

describe('assemble', () => {
  it('every question answered → allow with question → answer', () => {
    expect(assemble([single, multi], [pick(single, EMPTY_DRAFT, 'zod'), pick(multi, EMPTY_DRAFT, 'test')])).toEqual({ kind: 'allow', answers: { '用哪个库？': 'zod', '要哪些检查？': 'test' } });
  });
  it('one skipped, one answered → allow, the skipped one says so', () => {
    const r = assemble([single, multi], [skip(EMPTY_DRAFT), pick(multi, EMPTY_DRAFT, 'lint')]);
    expect(r).toEqual({ kind: 'allow', answers: { '用哪个库？': skippedAnswer(), '要哪些检查？': 'lint' } });
  });
  it('all skipped → deny (the old 跳过)', () => {
    expect(assemble([single, multi], [skip(EMPTY_DRAFT), skip(EMPTY_DRAFT)])).toEqual({ kind: 'deny' });
  });
  it('an unanswered question → incomplete at the first one', () => {
    expect(assemble([single, multi], [pick(single, EMPTY_DRAFT, 'zod'), undefined])).toEqual({ kind: 'incomplete', first: 1 });
  });
});

describe('step (下一题 / 提交)', () => {
  it('stays on an unanswered page, goes to the next one when answered, sends on the last', () => {
    const qs = [single, multi];
    expect(step(qs, [], 0)).toEqual({ t: 'stay' });
    expect(step(qs, [pick(single, EMPTY_DRAFT, 'zod')], 0)).toEqual({ t: 'goto', index: 1 });
    expect(step(qs, [pick(single, EMPTY_DRAFT, 'zod'), pick(multi, EMPTY_DRAFT, 'lint')], 1)).toEqual({ t: 'send', result: { kind: 'allow', answers: { '用哪个库？': 'zod', '要哪些检查？': 'lint' } } });
  });
  it('the last page answered but an earlier one left open (paged back and cleared) → back to it', () => {
    expect(step([single, multi], [{ ...EMPTY_DRAFT, otherOn: true }, pick(multi, EMPTY_DRAFT, 'lint')], 1)).toEqual({ t: 'goto', index: 0 });
  });
  it('all skipped on the last page → send deny', () => {
    expect(step([single], [skip(EMPTY_DRAFT)], 0)).toEqual({ t: 'send', result: { kind: 'deny' } });
  });
});

describe('askKey', () => {
  it('↑↓ move, 1–9 pick (index = option count is 其它), Enter / Ctrl+Enter next', () => {
    expect(askKey({ key: 'ArrowDown' }, 2)).toEqual({ t: 'move', by: 1 });
    expect(askKey({ key: 'ArrowUp' }, 2)).toEqual({ t: 'move', by: -1 });
    expect(askKey({ key: '1' }, 2)).toEqual({ t: 'pick', index: 0 });
    expect(askKey({ key: '3' }, 2)).toEqual({ t: 'pick', index: 2 });
    expect(askKey({ key: '4' }, 2)).toBeNull();
    expect(askKey({ key: 'Enter' }, 2)).toEqual({ t: 'next' });
    expect(askKey({ key: 'Enter', ctrl: true }, 2)).toEqual({ t: 'next' });
    expect(askKey({ key: 'Enter', shift: true }, 2)).toBeNull();
  });
  it('nothing while the IME composes; in the 其它 box only Enter counts', () => {
    expect(askKey({ key: 'Enter', composing: true }, 2)).toBeNull();
    expect(askKey({ key: '1', inText: true }, 2)).toBeNull();
    expect(askKey({ key: 'ArrowDown', inText: true }, 2)).toBeNull();
    expect(askKey({ key: 'Enter', inText: true }, 2)).toEqual({ t: 'next' });
  });
});
