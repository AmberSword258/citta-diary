/**
 * Markdown 渲染器测试（纯 Node，直接加载渲染器脚本）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'lib', 'markdown.js'), 'utf8');
const sandbox = { window: {} };
const MD = new Function('window', src + '\nreturn window.CittaMarkdown;')(sandbox.window);

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

// ---------------------------------------------------------------------------
// 标题
// ---------------------------------------------------------------------------
check('标题：行首 # 生成 h1', () => {
  const html = MD.render('# 标题');
  assert.ok(/<h1>标题<\/h1>/.test(html), '实际：' + html);
});

check('标题：## / ### 分别生成 h2 / h3', () => {
  assert.ok(/<h2>二<\/h2>/.test(MD.render('## 二')), '## 失败');
  assert.ok(/<h3>三<\/h3>/.test(MD.render('### 三')), '### 失败');
});

check('标题：带前导空格也能生效（缩进后输入标题）', () => {
  const html = MD.render('  # 缩进的标题');
  assert.ok(/<h1>缩进的标题<\/h1>/.test(html), '实际：' + html);
});

check('标题：全角空格后也能生效', () => {
  const html = MD.render('　# 全角缩进标题');
  assert.ok(/<h1>全角缩进标题<\/h1>/.test(html), '实际：' + html);
});

check('标题：标题不会与上一段合并', () => {
  const html = MD.render('正文一段\n# 标题\n正文二段');
  assert.ok(/<h1>标题<\/h1>/.test(html), '标题未独立成块：' + html);
  assert.ok(/<p>正文一段<\/p>/.test(html), '第一段不正确：' + html);
});

check('标题：四级以上按三级处理', () => {
  const html = MD.render('#### 四级');
  assert.ok(/<h3>四级<\/h3>/.test(html), '实际：' + html);
});

// ---------------------------------------------------------------------------
// 段落与缩进
// ---------------------------------------------------------------------------
check('段落：空行分隔的两段各自成为 p', () => {
  const html = MD.render('第一段\n\n第二段');
  const n = (html.match(/<p>/g) || []).length;
  assert.strictEqual(n, 2, '段落数应为 2，实际 ' + n + '：' + html);
});

check('段落：段内单个换行转为 br', () => {
  const html = MD.render('一行\n二行');
  assert.ok(/<br>/.test(html), '实际：' + html);
});

check('缩进：前导半角空格被保留为不换行空格', () => {
  const html = MD.render('　　这是全角空格开头的段落');
  assert.ok(/^\s*<p>(&nbsp;)+这是/.test(html), '前导全角空格未保留：' + html);
});

check('缩进：前导半角空格同样保留', () => {
  const html = MD.render('  这是半角空格开头的段落');
  assert.ok(/^\s*<p>(&nbsp;)+这是/.test(html), '前导半角空格未保留：' + html);
});

check('缩进：转义后注入的是实体而非可折叠空格', () => {
  const html = MD.render('　正文');
  assert.ok(html.indexOf('\u3000') === -1, '仍存在会被 HTML 折叠的全角空格');
});

check('缩进：不应误伤行内文本中的空格', () => {
  const html = MD.render('前 中 后');
  assert.ok(/<p>前 中 后<\/p>/.test(html), '行内空格被改写：' + html);
});

// ---------------------------------------------------------------------------
// 其它语法
// ---------------------------------------------------------------------------
check('列表：无序与有序', () => {
  const ul = MD.render('- 甲\n- 乙');
  assert.ok(/<ul>[\s\S]*<li>甲<\/li>[\s\S]*<li>乙<\/li>[\s\S]*<\/ul>/.test(ul), '实际：' + ul);
  const ol = MD.render('1. 一\n2. 二');
  assert.ok(/<ol>[\s\S]*<li>一<\/li>[\s\S]*<\/ol>/.test(ol), '实际：' + ol);
});

check('列表：缩进的列表项仍被识别为列表', () => {
  const html = MD.render('  - 甲\n  - 乙');
  assert.ok(/<ul>/.test(html), '实际：' + html);
});

check('引用与分割线', () => {
  assert.ok(/<blockquote>/.test(MD.render('> 引用')), '引用失败');
  assert.ok(/<hr>/.test(MD.render('---')), '分割线失败');
});

check('强调与代码', () => {
  assert.ok(/<strong>粗<\/strong>/.test(MD.render('**粗**')), '加粗失败');
  assert.ok(/<em>斜<\/em>/.test(MD.render('*斜*')), '斜体失败');
  assert.ok(/<code>x<\/code>/.test(MD.render('`x`')), '行内代码失败');
  assert.ok(/<pre><code>/.test(MD.render('```\ncode\n```')), '代码块失败');
});

check('链接与安全过滤', () => {
  const a = MD.render('[站点](https://example.com)');
  assert.ok(/<a href="https:\/\/example\.com"/.test(a), '链接失败：' + a);
  const bad = MD.render('[x](javascript:alert(1))');
  assert.ok(bad.indexOf('href') === -1, '危险协议未被过滤：' + bad);
});

check('转义：HTML 注入被转义', () => {
  const html = MD.render('<script>alert(1)</script>');
  assert.ok(html.indexOf('<script>') === -1, '脚本标签未被转义：' + html);
});

check('代码块内的缩进不被改写', () => {
  const html = MD.render('```\n  两空格缩进代码\n```');
  assert.ok(html.indexOf('&nbsp;') === -1, '代码块内被注入实体：' + html);
});

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
module.exports = { results };
if (require.main === module) {
  let failed = 0;
  for (const r of results) {
    if (r.ok) console.log('  ✓ ' + r.name);
    else { failed++; console.log('  ✗ ' + r.name + '\n      ' + r.err); }
  }
  console.log('\nMarkdown 渲染测试：' + (results.length - failed) + '/' + results.length + ' 通过');
  process.exit(failed ? 1 : 0);
}
