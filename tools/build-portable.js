/**
 * 观心 Citta —— 打包为「免安装」桌面应用（不需要 electron-builder，离线可用）
 *
 * 做法与 electron-packager 相同：
 *   1) 复制 Electron 运行时（node_modules/electron/dist）
 *   2) 把本项目的 src/ 与 package.json 放进 resources/app/
 *   3) 把 electron.exe 改名为 观心 Citta.exe
 * 产物是一个文件夹，压缩后发给别人，解压直接双击 exe 即可运行。
 *
 * 注意：**绝不打包任何日记数据**。日记存在 %APPDATA%\观心 Citta，与本目录无关；
 * 备份目录 日记数据备份_* 也不会被复制进来。
 *
 * 运行：node tools/build-portable.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const appName = pkg.productName || '观心 Citta';
const version = pkg.version || '1.0.0';
const outName = appName + '-win-x64';
const distRoot = path.join(root, 'dist');
const outDir = path.join(distRoot, outName);
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');

// 允许进包的顶层文件（白名单，避免误打包日记备份等个人数据）
const APP_FILES = ['package.json', 'README.md', 'README.en.md', 'LICENSE',
  'logo.ico', 'logo.png', 'Markdown写法演示_1900-01-01.md'];

// 体积精简：Chromium 自带 55 种语言包（约 40MB），我们只需要这两种
const KEEP_LOCALES = ['zh-CN.pak', 'en-US.pak'];
// 软件渲染兜底（SwiftShader），去掉可省 ~6MB；无显卡驱动的虚拟机里可能需要它
const DROP_SOFTWARE_RENDER = process.argv.indexOf('--keep-swiftshader') < 0;
// 打完包是否顺手压一个 7z / zip（需要 7z 命令；没有就跳过）
const PACK = process.argv.indexOf('--no-pack') < 0;

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function main() {
  if (!fs.existsSync(electronDist)) {
    console.error('找不到 Electron 运行时：' + electronDist);
    console.error('请先运行 npm install');
    process.exit(1);
  }

  console.log('清空 dist ...');
  rmrf(outDir);
  fs.mkdirSync(outDir, { recursive: true });

  console.log('复制 Electron 运行时 ...');
  copyDir(electronDist, outDir);

  // 运行时里自带的示例应用不需要
  rmrf(path.join(outDir, 'resources', 'default_app.asar'));

  const appDir = path.join(outDir, 'resources', 'app');
  fs.mkdirSync(appDir, { recursive: true });

  console.log('复制应用代码 ...');
  copyDir(path.join(root, 'src'), path.join(appDir, 'src'));
  for (const f of APP_FILES) {
    const src = path.join(root, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(appDir, f));
    else console.warn('  ! 缺少文件，已跳过：' + f);
  }
  // 运行时不依赖 node_modules（本应用零第三方依赖）

  // 改名：electron.exe → 观心 Citta.exe
  const exeFrom = path.join(outDir, 'electron.exe');
  const exeTo = path.join(outDir, appName + '.exe');
  if (fs.existsSync(exeFrom)) fs.renameSync(exeFrom, exeTo);

  // ---- 精简：只留中英语言包，去掉用不上的软件渲染兜底 ----
  const locDir = path.join(outDir, 'locales');
  let removed = 0;
  if (fs.existsSync(locDir)) {
    for (const f of fs.readdirSync(locDir)) {
      if (KEEP_LOCALES.indexOf(f) < 0) {
        removed += fs.statSync(path.join(locDir, f)).size;
        fs.unlinkSync(path.join(locDir, f));
      }
    }
  }
  if (DROP_SOFTWARE_RENDER) {
    for (const f of ['vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll']) {
      const p = path.join(outDir, f);
      if (fs.existsSync(p)) { removed += fs.statSync(p).size; fs.unlinkSync(p); }
    }
  }
  console.log('精简掉 ' + (removed / 1024 / 1024).toFixed(1) + ' MB（多余语言包' +
    (DROP_SOFTWARE_RENDER ? '与软件渲染兜底' : '') + '）');

  // 附一份说明，告诉使用者这是免安装版
  fs.writeFileSync(path.join(outDir, '如何运行.txt'),
    appName + ' ' + version + '（免安装版）\r\n\r\n' +
    '1. 双击「' + appName + '.exe」即可启动，无需安装。\r\n' +
    '2. 首次启动会让你设置一个密码，这个密码用于加密本机全部日记，忘记可用密保问题找回。\r\n' +
    '3. 日记保存在：%APPDATA%\\' + appName + '\\（不在本文件夹内），所以整个文件夹可以随意拷走或删除。\r\n' +
    '4. 换机迁移：用设置里的「导出备份」导出 JSON 文件，在新机器上用「导入恢复」导入。\r\n' +
    '5. 想卸载：直接删掉本文件夹，再到 %APPDATA%\\' + appName + '\\ 删除数据即可。\r\n' +
    '\r\n全部数据只保存在本机，应用不联网、不上传。\r\n', 'utf8');

  // 体积统计
  let bytes = 0;
  (function sizeOf(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) sizeOf(p);
      else bytes += fs.statSync(p).size;
    }
  })(outDir);

  console.log('');
  console.log('完成：' + path.relative(root, outDir));
  console.log('  可执行文件：' + appName + '.exe');
  console.log('  应用代码：resources/app/');
  console.log('  体积：' + (bytes / 1024 / 1024).toFixed(1) + ' MB');
  console.log('  不含任何日记数据（数据在 %APPDATA%\\' + appName + '）');

  if (PACK) pack(outDir, path.join(distRoot, appName + '-win-x64.' + version + '.7z'));
}

/** 用 7z 压成发布包（LZMA2 最高压缩）；没有 7z 就退回 zip */
function pack(dir, target) {
  const { spawnSync } = require('child_process');
  const has7z = spawnSync('7z', ['i'], { stdio: 'ignore' }).status === 0;
  if (has7z) {
    rmrf(target);
    console.log('');
    console.log('压缩中（LZMA2，可能要一两分钟）...');
    const r = spawnSync('7z', ['a', '-t7z', '-mx=9', '-mmt=on', target, dir], { stdio: 'ignore' });
    if (r.status === 0) {
      console.log('发布包：' + path.relative(root, target) + '  ' +
        (fs.statSync(target).size / 1024 / 1024).toFixed(1) + ' MB');
      return;
    }
    console.warn('7z 压缩失败，改试 zip');
  }
  const zip = target.replace(/\.7z$/, '.zip');
  rmrf(zip);
  const r2 = spawnSync('powershell', ['-NoProfile', '-Command',
    'Compress-Archive -Path "' + dir + '" -DestinationPath "' + zip + '" -Force'], { stdio: 'ignore' });
  if (r2.status === 0) {
    console.log('发布包：' + path.relative(root, zip) + '  ' +
      (fs.statSync(zip).size / 1024 / 1024).toFixed(1) + ' MB（zip 压得没 7z 狠）');
  } else {
    console.warn('压缩失败，请手动压缩 ' + path.relative(root, dir));
  }
}

main();
