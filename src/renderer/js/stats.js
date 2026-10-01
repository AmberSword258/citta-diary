/**
 * 观心 Citta —— 统计视图
 *
 * 项目书要求：
 *  · 写作概览：总日记篇数、总字数、连续写作天数、本月写作数量
 *  · 心情统计：月度心情分布，展示情绪变化趋势
 *  · 年度统计：月度心情走向、常用标签、年度小结
 *
 * 视觉：删除环形图、饼图、带网格线的柱状图与四宫格大号 KPI 数字。
 *       改为一维时间轴（按月落点）+ 心情五色圆点 + 一条极淡的墨色横带表示心情走向。
 *       全部内联 SVG 手绘，无第三方图表库，完全离线。
 */
(function (global) {
  'use strict';

  const $ = UI.$, el = UI.el, clear = UI.clear;

  // 图表颜色一律向样式表要：浅色/深色两套令牌自动生效，JS 里不再写死主题色。
  //   下面的常量只作为「令牌读不到」时的兜底，与 base.css 的浅色值一致。
  const TONE_VARS = ['--tone-1', '--tone-2', '--tone-3', '--tone-4', '--tone-5'];
  const TONE_FALLBACK = ['#2d3a54', '#6381b3', '#7cb899', '#f4d35e', '#ee7c2b'];
  const INK_FALLBACK = {
    line: '#e2dcd0', axis: '#d3ccbd', label: '#6f6a62', faint: '#96908a',
    surface: '#fffdf8', band: '#33302b'
  };
  const INK_VARS = {
    line: '--line', axis: '--line-strong', label: '--ink-400', faint: '--ink-300',
    surface: '--surface', band: '--ink-700'
  };

  function cssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  /** 当前主题下的心情五色 */
  function toneColors() {
    return TONE_VARS.map((n, i) => cssVar(n, TONE_FALLBACK[i]));
  }

  /** 当前主题下的墨色（图表轴线、标注、飞白） */
  function inkColors() {
    const out = {};
    Object.keys(INK_VARS).forEach((k) => { out[k] = cssVar(INK_VARS[k], INK_FALLBACK[k]); });
    return out;
  }

  // 渲染时刷新一次（主题切换后重绘即可跟着变）
  let TONES = toneColors();
  let INK = inkColors();
  const MOOD_LABEL = CittaEditor.MOOD_LABEL;

  let statYear = 0;
  let statMonth = 0;

  function init() {
    const now = new Date();
    statYear = now.getFullYear();
    statMonth = now.getMonth() + 1;
  }

  // -------------------------------------------------------------------------
  // 派生统计（保持原有算法不变）
  // -------------------------------------------------------------------------

  function isoOf(dayNumber) {
    const d = new Date(dayNumber * 86400000);
    const y = d.getUTCFullYear();
    const m = UI.pad2(d.getUTCMonth() + 1);
    const dd = UI.pad2(d.getUTCDate());
    return y + '-' + m + '-' + dd;
  }

  /** 连续写作天数（从今天或最近一篇往前数） */
  function streakDays() {
    const dates = new Set(CittaStore.all().map((e) => e.date));
    if (!dates.size) return 0;
    const today = UI.toDateString(new Date());
    const dayMs = 86400000;
    const dn = (s) => {
      const p = UI.parseDate(s);
      return Math.round(Date.UTC(p.y, p.m - 1, p.d) / dayMs);
    };
    let cursor = dn(today);
    if (!dates.has(today)) {
      const y = UI.toDateString(new Date(Date.now() - dayMs));
      if (!dates.has(y)) return 0;
      cursor = dn(y);
    }
    let count = 0;
    for (let i = 0; i < 4000; i++) {
      if (!dates.has(isoOf(cursor))) break;
      count++;
      cursor -= 1;
    }
    return count;
  }

  /** 总字数 */
  function totalWords() {
    let n = 0;
    for (const e of CittaStore.all()) n += CittaMarkdown.toPlain(e.content || '').replace(/\s/g, '').length;
    return n;
  }

  function monthCount(y, m) {
    return CittaStore.byMonth(y, m).length;
  }

  /** 心情分布（指定范围） */
  function moodDistribution(list) {
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    let n = 0;
    for (const e of list) {
      if (e.mood >= 1 && e.mood <= 5) {
        dist[e.mood]++;
        sum += e.mood;
        n++;
      }
    }
    return { dist: dist, avg: n ? sum / n : 0, rated: n };
  }

  // -------------------------------------------------------------------------
  // 一维时间轴：一条 1px 水平线，按月落点；点的浓淡即当月心情
  // -------------------------------------------------------------------------

  /**
   * @param {number[]} counts 12 个月的记录数
   * @param {(number|null)[]} moodAvg 12 个月的心情均值
   */
  function timelineSvg(counts, moodAvg) {
    const W = 720, H = 108;
    const x0 = 20, x1 = W - 20;
    const yLine = 50;
    const step = (x1 - x0) / 11;
    const maxCount = Math.max(1, ...counts);
    const parts = [];

    parts.push('<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="月度记录时间轴">');
    parts.push('<line x1="' + x0 + '" y1="' + yLine + '" x2="' + x1 + '" y2="' + yLine +
      '" stroke="' + INK.axis + '" stroke-width="1"/>');

    for (let i = 0; i < 12; i++) {
      const cx = x0 + i * step;
      const n = counts[i];
      const mood = moodAvg[i];
      const tone = mood ? TONES[Math.min(4, Math.max(0, Math.round(mood) - 1))] : INK.faint;
      const r = n ? (3 + 3.2 * (n / maxCount)) : 2;
      parts.push('<circle cx="' + cx + '" cy="' + yLine + '" r="' + r.toFixed(2) +
        '" fill="' + (n ? tone : INK.surface) + '"' +
        (n ? '' : ' stroke="' + INK.faint + '" stroke-width="1"') + '/>');
      parts.push('<text x="' + cx + '" y="' + (yLine + 30) +
        '" fill="' + INK.label + '" font-size="13" letter-spacing="0.04em" text-anchor="middle">' +
        (i + 1) + '</text>');
      if (n) {
        parts.push('<text x="' + cx + '" y="' + (yLine - 16) +
          '" fill="' + INK.label + '" font-size="13" text-anchor="middle">' + n + '</text>');
      }
    }
    parts.push('</svg>');
    return parts.join('');
  }

  /**
   * 心情走向：一条极淡的墨色横带（像飞白），不是柱子。
   * 带宽随当月心情高低轻微起伏，透明度极低，只作气息的暗示。
   */
  function moodBandSvg(moodAvg) {
    const W = 720, H = 96;
    const x0 = 20, x1 = W - 20;
    const yMid = 48;
    const step = (x1 - x0) / 11;
    const base = 7;
    const amp = 14;
    const top = [];
    const bottom = [];

    for (let i = 0; i < 12; i++) {
      const cx = x0 + i * step;
      const v = moodAvg[i];
      const k = v == null ? 0.15 : Math.min(1, Math.max(0.15, v / 5));
      const half = base + amp * k;
      top.push([cx, yMid - half]);
      bottom.push([cx, yMid + half]);
    }

    const d = 'M ' + top.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L ') +
      ' L ' + bottom.slice().reverse().map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L ') + ' Z';

    const parts = [];
    parts.push('<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="心情走向">');
    parts.push('<path d="' + d + '" fill="' + INK.band + '" opacity="0.10"/>');
    parts.push('<line x1="' + x0 + '" y1="' + yMid + '" x2="' + x1 + '" y2="' + yMid +
      '" stroke="' + INK.line + '" stroke-width="1"/>');
    for (let i = 0; i < 12; i++) {
      const v = moodAvg[i];
      if (v == null) continue;
      const cx = x0 + i * step;
      const tone = TONES[Math.min(4, Math.max(0, Math.round(v) - 1))];
      parts.push('<circle cx="' + cx + '" cy="' + yMid + '" r="4" fill="' + tone +
        '" stroke="' + INK.surface + '" stroke-width="1.5"/>');
    }
    parts.push('</svg>');
    return parts.join('');
  }

  /** 当月心情分布：五档墨点，最高档才用朱 */
  function moodDotsSvg(dist, total) {
    const W = 720, H = 96;
    const x0 = 16;
    const rowH = 18;
    const maxBar = W - 8 - x0 - 150;
    const parts = [];
    parts.push('<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="当月心情分布">');
    for (let m = 1; m <= 5; m++) {
      const y = 12 + (m - 1) * rowH + 4;
      const n = dist[m];
      parts.push('<text x="' + x0 + '" y="' + y + '" fill="' + INK.label +
        '" font-size="13" letter-spacing="0.04em">' + m + ' 分</text>');
      const dots = Math.min(n, 36);
      const gap = maxBar / 36;
      for (let i = 0; i < dots; i++) {
        const cx = x0 + 60 + i * gap + gap / 2;
        parts.push('<circle cx="' + cx.toFixed(1) + '" cy="' + (y - 4) + '" r="3" fill="' + TONES[m - 1] + '"/>');
      }
      if (n) {
        parts.push('<text x="' + (W - 8) + '" y="' + y + '" fill="' + INK.label +
          '" font-size="13" text-anchor="end">' + n + ' 篇</text>');
      }
    }
    parts.push('</svg>');
    void total;
    return parts.join('');
  }

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  function render() {
    const wrap = $('#view-stats');
    clear(wrap);

    // 每次渲染都按当前主题取一次颜色，切换深浅色后重绘即生效
    TONES = toneColors();
    INK = inkColors();

    const all = CittaStore.all();
    const container = el('div', { class: 'stats-wrap rise' });

    // ---- 写作概览：小号衬线数字 + 大量留白，不做卡片 ----
    const thisMonthCount = monthCount(statYear, statMonth);
    container.appendChild(el('div', { class: 'stats-head' }, [
      el('h2', { text: '写作概览' }),
      el('span', { class: 'muted', text: '只在本机' })
    ]));

    const statRow = el('div', { class: 'stat-row' }, [
      statItem(all.length, '总篇数'),
      statItem(totalWords().toLocaleString('en-US'), '总字数'),
      statItem(streakDays(), '连续写作天数'),
      statItem(thisMonthCount, statYear + ' 年 ' + statMonth + ' 月')
    ]);
    container.appendChild(statRow);

    if (!all.length) {
      container.appendChild(el('div', { class: 'empty-hint' }, [
        el('div', { class: 'big', text: '尚无墨迹' })
      ]));
      wrap.appendChild(container);
      return;
    }

    // ---- 当月心情分布 ----
    const monthList = CittaStore.byMonth(statYear, statMonth);
    const md = moodDistribution(monthList);
    const moodPanel = el('div', { class: 'panel' });
    moodPanel.appendChild(el('h3', { text: statYear + ' 年 ' + statMonth + ' 月 · 心情分布' }));
    moodPanel.appendChild(el('div', { class: 'chart', html: moodDotsSvg(md.dist, monthList.length) }));
    moodPanel.appendChild(el('div', { class: 'legend' },
      [1, 2, 3, 4, 5].map((m) => el('span', {}, [
        el('i', { style: { background: TONES[m - 1] } }),
        el('span', { text: m + ' 分 ' + MOOD_LABEL[m] + ' · ' + md.dist[m] })
      ]))
    ));
    moodPanel.appendChild(el('div', {
      class: 'muted', style: { marginTop: '20px', fontSize: '12px', letterSpacing: '0.12em' },
      text: '本月 ' + monthList.length + ' 篇　其中 ' + md.rated + ' 篇记了心情　均 ' +
        (md.avg ? md.avg.toFixed(2) : '—')
    }));
    container.appendChild(moodPanel);

    // ---- 年度：一维时间轴 + 心情走向 ----
    const yearList = CittaStore.byYear(statYear);
    const counts = new Array(12).fill(0);
    const moodSums = new Array(12).fill(0);
    const moodCounts = new Array(12).fill(0);
    for (const e of yearList) {
      const i = Number(e.date.slice(5, 7)) - 1;
      counts[i]++;
      if (e.mood >= 1 && e.mood <= 5) { moodSums[i] += e.mood; moodCounts[i]++; }
    }
    const moodAvg = moodCounts.map((c, i) => (c ? moodSums[i] / c : null));

    const yearPanel = el('div', { class: 'panel' });
    yearPanel.appendChild(el('div', { class: 'stats-head', style: { marginBottom: '26px' } }, [
      el('h3', { text: statYear + ' 年 · 写作与心情' }),
      el('div', { class: 'cal-nav', style: { marginLeft: 'auto' } }, [
        el('button', { class: 'icon-btn', text: '‹', title: '上一年', onclick: () => { statYear--; render(); } }),
        el('button', { class: 'icon-btn', text: '›', title: '下一年', onclick: () => { statYear++; render(); } })
      ])
    ]));
    yearPanel.appendChild(el('div', { class: 'chart', html: timelineSvg(counts, moodAvg) }));
    yearPanel.appendChild(el('div', {
      class: 'muted', style: { marginTop: '14px', fontSize: '12px', letterSpacing: '0.12em' },
      text: '全年 ' + yearList.length + ' 篇　墨点浓淡即当月心情'
    }));
    container.appendChild(yearPanel);

    // ---- 心情走向（极淡的墨色横带，像飞白） ----
    const bandPanel = el('div', { class: 'panel' });
    bandPanel.appendChild(el('h3', { text: statYear + ' 年 · 心情走向' }));
    bandPanel.appendChild(el('div', { class: 'chart', html: moodBandSvg(moodAvg) }));
    container.appendChild(bandPanel);

    // ---- 常用标签 ----
    const tags = CittaStore.tagStats();
    if (tags.length) {
      const tagPanel = el('div', { class: 'panel' });
      tagPanel.appendChild(el('h3', { text: '常用标签' }));
      const row = el('div', { class: 'side-tags' });
      for (const [t, n] of tags.slice(0, 24)) {
        row.appendChild(el('span', { class: 'pill', text: t + ' ' + n }));
      }
      tagPanel.appendChild(row);
      container.appendChild(tagPanel);
    }

    // ---- 年度小结 ----
    const summary = el('div', { class: 'panel' });
    summary.appendChild(el('h3', { text: '年度小结' }));
    const yearChars = yearList.reduce((a, e) => a + CittaMarkdown.toPlain(e.content || '').length, 0);
    const lines = [
      '这一年写下 ' + yearList.length + ' 篇　共 ' + yearChars + ' 字',
      '当前连续写作 ' + streakDays() + ' 天',
      '全部记录 ' + all.length + ' 篇　' + totalWords().toLocaleString('en-US') + ' 字'
    ];
    for (const t of lines) {
      summary.appendChild(el('div', {
        class: 'muted',
        text: t,
        style: { lineHeight: '2.3', fontSize: '14px', letterSpacing: '0.06em' }
      }));
    }
    container.appendChild(summary);

    wrap.appendChild(container);
  }

  function statItem(value, label) {
    return el('div', { class: 'stat' }, [
      el('div', { class: 'sv', text: String(value) }),
      el('div', { class: 'sl', text: label })
    ]);
  }

  function refresh() { render(); }

  global.CittaStats = { init, render, refresh, streakDays, totalWords, TONES, toneColors, inkColors };
})(window);
