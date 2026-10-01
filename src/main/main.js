'use strict';

/**
 * 观心 Citta —— Electron 主进程
 *
 * 职责：
 *  · 创建窗口（深色禅意风，无边框留白）
 *  · 持有存储与密钥（渲染进程永远拿不到密钥，只能通过 IPC 读写明文）
 *  · 提供本地备份导出/导入、图片落盘、全局快捷键
 *  · 所有数据都在本地，应用不发起任何网络请求
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeImage, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { Storage } = require('./storage');
const lunar = require('../shared/lunar.js');

// 单实例：多开会导致两个进程同时写同一份数据
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

/** @type {BrowserWindow|null} */
let win = null;
/** @type {Storage|null} */
let store = null;

// ---------------------------------------------------------------------------
// 界面偏好：只记主题，落在 userData/prefs.json（与日记数据完全分开）
// 主进程知道主题，才能让窗口标题栏也一起变深变浅
// ---------------------------------------------------------------------------
function prefsPath() { return path.join(app.getPath('userData'), 'prefs.json'); }

function readPrefs() {
  try {
    const raw = fs.readFileSync(prefsPath(), 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) {
    return {};
  }
}

function writePrefs(patch) {
  try {
    const next = Object.assign(readPrefs(), patch);
    fs.writeFileSync(prefsPath(), JSON.stringify(next, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

/** 启动时按上次的选择设定系统主题（影响标题栏/滚动条等原生部分） */
function applyStoredTheme() {
  const theme = readPrefs().theme;
  nativeTheme.themeSource = (theme === 'dark' || theme === 'light') ? theme : 'system';
}

// ---------------------------------------------------------------------------
// 应用图标：logo.ico（窗口与任务栏）与 logo.png（界面内展示）
// 放在项目根目录，缺失时安静降级为 Electron 默认图标
// ---------------------------------------------------------------------------
const LOGO_DIR = path.join(__dirname, '..', '..');

function logoFile(names) {
  for (const n of names) {
    const p = path.join(LOGO_DIR, n);
    try {
      if (fs.existsSync(p) && fs.statSync(p).size > 0) return p;
    } catch (e) { /* 忽略 */ }
  }
  return null;
}

/** 窗口/任务栏图标：优先 .ico（Windows 多尺寸），退回 png */
const WINDOW_ICON = logoFile(['logo.ico', 'logo.png']);
/** 界面内展示：优先 png（无损缩放），退回 ico */
const VIEW_LOGO = logoFile(['logo.png', 'logo.ico']);

/** 把界面用 logo 读成 data URL（只读一次，之后走缓存） */
const LOGO_PIXELS = 200;      // 界面按 80px 显示，留足高 DPI 余量即可
let logoDataUrl = null;
function readLogoDataUrl() {
  if (logoDataUrl !== null) return logoDataUrl;
  logoDataUrl = '';
  if (!VIEW_LOGO) return logoDataUrl;
  // 原图有一两兆，先缩到展示尺寸再传，省内存也省 IPC
  try {
    const img = nativeImage.createFromPath(VIEW_LOGO);
    if (!img.isEmpty()) {
      const size = img.getSize();
      const scale = LOGO_PIXELS / Math.max(size.width || 1, size.height || 1);
      const small = scale < 1
        ? img.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'best'
        })
        : img;
      logoDataUrl = 'data:image/png;base64,' + small.toPNG().toString('base64');
      return logoDataUrl;
    }
  } catch (e) { /* 解码失败则退回直读文件 */ }
  try {
    const ext = path.extname(VIEW_LOGO).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.ico' ? 'image/x-icon' : 'image/jpeg';
    logoDataUrl = 'data:' + mime + ';base64,' + fs.readFileSync(VIEW_LOGO).toString('base64');
  } catch (e) {
    logoDataUrl = '';
  }
  return logoDataUrl;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    show: false,
    icon: WINDOW_ICON || undefined,
    backgroundColor: '#12110f',
    title: '观心 Citta',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.once('ready-to-show', () => win.show());

  // 外部链接一律用系统浏览器打开，应用内不导航
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => { win = null; });
}

// ---------------------------------------------------------------------------
// IPC：统一包装，避免把异常堆栈直接抛给渲染层
// ---------------------------------------------------------------------------

/** 注册一个 IPC 处理器，自动捕获异常并返回 {ok, data|error} */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      const data = await fn(...args);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  });
}

function registerIpc() {
  // ---- 会话状态 ----
  handle('session:state', () => ({
    hasVault: store.hasVault(),
    unlocked: store.isUnlocked(),
    questions: store.getQuestions(),
    version: app.getVersion()
  }));

  handle('session:setup', (password, questions) => {
    store.setup(password, questions);
    return { unlocked: true };
  });

  handle('session:unlock', (password) => {
    const ok = store.unlock(password);
    return { unlocked: ok };
  });

  handle('session:unlockWithAnswer', (index, answer) => {
    const ok = store.unlockWithAnswer(index, answer);
    return { unlocked: ok };
  });

  handle('session:lock', () => ({ unlocked: !store.lock() }));

  handle('session:changePassword', (oldPw, newPw) => ({
    changed: store.changePassword(oldPw, newPw)
  }));

  handle('session:resetPasswordWithAnswer', (index, answer, newPw) => ({
    changed: store.resetPasswordWithAnswer(index, answer, newPw)
  }));

  handle('session:updateQuestions', (password, questions) => ({
    updated: store.updateQuestions(password, questions)
  }));

  handle('session:resetAll', () => {
    store.resetAll();
    return { cleared: true };
  });

  // ---- 日记 ----
  const needUnlock = () => {
    if (!store.isUnlocked()) throw new Error('未解锁');
  };

  handle('entries:list', () => {
    needUnlock();
    return store.listEntries();
  });

  handle('entries:get', (date) => {
    needUnlock();
    return store.getEntry(date);
  });

  handle('entries:save', (date, data) => {
    needUnlock();
    return store.saveEntry(date, data);
  });

  handle('entries:delete', (date) => {
    needUnlock();
    return { deleted: store.deleteEntry(date) };
  });

  handle('entries:stats', () => {
    needUnlock();
    return store.stats();
  });

  // ---- 图片 ----
  handle('images:save', (dataURL) => {
    needUnlock();
    return store.saveImage(dataURL);
  });

  handle('images:read', (id) => {
    needUnlock();
    return store.readImage(id);
  });

  handle('images:gc', () => {
    needUnlock();
    return { removed: store.gcImages() };
  });

  // ---- 备份 ----
  handle('backup:export', async () => {
    needUnlock();
    const payload = store.exportBackup();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const res = await dialog.showSaveDialog(win, {
      title: '导出观心 Citta 备份',
      defaultPath: path.join(app.getPath('documents'), 'citta-backup-' + stamp + '.json'),
      filters: [{ name: 'JSON 备份', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    fs.writeFileSync(res.filePath, JSON.stringify(payload), 'utf8');
    return { canceled: false, file: res.filePath, count: payload.count };
  });

  handle('backup:import', async (merge) => {
    needUnlock();
    const res = await dialog.showOpenDialog(win, {
      title: '选择备份文件以恢复',
      properties: ['openFile'],
      filters: [{ name: 'JSON 备份', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    const text = fs.readFileSync(res.filePaths[0], 'utf8');
    const payload = JSON.parse(text);
    const out = store.importBackup(payload, !!merge);
    return Object.assign({ canceled: false, file: res.filePaths[0] }, out);
  });

  handle('app:openDataDir', () => {
    shell.openPath(app.getPath('userData'));
    return { opened: true };
  });

  handle('app:logo', () => ({ dataUrl: readLogoDataUrl() }));

  // Markdown 示例：随应用分发的 1900-01-01 那份文档，供设置页一键写进日记
  handle('app:sampleDoc', () => {
    const p = logoFile(['Markdown写法演示_1900-01-01.md']);
    if (!p) return { text: '' };
    try {
      return { text: fs.readFileSync(p, 'utf8') };
    } catch (e) {
      return { text: '' };
    }
  });

  // 渲染层切主题时同步一次：窗口标题栏、滚动条等系统绘制部分跟着变
  // 收到的是「偏好」（system/light/dark），system 才能继续跟随系统
  handle('app:setTheme', (theme) => {
    const t = (theme === 'dark' || theme === 'light') ? theme : 'system';
    const changed = nativeTheme.themeSource !== t;
    nativeTheme.themeSource = t;
    if (changed) writePrefs({ theme: t });
    return { theme: t };
  });

  handle('app:flush', () => {
    store.flush();
    return { flushed: true };
  });

  // ---- 日历计算（农历模块是 CommonJS，放在主进程执行后回传纯数据）----
  // 一次性返回某月所需全部信息：日历矩阵、每日农历/节气/节日、以及该月日记摘要。
  handle('calendar:month', (year, month) => {
    needUnlock();
    const { weeks, lead } = lunar.monthMatrix(year, month);
    const days = weeks.flat().map((dn) => {
      const info = lunar.dayInfo(dn);
      const entry = store.getEntry(info.date);
      return {
        dn,
        date: info.date,
        day: info.day,
        month: info.month,
        year: info.year,
        inMonth: info.month === month,
        weekday: info.weekday,
        lunarText: lunarShort(info),
        lunarFull: info.lunarFull,
        zodiac: info.lunar ? info.lunar.zodiac : '',
        term: info.solarTerm,
        festivals: info.festivals,
        isToday: info.isToday,
        relative: lunar.relativeText(dn, lunar.todayDayNumber()),
        // 日记摘要（不传正文，避免不必要的内存占用）
        hasEntry: !!entry,
        mood: entry ? entry.mood || 0 : 0,
        event: entry ? entry.event || '' : '',
        excerpt: entry ? excerptOf(entry) : ''
      };
    });
    return { year, month, lead, weeks: weeks.length, days, today: lunar.todayDayNumber() };
  });

  // 单日详情
  handle('calendar:day', (dayNumber) => {
    needUnlock();
    const info = lunar.dayInfo(dayNumber);
    const entry = store.getEntry(info.date);
    return {
      dayNumber,
      date: info.date,
      weekdayFull: info.weekdayFull,
      lunarFull: info.lunarFull,
      lunarText: info.lunarText,
      solarTerm: info.solarTerm,
      festivals: info.festivals,
      relative: lunar.relativeText(dayNumber, lunar.todayDayNumber()),
      hasEntry: !!entry
    };
  });

  // 今天的信息
  handle('calendar:today', () => {
    needUnlock();
    const dn = lunar.todayDayNumber();
    const info = lunar.dayInfo(dn);
    return {
      dayNumber: dn,
      date: info.date,
      year: info.year,
      month: info.month,
      day: info.day,
      weekdayFull: info.weekdayFull,
      lunarFull: info.lunarFull,
      solarTerm: info.solarTerm,
      festivals: info.festivals
    };
  });

  // 多年统计所需的农历信息（年度统计用生肖/干支）
  handle('calendar:yearName', (year) => ({ name: lunar.lunarYearName(year) }));

  // ---- 仅测试环境可用：便于端到端测试直接操作存储层 ----
  if (process.env.CITTA_TEST === '1') {
    handle('test:export', () => {
      needUnlock();
      return store.exportBackup();
    });
    handle('test:import', (payload, merge) => {
      needUnlock();
      return store.importBackup(payload, !!merge);
    });
    handle('test:bulk', (n, baseDay) => {
      needUnlock();
      const list = [];
      for (let i = 0; i < n; i++) {
        const dn = baseDay + i;
        const d = lunar.dayNumberToYmd(dn);
        list.push({
          date: lunar.formatYmd(d.y, d.m, d.d),
          content: '# 第 ' + (i + 1) + ' 篇\n\n这是测试内容 ' + i + '，用于验证性能。\n\n- 项目 A\n- 项目 B',
          mood: (i % 5) + 1,
          weather: ['晴', '阴', '小雨'][i % 3],
          event: i % 50 === 0 ? '第 ' + (i + 1) + ' 篇' : '',
          tags: ['测试内容', i % 2 ? '甲' : '乙'],
          images: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      return { inserted: store.importEntries(list, true) };
    });
  }
}

/** 日历格子上的农历短文本：节日 > 节气 > 农历日 */
function lunarShort(info) {
  if (info.festivals && info.festivals.length) return info.festivals[0];
  if (info.solarTerm) return info.solarTerm;
  if (info.lunar) {
    return info.lunar.d === 1 ? info.lunar.monthCn : info.lunar.dayCn;
  }
  return '';
}

/** 列表摘要：取正文首行非空文本，截断到 60 字 */
function excerptOf(entry) {
  const text = String(entry.content || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`_~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 60 ? text.slice(0, 60) + '…' : text;
}

// ---------------------------------------------------------------------------
// 应用启动
// ---------------------------------------------------------------------------

// 任务栏身份：让 Windows 把本应用当作独立程序（图标取自窗口图标 logo.ico），
// 而不是混进 electron.exe 的一组
app.setAppUserModelId('com.citta.diary');

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // 应用自带界面，隐藏系统菜单
  applyStoredTheme();            // 标题栏跟着上次选的主题走
  store = new Storage(app.getPath('userData'));
  store.init();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  if (store) store.flush(); // 退出前确保落盘
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (store) store.flush(); // 关闭前保存正式内容
});
