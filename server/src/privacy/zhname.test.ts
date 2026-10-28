import { describe, expect, it } from 'vitest';
import { zhNameSpans, zhTrim } from './zhname.js';
import { compile, redactText, restoreText } from './detect.js';
import { DEFAULT_PRIVACY } from './types.js';

const names = (s: string) => zhNameSpans(s).map((x) => s.slice(x.start, x.end));

describe('Chinese names by rule (Magpie zhname)', () => {
  it.each([
    ['帮我写封信给张伟，他住在北京市朝阳区建国路88号', ['张伟']],
    ['客户陈建国反馈导出功能在他电脑上失败了。', ['陈建国']],
    ['客户张三反馈导出失败', ['张三']],
    ['联系人：赵丽颖，手机', ['赵丽颖']],
    ['提交者是欧阳娜娜，审核人是司马光。', ['欧阳娜娜', '司马光']],
    ['我叫黄晓明，是这个仓库的维护者。', ['黄晓明']],
    ['给小王发个消息，说老李明天不来了。', ['小王', '老李']],
    ['马云说过，今天很残酷。', ['马云']],
    ['请帮我回复一下孙经理的邮件', ['孙经理']],
    ['抄送给吴敏和郑浩。', ['吴敏', '郑浩']],
    ['负责人：许文强', ['许文强']],
    ['我是郭靖，想咨询一下退款的问题。', ['郭靖']],
    ['张伟先生，您好！', ['张伟']],
  ])('%s', (s, want) => {
    expect(names(s)).toEqual(want);
  });

  it.each([
    '这个函数的作用是把高度转换成像素。',
    '王国的军队在黄河边扎营。',
    '我们需要一个更高效的排序算法。',
    '请帮我修复这个 bug，张开的括号没有闭合。',
    '给张量赋值之前先检查形状。',
    '在建国路上，路边有一家店。',
    '把方法和文件名都改一下',
    '给老师发个消息',
    '和平时一样，周五发版。',
    '方总结一下：说明文档里要写清楚安装步骤。',
    'plain English text',
  ])('no name in %s', (s) => {
    expect(names(s)).toEqual([]);
  });

  it('names joined by 和 are both found', () => {
    expect(names('李娜和刘洋昨天开会讨论了项目进度。')).toEqual(['李娜', '刘洋']);
  });

  it('zhTrim cuts a model span at punctuation and titles', () => {
    const s = '王芳，她下周一';
    expect(zhTrim(s, 0, s.length)).toEqual([0, 2]);
    const t = '张伟先生';
    expect(zhTrim(t, 0, t.length)).toEqual([0, 2]);
    expect(zhTrim('Wei Zhang', 0, 9)).toEqual([0, 9]);
  });

  it('runs in the pipeline only when the 人名 type is on, and round-trips', () => {
    const s = '客户陈建国反馈导出失败';
    const off = compile(DEFAULT_PRIVACY);
    expect(redactText(s, off, 'k', new Map()).text).toBe(s);
    const on = compile({ ...DEFAULT_PRIVACY, actions: { ...DEFAULT_PRIVACY.actions, name: 'redact' } });
    const map = new Map<string, string>();
    const r = redactText(s, on, 'k', map, []);
    expect(r.text).not.toContain('陈建国');
    expect(r.text).toMatch(/\{\{NAME_[a-f0-9]{8}\}\}/);
    expect(restoreText(r.text, map)).toBe(s);
  });
});
