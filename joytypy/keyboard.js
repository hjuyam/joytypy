// 模拟键盘：QWERTY 布局渲染、目标键高亮三档、正确绿/错误红抖反馈
// 数据与视图分离，双通道输入统一（真实键盘 keydown 与模拟键盘点击都回调 onKey）

const ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm']
];

export class Keyboard {
  /**
   * @param {HTMLElement} container 键盘容器
   * @param {Object} options
   * @param {function(string):void} options.onKey 按键回调（真实键盘与点击统一）
   * @param {'always'|'onError'|'off'} options.hintLevel 高亮档位
   */
  constructor(container, options = {}) {
    this.container = container;
    this.onKey = options.onKey || (() => {});
    this.hintLevel = options.hintLevel || 'always';
    this.buttons = new Map();
    this.render();
  }

  /** 渲染 QWERTY 键盘（一次性创建 DOM） */
  render() {
    this.container.innerHTML = '';
    this.buttons.clear();
    for (const row of ROWS) {
      const rowEl = document.createElement('div');
      rowEl.className = 'kb-row';
      for (const key of row) {
        const btn = document.createElement('button');
        btn.className = 'kb-key';
        btn.type = 'button';
        btn.textContent = key.toUpperCase();
        btn.dataset.key = key;
        btn.setAttribute('aria-label', `字母 ${key.toUpperCase()}`);
        // 点击/触摸统一回调
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          this.onKey(key);
        });
        rowEl.appendChild(btn);
        this.buttons.set(key, btn);
      }
      this.container.appendChild(rowEl);
    }
  }

  /**
   * 高亮目标键（根据 hintLevel 档位）
   * @param {string} key 目标字母（小写）
   */
  highlight(key) {
    this.clearHighlight();
    if (this.hintLevel === 'off') return;
    if (this.hintLevel === 'onError') return; // 仅错误时提示，不常亮
    const btn = this.buttons.get(key);
    if (btn) btn.classList.add('kb-target');
  }

  /** 正确反馈：键变绿 */
  flashCorrect(key) {
    const btn = this.buttons.get(key);
    if (btn) {
      btn.classList.add('kb-correct');
      btn.classList.remove('kb-error');
      setTimeout(() => btn.classList.remove('kb-correct'), 350);
    }
  }

  /** 错误反馈：键变红 + 抖动 */
  flashError(key) {
    const btn = this.buttons.get(key);
    if (btn) {
      btn.classList.add('kb-error');
      btn.classList.remove('kb-correct');
      // 触发抖动动画（移除再添加以重启动画）
      btn.classList.remove('kb-shake');
      void btn.offsetWidth;
      btn.classList.add('kb-shake');
      setTimeout(() => {
        btn.classList.remove('kb-error');
        btn.classList.remove('kb-shake');
      }, 500);
    }
  }

  /**
   * 错误累积提示：临时高亮正确键 1 秒（覆盖难度设置）
   * @param {string} correctKey 正确字母
   */
  showHint(correctKey) {
    const btn = this.buttons.get(correctKey);
    if (btn) {
      btn.classList.add('kb-hint');
      setTimeout(() => btn.classList.remove('kb-hint'), 1000);
    }
  }

  /** 清除所有高亮 */
  clearHighlight() {
    for (const btn of this.buttons.values()) {
      btn.classList.remove('kb-target');
    }
  }

  /** 设置高亮档位 */
  setHintLevel(level) {
    this.hintLevel = level;
  }

  /** 销毁键盘 */
  destroy() {
    this.container.innerHTML = '';
    this.buttons.clear();
  }
}

export { ROWS };
