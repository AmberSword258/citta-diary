/**
 * 观心 Citta —— 前端数据层
 *
 * 内存中保存已解锁的日记（挂在 window.CittaStore），
 * 所有读写都经 window.citta → 主进程；本层负责缓存、搜索索引与订阅通知。
 */
(function (global) {
  'use strict';

  const listeners = new Set();
  let entries = [];                 // 全部日记（按日期倒序）
  let byDate = new Map();           // date -> entry
  let searchIndex = new Map();      // date -> 小写纯文本（用于搜索）
  let ready = false;

  /** 通知订阅者数据变化 */
  function emit() {
    for (const fn of listeners) {
      try { fn(); } catch (e) { console.error(e); }
    }
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /** 重建搜索索引 */
  function reindex() {
    searchIndex = new Map();
    for (const e of entries) {
      const parts = [
        e.title || '',
        CittaMarkdown.toPlain(e.content || ''),
        e.event || '',
        (e.tags || []).join(' ')
      ];
      searchIndex.set(e.date, parts.join(' ').toLowerCase());
    }
  }

  /** 从主进程重新载入全部日记 */
  async function load() {
    entries = await global.citta.listEntries();
    byDate = new Map(entries.map((e) => [e.date, e]));
    reindex();
    ready = true;
    emit();
    return entries;
  }

  function all() { return entries; }
  function get(date) { return byDate.get(date) || null; }
  function count() { return entries.length; }
  function isReady() { return ready; }

  /** 保存日记（先更内存与索引，再落盘） */
  async function save(date, data) {
    const saved = await global.citta.saveEntry(date, data);
    const idx = entries.findIndex((e) => e.date === date);
    if (idx >= 0) entries[idx] = saved;
    else {
      entries.push(saved);
      entries.sort((a, b) => (a.date < b.date ? 1 : -1));
    }
    byDate.set(date, saved);
    // 增量更新索引
    searchIndex.set(date, [
      saved.title || '',
      CittaMarkdown.toPlain(saved.content || ''),
      saved.event || '',
      (saved.tags || []).join(' ')
    ].join(' ').toLowerCase());
    emit();
    return saved;
  }

  function remove(date) {
    return global.citta.deleteEntry(date).then((res) => {
      entries = entries.filter((e) => e.date !== date);
      byDate.delete(date);
      searchIndex.delete(date);
      emit();
      return res;
    });
  }

  /** 全文搜索：返回命中日记（带命中位置信息） */
  function search(keyword) {
    const kw = String(keyword || '').trim().toLowerCase();
    if (!kw) return [];
    const out = [];
    for (const e of entries) {
      const hay = searchIndex.get(e.date) || '';
      const pos = hay.indexOf(kw);
      if (pos >= 0) out.push({ entry: e, pos: pos });
    }
    return out;
  }

  /** 按年/月筛选 */
  function byMonth(year, month) {
    const prefix = year + '-' + UI.pad2(month);
    return entries.filter((e) => e.date.startsWith(prefix));
  }
  function byYear(year) {
    return entries.filter((e) => e.date.startsWith(String(year) + '-'));
  }

  /** 全部出现过的标签及其计数 */
  function tagStats() {
    const map = new Map();
    for (const e of entries) {
      for (const t of (e.tags || [])) {
        const k = String(t).trim();
        if (!k) continue;
        map.set(k, (map.get(k) || 0) + 1);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }

  /** 按年份统计日记数（用于筛选面板） */
  function yearStats() {
    const map = new Map();
    for (const e of entries) {
      const y = e.date.slice(0, 4);
      map.set(y, (map.get(y) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }

  /** 清空（锁定时调用） */
  function reset() {
    entries = [];
    byDate = new Map();
    searchIndex = new Map();
    ready = false;
    emit();
  }

  global.CittaStore = {
    subscribe, load, reset, save, remove,
    all, get, count, isReady,
    search, byMonth, byYear, tagStats, yearStats,
    reindex
  };
})(window);
