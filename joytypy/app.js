// 主应用：hash 路由状态机 + 档案 CRUD + 奖励系统 + 设置持久化 + 视图协调
// 调用链：app.js → practice.js → pinyin-engine.js → vendor/pinyin-pro.js
//         app.js → keyboard.js
//         app.js → report.js

import { PracticeSession, PracticeState, PracticeMode } from './practice.js';
import { Keyboard } from './keyboard.js';
import { generateReport, exportReport } from './report.js';

// ============ 常量 ============
const SCHEMA_VERSION = 1;
const AVATARS = ['😊','🐱','🐶','🐰','🦊','🐼','🐯','🦁','🐸','🐵','🦄','🌟'];
const BADGE_TITLES = ['诗词小达人','拼音小能手','键盘小勇士','识字小博士','连击之王'];

// ============ 存储层（localStorage，按 profile 命名空间隔离） ============
const Store = {
  getMeta() {
    try { return JSON.parse(localStorage.getItem('meta')) || { schemaVersion: SCHEMA_VERSION }; }
    catch { return { schemaVersion: SCHEMA_VERSION }; }
  },
  setMeta(m) { localStorage.setItem('meta', JSON.stringify({ ...m, schemaVersion: SCHEMA_VERSION })); },

  getProfileIds() {
    try { return JSON.parse(localStorage.getItem('profileIds')) || []; }
    catch { return []; }
  },
  setProfileIds(ids) { localStorage.setItem('profileIds', JSON.stringify(ids)); },

  getProfile(id) {
    try { const p = JSON.parse(localStorage.getItem(`profile:${id}`)); return p && p.v === 1 ? p : null; }
    catch { return null; }
  },
  setProfile(id, p) { localStorage.setItem(`profile:${id}`, JSON.stringify({ ...p, v: 1 })); },
  delProfile(id) {
    localStorage.removeItem(`profile:${id}`);
    localStorage.removeItem(`reward:${id}`);
    localStorage.removeItem(`settings:${id}`);
    // 清除该 profile 所有 progress
    const keys = Object.keys(localStorage).filter(k => k.startsWith(`progress:${id}:`));
    keys.forEach(k => localStorage.removeItem(k));
  },

  getCurrentProfileId() { return localStorage.getItem('currentProfileId') || null; },
  setCurrentProfileId(id) { localStorage.setItem('currentProfileId', id); },

  getProgress(profileId, lessonId) {
    try { const p = JSON.parse(localStorage.getItem(`progress:${profileId}:${lessonId}`)); return p && p.v === 1 ? p : null; }
    catch { return null; }
  },
  setProgress(profileId, lessonId, p) {
    localStorage.setItem(`progress:${profileId}:${lessonId}`, JSON.stringify({ ...p, v: 1, lastAt: Date.now() }));
  },

  getReward(profileId) {
    try { const r = JSON.parse(localStorage.getItem(`reward:${profileId}`)); return r && r.v === 1 ? r : { v: 1, totalStars: 0, totalFlowers: 0, badges: [], weekly: {} }; }
    catch { return { v: 1, totalStars: 0, totalFlowers: 0, badges: [], weekly: {} }; }
  },
  setReward(profileId, r) { localStorage.setItem(`reward:${profileId}`, JSON.stringify({ ...r, v: 1 })); },

  getSettings(profileId) {
    try { const s = JSON.parse(localStorage.getItem(`settings:${profileId}`)); return s && s.v === 1 ? s : { v: 1, hintLevel: 'always', sound: true, defaultMode: 'pinyin' }; }
    catch { return { v: 1, hintLevel: 'always', sound: true, defaultMode: 'pinyin' }; }
  },
  setSettings(profileId, s) { localStorage.setItem(`settings:${profileId}`, JSON.stringify({ ...s, v: 1 })); },

  getLessonMeta(lessonId) {
    try { const m = JSON.parse(localStorage.getItem(`lesson:${lessonId}`)); return m && m.v === 1 ? m : null; }
    catch { return null; }
  },
  setLessonMeta(lessonId, m) { localStorage.setItem(`lesson:${lessonId}`, JSON.stringify({ ...m, v: 1 })); },
};

// ============ 工具函数 ============
function $(id) { return document.getElementById(id); }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function getWeekKey(ts = Date.now()) {
  const d = new Date(ts); d.setHours(0,0,0,0);
  const day = d.getDay() || 7; // 周日=7
  d.setDate(d.getDate() - day + 1); // 回到周一
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s/60)}m${s%60}s`;
}

// ============ 主应用 ============
class App {
  constructor() {
    this.lessons = [];          // [{ id, title, charCount }]
    this.currentLesson = null;  // 当前选中的课文
    this.session = null;        // PracticeSession
    this.keyboard = null;       // Keyboard
    this.pendingPolyChars = []; // 待校对多音字
    this.polyChoices = {};      // 校对面板选择 { 字: 拼音 }
    this.confirmCallback = null;
    this.selectedAvatar = AVATARS[0];
    this.editingProfileId = null;
    this.audioCtx = null;
    this.init();
  }

  async init() {
    Store.setMeta(Store.getMeta()); // 确保 meta 存在
    this.bindGlobalEvents();
    this.ensureProfile();
    await this.loadLessons();
    this.bindHashRoute();
    this.handleRoute();
  }

  // ============ 全局事件绑定 ============
  bindGlobalEvents() {
    $('current-profile-btn').addEventListener('click', () => this.go('home'));
    $('settings-btn').addEventListener('click', () => this.go('settings'));
    $('add-profile-btn').addEventListener('click', () => this.openProfileModal());
    $('retry-btn').addEventListener('click', () => this.startPractice(this.currentLesson));
    $('back-home-btn').addEventListener('click', () => this.go('home'));
    $('export-btn').addEventListener('click', () => this.handleExport());
    $('print-btn').addEventListener('click', () => window.print());
    $('clear-data-btn').addEventListener('click', () => this.handleClearData());
    $('clear-profile-btn').addEventListener('click', () => this.handleClearData());

    // 底部导航
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => this.go(btn.dataset.route));
    });

    // 设置页选项
    $('hint-level-options').addEventListener('click', e => {
      const btn = e.target.closest('.option-card'); if (!btn) return;
      this.updateSetting('hintLevel', btn.dataset.value);
    });
    $('default-mode-options').addEventListener('click', e => {
      const btn = e.target.closest('.option-card'); if (!btn) return;
      this.updateSetting('defaultMode', btn.dataset.value);
    });
    $('sound-toggle').addEventListener('change', e => this.updateSetting('sound', e.target.checked));

    // 多音字校对面板
    $('poly-default-btn').addEventListener('click', () => this.handlePolyDefault());
    $('poly-confirm-btn').addEventListener('click', () => this.handlePolyConfirm());

    // 通用确认弹窗
    $('confirm-cancel').addEventListener('click', () => this.closeConfirm());
    $('confirm-ok').addEventListener('click', () => this.handleConfirmOk());

    // 档案弹窗
    $('profile-cancel').addEventListener('click', () => this.closeProfileModal());
    $('profile-save').addEventListener('click', () => this.handleProfileSave());

    // 真实键盘输入（全局，仅练习页生效）
    document.addEventListener('keydown', e => {
      if (this.session && this.session.state === PracticeState.PLAYING) {
        const k = e.key.toLowerCase();
        if (/^[a-z]$/.test(k)) {
          e.preventDefault();
          this.handleKeyInput(k);
        }
      }
    });
  }

  // ============ 档案管理 ============
  ensureProfile() {
    let ids = Store.getProfileIds();
    if (ids.length === 0) {
      // 首次 onboarding：创建默认档案
      const id = 'p_' + Date.now();
      const profile = { id, name: '小朋友', avatar: '😊', createdAt: Date.now() };
      Store.setProfile(id, profile);
      Store.setProfileIds([id]);
      Store.setCurrentProfileId(id);
      Store.setReward(id, Store.getReward(id));
      Store.setSettings(id, Store.getSettings(id));
    } else if (!Store.getCurrentProfileId() || !ids.includes(Store.getCurrentProfileId())) {
      Store.setCurrentProfileId(ids[0]);
    }
  }

  getCurrentProfile() {
    const id = Store.getCurrentProfileId();
    return id ? Store.getProfile(id) : null;
  }

  renderProfiles() {
    const list = $('profile-list');
    list.innerHTML = '';
    const ids = Store.getProfileIds();
    const currentId = Store.getCurrentProfileId();
    for (const id of ids) {
      const p = Store.getProfile(id);
      if (!p) continue;
      const reward = Store.getReward(id);
      const card = el('div', 'profile-card' + (id === currentId ? ' active' : ''));
      card.innerHTML = `<span class="pf-avatar">${p.avatar}</span><span class="pf-name">${this.escape(p.name)}</span><span class="pf-stars">⭐${reward.totalStars}</span>`;
      card.addEventListener('click', () => this.switchProfile(id));
      // 长按删除（简化：双击删除）
      let lastTap = 0;
      card.addEventListener('click', () => {
        const now = Date.now();
        if (now - lastTap < 400 && ids.length > 1) this.confirmDeleteProfile(id);
        lastTap = now;
      });
      list.appendChild(card);
    }
    // 更新顶栏当前档案
    const cur = this.getCurrentProfile();
    if (cur) {
      $('current-avatar').textContent = cur.avatar;
      $('current-name').textContent = cur.name;
    }
  }

  switchProfile(id) {
    Store.setCurrentProfileId(id);
    this.renderProfiles();
    this.renderHome();
    this.renderAchievementPreview();
  }

  openProfileModal(editId = null) {
    this.editingProfileId = editId;
    this.selectedAvatar = AVATARS[0];
    $('profile-modal').hidden = false;
    $('profile-name-input').value = editId ? (Store.getProfile(editId)?.name || '') : '';
    $('profile-modal-title').textContent = editId ? '编辑档案' : '新建档案';
    // 渲染头像选择器
    const picker = $('avatar-picker');
    picker.innerHTML = '';
    AVATARS.forEach(a => {
      const btn = el('button', 'avatar-btn' + (a === this.selectedAvatar ? ' selected' : ''), a);
      btn.addEventListener('click', () => {
        this.selectedAvatar = a;
        picker.querySelectorAll('.avatar-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
      picker.appendChild(btn);
    });
  }

  closeProfileModal() {
    $('profile-modal').hidden = true;
    this.editingProfileId = null;
  }

  handleProfileSave() {
    const name = $('profile-name-input').value.trim();
    if (!name) { $('profile-name-input').focus(); return; }
    if (this.editingProfileId) {
      const p = Store.getProfile(this.editingProfileId);
      if (p) { p.name = name; p.avatar = this.selectedAvatar; Store.setProfile(p.id, p); }
    } else {
      const id = 'p_' + Date.now();
      Store.setProfile(id, { id, name, avatar: this.selectedAvatar, createdAt: Date.now() });
      const ids = Store.getProfileIds(); ids.push(id); Store.setProfileIds(ids);
      Store.setCurrentProfileId(id);
      Store.setReward(id, Store.getReward(id));
      Store.setSettings(id, Store.getSettings(id));
    }
    this.closeProfileModal();
    this.renderProfiles();
    this.renderHome();
  }

  confirmDeleteProfile(id) {
    this.showConfirm('删除档案', '确定删除该档案及其所有进度？此操作不可恢复。', () => {
      Store.delProfile(id);
      const ids = Store.getProfileIds().filter(i => i !== id);
      Store.setProfileIds(ids);
      if (Store.getCurrentProfileId() === id) {
        Store.setCurrentProfileId(ids[0] || null);
      }
      if (ids.length === 0) { this.ensureProfile(); }
      this.renderProfiles();
      this.renderHome();
    });
  }

  // ============ 课文加载 ============
  async loadLessons() {
    try {
      const res = await fetch('/api/lessons');
      const data = await res.json();
      this.lessons = (data.lessons || []).map(l => ({ id: l.id, title: l.title, charCount: l.charCount }));
    } catch (e) {
      console.error('加载课文失败', e);
      this.lessons = [];
    }
  }

  async fetchLessonContent(lessonId) {
    const res = await fetch('/api/lessons/' + encodeURIComponent(lessonId));
    if (!res.ok) throw new Error('课文读取失败: ' + res.status);
    return await res.text();
  }

  renderHome() {
    const grid = $('lesson-grid');
    grid.innerHTML = '';
    if (this.lessons.length === 0) {
      grid.appendChild(el('div', 'empty-hint', '暂无课文，请把 .txt 或 .md 文件放入 lessons/ 文件夹'));
      return;
    }
    const pid = Store.getCurrentProfileId();
    for (const lesson of this.lessons) {
      const progress = pid ? Store.getProgress(pid, lesson.id) : null;
      const pct = progress?.completed ? 100 : (progress && lesson.charCount ? Math.round((progress.charIndex / lesson.charCount) * 100) : 0);
      const card = el('div', 'lesson-card');
      card.innerHTML = `
        <div class="lesson-progress-ring" style="--p:${pct}">
          <span class="ring-num">${pct}%</span>
        </div>
        <div class="lesson-info">
          <div class="lesson-title">${this.escape(lesson.title)}</div>
          <div class="lesson-meta">${lesson.charCount} 字${progress?.completed ? ' · ✅ 已完成' : (progress ? ' · 进行中' : '')}</div>
        </div>`;
      card.addEventListener('click', () => this.startPractice(lesson));
      grid.appendChild(card);
    }
  }

  renderAchievementPreview() {
    const pid = Store.getCurrentProfileId();
    const reward = Store.getReward(pid);
    $('total-stars').textContent = reward.totalStars;
    $('total-flowers').textContent = reward.totalFlowers;
    $('total-badges').textContent = reward.badges.length;
  }

  // ============ 练习流程 ============
  async startPractice(lesson) {
    if (!lesson) return;
    this.currentLesson = lesson;
    const pid = Store.getCurrentProfileId();
    const settings = Store.getSettings(pid);
    this.go('practice');

    try {
      const text = await this.fetchLessonContent(lesson.id);
      this.session = new PracticeSession({
        mode: settings.defaultMode,
        hintLevel: settings.hintLevel,
        onStateChange: (s, old) => this.onSessionStateChange(s, old),
        onInput: r => this.onSessionInput(r),
        onReward: r => this.onSessionReward(r),
      });
      const result = this.session.load(text, {}, lesson.id);
      if (result.state === PracticeState.EMPTY_LESSON) {
        this.showConfirm('提示', '这篇课文没有可练习的汉字。', () => this.go('home'));
      } else if (result.state === PracticeState.POLY_CHECK) {
        this.openPolyModal(result.polyChars);
      } else if (result.state === PracticeState.LOADING_FAILED) {
        this.showConfirm('错误', '课文加载失败：' + (result.error || '未知错误'), () => this.go('home'));
      } else if (result.state === PracticeState.PLAYING) {
        this.beginPlaying();
      }
    } catch (e) {
      console.error(e);
      this.showConfirm('错误', '无法加载课文：' + e.message, () => this.go('home'));
    }
  }

  beginPlaying() {
    this.setupKeyboard();
    this.renderContext();
    this.renderCurrentChar();
    this.updateProgress();
    $('topbar-progress').hidden = false;
  }

  setupKeyboard() {
    const pid = Store.getCurrentProfileId();
    const settings = Store.getSettings(pid);
    const area = $('keyboard-area');
    area.innerHTML = '';
    this.keyboard = new Keyboard(area, {
      hintLevel: settings.hintLevel,
      onKey: (k) => this.handleKeyInput(k),
    });
    const target = this.session.getCurrentTargetLetter();
    if (target) this.keyboard.highlight(target);
  }

  // ============ 多音字校对面板 ============
  openPolyModal(polyChars) {
    this.pendingPolyChars = polyChars;
    this.polyChoices = {};
    $('poly-count').textContent = polyChars.length;
    const list = $('poly-list');
    list.innerHTML = '';
    for (const pc of polyChars) {
      this.polyChoices[pc.char] = pc.candidates[0]; // 默认选第一个
      const row = el('div', 'poly-row');
      row.innerHTML = `<span class="poly-char">${pc.char}</span>`;
      const btns = el('div', 'poly-candidates');
      for (const cand of pc.candidates) {
        const b = el('button', 'poly-btn' + (cand === pc.candidates[0] ? ' selected' : ''), cand);
        b.addEventListener('click', () => {
          this.polyChoices[pc.char] = cand;
          btns.querySelectorAll('.poly-btn').forEach(x => x.classList.remove('selected'));
          b.classList.add('selected');
        });
        btns.appendChild(b);
      }
      row.appendChild(btns);
      list.appendChild(row);
    }
    $('poly-modal').hidden = false;
  }

  handlePolyDefault() {
    // 全部使用第一个候选（默认音）
    $('poly-modal').hidden = true;
    this.session.skipPolyCheck();
    this.beginPlaying();
  }

  handlePolyConfirm() {
    $('poly-modal').hidden = true;
    this.session.confirmPolyCheck(this.polyChoices);
    this.beginPlaying();
  }

  // ============ 输入处理（双通道统一） ============
  handleKeyInput(key) {
    if (!this.session || this.session.state !== PracticeState.PLAYING) return;
    const result = this.session.input(key);
    if (!result) return;

    const pid = Store.getCurrentProfileId();
    const settings = Store.getSettings(pid);

    if (result.correct) {
      if (settings.sound) this.playSound('correct');
      if (this.keyboard) this.keyboard.flashCorrect(key);
      if (result.charComplete) {
        this.renderContext();
        if (result.finished) return; // 完成页由 onStateChange 处理
      }
      this.renderCurrentChar();
      const target = this.session.getCurrentTargetLetter();
      if (target && this.keyboard) this.keyboard.highlight(target);
    } else {
      if (settings.sound) this.playSound('wrong');
      if (this.keyboard) this.keyboard.flashError(key);
      if (result.hint && this.keyboard) {
        this.keyboard.showHint(result.target);
      }
      // 错误提示
      $('error-hint').hidden = false;
      clearTimeout(this._hintTimer);
      this._hintTimer = setTimeout(() => { $('error-hint').hidden = true; }, 1500);
    }
    this.updateProgress();
    this.saveProgress();
  }

  // ============ 会话回调 ============
  onSessionStateChange(newState, oldState) {
    if (newState === PracticeState.COMPLETE || newState === PracticeState.REWARD) {
      this.handleComplete();
    }
  }

  onSessionInput(result) {
    // 由 handleKeyInput 统一处理 UI，此处仅用于扩展
  }

  onSessionReward(reward) {
    if (reward.star) this.showRewardFloat('star');
    if (reward.flower) { this.showRewardFloat('flower'); this.fireConfetti(reward.combo); }
    if (reward.badge) { /* 徽章在完成页展示 */ }
  }

  // ============ 渲染 ============
  renderContext() {
    const area = $('context-area');
    area.innerHTML = '';
    const entries = this.session.entries;
    const idx = this.session.currentEntryIndex;
    // 显示当前字前后各 6 个字
    const start = Math.max(0, idx - 6);
    const end = Math.min(entries.length, idx + 7);
    for (let i = start; i < end; i++) {
      const e = entries[i];
      const span = el('span', 'ctx-char');
      if (e.skipped) span.classList.add('ctx-skipped');
      else if (i < idx) span.classList.add('ctx-done');
      else if (i === idx) span.classList.add('ctx-current');
      span.textContent = e.char;
      area.appendChild(span);
    }
    // 滚动到当前字
    const cur = area.querySelector('.ctx-current');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }

  renderCurrentChar() {
    const entry = this.session.getCurrentEntry();
    if (!entry) return;
    const settings = Store.getSettings(Store.getCurrentProfileId());
    const mode = this.session.mode;

    if (mode === PracticeMode.KEY) {
      // 键位启蒙：仅显示当前字母
      $('char-pinyin').textContent = '';
      $('char-hanzi').textContent = '';
      $('char-typed').textContent = (entry.spelling.slice(0, entry.typedIndex) + '▌').toUpperCase();
    } else {
      $('char-pinyin').textContent = entry.toned || entry.spelling;
      $('char-hanzi').textContent = entry.char;
      $('char-typed').textContent = entry.spelling.slice(0, entry.typedIndex).toUpperCase();
    }
  }

  updateProgress() {
    const p = this.session.getProgress();
    $('progress-fill').style.width = p.percent + '%';
    $('progress-text').textContent = `${p.current} / ${p.total}`;
    const cb = $('combo-badge');
    if (p.combo >= 3) { cb.hidden = false; $('combo-num').textContent = p.combo; }
    else { cb.hidden = true; }
  }

  saveProgress() {
    if (!this.currentLesson) return;
    const pid = Store.getCurrentProfileId();
    const p = this.session.getProgress();
    Store.setProgress(pid, this.currentLesson.id, {
      charIndex: p.current,
      stars: p.stars,
      flowers: p.flowers,
      combo: p.combo,
      completed: this.session.state === PracticeState.REWARD || this.session.state === PracticeState.COMPLETE,
    });
  }

  // ============ 完成处理 ============
  handleComplete() {
    const stats = this.session.getStats();
    const pid = Store.getCurrentProfileId();

    // 更新奖励
    const reward = Store.getReward(pid);
    reward.totalStars += stats.stars;
    reward.totalFlowers += stats.flowers;
    // 徽章：根据完成次数颁发
    const badgeCount = reward.badges.length;
    const newBadgeIdx = badgeCount < BADGE_TITLES.length ? badgeCount : -1;
    let newBadge = null;
    if (newBadgeIdx >= 0) {
      newBadge = { title: BADGE_TITLES[newBadgeIdx], icon: '🏅', awardedAt: Date.now() };
      reward.badges.push(newBadge);
    }
    // 周维度统计
    const wk = getWeekKey();
    reward.weekly[wk] = (reward.weekly[wk] || 0) + stats.charCount;
    Store.setReward(pid, reward);

    // 保存完成进度
    this.saveProgress();

    // 渲染完成页
    this.renderComplete(stats, newBadge);
    this.go('complete');
    $('topbar-progress').hidden = true;
    if (this.keyboard) { this.keyboard.destroy(); this.keyboard = null; }
  }

  renderComplete(stats, newBadge) {
    $('complete-title').textContent = newBadge ? newBadge.title : '太棒了！';
    $('badge-pop').textContent = newBadge ? newBadge.icon : '🎉';
    // 正确率圆环
    const ring = $('accuracy-ring');
    const r = 34, c = 2 * Math.PI * r;
    ring.style.strokeDasharray = c;
    ring.style.strokeDashoffset = c * (1 - stats.accuracy / 100);
    $('stat-accuracy').textContent = stats.accuracy + '%';
    $('stat-duration').textContent = fmtDuration(stats.duration);
    $('stat-flowers').textContent = stats.flowers;
    $('stat-stars').textContent = stats.stars;
  }

  // ============ 奖励动画 ============
  showRewardFloat(type) {
    const overlay = $('reward-overlay');
    const star = $('reward-star');
    const flower = $('reward-flower');
    if (type === 'star') {
      star.hidden = false; flower.hidden = true;
    } else {
      star.hidden = true; flower.hidden = false;
    }
    overlay.hidden = false;
    overlay.classList.remove('show');
    void overlay.offsetWidth;
    overlay.classList.add('show');
    setTimeout(() => { overlay.hidden = true; }, 800);
  }

  fireConfetti(combo) {
    const c = $('confetti');
    c.hidden = false;
    c.innerHTML = '';
    for (let i = 0; i < 30; i++) {
      const piece = el('span', 'confetti-piece');
      piece.style.left = Math.random() * 100 + '%';
      piece.style.background = ['#FF6B6B','#FFD93D','#6C5CE7','#00B894','#74B9FF'][i % 5];
      piece.style.animationDelay = (Math.random() * 0.3) + 's';
      piece.style.animationDuration = (1 + Math.random()) + 's';
      c.appendChild(piece);
    }
    setTimeout(() => { c.hidden = true; c.innerHTML = ''; }, 2000);
  }

  // ============ 音效（WebAudio，无外部文件） ============
  playSound(type) {
    try {
      if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      if (type === 'correct') {
        osc.frequency.value = 880; osc.type = 'sine';
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start(); osc.stop(ctx.currentTime + 0.15);
      } else {
        osc.frequency.value = 200; osc.type = 'square';
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.start(); osc.stop(ctx.currentTime + 0.2);
      }
    } catch (e) { /* 静默失败 */ }
  }

  // ============ 设置 ============
  updateSetting(key, value) {
    const pid = Store.getCurrentProfileId();
    const s = Store.getSettings(pid);
    s[key] = value;
    Store.setSettings(pid, s);
    this.renderSettings();
    if (this.keyboard && key === 'hintLevel') this.keyboard.setHintLevel(value);
  }

  renderSettings() {
    const pid = Store.getCurrentProfileId();
    const s = Store.getSettings(pid);
    // 高亮选中卡片
    document.querySelectorAll('#hint-level-options .option-card').forEach(b => {
      b.classList.toggle('selected', b.dataset.value === s.hintLevel);
    });
    document.querySelectorAll('#default-mode-options .option-card').forEach(b => {
      b.classList.toggle('selected', b.dataset.value === s.defaultMode);
    });
    $('sound-toggle').checked = !!s.sound;
  }

  // ============ 报告页 ============
  renderReport() {
    const pid = Store.getCurrentProfileId();
    const data = generateReport(pid, Store, this.lessons);
    $('week-chars').textContent = data.weekChars;
    $('week-completion').textContent = data.weekCompletion + '%';
    $('week-accuracy').textContent = data.weekAccuracy + '%';
    // 趋势图
    const chart = $('trend-chart');
    chart.innerHTML = '';
    if (data.trend.length === 0) {
      chart.appendChild(el('div', 'empty-hint', '暂无练习数据'));
    } else {
      const maxVal = Math.max(...data.trend.map(d => d.accuracy), 100);
      data.trend.forEach(d => {
        const bar = el('div', 'trend-bar');
        const h = Math.round((d.accuracy / maxVal) * 100);
        bar.innerHTML = `<div class="trend-fill" style="height:${h}%"></div><span class="trend-label">${d.accuracy}%</span><span class="trend-date">${d.label}</span>`;
        chart.appendChild(bar);
      });
    }
    // 奖励列表
    const rList = $('reward-list');
    rList.innerHTML = '';
    const reward = Store.getReward(pid);
    rList.appendChild(this.makeRewardRow('⭐', '累计星星', reward.totalStars));
    rList.appendChild(this.makeRewardRow('🌸', '累计小红花', reward.totalFlowers));
    for (const b of reward.badges) {
      rList.appendChild(this.makeRewardRow(b.icon, b.title, '已获得'));
    }
  }

  makeRewardRow(icon, label, val) {
    const row = el('div', 'reward-row');
    row.innerHTML = `<span class="rw-icon">${icon}</span><span class="rw-label">${this.escape(label)}</span><span class="rw-val">${val}</span>`;
    return row;
  }

  handleExport() {
    const pid = Store.getCurrentProfileId();
    const profile = Store.getProfile(pid);
    const data = generateReport(pid, Store, this.lessons);
    const txt = exportReport(profile, data);
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a'); a.href = url; a.download = `敲敲乐报告_${profile.name}_${getWeekKey()}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  handleClearData() {
    const profile = this.getCurrentProfile();
    this.showConfirm('清除数据', `确定清除「${profile.name}」的所有练习进度和奖励？此操作不可恢复。`, () => {
      const pid = profile.id;
      // 清除 progress
      Object.keys(localStorage).filter(k => k.startsWith(`progress:${pid}:`)).forEach(k => localStorage.removeItem(k));
      Store.setReward(pid, { v: 1, totalStars: 0, totalFlowers: 0, badges: [], weekly: {} });
      this.renderHome();
      this.renderAchievementPreview();
      if (this.currentRoute === 'report') this.renderReport();
    });
  }

  // ============ 通用确认弹窗 ============
  showConfirm(title, msg, callback) {
    $('confirm-title').textContent = title;
    $('confirm-msg').textContent = msg;
    this.confirmCallback = callback;
    $('confirm-modal').hidden = false;
  }

  closeConfirm() {
    $('confirm-modal').hidden = true;
    this.confirmCallback = null;
  }

  handleConfirmOk() {
    $('confirm-modal').hidden = true;
    if (this.confirmCallback) { const cb = this.confirmCallback; this.confirmCallback = null; cb(); }
  }

  // ============ 路由 ============
  bindHashRoute() {
    window.addEventListener('hashchange', () => this.handleRoute());
  }

  go(route) {
    window.location.hash = '#/' + route;
  }

  get currentRoute() {
    const h = window.location.hash.replace(/^#\/?/, '') || 'home';
    return h;
  }

  handleRoute() {
    const route = this.currentRoute;
    this.currentRouteName = route;
    // 切换视图
    document.querySelectorAll('.view').forEach(v => {
      v.hidden = v.dataset.route !== route;
    });
    // 底部导航高亮
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.route === route);
    });
    // 顶栏进度仅在练习页显示
    if (route !== 'practice') $('topbar-progress').hidden = true;

    // 视图初始化
    if (route === 'home') {
      this.renderProfiles();
      this.renderHome();
      this.renderAchievementPreview();
    } else if (route === 'settings') {
      this.renderSettings();
    } else if (route === 'report') {
      this.renderReport();
    } else if (route === 'practice') {
      // 由 startPractice 驱动
    } else if (route === 'complete') {
      // 由 handleComplete 驱动
    }
  }

  // ============ 安全转义 ============
  escape(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
}

// 启动
const app = new App();
window.__app = app; // 调试用
