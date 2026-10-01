/**
 * 运行时视觉验证：读取真实计算样式，确认无浏览器默认样式泄漏与颜色错乱
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tempDir = path.join(os.tmpdir(), 'citta-vis-' + Date.now());
app.setPath('userData', tempDir);
require(path.join(__dirname, '..', 'src', 'main', 'main.js'));

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function evalIn(win, fn, ...args) {
  return win.webContents.executeJavaScript(
    'new Promise(function (resolve, reject) { try { Promise.resolve((' + fn.toString() + ').apply(null, ' +
    JSON.stringify(args) + ')).then(resolve, reject); } catch (e) { reject(e); } })', true);
}
/** 轮询等待渲染进程中的条件成立 */
async function waitIn(win, fn, timeout) {
  const deadline = Date.now() + (timeout || 10000);
  while (Date.now() < deadline) {
    let v = null;
    try { v = await evalIn(win, fn); } catch (e) { v = null; }
    if (v) return v;
    await sleep(200);
  }
  return null;
}

/** 心情五色（1 最伤心 → 5 最开心）对应的计算样式，用于校验运行时真的用上了 */
const TONES_RGB = ['rgb(45, 58, 84)', 'rgb(99, 129, 179)', 'rgb(124, 184, 153)',
  'rgb(244, 211, 94)', 'rgb(238, 124, 43)'];
/** 深色下最深两档蓝提亮，其余三档与浅色一致 */
const DARK_TONES_RGB = ['rgb(157, 177, 219)', 'rgb(125, 153, 205)', 'rgb(124, 184, 153)',
  'rgb(244, 211, 94)', 'rgb(238, 124, 43)'];

/** 把对比度/几何探测 helper 挂到 window.__audit（刷新页面后需重新注入） */
function injectHelpers(win) {
  return evalIn(win, () => {
    const parse = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c || '');
      if (!m) return null;
      const p = m[1].split(',').map((x) => parseFloat(x));
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const effBg = (el) => {
      const stack = [];
      let n = el;
      while (n && n.nodeType === 1) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0) { stack.push(c); if (c.a >= 0.999) break; }
        n = n.parentElement;
      }
      let out = { r: 255, g: 255, b: 255 };
      for (let i = stack.length - 1; i >= 0; i--) {
        const c = stack[i];
        out = {
          r: c.r * c.a + out.r * (1 - c.a),
          g: c.g * c.a + out.g * (1 - c.a),
          b: c.b * c.a + out.b * (1 - c.a)
        };
      }
      return out;
    };
    const lum = (c) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    window.__audit = {
      ratioOf: (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        // SVG 文字用 fill，不是 color
        const isSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';
        const fg = parse(isSvg ? (s.fill || s.color) : s.color);
        const la = lum(fg), lb = lum(effBg(el));
        return {
          ratio: +(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)).toFixed(2)),
          fontSize: isSvg ? (el.getAttribute('font-size') || '-') + 'px' : s.fontSize,
          text: (el.textContent || '').trim().slice(0, 12)
        };
      },
      left: (sel) => {
        const el = document.querySelector(sel);
        return el ? Math.round(el.getBoundingClientRect().left) : null;
      },
      overflow: () => {
        const vw = window.innerWidth;
        return Array.from(new Set(Array.from(document.querySelectorAll('#shell *'))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.right > vw + 1 || r.left < -1);
          })
          .map((el) => (el.className || el.tagName) + ''))).slice(0, 5);
      }
    };
    return true;
  });
}

async function run() {
  let win = null;
  for (let i = 0; i < 40 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0] || null;
    if (!win) await sleep(150);
  }
  for (let i = 0; i < 60 && win.webContents.isLoading(); i++) await sleep(100);
  await sleep(900);

  // 0) 应用图标资源：窗口与任务栏用 logo.ico（多尺寸），界面内展示用 logo.png / logo.ico
  const issues = [];
  {
    const { nativeImage } = require('electron');
    const icoPath = path.join(__dirname, '..', 'logo.ico');
    const pngPath = path.join(__dirname, '..', 'logo.png');
    console.log('=== 应用图标 ===');
    if (!fs.existsSync(icoPath)) {
      issues.push('缺少 logo.ico（窗口与任务栏图标）');
    } else {
      const buf = fs.readFileSync(icoPath);
      const frames = buf.readUInt16LE(4);
      const sizes = [];
      for (let i = 0; i < frames; i++) {
        const o = 6 + i * 16;
        sizes.push((buf[o] === 0 ? 256 : buf[o]) + 'x' + (buf[o + 1] === 0 ? 256 : buf[o + 1]));
      }
      const img = nativeImage.createFromPath(icoPath);
      const size = img.getSize();
      console.log('  logo.ico  ' + frames + ' 帧：' + sizes.join(' ') +
        '；Electron 解码 ' + size.width + 'x' + size.height);
      if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) issues.push('logo.ico 不是合法 ICO');
      if (frames < 5) issues.push('logo.ico 尺寸档位太少：' + frames);
      if (sizes.indexOf('16x16') < 0 || sizes.indexOf('32x32') < 0 || sizes.indexOf('256x256') < 0) {
        issues.push('logo.ico 缺少 16/32/256 档：' + sizes.join(' '));
      }
      if (!size.width) issues.push('Electron 无法解码 logo.ico（窗口图标会退回默认）');
    }
    if (!fs.existsSync(pngPath)) issues.push('缺少 logo.png（界面内展示）');
    else {
      const img = nativeImage.createFromPath(pngPath);
      const s = img.getSize();
      console.log('  logo.png  ' + s.width + 'x' + s.height);
      if (!s.width) issues.push('Electron 无法解码 logo.png');
    }
  }

  // 0b) 主题：测试要可复现，先把主题钉死在浅色（应用默认跟随系统，机器可能是深色）
  {
    const t = await evalIn(win, () => {
      window.CittaTheme.set('light');
      return {
        pref: window.CittaTheme.get(),
        actual: window.CittaTheme.actual(),
        attr: document.documentElement.getAttribute('data-theme'),
        stored: window.localStorage.getItem('citta.theme')
      };
    });
    console.log('=== 主题 ===');
    console.log('  偏好=' + t.pref + ' 生效=' + t.actual + ' data-theme=' + t.attr + ' 已持久化=' + t.stored);
    if (t.attr !== 'light') issues.push('CittaTheme.set(\'light\') 未生效：' + t.attr);
    if (t.stored !== 'light') issues.push('主题偏好没有写入 localStorage：' + t.stored);
  }

  // 1) 锁屏视觉
  const lock = await evalIn(win, () => {
    const cs = (sel) => {
      const n = document.querySelector(sel);
      if (!n) return null;
      const s = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      return {
        color: s.color, bg: s.backgroundColor, border: s.borderTopWidth + ' ' + s.borderTopColor,
        fontSize: s.fontSize, letterSpacing: s.letterSpacing,
        radius: s.borderTopLeftRadius, shadow: s.boxShadow, opacity: s.opacity,
        x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height)
      };
    };
    const logo = document.querySelector('#lock-logo');
    const logoSrc = logo ? (logo.getAttribute('src') || '') : '';
    return {
      body: cs('body'),
      card: cs('.lock-card'),
      h1: cs('.lock-brand h1'),
      sub: cs('.lock-brand .sub'),
      foot: cs('.lock-foot'),
      logo: logo ? cs('#lock-logo') : null,
      logoKind: logoSrc.slice(0, 22),               // data:image/png;base64 或 data:image/x-icon
      logoBytes: logoSrc.length,
      logoLoaded: !!(logo && logo.naturalWidth > 0),
      logoSize: logo && logo.naturalWidth ? logo.naturalWidth + 'x' + logo.naturalHeight : null,
      logoTop: logo ? Math.round(logo.getBoundingClientRect().top) : -1,
      // 锁屏整体（卡片 + 底部声明）应完整落在窗口内，不需要滚动
      cardBottom: Math.round(document.querySelector('.lock-card').getBoundingClientRect().bottom),
      footBottom: Math.round(document.querySelector('.lock-foot').getBoundingClientRect().bottom),
      footTop: Math.round(document.querySelector('.lock-foot').getBoundingClientRect().top),
      cardTop: Math.round(document.querySelector('.lock-card').getBoundingClientRect().top),
      scrollable: document.querySelector('#lock').scrollHeight > window.innerHeight + 1,
      viewportH: window.innerHeight,
      viewportW: window.innerWidth
    };
  });

  console.log('=== 锁屏运行时样式 ===');
  console.log('  body      bg=' + lock.body.bg + ' color=' + lock.body.color + ' 字体=' + lock.body.fontSize);
  console.log('  lock-card bg=' + lock.card.bg + ' border=' + lock.card.border + ' radius=' + lock.card.radius + ' shadow=' + lock.card.shadow);
  console.log('  标题      字号=' + lock.h1.fontSize + ' 字距=' + lock.h1.letterSpacing + ' 色=' + lock.h1.color);
  console.log('  副标题    字号=' + lock.sub.fontSize + ' 色=' + lock.sub.color);
  console.log('  应用图标  ' + lock.logoKind + '… 载入=' + lock.logoLoaded +
    ' 原始尺寸=' + lock.logoSize + ' 显示=' + (lock.logo ? lock.logo.w + 'x' + lock.logo.h : '—') +
    ' 传输=' + (lock.logoBytes / 1024).toFixed(1) + 'KB');
  console.log('  图标顶部 y=' + lock.logoTop + ' / 视口高 ' + lock.viewportH +
    '  = ' + Math.round(lock.logoTop / lock.viewportH * 100) + '%');
  console.log('  锁屏占位  卡片 y ' + lock.cardTop + '–' + lock.cardBottom +
    '，底部声明 ' + lock.footTop + '–' + lock.footBottom + '（视口高 ' + lock.viewportH + '）'
    + (lock.scrollable ? '，需要滚动' : '，一屏放得下'));
  console.log('  底部声明  色=' + lock.foot.color + ' 字号=' + lock.foot.fontSize);

  // 新方向：元素要有边界、文字要够黑够大、按钮要看得见
  // 锁屏应是一张有边界的卡片（而不是飘在空纸上的裸文字）
  if (lock.card.bg === 'rgba(0, 0, 0, 0)') issues.push('锁屏卡片缺少面（背景色）');
  if (/^0px/.test(lock.card.border)) issues.push('锁屏卡片缺少边界');
  if (!/^(\d+)px/.test(lock.card.radius) || parseFloat(lock.card.radius) < 4) {
    issues.push('锁屏卡片圆角过小：' + lock.card.radius);
  }
  if (/none/.test(lock.card.shadow)) issues.push('锁屏卡片缺少轻投影');
  // 锁屏顶部应是项目里的应用图标（logo.png / logo.ico），而不是破图或空白
  if (!lock.logo) issues.push('锁屏缺少应用图标位');
  else {
    if (!/^data:image\//.test(lock.logoKind)) issues.push('应用图标未从主进程载入：' + lock.logoKind);
    if (!lock.logoLoaded) issues.push('应用图标未能解码（naturalWidth 为 0）');
    if (lock.logo.opacity !== '1') issues.push('应用图标没有淡入到位：opacity=' + lock.logo.opacity);
    if (lock.logo.w < 56) issues.push('应用图标显示过小：' + lock.logo.w + 'px');
    // 传输的应是主进程缩放后的小图，而不是几兆的原图
    if (lock.logoBytes < 2000) issues.push('应用图标数据过小，疑似加载失败：' + lock.logoBytes + 'B');
    if (lock.logoBytes > 300000) issues.push('应用图标未缩放，传输过大：' + (lock.logoBytes / 1024).toFixed(0) + 'KB');
  }
  // 整屏（卡片 + 底部声明）必须完整可见，不能只露出一半
  if (lock.footBottom > lock.viewportH) {
    issues.push('锁屏底部声明被截断：' + lock.footBottom + ' > 视口 ' + lock.viewportH);
  }
  if (lock.cardTop < 0) issues.push('锁屏卡片顶部超出视口：' + lock.cardTop);
  // 也不能一路贴到底，上下都该留出呼吸
  if (lock.footBottom > lock.viewportH - 12 && !lock.scrollable) {
    issues.push('锁屏底部声明离窗口下沿太近：' + (lock.viewportH - lock.footBottom) + 'px');
  }
  // 标题字号与主文字色（可读性）
  if (parseFloat(lock.h1.fontSize) < 30) issues.push('「观心」字号偏小：' + lock.h1.fontSize);
  if (lock.h1.color !== 'rgb(27, 26, 24)') issues.push('主标题不是近墨色：' + lock.h1.color);
  if (parseFloat(lock.body.fontSize) < 16) issues.push('正文字号偏小：' + lock.body.fontSize);

  console.log('');
  console.log('=== 主界面运行时样式 ===');
  // 进入主界面（先设置密码）
  await evalIn(win, () => {
    document.querySelector('#setup-pw1').value = 'vis-1234';
    document.querySelector('#setup-pw2').value = 'vis-1234';
    Array.from(document.querySelectorAll('.q-item input[type="text"]'))
      .filter((i) => i.placeholder === '答案').forEach((a, i) => { a.value = 'a' + i; });
    document.querySelector('.lock-form .primary-btn').click();
  });
  await sleep(3200);

  const main = await evalIn(win, () => {
    const cs = (sel, prop) => {
      const n = document.querySelector(sel);
      if (!n) return null;
      const s = getComputedStyle(n);
      return { color: s.color, bg: s.backgroundColor, border: s.border, radius: s.borderTopLeftRadius, shadow: s.boxShadow, fontSize: s.fontSize, letterSpacing: s.letterSpacing };
    };
    const cells = Array.from(document.querySelectorAll('.cell'));
    const withBg = cells.filter((c) => getComputedStyle(c).backgroundColor !== 'rgba(0, 0, 0, 0)');
    const withBorder = cells.filter((c) => {
      const s = getComputedStyle(c);
      return parseFloat(s.borderRightWidth) > 0 || parseFloat(s.borderBottomWidth) > 0;
    });
    const todayEl = document.querySelector('.cell.today .d-num');
    const mainEl = document.querySelector('.cal-main');
    const padLeft = mainEl ? getComputedStyle(mainEl).paddingLeft : null;
    const gapPage = getComputedStyle(document.documentElement).getPropertyValue('--gap-page').trim();
    const bodyFs = getComputedStyle(document.body).fontSize;
    const cellFs = cells.length ? getComputedStyle(cells[0]).fontSize : null;
    const calTitle = document.querySelector('.cal-title-btn');
    // 顶栏入口：应是完整词语，不是单字缩写
    const topBtns = Array.from(document.querySelectorAll('.topbar-right button')).map((b) => ({
      label: b.textContent.trim(),
      w: Math.round(b.getBoundingClientRect().width),
      h: Math.round(b.getBoundingClientRect().height)
    }));
    return {
      topbar: cs('.topbar'),
      topbarBorder: getComputedStyle(document.querySelector('.topbar')).borderBottomWidth + ' ' +
        getComputedStyle(document.querySelector('.topbar')).borderBottomColor,
      tab: cs('.tab'),
      tabActive: cs('.tab.active'),
      calGrid: cs('.cal-grid'),
      cellCount: cells.length,
      有底色的格子: withBg.length,
      有边框的格子: withBorder.length,
      今天日期色: todayEl ? getComputedStyle(todayEl).color : null,
      页面边距: padLeft,
      期望边距: gapPage,
      正文字号: bodyFs,
      日期字号: cellFs,
      月标题字号: calTitle ? getComputedStyle(calTitle).fontSize : null,
      顶栏按钮: topBtns,
      主按钮: cs('.primary-btn:not([disabled])')
    };
  });

  console.log('  顶栏      bg=' + main.topbar.bg + ' 下边界=' + main.topbarBorder);
  console.log('  标签页    active色=' + main.tabActive.color + ' radius=' + main.tabActive.radius +
    '；未选中色=' + main.tab.color);
  console.log('  整月容器  bg=' + main.calGrid.bg + ' 边界=' + main.calGrid.border);
  console.log('  日历格    ' + main.cellCount + ' 个；有分隔面的 ' + main.有底色的格子 +
    ' 个、有分隔线的 ' + main.有边框的格子 + ' 个；日期字号 ' + main.日期字号);
  console.log('  今天日期色 ' + main.今天日期色 + '（应为朱砂 rgb(156, 61, 46)）');
  console.log('  页面边距  ' + main.页面边距 + '（--gap-page = ' + main.期望边距 + '）');
  console.log('  月标题    ' + main.月标题字号 + '；正文 ' + main.正文字号);
  console.log('  顶栏入口  ' + main.顶栏按钮.map((b) => b.label + '(' + b.w + '×' + b.h + ')').join(' '));
  console.log('  主按钮    ' + (main.主按钮 ? 'bg=' + main.主按钮.bg + ' radius=' + main.主按钮.radius : '（当前视图无主按钮）'));

  // 顶栏要有下边界，内容区才与导航分清
  if (/^0px/.test(main.topbarBorder)) issues.push('顶栏缺少下边界');
  // 日历应是一张有边界、有分隔的月历（而不是飘在纸上的裸数字）
  if (/none/.test(main.calGrid.border)) issues.push('整月容器缺少边界');
  if (main.calGrid.bg === 'rgba(0, 0, 0, 0)') issues.push('整月容器缺少面（背景色）');
  if (main.有底色的格子 === 0) issues.push('日历格没有任何分隔面，整月难以分辨');
  if (main.有边框的格子 === 0) issues.push('日历格没有任何分隔线');
  if (main.今天日期色 !== 'rgb(156, 61, 46)') issues.push('今天日期不是朱砂色：' + main.今天日期色);
  // 页面边距必须来自 --gap-page（同一套间距令牌），不再散落魔法数字
  if (main.页面边距 !== main.期望边距) {
    issues.push('页面边距 ' + main.页面边距 + ' 与 --gap-page ' + main.期望边距 + ' 不一致');
  }
  // 正文与日期都不应过小（可读性）
  if (parseFloat(main.正文字号) < 16) issues.push('正文字号偏小：' + main.正文字号);
  if (parseFloat(main.日期字号) < 13) issues.push('日期字号偏小：' + main.日期字号);
  if (parseFloat(main.月标题字号) < 22) issues.push('月标题字号偏小：' + main.月标题字号);
  // 主按钮要有可辨识的填充（禁用态不算）
  if (main.主按钮 && (main.主按钮.bg === 'rgba(0, 0, 0, 0)' || main.主按钮.bg === 'transparent')) {
    issues.push('可用状态的主按钮缺少填充，不够醒目');
  }
  // 顶栏入口只留「搜索 / 设置」，今天在日历头部
  {
    const labels = main.顶栏按钮.map((b) => b.label);
    ['搜索', '设置'].forEach((want) => {
      if (labels.indexOf(want) < 0) issues.push('顶栏缺少「' + want + '」按钮：' + labels.join('/'));
    });
    if (labels.indexOf('今天') >= 0) issues.push('顶栏不应再放「今天」按钮：' + labels.join('/'));
    main.顶栏按钮.forEach((b) => {
      if (b.h < 28) issues.push('顶栏按钮「' + b.label + '」可点高度偏小：' + b.h + 'px');
    });
  }
  // 次要文字不能过浅（可读性下限：未选中标签应到 --ink-400 一档）
  if (main.tab && (main.tab.color === 'rgb(196, 191, 182)' || main.tab.color === 'rgb(150, 144, 138)')) {
    issues.push('标签文字过浅，影响阅读：' + main.tab.color);
  }

  // ---- 编辑区可读性：正文字号、行距、墨色 ----
  await evalIn(win, () => {
    const cell = document.querySelector('#view-calendar .cell.today') ||
      document.querySelector('#view-calendar .cell:not(.out)');
    if (cell) cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await sleep(1400);

  const ed = await evalIn(win, () => {
    const ta = document.querySelector('#ed-content');
    if (!ta) return null;
    const s = getComputedStyle(ta);
    const fs = parseFloat(s.fontSize);
    const lh = s.lineHeight === 'normal' ? fs * 1.2 : parseFloat(s.lineHeight);
    return {
      open: !document.querySelector('#editor').classList.contains('hidden'),
      fontSize: s.fontSize, lineHeight: s.lineHeight, ratio: +(lh / fs).toFixed(2),
      color: s.color, bg: s.backgroundColor, width: Math.round(ta.getBoundingClientRect().width)
    };
  });

  console.log('');
  console.log('=== 编辑区运行时样式 ===');
  if (!ed || !ed.open) {
    console.log('  （未能打开编辑区，跳过）');
  } else {
    console.log('  正文      ' + ed.fontSize + ' / 行距 ' + ed.lineHeight + '（' + ed.ratio + ' 倍）色=' + ed.color);
    console.log('  书写面    bg=' + ed.bg + ' 宽=' + ed.width);
    if (parseFloat(ed.fontSize) < 17) issues.push('编辑区正文字号偏小：' + ed.fontSize);
    if (ed.ratio < 1.7) issues.push('编辑区行距偏紧：' + ed.ratio + ' 倍');
    // 正文墨色不能是灰色（近墨 #1b1a18 / #33302b 一档）
    if (ed.color === 'rgb(111, 106, 98)' || ed.color === 'rgb(150, 144, 138)') {
      issues.push('编辑区正文是灰色：' + ed.color);
    }
  }

  // ---- 版式与对比度：把「整齐」「看得清」变成可测量的事实 ----
  await injectHelpers(win);
  const layout = await evalIn(win, () => {
    const A = window.__audit;
    const ratioOf = A.ratioOf, left = A.left;

    // 日历七列应等宽
    const row = document.querySelector('.cal-weeks .cal-row') || document.querySelector('.cal-row');
    const colWidths = row ? Array.from(row.children).map((c) => Math.round(c.getBoundingClientRect().width)) : [];

    // 可点区域高度
    const hit = {};
    [['.tab', '标签'], ['.icon-btn', '图标钮'], ['.ghost-btn', '次级钮'], ['.cal-nav button', '翻月钮']]
      .forEach(([sel, name]) => {
        const el = document.querySelector(sel);
        if (el) hit[name] = Math.round(el.getBoundingClientRect().height);
      });

    return {
      对比度: {
        正文: ratioOf('body'),
        月历日期: ratioOf('.cell:not(.out) .d-num'),
        农历小字: ratioOf('.cell:not(.out) .d-lunar'),
        非本月日期: ratioOf('.cell.out .d-num'),
        标签文字: ratioOf('.tab:not(.active)'),
        选中标签: ratioOf('.tab.active'),
        说明文字: ratioOf('.muted'),
        月标题: ratioOf('.cal-title-btn'),
        单元格标签: ratioOf('.cal-week span')
      },
      左基准: {
        顶栏: left('.topbar .brand'),
        月标题: left('.cal-head'),
        月历: left('.cal-grid'),
        侧栏: left('.cal-side')
      },
      页面边距: getComputedStyle(document.querySelector('.cal-main')).paddingLeft,
      列宽: colWidths,
      可点高度: hit,
      横向溢出: A.overflow()
    };
  });

  console.log('');
  console.log('=== 版式与对比度（日历） ===');
  Object.keys(layout.对比度).forEach((k) => {
    const v = layout.对比度[k];
    if (v) console.log('  ' + k.padEnd(5, '　') + ' 对比度 ' + v.ratio + '  字号 ' + v.fontSize + '  「' + v.text + '」');
  });
  console.log('  左基准    ' + JSON.stringify(layout.左基准) + '（页面边距 ' + layout.页面边距 + '）');
  console.log('  七列宽度  ' + layout.列宽.join(' / '));
  console.log('  可点高度  ' + JSON.stringify(layout.可点高度));

  // 对比度：正文/日期属「必读」→ ≥ 7；说明、标签、次要文字 → ≥ 4.5
  const mustRead = ['正文', '月历日期', '月标题', '条目正文', '条目日期', '统计数字', '面板标题'];
  const secondary = ['农历小字', '标签文字', '选中标签', '说明文字', '单元格标签', '非本月日期',
    '条目副行', '修改时间', '标签药丸', '筛选标题', '筛选计数', '统计标签', '图表标注', '图表说明'];
  const checkContrast = (group, label) => {
    Object.keys(group).forEach((k) => {
      const v = group[k];
      if (!v) return;
      if (mustRead.indexOf(k) >= 0 && v.ratio < 7) issues.push(label + k + ' 对比度偏低：' + v.ratio + '（应 ≥ 7）');
      else if (secondary.indexOf(k) >= 0 && v.ratio < 4.5) issues.push(label + k + ' 对比度偏低：' + v.ratio + '（应 ≥ 4.5）');
      else if (v.ratio < 3) issues.push(label + k + ' 对比度不足：' + v.ratio + '（应 ≥ 3）');
    });
  };
  checkContrast(layout.对比度, '');

  // ---- 年月选择器：位置、栅格、可点尺寸、文字对比度 ----
  await evalIn(win, () => {
    const tab = document.querySelector('.tab[data-view="calendar"]');
    if (tab) tab.click();
  });
  await sleep(500);
  await evalIn(win, () => document.querySelector('.cal-title-btn').click());
  await sleep(500);
  const picker = await evalIn(win, () => {
    const A = window.__audit;
    const box = document.querySelector('.picker');
    if (!box) return null;
    const r = box.getBoundingClientRect();
    const cells = Array.from(box.querySelectorAll('.picker-cell'));
    const lefts = Array.from(new Set(cells.map((c) => Math.round(c.getBoundingClientRect().left))));
    const rows = Array.from(new Set(cells.map((c) => Math.round(c.getBoundingClientRect().top))));
    return {
      inside: r.left >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
      rect: Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height),
      count: cells.length,
      columns: lefts.length,
      rows: rows.length,
      cellH: cells.length ? Math.round(cells[0].getBoundingClientRect().height) : 0,
      border: getComputedStyle(box).borderTopWidth,
      bg: getComputedStyle(box).backgroundColor,
      title: A.ratioOf('.picker-title'),
      cell: A.ratioOf('.picker-cell'),
      onCell: A.ratioOf('.picker-cell.on')
    };
  });
  console.log('');
  console.log('=== 年月选择器 ===');
  if (!picker) {
    issues.push('点标题后没有出现年月选择器');
  } else {
    console.log('  面板      ' + picker.rect + ' 视口内=' + picker.inside + ' 边界=' + picker.border + ' bg=' + picker.bg);
    console.log('  栅格      ' + picker.count + ' 格 / ' + picker.columns + ' 列 × ' + picker.rows + ' 行，格高 ' + picker.cellH + 'px');
    console.log('  文字对比  月份 ' + picker.cell.ratio + '，当前月 ' + picker.onCell.ratio + '，标题 ' + picker.title.ratio);
    if (!picker.inside) issues.push('年月选择器超出视口：' + picker.rect);
    if (picker.count !== 12 || picker.columns !== 3 || picker.rows !== 4) {
      issues.push('年月选择器栅格不是 3×4：' + picker.count + ' 格 / ' + picker.columns + ' 列');
    }
    if (picker.cellH < 28) issues.push('选择器格子可点高度偏小：' + picker.cellH + 'px');
    if (/^0px/.test(picker.border)) issues.push('年月选择器缺少边界');
    if (picker.bg === 'rgba(0, 0, 0, 0)') issues.push('年月选择器缺少面（背景色）');
    if (picker.onCell.ratio < 4.5) issues.push('当前月的朱色文字对比度不足：' + picker.onCell.ratio);
    if (picker.cell.ratio < 7) issues.push('选择器月份文字对比度不足：' + picker.cell.ratio);
  }
  // 切到年视图再检查一次（12 个年份）
  await evalIn(win, () => document.querySelector('.picker-title').click());
  await sleep(400);
  const pickerYear = await evalIn(win, () => {
    const cells = Array.from(document.querySelectorAll('.picker-cell'));
    return {
      label: document.querySelector('.picker-title').textContent.trim(),
      count: cells.length,
      allNumeric: cells.every((c) => /^\d{4}$/.test(c.textContent.trim())),
      inside: (() => {
        const r = document.querySelector('.picker').getBoundingClientRect();
        return r.left >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1;
      })()
    };
  });
  console.log('  年视图    ' + pickerYear.label + '，' + pickerYear.count + ' 个年份，全数字=' + pickerYear.allNumeric);
  if (pickerYear.count !== 12 || !pickerYear.allNumeric) issues.push('年视图不是 12 个年份：' + JSON.stringify(pickerYear));
  if (!pickerYear.inside) issues.push('年视图面板超出视口');
  await evalIn(win, () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await sleep(300);
  if (await evalIn(win, () => !!document.querySelector('.picker'))) issues.push('Esc 未能收起年月选择器');
  // 对齐：顶栏品牌、月标题、月历应共用同一条左基准线
  const bases = [layout.左基准.顶栏, layout.左基准.月标题, layout.左基准.月历].filter((v) => v !== null);
  if (new Set(bases).size > 1) issues.push('左侧基准线不齐：' + JSON.stringify(layout.左基准));
  // 日历七列等宽
  if (layout.列宽.length === 7 && Math.max.apply(null, layout.列宽) - Math.min.apply(null, layout.列宽) > 1) {
    issues.push('日历七列宽度不一致：' + layout.列宽.join('/'));
  }
  // 可点区域不小于 28px
  Object.keys(layout.可点高度).forEach((k) => {
    if (layout.可点高度[k] < 28) issues.push(k + ' 可点高度偏小：' + layout.可点高度[k] + 'px');
  });
  // 不允许横向溢出
  if (layout.横向溢出.length) issues.push('元素横向溢出视口：' + layout.横向溢出.join(', '));

  // ---- 列表页与统计页：有内容时的可读性与对齐 ----
  // 先落几篇日记（走 IPC 直接入库），再刷新界面让它们出现在列表与统计里
  await evalIn(win, async () => {
    const day = new Date();
    const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    for (let i = 0; i < 3; i++) {
      const d = new Date(day.getTime() - i * 86400000);
      await window.citta.saveEntry(iso(d), {
        content: '第 ' + (i + 1) + ' 天：把边框补齐，字也放大了。\n\n留白是呼吸，边界是秩序。',
        mood: 5 - i, weather: ['晴', '阴', '雨'][i], event: '版式迭代',
        tags: ['设计', '心得'], images: []
      });
    }
    await window.citta.flush();
  });
  win.webContents.reload();
  const back = await waitIn(win, () => {
    const shell = document.querySelector('#shell');
    return shell && !shell.classList.contains('hidden') && document.querySelectorAll('.cell').length >= 28;
  }, 15000);
  if (!back) issues.push('刷新后未能回到主界面');
  await sleep(800);
  await injectHelpers(win);

  const otherViews = [];
  for (const view of ['list', 'stats']) {
    await evalIn(win, (v) => {
      const tab = document.querySelector('.tab[data-view="' + v + '"]');
      if (tab) tab.click();
    }, view);
    await sleep(900);
    const rep = await evalIn(win, () => {
      const A = window.__audit;
      const visible = (id) => {
        const el = document.querySelector(id);
        return !!el && !el.classList.contains('hidden');
      };
      const pick = {};
      if (visible('#view-list') && document.querySelector('.entry-card')) {
        pick['条目正文'] = A.ratioOf('.entry-card .ec-body');
        pick['条目日期'] = A.ratioOf('.entry-card .ec-date');
        pick['条目副行'] = A.ratioOf('.entry-card .ec-lunar');
        pick['修改时间'] = A.ratioOf('.entry-card .ec-foot .muted');
        pick['标签药丸'] = A.ratioOf('.entry-card .ec-foot .pill');
        pick['筛选标题'] = A.ratioOf('.filter-title');
        pick['筛选计数'] = A.ratioOf('.filter-item .n');
      }
      if (visible('#view-stats') && document.querySelector('.panel')) {
        pick['面板标题'] = A.ratioOf('.panel > h3');
        pick['统计数字'] = A.ratioOf('.stat .sv');
        pick['统计标签'] = A.ratioOf('.stat .sl');
        pick['图表标注'] = A.ratioOf('.panel svg text');
        pick['图表说明'] = A.ratioOf('.panel .muted');
      }
      const gridCols = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        return Array.from(el.children).map((c) => Math.round(c.getBoundingClientRect().left));
      };
      // 列表里的心情点：亮起的那几点，颜色应逐档对应心情五色
      const moodCards = visible('#view-list')
        ? Array.from(document.querySelectorAll('.entry-card')).map((card) => {
          const mark = card.querySelector('.ec-mood');
          if (!mark) return null;
          const dots = Array.from(mark.querySelectorAll('i'));
          return {
            title: mark.getAttribute('title') || '',
            all: dots.map((d) => getComputedStyle(d).backgroundColor),
            on: dots.filter((d) => d.classList.contains('on')).map((d) => getComputedStyle(d).backgroundColor),
            size: dots.length ? Math.round(dots[0].getBoundingClientRect().width) : 0
          };
        }).filter(Boolean)
        : [];
      return {
        对比度: pick,
        卡片数: visible('#view-list') ? document.querySelectorAll('.entry-card').length : 0,
        卡片左边界: gridCols('.entry-list'),
        心情点: moodCards,
        横向溢出: A.overflow()
      };
    });
    otherViews.push({ view, rep });

    console.log('');
    console.log('=== ' + (view === 'list' ? '日记列表' : '统计') + ' ===');
    Object.keys(rep.对比度).forEach((k) => {
      const v = rep.对比度[k];
      if (v) console.log('  ' + k + ' 对比度 ' + v.ratio + '  字号 ' + v.fontSize + '  「' + v.text + '」');
    });
    if (rep.卡片数) console.log('  条目卡片 ' + rep.卡片数 + ' 张');
    if (rep.心情点 && rep.心情点.length) {
      rep.心情点.forEach((m) => {
        console.log('  心情点    ' + m.title + '：亮 ' + m.on.join(' ') + '，点径 ' + m.size + 'px');
      });
    }
    if (rep.横向溢出.length) console.log('  横向溢出 ' + rep.横向溢出.join(', '));

    // 列表心情点：第 i 个亮点应使用第 i 档心情色
    (rep.心情点 || []).forEach((m) => {
      m.on.forEach((color, i) => {
        if (color !== TONES_RGB[i]) {
          issues.push('列表心情点第 ' + (i + 1) + ' 档颜色不对：' + color + '（应为 ' + TONES_RGB[i] + '）');
        }
      });
      if (m.size < 8) issues.push('列表心情点偏小：' + m.size + 'px');
    });

    checkContrast(rep.对比度, (view === 'list' ? '列表' : '统计') + '·');
    // 卡片左边界应齐成一条线
    const ls = rep.卡片左边界 || [];
    if (ls.length > 1 && new Set(ls).size > 1) issues.push('列表条目左边界不齐：' + ls.join('/'));
    if (rep.横向溢出.length) issues.push('元素横向溢出视口：' + rep.view + ' ' + rep.横向溢出.join(', '));
  }

  // 回日历页：确认有记录的日子用的是「该日心情色」的圆点，且大小到位
  await evalIn(win, () => {
    const tab = document.querySelector('.tab[data-view="calendar"]');
    if (tab) tab.click();
  });
  await sleep(900);
  const moodDot = await evalIn(win, () => {
    const cells = Array.from(document.querySelectorAll('.cell[data-mood]'));
    const dots = cells.map((c) => {
      const d = c.querySelector('.dot');
      return {
        mood: Number(c.dataset.mood),
        color: d ? getComputedStyle(d).backgroundColor : null,
        size: d ? Math.round(d.getBoundingClientRect().width) : 0
      };
    });
    return { count: cells.length, dots: dots };
  });
  console.log('');
  console.log('=== 日历心情圆点 ===');
  console.log('  带心情的日期 ' + moodDot.count + ' 天：' +
    moodDot.dots.slice(0, 6).map((d) => d.mood + '分 ' + d.color + ' ' + d.size + 'px').join('，'));
  if (!moodDot.count) issues.push('日历上没有任何心情圆点');
  moodDot.dots.forEach((d) => {
    if (d.color !== TONES_RGB[d.mood - 1]) {
      issues.push('日历 ' + d.mood + ' 分的心情圆点颜色不对：' + d.color +
        '（应为 ' + TONES_RGB[d.mood - 1] + '）');
    }
    if (d.size < 9) issues.push('日历心情圆点偏小：' + d.size + 'px（' + d.mood + ' 分）');
  });

  // ---- 深色模式：同一套版式与对比度要求必须仍然成立 ----
  win.setSize(1180, 780);
  await sleep(400);
  await evalIn(win, () => { window.CittaTheme.set('dark'); });
  await sleep(700);
  await evalIn(win, () => {
    const tab = document.querySelector('.tab[data-view="calendar"]');
    if (tab) tab.click();
  });
  await sleep(800);
  await injectHelpers(win);

  const dark = await evalIn(win, () => {
    const A = window.__audit;
    const cs = (sel) => {
      const n = document.querySelector(sel);
      if (!n) return null;
      const s = getComputedStyle(n);
      return { bg: s.backgroundColor, color: s.color, border: s.borderTopWidth + ' ' + s.borderTopColor,
        fontSize: s.fontSize, opacity: s.opacity };
    };
    const root = getComputedStyle(document.documentElement);
    const cells = Array.from(document.querySelectorAll('.cell'));
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      colorScheme: document.documentElement.style.colorScheme,
      paper: root.getPropertyValue('--paper').trim(),
      vermilion: root.getPropertyValue('--vermilion').trim(),
      body: cs('body'),
      card: cs('.cal-grid'),
      cell: (() => {
        const c = document.querySelector('.cell:not(.out)');
        return c ? getComputedStyle(c).backgroundColor : null;
      })(),
      cellOut: (() => {
        const c = document.querySelector('.cell.out');
        return c ? getComputedStyle(c).backgroundColor : null;
      })(),
      today: (() => {
        const t = document.querySelector('.cell.today .d-num');
        return t ? getComputedStyle(t).color : null;
      })(),
      logo: cs('#lock-logo'),
      对比度: {
        正文: A.ratioOf('body'),
        月历日期: A.ratioOf('.cell:not(.out) .d-num'),
        农历小字: A.ratioOf('.cell:not(.out) .d-lunar'),
        非本月日期: A.ratioOf('.cell.out .d-num'),
        标签文字: A.ratioOf('.tab:not(.active)'),
        选中标签: A.ratioOf('.tab.active'),
        说明文字: A.ratioOf('.muted'),
        月标题: A.ratioOf('.cal-title-btn'),
        单元格标签: A.ratioOf('.cal-week span'),
        顶栏按钮: A.ratioOf('.topbar-right button')
      },
      心情点: cells.filter((c) => c.dataset.mood).map((c) => {
        const d = c.querySelector('.dot');
        return Number(c.dataset.mood) + ':' + (d ? getComputedStyle(d).backgroundColor : '—');
      })
    };
  });

  console.log('');
  console.log('=== 深色模式 ===');
  console.log('  data-theme=' + dark.theme + ' color-scheme=' + dark.colorScheme +
    ' --paper=' + dark.paper + ' --vermilion=' + dark.vermilion);
  console.log('  body bg=' + dark.body.bg + ' 色=' + dark.body.color);
  console.log('  月历容器  bg=' + dark.card.bg + ' 边界=' + dark.card.border);
  console.log('  日期格    bg=' + dark.cell + '；非本月 ' + dark.cellOut + '；今天日期色=' + dark.today);
  console.log('  心情点    ' + dark.心情点.join(' '));
  Object.keys(dark.对比度).forEach((k) => {
    const v = dark.对比度[k];
    if (v) console.log('  ' + k.padEnd(5, '　') + ' 对比度 ' + v.ratio + '  字号 ' + v.fontSize);
  });

  if (dark.theme !== 'dark') issues.push('切到深色后 data-theme 不是 dark：' + dark.theme);
  if (dark.colorScheme !== 'dark') issues.push('color-scheme 未同步为 dark：' + dark.colorScheme);
  // 深色下必须真的变暗：页面底、卡片面、日期格都要比浅色深
  if (dark.body.bg === 'rgb(245, 242, 234)') issues.push('深色模式页面底色仍是浅色');
  if (/rgb\((2[0-9]{2}), (2[0-9]{2})/.test(dark.cell)) issues.push('深色模式日期格仍是亮的：' + dark.cell);
  if (dark.cell === dark.cellOut) issues.push('深色模式下非本月与本月格没有区分');
  if (dark.today === 'rgb(156, 61, 46)') issues.push('深色模式仍用浅色朱砂：' + dark.today);
  dark.心情点.forEach((entry) => {
    const [mood, color] = entry.split(':');
    const expect = DARK_TONES_RGB[Number(mood) - 1];
    if (color !== expect) {
      issues.push('深色下 ' + mood + ' 分心情点颜色不对：' + color + '（应为 ' + expect + '）');
    }
  });
  checkContrast(dark.对比度, '深色·');
  // 深色下也要能看清今天：朱色文字对比不低于 4.5
  if (dark.对比度.月历日期 && dark.对比度.月历日期.ratio < 7) {
    issues.push('深色平日日期对比度偏低：' + dark.对比度.月历日期.ratio);
  }

  // 深色下的列表与统计：卡片、面板、药丸、筛选选中态都要读得清
  for (const view of ['list', 'stats']) {
    await evalIn(win, (v) => {
      const tab = document.querySelector('.tab[data-view="' + v + '"]');
      if (tab) tab.click();
    }, view);
    await sleep(900);
    const rep = await evalIn(win, () => {
      const A = window.__audit;
      const visible = (id) => {
        const el = document.querySelector(id);
        return !!el && !el.classList.contains('hidden');
      };
      const pick = {};
      if (visible('#view-list')) {
        pick['条目正文'] = A.ratioOf('.entry-card .ec-body');
        pick['条目日期'] = A.ratioOf('.entry-card .ec-date');
        pick['修改时间'] = A.ratioOf('.entry-card .ec-foot .muted');
        pick['标签药丸'] = A.ratioOf('.entry-card .ec-foot .pill');
        pick['筛选标题'] = A.ratioOf('.filter-title');
        pick['筛选计数'] = A.ratioOf('.filter-item .n');
        pick['筛选选中'] = A.ratioOf('.filter-item.active');
        pick['置顶标签'] = A.ratioOf('.pill.accent');
      }
      if (visible('#view-stats')) {
        pick['面板标题'] = A.ratioOf('.panel > h3');
        pick['统计数字'] = A.ratioOf('.stat .sv');
        pick['统计标签'] = A.ratioOf('.stat .sl');
        pick['图表标注'] = A.ratioOf('.panel svg text');
        pick['图表说明'] = A.ratioOf('.panel .muted');
      }
      return {
        cardBg: (() => {
          const c = document.querySelector('.entry-card');
          return c ? getComputedStyle(c).backgroundColor : null;
        })(),
        panelBg: (() => {
          const p = document.querySelector('.panel');
          return p ? getComputedStyle(p).backgroundColor : null;
        })(),
        对比度: pick
      };
    });
    console.log('  深色·' + (view === 'list' ? '列表' : '统计') +
      '  卡片/面板 bg=' + (rep.cardBg || rep.panelBg));
    Object.keys(rep.对比度).forEach((k) => {
      const v = rep.对比度[k];
      if (v) console.log('    ' + k + ' 对比度 ' + v.ratio + ' 字号 ' + v.fontSize);
    });
    if (rep.cardBg && /rgb\((2[0-9]{2}), /.test(rep.cardBg)) issues.push('深色下列表卡片仍是亮的：' + rep.cardBg);
    if (rep.panelBg && /rgb\((2[0-9]{2}), /.test(rep.panelBg)) issues.push('深色下统计面板仍是亮的：' + rep.panelBg);
    checkContrast(rep.对比度, '深色·' + (view === 'list' ? '列表·' : '统计·'));
  }
  await evalIn(win, () => {
    const tab = document.querySelector('.tab[data-view="calendar"]');
    if (tab) tab.click();
  });
  await sleep(600);

  // 深色下的编辑区与锁屏（正文颜色是全局的，但这两处的面不同，仍要量一次）
  await evalIn(win, () => {
    const tab = document.querySelector('.tab[data-view="calendar"]');
    if (tab) tab.click();
  });
  await sleep(400);
  await evalIn(win, () => {
    const cell = document.querySelector('#view-calendar .cell.today');
    if (cell) cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await sleep(1200);
  const darkEd = await evalIn(win, () => {
    const A = window.__audit;
    const ta = document.querySelector('#ed-content');
    const md = document.querySelector('#ed-preview .markdown') || document.querySelector('#ed-preview');
    return {
      open: !document.querySelector('#editor').classList.contains('hidden'),
      textarea: ta ? { color: getComputedStyle(ta).color, bg: getComputedStyle(ta).backgroundColor } : null,
      previewBg: md ? getComputedStyle(md.parentElement).backgroundColor : null,
      对比度: { 编辑正文: A.ratioOf('#ed-content'), 预览标题: A.ratioOf('#ed-preview h1, #ed-preview h2, #ed-preview p') }
    };
  });
  if (darkEd.open) {
    console.log('  编辑区    正文色=' + darkEd.textarea.color + ' 预览面=' + darkEd.previewBg);
    Object.keys(darkEd.对比度).forEach((k) => {
      const v = darkEd.对比度[k];
      if (v) console.log('  ' + k + ' 对比度 ' + v.ratio + ' 字号 ' + v.fontSize);
    });
    if (darkEd.textarea.color === 'rgb(27, 26, 24)') issues.push('深色下编辑正文仍是近黑色');
    checkContrast(darkEd.对比度, '深色·');
  }
  await evalIn(win, () => { if (window.CittaEditor) CittaEditor.close(); });
  await sleep(600);

  // 锁屏在深色下同样要读得清
  await evalIn(win, () => { window.CittaApp.lock(); });
  await sleep(900);
  const darkLock = await evalIn(win, () => {
    const A = window.__audit;
    const card = document.querySelector('.lock-card');
    return {
      exists: !!card,
      cardBg: card ? getComputedStyle(card).backgroundColor : null,
      对比度: { 品牌: A.ratioOf('.lock-brand h1'), 副标题: A.ratioOf('.lock-brand .sub'),
        声明: A.ratioOf('.lock-foot'), 输入: A.ratioOf('#unlock-pw') }
    };
  });
  if (darkLock.exists) {
    console.log('  锁屏      卡片 bg=' + darkLock.cardBg);
    Object.keys(darkLock.对比度).forEach((k) => {
      const v = darkLock.对比度[k];
      if (v) console.log('  ' + k + ' 对比度 ' + v.ratio + ' 字号 ' + v.fontSize);
    });
    if (/rgb\((2[0-9]{2}), (2[0-9]{2})/.test(darkLock.cardBg || '')) {
      issues.push('深色下锁屏卡片仍是亮的：' + darkLock.cardBg);
    }
    checkContrast(darkLock.对比度, '深色·锁屏·');
  }

  // 切回浅色，后面的检查（与用户真实默认一致）
  await evalIn(win, () => { window.CittaTheme.set('light'); });
  await sleep(500);

  // ---- 锁屏在最小窗口下的完整可见性（底部声明不能只露一半）----
  const lockFits = [];
  for (const [w, h] of [[1180, 780], [900, 600]]) {
    win.setSize(w, h);
    await sleep(500);
    await evalIn(win, () => { window.CittaApp.lock(); });
    await sleep(900);
    const m = await evalIn(win, () => {
      const card = document.querySelector('.lock-card');
      const foot = document.querySelector('.lock-foot');
      const lock = document.querySelector('#lock');
      if (!card || !foot) return null;
      const r = card.getBoundingClientRect();
      const f = foot.getBoundingClientRect();
      return {
        viewport: window.innerWidth + 'x' + window.innerHeight,
        hasUnlockForm: !!document.querySelector('#unlock-pw'),
        card: Math.round(r.top) + '–' + Math.round(r.bottom),
        foot: Math.round(f.top) + '–' + Math.round(f.bottom),
        footVisible: f.bottom <= window.innerHeight + 1 && f.top >= 0,
        cramped: window.innerHeight - f.bottom,
        scrollable: lock.scrollHeight > lock.clientHeight + 1
      };
    });
    lockFits.push(m);
    console.log('  锁屏 @ ' + (m ? m.viewport : w + 'x' + h) + '：卡片 ' + (m ? m.card : '—') +
      '，底部声明 ' + (m ? m.foot : '—') + '，完整可见=' + (m ? m.footVisible : '—') +
      '，下沿余量 ' + (m ? m.cramped : '—') + 'px' + (m && m.scrollable ? '（可滚动）' : ''));
    if (!m) { issues.push('锁屏缺少卡片或底部声明'); continue; }
    if (!m.footVisible) issues.push('锁屏 @ ' + m.viewport + '：底部声明被截断（' + m.foot + '）');
    if (m.cramped < 8 && !m.scrollable) issues.push('锁屏 @ ' + m.viewport + '：底部声明贴到窗口下沿');
  }

  console.log('');
  if (issues.length) {
    console.log('运行时不合规 ' + issues.length + ' 处：');
    issues.forEach((i) => console.log('  ✗ ' + i));
  } else {
    console.log('  ✓ 运行时样式全部符合规范');
  }

  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  app.exit(issues.length ? 1 : 0);
}

app.whenReady().then(() => {
  setTimeout(() => { run().catch((e) => { console.error(e); app.exit(1); }); }, 400);
});
