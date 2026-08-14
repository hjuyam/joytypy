// 拼音引擎封装：调用链 practice.js → pinyin-engine.js → vendor/pinyin-pro.js
// 职责：拼音转换（去声调全拼/带声调展示）、多音字检测、课文解析（行内标注/头部映射表/覆盖合并）

import { pinyin, polyphonic } from './vendor/pinyin-pro.js';

const HANZI_RE = /[一-龥]/;
// 行内标注：字(拼音) 一一对应，拼音仅含 a-z 和 v(代表 ü)
const INLINE_RE = /([一-龥])\(([a-zA-Zvü]+)\)/g;
// 头部映射表：文件首段 --- 包裹的 YAML 风格
const HEADER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

// ü → v 统一（键盘无 ü 键，用 v 代替）
function normalize(s) {
  return String(s || '').toLowerCase().replace(/ü/g, 'v');
}

/**
 * 去声调全拼（用于敲击判定），支持单字或多字
 * @param {string} hanzi
 * @returns {string} 如 "ma" 或 "chuangqianmingyueguang"
 */
export function toSpelling(hanzi) {
  const result = pinyin(hanzi, { toneType: 'none', type: 'array' });
  const str = Array.isArray(result) ? result.join('') : String(result);
  return normalize(str);
}

/**
 * 单字去声调全拼（带可选覆盖）
 * @param {string} char 单个汉字
 * @param {Object} override 覆盖映射 { 字: 拼音 }
 * @returns {string}
 */
export function charSpelling(char, override) {
  if (override && override[char]) return normalize(override[char]);
  return toSpelling(char);
}

/**
 * 带声调拼音（用于头顶拼音展示）
 * @param {string} hanzi
 * @returns {string} 如 "mā" 或 "chuáng qián"
 */
export function toToned(hanzi) {
  const result = pinyin(hanzi, { toneType: 'symbol', type: 'array' });
  return Array.isArray(result) ? result.join(' ') : String(result);
}

/**
 * 检测单字的多音字候选读音（去声调）
 * @param {string} char 单个汉字
 * @returns {string[]} 候选读音数组，长度 >1 表示多音字
 */
export function detectPolyphonic(char) {
  try {
    const result = polyphonic(char, { toneType: 'none', type: 'array' });
    if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) {
      return result[0].map(normalize);
    }
  } catch (e) {}
  return [];
}

/**
 * 检测单字的多音字候选读音（带声调，用于校对面板展示）
 * @param {string} char
 * @returns {string[]}
 */
export function detectPolyphonicToned(char) {
  try {
    const result = polyphonic(char, { toneType: 'symbol', type: 'array' });
    if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) {
      return result[0];
    }
  } catch (e) {}
  return [];
}

/**
 * 解析头部映射表（文件级全局覆盖）
 * @param {string} text 原始课文
 * @returns {{ map: Object, rest: string }} map 为 { 字: 拼音 }，rest 为去除头部后的文本
 */
export function parseHeaderMap(text) {
  const m = text.match(HEADER_RE);
  if (!m) return { map: {}, rest: text };
  const map = {};
  for (const line of m[1].split('\n')) {
    const lm = line.match(/^([一-龥])\s*[:：]\s*([a-zA-Zvü]+)/);
    if (lm) map[lm[1]] = normalize(lm[2]);
  }
  return { map, rest: text.slice(m[0].length) };
}

/**
 * 解析行内标注 字(拼音) 并从文本中移除括号
 * @param {string} text
 * @returns {{ map: Object, cleaned: string }} map 为 { 字: 拼音 }，cleaned 为去除括号后的文本
 */
export function parseInlineMap(text) {
  const map = {};
  const cleaned = text.replace(INLINE_RE, (match, char, py) => {
    map[char] = normalize(py);
    return char;
  });
  return { map, cleaned };
}

/**
 * 构建练习序列（核心解析函数）
 * 覆盖优先级：行内标注 > 头部映射 > 校对面板结果(panelOverride) > 词典默认
 * @param {string} text 课文原始文本
 * @param {Object} panelOverride 校对面板已保存的覆盖映射 { 字: 拼音 }
 * @returns {{
 *   entries: Array<{char, spelling, toned, typedIndex, errors, skipped}>,
 *   polyChars: Array<{char, candidates, candidatesToned, defaultIdx}>,
 *   merged: Object,
 *   charCount: number,
 *   rawText: string
 * }}
 */
export function buildSequence(text, panelOverride = {}) {
  const { map: headerMap, rest: r1 } = parseHeaderMap(text);
  const { map: inlineMap, cleaned } = parseInlineMap(r1);

  // 合并覆盖：panelOverride(低) → headerMap → inlineMap(高)
  const merged = { ...panelOverride, ...headerMap, ...inlineMap };

  // 提取汉字序列（过滤标点空白数字字母）
  const chars = [...cleaned].filter(c => HANZI_RE.test(c));

  // 生成练习序列
  const entries = chars.map(char => {
    const overrideSpelling = merged[char];
    const spelling = overrideSpelling || toSpelling(char);
    // 被覆盖时展示覆盖音（去声调），否则用 pinyin-pro 带声调
    const toned = overrideSpelling ? overrideSpelling : toToned(char);
    return {
      char,
      spelling,
      toned,
      typedIndex: 0,
      errors: 0,
      skipped: !spelling // 拼音为空（生僻字/库未收录）则跳过
    };
  });

  // 检测多音字（仅未被手写覆盖的需要校对）
  const polyChars = [];
  const seen = new Set();
  for (const char of chars) {
    if (seen.has(char)) continue;
    seen.add(char);
    // 已被行内或头部覆盖的字无需校对
    if (inlineMap[char] || headerMap[char]) continue;
    const candidates = detectPolyphonic(char);
    if (candidates.length > 1) {
      const candidatesToned = detectPolyphonicToned(char);
      // 默认预选词典首音（pinyin-pro 的默认音）
      const defaultSpelling = toSpelling(char);
      const defaultIdx = Math.max(0, candidates.indexOf(defaultSpelling));
      polyChars.push({ char, candidates, candidatesToned, defaultIdx });
    }
  }

  return { entries, polyChars, merged, charCount: chars.length, rawText: cleaned };
}
