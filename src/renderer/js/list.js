/**
 * 观心 Citta —— 日记列表视图
 *
 * 项目书要求：
 *  · 按年、月维度筛选
 *  · 全文搜索标题与正文，结果高亮
 *  · 右键菜单：置顶、删除、导出
 *  · 滚动记忆：返回列表时恢复上次浏览位置
 */
(function (global) {
  'use strict';

  const $ = UI.$, el = UI.el, clear = UI.clear;

  let filter = { type: 'all', value: '' };   // all | year | month | tag | pinned
  let keyword = '';
  let openEditor = null;
  let savedScroll = 0;                        // 滚动记忆
  let pinned = [];                            // 置顶的日期
  const PIN_KEY = 'citta.pinned';

  function loadPinned() {
    try { pinned = JSON.parse(localStorage.getItem(PIN_KEY) || '[]'); } catch (e) { pinned = []; }
    if (!Array.isArray(pinned)) pinned = [];
  }
  function savePinned() {
    try { localStorage.setItem(PIN_KEY, JSON.stringify(pinned)); } catch (e) { /* 忽略 */ }
  }

  function init(editorOpener) {
    openEditor = editorOpener;
    loadPinned();
  }

  function setKeyword(kw) {
    keyword = kw || '';
    render();
  }

  function setFilter(type, value) {
    filter = { type: type, value: value || '' };
    render();
  }

  function clearFilter() {
    filter = { type: 'all', value: '' };
    keyword = '';
    render();
  }

  /** 取出当前筛选 + 搜索命中的日记 */
  function computeList() {
    let list = CittaStore.all();

    if (keyword) {
      const hits = CittaStore.search(keyword);
      list = hits.map((h) => h.entry);
    }

    if (filter.type === 'year') {
      list = list.filter((e) => e.date.startsWith(filter.value + '-'));
    } else if (filter.type === 'month') {
      list = list.filter((e) => e.date.startsWith(filter.value));
    } else if (filter.type === 'tag') {
      list = list.filter((e) => (e.tags || []).includes(filter.value));
    } else if (filter.type === 'pinned') {
      list = list.filter((e) => pinned.includes(e.date));
    }

    // 置顶优先，其余按日期倒序
    list = list.slice().sort((a, b) => {
      const pa = pinned.includes(a.date) ? 1 : 0;
      const pb = pinned.includes(b.date) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return a.date < b.date ? 1 : -1;
    });
    return list;
  }

  function render() {
    const wrap = $('#view-list');
    clear(wrap);
    const list = computeList();

    const filterPane = buildFilterPane();
    const listPane = el('div', { class: 'entry-list' });

    const p = UI.pad2;
    const filterLabel = filter.type === 'all' ? '全部日记'
      : filter.type === 'year' ? filter.value + ' 年'
      : filter.type === 'month' ? filter.value.replace('-', ' 年 ') + ' 月'
      : filter.type === 'tag' ? '标签：' + filter.value
      : '置顶';

    listPane.appendChild(el('div', { class: 'stats-head' }, [
      el('h2', { text: filterLabel }),
      el('span', { class: 'muted small', text: '共 ' + list.length + ' 篇' + (keyword ? '（搜索：' + keyword + '）' : '') })
    ]));

    if (!list.length) {
      // 空状态：≤8 字短语，四周大量留白
      listPane.appendChild(el('div', { class: 'empty-hint' }, [
        el('div', { class: 'big', text: keyword ? '并无所得' : '空纸一张' })
      ]));
    } else {
      for (const entry of list) listPane.appendChild(buildCard(entry));
    }

    wrap.appendChild(el('div', { class: 'list-wrap' }, [filterPane, listPane]));

    // 恢复滚动位置（滚动记忆）
    requestAnimationFrame(() => {
      listPane.scrollTop = savedScroll;
      listPane.addEventListener('scroll', () => { savedScroll = listPane.scrollTop; }, { passive: true });
    });
  }

  /** 左侧筛选面板 */
  function buildFilterPane() {
    const pane = el('div', { class: 'filter-pane' });

    pane.appendChild(el('div', { class: 'filter-title', text: '视图' }));
    const views = el('div', { class: 'filter-list' });
    const allCount = CittaStore.count();
    const pinnedCount = pinned.filter((d) => CittaStore.get(d)).length;
    views.appendChild(filterItem('全部日记', allCount, filter.type === 'all', () => setFilter('all')));
    views.appendChild(filterItem('置顶', pinnedCount, filter.type === 'pinned', () => setFilter('pinned')));
    pane.appendChild(views);

    // 按年
    const years = CittaStore.yearStats();
    pane.appendChild(el('div', { class: 'filter-title', text: '按年份' }));
    const yl = el('div', { class: 'filter-list' });
    if (!years.length) {
      yl.appendChild(el('div', { class: 'muted small', text: '尚空' }));
    } else {
      for (const [y, n] of years) {
        yl.appendChild(filterItem(y + ' 年', n,
          filter.type === 'year' && filter.value === y, () => setFilter('year', y)));
        // 展开当前选中年的月份
        if (filter.type === 'year' && filter.value === y) {
          const months = new Map();
          for (const e of CittaStore.byYear(y)) {
            const m = e.date.slice(5, 7);
            months.set(m, (months.get(m) || 0) + 1);
          }
          const sorted = Array.from(months.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
          for (const [m, mn] of sorted) {
            const key = y + '-' + m;
            yl.appendChild(filterItem('　' + Number(m) + ' 月', mn,
              filter.type === 'month' && filter.value === key,
              () => setFilter('month', key)));
          }
        }
      }
    }
    pane.appendChild(yl);

    // 按标签
    const tags = CittaStore.tagStats();
    pane.appendChild(el('div', { class: 'filter-title', text: '按标签' }));
    const tl = el('div', { class: 'filter-list' });
    if (!tags.length) {
      tl.appendChild(el('div', { class: 'muted small', text: '尚空' }));
    } else {
      for (const [t, n] of tags.slice(0, 30)) {
        tl.appendChild(filterItem(t, n, filter.type === 'tag' && filter.value === t, () => setFilter('tag', t)));
      }
    }
    pane.appendChild(tl);

    return pane;
  }

  function filterItem(label, count, active, onClick) {
    return el('button', {
      class: 'filter-item' + (active ? ' active' : ''),
      onclick: onClick
    }, [
      el('span', { text: label }),
      el('span', { class: 'n', text: count ? String(count) : '' })
    ]);
  }

  /** 单条日记：无卡片，条目间只靠留白与一条 hairline 分隔 */
  function buildCard(entry) {
    const isPinned = pinned.includes(entry.date);
    const card = el('div', { class: 'entry-card', 'data-date': entry.date });

    // 心情：右侧极小的墨色浓淡标记（5 点，最高档才用朱）
    const moodMark = el('span', { class: 'ec-mood', title: entry.mood ? '心情 ' + entry.mood + '/5' : '未记录心情' });
    if (entry.mood) {
      for (let i = 1; i <= 5; i++) {
        const cls = i <= entry.mood ? ('on' + (entry.mood === 5 && i === 5 ? ' top' : '')) : '';
        moodMark.appendChild(el('i', { class: cls }));
      }
    }

    const head = el('div', { class: 'ec-head' }, [
      el('span', { class: 'ec-date', text: entry.date }),
      el('span', { class: 'ec-lunar', text: entry.weekday || '' }),
      isPinned ? el('span', { class: 'pill accent', text: '置顶' }) : null,
      entry.mood ? moodMark : null
    ]);
    card.appendChild(head);

    // 大事：不加星号，只是一行小字
    if (entry.event) {
      card.appendChild(el('div', { class: 'pill accent', text: entry.event, 'data-no-i18n': '', style: { marginBottom: '12px', display: 'inline-block' } }));
    }

    const text = CittaMarkdown.toPlain(entry.content || '');
    const body = el('div', { class: 'ec-body' });
    // 命中关键词时展示命中片段并高亮
    if (keyword) {
      const lower = text.toLowerCase();
      const pos = lower.indexOf(keyword.toLowerCase());
      const start = Math.max(0, pos - 40);
      const snippet = (start > 0 ? '…' : '') + text.slice(start, start + 140);
      body.innerHTML = UI.highlight(snippet, keyword);
    } else {
      body.textContent = text.slice(0, 120) || '（无正文）';
    }
    card.appendChild(body);

    const foot = el('div', { class: 'ec-foot' });
    if (entry.weather) foot.appendChild(el('span', { class: 'pill', text: entry.weather }));
    for (const t of (entry.tags || [])) foot.appendChild(el('span', { class: 'pill', text: t, 'data-no-i18n': '' }));
    foot.appendChild(el('span', { class: 'muted small', text: UI.fullTime(entry.updatedAt), style: { marginLeft: 'auto' } }));
    card.appendChild(foot);

    card.addEventListener('click', () => openEditor(entry.date));
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      UI.contextMenu(e, [
        {
          label: isPinned ? '取消置顶' : '置顶',
          onClick: () => {
            if (isPinned) pinned = pinned.filter((d) => d !== entry.date);
            else pinned.push(entry.date);
            savePinned();
            UI.toast(isPinned ? '已取消置顶' : '已置顶');
            render();
          }
        },
        { label: '编辑', onClick: () => openEditor(entry.date) },
        {
          label: '导出为 Markdown',
          onClick: () => exportOne(entry)
        },
        { sep: true },
        {
          label: '删除', danger: true,
          onClick: () => UI.confirmDialog('删除日记', '删除 ' + entry.date + ' 的日记后无法恢复，确定吗？', async () => {
            await CittaStore.remove(entry.date);
            pinned = pinned.filter((d) => d !== entry.date);
            savePinned();
            UI.toast('已删除');
            render();
          }, '删除')
        }
      ]);
    });

    return card;
  }

  /** 导出单篇为 Markdown 文件（通过浏览器下载，不涉及网络） */
  function exportOne(entry) {
    const lines = [];
    lines.push('# ' + entry.date + ' ' + (entry.weekday || ''));
    if (entry.mood) lines.push('> 心情：' + entry.mood + '/5');
    if (entry.weather) lines.push('> 天气：' + entry.weather);
    if (entry.event) lines.push('> 大事：' + entry.event);
    if (entry.tags && entry.tags.length) lines.push('> 标签：' + entry.tags.join(' '));
    lines.push('');
    lines.push(entry.content || '');
    lines.push('');
    lines.push('---');
    lines.push('最后修改：' + UI.fullTime(entry.updatedAt));

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = entry.date + '.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    UI.toast('已导出 ' + entry.date + '.md');
  }

  /** 导出当前筛选结果为单个 Markdown */
  function exportCurrent() {
    const list = computeList();
    if (!list.length) { UI.toast('当前没有可导出的日记'); return; }
    const parts = list.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).map((entry) => {
      const head = ['## ' + entry.date, ''];
      const meta = [];
      if (entry.mood) meta.push('心情 ' + entry.mood + '/5');
      if (entry.weather) meta.push('天气 ' + entry.weather);
      if (entry.event) meta.push('大事 ' + entry.event);
      if (entry.tags && entry.tags.length) meta.push('标签 ' + entry.tags.join(' '));
      if (meta.length) head.push('> ' + meta.join(' · '), '');
      head.push(entry.content || '', '');
      return head.join('\n');
    });
    const blob = new Blob(['# 观心 Citta 导出\n\n' + parts.join('\n---\n\n')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'citta-export-' + UI.toDateString(new Date()) + '.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    UI.toast('已导出 ' + list.length + ' 篇');
  }

  /** 数据变化后刷新，保留滚动位置 */
  function refresh() {
    const pane = $('.entry-list');
    if (pane) savedScroll = pane.scrollTop;
    render();
  }

  function goToPicker() {
    // 供外部（如设置页）跳转到某篇
    render();
  }

  global.CittaList = { init, render, refresh, setKeyword, setFilter, clearFilter, exportCurrent, currentFilter: () => filter };
})(window);
