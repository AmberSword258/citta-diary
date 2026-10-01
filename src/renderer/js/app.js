/**
 * 观心 Citta —— 应用主控
 *
 * 负责：启动流程（锁屏 → 载入数据 → 主界面）、视图切换、全局快捷键、
 *       搜索、以及各模块之间的联动。
 */
(function (global) {
  'use strict';

  const $ = UI.$, el = UI.el;

  let currentView = 'calendar';
  let searchOpen = false;
  let searchTimer = null;
  let modulesReady = false;   // 各视图模块是否已初始化（需在解锁后，因为要读数据）
  let unlockedFlag = false;   // 是否处于已解锁会话（用于闸门自动刷新）
  let locking = false;        // 正在锁定，避免重入

  // -------------------------------------------------------------------------
  // 启动
  // -------------------------------------------------------------------------

  async function boot() {
    bindChrome();
    bindShortcuts();

    // 主题变了要重绘：图表与心情点的颜色是 JS 画进 SVG 的，得按新主题取色
    CittaTheme.onChange(() => {
      if (!unlockedFlag) return;
      try { refreshAll(); } catch (e) { /* 忽略 */ }
    });

    // 编辑器与列表的事件绑定不依赖数据，可以先做
    CittaEditor.init(onDataChanged);
    CittaList.init(openEditor);

    CittaLock.onUnlock(async () => {
      await enterApp();
    });

    const st = await global.citta.state();
    if (st.unlocked) {
      unlockedFlag = true;
      await enterApp();
    } else {
      // 未解锁：只显示锁屏，不触碰任何数据接口
      CittaLock.show();
    }
  }

  /** 解锁后：初始化视图模块并进入主界面 */
  async function enterApp() {
    unlockedFlag = true;
    try {
      await CittaStore.load();
    } catch (e) {
      UI.toast('载入数据失败：' + e.message);
    }

    if (!modulesReady) {
      CittaStats.init();
      await CittaCalendar.init(openEditor);
      modulesReady = true;
    }

    CittaLock.hide();
    $('#shell').classList.remove('hidden');
    await switchView('calendar');
  }

  /** 回到锁屏 */
  async function lock() {
    if (locking) return;
    locking = true;
    unlockedFlag = false;   // 立即停止一切自动刷新
    try {
      // 关闭编辑器时会先保存正式内容，此时仍处于解锁状态
      try { await CittaEditor.close(); } catch (e) { /* 忽略 */ }
      await global.citta.lock();
    } catch (e) { /* 忽略 */ }
    CittaStore.reset();
    modulesReady = false;
    $('#editor').classList.add('hidden');
    $('#shell').classList.add('hidden');
    closeSearch();
    CittaLock.show();
    locking = false;
  }

  /** 视图刷新总闸门：未解锁时直接跳过，避免出现"未解锁"报错 */
  function safeRefresh(fn) {
    if (!unlockedFlag || !CittaStore.isReady()) return;
    try {
      const r = fn();
      if (r && typeof r.catch === 'function') {
        r.catch((e) => { if (!/未解锁/.test(String(e && e.message))) console.warn(e); });
      }
    } catch (e) {
      if (!/未解锁/.test(String(e && e.message))) console.warn(e);
    }
  }

  // -------------------------------------------------------------------------
  // 视图
  // -------------------------------------------------------------------------

  async function switchView(name) {
    currentView = name;
    UI.$$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
    for (const v of ['calendar', 'list', 'stats']) {
      $('#view-' + v).classList.toggle('hidden', v !== name);
    }
    if (name === 'calendar') await CittaCalendar.render();
    else if (name === 'list') CittaList.render();
    else if (name === 'stats') CittaStats.render();
  }

  /** 数据变化后刷新当前视图 */
  function onDataChanged() {
    safeRefresh(() => {
      if (currentView === 'calendar') return CittaCalendar.refresh();
      if (currentView === 'list') return CittaList.refresh();
      if (currentView === 'stats') return CittaStats.refresh();
      return null;
    });
  }

  /** 全量刷新（导入备份后调用） */
  function refreshAll() {
    onDataChanged();
  }

  // -------------------------------------------------------------------------
  // 编辑器
  // -------------------------------------------------------------------------

  async function openEditor(date) {
    if (CittaEditor.isOpen()) {
      // 已在编辑中：先保存再切换
      await CittaEditor.saveNow(true);
    }
    await CittaEditor.open(date);
  }

  // -------------------------------------------------------------------------
  // 搜索
  // -------------------------------------------------------------------------

  function openSearch() {
    searchOpen = true;
    $('#searchbar').classList.remove('hidden');
    if (currentView !== 'list') switchView('list').then(() => {
      const input = $('#search-input');
      input.focus();
      input.select();
    });
    else {
      const input = $('#search-input');
      input.focus();
      input.select();
    }
  }

  function closeSearch() {
    searchOpen = false;
    $('#searchbar').classList.add('hidden');
    $('#search-input').value = '';
    $('#search-count').textContent = '';
    CittaList.setKeyword('');
  }

  function bindSearch() {
    const input = $('#search-input');
    input.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const kw = input.value.trim();
        CittaList.setKeyword(kw);
        const n = kw ? CittaStore.search(kw).length : 0;
        $('#search-count').textContent = kw ? n + ' 条结果' : '';
      }, 140);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSearch();
    });
    $('#search-close').addEventListener('click', closeSearch);
  }

  // -------------------------------------------------------------------------
  // 顶栏与快捷键
  // -------------------------------------------------------------------------

  function bindChrome() {
    UI.$$('.tab').forEach((t) => {
      t.addEventListener('click', () => switchView(t.dataset.view));
    });
    $('#btn-search').addEventListener('click', openSearch);
    $('#btn-settings').addEventListener('click', () => CittaSettings.open());

    $('#lightbox').addEventListener('click', () => UI.closeLightbox());

    // 关闭窗口前确保数据落盘
    window.addEventListener('beforeunload', () => { global.citta.flush(); });

    bindSearch();
  }

  /** 全局快捷键（项目书 P2 要求） */
  function bindShortcuts() {
    document.addEventListener('keydown', async (e) => {
      const mod = e.ctrlKey || e.metaKey;

      // Esc：优先关闭浮层，其次退出编辑器
      if (e.key === 'Escape') {
        if (UI.isLightboxOpen()) { UI.closeLightbox(); e.preventDefault(); return; }
        if (document.querySelector('.picker')) { CittaCalendar.closePicker(); e.preventDefault(); return; }
        if (!$('#searchbar').classList.contains('hidden')) { closeSearch(); e.preventDefault(); return; }
        if (CittaEditor.isOpen()) { await CittaEditor.close(); e.preventDefault(); return; }
        UI.closeCtx();
        return;
      }

      if (!mod) return;

      // Ctrl+N：编辑今天的日记
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        const today = await global.citta.calendarToday();
        await openEditor(today.date);
        return;
      }

      // Ctrl+S：手动保存
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (CittaEditor.isOpen()) await CittaEditor.saveNow(false);
        else UI.toast('当前不在编辑状态');
        return;
      }

      // Ctrl+F：唤起搜索
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openSearch();
        return;
      }

      // Ctrl+D：回到今天
      if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        await switchView('calendar');
        CittaCalendar.goToday();
        return;
      }

      // Ctrl+1/2/3：切换视图
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        e.preventDefault();
        await switchView(['calendar', 'list', 'stats'][Number(e.key) - 1]);
      }
    });

    // 编辑器内阻止浏览器默认的查找/保存（已在上方处理，这里避免重复触发）
    window.addEventListener('contextmenu', (e) => {
      // 未在特定元素上处理时，屏蔽默认菜单（应用使用自定义右键菜单）
      if (!e.target.closest('input, textarea, .entry-card, .cell')) {
        e.preventDefault();
      }
    });
  }

  global.CittaApp = { boot, lock, switchView, openEditor, refreshAll, openSearch, closeSearch, currentView: () => currentView };

  document.addEventListener('DOMContentLoaded', boot);
})(window);
