/**
 * 观心 Citta —— 测试总入口
 *
 * 运行：node tests/run.js
 *
 * 六组测试：
 *   1) 农历/节气/节日算法（纯 Node，无需 Electron）
 *   2) Markdown 渲染器（纯 Node）
 *   3) 存储与加密层（需 Electron 主进程环境）
 *   4) 视觉规范：计算样式 + 版式几何 + WCAG 对比度（真实窗口）
 *   5) 内容保真：保存不损坏原文
 *   6) 端到端界面流程（启动真实 Electron 窗口驱动 UI）
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');

function runNode(script) {
  const res = spawnSync(process.execPath, [path.join(__dirname, script)], {
    cwd: root, stdio: 'inherit', env: Object.assign({}, process.env)
  });
  return res.status === 0;
}

function runElectron(script) {
  if (!fs.existsSync(electron)) {
    console.log('  ! 未找到 Electron 可执行文件，跳过：' + script);
    return null;
  }
  const res = spawnSync(electron, [path.join(__dirname, script)], {
    cwd: root, stdio: 'inherit',
    env: Object.assign({}, process.env, { CITTA_TEST: '1' })
  });
  return res.status === 0;
}

console.log('================ 观心 Citta 测试 ================\n');
console.log('【1/6】农历 · 节气 · 节日算法');
const a = runNode('lunar.test.js');

console.log('\n【2/6】Markdown 渲染器');
const md = runNode('markdown.test.js');

console.log('\n【3/6】存储 · 加密 · 备份');
const b = runElectron('storage.test.js');

console.log('\n【4/6】视觉规范（运行时样式）');
const vis = runElectron('visual.test.js');

console.log('\n【5/6】内容保真（保存不损坏原文）');
const fid = runElectron('fidelity.test.js');

console.log('\n【6/6】端到端界面流程');
const c = runElectron('e2e.js');

console.log('\n================ 结果 ================');
console.log('农历算法 ：' + (a ? '通过' : '失败'));
console.log('Markdown ：' + (md ? '通过' : '失败'));
console.log('存储加密 ：' + (b === null ? '跳过' : (b ? '通过' : '失败')));
console.log('视觉规范 ：' + (vis === null ? '跳过' : (vis ? '通过' : '失败')));
console.log('内容保真 ：' + (fid === null ? '跳过' : (fid ? '通过' : '失败')));
console.log('端到端   ：' + (c === null ? '跳过' : (c ? '通过' : '失败')));

const ok = a && md && b !== false && vis !== false && fid !== false && c !== false;
process.exit(ok ? 0 : 1);
