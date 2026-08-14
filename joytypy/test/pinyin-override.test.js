// 多音字覆盖解析测试：行内标注、头部映射、混合优先级、括号不匹配

import { describe, it, expect } from 'vitest';
import {
  parseHeaderMap,
  parseInlineMap,
  buildSequence,
  toSpelling,
  detectPolyphonic,
} from '../pinyin-engine.js';

describe('行内标注解析 parseInlineMap', () => {
  it('应解析 字(拼音) 并移除括号', () => {
    const { map, cleaned } = parseInlineMap('银(yin)行(hang)');
    expect(map['银']).toBe('yin');
    expect(map['行']).toBe('hang');
    expect(cleaned).toBe('银行');
  });

  it('无标注的汉字应保留', () => {
    const { map, cleaned } = parseInlineMap('银行很多');
    expect(Object.keys(map).length).toBe(0);
    expect(cleaned).toBe('银行很多');
  });

  it('混合标注应正确处理（行内用去声调拼音）', () => {
    const { map, cleaned } = parseInlineMap('我(wo)爱(ai)学习');
    expect(map['我']).toBe('wo');
    expect(map['爱']).toBe('ai');
    expect(cleaned).toBe('我爱学习');
  });

  it('ü 应被归一化为 v', () => {
    const { map } = parseInlineMap('女(nv)');
    expect(map['女']).toBe('nv');
  });
});

describe('头部映射解析 parseHeaderMap', () => {
  it('应解析 --- 包裹的映射表', () => {
    const text = '---\n行: hang\n长: zhang\n---\n银行很长';
    const { map, rest } = parseHeaderMap(text);
    expect(map['行']).toBe('hang');
    expect(map['长']).toBe('zhang');
    expect(rest).toBe('银行很长');
  });

  it('无头部时应返回空 map 和原文', () => {
    const text = '银行很长';
    const { map, rest } = parseHeaderMap(text);
    expect(Object.keys(map).length).toBe(0);
    expect(rest).toBe('银行很长');
  });

  it('支持中文冒号', () => {
    const text = '---\n行：hang\n---\n银行';
    const { map } = parseHeaderMap(text);
    expect(map['行']).toBe('hang');
  });
});

describe('覆盖优先级合并 buildSequence', () => {
  it('行内标注优先于头部映射', () => {
    // 行内 hang 覆盖头部 xing
    const text = '---\n行: xing\n---\n银(yin)行(hang)';
    const result = buildSequence(text);
    const xingEntry = result.entries.find(e => e.char === '行');
    expect(xingEntry.spelling).toBe('hang'); // 行内优先
  });

  it('头部映射优先于词典默认', () => {
    const text = '---\n行: hang\n---\n银行';
    const result = buildSequence(text);
    const entry = result.entries.find(e => e.char === '行');
    expect(entry.spelling).toBe('hang');
  });

  it('panelOverride 优先级最低', () => {
    const text = '---\n行: hang\n---\n银行';
    // panelOverride 说 xing，但头部说 hang，应取 hang
    const result = buildSequence(text, { 行: 'xing' });
    const entry = result.entries.find(e => e.char === '行');
    expect(entry.spelling).toBe('hang');
  });

  it('panelOverride 在无其他覆盖时应生效', () => {
    const text = '银行';
    const result = buildSequence(text, { 行: 'hang' });
    const entry = result.entries.find(e => e.char === '行');
    expect(entry.spelling).toBe('hang');
  });

  it('已被覆盖的多音字不应出现在 polyChars', () => {
    const text = '银(yin)行(hang)';
    const result = buildSequence(text);
    expect(result.polyChars.find(p => p.char === '行')).toBeUndefined();
  });

  it('未覆盖的多音字应出现在 polyChars', () => {
    const text = '银行';
    const result = buildSequence(text);
    const poly = result.polyChars.find(p => p.char === '行');
    expect(poly).toBeDefined();
    expect(poly.candidates.length).toBeGreaterThan(1);
  });
});

describe('基础拼音转换', () => {
  it('toSpelling 应返回去声调全拼', () => {
    expect(toSpelling('妈')).toBe('ma');
    expect(toSpelling('你')).toBe('ni');
  });

  it('ü 应被归一化为 v', () => {
    expect(toSpelling('女')).toBe('nv');
  });

  it('detectPolyphonic 应返回多个候选', () => {
    const cands = detectPolyphonic('行');
    expect(cands.length).toBeGreaterThan(1);
    expect(cands).toContain('hang');
    expect(cands).toContain('xing');
  });

  it('非多音字应返回单个或空候选', () => {
    const cands = detectPolyphonic('妈');
    expect(cands.length).toBeLessThanOrEqual(1);
  });
});

describe('标点过滤与字符序列', () => {
  it('应过滤标点和空白', () => {
    const result = buildSequence('床前，明月。');
    expect(result.charCount).toBe(4);
    expect(result.entries.map(e => e.char).join('')).toBe('床前明月');
  });

  it('应过滤数字和字母', () => {
    const result = buildSequence('第1课abc');
    expect(result.charCount).toBe(2);
    expect(result.entries.map(e => e.char).join('')).toBe('第课');
  });

  it('空课文（仅标点）应返回空序列', () => {
    const result = buildSequence('，。！？');
    expect(result.entries.length).toBe(0);
    expect(result.charCount).toBe(0);
  });
});
