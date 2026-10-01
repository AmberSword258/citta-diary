/**
 * 观心 Citta —— 界面基础工具
 *
 * 提供：DOM 便捷方法、日期工具、提示条、模态框、右键菜单、图片放大预览。
 * 全部为纯前端逻辑，不涉及数据访问（数据一律走 window.citta）。
 */
(function (global) {
  'use strict';

  // -------------------------------------------------------------------------
  // DOM
  // -------------------------------------------------------------------------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** 创建元素：el('div', {class:'x', text:'hi'}, [child]) */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : String(v));
      }
    }
    if (children) {
      for (const c of [].concat(children)) {
        if (c == null || c === false) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  // -------------------------------------------------------------------------
  // 日期工具（与主进程统一的 dayNumber 约定：北京时间整日）
  // -------------------------------------------------------------------------
  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

  /** Date -> 'YYYY-MM-DD'（按北京日期） */
  function toDateString(date) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const p = fmt.formatToParts(date || new Date());
    const g = (t) => p.find((x) => x.type === t).value;
    return g('year') + '-' + g('month') + '-' + g('day');
  }

  /** Date -> 'YYYY-MM-DD'（本地）——仅用于把用户选择的年月拼成日期 */
  function ymd(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }

  /** 'YYYY-MM-DD' -> {y,m,d} */
  function parseDate(s) {
    const [y, m, d] = String(s).split('-').map(Number);
    return { y: y, m: m, d: d };
  }

  const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

  /** 'YYYY-MM-DD' -> 'YYYY年M月D日 星期X' */
  function dateLabel(s) {
    const p = parseDate(s);
    const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
    return p.y + '年' + p.m + '月' + p.d + '日 星期' + WEEK_CN[dt.getUTCDay()];
  }

  /** 相对时间（基于存储的 ISO 时间） */
  function timeAgo(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    const diff = Date.now() - t;
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟前';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + ' 小时前';
    const day = Math.floor(hr / 24);
    if (day < 30) return day + ' 天前';
    const dt = new Date(t);
    return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
  }

  /** 完整时间戳 */
  function fullTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  // -------------------------------------------------------------------------
  // 提示条
  // -------------------------------------------------------------------------
  let toastTimer = null;
  function toast(msg, ms) {
    const node = $('#toast');
    if (!node) return;
    node.textContent = msg;
    node.classList.remove('hidden');
    // 淡入 + 上移 6px，停留后缓缓退去
    requestAnimationFrame(() => node.classList.add('show'));
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.classList.remove('show');
      setTimeout(() => node.classList.add('hidden'), 700);
    }, ms || 2200);
  }

  // -------------------------------------------------------------------------
  // 模态框
  // -------------------------------------------------------------------------
  /**
   * 打开模态框。
   * @param {object} opts {title, body:HTMLElement, actions:[{label, primary, danger, onClick(close)}], onClose}
   */
  function modal(opts) {
    const card = el('div', { class: 'modal-card' });
    if (opts.title) card.appendChild(el('h2', { text: opts.title }));
    if (opts.body) card.appendChild(opts.body);

    const mask = el('div', { class: 'modal' }, [card]);
    function close() {
      mask.remove();
      document.removeEventListener('keydown', onKey);
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    if (opts.actions && opts.actions.length) {
      const row = el('div', { class: 'modal-actions' });
      for (const a of opts.actions) {
        row.appendChild(el('button', {
          class: a.primary ? 'primary-btn' : (a.danger ? 'danger-btn ghost-btn' : 'ghost-btn'),
          text: a.label,
          onclick: () => { if (a.onClick) a.onClick(close); else close(); }
        }));
      }
      card.appendChild(row);
    }

    mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(mask);
    return close;
  }

  /** 确认对话框 */
  function confirmDialog(title, message, onOk, okLabel) {
    modal({
      title: title,
      body: el('p', { class: 'muted', text: message, style: { lineHeight: '1.95', margin: '0' } }),
      actions: [
        { label: '取消' },
        { label: okLabel || '确定', danger: true, onClick: (close) => { close(); onOk(); } }
      ]
    });
  }

  // -------------------------------------------------------------------------
  // 右键菜单
  // -------------------------------------------------------------------------
  let ctxNode = null;
  function closeCtx() {
    if (ctxNode) { ctxNode.remove(); ctxNode = null; }
  }
  /**
   * 显示右键菜单。
   * @param {MouseEvent} e
   * @param {Array} items [{label, danger, onClick, sep:true}]
   */
  function contextMenu(e, items) {
    closeCtx();
    const menu = el('div', { class: 'ctx-menu' });
    for (const it of items) {
      if (it.sep) { menu.appendChild(el('div', { class: 'ctx-sep' })); continue; }
      menu.appendChild(el('button', {
        class: it.danger ? 'danger' : '',
        text: it.label,
        onclick: () => { closeCtx(); if (it.onClick) it.onClick(); }
      }));
    }
    document.body.appendChild(menu);
    // 边界处理
    const r = menu.getBoundingClientRect();
    const x = Math.min(e.clientX, window.innerWidth - r.width - 8);
    const y = Math.min(e.clientY, window.innerHeight - r.height - 8);
    menu.style.left = Math.max(8, x) + 'px';
    menu.style.top = Math.max(8, y) + 'px';
    ctxNode = menu;
  }
  document.addEventListener('click', closeCtx);
  document.addEventListener('scroll', closeCtx, true);

  // -------------------------------------------------------------------------
  // 图片放大预览
  // -------------------------------------------------------------------------
  let lightboxOpen = false;
  async function openLightbox(id) {
    try {
      const dataURL = await global.citta.readImage(id);
      if (!dataURL) { toast('图片不存在'); return; }
      const img = $('#lightbox-img');
      img.src = dataURL;
      $('#lightbox').classList.remove('hidden');
      lightboxOpen = true;
    } catch (err) {
      toast('图片读取失败：' + err.message);
    }
  }
  function closeLightbox() {
    $('#lightbox').classList.add('hidden');
    $('#lightbox-img').removeAttribute('src');
    lightboxOpen = false;
  }
  function isLightboxOpen() { return lightboxOpen; }

  // -------------------------------------------------------------------------
  // 本地图片渲染
  //   Markdown 里写的是 citta-img://<id>，CSP 只允许 self 与 data:，
  //   所以渲染后必须把这些占位地址换成真正的 dataURL。
  // -------------------------------------------------------------------------
  const imageCache = new Map();   // id -> dataURL

  /** 取出图片的 dataURL（带内存缓存） */
  async function imageDataURL(id) {
    if (!/^[0-9a-f]{32}$/.test(String(id || ''))) return null;
    if (imageCache.has(id)) return imageCache.get(id);
    try {
      const url = await global.citta.readImage(id);
      if (url) imageCache.set(id, url);
      return url;
    } catch (e) {
      return null;
    }
  }

  /**
   * 把容器内所有 citta-img:// 的图片替换为 dataURL。
   * 同时在 data-img-id 上保留图片 id，供点击放大时使用；
   * 找不到的图片会被移除，避免出现破图与 CSP 报错。
   */
  async function resolveImages(root) {
    if (!root) return;
    const imgs = Array.from(root.querySelectorAll('img')).filter((im) =>
      /^citta-img:\/\//i.test(im.getAttribute('src') || ''));
    for (const img of imgs) {
      const m = /^citta-img:\/\/([0-9a-f]{32})$/i.exec(img.getAttribute('src') || '');
      if (!m) { img.remove(); continue; }
      const url = await imageDataURL(m[1].toLowerCase());
      if (url) {
        img.dataset.imgId = m[1].toLowerCase();
        img.setAttribute('src', url);
      } else {
        img.remove();
      }
    }
  }

  // -------------------------------------------------------------------------
  // 搜索高亮
  // -------------------------------------------------------------------------
  /** 在纯文本中高亮关键词（返回 HTML 字符串，已转义） */
  function highlight(text, keyword) {
    const safe = CittaMarkdown.esc(text);
    if (!keyword) return safe;
    const kw = String(keyword).trim();
    if (!kw) return safe;
    const re = new RegExp('(' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return safe.replace(re, '<mark>$1</mark>');
  }

  // -------------------------------------------------------------------------
  // 导出
  // -------------------------------------------------------------------------
  global.UI = {
    $, $$, el, clear,
    pad2, toDateString, ymd, parseDate, dateLabel, timeAgo, fullTime, WEEK_CN,
    toast, modal, confirmDialog, contextMenu, closeCtx,
    openLightbox, closeLightbox, isLightboxOpen,
    resolveImages, imageDataURL,
    highlight
  };
})(window);
