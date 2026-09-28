// 主应用：hash 路由状态机 + 档案 CRUD + 奖励系统 + 设置持久化 + 视图协调
// 调用链：app.js → practice.js → pinyin-engine.js → vendor/pinyin-pro.js
//         app.js → keyboard.js
//         app.js → report.js

import { PracticeSession, PracticeState, PracticeMode } from './practice.js';
import { Keyboard } from './keyboard.js';
import { generateReport, exportReport } from './report.js';
import { creditCharacter, awardFirstCompletion } from './accounting.js';
import { addImportedLesson, createBackup, getImportedLessons, restoreBackup, validateBackup } from './portable-data.js';

// ============ 常量 ============
const SCHEMA_VERSION = 1;
const AVATARS = ['😊','🐱','🐶','🐰','🦊','🐼','🐯','🦁','🐸','🐵','🦄','🌟'];

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
    const keys = Object.keys(localStorage).filter(k => k.startsWith(`progress:${id}:`) || k === `activity:${id}`);
    keys.forEach(k => localStorage.removeItem(k));
    // 同步从 profileIds 移除，保持存储层自洽
    const ids = this.getProfileIds().filter(i => i !== id);
    this.setProfileIds(ids);
  },

  getCurrentProfileId() { return localStorage.getItem('currentProfileId') || null; },
  setCurrentProfileId(id) { localStorage.setItem('currentProfileId', id); },

  getProgress(profileId, lessonId, mode) {
    try {
      const current = localStorage.getItem(`progress:${profileId}:${lessonId}:${mode}`);
      // 旧版未记录模式；只在默认的拼音双练中兼容，避免旧进度串到其他模式。
      const legacy = mode === PracticeMode.PINYIN ? localStorage.getItem(`progress:${profileId}:${lessonId}`) : null;
      const p = JSON.parse(current || legacy);
      return p && p.v === 1 ? p : null;
    }
    catch { return null; }
  },
  setProgress(profileId, lessonId, mode, p) {
    localStorage.setItem(`progress:${profileId}:${lessonId}:${mode}`, JSON.stringify({ ...p, v: 1, lastAt: Date.now() }));
  },
  getActivities(profileId) {
    try { return JSON.parse(localStorage.getItem(`activity:${profileId}`)) || []; } catch { return []; }
  },
  saveActivity(profileId, item) {
    const items = this.getActivities(profileId);
    const i = items.findIndex(x => x.id === item.id);
    if (i < 0) items.push(item); else items[i] = item;
    localStorage.setItem(`activity:${profileId}`, JSON.stringify(items));
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
function contentFingerprint(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return `${text.length}:${h >>> 0}`;
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
    this.activityId = null;
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
    if (this.currentRoute === 'practice' || this.currentRoute === 'complete') this.go('home');
    this.handleRoute();
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('./service-worker.js').catch(e => console.warn('离线缓存未启用', e));
    }
  }

  // ============ 全局事件绑定 ============
  bindGlobalEvents() {
    $('current-profile-btn').addEventListener('click', () => this.go('home'));
    $('settings-btn').addEventListener('click', () => this.go('settings'));
    $('add-profile-btn').addEventListener('click', () => this.openProfileModal());
    $('import-lessons-btn').addEventListener('click', () => $('lesson-files').click());
    $('lesson-files').addEventListener('change', e => this.handleLessonFiles(e.target));
    $('backup-export-btn').addEventListener('click', () => this.downloadBackup());
    $('backup-import-btn').addEventListener('click', () => $('backup-file').click());
    $('backup-file').addEventListener('change', e => this.handleBackupFile(e.target));
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
      card.innerHTML = `<span class="pf-avatar">${p.avatar}</span><span class="pf-name">${this.escape(p.name)}</span><span class="pf-stars">⭐${reward.totalStars}</span><div class="pf-actions"><button class="pf-action-btn pf-edit-btn" title="编辑档案" aria-label="编辑档案">✎</button>${ids.length > 1 ? `<button class="pf-action-btn pf-del-btn" title="删除档案" aria-label="删除档案">🗑️</button>` : ''}</div>`;
      card.addEventListener('click', () => this.switchProfile(id));
      card.querySelector('.pf-edit-btn').addEventListener('click', (e) => { e.stopPropagation(); this.openProfileModal(id); });
      const delBtn = card.querySelector('.pf-del-btn');
      if (delBtn) delBtn.addEventListener('click', (e) => { e.stopPropagation(); this.confirmDeleteProfile(id); });
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
    this.renderAchievementPreview();
  }

  confirmDeleteProfile(id) {
    this.showConfirm('删除档案', '确定删除该档案及其所有进度？此操作不可恢复。', () => {
      Store.delProfile(id);
      const ids = Store.getProfileIds(); // 已由 delProfile 同步更新
      if (Store.getCurrentProfileId() === id) {
        Store.setCurrentProfileId(ids[0] || null);
      }
      if (ids.length === 0) { this.ensureProfile(); }
      this.renderProfiles();
      this.renderHome();
      this.renderAchievementPreview();
    });
  }

  // ============ 课文加载 ============
  async loadLessons() {
    let list = [];
    const localNode = location.hostname === '127.0.0.1' && location.port === '5173';
    if (localNode) {
      try {
        const res = await fetch('./api/lessons');
        if (!res.ok) throw new Error(`课文 API ${res.status}`);
        const data = await res.json();
        list = Array.isArray(data) ? data : (data.lessons || []);
      } catch (e) { console.warn('本地课文接口不可用，改用内置目录', e); }
    }
    if (!list.length) {
      // HTTPS 静态托管没有 Node API，读取随应用发布的课程目录。
      try {
        const res = await fetch('./lessons/catalog.json');
        if (!res.ok) throw new Error(`课程目录 ${res.status}`);
        list = await res.json();
      } catch (e) { console.error('加载内置课文失败', e); }
    }
    this.lessons = [
      ...list.map(l => ({
        id: l.id || l.name,
        title: l.title || (l.name || l.id).replace(/\.(txt|md)$/i, ''),
        charCount: l.charCount ?? l.chars ?? 0,
      })),
      ...getImportedLessons().map(({ id, title, charCount }) => ({ id, title, charCount, imported: true })),
    ];
  }

  async fetchLessonContent(lessonId) {
    if (lessonId.startsWith('imported:')) {
      const lesson = getImportedLessons().find(l => l.id === lessonId);
      if (!lesson) throw new Error('导入的课文已不在此浏览器中，请从备份恢复');
      return lesson.text;
    }
    const url = lessonId.includes('/') ? null : './lessons/' + encodeURIComponent(lessonId);
    if (!url) throw new Error('课文名称无效');
    const res = await fetch(url);
    if (!res.ok) throw new Error('课文读取失败: ' + res.status);
    return await res.text();
  }

  async handleLessonFiles(input) {
    const files = [...input.files];
    input.value = '';
    let added = 0;
    const errors = [];
    for (const file of files) {
      try {
        if (file.size > 256 * 1024) throw new Error('单篇课文不能超过 256 KB');
        addImportedLesson(file.name, await file.text());
        added++;
      } catch (e) { errors.push(`${file.name}：${e.message}`); }
    }
    await this.loadLessons();
    this.renderHome();
    this.showConfirm('课文导入', `已处理 ${added} 篇课文。${errors.length ? '未导入：' + errors.join('；') : ''}`, () => {});
  }

  downloadBackup() {
    const backup = createBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url;
    a.download = `敲敲乐备份_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async handleBackupFile(input) {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('备份文件不能超过 20 MB');
      const backup = JSON.parse(await file.text());
      validateBackup(backup);
      this.showConfirm('导入备份', '导入会覆盖同名档案和进度。确认后会先下载当前数据备份，再恢复所选文件。', () => {
        try {
          this.downloadBackup();
          restoreBackup(backup);
          window.location.reload();
        } catch (e) { this.showConfirm('恢复失败', e.message, () => {}); }
      });
    } catch (e) { this.showConfirm('备份无效', e.message, () => {}); }
  }

  renderHome() {
    const grid = $('lesson-grid');
    grid.innerHTML = '';
    if (this.lessons.length === 0) {
      grid.appendChild(el('div', 'empty-hint', '暂无课文，请导入 .txt 或 .md 文件'));
      return;
    }
    const pid = Store.getCurrentProfileId();
    for (const lesson of this.lessons) {
      const progress = pid ? Store.getProgress(pid, lesson.id, Store.getSettings(pid).defaultMode) : null;
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
    this.activityId = null;
    this.lastActivityStats = null;
    this.session = null;
    if (this.keyboard) { this.keyboard.destroy(); this.keyboard = null; }
    $('keyboard-area').innerHTML = '';
    $('char-pinyin').textContent = '';
    $('char-hanzi').textContent = '';
    $('char-typed').textContent = '';
    const pid = Store.getCurrentProfileId();
    const settings = Store.getSettings(pid);
    this.go('practice');

    try {
      const text = await this.fetchLessonContent(lesson.id);
      this.currentLessonFingerprint = contentFingerprint(text);
      this.lessonWasCompleted = [PracticeMode.KEY, PracticeMode.PINYIN, PracticeMode.READING]
        .some(mode => { const p = Store.getProgress(pid, lesson.id, mode); return p?.completed || p?.everCompleted; });
      this.session = new PracticeSession({
        mode: settings.defaultMode,
        hintLevel: settings.hintLevel,
        onStateChange: (s, old) => this.onSessionStateChange(s, old),
        onInput: r => this.onSessionInput(r),
        onReward: r => this.onSessionReward(r),
      });
      const savedMeta = Store.getLessonMeta(lesson.id);
      const overrides = savedMeta && (!savedMeta.fingerprint || savedMeta.fingerprint === this.currentLessonFingerprint) ? savedMeta.overrides : {};
      const result = this.session.load(text, overrides || {}, lesson.id);
      if (result.state === PracticeState.EMPTY_LESSON) {
        this.showConfirm('提示', '这篇课文没有可练习的汉字。', () => this.go('home'));
      } else if (result.state === PracticeState.POLY_CHECK) {
        this.openPolyModal(result.polyChars);
      } else if (result.state === PracticeState.LOADING_FAILED) {
        this.showConfirm('错误', '课文加载失败：' + (result.error || '未知错误'), () => this.go('home'));
      } else if (result.state === PracticeState.PLAYING) {
        this.offerResumeOrStart();
      }
    } catch (e) {
      console.error(e);
      this.showConfirm('错误', '无法加载课文：' + e.message, () => this.go('home'));
    }
  }

  beginPlaying(activityId = null) {
    this.activityId = activityId || `a${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const stats = this.session.getStats();
    this.lastActivityStats = { correctKeys: stats.correctKeys, wrongKeys: stats.totalErrors, completedChars: stats.totalCorrect, firstTryChars: stats.firstTryChars };
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
      this.polyChoices[pc.index] = pc.candidates[pc.defaultIdx];
      const row = el('div', 'poly-row');
      row.innerHTML = `<span class="poly-char">${pc.char}</span><small>${this.escape(pc.context)}（第 ${pc.index + 1} 字）</small>`;
      const btns = el('div', 'poly-candidates');
      for (const cand of pc.candidates) {
        const b = el('button', 'poly-btn' + (cand === pc.candidates[pc.defaultIdx] ? ' selected' : ''), cand);
        b.addEventListener('click', () => {
          this.polyChoices[pc.index] = cand;
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
    this.savePolyChoices(Object.fromEntries(this.pendingPolyChars.map(p => [p.index, p.candidates[p.defaultIdx]])));
    if (!this.activityId) this.offerResumeOrStart(); else this.renderCurrentChar();
  }

  handlePolyConfirm() {
    $('poly-modal').hidden = true;
    this.session.confirmPolyCheck(this.polyChoices);
    this.savePolyChoices(this.polyChoices);
    if (!this.activityId) this.offerResumeOrStart(); else this.renderCurrentChar();
  }

  savePolyChoices(choices) {
    const id = this.currentLesson.id;
    const meta = Store.getLessonMeta(id) || {};
    Store.setLessonMeta(id, { ...meta, fingerprint: this.currentLessonFingerprint, overrides: { ...meta.overrides, byIndex: { ...meta.overrides?.byIndex, ...choices } } });
  }

  offerResumeOrStart() {
    const pid = Store.getCurrentProfileId();
    const saved = Store.getProgress(pid, this.currentLesson.id, this.session.mode);
    if (saved && (!saved.fingerprint || saved.fingerprint === this.currentLessonFingerprint) && !saved.completed && (saved.charIndex > 0 || saved.typedIndex > 0)) {
      $('resume-modal').hidden = false;
      $('resume-progress').textContent = `${saved.charIndex} / ${this.session.entries.length}`;
      $('resume-continue').onclick = () => { $('resume-modal').hidden = true; this.session.resumeFromProgress(saved); this.beginPlaying(saved.activityId); };
      $('resume-restart').onclick = () => { $('resume-modal').hidden = true; this.beginPlaying(); };
    } else this.beginPlaying();
  }

  // ============ 输入处理（双通道统一） ============
  handleKeyInput(key) {
    if (!this.session || this.session.state !== PracticeState.PLAYING) return;
    const result = this.session.input(key);
    if (!result) return;

    const pid = Store.getCurrentProfileId();
    const settings = Store.getSettings(pid);

    if (result.charComplete) {
      Store.setReward(pid, creditCharacter(Store.getReward(pid), !!result.reward?.flower));
    }
    this.recordActivity();

    if (result.correct) {
      if (settings.sound) this.playSound('correct');
      if (this.keyboard) this.keyboard.flashCorrect(key);
      if (result.charComplete) {
        this.renderContext();
        if (result.finished) { this.saveProgress(); this.handleComplete(); return; }
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

  recordActivity() {
    const stats = this.session.getStats();
    const pid = Store.getCurrentProfileId();
    const at = Date.now();
    const id = `${this.activityId}:${getWeekKey(at)}`;
    const old = Store.getActivities(pid).find(a => a.id === id) || {};
    const next = { correctKeys: stats.correctKeys, wrongKeys: stats.totalErrors, completedChars: stats.totalCorrect, firstTryChars: stats.firstTryChars };
    const item = { id, at, lessonId: this.currentLesson.id, mode: this.session.mode, completed: this.session.state === PracticeState.REWARD };
    for (const [field, value] of Object.entries(next)) item[field] = (old[field] || 0) + Math.max(0, value - (this.lastActivityStats?.[field] || 0));
    Store.saveActivity(pid, item);
    this.lastActivityStats = next;
  }

  // ============ 会话回调 ============
  onSessionStateChange(newState, oldState) {
    if (newState === PracticeState.POLY_CHECK && oldState === PracticeState.PLAYING) this.openPolyModal(this.session.getPendingPolyChars());
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
    area.replaceChildren();
    const passage = this.session.getCurrentPassage();
    area.hidden = !passage;
    if (!passage) return;
    const idx = this.session.currentEntryIndex;
    let entryIndex = passage.start;
    area.setAttribute('aria-label', `当前诗句：${passage.text.replace(/\s+/g, '')}`);
    for (const c of passage.text) {
      if (!/[一-龥]/.test(c)) {
        area.appendChild(c === '\n' ? document.createElement('br') : document.createTextNode(c));
        continue;
      }
      const span = el('span', 'ctx-char');
      if (this.session.entries[entryIndex]?.skipped) span.classList.add('ctx-skipped');
      else if (entryIndex < idx) span.classList.add('ctx-done');
      else if (entryIndex === idx) { span.classList.add('ctx-current'); span.setAttribute('aria-current', 'true'); }
      span.textContent = c;
      area.appendChild(span);
      entryIndex++;
    }
  }

  renderCurrentChar() {
    const entry = this.session.getCurrentEntry();
    if (!entry) return;
    const mode = this.session.mode;

    if (mode === PracticeMode.KEY) {
      // 键位启蒙：仅显示当前字母
      $('char-pinyin').textContent = '';
      $('char-hanzi').textContent = (this.session.getCurrentTargetLetter() || '').toUpperCase();
      $('char-typed').textContent = '';
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
    const entry = this.session.getCurrentEntry();
    const stats = this.session.getStats();
    Store.setProgress(pid, this.currentLesson.id, this.session.mode, {
      charIndex: p.current,
      typedIndex: entry?.typedIndex || 0,
      currentErrors: entry?.errors || 0,
      totalErrors: stats.totalErrors,
      correctKeys: stats.correctKeys,
      totalCorrect: stats.totalCorrect,
      firstTryChars: stats.firstTryChars,
      elapsedMs: stats.duration,
      checkedSegments: [...this.session.checkedSegments],
      activityId: this.activityId,
      fingerprint: this.currentLessonFingerprint,
      stars: p.stars,
      flowers: p.flowers,
      combo: p.combo,
      maxCombo: p.maxCombo,
      completed: this.session.state === PracticeState.REWARD || this.session.state === PracticeState.COMPLETE,
      everCompleted: this.lessonWasCompleted || this.session.state === PracticeState.REWARD,
    });
  }

  // ============ 完成处理 ============
  handleComplete() {
    const stats = this.session.getStats();
    const pid = Store.getCurrentProfileId();

    // 奖励按每个完成字即时入账；完成这里只颁发本课文首次徽章。
    const originalReward = Store.getReward(pid);
    const { reward, badge: newBadge } = this.lessonWasCompleted
      ? { reward: originalReward, badge: null }
      : awardFirstCompletion(originalReward, this.currentLesson);
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
    $('week-completion').textContent = data.weekCompletion === null ? '暂无记录' : data.weekCompletion + '%';
    $('week-accuracy').textContent = data.weekKeyAccuracy === null ? '暂无记录' : data.weekKeyAccuracy + '%';
    $('week-first-try').textContent = data.weekFirstTryAccuracy === null ? '暂无记录' : data.weekFirstTryAccuracy + '%';
    // 趋势图
    const chart = $('trend-chart');
    chart.innerHTML = '';
    if (data.trend.every(d => d.accuracy === null)) {
      chart.appendChild(el('div', 'empty-hint', '暂无练习数据'));
    } else {
      const maxVal = 100;
      data.trend.forEach(d => {
        const bar = el('div', 'trend-bar');
        const h = Math.round(((d.accuracy || 0) / maxVal) * 100);
        bar.innerHTML = `<div class="trend-fill" style="height:${h}%"></div><span class="trend-label">${d.accuracy === null ? '—' : d.accuracy + '%'}</span><span class="trend-date">${d.label}</span>`;
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
      Object.keys(localStorage).filter(k => k.startsWith(`progress:${pid}:`) || k === `activity:${pid}`).forEach(k => localStorage.removeItem(k));
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

export { Store };
if (typeof document !== 'undefined') {
  const app = new App();
  window.__app = app; // 本地调试与浏览器验收
}
