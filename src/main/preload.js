'use strict';

/**
 * 观心 Citta —— 预加载脚本
 *
 * 通过 contextBridge 暴露一组最小、明确的 API 给渲染层。
 * 渲染层拿不到 Node、拿不到密钥，也无法直接读文件；
 * 所有数据访问都必须经过主进程的 IPC。
 */

const { contextBridge, ipcRenderer } = require('electron');

/** 调用主进程处理器，并把 {ok,data|error} 解包成 Promise */
async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res) throw new Error('主进程无响应');
  if (!res.ok) throw new Error(res.error || '未知错误');
  return res.data;
}

contextBridge.exposeInMainWorld('citta', {
  // 会话
  state: () => call('session:state'),
  setup: (password, questions) => call('session:setup', password, questions),
  unlock: (password) => call('session:unlock', password),
  unlockWithAnswer: (index, answer) => call('session:unlockWithAnswer', index, answer),
  lock: () => call('session:lock'),
  changePassword: (oldPw, newPw) => call('session:changePassword', oldPw, newPw),
  resetPasswordWithAnswer: (i, a, np) => call('session:resetPasswordWithAnswer', i, a, np),
  updateQuestions: (pw, qs) => call('session:updateQuestions', pw, qs),
  resetAll: () => call('session:resetAll'),

  // 日记
  listEntries: () => call('entries:list'),
  getEntry: (date) => call('entries:get', date),
  saveEntry: (date, data) => call('entries:save', date, data),
  deleteEntry: (date) => call('entries:delete', date),
  stats: () => call('entries:stats'),

  // 图片
  saveImage: (dataURL) => call('images:save', dataURL),
  readImage: (id) => call('images:read', id),
  gcImages: () => call('images:gc'),

  // 备份
  exportBackup: () => call('backup:export'),
  importBackup: (merge) => call('backup:import', merge),

  // 应用
  openDataDir: () => call('app:openDataDir'),
  flush: () => call('app:flush'),
  logo: () => call('app:logo'),
  sampleDoc: () => call('app:sampleDoc'),
  setTheme: (theme) => call('app:setTheme', theme),

  // 日历/农历（由主进程计算后回传纯数据）
  calendarMonth: (year, month) => call('calendar:month', year, month),
  calendarDay: (dayNumber) => call('calendar:day', dayNumber),
  calendarToday: () => call('calendar:today'),
  calendarYearName: (year) => call('calendar:yearName', year),

  // 仅测试环境暴露（由主进程通过环境变量开启）
  testMode: process.env.CITTA_TEST === '1',
  testExport: () => call('test:export'),
  testImport: (payload, merge) => call('test:import', payload, merge),
  testBulk: (n, baseDay) => call('test:bulk', n, baseDay)
});
