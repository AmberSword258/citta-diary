/**
 * 观心 Citta —— 主题（浅色「宣纸」/ 深色「墨夜」/ 跟随系统）
 *
 * 这个文件放在 <head> 里、样式表之后同步执行：
 * 在首帧之前就把 data-theme 写到 <html> 上，避免深色用户看到一闪的白。
 * 它不依赖任何其他脚本，也不碰数据。
 */
(function (global) {
  'use strict';

  const KEY = 'citta.theme';          // 'system' | 'light' | 'dark'
  const MODES = ['system', 'light', 'dark'];
  const LABEL = { system: '跟随系统', light: '浅色', dark: '深色' };
  const mq = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;

  function read() {
    try {
      const v = global.localStorage.getItem(KEY);
      return MODES.indexOf(v) >= 0 ? v : 'system';
    } catch (e) {
      return 'system';
    }
  }

  /** 偏好 → 实际生效的主题 */
  function resolve(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return mq && mq.matches ? 'dark' : 'light';
  }

  let preference = read();
  const listeners = [];

  /** 把主题写到 <html data-theme>，并同步给主进程（窗口标题栏跟着变） */
  function paint() {
    const actual = resolve(preference);
    document.documentElement.setAttribute('data-theme', actual);
    document.documentElement.style.colorScheme = actual;
    // 告诉主进程「偏好」而不是「当前结果」：传 system 才能继续跟随系统，
    // 传实际主题会把应用钉死在那一档（nativeTheme 会覆盖系统信号）
    if (global.citta && global.citta.setTheme) {
      try { global.citta.setTheme(preference); } catch (e) { /* 忽略 */ }
    }
    listeners.forEach((fn) => {
      try { fn(actual, preference); } catch (e) { /* 忽略 */ }
    });
  }

  function set(pref) {
    preference = MODES.indexOf(pref) >= 0 ? pref : 'system';
    try { global.localStorage.setItem(KEY, preference); } catch (e) { /* 忽略 */ }
    paint();
    return preference;
  }

  function get() { return preference; }
  function actual() { return resolve(preference); }
  function onChange(fn) { listeners.push(fn); }

  // 跟随系统时，系统主题变了要跟着走
  if (mq) {
    const onSystemChange = () => { if (preference === 'system') paint(); };
    if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
    else if (mq.addListener) mq.addListener(onSystemChange);
  }

  paint();

  global.CittaTheme = { get, set, actual, onChange, MODES, LABEL, resolve };
})(window);
