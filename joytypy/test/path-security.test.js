// 路径安全测试：验证 server.js 的路径穿越防护
// 测试 safeResolve 函数和 LESSON_RE 白名单

import { describe, it, expect } from 'vitest';
import path from 'path';

// 复现 server.js 的安全函数（server.js 启动即监听端口，无法直接 import 测试）
function safeResolve(baseDir, relPath) {
  const p = path.resolve(baseDir, relPath);
  return (p === baseDir || p.startsWith(baseDir + path.sep)) ? p : null;
}

const LESSON_RE = /^[一-龥a-zA-Z0-9_.\-]+\.(txt|md)$/i;

describe('路径安全 - safeResolve', () => {
  const ROOT = '/Users/test/joytypy';
  const LESSONS = path.join(ROOT, 'lessons');

  it('合法路径应返回绝对路径', () => {
    expect(safeResolve(LESSONS, '静夜思.md')).toBe(path.join(LESSONS, '静夜思.md'));
    expect(safeResolve(LESSONS, '春晓.txt')).toBe(path.join(LESSONS, '春晓.txt'));
  });

  it('../ 穿越应被拦截（返回 null）', () => {
    expect(safeResolve(LESSONS, '../server.js')).toBeNull();
    expect(safeResolve(LESSONS, '../../etc/passwd')).toBeNull();
    expect(safeResolve(LESSONS, '..')).toBeNull();
  });

  it('URL 编码穿越 %2e%2e%2f 应在解码后被拦截', () => {
    // server.js 先 decodeURIComponent 再 safeResolve，这里模拟解码后
    const decoded = decodeURIComponent('%2e%2e%2f%2e%2e%2fserver.js');
    expect(decoded).toBe('../../server.js');
    expect(safeResolve(LESSONS, decoded)).toBeNull();
  });

  it('多层 ../ 穿越应被拦截', () => {
    expect(safeResolve(LESSONS, '../../../etc/passwd')).toBeNull();
    expect(safeResolve(LESSONS, 'a/../../../etc')).toBeNull();
  });

  it('根目录本身应通过（边界）', () => {
    expect(safeResolve(LESSONS, '.')).toBe(LESSONS);
    expect(safeResolve(LESSONS, '')).toBe(LESSONS);
  });

  it('子目录合法路径应通过', () => {
    expect(safeResolve(LESSONS, 'subdir/file.txt')).toBe(path.join(LESSONS, 'subdir', 'file.txt'));
  });
});

describe('路径安全 - LESSON_RE 白名单', () => {
  it('合法课文文件名应通过', () => {
    expect(LESSON_RE.test('静夜思.md')).toBe(true);
    expect(LESSON_RE.test('春晓.txt')).toBe(true);
    expect(LESSON_RE.test('lesson1.txt')).toBe(true);
    expect(LESSON_RE.test('my-lesson.md')).toBe(true);
    expect(LESSON_RE.test('test_file.txt')).toBe(true);
  });

  it('含路径分隔符的文件名应被拒绝', () => {
    expect(LESSON_RE.test('../server.js')).toBe(false);
    expect(LESSON_RE.test('a/b.txt')).toBe(false);
    expect(LESSON_RE.test('..%2fsecret.txt')).toBe(false);
  });

  it('非 txt/md 后缀应被拒绝', () => {
    expect(LESSON_RE.test('file.html')).toBe(false);
    expect(LESSON_RE.test('file.js')).toBe(false);
    expect(LESSON_RE.test('file')).toBe(false);
    expect(LESSON_RE.test('file.exe')).toBe(false);
  });

  it('含特殊字符的文件名应被拒绝', () => {
    expect(LESSON_RE.test('file name.txt')).toBe(false); // 空格
    expect(LESSON_RE.test('file|name.txt')).toBe(false); // 管道符
    expect(LESSON_RE.test('file;name.txt')).toBe(false); // 分号
  });
});
