import { describe, it, expect } from 'vitest';
import { addImportedLesson, createBackup, getImportedLessons, restoreBackup, validateBackup } from '../portable-data.js';

function memoryStorage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(k) { return data.get(k) ?? null; },
    setItem(k, v) { data.set(k, String(v)); },
  };
}

describe('网页分发的数据闭环', () => {
  it('导入课文可去重，备份包含课程和练习记录，恢复后可以续练', () => {
    const source = memoryStorage();
    const lesson = addImportedLesson('春晓.txt', '春眠不觉晓。', source);
    expect(addImportedLesson('春晓.txt', '春眠不觉晓。', source).id).toBe(lesson.id);
    source.setItem('profileIds', JSON.stringify(['p1']));
    source.setItem('profile:p1', JSON.stringify({ v: 1, id: 'p1', name: '小朋友' }));
    source.setItem(`progress:p1:${lesson.id}:pinyin`, JSON.stringify({ v: 1, charIndex: 2 }));
    source.setItem('unrelated', 'leave me alone');
    const backup = createBackup(source);
    expect(backup.data.unrelated).toBeUndefined();

    const target = memoryStorage();
    target.setItem('unrelated', 'existing');
    restoreBackup(backup, target);
    expect(getImportedLessons(target)[0].text).toBe('春眠不觉晓。');
    expect(JSON.parse(target.getItem(`progress:p1:${lesson.id}:pinyin`)).charIndex).toBe(2);
    expect(target.getItem('unrelated')).toBe('existing');
  });

  it('无效备份先拒绝，不能写入任意存储键', () => {
    const store = memoryStorage();
    expect(() => validateBackup({ format: 'joytypy-backup', version: 1, data: { unrelated: 'x' } })).toThrow();
    expect(() => restoreBackup({ format: 'joytypy-backup', version: 1, data: { profileIds: 'broken' } }, store)).toThrow();
    expect(store.length).toBe(0);
  });
});
