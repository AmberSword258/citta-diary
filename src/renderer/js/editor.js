/**
 * 观心 Citta —— 日记编辑器
 *
 * 项目书要求：
 *  · Markdown 基础语法（一~三级标题、加粗、斜体、无序/有序列表、引用、分割线、链接）
 *  · 每 20 秒自动存为草稿；关闭编辑页时自动保存正式内容
 *  · 元数据：心情 1-5、天气、大事、标签
 *  · 支持插入本地图片，图片随日记本地存储
 */
(function (global) {
  'use strict';

  const $ = UI.$, el = UI.el, clear = UI.clear;

  const WEATHERS = ['晴', '多云', '阴', '小雨', '大雨', '雷雨', '雪', '雾', '风'];
  const MOOD_LABEL = { 1: '很低落', 2: '有点低落', 3: '平静', 4: '不错', 5: '很开心' };
  const DRAFT_INTERVAL = 20000;  // 20 秒自动存草稿

  // 缩进方式
  //   first —— 首行缩进（中文写作习惯，编辑区与预览都是「每段首行缩进」）
  //   off   —— 关闭：不自动缩进，完全由手打空格控制
  const INDENT_MODES = [
    { v: 'first', label: '首行缩进' },
    { v: 'off', label: '关闭' }
  ];
  const INDENT_WIDTHS = [1, 2, 4];
  const INDENT_KEY = 'citta.indentMode';
  const INDENT_WIDTH_KEY = 'citta.indentWidth';
  const MIRROR_KEY = 'citta.mirrorIndent';
  let indentMode = 'first';   // 默认首行缩进
  let indentChars = 2;        // 缩进宽度（字符）
  /**
   * 编辑区镜像层（可选）。
   *
   * 镜像层能让左侧也呈现「逐段首行缩进」，但它比文本域多出 <indent> 的缩进量，
   * 而文本域的插入光标只能贴着自己的文字走 —— 于是行末光标会比看到的文字
   * 左偏一个缩进量（表现为「光标停在倒数第二个字符前面」）。
   * 这是镜像方案的结构性缺陷，因此**默认关闭**：左侧保持普通文本域，
   * 光标位置绝对准确。想要左侧也看到缩进效果时可在设置里开启。
   */
  let mirrorIndent = false;

  let current = null;        // 当前编辑的日期 'YYYY-MM-DD'
  let draftTimer = null;
  let lastSavedSnapshot = '';
  let dirty = false;
  let onChanged = null;      // 保存后通知外部刷新

  // -------------------------------------------------------------------------
  // 缩进
  // -------------------------------------------------------------------------

  /**
   * 应用缩进。
   *
   * 预览区：逐段直接给 text-indent，不依赖 CSS 变量继承（继承链一环出问题就会
   *         静默失效，表现为「只有第一段缩进」）。
   * 编辑区：textarea 是单一文本流且只能有一种 text-indent，无法逐段设置。
   *         因此用一层「镜像文本」叠在文本域下层：文本域文字设为透明，只显示光标；
   *         镜像层按段落渲染同样的文字并给每段首行加缩进。
   *         两层共用完全相同的字体、行高、内边距与换行规则，因此文字位置一一对应。
   */
  function applyIndent() {
    const on = indentMode !== 'off';
    const em = (on ? indentChars : 0) + 'em';

    // 逐段给预览写缩进
    paintPreviewIndent();

    // 编辑区：把缩进量传给镜像层（用 CSS 变量，避免 N 个元素逐个设置）
    const mirror = $('#ed-mirror');
    if (mirror) mirror.style.setProperty('--indent', em);

    // 日历侧栏等其它只读 .markdown 容器复用
    document.documentElement.style.setProperty('--indent', em);

    renderMirror();
  }

  /**
   * 渲染镜像层（仅在用户主动开启时使用）。
   * 注意：开启后文本域的插入光标会比可见文字左偏一个缩进量，
   *       因此默认关闭，优先保证光标位置准确。
   */
  function renderMirror() {
    const mirror = $('#ed-mirror');
    const ta = $('#ed-content');
    if (!mirror || !ta) return;

    if (!mirrorIndent || indentMode === 'off' || ta.value.length > 20000) {
      mirror.textContent = '';
      document.body.classList.remove('mirror-on');
      return;
    }
    document.body.classList.add('mirror-on');

    const lines = ta.value.split('\n');
    const frag = document.createDocumentFragment();
    for (const line of lines) {
      const div = document.createElement('div');
      if (line.trim() !== '') div.textContent = line;
      frag.appendChild(div);
    }
    mirror.textContent = '';
    mirror.appendChild(frag);
    syncMirrorScroll();
  }

  /** 开关编辑区缩进镜像（默认关闭，保证光标准确） */
  function setMirrorIndent(on, silent) {
    mirrorIndent = !!on;
    try { localStorage.setItem(MIRROR_KEY, mirrorIndent ? '1' : '0'); } catch (e) { /* 忽略 */ }
    renderMirror();
    if (!silent) {
      UI.toast(mirrorIndent
        ? '已开启编辑区缩进显示（注意：行末光标可能略有偏移）'
        : '已关闭编辑区缩进显示（光标位置最准确）');
    }
  }

  function getMirrorIndent() { return mirrorIndent; }

  /** 镜像层与文本域滚动同步 */
  function syncMirrorScroll() {
    const mirror = $('#ed-mirror');
    const ta = $('#ed-content');
    if (!mirror || !ta) return;
    mirror.scrollTop = ta.scrollTop;
    mirror.scrollLeft = ta.scrollLeft;
  }

  /** 给预览中的每个正文段落直接写入缩进样式 */
  function paintPreviewIndent() {
    const box = $('#ed-preview');
    if (!box) return;
    const em = (indentMode === 'off' ? 0 : indentChars) + 'em';
    const ps = box.querySelectorAll('p');
    for (const p of ps) {
      p.style.textIndent = em;
      // 列表、引用、标题按排版惯例不缩进
      p.style.removeProperty('--indent');
    }
  }

  /** 应用并记住缩进设置 */
  function setIndent(mode, chars, silent) {
    if (mode) indentMode = mode;
    if (typeof chars === 'number') {
      indentChars = chars;
      // 点宽度就应当看到缩进：若当前是「关闭」，自动开启首行缩进
      if (indentMode === 'off') indentMode = 'first';
    }
    applyIndent();
    try {
      localStorage.setItem(INDENT_KEY, indentMode);
      localStorage.setItem(INDENT_WIDTH_KEY, String(indentChars));
    } catch (e) { /* 忽略 */ }
    buildIndentPicker();
    if (!silent) {
      UI.toast(indentMode === 'off'
        ? '已关闭自动缩进'
        : '首行缩进 ' + indentChars + ' 字符');
    }
  }

  /** 读取上次的缩进偏好 */
  function loadIndentPref() {
    try {
      const m = localStorage.getItem(INDENT_KEY);
      if (m === 'first' || m === 'off') indentMode = m;
      else if (m === 'full') indentMode = 'first';   // 兼容旧版本已删除的「整篇缩进」
      const w = parseInt(localStorage.getItem(INDENT_WIDTH_KEY), 10);
      if (!isNaN(w) && INDENT_WIDTHS.indexOf(w) >= 0) indentChars = w;
      mirrorIndent = localStorage.getItem(MIRROR_KEY) === '1';
    } catch (e) { /* 忽略 */ }
    applyIndent();
  }

  function getIndent() { return { mode: indentMode, chars: indentChars }; }

  /** 缩进选择器：方式 + 宽度 */
  function buildIndentPicker() {
    const box = $('#ed-indent');
    if (!box) return;
    clear(box);

    for (const mode of INDENT_MODES) {
      box.appendChild(el('button', {
        class: 'chip' + (mode.v === indentMode ? ' on' : ''),
        text: mode.label,
        title: mode.v === 'first' ? '每个段落只缩进第一行' : '不自动缩进，由你手打空格',
        onclick: () => setIndent(mode.v)
      }));
    }

    // 关闭时不显示宽度档位
    if (indentMode === 'off') return;
    box.appendChild(el('span', { class: 'sep-inline', text: '·' }));
    for (const w of INDENT_WIDTHS) {
      box.appendChild(el('button', {
        class: 'chip' + (w === indentChars ? ' on' : ''),
        text: w + ' 字',
        title: '缩进 ' + w + ' 个字符',
        onclick: () => setIndent(null, w)
      }));
    }
  }

  // -------------------------------------------------------------------------
  // 工具
  // -------------------------------------------------------------------------

  /** 取当前表单的完整数据快照 */
  function collect() {
    const mood = Number($('#ed-mood').dataset.value || 0);
    const weather = $('#ed-weather').dataset.value || '';
    return {
      content: $('#ed-content').value,
      mood: mood || 0,
      weather: weather,
      event: $('#ed-event').value.trim(),
      tags: parseTags($('#ed-tags').value),
      images: CittaMarkdown.extractImageIds($('#ed-content').value)
    };
  }

  function parseTags(s) {
    return String(s || '')
      .split(/[\s,，、]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x, i, a) => a.indexOf(x) === i)
      .slice(0, 12);
  }

  function snapshot(data) {
    return JSON.stringify(data);
  }

  function setStatus(text) {
    $('#ed-status').textContent = text || '';
  }

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  /**
   * 心情选择器：五点连成一把尺子。
   * 选中 4 就是 1–4 全亮（每一点用它自己那一档的颜色），
   * 当前值那一点额外加一圈描边，一眼看出「选到哪了」。
   */
  function paintMoodPicker(box, value) {
    const v = Number(value) || 0;
    UI.$$('.mood-btn', box).forEach((x) => {
      const m = Number(x.dataset.mood);
      x.classList.toggle('on', v > 0 && m <= v);
      x.classList.toggle('current', m === v);
      x.setAttribute('aria-pressed', m === v ? 'true' : 'false');
    });
  }

  function buildMoodPicker(value) {
    const box = $('#ed-mood');
    clear(box);
    box.dataset.value = value || '';
    for (let m = 1; m <= 5; m++) {
      const b = el('button', {
        class: 'mood-btn',
        type: 'button',
        'data-mood': m,
        title: m + ' · ' + MOOD_LABEL[m],
        'aria-label': MOOD_LABEL[m],
        onclick: () => {
          const cur = Number(box.dataset.value || 0);
          const next = cur === m ? 0 : m;   // 再点一次取消
          box.dataset.value = next || '';
          paintMoodPicker(box, next);
          markDirty();
        }
      });
      box.appendChild(b);
    }
    paintMoodPicker(box, value);
  }

  /** 天气选项 */
  function buildWeather(value) {
    const box = $('#ed-weather');
    clear(box);
    box.dataset.value = value || '';
    for (const w of WEATHERS) {
      box.appendChild(el('button', {
        class: 'chip' + (value === w ? ' on' : ''),
        text: w,
        onclick: () => {
          const cur = box.dataset.value;
          const next = cur === w ? '' : w;
          box.dataset.value = next;
          UI.$$('.chip', box).forEach((x) => x.classList.toggle('on', x.textContent === next));
          markDirty();
        }
      }));
    }
  }

  /** Markdown 工具栏 */
  function buildToolbar() {
    const bar = $('#md-toolbar');
    clear(bar);
    const items = [
      { label: 'H1', title: '一级标题', wrap: ['# ', ''] },
      { label: 'H2', title: '二级标题', wrap: ['## ', ''] },
      { label: 'H3', title: '三级标题', wrap: ['### ', ''] },
      { sep: true },
      { label: 'B', title: '加粗', wrap: ['**', '**'], style: 'font-weight:700' },
      { label: 'I', title: '斜体', wrap: ['*', '*'], style: 'font-style:italic' },
      { label: 'S', title: '删除线', wrap: ['~~', '~~'], style: 'text-decoration:line-through' },
      { sep: true },
      { label: '•', title: '无序列表', prefix: '- ' },
      { label: '1.', title: '有序列表', prefix: '1. ' },
      { label: '引用', title: '引用', prefix: '> ' },
      { label: '——', title: '分割线', block: '\n---\n' },
      { sep: true },
      { label: '链接', title: '链接', wrap: ['[', '](https://)'] },
      { label: '图片', title: '插入本地图片', action: () => $('#ed-image-input').click() },
      { sep: true },
      {
        label: '缩进',
        title: '切换缩进方式（首行缩进 / 关闭）',
        action: () => {
          const order = ['first', 'off'];
          const idx = order.indexOf(indentMode);
          setIndent(order[(idx + 1) % order.length]);
        }
      }
    ];
    for (const it of items) {
      if (it.sep) { bar.appendChild(el('span', { class: 'sep' })); continue; }
      bar.appendChild(el('button', {
        text: it.label,
        title: it.title,
        style: it.style ? { cssText: it.style } : null,
        onclick: () => applyFormat(it)
      }));
    }
  }

  /** 在光标处套用 Markdown 语法 */
  function applyFormat(item) {
    const ta = $('#ed-content');
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = ta.value;
    const sel = val.slice(start, end);

    if (item.action) { item.action(); return; }

    let insert;
    let caretStart;
    let caretEnd;
    if (item.wrap) {
      insert = item.wrap[0] + (sel || '文字') + item.wrap[1];
      caretStart = start + item.wrap[0].length;
      caretEnd = caretStart + (sel || '文字').length;
    } else if (item.prefix) {
      // 逐行加前缀
      const lineStart = val.lastIndexOf('\n', start - 1) + 1;
      const block = val.slice(lineStart, end);
      const replaced = block.split('\n').map((l) => item.prefix + l).join('\n');
      ta.setRangeText(replaced, lineStart, end, 'end');
      markDirty();
      ta.focus();
      return;
    } else if (item.block) {
      insert = item.block;
      caretStart = caretEnd = start + insert.length;
    }

    ta.setRangeText(insert, start, end, 'end');
    ta.selectionStart = caretStart;
    ta.selectionEnd = caretEnd;
    ta.focus();
    markDirty();
  }

  /** 刷新预览 */
  function refreshPreview() {
    const md = $('#ed-content').value;
    const box = $('#ed-preview');
    box.innerHTML = CittaMarkdown.render(md, (src) => src) ||
      '<p class="muted">在左侧输入内容，这里会实时预览。</p>';
    // 预览重建后必须重新逐段写入缩进（否则新段落会丢缩进）
    paintPreviewIndent();
    // 把 citta-img:// 占位地址换成真正的图片数据
    UI.resolveImages(box);
  }

  /** 字数统计 */
  function updateCount() {
    const text = $('#ed-content').value;
    const chars = text.replace(/\s/g, '').length;
    const lines = text ? text.split('\n').length : 0;
    $('#ed-footer').textContent = chars + ' 字 · ' + lines + ' 行 · 支持 Markdown';
  }

  function markDirty() {
    dirty = true;
    refreshPreview();
    renderMirror();     // 编辑区镜像层随之更新
    updateCount();
  }

  // -------------------------------------------------------------------------
  // 标签联想
  // -------------------------------------------------------------------------
  function buildTagSuggest() {
    const input = $('#ed-tags');
    const box = $('#tag-suggest');

    function showSuggest() {
      const val = input.value;
      const parts = val.split(/[\s,，、]+/);
      const cur = parts[parts.length - 1] || '';
      const chosen = parts.slice(0, -1);
      const allTags = CittaStore.tagStats();
      const matches = allTags
        .filter(([t]) => !chosen.includes(t))
        .filter(([t]) => !cur || t.toLowerCase().includes(cur.toLowerCase()))
        .slice(0, 8);
      if (!matches.length) { box.classList.add('hidden'); return; }
      clear(box);
      for (const [t, n] of matches) {
        box.appendChild(el('button', {
          text: t + '  (' + n + ')',
          onclick: () => {
            const head = parts.slice(0, -1).join(' ');
            input.value = (head ? head + ' ' : '') + t + ' ';
            box.classList.add('hidden');
            input.focus();
            markDirty();
          }
        }));
      }
      box.classList.remove('hidden');
    }

    input.addEventListener('input', showSuggest);
    input.addEventListener('focus', showSuggest);
    input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 150));
  }

  // -------------------------------------------------------------------------
  // 图片插入
  // -------------------------------------------------------------------------
  async function handleImagePick(files) {
    if (!files || !files.length) return;
    const ta = $('#ed-content');
    setStatus('正在保存图片…');
    for (const file of files) {
      if (!/^image\//.test(file.type)) continue;
      if (file.size > 8 * 1024 * 1024) { UI.toast('图片超过 8MB，已跳过：' + file.name); continue; }
      try {
        const dataURL = await readFileAsDataURL(file);
        const info = await global.citta.saveImage(dataURL);
        const snippet = '\n![图片](citta-img://' + info.id + ')\n';
        const pos = ta.selectionStart;
        ta.setRangeText(snippet, pos, pos, 'end');
        markDirty();
      } catch (e) {
        UI.toast('图片保存失败：' + e.message);
      }
    }
    setStatus('');
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('读取文件失败'));
      fr.readAsDataURL(file);
    });
  }

  // -------------------------------------------------------------------------
  // 保存
  // -------------------------------------------------------------------------

  /** 打开某日期的编辑器 */
  async function open(date, opts) {
    current = date;
    const existing = CittaStore.get(date) || {};
    const info = await global.citta.calendarDay(await dateToDayNumber(date));

    $('#ed-date-cn').textContent = UI.dateLabel(date);
    $('#ed-date-sub').textContent = [info.lunarFull, info.solarTerm, (info.festivals || []).join(' · ')]
      .filter(Boolean).join(' · ');

    $('#ed-content').value = existing.content || '';
    $('#ed-event').value = existing.event || '';
    $('#ed-tags').value = (existing.tags || []).join(' ');
    buildMoodPicker(existing.mood || 0);
    buildWeather(existing.weather || '');
    buildIndentPicker();
    loadIndentPref();

    lastSavedSnapshot = snapshot(collect());
    dirty = false;
    setStatus(existing.updatedAt ? '上次修改 ' + UI.timeAgo(existing.updatedAt) : '');

    buildToolbar();
    refreshPreview();
    updateCount();

    $('#editor').classList.remove('hidden');
    document.body.classList.toggle('no-preview', !!opts || false);
    $('#ed-content').focus();

    // 打开时把光标放到文末，方便继续书写
    const len = $('#ed-content').value.length;
    $('#ed-content').setSelectionRange(len, len);

    startDraftTimer();
  }

  async function dateToDayNumber(date) {
    const p = UI.parseDate(date);
    return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000);
  }

  /** 关闭编辑器：自动保存正式内容 */
  async function close() {
    stopDraftTimer();
    await saveNow(true);
    $('#editor').classList.add('hidden');
    if (onChanged) onChanged();
  }

  /** 保存（silent 为 true 时不弹提示） */
  async function saveNow(silent) {
    if (!current) return;
    const data = collect();
    const snap = snapshot(data);
    // 正文为空且无任何元数据时不写盘，避免产生空白日记
    const empty = !data.content.trim() && !data.mood && !data.weather && !data.event && !data.tags.length;
    if (empty) {
      setStatus('内容为空，未保存');
      dirty = false;
      return;
    }
    if (snap === lastSavedSnapshot && !dirty) { setStatus('已是最新'); return; }
    try {
      const saved = await CittaStore.save(current, data);
      lastSavedSnapshot = snapshot(collect());
      dirty = false;
      setStatus('已保存 ' + UI.fullTime(saved.updatedAt).slice(11));
      if (!silent) UI.toast('已保存');
    } catch (e) {
      setStatus('保存失败');
      UI.toast('保存失败：' + e.message);
    }
  }

  // -------------------------------------------------------------------------
  // 定时器
  // -------------------------------------------------------------------------
  function startDraftTimer() {
    stopDraftTimer();
    draftTimer = setInterval(async () => {
      if (!dirty || !current) return;
      const data = collect();
      if (snapshot(data) === lastSavedSnapshot) return;
      try {
        await CittaStore.save(current, data);
        lastSavedSnapshot = snapshot(collect());
        setStatus('草稿已自动保存 · ' + new Date().toTimeString().slice(0, 5));
      } catch (e) {
        setStatus('草稿保存失败');
      }
    }, DRAFT_INTERVAL);
  }

  function stopDraftTimer() {
    if (draftTimer) { clearInterval(draftTimer); draftTimer = null; }
  }

  function isOpen() { return !$('#editor').classList.contains('hidden'); }
  function currentDate() { return current; }
  function isDirty() { return dirty; }

  // -------------------------------------------------------------------------
  // 事件绑定（只做一次）
  // -------------------------------------------------------------------------
  function init(changeCb) {
    onChanged = changeCb;

    $('#ed-back').addEventListener('click', () => close());
    $('#ed-save').addEventListener('click', () => saveNow(false));
    $('#ed-preview-toggle').addEventListener('click', () => {
      document.body.classList.toggle('no-preview');
      $('#ed-preview-toggle').textContent = document.body.classList.contains('no-preview') ? '分栏' : '预览';
    });

    const ta = $('#ed-content');
    ta.addEventListener('input', markDirty);
    ta.addEventListener('scroll', syncMirrorScroll, { passive: true });

    /**
     * 回车 = 另起一个段落。
     *
     * 按一次回车插入两个换行（段落之间空一行），这样：
     *   · 保持「按一次回车就分段」的书写手感
     *   · 同时满足 Markdown 的段落定义，右侧预览才能按段缩进
     *
     * 判断依据只看「光标当前所在行」：
     *   · 行内有文字      → 插入空行（\n\n）
     *   · 已在空行上      → 只插入一个换行，便于手动多留空行
     * 不再参考「上一行是否为空行」——否则上一段留下的空行会让本段只换一行。
     */
    ta.addEventListener('keydown', (e) => {
      // Tab 插入两个空格，避免焦点跳走
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = ta.selectionStart;
        ta.setRangeText('  ', s, ta.selectionEnd, 'end');
        markDirty();
        return;
      }

      if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

      e.preventDefault();
      const val = ta.value;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;

      const lineStart = val.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = val.indexOf('\n', start);
      const currentLine = val.slice(lineStart, lineEnd === -1 ? val.length : lineEnd);

      // 空行上再按回车只加一个换行；否则插入段落空行
      const insert = currentLine.trim() === '' ? '\n' : '\n\n';
      ta.setRangeText(insert, start, end, 'end');
      markDirty();
    });

    ta.addEventListener('paste', async (e) => {
      // 支持直接粘贴图片
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const files = [];
      for (const it of items) {
        if (it.kind === 'file' && /^image\//.test(it.type)) {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        await handleImagePick(files);
      }
    });

    $('#ed-event').addEventListener('input', markDirty);
    $('#ed-tags').addEventListener('input', markDirty);
    $('#ed-image-input').addEventListener('change', async (e) => {
      await handleImagePick(e.target.files);
      e.target.value = '';
    });

    buildTagSuggest();

    // 点击预览中的图片放大
    $('#ed-preview').addEventListener('click', (e) => {
      const img = e.target.closest('img');
      if (!img) return;
      const id = img.dataset.imgId;
      if (id) UI.openLightbox(id);
    });
  }

  global.CittaEditor = {
    init, open, close, saveNow, isOpen, currentDate, isDirty,
    MOOD_LABEL, WEATHERS,
    setIndent, getIndent, paintPreviewIndent, renderMirror, setMirrorIndent, getMirrorIndent,
    INDENT_MODES, INDENT_WIDTHS
  };
})(window);
