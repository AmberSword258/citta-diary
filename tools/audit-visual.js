/**
 * 视觉规范审计：检查 CSS / JS 中的禁用项与设计令牌是否合规
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src', 'renderer');
const files = [
  'styles/base.css', 'styles/views.css', 'index.html',
  'js/theme.js', 'js/app.js', 'js/lock.js', 'js/editor.js', 'js/calendar.js',
  'js/list.js', 'js/stats.js', 'js/settings.js', 'js/ui.js'
];
const src = {};
for (const f of files) {
  src[f] = fs.readFileSync(path.join(root, f), 'utf8');
}
const all = Object.values(src).join('\n');

/** 读取 base.css 中的令牌值（函数声明，便于在文件前部使用） */
function tokenOf(name) {
  const mm = src['styles/base.css'].match(new RegExp('--' + name + ':\\s*([^;]+);'));
  return mm ? mm[1].trim() : null;
}

const issues = [];
const notes = [];
function bad(msg) { issues.push(msg); }
function ok(msg) { notes.push(msg); }

// ---------------------------------------------------------------------------
// 禁止清单
// ---------------------------------------------------------------------------

// 心情五色：用户指定，是唯一允许「彩色」的豁免区（含黄与橘）
const MOOD_TONES = {
  'tone-1': '#2d3a54',   // 最伤心
  'tone-2': '#6381b3',   // 略伤心
  'tone-3': '#7cb899',   // 平静
  'tone-4': '#f4d35e',   // 有点开心
  'tone-5': '#ee7c2b'    // 最开心
};
const toneValues = Object.keys(MOOD_TONES).map((k) => MOOD_TONES[k]);

// ✗ 高明度橙（心情最开心那一档除外）
for (const hex of ['#FF6B35', '#E8722C', '#C0632F', '#ff6b35', '#e8722c', '#c0632f']) {
  if (all.includes(hex)) bad('出现禁止的高明度橙：' + hex);
}
// 任何高明度橙的近似（R 高、G 中、B 低），心情五色豁免
const orangeRe = /#[0-9a-fA-F]{6}/g;
let m;
const oranges = [];
while ((m = orangeRe.exec(all))) {
  const hex = m[0].toLowerCase();
  if (toneValues.indexOf(hex) >= 0) continue;   // 心情色是有意为之
  const h = hex.slice(1);
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  if (r > 200 && g > 90 && g < 160 && b < 90) oranges.push(m[0]);
}
if (oranges.length) bad('疑似高明度橙：' + Array.from(new Set(oranges)).join(', '));
else ok('无高明度橙（心情五色除外）');

// ✓ 心情五色必须与指定取值逐档一致，且不与点睛的朱色混同
{
  let toneBad = 0;
  for (const k of Object.keys(MOOD_TONES)) {
    const v = tokenOf(k);
    if (!v || v.toLowerCase() !== MOOD_TONES[k]) {
      bad('心情色 --' + k + ' 应为 ' + MOOD_TONES[k] + '，实际 ' + v);
      toneBad++;
    }
  }
  // 统计页与样式表必须是同一套颜色：stats.js 直接向 CSS 变量取色（TONE_FALLBACK 为兜底）
  const fallback = (src['js/stats.js'].match(/const TONE_FALLBACK = \[([^\]]+)\]/) || [])[1] || '';
  const listed = fallback.split(',').map((s) => s.trim().replace(/['"]/g, '').toLowerCase()).filter(Boolean);
  if (listed.length !== 5 || listed.join(',') !== toneValues.join(',')) {
    bad('stats.js 的 TONE_FALLBACK 与 --tone-1..5 不一致：' + listed.join(','));
    toneBad++;
  }
  if (!/cssVar\(/.test(src['js/stats.js']) || !/--tone-1/.test(src['js/stats.js'])) {
    bad('stats.js 没有从 CSS 变量取心情色，深色模式下图表会串色');
    toneBad++;
  }
  if ((tokenOf('vermilion') || '').toLowerCase() === MOOD_TONES['tone-5']) {
    bad('心情最开心一档不应等于点睛的朱色');
    toneBad++;
  }
  if (!toneBad) ok('心情五色与指定值一致，样式表与统计页同源');
}

// ✗ 纯黑与冷灰
for (const hex of ['#000000', '#000', '#1E1E1E', '#1e1e1e', '#2C2C2C', '#2c2c2c']) {
  if (all.includes(hex)) bad('出现禁止的纯黑/冷灰：' + hex);
}
if (!/#(000000|000|1e1e1e|2c2c2c)\b/i.test(all)) ok('无纯黑与冷灰');

// ✗ 圆角过大（50% 用于圆形墨点，是正圆而非圆角卡片，允许）
//   本版方向：圆角 ≤ 8px —— 有边界但仍是纸张，不做圆润的 App 卡片
const radiusRe = /border-radius:\s*([0-9.]+)(px|em|%)/g;
const bigRadius = [];
while ((m = radiusRe.exec(all))) {
  const v = parseFloat(m[1]);
  if (m[2] === 'px' && v > 8) bigRadius.push(m[0]);
  if (m[2] === '%' && v < 50) bigRadius.push(m[0]);
}
if (bigRadius.length) bad('圆角超过 8px：' + bigRadius.join(', '));
else ok('圆角均 ≤ 8px（50% 仅用于圆形墨点）');

// ✗ 投影：允许，但只能来自 --shadow-2 / --shadow-3 两个令牌。
//   内描边（inset）与聚焦环（0 0 0 Npx）属于边界而非层次，单独放行。
const shadowHits = (all.match(/box-shadow:\s*[^;]+/g) || [])
  .filter((s) => !/box-shadow:\s*none/i.test(s))
  .filter((s) => !/box-shadow:\s*var\(--shadow-[23]\)/i.test(s) && !/--shadow-[23]:/.test(s))
  .filter((s) => !/inset\s/.test(s) && !/box-shadow:\s*(none,\s*)?0 0 0 /.test(s));
if (shadowHits.length) bad('出现令牌之外的投影：' + shadowHits.join(' | '));
else ok('投影只来自 --shadow-2/3（内描边与聚焦环除外）');

// ✓ 主按钮必须有可辨识的填充（本版方向：主操作要看得见）
if (/\.primary-btn\s*\{[^}]*background:\s*var\(--vermilion-fill\)/.test(src['styles/base.css'])) {
  ok('主按钮为朱色填充');
} else bad('主按钮缺少朱色填充');

// ✗ emoji 与填充式图标库
//   ← → ‹ › 属于排版用箭头字符（非 emoji、非图标库），允许
const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{25A0}-\u{25FF}\u{2715}\u{2716}\u{2B00}-\u{2BFF}]/gu;
const emojis = Array.from(new Set((all.match(emojiRe) || [])));
if (emojis.length) bad('出现 emoji 或符号图标：' + emojis.join(' '));
else ok('无 emoji 与填充式图标（箭头为排版字符）');

// ✗ 未定义的 CSS 变量（会静默解析失败导致颜色错乱）
{
  const css = src['styles/base.css'];
  const defined = new Set(Array.from(css.matchAll(/--([a-z0-9-]+):/g)).map((x) => x[1]));
  const undef = new Map();
  for (const f of Object.keys(src)) {
    for (const mm of src[f].matchAll(/var\(--([a-z0-9-]+)/g)) {
      if (!defined.has(mm[1])) undef.set(mm[1], f);
    }
  }
  if (undef.size) bad('引用了未定义的 CSS 变量：' +
    Array.from(undef.entries()).map(([k, f]) => '--' + k + '(' + f + ')').join(', '));
  else ok('所有 CSS 变量均已定义');
}

// ✗ 环形图 / 饼图 / 柱状图 / 网格线
if (/moodPieChart|moodBarChart/.test(src['js/stats.js'])) bad('统计页仍存在环形图或柱状图函数');
if (/<rect/.test(src['js/stats.js'])) bad('统计页仍绘制矩形（柱状图痕迹）');
else ok('统计页无环形图/饼图/柱状图');

// ✓ 日历格：要有面上有分隔线，整月才分得清行与列
const cellMatch = src['styles/views.css'].match(/\n\.cell\s*\{([^}]*)\}/);
const cellBlock = cellMatch ? cellMatch[1] : '';
const cellBg = (/background:\s*([^;]+);/.exec(cellBlock) || [])[1] || '';
const cellBorder = /border-right:\s*([^;]+);/.exec(cellBlock);
if (!cellBlock) bad('未找到 .cell 规则');
else if (!cellBg || /none|transparent/.test(cellBg)) bad('日历格缺少分隔面（背景色）');
else if (!cellBorder) bad('日历格缺少分隔线');
else ok('日历格有分隔面与分隔线');
// 整月容器本身也要有边界
if (!/\.cal-grid\s*\{[^}]*border:\s*1px solid var\(--line\)/.test(src['styles/views.css'])) {
  bad('整月容器 .cal-grid 缺少边界');
} else ok('整月容器有边界');

// ✓ 列表条目是卡片：背景与描边同时出现，才能把一篇日记圈住
const cardMatch = src['styles/views.css'].match(/\n\.entry-card\s*\{([^}]*)\}/);
if (cardMatch) {
  const b = cardMatch[1];
  const bg = (/background:\s*([^;]+);/.exec(b) || [])[1] || '';
  const bd = (/border:\s*([^;]+);/.exec(b) || [])[1] || '';
  if (bg && !/none/.test(bg) && bd && !/none/.test(bd)) ok('列表条目为有边界的卡片');
  else bad('列表条目缺少边界，散落成一片');
}

// ✓ 日历上的心情圆点要够大（一眼能认出颜色）
{
  const dot = (src['styles/views.css'].match(/\n\.cell \.dot\s*\{([^}]*)\}/) || [])[1] || '';
  const size = parseFloat((/width:\s*([0-9.]+)px/.exec(dot) || [])[1] || '0');
  if (size < 9) bad('日历心情圆点应 ≥ 9px，实际 ' + size + 'px');
  else ok('日历心情圆点 ' + size + 'px');
}

// ✓ 可读性下限：字号与行距
{
  const fsBody = tokenOf('fs-body');
  const lhBody = tokenOf('lh-body');
  const fsSmall = tokenOf('fs-small');
  if (!fsBody || parseFloat(fsBody) < 17) bad('正文 --fs-body 应 ≥ 17px，实际 ' + fsBody);
  else ok('正文字号 ' + fsBody);
  if (!lhBody || parseFloat(lhBody) < 1.7) bad('正文行距 --lh-body 应 ≥ 1.7，实际 ' + lhBody);
  else ok('正文行距 ' + lhBody);
  if (fsSmall && parseFloat(fsSmall) < 13) bad('辅助文字 --fs-small 应 ≥ 13px，实际 ' + fsSmall);
  const fsLabel = tokenOf('fs-label');
  if (!fsLabel || parseFloat(fsLabel) < 13) bad('次级标签 --fs-label 应 ≥ 13px，实际 ' + fsLabel);
  else ok('次级标签字号 ' + fsLabel);
}
// 正文不得使用最淡的两档墨色（灰色小字是主要的阅读障碍）
{
  const css = src['styles/base.css'];
  const bodyRule = (css.match(/\nbody\s*\{([^}]*)\}/) || [])[1] || '';
  if (/--ink-(200|300)/.test(bodyRule)) bad('正文使用了过淡的墨色');
  else ok('正文使用近墨色而非灰');
}

// ✓ 任何有意义的文字都不允许用最淡的两档墨色；只有禁用态与占位符可以用 --ink-300
{
  const offenders = [];
  for (const f of ['styles/base.css', 'styles/views.css']) {
    const css = src[f];
    const re = /color:\s*var\(--ink-300\)/g;
    let mm;
    while ((mm = re.exec(css))) {
      // 回溯到最近的 { 与其前的 } ，取出选择器
      const open = css.lastIndexOf('{', mm.index);
      const close = css.lastIndexOf('}', open);
      const sel = css.slice(close + 1, open).trim().replace(/\s+/g, ' ');
      if (/:disabled|:placeholder|::placeholder|disabled/.test(sel)) continue;
      offenders.push(sel + ' → ink-300');
    }
  }
  // 占位符写在 ::placeholder 规则里，单独放行
  const ph = /(input|textarea)::placeholder[^{]*\{[^}]*ink-300/;
  const filtered = offenders.filter((o) => !/placeholder/.test(o) || !ph.test(src['styles/base.css']));
  if (filtered.length) bad('有意义的文字用了过淡的墨色：' + filtered.join('; '));
  else ok('淡墨只用于禁用态与占位符');
}

// ---------------------------------------------------------------------------
// 设计令牌
// ---------------------------------------------------------------------------
const token = tokenOf;
const expect = {
  paper: '#f5f2ea', surface: '#fffdf8', 'surface-soft': '#f0ece2',
  'ink-900': '#1b1a18', 'ink-700': '#33302b', 'ink-600': '#4a4741',
  'ink-400': '#6f6a62', 'ink-300': '#96908a',
  line: '#e2dcd0', 'line-strong': '#d3ccbd', hairline: '#ece7dc',
  vermilion: '#9c3d2e', moss: '#55684f'
};
for (const k of Object.keys(expect)) {
  const v = token(k);
  if (!v || v.toLowerCase() !== expect[k]) bad('令牌 --' + k + ' 应为 ' + expect[k] + '，实际 ' + v);
}
if (!issues.length) ok('色彩与边界令牌与规范一致');

// 边界令牌必须成体系：面 + 主边界 + 同级分隔
if (!token('line') || !token('line-strong') || !token('hairline')) bad('边界令牌不成体系（缺 line / line-strong / hairline）');
else ok('边界分三级：line / line-strong / hairline');

// 间距
if (token('gap-page') !== '40px') bad('页面边距应为 40px，实际 ' + token('gap-page'));
if (token('gap-section') !== '56px') bad('模块间距应为 56px，实际 ' + token('gap-section'));
if (token('gap-item') !== '12px') bad('组内间距应为 12px，实际 ' + token('gap-item'));

// 动效
if (!/--dur:\s*420ms/.test(src['styles/base.css'])) bad('界面动效应为 420ms');
if (!/--dur-fast:\s*160ms/.test(src['styles/base.css'])) bad('微动效应为 160ms');
if (!/cubic-bezier\(0\.165,\s*0\.84,\s*0\.44,\s*1\)/.test(src['styles/base.css'])) bad('缓动应为 ease-out-quart');

// 主题：浅色「宣纸」+ 深色「墨夜」两套，且必须成对覆盖
{
  const css = src['styles/base.css'];
  const darkBlock = (css.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
  const lightKeys = Array.from(css.slice(0, css.indexOf('[data-theme="dark"]'))
    .matchAll(/--([a-z0-9-]+):/g)).map((x) => x[1]);
  const darkKeys = Array.from(darkBlock.matchAll(/--([a-z0-9-]+):/g)).map((x) => x[1]);

  if (!darkBlock) bad('缺少深色主题令牌块 :root[data-theme="dark"]');
  else {
    // 深色必须覆盖所有「随主题变化」的颜色类令牌
    //   例外：心情 3/4/5（苔绿/暖黄/橘）在夜里本来就够亮，保持一致反而更省心
    const KEEP_SAME_TONES = ['tone-3', 'tone-4', 'tone-5'];
    const mustOverride = lightKeys.filter((k) => /^(paper|surface|ink-|line|hairline|vermilion|moss|ring-ink|scrim|tone-|shadow-)/.test(k))
      .filter((k) => KEEP_SAME_TONES.indexOf(k) < 0);
    const missing = mustOverride.filter((k) => darkKeys.indexOf(k) < 0);
    const redundant = KEEP_SAME_TONES.filter((k) => darkKeys.indexOf(k) >= 0);
    if (missing.length) bad('深色主题缺少令牌：' + missing.map((k) => '--' + k).join(', '));
    else if (redundant.length) bad('这几档心情色本就通用，不必在深色里重复：' + redundant.join(', '));
    else ok('深浅两套令牌成对（' + darkKeys.length + ' 个覆盖）');

    // 深色下心情最深两档必须提亮，否则落在夜色里看不见
    const lum = (hex) => {
      const h = hex.replace('#', '');
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(parseInt(h.slice(0, 2), 16)) + 0.7152 * f(parseInt(h.slice(2, 4), 16)) +
        0.0722 * f(parseInt(h.slice(4, 6), 16));
    };
    const darkOf = (k) => (new RegExp('--' + k + ':\\s*([^;]+);').exec(darkBlock) || [])[1];
    const paperDark = darkOf('paper');
    if (!paperDark) bad('深色主题缺少 --paper');
    else {
      const bg = lum(paperDark.trim()) + 0.05;
      ['tone-1', 'tone-2'].forEach((k) => {
        const v = darkOf(k);
        if (!v) return;
        const ratio = (lum(v.trim()) + 0.05) / bg;
        if (ratio < 1.8) bad('深色下 --' + k + ' 与背景对比不足：' + ratio.toFixed(2) + '（应 ≥ 1.8）');
      });
      // 朱砂在深色下也必须够亮才能当文字用
      const verm = darkOf('vermilion');
      if (verm) {
        const ratio = (lum(verm.trim()) + 0.05) / bg;
        if (ratio < 4.5) bad('深色下 --vermilion 作为文字对比不足：' + ratio.toFixed(2) + '（应 ≥ 4.5）');
        else ok('深色朱砂对比 ' + ratio.toFixed(2) + '，可作文字');
      }
    }
  }
  // 主题必须由 js/theme.js 统一管理，且要有落盘（localStorage）
  if (!/CittaTheme/.test(src['js/theme.js'] || '')) bad('缺少主题模块 js/theme.js');
  else if (!/localStorage/.test(src['js/theme.js'])) bad('主题偏好没有持久化');
  else ok('主题由 theme.js 管理并持久化');
  if (!/js\/theme\.js/.test(src['index.html'])) bad('index.html 未在首帧前引入 theme.js');
}

// ---------------------------------------------------------------------------
console.log('=== 视觉规范审计 ===\n');
if (issues.length) {
  console.log('不合规 ' + issues.length + ' 处：');
  issues.forEach((i) => console.log('  ✗ ' + i));
} else {
  console.log('  全部合规');
}
console.log('');
console.log('检查通过项：');
notes.forEach((n) => console.log('  ✓ ' + n));
console.log('');
console.log('审计结果：' + (issues.length ? ' FAIL' : ' PASS'));
process.exit(issues.length ? 1 : 0);
