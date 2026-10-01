/**
 * 观心 Citta —— README 截图生成器
 *
 * 用真实的 Electron 实例跑起来，种入一批演示日记，然后逐页截图，
 * 输出到 docs/screenshots/（文件名与 README「界面预览」表格一致）。
 *
 * 运行：
 *   tools\make-screenshots.cmd
 *
 * 或手动（注意必须清掉 ELECTRON_RUN_AS_NODE，否则 Electron 会退化成纯 Node）：
 *   set CITTA_TEST=1
 *   set ELECTRON_RUN_AS_NODE=
 *   node_modules\electron\dist\electron.exe tools\make-screenshots.js
 *
 * 可重复运行：脚本使用固定的临时 userData 目录，
 * 首次运行会建库，之后运行自动用同一个演示密码解锁。
 *
 * 安全说明：
 *   - 全程只在临时目录里操作，不读写你的真实日记
 *   - 演示内容全部虚构，与任何真实个人数据无关
 *   - 加 --reset 参数可清掉演示数据重新来
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 固定的临时目录：可重复运行，且绝不碰真实数据
const tempDir = path.join(os.tmpdir(), 'citta-screenshots');
if (process.argv.includes('--reset') && fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
fs.mkdirSync(tempDir, { recursive: true });
app.setPath('userData', tempDir);

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'screenshots');
require(path.join(ROOT, 'src', 'main', 'main.js'));

const PASSWORD = 'citta-demo-2026';
const WIN_W = 1440;
const WIN_H = 900;
const TEST_MODE = process.env.CITTA_TEST === '1';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function evaluate(win, fn, ...args) {
  return win.webContents.executeJavaScript(
    'new Promise(function (resolve, reject) { try { Promise.resolve((' + fn.toString() + ').apply(null, ' +
    JSON.stringify(args) + ')).then(resolve, reject); } catch (e) { reject(e); } })', true);
}

async function waitFor(win, fn, timeout) {
  const deadline = Date.now() + (timeout || 10000);
  while (Date.now() < deadline) {
    try { const v = await evaluate(win, fn); if (v) return v; } catch (e) { /* 继续等 */ }
    await sleep(150);
  }
  return null;
}

async function shot(win, name, label) {
  await sleep(800);
  const image = await win.webContents.capturePage();
  const file = path.join(OUT_DIR, name + '.png');
  fs.writeFileSync(file, image.toPNG());
  console.log('  [OK] ' + (name + '.png').padEnd(16) +
    String(Math.round(fs.statSync(file).size / 1024)).padStart(5) + ' KB   ' + label);
}

/** 让渲染进程重新载入并等待完成 */
async function reload(win) {
  win.webContents.reload();
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await sleep(1400);
}

// ---------------------------------------------------------------------------
// 演示内容（全部虚构）
// ---------------------------------------------------------------------------

const DOC_RAIN = [
  '# 雨天的书店',
  '',
  '下午的雨来得突然，躲在书店屋檐下等了二十分钟。',
  '',
  '顺手翻完了一本讲植物的小册子，才知道**银杏是唯一存活下来的银杏纲植物**，',
  '活了上亿年，比很多山脉都老。',
  '',
  '## 记下几句',
  '',
  '- 买了本《杂草记》',
  '- 给窗台那盆薄荷换了土',
  '- 雨停的时候天边开了一道缝，光斜着照进来',
  '',
  '> 慢一点没关系，别停就好。',
  '',
  '1. 明天早点起',
  '2. 把那篇拖了两周的稿子改完',
  '',
  '`Ctrl + S` 随时保存，这个习惯总算养成了。'
].join('\n');

const DOC_MORNING = [
  '# 清晨',
  '',
  '五点半被鸟叫醒，索性起来煮了壶茶。窗外那棵银杏开始泛黄，',
  '风一过，叶子打着旋儿落下来，像谁在慢慢地翻书。',
  '',
  '## 今天想做的事',
  '',
  '1. 把稿子改完',
  '2. 傍晚去河边走走',
  '3. 早点睡',
  '',
  '安静地坐了半小时，什么也没想。'
].join('\n');

const DOC_FOCUS = [
  '## 关于专注这件事',
  '',
  '试了三天「一次只做一件事」，比想象中难，但确实有用。',
  '以前总觉得同时推进几件事才算高效，其实只是把注意力切碎了。',
  '',
  '```',
  '注意力是有限的，别把它当成免费的。',
  '```',
  '',
  '今天只写了八百字，但是踏实。'
].join('\n');

const TITLES = ['清晨', '雨天的书店', '关于专注', '平常的一天', '有点累',
  '小确幸', '整理房间', '老友来访', '河边散步', '读完一本书'];
const TAGS = ['读书', '散步', '写作', '咖啡', '雨天', '思考', '家人', '运动', '做饭', '早睡'];
const WEATHERS = ['晴', '多云', '阴', '小雨', '大雨', '雷雨', '雪', '雾', '风'];
const MOODS = [5, 4, 3, 2, 1];
const DOCS = [DOC_RAIN, DOC_MORNING, DOC_FOCUS];

/** 本地时间的 YYYY-MM-DD（不能用 toISOString，那是 UTC，会导致差一天） */
function localYmd(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

/** 生成长度适中的演示日记
 *  范围：上上个月 1 号 → 下个月月底。
 *  这样当前月、上个月、下个月翻页都有内容，日历与统计都不会显得空。
 *  今天之后的日期写的是「预告」，正好展示每天都能写这一点。
 */
function demoEntries() {
  const list = [];
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  const start = new Date(y, m - 2, 1);
  const end = new Date(y, m + 2, 0);           // 下个月最后一天
  const total = Math.round((end - start) / 86400000) + 1;
  const todayIndex = Math.round((new Date(y, m, d) - start) / 86400000);

  for (let i = 0; i < total; i++) {
    // 每隔几天留一次空白，看起来更像真人写的
    if (i % 4 === 3) continue;

    const day = new Date(y, m - 2, 1 + i);
    const iso = localYmd(day);
    const seed = i * 7919;

    const title = TITLES[seed % TITLES.length];
    const tag1 = TAGS[seed % TAGS.length];
    const tag2 = TAGS[(seed + 3) % TAGS.length];
    const body = DOCS[i % DOCS.length];
    const head = i % 2 === 0 ? ('# ' + title + '\n\n') : '';
    const stamp = day.toISOString();
    const hasEvent = i % 9 === 0 && i <= todayIndex;

    list.push({
      date: iso,
      content: head + body,
      mood: MOODS[seed % MOODS.length],
      weather: WEATHERS[seed % WEATHERS.length],
      tags: tag1 === tag2 ? [tag1] : [tag1, tag2],
      event: hasEvent ? '记得给妈妈打电话' : '',
      important: hasEvent ? '记得给妈妈打电话' : '',
      pinned: i === todayIndex || i === todayIndex - 3,
      images: [],
      createdAt: stamp,
      updatedAt: stamp
    });
  }
  return list;
}

// ---------------------------------------------------------------------------

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let win = null;
  for (let i = 0; i < 60 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0] || null;
    if (!win) await sleep(150);
  }
  if (!win) { console.error('未找到窗口'); app.exit(1); return; }
  win.setContentSize(WIN_W, WIN_H);

  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });
  await new Promise((r) => {
    if (!win.webContents.isLoading()) return r();
    win.webContents.once('did-finish-load', r);
  });
  await sleep(900);

  console.log('生成 README 截图...');
  console.log('  测试接口可用: ' + TEST_MODE + '   临时数据目录: ' + tempDir);

  // ---------- 1. 建库或解锁 ----------
  const needSetup = await waitFor(win, () => !!document.querySelector('#setup-pw1'), 4000);
  if (needSetup) {
    console.log('  首次运行：设置演示密码');
    await evaluate(win, (pw) => {
      document.querySelector('#setup-pw1').value = pw;
      document.querySelector('#setup-pw2').value = pw;
      const ans = Array.from(document.querySelectorAll('.q-item input[type="text"]'))
        .filter((i) => i.placeholder === '答案');
      if (ans[0]) ans[0].value = '答案一';
      if (ans[1]) ans[1].value = '答案二';
      if (ans[2]) ans[2].value = '答案三';
      document.querySelector('.lock-form .primary-btn').click();
    }, PASSWORD);
  } else {
    console.log('  已有演示库：用演示密码解锁');
    await evaluate(win, (pw) => {
      const input = document.querySelector('#lock-pw') ||
        document.querySelector('.lock-form input[type="password"]');
      if (input) input.value = pw;
      const btn = document.querySelector('.lock-form .primary-btn');
      if (btn) btn.click();
    }, PASSWORD);
  }

  const inApp = await waitFor(win, () => !document.querySelector('#shell').classList.contains('hidden'), 15000);
  if (!inApp) { console.log('  未能进入主界面'); app.exit(1); return; }
  await sleep(500);

  // ---------- 2. 种入演示数据 ----------
  const entries = demoEntries();
  let saved = 0;

  if (TEST_MODE) {
    const payload = {
      format: 'citta-backup', version: 1,
      exportedAt: new Date().toISOString(),
      count: entries.length, entries: entries, images: {}
    };
    const res = await win.webContents.executeJavaScript(
      'window.citta.testImport(' + JSON.stringify(payload) + ', false)' +
      '.then(function (r) { return { ok: true, r: JSON.stringify(r) }; })' +
      '.catch(function (e) { return { ok: false, err: String((e && e.message) || e) }; })', true);
    if (res && res.ok) {
      saved = entries.length;
      console.log('  已导入 ' + saved + ' 篇演示日记（覆盖式）');
    } else {
      console.log('  testImport 失败: ' + (res && res.err));
    }
  }
  if (saved === 0) {
    for (const e of entries) {
      const ok = await win.webContents.executeJavaScript(
        'window.citta.saveEntry(' + JSON.stringify(e.date) + ', ' +
        JSON.stringify({
          content: e.content, mood: e.mood, weather: e.weather, tags: e.tags,
          event: e.event, important: e.important, pinned: e.pinned
        }) + ').then(function () { return true; }).catch(function () { return false; })', true);
      if (ok) saved++;
    }
    console.log('  已写入 ' + saved + '/' + entries.length + ' 篇');
  }

  await reload(win);

  // 统一用浅色（宣纸）主题截图，另有一张深色
  await evaluate(win, () => { if (window.CittaTheme) window.CittaTheme.set('light'); });
  await sleep(700);
  await reload(win);

  await evaluate(win, () => {
    const t = document.querySelector('.tab[data-view="calendar"]');
    if (t) t.click();
  });
  await waitFor(win, () => document.querySelectorAll('.cell').length >= 28, 8000);
  await sleep(700);

  const probe = await evaluate(win, () => ({
    cells: document.querySelectorAll('.cell').length,
    filled: document.querySelectorAll('.cell.has-entry, .cell .mood-dot').length,
    title: (document.querySelector('.cal-title-btn .ct-main') || {}).textContent || ''
  }));
  console.log('  日历状态: ' + JSON.stringify(probe));

  // ---------- 3. 日历视图 ----------
  await shot(win, 'calendar', '日历视图：农历、节气、节日与心情圆点');

  // ---------- 4. 编辑器与实时预览 ----------
  // 直接找最近一篇有内容的日记（今天可能还没写）
  const opened = await evaluate(win, () => {
    const withEntry = Array.from(document.querySelectorAll('#view-calendar .cell'))
      .filter((c) => c.querySelector('.d-num') && c.textContent.indexOf('记得给妈妈') < 0)
      .filter((c) => c.classList.contains('has-entry') || c.classList.contains('today'));
    const cell = withEntry[withEntry.length - 1] ||
      document.querySelector('#view-calendar .cell.today');
    if (!cell) return false;
    cell.click();
    return true;
  });
  let editorOpen = opened &&
    await waitFor(win, () => !document.querySelector('#editor').classList.contains('hidden'), 6000);

  if (!editorOpen) {
    // 退路：点顶部的「继续编辑」按钮
    await evaluate(win, () => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find((b) => b.textContent.trim() === '继续编辑');
      if (btn) btn.click();
    });
    editorOpen = await waitFor(win, () => !document.querySelector('#editor').classList.contains('hidden'), 6000);
  }

  if (editorOpen) {
    await evaluate(win, (text) => {
      const ta = document.querySelector('#ed-content');
      if (!ta) return;
      ta.value = text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, DOC_RAIN);
    await sleep(1100);
    await shot(win, 'editor', 'Markdown 编辑器与实时预览');
  } else {
    console.log('  [警告] 编辑器未打开，editor.png 未生成');
  }

  // ---------- 5. 统计页 ----------
  await evaluate(win, () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await sleep(800);
  await evaluate(win, () => {
    const t = document.querySelector('.tab[data-view="stats"]');
    if (t) t.click();
  });
  await waitFor(win, () => {
    const v = document.querySelector('#view-stats');
    return v && !v.classList.contains('hidden') && v.innerHTML.trim().length > 200;
  }, 8000);
  await sleep(1100);
  await shot(win, 'stats', '统计页：写作概览、心情分布、年度时间轴');

  // ---------- 6. 深色「墨夜」主题 ----------
  await evaluate(win, () => { if (window.CittaTheme) window.CittaTheme.set('dark'); });
  await sleep(900);
  await evaluate(win, () => {
    const t = document.querySelector('.tab[data-view="calendar"]');
    if (t) t.click();
  });
  await sleep(1100);
  const themeNow = await evaluate(win, () => document.documentElement.getAttribute('data-theme'));
  await shot(win, 'dark', '深色「墨夜」主题（data-theme=' + themeNow + '）');

  // ---------- 7. 启动锁屏 ----------
  await evaluate(win, () => { if (window.CittaTheme) window.CittaTheme.set('light'); });
  await sleep(600);
  await win.webContents.executeJavaScript(
    'window.citta.lock().then(function () { return true; }).catch(function () { return false; })', true);
  // 锁定后重新载入，应用会停在锁屏
  await reload(win);
  const locked = await waitFor(win, () =>
    !!document.querySelector('#lock-pw, .lock-form input[type="password"]'), 8000);
  if (locked) {
    await shot(win, 'lock', '启动锁屏');
  } else {
    console.log('  [警告] 未进入锁屏，lock.png 未生成');
  }

  console.log('');
  if (errors.length) {
    console.log('渲染进程有 ' + errors.length + ' 条错误/警告：');
    errors.slice(0, 6).forEach((m) => console.log('  - ' + m));
  } else {
    console.log('渲染进程无错误');
  }
  console.log('输出目录：' + OUT_DIR);
  app.exit(0);
}

app.whenReady().then(() => {
  run().catch((err) => { console.error('生成失败：', err); app.exit(1); });
});
