/**
 * 观心 Citta —— 端到端自测
 *
 * 用真实的 Electron 实例驱动界面，验证关键流程：
 *   首次设置密码 → 写入日记（心情/天气/大事/标签）→ 自动保存 → 列表与搜索
 *   → 统计 → 锁定 → 错误密码 → 用密保问题重置密码 → 解锁 → 数据仍在
 *   → 备份导出/导入 → 删除
 *
 * 运行：node_modules\electron\dist\electron.exe tests\e2e.js
 */
'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 使用独立的 userData，避免污染真实数据
const tempDir = path.join(os.tmpdir(), 'citta-e2e-' + Date.now());
app.setPath('userData', tempDir);

const MAIN = path.join(__dirname, '..', 'src', 'main', 'main.js');
require(MAIN);

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok ? '' : '  → ' + detail));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** 在渲染进程中求值（可传参数，函数可为 async） */
async function evaluate(win, fn, ...args) {
  return win.webContents.executeJavaScript(
    'new Promise(function (resolve, reject) { try { Promise.resolve((' + fn.toString() + ').apply(null, ' +
    JSON.stringify(args) + ')).then(resolve, reject); } catch (e) { reject(e); } })', true);
}

/** 等待条件成立 */
async function waitFor(win, fn, timeout) {
  const deadline = Date.now() + (timeout || 8000);
  while (Date.now() < deadline) {
    const v = await evaluate(win, fn);
    if (v) return v;
    await sleep(150);
  }
  return null;
}

async function run() {
  const { BrowserWindow } = require('electron');
  let win = null;
  for (let i = 0; i < 40 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0] || null;
    if (!win) await sleep(150);
  }
  if (!win) { record('创建窗口', false, '未找到窗口'); return finish(); }

  // 收集渲染进程错误
  const consoleErrors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) consoleErrors.push(message);
  });

  await new Promise((r) => {
    if (!win.webContents.isLoading()) return r();
    win.webContents.once('did-finish-load', r);
  });
  await sleep(600);
  record('应用启动', true);

  // ---- 1. 首次设置密码 ----
  const hasSetupForm = await waitFor(win, () => !!document.querySelector('#setup-pw1'));
  record('首次启动显示密码设置', !!hasSetupForm, '未出现设置表单');
  if (!hasSetupForm) return finish();

  await evaluate(win, () => {
    document.querySelector('#setup-pw1').value = 'citta-test-1234';
    document.querySelector('#setup-pw2').value = 'citta-test-1234';
    const ans = document.querySelectorAll('.lock-form input[type="text"]');
    // 三个密保答案输入框
    const ansInputs = Array.from(document.querySelectorAll('.q-item input[type="text"]')).filter(
      (i) => i.placeholder === '答案'
    );
    ansInputs[0].value = '答案一';
    ansInputs[1].value = '答案二';
    ansInputs[2].value = '答案三';
    void ans;
    document.querySelector('.lock-form .primary-btn').click();
  });

  const inApp = await waitFor(win, () => !document.querySelector('#shell').classList.contains('hidden'), 12000);
  record('设置密码后进入主界面', !!inApp, '未能进入主界面');
  if (!inApp) return finish();

  // ---- 2. 日历渲染 ----
  const cellCount = await waitFor(win, () => document.querySelectorAll('.cell').length, 8000);
  record('日历格子渲染', cellCount >= 28, '格子数=' + cellCount);

  const hasLunar = await evaluate(win, () => {
    const c = document.querySelector('.cell .d-lunar');
    return c ? c.textContent.trim() : '';
  });
  record('日历显示农历/节气/节日', !!hasLunar, '农历文本为空');

  // ---- 2b. 年月选择器（点标题 → 月 → 年 → 跳转） ----
  const topbarLabels = await evaluate(win, () => ({
    search: document.querySelector('#btn-search').textContent.trim(),
    settings: document.querySelector('#btn-settings').textContent.trim(),
    all: Array.from(document.querySelectorAll('.topbar-right button')).map((b) => b.textContent.trim()),
    navToday: Array.from(document.querySelectorAll('.cal-nav button')).map((b) => b.textContent.trim())
  }));
  record('顶栏只留「搜索 / 设置」，今天移到日历头部',
    topbarLabels.all.join('/') === '搜索/设置' && topbarLabels.navToday.indexOf('今天') >= 0,
    '顶栏=' + topbarLabels.all.join('/') + ' 日历头=' + topbarLabels.navToday.join('/'));

  const beforePick = await evaluate(win, () => {
    const t = document.querySelector('.cal-title-btn .ct-main').textContent.trim();
    return t;
  });
  await evaluate(win, () => document.querySelector('.cal-title-btn').click());
  await waitFor(win, () => !!document.querySelector('.picker'));
  const pickerMonthMode = await evaluate(win, () => {
    const cells = Array.from(document.querySelectorAll('.picker-grid .picker-cell'));
    return {
      exists: !!document.querySelector('.picker'),
      count: cells.length,
      texts: cells.map((c) => c.textContent.trim()).slice(0, 3),
      onCount: document.querySelectorAll('.picker-cell.on').length
    };
  });
  record('点标题展开年月选择器（12 个月）',
    pickerMonthMode.exists && pickerMonthMode.count === 12 && pickerMonthMode.onCount === 1,
    JSON.stringify(pickerMonthMode));

  // 切到「年」视图
  await evaluate(win, () => document.querySelector('.picker-title').click());
  const pickerYearMode = await evaluate(win, () => {
    const cells = Array.from(document.querySelectorAll('.picker-grid .picker-cell'));
    return {
      label: document.querySelector('.picker-title').textContent.trim(),
      count: cells.length,
      years: cells.map((c) => c.textContent.trim())
    };
  });
  record('年视图给出 12 个年份',
    pickerYearMode.count === 12 && /^\d{4} – \d{4}$/.test(pickerYearMode.label),
    JSON.stringify(pickerYearMode));

  // 选一个明显不同的年份（往前 6 年）再选 3 月
  const targetYear = String(Number(beforePick.slice(0, 4)) - 6);
  const pickedYearOk = await evaluate(win, (y) => {
    const cell = Array.from(document.querySelectorAll('.picker-grid .picker-cell'))
      .find((c) => c.textContent.trim() === y);
    if (!cell) return false;
    cell.click();
    return true;
  }, targetYear);
  record('选年回到月视图', pickedYearOk &&
    await evaluate(win, () => document.querySelectorAll('.picker-grid .picker-cell').length === 12), '未找到目标年份');

  await evaluate(win, () => {
    const cell = Array.from(document.querySelectorAll('.picker-grid .picker-cell'))
      .find((c) => c.textContent.trim() === '3 月');
    cell.click();
  });
  await sleep(900);
  const afterPick = await evaluate(win, () => ({
    title: document.querySelector('.cal-title-btn .ct-main').textContent.trim(),
    pickerGone: !document.querySelector('.picker'),
    cells: document.querySelectorAll('.cell').length
  }));
  record('选择年月后跳转到该月并收起选择器',
    afterPick.title === targetYear + ' 年 3 月' && afterPick.pickerGone && afterPick.cells >= 28,
    JSON.stringify(afterPick));

  // 回到今天，后续用例从当前月开始（「今天」按钮在日历头部，顶栏已不再重复放一个）
  await evaluate(win, () => {
    const btn = Array.from(document.querySelectorAll('.cal-nav button'))
      .find((b) => b.textContent.trim() === '今天');
    if (btn) btn.click();
  });
  await sleep(900);
  record('「今天」按钮回到当前月',
    (await evaluate(win, () => document.querySelector('.cal-title-btn .ct-main').textContent.trim())) === beforePick,
    '未回到当前月');

  // Esc 也能收起选择器
  await evaluate(win, () => document.querySelector('.cal-title-btn').click());
  await waitFor(win, () => !!document.querySelector('.picker'));
  await evaluate(win, () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await sleep(400);
  record('Esc 收起年月选择器', await evaluate(win, () => !document.querySelector('.picker')), '选择器仍在');

  // ---- 3. 写入日记 ----
  const todayDate = await evaluate(win, () => document.querySelector('#view-calendar .cell.today')
    ? document.querySelector('#view-calendar .cell.today').querySelector('.d-num').textContent : '');

  await evaluate(win, () => {
    const cell = document.querySelector('#view-calendar .cell.today');
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await waitFor(win, () => !document.querySelector('#editor').classList.contains('hidden'));
  record('打开编辑器', await evaluate(win, () => !document.querySelector('#editor').classList.contains('hidden')), '编辑器未打开');

  // 编辑界面缩进：预览逐段首行缩进；编辑区默认**不显示**缩进，以保证光标准确
  //   （镜像层虽能显示缩进，但会让行末光标比可见文字左偏一个缩进量）
  const indent = await evaluate(win, () => {
    const px = (v) => Math.round(parseFloat(v) || 0);
    CittaEditor.setIndent('first', 2, true);
    CittaEditor.setMirrorIndent(false, true);   // 默认状态
    const ta = document.querySelector('#ed-content');
    const mirror = document.querySelector('#ed-mirror');
    const cs = getComputedStyle(ta);
    // 缩进量以字号为准：2em = 2 × font-size（字号可能随设计调整）
    const expectIndent = px(cs.fontSize) * 2;

    ta.value = '第一段。\n\n第二段。\n\n第三段。\n\n# 标题';
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    const box = document.querySelector('#ed-preview');
    const ps = Array.from(box.querySelectorAll('p'));
    const h1 = box.querySelector('h1');

    // 光标与可见文字的对齐：按等宽推算文字末尾位置，与镜像层实际末尾比较
    const cv = document.createElement('canvas').getContext('2d');
    cv.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    const charW = cv.measureText('一二三四五六七八九十').width / 10;
    const textEndX = cs.paddingLeft ? px(cs.paddingLeft) + 3 * charW : -1;

    let mirrorEndX = null;
    const d0 = mirror.children[0];
    if (d0 && d0.firstChild) {
      const rg = document.createRange();
      rg.setStart(d0.firstChild, 3);
      rg.setEnd(d0.firstChild, 3);
      mirrorEndX = px(rg.getBoundingClientRect().left - mirror.getBoundingClientRect().left);
    }

    return {
      模式: CittaEditor.getIndent().mode,
      镜像开启: CittaEditor.getMirrorIndent(),
      body镜像类: document.body.classList.contains('mirror-on'),
      期望缩进: expectIndent,
      文本域文字末尾x: textEndX,
      镜像文字末尾x: mirrorEndX,
      偏移: mirrorEndX === null ? 0 : mirrorEndX - textEndX,
      预览段落数: ps.length,
      预览各段缩进: ps.map((p) => px(getComputedStyle(p).textIndent)),
      标题缩进: h1 ? px(getComputedStyle(h1).textIndent) : -1
    };
  });
  record('编辑界面缩进：预览逐段缩进，编辑区默认不显示缩进以保证光标准确',
    indent.模式 === 'first' && indent.镜像开启 === false && indent.body镜像类 === false &&
    indent.偏移 === 0 && indent.期望缩进 > 0 &&
    indent.预览段落数 === 3 &&
    indent.预览各段缩进.length === 3 &&
    indent.预览各段缩进.every((r) => r === indent.期望缩进) &&
    indent.标题缩进 === 0,
    JSON.stringify(indent));

  // 镜像层是可选功能：开启后能显示缩进，但确实会带来一个缩进量的偏移（故默认关闭）
  const mirrorOpt = await evaluate(win, async () => {
    const px = (v) => Math.round(parseFloat(v) || 0);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const ta = document.querySelector('#ed-content');
    const mirror = document.querySelector('#ed-mirror');
    ta.value = '第一段。\n\n第二段。\n\n第三段。';
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    const cs = getComputedStyle(ta);
    const cv = document.createElement('canvas').getContext('2d');
    cv.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    const charW = cv.measureText('一二三四五六七八九十').width / 10;

    CittaEditor.setMirrorIndent(true, true);
    await wait(120);
    const lines = Array.from(mirror.children).map((d) => px(getComputedStyle(d).textIndent));
    const d0 = mirror.children[0];
    const rg = document.createRange();
    rg.setStart(d0.firstChild, 3);
    rg.setEnd(d0.firstChild, 3);
    const offset = px(rg.getBoundingClientRect().left - mirror.getBoundingClientRect().left) -
      (px(cs.paddingLeft) + 3 * charW);
    const on = {
      镜像各行缩进: lines,
      偏移: offset,
      期望偏移: px(cs.fontSize) * 2,
      body镜像类: document.body.classList.contains('mirror-on')
    };

    CittaEditor.setMirrorIndent(false, true);
    await wait(120);
    const off = { 开启: CittaEditor.getMirrorIndent(), body镜像类: document.body.classList.contains('mirror-on') };
    return { on: on, off: off };
  });
  record('编辑区缩进显示为可选功能（开启有偏移、关闭无偏移）',
    mirrorOpt.on.镜像各行缩进.join(',') ===
      [mirrorOpt.on.期望偏移, 0, mirrorOpt.on.期望偏移, 0, mirrorOpt.on.期望偏移].join(',') &&
    mirrorOpt.on.偏移 > 20 && mirrorOpt.on.body镜像类 === true &&
    mirrorOpt.off.开启 === false && mirrorOpt.off.body镜像类 === false,
    JSON.stringify(mirrorOpt));

  // 镜像层关闭时两层必须严格对齐（宽度/内边距/溢出一致），避免任何错位
  const layerAlign = await evaluate(win, () => {
    const ta = document.querySelector('#ed-content');
    const mirror = document.querySelector('#ed-mirror');
    const cs = getComputedStyle(ta);
    const ms = getComputedStyle(mirror);

    ta.value = '一二三四五六七八九十'.repeat(3) + '甲乙丙丁戊己庚辛壬癸';
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    return {
      clientWidth: [ta.clientWidth, mirror.clientWidth],
      clientHeight: [ta.clientHeight, mirror.clientHeight],
      padding: [cs.paddingTop + '/' + cs.paddingRight + '/' + cs.paddingBottom + '/' + cs.paddingLeft,
        ms.paddingTop + '/' + ms.paddingRight + '/' + ms.paddingBottom + '/' + ms.paddingLeft],
      overflow: [cs.overflowX + '/' + cs.overflowY, ms.overflowX + '/' + ms.overflowY],
      border: [cs.borderWidth, ms.borderWidth],
      boxSizing: [cs.boxSizing, ms.boxSizing],
      文本域内容区左边界: Math.round(ta.getBoundingClientRect().left + parseFloat(cs.paddingLeft)),
      镜像左边界: Math.round(mirror.getBoundingClientRect().left + parseFloat(ms.paddingLeft))
    };
  });
  const eq = (pair) => pair[0] === pair[1];
  record('编辑区两层几何一致（宽度/内边距/溢出/盒模型）',
    eq(layerAlign.clientWidth) && eq(layerAlign.clientHeight) &&
    eq(layerAlign.padding) && eq(layerAlign.overflow) && eq(layerAlign.border) &&
    eq(layerAlign.boxSizing) &&
    layerAlign.文本域内容区左边界 === layerAlign.镜像左边界,
    JSON.stringify(layerAlign));

  // 缩进方式与宽度：通过**真实点击按钮**验证，并逐段检查预览（防止只有第一段生效）
  const indentCtl = await evaluate(win, async () => {
    const px = (v) => Math.round(parseFloat(v) || 0);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const ta = document.querySelector('#ed-content');
    const box = document.querySelector('#ed-preview');
    ta.value = '第一段。\n\n第二段。\n\n第三段。\n\n第四段。';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(80);

    const snap = () => {
      const ps = Array.from(box.querySelectorAll('p'));
      const cs = getComputedStyle(ta);
      const active = Array.from(document.querySelectorAll('#ed-indent .chip.on')).map((c) => c.textContent);
      return {
        段数: ps.length,
        // 每段各自的计算缩进（逐段读取，任何一段漏掉都会被检出）
        每段缩进: ps.map((p) => px(getComputedStyle(p).textIndent)),
        镜像开启: document.body.classList.contains('mirror-on'),
        选中: active
      };
    };

    const out = {
      按钮: Array.from(document.querySelectorAll('#ed-indent .chip')).map((c) => c.textContent),
      每字: px(getComputedStyle(ta).fontSize)     // 1 字的缩进量
    };
    // 先测宽度（此时宽度按钮可见），最后再测「关闭」（选关闭后宽度按钮会隐藏）
    for (const label of ['首行缩进', '1 字', '2 字', '4 字', '关闭']) {
      const chip = Array.from(document.querySelectorAll('#ed-indent .chip'))
        .find((c) => c.textContent === label);
      if (!chip) { out[label] = { 缺失: true, 按钮: Array.from(document.querySelectorAll('#ed-indent .chip')).map((c) => c.textContent) }; continue; }
      chip.click();
      await wait(80);
      out[label] = snap();
    }
    // 回到默认，避免影响后续用例
    CittaEditor.setIndent('first', 2, true);
    return out;
  });

  const everyParagraph = (s, v) => s && s.段数 === 4 && s.每段缩进.length === 4 && s.每段缩进.every((x) => x === v);
  const oneChar = indentCtl.每字;
  const indentOk =
    indentCtl.按钮.indexOf('首行缩进') === 0 &&
    indentCtl.按钮.indexOf('整篇缩进') === -1 &&          // 「整篇缩进」已按要求移除
    oneChar > 0 &&
    everyParagraph(indentCtl['首行缩进'], oneChar * 2) &&
    everyParagraph(indentCtl['1 字'], oneChar) &&
    everyParagraph(indentCtl['2 字'], oneChar * 2) &&
    everyParagraph(indentCtl['4 字'], oneChar * 4) &&
    everyParagraph(indentCtl['关闭'], 0) && indentCtl['关闭'].镜像开启 === false;
  record('缩进：仅保留首行缩进/关闭 + 宽度档位，预览每段都生效',
    indentOk, JSON.stringify(indentCtl));

  // 回车 = 另起段落：按一次回车应插入空行（两个换行），从而让预览按段缩进
  const enterBehavior = await evaluate(win, async () => {
    const ta = document.querySelector('#ed-content');
    const box = document.querySelector('#ed-preview');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    const pressEnter = () => {
      const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      ta.dispatchEvent(ev);
    };

    // 场景一：正文行末按一次回车
    ta.value = '第一段';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.setSelectionRange(3, 3);
    pressEnter();
    ta.value += '第二段';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(80);
    const oneEnter = {
      原文: JSON.stringify(ta.value),
      含空行: /\n\s*\n/.test(ta.value),
      预览段落数: box.querySelectorAll('p').length,
      各段缩进: Array.from(box.querySelectorAll('p')).map((p) => getComputedStyle(p).textIndent)
    };

    // 场景二：在空行上再按回车，只加一个换行（不叠加空行）
    ta.value = '甲';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.setSelectionRange(1, 1);
    pressEnter();          // 变成 "甲\n\n"
    pressEnter();          // 空行上再按 → 只加一个 \n
    ta.value += '乙';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(80);
    const twice = { 原文: JSON.stringify(ta.value) };

    return { oneEnter: oneEnter, twice: twice };
  });
  record('回车自动分段：按一次回车即插入段落空行',
    enterBehavior.oneEnter.含空行 &&
    enterBehavior.oneEnter.原文 === '"第一段\\n\\n第二段"' &&
    enterBehavior.oneEnter.预览段落数 === 2 &&
    // 缩进值随字号变化，这里只要求两段一致且非零
    enterBehavior.oneEnter.各段缩进.length === 2 &&
    enterBehavior.oneEnter.各段缩进.every((x) => parseFloat(x) > 0) &&
    enterBehavior.oneEnter.各段缩进[0] === enterBehavior.oneEnter.各段缩进[1] &&
    enterBehavior.twice.原文 === '"甲\\n\\n\\n乙"',
    JSON.stringify(enterBehavior));

  // 用户真实场景：多段落 + 缩进过的标题 + 手打空格缩进的段落，
  // 并且必须保证渲染不卡死（此前的实现会在这种输入上死循环）
  const realEdit = await evaluate(win, () => {
    // 本用例聚焦「排版与不卡死」，明确设定为默认首行缩进
    CittaEditor.setIndent('first', 2, true);
    const ta = document.querySelector('#ed-content');
    ta.value = [
      '　　# 缩进后的标题',
      '',
      '　　第一段手打全角空格缩进。',
      '',
      '第二段没有手打空格，靠 CSS 首行缩进。',
      '',
      '  第三段用半角空格缩进。',
      '',
      '- 列表一',
      '- 列表二'
    ].join('\n');
    const t0 = performance.now();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const ms = performance.now() - t0;

    const box = document.querySelector('#ed-preview');
    const ps = Array.from(box.querySelectorAll('p'));
    const h1 = box.querySelector('h1');
    return {
      ms: Math.round(ms),
      标题正确: !!h1 && h1.textContent === '缩进后的标题',
      有无井号残留: box.textContent.indexOf('#') >= 0,
      段落数: ps.length,
      段一有缩进实体: ps[0] ? /^(\u00a0|&nbsp;)/.test(ps[0].textContent) : false,
      段二CSS缩进: ps[1] ? Math.round((parseFloat(getComputedStyle(ps[1]).textIndent) || 0) /
        (parseFloat(getComputedStyle(ps[1]).fontSize) || 1) * 100) / 100 : -1,
      段三有缩进实体: ps[2] ? /^(\u00a0|&nbsp;)/.test(ps[2].textContent) : false,
      列表项: box.querySelectorAll('li').length    };
  });
  record('真实排版：缩进标题+多段缩进正常且不卡死',
    realEdit.ms < 500 && realEdit.标题正确 && !realEdit.有无井号残留 &&
    realEdit.段落数 === 3 && realEdit.段一有缩进实体 && realEdit.段二CSS缩进 === 2 &&
    realEdit.段三有缩进实体 && realEdit.列表项 === 2,
    JSON.stringify(realEdit));

  await evaluate(win, () => {
    const ta = document.querySelector('#ed-content');
    ta.value = '# 测试标题\n\n今天**心情不错**，写了点东西。\n\n- 列表一\n- 列表二\n\n> 引用一句\n\n---\n\n结束。';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.mood-btn[data-mood="4"]').click();
    document.querySelector('#ed-weather .chip').click();
    document.querySelector('#ed-event').value = '端到端测试';
    document.querySelector('#ed-event').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#ed-tags').value = '测试 随笔';
    document.querySelector('#ed-tags').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);

  // 心情选择器：点第 4 个 → 1/2/3/4 全亮，第 4 个是「当前值」
  const moodScale = await evaluate(win, () => {
    const btns = Array.from(document.querySelectorAll('#ed-mood .mood-btn'));
    const on = () => btns.filter((b) => b.classList.contains('on')).map((b) => b.dataset.mood);
    const current = () => {
      const c = btns.find((b) => b.classList.contains('current'));
      return c ? c.dataset.mood : null;
    };
    const after4 = { on: on(), current: current(), value: document.querySelector('#ed-mood').dataset.value };
    btns[4].click();                     // 改选 5
    const after5 = { on: on(), current: current(), value: document.querySelector('#ed-mood').dataset.value };
    btns[4].click();                     // 再点一次取消
    const afterCancel = { on: on(), current: current(), value: document.querySelector('#ed-mood').dataset.value };
    btns[3].click();                     // 回到 4，供后面的用例使用
    const back4 = { on: on(), current: current(), value: document.querySelector('#ed-mood').dataset.value };
    return { after4, after5, afterCancel, back4 };
  });
  record('选 4 分时 1–4 个圆点全部点亮',
    moodScale.after4.on.join(',') === '1,2,3,4' && moodScale.after4.current === '4',
    JSON.stringify(moodScale.after4));
  record('选 5 分时五个圆点全部点亮',
    moodScale.after5.on.join(',') === '1,2,3,4,5' && moodScale.after5.current === '5',
    JSON.stringify(moodScale.after5));
  record('再点一次可取消（圆点全部熄灭）',
    moodScale.afterCancel.on.length === 0 && moodScale.afterCancel.current === null &&
    moodScale.afterCancel.value === '', JSON.stringify(moodScale.afterCancel));

  // 描边颜色要等过渡结束再量（border-color 有 160ms 过渡，测中途会读到插值）
  await evaluate(win, () => { document.querySelector('#ed-mood .mood-btn.current').click(); });
  await sleep(500);
  const moodColors = await evaluate(win, () => {
    // 期望值直接取当前主题的 --tone-1..5，深浅色都能对得上
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const tones = [1, 2, 3, 4, 5].map((i) => {
      probe.style.color = '';
      probe.style.color = root.getPropertyValue('--tone-' + i).trim();
      return getComputedStyle(probe).color;
    });
    probe.remove();
    const dots = Array.from(document.querySelectorAll('#ed-mood .mood-btn'))
      .map((b) => getComputedStyle(b).borderTopColor);
    return { tones, dots, theme: document.documentElement.getAttribute('data-theme') };
  });
  await evaluate(win, () => { document.querySelector('.mood-btn[data-mood="4"]').click(); });
  await sleep(300);
  record('五个圆点各自的描边就是它那一档的颜色',
    moodColors.dots.join(' ') === moodColors.tones.join(' ') &&
    new Set(moodColors.tones).size === 5,
    moodColors.theme + ' 期望 ' + moodColors.tones.join(' ') + ' 实际 ' + moodColors.dots.join(' '));

  const previewHasH1 = await evaluate(win, () => !!document.querySelector('#ed-preview h1'));
  const previewHasList = await evaluate(win, () => !!document.querySelector('#ed-preview ul li'));
  const previewHasQuote = await evaluate(win, () => !!document.querySelector('#ed-preview blockquote'));
  const previewHasHr = await evaluate(win, () => !!document.querySelector('#ed-preview hr'));
  const previewHasStrong = await evaluate(win, () => !!document.querySelector('#ed-preview strong'));
  record('Markdown 预览：标题/列表/引用/分割线/加粗',
    previewHasH1 && previewHasList && previewHasQuote && previewHasHr && previewHasStrong,
    JSON.stringify({ previewHasH1, previewHasList, previewHasQuote, previewHasHr, previewHasStrong }));

  await evaluate(win, () => document.querySelector('#ed-save').click());
  await sleep(900);
  const savedStatus = await evaluate(win, () => document.querySelector('#ed-status').textContent);
  record('保存日记', /已保存|已是最新/.test(savedStatus), '状态=' + savedStatus);

  await evaluate(win, () => document.querySelector('#ed-back').click());
  await waitFor(win, () => document.querySelector('#editor').classList.contains('hidden'), 8000);
  record('关闭编辑器返回', await evaluate(win, () => document.querySelector('#editor').classList.contains('hidden')), '仍处于编辑状态');

  // ---- 4. 日历上的心情轮廓 ----
  const moodAttr = await evaluate(win, () => {
    const c = document.querySelector('#view-calendar .cell.today');
    return c ? c.getAttribute('data-mood') : null;
  });
  record('日历显示心情轮廓', moodAttr === '4', 'data-mood=' + moodAttr);

  // ---- 5. 列表与搜索 ----
  await evaluate(win, () => { CittaApp.switchView('list'); });
  await sleep(600);
  const cardCount = await evaluate(win, () => document.querySelectorAll('.entry-card').length);
  record('列表显示日记', cardCount >= 1, '卡片数=' + cardCount);

  await evaluate(win, () => {
    const input = document.querySelector('#search-input');
    CittaApp.openSearch();
    input.value = '测试标题';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(700);
  const hitCount = await evaluate(win, () => document.querySelectorAll('.entry-card').length);
  const hasHighlight = await evaluate(win, () => !!document.querySelector('.entry-card mark'));
  record('全文搜索命中并高亮', hitCount >= 1 && hasHighlight, '结果=' + hitCount + ' 高亮=' + hasHighlight);

  await evaluate(win, () => {
    const input = document.querySelector('#search-input');
    input.value = '不存在的关键词xyz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(600);
  const emptyCount = await evaluate(win, () => document.querySelectorAll('.entry-card').length);
  record('搜索无结果时显示空态', emptyCount === 0, '仍有 ' + emptyCount + ' 条');

  await evaluate(win, () => CittaApp.closeSearch());
  await sleep(400);

  // ---- 6. 统计 ----
  await evaluate(win, () => CittaApp.switchView('stats'));
  await sleep(800);
  // 新的视觉：没有 KPI 卡、没有环形图/柱状图，只有一维时间轴与墨点
  const statUi = await evaluate(win, () => {
    const view = document.querySelector('#view-stats');
    return {
      关键数字项: view.querySelectorAll('.stat-row .stat').length,
      svg数: view.querySelectorAll('svg').length,
      // 禁止项：KPI 卡、环形图/饼图、带网格线的柱状图
      旧KPI卡: view.querySelectorAll('.stat-card').length,
      饼图: view.querySelectorAll('path[fill][d*="A"]').length,
      柱子: view.querySelectorAll('rect').length,
      网格线: view.querySelectorAll('svg line[stroke]').length
    };
  });
  record('统计页改用一维时间轴与墨点（无 KPI 卡 / 环图 / 柱状图 / 网格线）',
    statUi.关键数字项 === 4 && statUi.svg数 >= 2 &&
    statUi.旧KPI卡 === 0 && statUi.柱子 === 0 &&
    // 只允许那条 1px 基线（每个图表一条），不应出现成排网格线
    statUi.网格线 <= statUi.svg数,
    JSON.stringify(statUi));

  // 已按需求删去「写作量」与「写作习惯」两块统计
  const removedPanels = await evaluate(win, () => {
    const t = document.querySelector('#view-stats').textContent;
    return {
      写作量: t.indexOf('写作量') >= 0,
      写作习惯: t.indexOf('写作习惯') >= 0,
      最常动笔: t.indexOf('最常动笔') >= 0,
      写得最多: t.indexOf('写得最多') >= 0
    };
  });
  record('已移除写作量与写作习惯统计',
    !removedPanels.写作量 && !removedPanels.写作习惯 && !removedPanels.最常动笔 && !removedPanels.写得最多,
    JSON.stringify(removedPanels));

  // 保留的统计项应仍在
  const keptPanels = await evaluate(win, () => {
    const t = document.querySelector('#view-stats').textContent;
    return {
      概览: t.indexOf('写作概览') >= 0,
      心情分布: t.indexOf('心情分布') >= 0,
      心情走向: t.indexOf('心情走向') >= 0,
      年度小结: t.indexOf('年度小结') >= 0
    };
  });
  record('保留写作概览/心情分布/心情走向/年度小结',
    keptPanels.概览 && keptPanels.心情分布 && keptPanels.心情走向 && keptPanels.年度小结,
    JSON.stringify(keptPanels));

  // ---- 6b. 深色模式：设置里能切、切了生效、刷新后还记得 ----
  {
    const before = await evaluate(win, () => ({
      theme: document.documentElement.getAttribute('data-theme'),
      pref: CittaTheme.get()
    }));
    record('默认主题跟随系统', before.pref === 'system' && /^(light|dark)$/.test(before.theme),
      JSON.stringify(before));

    // 打开设置 → 点「深色」
    await evaluate(win, () => document.querySelector('#btn-settings').click());
    await waitFor(win, () => document.querySelector('.modal-card'));
    const switched = await evaluate(win, () => {
      const chips = Array.from(document.querySelectorAll('.modal-card .chip'));
      const dark = chips.find((c) => c.textContent.trim() === '深色');
      const labels = chips.map((c) => c.textContent.trim());
      if (dark) dark.click();
      return {
        labels: labels,
        active: Array.from(document.querySelectorAll('.modal-card .chip.on')).map((c) => c.textContent.trim()),
        theme: document.documentElement.getAttribute('data-theme')
      };
    });
    record('设置里能切到深色', switched.theme === 'dark' && switched.active.indexOf('深色') >= 0,
      JSON.stringify(switched));
    record('外观提供三种选择',
      switched.labels.filter((l) => ['跟随系统', '浅色', '深色'].indexOf(l) >= 0).join('/') === '跟随系统/浅色/深色',
      switched.labels.join('/'));

    // 深色下界面真的变了：底色变暗、正文转亮
    const darkStyle = await evaluate(win, () => ({
      body: getComputedStyle(document.body).backgroundColor,
      text: getComputedStyle(document.body).color,
      today: (() => {
        const t = document.querySelector('.cell.today .d-num');
        return t ? getComputedStyle(t).color : '';
      })()
    }));
    const darkOk = /rgb\(2[0-9], /.test(darkStyle.body) && darkStyle.today !== 'rgb(156, 61, 46)';
    record('深色模式真的变暗（含朱色调整）', darkOk, JSON.stringify(darkStyle));

    // 关掉设置面板，刷新页面：偏好应当还在
    await evaluate(win, () => { const m = document.querySelector('.modal'); if (m) m.remove(); });
    win.webContents.reload();
    const backAfterReload = await waitFor(win, () => {
      const shell = document.querySelector('#shell');
      return shell && !shell.classList.contains('hidden') && document.querySelectorAll('.cell').length >= 28;
    }, 15000);
    const afterReload = await evaluate(win, () => ({
      theme: document.documentElement.getAttribute('data-theme'),
      pref: CittaTheme.get(),
      stored: window.localStorage.getItem('citta.theme')
    }));
    record('深色偏好在刷新后仍然生效', !!backAfterReload && afterReload.theme === 'dark' &&
      afterReload.pref === 'dark' && afterReload.stored === 'dark', JSON.stringify(afterReload));

    // 主进程要知道偏好（窗口标题栏/滚动条跟着变），且落盘的是「偏好」而不是解析结果
    const { nativeTheme } = require('electron');
    const prefsFile = path.join(tempDir, 'prefs.json');
    const prefsNow = (() => {
      try { return JSON.parse(fs.readFileSync(prefsFile, 'utf8')); } catch (e) { return null; }
    })();
    record('主进程同步主题（标题栏跟随）',
      nativeTheme.themeSource === 'dark' && prefsNow && prefsNow.theme === 'dark',
      'themeSource=' + nativeTheme.themeSource + ' prefs=' + JSON.stringify(prefsNow));

    // 切回「跟随系统」：存的应是 system（否则会把应用钉死在某一档）
    await evaluate(win, () => { CittaTheme.set('system'); });
    await sleep(700);
    const backToSystem = await evaluate(win, () => ({
      pref: CittaTheme.get(),
      theme: document.documentElement.getAttribute('data-theme'),
      stored: window.localStorage.getItem('citta.theme')
    }));
    const prefsSystem = (() => {
      try { return JSON.parse(fs.readFileSync(prefsFile, 'utf8')); } catch (e) { return null; }
    })();
    record('切回跟随系统后存的是 system（不被钉死）',
      backToSystem.pref === 'system' && nativeTheme.themeSource === 'system' &&
      prefsSystem && prefsSystem.theme === 'system' && /^(light|dark)$/.test(backToSystem.theme),
      JSON.stringify(backToSystem) + ' themeSource=' + nativeTheme.themeSource + ' prefs=' + JSON.stringify(prefsSystem));
  }

  // ---- 6c. 界面语言：可切英文，界面全部翻译，用户内容不动 ----
  {
    const before = await evaluate(win, () => ({ lang: CittaI18n.get(), zh: document.querySelector('.tab').textContent.trim() }));
    record('默认界面语言为中文', before.lang === 'zh' && before.zh === '日历', JSON.stringify(before));

    await evaluate(win, () => document.querySelector('#btn-settings').click());
    await waitFor(win, () => document.querySelector('.modal-card'));
    await evaluate(win, () => {
      const chip = Array.from(document.querySelectorAll('.modal-card .chip[data-lang]'))
        .find((c) => c.getAttribute('data-lang') === 'en');
      if (chip) chip.click();
    });
    // 切换语言会重载界面
    const backEn = await waitFor(win, () => {
      const shell = document.querySelector('#shell');
      return shell && !shell.classList.contains('hidden') &&
        document.documentElement.getAttribute('lang') === 'en';
    }, 15000);
    const en = await evaluate(win, () => ({
      lang: CittaI18n.get(),
      tabs: Array.from(document.querySelectorAll('.tab')).map((t) => t.textContent.trim()),
      topbar: Array.from(document.querySelectorAll('.topbar-right button')).map((b) => b.textContent.trim()),
      placeholder: document.querySelector('#search-input').placeholder,
      untranslated: CittaI18n.untranslated()
    }));
    record('切到英文后界面变成英文', !!backEn && en.lang === 'en' &&
      en.tabs.join('/') === 'Calendar/Journal/Stats' && en.topbar.join('/') === 'Search/Settings',
      JSON.stringify({ lang: en.lang, tabs: en.tabs, topbar: en.topbar }));
    record('英文界面没有漏译（农历等历法文本除外）',
      en.untranslated.length === 0, en.untranslated.slice(0, 14).join(' | '));

    // 用户内容不能被翻译
    await evaluate(win, () => document.querySelector('.tab[data-view="list"]').click());
    await sleep(1000);
    const bodyText = await evaluate(win, () => {
      const card = document.querySelector('.entry-card .ec-body');
      return card ? card.textContent.trim() : '';
    });
    record('用户写的日记正文不会被翻译',
      bodyText.length > 0 && !/entry|Journal|entries ·/.test(bodyText), bodyText.slice(0, 40));

    await evaluate(win, () => CittaI18n.set('zh'));
    const backZh = await waitFor(win, () => {
      const shell = document.querySelector('#shell');
      return shell && !shell.classList.contains('hidden') &&
        document.documentElement.getAttribute('lang') === 'zh-CN';
    }, 15000);
    record('可以切回中文', !!backZh, '未切回中文');
  }

  // ---- 7. 锁定与错误密码 ----
  await evaluate(win, () => { CittaApp.lock(); });
  await waitFor(win, () => !document.querySelector('#lock').classList.contains('hidden'), 8000);
  record('锁定回到锁屏', await evaluate(win, () => !document.querySelector('#lock').classList.contains('hidden')), '未回到锁屏');

  await evaluate(win, () => {
    document.querySelector('#unlock-pw').value = '错误密码';
    document.querySelector('.lock-form .primary-btn').click();
  });
  await sleep(900);
  const wrongMsg = await evaluate(win, () => document.querySelector('#lock-msg').textContent);
  record('错误密码被拒绝', /不正确/.test(wrongMsg), '提示=' + wrongMsg);

  // ---- 8. 密保找回 ----
  await evaluate(win, () => {
    const btns = document.querySelectorAll('.lock-links button');
    btns[0].click();
  });
  await sleep(500);
  const hasRecover = await evaluate(win, () => document.querySelectorAll('.q-item').length);
  record('显示密保找回界面', hasRecover === 3, '问题数=' + hasRecover);

  await evaluate(win, () => {
    const ans = document.querySelectorAll('.q-item input[type="text"]');
    ans[1].value = '答案二';
    const pws = document.querySelectorAll('.lock-form input[type="password"]');
    pws[0].value = 'new-pass-5678';
    pws[1].value = 'new-pass-5678';
    document.querySelector('.lock-form .primary-btn').click();
  });
  const backIn = await waitFor(win, () => !document.querySelector('#shell').classList.contains('hidden'), 12000);
  record('密保答案重置密码并进入', !!backIn, '未能进入主界面');

  // ---- 9. 数据仍在 ----
  const entryStillThere = await evaluate(win, () => {
    const all = CittaStore.all();
    return { n: all.length, mood: all[0] ? all[0].mood : 0, event: all[0] ? all[0].event : '', tags: all[0] ? (all[0].tags || []).length : 0 };
  });
  record('重置密码后数据完好', entryStillThere.n >= 1 && entryStillThere.mood === 4 && entryStillThere.event === '端到端测试',
    JSON.stringify(entryStillThere));

  // ---- 10. 密保答案错误的处理 ----
  await evaluate(win, () => { CittaApp.lock(); });
  await waitFor(win, () => !document.querySelector('#lock').classList.contains('hidden'), 8000);
  await evaluate(win, () => {
    document.querySelectorAll('.lock-links button')[0].click();
  });
  await sleep(400);
  await evaluate(win, () => {
    const ans = document.querySelectorAll('.q-item input[type="text"]');
    ans[0].value = '完全错误的答案';
    const pws = document.querySelectorAll('.lock-form input[type="password"]');
    pws[0].value = 'whatever-1234';
    pws[1].value = 'whatever-1234';
    document.querySelector('.lock-form .primary-btn').click();
  });
  await sleep(1000);
  const badAnswerMsg = await evaluate(win, () => document.querySelector('#lock-msg').textContent);
  record('错误的密保答案被拒绝', /不正确/.test(badAnswerMsg), '提示=' + badAnswerMsg);

  // 用正确密码解锁回来，继续后续测试
  await evaluate(win, () => {
    document.querySelectorAll('.lock-links button')[0].click();
  });
  await sleep(300);
  await evaluate(win, () => {
    // 此时已是 unlock 界面
    const pw = document.querySelector('#unlock-pw');
    pw.value = 'new-pass-5678';
    document.querySelector('.lock-form .primary-btn').click();
  });
  const reIn = await waitFor(win, () => !document.querySelector('#shell').classList.contains('hidden'), 12000);
  record('新密码可解锁', !!reIn, '未能解锁');

  // ---- 11. 图片插入与预览 ----
  const imageOk = await evaluate(win, async () => {
    // 1x1 PNG 的 dataURL
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const info = await window.citta.saveImage(png);
    const back = await window.citta.readImage(info.id);
    return { id: info.id, okBack: back === png, mime: info.mime };
  });
  record('图片加密保存与读取', imageOk.okBack && imageOk.mime === 'image/png', JSON.stringify(imageOk));

  const imgInEntry = await evaluate(win, async () => {
    // 在页面内自行生成一张图片，避免跨进程传参
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const info = await window.citta.saveImage(png);
    const today = await window.citta.calendarToday();
    await CittaStore.save(today.date, {
      content: '看图：\n\n![图片](citta-img://' + info.id + ')\n',
      mood: 3, weather: '', event: '', tags: [], images: [info.id]
    });
    const md = '![图片](citta-img://' + info.id + ')';
    const html = CittaMarkdown.render(md, (s) => s);
    return {
      idLen: String(info.id).length,
      hasImg: /<img /.test(html),
      src: (/src="([^"]+)"/.exec(html) || [])[1] || '',
      savedOk: !!CittaStore.get(today.date)
    };
  });
  record('日记中渲染图片',
    imgInEntry.hasImg && imgInEntry.src.indexOf('citta-img://') === 0 && imgInEntry.idLen === 32 && imgInEntry.savedOk,
    JSON.stringify(imgInEntry));
  // ---- 12. 备份导出/导入（走存储层，避免系统对话框）----
  const backupRoundTrip = await evaluate(win, async () => {
    const payload = await window.citta.testExport();
    const before = CittaStore.count();
    for (const e of CittaStore.all().slice()) await CittaStore.remove(e.date);
    const afterClear = CittaStore.count();
    const res = await window.citta.testImport(payload, false);
    await CittaStore.load();
    return { before: before, afterClear: afterClear, restored: CittaStore.count(), images: res.images };
  });
  record('备份导出后可完整恢复',
    backupRoundTrip.before >= 1 && backupRoundTrip.afterClear === 0 && backupRoundTrip.restored === backupRoundTrip.before,
    JSON.stringify(backupRoundTrip));

  // ---- 13. 性能：1000 篇日记的列表与搜索 ----
  const perf = await evaluate(win, async () => {
    const N = 1000;
    const base = Math.round(Date.UTC(2020, 0, 1) / 86400000);
    const t0 = performance.now();
    await window.citta.testBulk(N, base);
    const tWrite = performance.now() - t0;

    const t1 = performance.now();
    await CittaStore.load();
    const tLoad = performance.now() - t1;

    await CittaApp.switchView('list');
    const t2 = performance.now();
    CittaList.render();
    const tList = performance.now() - t2;

    const t3 = performance.now();
    const hits = CittaStore.search('测试内容');
    const tSearch = performance.now() - t3;
    return { count: CittaStore.count(), tWrite: Math.round(tWrite), tLoad: Math.round(tLoad), tList: Math.round(tList), tSearch: Math.round(tSearch), hits: hits.length };
  });
  record('1000 篇：写入+载入+列表+搜索无明显卡顿',
    perf.count >= 1000 && perf.tLoad < 2500 && perf.tList < 1500 && perf.tSearch < 200,
    JSON.stringify(perf));
  console.log('      性能数据：' + JSON.stringify(perf));

  // ---- 13b. 自动草稿与关闭时保存 ----
  const draftOk = await evaluate(win, async () => {
    const today = await window.citta.calendarToday();
    await CittaEditor.open(today.date);
    const ta = document.querySelector('#ed-content');

    // 第一次保存
    ta.value = '自动保存验证 A';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await CittaEditor.saveNow(true);
    const firstOk = (() => {
      const e = CittaStore.get(today.date);
      return !!e && /自动保存验证 A/.test(e.content);
    })();

    // 内容变更后再次保存，应覆盖更新
    ta.value = '自动保存验证 B';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await CittaEditor.saveNow(true);
    const secondOk = (() => {
      const e = CittaStore.get(today.date);
      return !!e && /自动保存验证 B/.test(e.content);
    })();

    // 关闭编辑器时自动保存正式内容
    ta.value = '关闭时自动保存 C';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await CittaEditor.close();
    const thirdOk = (() => {
      const e = CittaStore.get(today.date);
      return !!e && /关闭时自动保存 C/.test(e.content);
    })();

    return { firstOk: firstOk, secondOk: secondOk, thirdOk: thirdOk };
  });
  record('保存草稿与关闭时自动保存', draftOk.firstOk && draftOk.secondOk && draftOk.thirdOk, JSON.stringify(draftOk));

  // ---- 14. 删除 ----
  const deleted = await evaluate(win, async () => {
    const all = CittaStore.all();
    if (!all.length) return false;
    await CittaStore.remove(all[0].date);
    return CittaStore.count() === all.length - 1;
  });
  record('删除日记', deleted === true, '删除失败');

  // ---- 15. 无渲染错误 ----
  const realErrors = consoleErrors.filter((m) => !/DevTools|Autofill|Electron Security/i.test(m));
  record('无渲染进程报错', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log('\n端到端测试：' + (results.length - failed.length) + '/' + results.length + ' 通过');
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (e) { /* 忽略 */ }
  app.exit(failed.length ? 1 : 0);
}

app.whenReady().then(() => {
  // 等主进程创建窗口后再执行
  setTimeout(() => {
    run().catch((e) => {
      record('测试执行', false, e && e.stack ? e.stack : String(e));
      finish();
    });
  }, 400);
});
