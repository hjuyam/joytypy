// 家长报告：聚合 progress/reward 数据，按周维度计算，支持导出
// 调用方：app.js

/** 计算给定时间戳所在自然周的周一日期键（YYYY-MM-DD） */
export function getWeekKey(ts = Date.now()) {
  const d = new Date(ts); d.setHours(0,0,0,0);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/**
 * 生成报告数据
 * @param {string} profileId
 * @param {object} store Store 接口（getProgress/getReward/getProfileIds 等）
 * @param {Array} lessons 课文列表 [{ id, title, charCount }]
 * @returns {{ weekChars, weekCompletion, weekAccuracy, trend: [{label, accuracy}], totalStars, totalFlowers, badges }}
 */
export function generateReport(profileId, store, lessons = []) {
  const reward = store.getReward(profileId);
  const weekKey = getWeekKey();

  // 本周概览
  const weekChars = reward.weekly?.[weekKey] || 0;

  // 遍历该 profile 所有 progress，计算完成率与正确率
  let totalCompletion = 0, completionCount = 0;
  let totalAccuracy = 0, accuracyCount = 0;
  const trendMap = {}; // { weekKey: { correct, errors } }

  // 从 localStorage 直接读取（store 不暴露遍历，这里用全局 localStorage）
  const prefix = `progress:${profileId}:`;
  const allKeys = Object.keys(localStorage).filter(k => k.startsWith(prefix));
  for (const key of allKeys) {
    try {
      const p = JSON.parse(localStorage.getItem(key));
      if (!p || p.v !== 1) continue;
      const lessonId = key.slice(prefix.length);
      const lesson = lessons.find(l => l.id === lessonId);
      if (lesson && lesson.charCount > 0) {
        const pct = p.completed ? 100 : Math.round((p.charIndex / lesson.charCount) * 100);
        totalCompletion += pct; completionCount++;
      }
      // 正确率无法从 progress 直接得到（progress 不存 errors），用星星/字数近似
      // 这里用完成率作为趋势的近似指标
      const wk = getWeekKey(p.lastAt || Date.now());
      if (!trendMap[wk]) trendMap[wk] = { sum: 0, count: 0 };
      const pct = lesson && lesson.charCount > 0 ? (p.completed ? 100 : Math.round((p.charIndex / lesson.charCount) * 100)) : 0;
      trendMap[wk].sum += pct; trendMap[wk].count++;
    } catch {}
  }

  const weekCompletion = completionCount > 0 ? Math.round(totalCompletion / completionCount) : 0;
  const weekAccuracy = accuracyCount > 0 ? Math.round(totalAccuracy / accuracyCount) : weekCompletion;

  // 趋势：最近 4 周
  const trend = [];
  const now = new Date();
  for (let i = 3; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i * 7);
    const wk = getWeekKey(d.getTime());
    const t = trendMap[wk];
    const label = `${d.getMonth()+1}/${d.getDate()}`;
    const accuracy = t && t.count > 0 ? Math.round(t.sum / t.count) : 0;
    trend.push({ label, accuracy });
  }

  return {
    weekChars,
    weekCompletion,
    weekAccuracy,
    trend,
    totalStars: reward.totalStars,
    totalFlowers: reward.totalFlowers,
    badges: reward.badges || [],
  };
}

/**
 * 导出报告为纯文本
 */
export function exportReport(profile, data) {
  const lines = [];
  lines.push('=================================');
  lines.push('       敲敲乐 · 家长报告');
  lines.push('=================================');
  lines.push(`小朋友：${profile.name} ${profile.avatar}`);
  lines.push(`生成时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push('');
  lines.push('【本周概览】');
  lines.push(`  练习汉字数：${data.weekChars}`);
  lines.push(`  平均完成率：${data.weekCompletion}%`);
  lines.push(`  平均正确率：${data.weekAccuracy}%`);
  lines.push('');
  lines.push('【正确率趋势】');
  for (const t of data.trend) {
    lines.push(`  ${t.label}：${t.accuracy}%`);
  }
  lines.push('');
  lines.push('【累计奖励】');
  lines.push(`  ⭐ 星星：${data.totalStars}`);
  lines.push(`  🌸 小红花：${data.totalFlowers}`);
  lines.push(`  🏅 徽章：${data.badges.length} 个`);
  for (const b of data.badges) {
    lines.push(`    - ${b.icon} ${b.title}`);
  }
  lines.push('');
  lines.push('=================================');
  return lines.join('\n');
}
