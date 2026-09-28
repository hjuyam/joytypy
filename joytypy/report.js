// 家长报告：只用真实按键与单字记录计算正确率；旧进度没有练习记录时不推测正确率。
export function getWeekKey(ts = Date.now()) {
  const d = new Date(ts); d.setHours(0,0,0,0);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
const percent = (good, total) => total ? Math.round(good / total * 100) : null;

export function generateReport(profileId, store, lessons = [], now = Date.now()) {
  const reward = store.getReward(profileId);
  const weekKey = getWeekKey(now);
  const activities = store.getActivities(profileId);
  const weekly = activities.filter(a => getWeekKey(a.at) === weekKey);
  const sums = weekly.reduce((s, a) => {
    s.chars += a.completedChars || 0;
    s.first += a.firstTryChars || 0;
    s.keys += a.correctKeys || 0;
    s.wrong += a.wrongKeys || 0;
    return s;
  }, { chars: 0, first: 0, keys: 0, wrong: 0 });

  const progress = lessons.map(lesson => {
    if (!lesson.charCount) return { title: lesson.title, completion: null };
    const entries = ['key', 'pinyin', 'reading'].map(mode => store.getProgress(profileId, lesson.id, mode)).filter(Boolean);
    const best = entries.length ? Math.max(...entries.map(p => p.completed ? 100 : Math.min(100, Math.round((p.charIndex || 0) / lesson.charCount * 100)))) : null;
    return { title: lesson.title, completion: best };
  }).filter(p => p.completion !== null);
  const weekCompletion = progress.length ? Math.round(progress.reduce((sum, p) => sum + p.completion, 0) / progress.length) : null;

  const trend = [];
  for (let i = 3; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i * 7);
    const wk = getWeekKey(d.getTime());
    const rows = activities.filter(a => getWeekKey(a.at) === wk);
    const correct = rows.reduce((n, a) => n + (a.correctKeys || 0), 0);
    const wrong = rows.reduce((n, a) => n + (a.wrongKeys || 0), 0);
    trend.push({ label: wk.slice(5).replace('-', '/'), accuracy: percent(correct, correct + wrong) });
  }
  return {
    weekChars: sums.chars,
    weekCompletion,
    weekKeyAccuracy: percent(sums.keys, sums.keys + sums.wrong),
    weekFirstTryAccuracy: percent(sums.first, sums.chars),
    trend, progress,
    totalStars: reward.totalStars, totalFlowers: reward.totalFlowers, badges: reward.badges || [],
  };
}

const displayPercent = value => value === null ? '暂无记录' : `${value}%`;
export function exportReport(profile, data) {
  const lines = [
    '敲敲乐 · 家长报告',
    `小朋友：${profile.name} ${profile.avatar}`,
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    '', '【本周练习】',
    `练习汉字数：${data.weekChars}`,
    `按键正确率：${displayPercent(data.weekKeyAccuracy)}`,
    `单字首次敲对率：${displayPercent(data.weekFirstTryAccuracy)}`,
    '', '【课文完成率】',
    ...data.progress.map(p => `${p.title}：${p.completion}%`),
    '', '【按键正确率趋势】',
    ...data.trend.map(t => `${t.label}：${displayPercent(t.accuracy)}`),
    '', `累计星星：${data.totalStars}`, `累计小红花：${data.totalFlowers}`,
    `徽章：${data.badges.length} 个`, ...data.badges.map(b => `${b.icon} ${b.title}`),
  ];
  return lines.join('\n');
}
