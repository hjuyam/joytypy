// 练习引擎：完整状态机 + 逐字母比对内核
// 状态流：IDLE → LOADING → (LOADING_FAILED/EMPTY_LESSON/POLY_CHECK) → PLAYING → COMPLETE → REWARD → IDLE
// 调用链：practice.js → pinyin-engine.js → vendor/pinyin-pro.js

import { buildSequence } from './pinyin-engine.js';

export const PracticeState = {
  IDLE: 'IDLE',
  LOADING: 'LOADING',
  LOADING_FAILED: 'LOADING_FAILED',
  EMPTY_LESSON: 'EMPTY_LESSON',
  POLY_CHECK: 'POLY_CHECK',
  PLAYING: 'PLAYING',
  COMPLETE: 'COMPLETE',
  REWARD: 'REWARD'
};

export const PracticeMode = {
  KEY: 'key',         // 键位启蒙：仅显示当前字母
  PINYIN: 'pinyin',   // 拼音双练：汉字 + 头顶拼音
  READING: 'reading'  // 识字诵读：课文上下文 + 大字号汉字
};

/**
 * 练习会话（纯逻辑，不操作 DOM；通过回调通知 UI）
 */
export class PracticeSession {
  constructor(options = {}) {
    this.state = PracticeState.IDLE;
    this.mode = options.mode || PracticeMode.PINYIN;
    this.comboThreshold = options.comboThreshold || 5;
    this.errorHintThreshold = options.errorHintThreshold || 3;
    this.onStateChange = options.onStateChange || (() => {});
    this.onInput = options.onInput || (() => {});
    this.onReward = options.onReward || (() => {});

    this.entries = [];
    this.passages = [];
    this.polyChars = [];
    this.merged = {};
    this.currentEntryIndex = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.stars = 0;
    this.flowers = 0;
    this.totalErrors = 0;
    this.totalCorrect = 0;
    this.correctKeys = 0;
    this.firstTryChars = 0;
    this.segmentSize = options.segmentSize || 12;
    this.checkedSegments = new Set();
    this.startTime = null;
    this.endTime = null;
    this.priorDuration = 0;
    this.consecutiveErrors = 0;
    this.hintTriggered = false;
    this.lessonId = null;
    this.charCount = 0;
    this.rawText = '';
  }

  /**
   * 加载课文并解析
   * @param {string} text 课文原始文本
   * @param {Object} panelOverride 校对面板已保存的覆盖映射
   * @param {string} lessonId 课文标识
   * @returns {{ state, polyChars?, error? }}
   */
  load(text, panelOverride = {}, lessonId = null) {
    this.lessonId = lessonId;
    this.setState(PracticeState.LOADING);
    try {
      const result = buildSequence(text, panelOverride);
      this.entries = result.entries;
      this.passages = result.passages;
      this.polyChars = result.polyChars;
      this.merged = result.merged;
      this.charCount = result.charCount;
      this.rawText = result.rawText;

      // 检查空课文（过滤标点后无可练汉字，或全部跳过）
      const playable = this.entries.filter(e => !e.skipped);
      if (playable.length === 0) {
        this.setState(PracticeState.EMPTY_LESSON);
        return { state: this.state };
      }

      // 检查多音字（有待校对的字）
      if (this.polyChars.some(p => p.index < this.segmentSize)) {
        this.setState(PracticeState.POLY_CHECK);
        return { state: this.state, polyChars: this.getPendingPolyChars() };
      }

      // 无多音字，直接开始
      this.startPlaying();
      return { state: this.state };
    } catch (e) {
      console.error('Lesson load failed:', e);
      this.setState(PracticeState.LOADING_FAILED);
      return { state: this.state, error: e.message };
    }
  }

  /**
   * 确认多音字校对结果，合并覆盖并开始练习
   * @param {Object} override { 出现位置: 去声调拼音 }
   */
  confirmPolyCheck(override = {}) {
    const segment = Math.floor(this.currentEntryIndex / this.segmentSize);
    this.checkedSegments.add(segment);
    for (const entry of this.entries) {
      const choice = override[entry.index] || override[entry.char];
      if (choice && !entry.completed) {
        entry.spelling = choice;
        entry.toned = choice;
        entry.skipped = !entry.spelling;
      }
    }
    if (this.startTime === null) this.startPlaying();
    else this.setState(PracticeState.PLAYING);
  }

  /**
   * 跳过多音字校对（全部使用默认音），直接开始
   */
  skipPolyCheck() {
    this.checkedSegments.add(Math.floor(this.currentEntryIndex / this.segmentSize));
    if (this.startTime === null) this.startPlaying();
    else this.setState(PracticeState.PLAYING);
  }

  getPendingPolyChars() {
    const start = Math.floor(this.currentEntryIndex / this.segmentSize) * this.segmentSize;
    return this.polyChars.filter(p => p.index >= start && p.index < start + this.segmentSize);
  }

  /** 开始练习（PLAYING 状态） */
  startPlaying() {
    this.currentEntryIndex = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.stars = 0;
    this.flowers = 0;
    this.totalErrors = 0;
    this.totalCorrect = 0;
    this.correctKeys = 0;
    this.firstTryChars = 0;
    this.startTime = Date.now();
    this.endTime = null;
    this.priorDuration = 0;
    this.consecutiveErrors = 0;
    this.hintTriggered = false;
    // 跳过开头无拼音的字（SKIP_CHAR）
    this.skipEmptyChars();
    if (this.currentEntryIndex >= this.entries.length) {
      this.setState(PracticeState.EMPTY_LESSON);
    } else {
      this.setState(PracticeState.PLAYING);
    }
  }

  /** 跳过无拼音的字（SKIP_CHAR 降级） */
  skipEmptyChars() {
    while (this.currentEntryIndex < this.entries.length && this.entries[this.currentEntryIndex].skipped) {
      this.currentEntryIndex++;
    }
  }

  /** 获取当前正在练习的 entry */
  getCurrentEntry() {
    return this.entries[this.currentEntryIndex] || null;
  }

  getCurrentPassage() {
    const index = Math.min(this.currentEntryIndex, this.entries.length - 1);
    return this.passages.find(p => p.start <= index && index < p.end) || null;
  }

  /** 获取当前应敲的字母（小写） */
  getCurrentTargetLetter() {
    const entry = this.getCurrentEntry();
    if (!entry) return null;
    return entry.spelling[entry.typedIndex] || null;
  }

  /**
   * 核心比对：处理一次按键输入（真实键盘与模拟键盘统一入口）
   * @param {string} key 单个字母
   * @returns {{ correct, charComplete?, reward?, finished?, hint?, target? } | null}
   */
  input(key) {
    if (this.state !== PracticeState.PLAYING) return null;
    const entry = this.getCurrentEntry();
    if (!entry) return null;

    const keyLower = String(key).toLowerCase();
    const target = entry.spelling[entry.typedIndex];

    if (keyLower === target) {
      // 正确
      entry.typedIndex++;
      this.correctKeys++;
      this.consecutiveErrors = 0;

      // 检查该字是否完成
      if (entry.typedIndex >= entry.spelling.length) {
        this.stars++;
        this.combo++;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        this.totalCorrect++;
        if (entry.errors === 0) this.firstTryChars++;
        entry.completed = true;

        const reward = { star: true };
        if (this.combo > 0 && this.combo % this.comboThreshold === 0) {
          this.flowers++;
          reward.flower = true;
          reward.combo = this.combo;
        }

        this.currentEntryIndex++;
        this.hintTriggered = false;
        this.skipEmptyChars();

        // 检查全篇完成
        if (this.currentEntryIndex >= this.entries.length) {
          this.endTime = Date.now();
          this.setState(PracticeState.REWARD);
          const result = { correct: true, charComplete: true, reward, finished: true };
          this.onInput(result);
          return result;
        }

        const segment = Math.floor(this.currentEntryIndex / this.segmentSize);
        if (this.currentEntryIndex % this.segmentSize === 0 && !this.checkedSegments.has(segment) && this.getPendingPolyChars().length) {
          this.setState(PracticeState.POLY_CHECK);
        }

        if (reward.flower) this.onReward(reward);
        const result = { correct: true, charComplete: true, reward };
        this.onInput(result);
        return result;
      }

      // 字母正确但字未完成
      const result = { correct: true, charComplete: false };
      this.onInput(result);
      return result;
    }

    // 错误
    entry.errors++;
    this.totalErrors++;
    this.combo = 0;
    this.consecutiveErrors++;

    let hint = false;
    // 错误累积提示（Review I-4）：同字母连错3次，临时高亮正确键
    if (this.consecutiveErrors >= this.errorHintThreshold && !this.hintTriggered) {
      hint = true;
      this.hintTriggered = true;
    }

    const result = { correct: false, hint, target };
    this.onInput(result);
    return result;
  }

  /** 获取当前进度 */
  getProgress() {
    const total = this.entries.length;
    const completed = this.currentEntryIndex;
    return {
      current: completed,
      total,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      stars: this.stars,
      flowers: this.flowers,
      combo: this.combo,
      maxCombo: this.maxCombo
    };
  }

  /** 获取本篇统计（完成时调用） */
  getStats() {
    const duration = this.priorDuration + (this.endTime ? this.endTime - this.startTime : (this.startTime ? Date.now() - this.startTime : 0));
    const totalAttempts = this.correctKeys + this.totalErrors;
    const accuracy = totalAttempts > 0 ? Math.round((this.correctKeys / totalAttempts) * 100) : 0;
    return {
      stars: this.stars,
      flowers: this.flowers,
      maxCombo: this.maxCombo,
      totalErrors: this.totalErrors,
      totalCorrect: this.totalCorrect,
      correctKeys: this.correctKeys,
      firstTryChars: this.firstTryChars,
      firstTryAccuracy: this.totalCorrect ? Math.round(this.firstTryChars / this.totalCorrect * 100) : 0,
      accuracy,
      duration,
      charCount: this.charCount
    };
  }

  /** 从已保存的进度恢复（继续上次） */
  resumeFromProgress(savedProgress) {
    if (!savedProgress || this.entries.length === 0) return;
    this.currentEntryIndex = Math.min(savedProgress.charIndex || 0, this.entries.length);
    this.stars = savedProgress.stars || 0;
    this.flowers = savedProgress.flowers || 0;
    this.combo = savedProgress.combo || 0;
    this.maxCombo = savedProgress.maxCombo || this.combo;
    this.totalErrors = savedProgress.totalErrors || 0;
    this.correctKeys = savedProgress.correctKeys || 0;
    this.totalCorrect = savedProgress.totalCorrect || 0;
    this.firstTryChars = savedProgress.firstTryChars || 0;
    this.priorDuration = savedProgress.elapsedMs || 0;
    this.checkedSegments = new Set(savedProgress.checkedSegments || []);
    for (let i = 0; i < this.currentEntryIndex; i++) this.entries[i].completed = true;
    const current = this.entries[this.currentEntryIndex];
    if (current) {
      current.typedIndex = Math.min(savedProgress.typedIndex || 0, current.spelling.length - 1);
      current.errors = savedProgress.currentErrors || 0;
    }
    this.skipEmptyChars();
    if (this.currentEntryIndex < this.entries.length) {
      this.startTime = Date.now();
      this.setState(PracticeState.PLAYING);
    }
  }

  setState(newState) {
    const old = this.state;
    this.state = newState;
    this.onStateChange(newState, old);
  }

  /** 重置会话 */
  reset() {
    this.state = PracticeState.IDLE;
    this.entries = [];
    this.passages = [];
    this.polyChars = [];
    this.merged = {};
    this.currentEntryIndex = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.stars = 0;
    this.flowers = 0;
    this.totalErrors = 0;
    this.totalCorrect = 0;
    this.correctKeys = 0;
    this.firstTryChars = 0;
    this.startTime = null;
    this.endTime = null;
    this.priorDuration = 0;
    this.consecutiveErrors = 0;
    this.hintTriggered = false;
  }
}
