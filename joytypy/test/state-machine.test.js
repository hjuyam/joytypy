// 练习状态机测试：正确前进、错误停留、SKIP_CHAR、整篇完成、LOADING_FAILED

import { describe, it, expect } from 'vitest';
import { PracticeSession, PracticeState, PracticeMode } from '../practice.js';

describe('状态机 - 正常流程', () => {
  it('load 后应进入 PLAYING（无多音字）', () => {
    const s = new PracticeSession();
    const r = s.load('妈');
    expect(r.state).toBe(PracticeState.PLAYING);
    expect(s.state).toBe(PracticeState.PLAYING);
  });

  it('逐字母正确输入应前进', () => {
    const s = new PracticeSession();
    s.load('妈');
    expect(s.getCurrentTargetLetter()).toBe('m');
    const r1 = s.input('m');
    expect(r1.correct).toBe(true);
    expect(r1.charComplete).toBe(false);
    expect(s.getCurrentTargetLetter()).toBe('a');
    const r2 = s.input('a');
    expect(r2.correct).toBe(true);
    expect(r2.charComplete).toBe(true);
  });

  it('整篇完成应进入 COMPLETE/REWARD', () => {
    const s = new PracticeSession();
    s.load('妈');
    s.input('m');
    const r = s.input('a');
    expect(r.finished).toBe(true);
    expect(s.state).toBe(PracticeState.REWARD);
    const stats = s.getStats();
    expect(stats.stars).toBe(1);
    expect(stats.accuracy).toBe(100);
  });
});

describe('状态机 - 错误停留', () => {
  it('错误输入不应前进 typedIndex', () => {
    const s = new PracticeSession();
    s.load('妈');
    const r = s.input('x');
    expect(r.correct).toBe(false);
    expect(s.getCurrentEntry().typedIndex).toBe(0);
    expect(s.getCurrentTargetLetter()).toBe('m'); // 仍是 m
  });

  it('错误应清零连击', () => {
    const s = new PracticeSession();
    s.load('妈你好他山');
    // 连对 3 个
    for (let i = 0; i < 3; i++) {
      const e = s.getCurrentEntry();
      while (e.typedIndex < e.spelling.length) s.input(e.spelling[e.typedIndex]);
    }
    expect(s.combo).toBe(3);
    // 错一次
    s.input('z');
    expect(s.combo).toBe(0);
  });

  it('错误累积 3 次应触发提示', () => {
    const s = new PracticeSession();
    s.load('妈');
    s.input('x');
    s.input('x');
    const r3 = s.input('x');
    expect(r3.hint).toBe(true);
    expect(r3.target).toBe('m');
  });
});

describe('状态机 - 连击奖励', () => {
  it('连对 5 字应获得小红花', () => {
    const s = new PracticeSession({ comboThreshold: 5 });
    s.load('妈你好他山');
    let gotFlower = false;
    for (let i = 0; i < 5; i++) {
      const e = s.getCurrentEntry();
      while (e.typedIndex < e.spelling.length) {
        const r = s.input(e.spelling[e.typedIndex]);
        if (r?.reward?.flower) gotFlower = true;
      }
    }
    expect(gotFlower).toBe(true);
    expect(s.flowers).toBe(1);
  });

  it('连对 10 字应获得 2 朵小红花', () => {
    const s = new PracticeSession({ comboThreshold: 5 });
    s.load('妈你好他山水火土木天');
    for (let i = 0; i < 10; i++) {
      const e = s.getCurrentEntry();
      while (e.typedIndex < e.spelling.length) {
        const r = s.input(e.spelling[e.typedIndex]);
        if (!r) break;
      }
    }
    expect(s.flowers).toBe(2);
  });
});

describe('状态机 - 多音字校对', () => {
  it('含多音字应进入 POLY_CHECK', () => {
    const s = new PracticeSession();
    const r = s.load('银行');
    expect(r.state).toBe(PracticeState.POLY_CHECK);
    expect(r.polyChars.length).toBeGreaterThan(0);
  });

  it('confirmPolyCheck 后应进入 PLAYING 且覆盖生效', () => {
    const s = new PracticeSession();
    s.load('银行');
    s.confirmPolyCheck({ 行: 'hang' });
    expect(s.state).toBe(PracticeState.PLAYING);
    const entry = s.entries.find(e => e.char === '行');
    expect(entry.spelling).toBe('hang');
  });

  it('skipPolyCheck 应使用默认音开始', () => {
    const s = new PracticeSession();
    s.load('银行');
    s.skipPolyCheck();
    expect(s.state).toBe(PracticeState.PLAYING);
  });
});

describe('状态机 - 异常态', () => {
  it('空课文（仅标点）应进入 EMPTY_LESSON', () => {
    const s = new PracticeSession();
    const r = s.load('，。！！');
    expect(r.state).toBe(PracticeState.EMPTY_LESSON);
  });

  it('PLAYING 状态外调用 input 应返回 null', () => {
    const s = new PracticeSession();
    expect(s.input('a')).toBeNull(); // IDLE 状态
  });

  it('reset 应回到 IDLE 并清空数据', () => {
    const s = new PracticeSession();
    s.load('妈');
    s.input('m');
    s.reset();
    expect(s.state).toBe(PracticeState.IDLE);
    expect(s.entries.length).toBe(0);
    expect(s.stars).toBe(0);
  });
});

describe('状态机 - 进度与统计', () => {
  it('getProgress 应返回正确进度', () => {
    const s = new PracticeSession();
    s.load('一二三');
    expect(s.getProgress().percent).toBe(0);
    // 完成第一个字
    const e = s.getCurrentEntry();
    while (e.typedIndex < e.spelling.length) s.input(e.spelling[e.typedIndex]);
    expect(s.getProgress().percent).toBe(33);
  });

  it('getStats 应计算正确率', () => {
    const s = new PracticeSession();
    s.load('妈');
    s.input('x'); // 1 错
    s.input('m'); // 对
    s.input('a'); // 对
    const stats = s.getStats();
    // totalCorrect=1(字), totalErrors=1
    expect(stats.totalErrors).toBe(1);
    expect(stats.accuracy).toBeLessThan(100);
  });

  it('resumeFromProgress 应恢复进度', () => {
    const s = new PracticeSession();
    s.load('一二三四五');
    // 完成前 2 个字
    for (let i = 0; i < 2; i++) {
      const e = s.getCurrentEntry();
      while (e.typedIndex < e.spelling.length) s.input(e.spelling[e.typedIndex]);
    }
    const saved = { charIndex: 2, stars: 2, flowers: 0, combo: 2 };
    // 新会话恢复
    const s2 = new PracticeSession();
    s2.load('一二三四五');
    s2.resumeFromProgress(saved);
    expect(s2.currentEntryIndex).toBe(2);
    expect(s2.stars).toBe(2);
    expect(s2.state).toBe(PracticeState.PLAYING);
  });
});

describe('状态机 - 练习模式', () => {
  it('KEY 模式应正确设置', () => {
    const s = new PracticeSession({ mode: PracticeMode.KEY });
    expect(s.mode).toBe(PracticeMode.KEY);
  });

  it('READING 模式应正确设置', () => {
    const s = new PracticeSession({ mode: PracticeMode.READING });
    expect(s.mode).toBe(PracticeMode.READING);
  });
});
