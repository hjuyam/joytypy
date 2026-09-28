// 奖励只在单字完成时入账；课文完成只负责首次徽章。
export function creditCharacter(reward, flower = false) {
  return { ...reward, totalStars: (reward.totalStars || 0) + 1, totalFlowers: (reward.totalFlowers || 0) + (flower ? 1 : 0) };
}

export function awardFirstCompletion(reward, lesson, at = Date.now()) {
  if (reward.badges.some(b => b.lessonId === lesson.id)) return { reward, badge: null };
  const badge = { lessonId: lesson.id, title: `${lesson.title} · 课文首次完成`, icon: '🏅', awardedAt: at };
  return { reward: { ...reward, badges: [...reward.badges, badge] }, badge };
}
