// 浏览器版课程与备份。始终复用现有 localStorage，避免迁移时丢失旧档案。
const IMPORTED_KEY = 'importedLessons';
const BACKUP_KEYS = /^(meta|profileIds|currentProfileId|importedLessons|profile:.+|reward:.+|settings:.+|progress:.+|activity:.+|lesson:.+)$/;
const MAX_LESSON_BYTES = 256 * 1024;

export function countHanzi(text) {
  return (text.match(/[一-龥]/g) || []).length;
}

export function getImportedLessons(storage = localStorage) {
  try {
    const lessons = JSON.parse(storage.getItem(IMPORTED_KEY) || '[]');
    return Array.isArray(lessons) ? lessons.filter(l => l && typeof l.id === 'string' && typeof l.text === 'string') : [];
  } catch { return []; }
}

export function addImportedLesson(name, text, storage = localStorage) {
  if (!/\.(txt|md)$/i.test(name)) throw new Error('只支持 .txt 或 .md 课文');
  if (new TextEncoder().encode(text).length > MAX_LESSON_BYTES) throw new Error('单篇课文不能超过 256 KB');
  const charCount = countHanzi(text);
  if (!charCount) throw new Error('课文中没有可练习的汉字');
  const lessons = getImportedLessons(storage);
  const existing = lessons.find(l => l.name === name && l.text === text);
  if (existing) return existing;
  const lesson = {
    id: `imported:${crypto.randomUUID()}`,
    name,
    title: name.replace(/\.(txt|md)$/i, ''),
    charCount,
    text,
  };
  storage.setItem(IMPORTED_KEY, JSON.stringify([...lessons, lesson]));
  return lesson;
}

export function createBackup(storage = localStorage) {
  const data = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (BACKUP_KEYS.test(key)) data[key] = storage.getItem(key);
  }
  return { format: 'joytypy-backup', version: 1, exportedAt: new Date().toISOString(), data };
}

export function validateBackup(backup) {
  if (!backup || backup.format !== 'joytypy-backup' || backup.version !== 1 ||
      !backup.data || typeof backup.data !== 'object' || Array.isArray(backup.data)) {
    throw new Error('不是受支持的敲敲乐备份文件');
  }
  const entries = Object.entries(backup.data);
  if (entries.length > 20000 || entries.some(([key, value]) => !BACKUP_KEYS.test(key) || typeof value !== 'string')) {
    throw new Error('备份文件内容无效');
  }
  for (const [key, value] of entries) {
    if (key !== 'currentProfileId') {
      try { JSON.parse(value); } catch { throw new Error(`备份中的 ${key} 不是有效数据`); }
    }
  }
  return entries;
}

// 用户明确确认后调用；先完整校验并由界面导出当前备份。无清除操作。
export function restoreBackup(backup, storage = localStorage) {
  const entries = validateBackup(backup);
  for (const [key, value] of entries) storage.setItem(key, value);
  return entries.length;
}
