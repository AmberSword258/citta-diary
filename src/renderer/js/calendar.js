/**
 * 观心 Citta —— 日历视图
 *
 * 项目书要求：
 *  · 常规日历布局（阴阳历），显示节日与节气
 *  · 点击某天显示「XX天前 / XX天后」，并可进入编辑
 *  · 心情 1-5 用格子轮廓从蓝（伤心）到红（开心）呈现
 *  · 大事突出显示
 */
(function (global) {
  'use strict';

  const $ = UI.$, el = UI.el, clear = UI.clear;

  let year = 0;
  let month = 0;
  let selected = null;       // 选中的 dayNumber
  let monthData = null;      // 主进程返回的月度数据
  let openEditor = null;     // 打开编辑器的回调

  // 年月选择器（与常见日历一致：点标题展开 → 月视图 → 切到年视图 → 选年回月视图）
  let pickerMode = null;     // null = 关闭 | 'month' | 'year'
  let pickerYear = 0;        // 选择器正在浏览的年份
  const PICK_MIN = 1900;     // 农历兜底表覆盖 1901–2100，选择器收在相邻区间
  const PICK_MAX = 2100;
  const YEARS_PER_PAGE = 12;
  let onDocClick = null;     // 点击别处关闭

  /** 初始化到当前月份 */
  async function init(editorOpener) {
    openEditor = editorOpener;
    const today = await global.citta.calendarToday();
    year = today.year;
    month = today.month;
    selected = today.dayNumber;

    // 「今天」按钮在日历头部，由 render() 每次重建时绑定

    await render();
  }

  function goToday() {
    global.citta.calendarToday().then((today) => {
      year = today.year;
      month = today.month;
      selected = today.dayNumber;
      closePicker();
      render();
    });
  }

  /** 切换月份 */
  async function go(delta) {
    month += delta;
    if (month < 1) { month = 12; year--; }
    if (month > 12) { month = 1; year++; }
    closePicker();
    await render();
  }

  async function goTo(yearNum, monthNum, dayNumber) {
    year = yearNum;
    month = monthNum;
    if (dayNumber != null) selected = dayNumber;
    closePicker();
    await render();
  }

  // -------------------------------------------------------------------------
  // 年月选择器
  // -------------------------------------------------------------------------

  function clampYear(y) { return Math.min(PICK_MAX, Math.max(PICK_MIN, y)); }

  function closePicker() {
    pickerMode = null;
    const p = $('.picker');
    if (p) p.remove();
    const btn = $('.cal-title-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (onDocClick) {
      document.removeEventListener('click', onDocClick, true);
      onDocClick = null;
    }
  }

  function togglePicker() {
    if (pickerMode) { closePicker(); return; }
    pickerYear = year;
    pickerMode = 'month';
    paintPicker();
    const btn = $('.cal-title-btn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    onDocClick = (e) => {
      const p = $('.picker');
      const head = $('.cal-head');
      if (p && !p.contains(e.target) && !(head && head.contains(e.target))) closePicker();
    };
    document.addEventListener('click', onDocClick, true);
  }

  /** 重绘选择器（内容随模式变化） */
  function paintPicker() {
    if (!pickerMode) return;
    const head = $('.cal-head');
    if (!head) return;
    let box = $('.picker');
    if (!box) {
      box = el('div', { class: 'picker', role: 'dialog', 'aria-label': '选择年月' });
      head.appendChild(box);
    }
    clear(box);

    const base = Math.floor(pickerYear / YEARS_PER_PAGE) * YEARS_PER_PAGE;
    const rangeEnd = base + YEARS_PER_PAGE - 1;

    // 头部：左右翻页 + 中间可切换「年 ⇄ 年段」
    const back = el('button', {
      class: 'icon-btn', text: '‹', type: 'button',
      title: pickerMode === 'month' ? '上一年' : '上十二年',
      onclick: () => {
        pickerYear = clampYear(pickerMode === 'month' ? pickerYear - 1 : pickerYear - YEARS_PER_PAGE);
        paintPicker();
      }
    });
    const fwd = el('button', {
      class: 'icon-btn', text: '›', type: 'button',
      title: pickerMode === 'month' ? '下一年' : '下十二年',
      onclick: () => {
        pickerYear = clampYear(pickerMode === 'month' ? pickerYear + 1 : pickerYear + YEARS_PER_PAGE);
        paintPicker();
      }
    });
    if (pickerMode === 'month' && pickerYear <= PICK_MIN) back.disabled = true;
    if (pickerMode === 'month' && pickerYear >= PICK_MAX) fwd.disabled = true;
    if (pickerMode === 'year' && base <= PICK_MIN) back.disabled = true;
    if (pickerMode === 'year' && rangeEnd >= PICK_MAX) fwd.disabled = true;

    const label = pickerMode === 'month'
      ? pickerYear + ' 年'
      : base + ' – ' + rangeEnd;
    const title = el('button', {
      class: 'picker-title', type: 'button', text: label,
      title: pickerMode === 'month' ? '选择年份' : '回到月份',
      onclick: () => { pickerMode = pickerMode === 'month' ? 'year' : 'month'; paintPicker(); }
    });

    box.appendChild(el('div', { class: 'picker-head' }, [back, title, fwd]));

    const grid = el('div', { class: 'picker-grid' });
    if (pickerMode === 'month') {
      for (let m = 1; m <= 12; m++) {
        const on = pickerYear === year && m === month;
        grid.appendChild(el('button', {
          class: 'picker-cell' + (on ? ' on' : ''),
          type: 'button',
          text: m + ' 月',
          onclick: () => goTo(pickerYear, m)
        }));
      }
    } else {
      for (let i = 0; i < YEARS_PER_PAGE; i++) {
        const y = base + i;
        if (y > PICK_MAX) { grid.appendChild(el('div', { class: 'picker-cell blank' })); continue; }
        const on = y === year;
        grid.appendChild(el('button', {
          class: 'picker-cell' + (on ? ' on' : ''),
          type: 'button',
          text: y + '',
          onclick: () => { pickerYear = y; pickerMode = 'month'; paintPicker(); }
        }));
      }
    }
    box.appendChild(grid);

    box.appendChild(el('div', { class: 'picker-foot' }, [
      el('button', { class: 'link-btn', type: 'button', text: '回到今天', onclick: () => goToday() })
    ]));

    // Esc 关闭
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closePicker(); }
    });
  }

  /** 渲染整个日历视图 */
  async function render() {
    monthData = await global.citta.calendarMonth(year, month);

    const wrap = $('#view-calendar');
    closePicker();
    clear(wrap);

    const main = el('div', { class: 'cal-main' });
    const side = el('div', { class: 'cal-side' });
    wrap.appendChild(el('div', { class: 'cal-wrap' }, [main, side]));

    // ---- 头部：标题即「年月选择器」的入口 ----
    const todayStr = UI.toDateString(new Date());
    const titleBtn = el('button', {
      class: 'cal-title-btn',
      type: 'button',
      title: '选择年月',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      onclick: togglePicker
    }, [
      el('span', { class: 'ct-main', text: year + ' 年 ' + month + ' 月' }),
      el('small', { class: 'ct-sub', text: (await global.citta.calendarYearName(year)).name + '年' }),
      el('span', { class: 'caret', 'aria-hidden': 'true' })
    ]);

    main.appendChild(el('div', { class: 'cal-head' }, [
      titleBtn,
      el('div', { class: 'cal-nav' }, [
        el('button', { class: 'icon-btn', text: '‹', title: '上个月', onclick: () => go(-1) }),
        el('button', { class: 'ghost-btn', text: '今天', onclick: goToday }),
        el('button', { class: 'icon-btn', text: '›', title: '下个月', onclick: () => go(1) })
      ])
    ]));

    // ---- 星期表头 ----
    const grid = el('div', { class: 'cal-grid' });
    const week = el('div', { class: 'cal-week' });
    for (const w of ['一', '二', '三', '四', '五', '六', '日']) week.appendChild(el('span', { text: w }));
    grid.appendChild(week);

    // ---- 日期格子 ----
    const weeks = el('div', { class: 'cal-weeks' });
    for (let i = 0; i < monthData.days.length; i += 7) {
      const row = el('div', { class: 'cal-row' });
      for (const day of monthData.days.slice(i, i + 7)) {
        row.appendChild(buildCell(day, todayStr));
      }
      weeks.appendChild(row);
    }
    grid.appendChild(weeks);
    main.appendChild(grid);

    await renderSide(side);
  }

  /** 单个日期格子 */
  function buildCell(day, todayStr) {
    const cls = ['cell'];
    if (!day.inMonth) cls.push('out');
    if (day.isToday) cls.push('today');
    if (day.dn === selected) cls.push('selected');

    const cell = el('div', {
      class: cls.join(' '),
      'data-dn': day.dn,
      'data-mood': day.mood || null,
      title: day.lunarFull + (day.term ? ' · ' + day.term : '') +
             (day.festivals.length ? ' · ' + day.festivals.join('、') : '') +
             (day.event ? '\n大事：' + day.event : '')
    });

    cell.appendChild(el('div', { class: 'd-num', text: day.day }));

    // 农历/节日/节气：节日优先，其次节气，最后农历日
    const lunarCls = ['d-lunar'];
    let lunarText = day.lunarText;
    if (day.festivals.length) lunarCls.push('festival');
    else if (day.term) lunarCls.push('term');
    cell.appendChild(el('div', { class: lunarCls.join(' '), text: lunarText }));

    // 大事：不加星号装饰，只在农历行下方以小字呈现
    if (day.event) {
      cell.appendChild(el('div', { class: 'd-event', text: day.event }));
    }

    // 有记录的日子：数字下方一个 3px 圆点（墨色浓淡即当日心情）
    if (day.hasEntry) {
      const mark = el('div', { class: 'd-mark' });
      mark.appendChild(el('span', { class: 'dot', title: '有记录' }));
      cell.appendChild(mark);
    }

    cell.addEventListener('click', () => {
      selected = day.dn;
      UI.$$('.cell', $('#view-calendar')).forEach((c) => {
        c.classList.toggle('selected', Number(c.dataset.dn) === selected);
      });
      renderSide($('.cal-side'));
    });

    cell.addEventListener('dblclick', () => openEditor(day.date));

    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      UI.contextMenu(e, [
        { label: day.hasEntry ? '编辑这一天' : '写这一天的日记', onClick: () => openEditor(day.date) },
        { label: '查看农历详情', onClick: () => showDayDetail(day) }
      ]);
    });

    return cell;
  }

  /** 右侧当日面板 */
  async function renderSide(side) {
    if (!side) return;
    clear(side);

    const info = await global.citta.calendarDay(selected);
    const p = UI.parseDate(info.date);

    side.appendChild(el('div', {}, [
      el('div', { class: 'side-date', text: p.y + ' 年 ' + p.m + ' 月 ' + p.d + ' 日' }),
      el('div', { class: 'side-sub', text: info.weekdayFull + ' · ' + info.relative })
    ]));

    const lunarLine = [info.lunarFull];
    if (info.solarTerm) lunarLine.push(info.solarTerm);
    side.appendChild(el('div', { class: 'side-lunar', text: lunarLine.filter(Boolean).join(' · ') }));

    if (info.festivals && info.festivals.length) {
      const tags = el('div', { class: 'side-tags' });
      for (const f of info.festivals) tags.appendChild(el('span', { class: 'pill accent', text: f }));
      side.appendChild(tags);
    }

    // 已有日记则展示摘要
    const entry = CittaStore.get(info.date);
    if (entry) {
      const meta = [];
      if (entry.mood) meta.push('心情：' + CittaEditor.MOOD_LABEL[entry.mood]);
      if (entry.weather) meta.push('天气：' + entry.weather);
      if (meta.length) side.appendChild(el('div', { class: 'muted small', text: meta.join(' · ') }));

      if (entry.event) {
        side.appendChild(el('div', { class: 'pill accent', text: entry.event, 'data-no-i18n': '', style: { alignSelf: 'flex-start' } }));
      }
      if (entry.tags && entry.tags.length) {
        const tags = el('div', { class: 'side-tags' });
        for (const t of entry.tags) tags.appendChild(el('span', { class: 'pill', text: t, 'data-no-i18n': '' }));
        side.appendChild(tags);
      }
      const preview = el('div', { class: 'side-preview' });
      preview.innerHTML = CittaMarkdown.render(
        String(entry.content || '').slice(0, 400),
        (src) => src
      );
      side.appendChild(preview);
      // 侧栏预览同样需要把占位地址换成真实图片，并支持点击放大
      UI.resolveImages(preview).then(() => {
        preview.querySelectorAll('img').forEach((img) => {
          img.addEventListener('click', () => {
            const id = img.dataset.imgId;
            if (id) UI.openLightbox(id);
          });
        });
      });
      side.appendChild(el('div', { class: 'muted small', text: '最后修改：' + UI.fullTime(entry.updatedAt) }));
    } else {
      // 空状态：一句短语，四周大量留白
      side.appendChild(el('div', { class: 'side-empty', text: '尚未落笔' }));
    }

    side.appendChild(el('div', { class: 'side-actions' }, [
      el('button', {
        class: 'primary-btn',
        text: entry ? '继续编辑' : '写日记',
        onclick: () => openEditor(info.date)
      }),
      entry ? el('button', {
        class: 'ghost-btn',
        text: '删除',
        onclick: () => {
          UI.confirmDialog('删除这一天', '删除后无法恢复，确定要删除 ' + info.date + ' 的日记吗？', async () => {
            await CittaStore.remove(info.date);
            UI.toast('已删除');
            await render();
          }, '删除');
        }
      }) : null
    ]));

    // 点击预览图片放大
    side.querySelectorAll('.side-preview img').forEach((img) => {
      img.addEventListener('click', () => {
        const m = /citta-img:\/\/([0-9a-f]{32})/.exec(img.getAttribute('src') || '');
        if (m) UI.openLightbox(m[1]);
      });
    });
  }

  /** 农历详情弹窗 */
  async function showDayDetail(day) {
    const info = await global.citta.calendarDay(day.dn);
    const body = el('div', { style: { lineHeight: '2' } });
    const rows = [
      ['公历', info.date + ' ' + info.weekdayFull],
      ['农历', info.lunarFull],
      ['相对今天', info.relative],
      ['节气', info.solarTerm || '—'],
      ['节日', (info.festivals || []).join('、') || '—']
    ];
    for (const [k, v] of rows) {
      body.appendChild(el('div', {}, [
        el('span', { class: 'muted small', text: k + '：', style: { display: 'inline-block', width: '72px' } }),
        el('span', { text: v })
      ]));
    }
    UI.modal({
      title: '日期详情',
      body: body,
      actions: [{ label: '写日记', primary: true, onClick: (close) => { close(); openEditor(info.date); } }, { label: '关闭' }]
    });
  }

  /** 数据变化后局部刷新（保留滚动位置） */
  async function refresh() {
    const scroll = $('.cal-main') ? $('.cal-main').scrollTop : 0;
    await render();
    const main = $('.cal-main');
    if (main) main.scrollTop = scroll;
  }

  function current() { return { year: year, month: month, selected: selected }; }

  global.CittaCalendar = { init, render, refresh, goToday, goTo, current, showDayDetail, closePicker };
})(window);
