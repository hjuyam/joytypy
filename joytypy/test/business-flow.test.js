import { describe, it, expect } from 'vitest';
import { creditCharacter, awardFirstCompletion } from '../accounting.js';
import { PracticeSession, PracticeState } from '../practice.js';
import { buildSequence } from '../pinyin-engine.js';
import { generateReport } from '../report.js';
import { Store } from '../app.js';

function finishChar(session) {
  const letters = session.getCurrentEntry().spelling.slice(session.getCurrentEntry().typedIndex);
  let result;
  for (const letter of letters) result = session.input(letter);
  return result;
}

describe('完成入账与续练', () => {
  it('进度按档案、课文、模式隔离，并兼容旧拼音进度', () => {
    const data = new Map();
    globalThis.localStorage = {
      getItem: key => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
    };
    Store.setProgress('甲', '春晓.txt', 'pinyin', { charIndex: 1 });
    Store.setProgress('甲', '春晓.txt', 'key', { charIndex: 2 });
    expect(Store.getProgress('甲', '春晓.txt', 'pinyin').charIndex).toBe(1);
    expect(Store.getProgress('甲', '春晓.txt', 'key').charIndex).toBe(2);
    expect(Store.getProgress('乙', '春晓.txt', 'pinyin')).toBeNull();
    expect(Store.getProgress('甲', '静夜思.md', 'pinyin')).toBeNull();
    data.set('progress:甲:旧课文', JSON.stringify({ v: 1, charIndex: 3 }));
    expect(Store.getProgress('甲', '旧课文', 'pinyin').charIndex).toBe(3);
    expect(Store.getProgress('甲', '旧课文', 'key')).toBeNull();
    delete globalThis.localStorage;
  });
  it('一次练习只入账一次，重练有星，徽章只发一次', () => {
    const lesson = { id: '春晓.txt', title: '春晓' };
    let reward = { totalStars: 0, totalFlowers: 0, badges: [] };
    for (let round = 0; round < 2; round++) {
      const s = new PracticeSession();
      s.load('妈'.repeat(20));
      for (let i = 0; i < 20; i++) {
        const result = finishChar(s);
        reward = creditCharacter(reward, !!result.reward?.flower);
      }
      expect(s.state).toBe(PracticeState.REWARD);
      reward = awardFirstCompletion(reward, lesson).reward;
    }
    expect(reward).toMatchObject({ totalStars: 40, totalFlowers: 8 });
    expect(reward.badges).toHaveLength(1);
  });

  it('恢复到当前字母并保留真实按键及首次正确统计', () => {
    const s = new PracticeSession();
    s.load('妈妈');
    s.input('m');
    s.input('z');
    const p = s.getProgress();
    const saved = { charIndex: p.current, typedIndex: s.getCurrentEntry().typedIndex, totalErrors: s.totalErrors, correctKeys: s.correctKeys, totalCorrect: s.totalCorrect, firstTryChars: s.firstTryChars, currentErrors: s.getCurrentEntry().errors };
    const resumed = new PracticeSession();
    resumed.load('妈妈');
    resumed.resumeFromProgress(saved);
    expect(resumed.getCurrentTargetLetter()).toBe('a');
    finishChar(resumed);
    finishChar(resumed);
    expect(resumed.getStats()).toMatchObject({ correctKeys: 4, totalErrors: 1, totalCorrect: 2, firstTryChars: 1, accuracy: 80, firstTryAccuracy: 50 });
  });
});

describe('按出现位置校对与长文分段', () => {
  it('同一个字可按出现位置采用不同读音并只校对未确认处', () => {
    const parsed = buildSequence('行行', { byIndex: { 0: 'hang', 1: 'xing' } });
    expect(parsed.entries.map(e => e.spelling)).toEqual(['hang', 'xing']);
    expect(parsed.polyChars).toHaveLength(0);
  });
  it('后续段多音字到达该段才要求校对', () => {
    const s = new PracticeSession({ segmentSize: 2 });
    expect(s.load('妈妈银行').state).toBe(PracticeState.PLAYING);
    finishChar(s);
    finishChar(s);
    expect(s.state).toBe(PracticeState.POLY_CHECK);
    expect(s.getPendingPolyChars().every(p => p.index >= 2 && p.index < 4)).toBe(true);
  });
});

describe('报告口径', () => {
  it('旧进度即使完成也不推算正确率', () => {
    const now = Date.now();
    const store = {
      getReward: () => ({ totalStars: 20, totalFlowers: 4, badges: [] }),
      getActivities: () => [],
      getProgress: () => ({ charIndex: 20, completed: true }),
    };
    const r = generateReport('child', store, [{ id: '春晓.txt', title: '春晓', charCount: 20 }], now);
    expect(r.weekCompletion).toBe(100);
    expect(r.weekKeyAccuracy).toBeNull();
    expect(r.weekFirstTryAccuracy).toBeNull();
  });
  it('用练习记录分别计算按键和首次敲对率，不把完成率当正确率', () => {
    const now = new Date('2026-09-24T12:00:00+08:00').getTime();
    const store = {
      getReward: () => ({ totalStars: 1, totalFlowers: 0, badges: [] }),
      getActivities: () => [{ id: '1', at: now, correctKeys: 3, wrongKeys: 1, completedChars: 2, firstTryChars: 1 }],
      getProgress: () => ({ charIndex: 1, completed: false }),
    };
    const r = generateReport('child', store, [{ id: 'a', title: '示例', charCount: 2 }], now);
    expect(r.weekCompletion).toBe(50);
    expect(r.weekKeyAccuracy).toBe(75);
    expect(r.weekFirstTryAccuracy).toBe(50);
    expect(r.weekChars).toBe(2);
  });
});
