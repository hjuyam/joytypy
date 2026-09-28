import { describe, it, expect } from 'vitest';
import { buildPassages, buildSequence } from '../pinyin-engine.js';
import { PracticeSession } from '../practice.js';

function finishChar(session) {
  for (const letter of session.getCurrentEntry().spelling) session.input(letter);
}

describe('整句跟随', () => {
  it('保留标点和诗句换行，并按完整句切换', () => {
    const text = '春眠不觉晓，\n处处闻啼鸟。\n夜来风雨声，\n花落知多少。';
    const passages = buildPassages(text);
    expect(passages).toEqual([
      { start: 0, end: 10, text: '春眠不觉晓，\n处处闻啼鸟。' },
      { start: 10, end: 20, text: '夜来风雨声，\n花落知多少。' },
    ]);
  });

  it('无句号长文也按长度分段，不丢字', () => {
    const passages = buildPassages('妈'.repeat(90));
    expect(passages.map(p => p.text).join('')).toBe('妈'.repeat(90));
    expect(passages.every(p => p.end - p.start <= 36)).toBe(true);
    expect(passages.at(-1).end).toBe(90);
  });

  it('行内拼音标注不进入句子展示，字位置与练习序列对齐', () => {
    const result = buildSequence('银(yin)行(hang)，\n行(xing)走。');
    expect(result.passages).toEqual([{ start: 0, end: 4, text: '银行，\n行走。' }]);
    expect(result.entries.map(e => e.char)).toEqual(['银', '行', '行', '走']);
  });

  it('敲到下一句时当前句随进度切换', () => {
    const session = new PracticeSession();
    session.load('妈妈，\n妈妈。\n妈妈。');
    expect(session.getCurrentPassage().text).toBe('妈妈，\n妈妈。');
    for (let i = 0; i < 4; i++) finishChar(session);
    expect(session.getCurrentPassage().text).toBe('妈妈。');
  });
});
