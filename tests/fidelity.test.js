/**
 * 内容保真测试：确认保存/重新载入不会损坏日记原文（含各种排版）
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tempDir = path.join(os.tmpdir(), 'citta-fidelity-' + os.homedir().length + '-' + Date.now());
app.setPath('userData', tempDir);
require(path.join(__dirname, '..', 'src', 'main', 'main.js'));

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function evalIn(win, fn, ...args) {
  return win.webContents.executeJavaScript(
    'new Promise(function (resolve, reject) { try { Promise.resolve((' + fn.toString() + ').apply(null, ' +
    JSON.stringify(args) + ')).then(resolve, reject); } catch (e) { reject(e); } })', true);
}

const NL = String.fromCharCode(10);
const FF = '\u3000';

// 一段包含各种排版的原文
const SAMPLE = [
  FF + FF + '# 缩进后的标题',
  '',
  FF + FF + '这是一段手打全角空格缩进的正文，里面有**加粗**、*斜体*和`行内代码`。',
  '',
  '这一行没有手打空格，靠自动缩进。',
  '它和上一行只隔了一个换行符。',
  '',
  '  ' + '半角空格缩进的段落。',
  '',
  '- 列表第一项',
  '- 列表第二项',
  '',
  '1. 有序第一项',
  '2. 有序第二项',
  '',
  '> 引用一句话',
  '',
  '---',
  '',
  '结尾段落，带一个[链接](https://example.com)。'
].join(NL);

async function run() {
  let win = null;
  for (let i = 0; i < 40 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0] || null;
    if (!win) await sleep(150);
  }
  for (let i = 0; i < 60 && win.webContents.isLoading(); i++) await sleep(100);
  await sleep(800);

  await evalIn(win, () => {
    document.querySelector('#setup-pw1').value = 'fid-1234';
    document.querySelector('#setup-pw2').value = 'fid-1234';
    Array.from(document.querySelectorAll('.q-item input[type="text"]'))
      .filter((i) => i.placeholder === '答案').forEach((a, i) => { a.value = 'a' + i; });
    document.querySelector('.lock-form .primary-btn').click();
  });
  await sleep(3000);

  const res = await evalIn(win, async (sample) => {
    const today = await window.citta.calendarToday();
    await CittaEditor.open(today.date);
    await new Promise((r) => setTimeout(r, 200));

    const ta = document.querySelector('#ed-content');
    ta.value = sample;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await CittaEditor.saveNow(true);

    const inMemory = CittaStore.get(today.date).content;
    // 从磁盘重新载入，模拟下次打开应用
    await CittaStore.load();
    const fromDisk = CittaStore.get(today.date).content;

    // 统计预览渲染出的块
    const box = document.querySelector('#ed-preview');
    return {
      原文长度: sample.length,
      内存一致: inMemory === sample,
      磁盘一致: fromDisk === sample,
      磁盘长度: fromDisk.length,
      首个不同位置: (() => {
        for (let i = 0; i < Math.max(fromDisk.length, sample.length); i++) {
          if (fromDisk[i] !== sample[i]) {
            return { i: i, 原: JSON.stringify(sample.slice(i, i + 12)), 存: JSON.stringify(fromDisk.slice(i, i + 12)) };
          }
        }
        return null;
      })(),
      预览块: {
        标题: box.querySelectorAll('h1,h2,h3').length,
        段落: box.querySelectorAll('p').length,
        无序列表项: box.querySelectorAll('ul li').length,
        有序列表项: box.querySelectorAll('ol li').length,
        引用: box.querySelectorAll('blockquote').length,
        分割线: box.querySelectorAll('hr').length,
        链接: box.querySelectorAll('a').length,
        加粗: box.querySelectorAll('strong').length,
        斜体: box.querySelectorAll('em').length,
        行内代码: box.querySelectorAll('code').length
      }
    };
  }, SAMPLE);

  console.log('=== 内容保真测试 ===\n');
  console.log('原文字符数: ' + res.原文长度 + '，磁盘读回: ' + res.磁盘长度);
  console.log('内存中与原文完全一致: ' + res.内存一致);
  console.log('磁盘读回与原文完全一致: ' + res.磁盘一致);
  if (res.首个不同位置) console.log('首个差异: ' + JSON.stringify(res.首个不同位置));
  console.log('\n预览渲染结果:');
  console.log('  ' + JSON.stringify(res.预览块, null, 0));

  const ok = res.内存一致 && res.磁盘一致 &&
    res.预览块.标题 === 1 && res.预览块.无序列表项 === 2 && res.预览块.有序列表项 === 2 &&
    res.预览块.引用 === 1 && res.预览块.分割线 === 1 && res.预览块.链接 === 1 &&
    res.预览块.加粗 === 1 && res.预览块.斜体 === 1 && res.预览块.行内代码 === 1;

  console.log('\n内容保真测试：' + (ok ? '通过（保存不丢字、不改变原文）' : '失败'));

  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(() => {
  setTimeout(() => {
    run().catch((e) => { console.error('测试失败:', e); app.exit(1); });
  }, 400);
});
