/**
 * 观心 Citta —— 轻量 Markdown 渲染器（零依赖，全离线）
 *
 * 支持项目书要求的语法：
 *   一级~三级标题、加粗、斜体、无序列表、有序列表、引用、分割线、链接
 * 另支持：行内代码、代码块、删除线、图片（含本地图片 citta-img:// 协议）
 *
 * 安全：解析结果中的所有 HTML 都会转义，仅输出白名单标签，
 *       链接只允许 http/https/mailto，避免注入。
 */
(function (global) {
  'use strict';

  /** HTML 转义 */
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 只允许安全的链接协议 */
  function safeUrl(url) {
    const u = String(url || '').trim();
    if (/^https?:/i.test(u)) return u;
    if (/^mailto:/i.test(u)) return u;
    if (/^data:image\//i.test(u)) return u;
    // 本地图片必须是规范的 citta-img://<32位十六进制 id>
    if (/^citta-img:\/\/[0-9a-f]{32}$/i.test(u)) return u;
    return '';
  }

  /**
   * 行内解析：先保护代码片段，再依次处理图片、链接、强调、删除线、行内代码。
   */
  function inline(text, resolveImage) {
    const codes = [];
    // 行内代码 `code`（先抽出占位，避免其中的符号被当作语法）
    let s = String(text).replace(/`([^`]+)`/g, function (_, c) {
      codes.push(c);
      return '\u0000C' + (codes.length - 1) + '\u0000';
    });

    // 行首缩进：换成不会被 HTML 折叠的占位符。
    // 必须放在转义之前，否则 &nbsp; 会被二次转义成字面文本。
    // 段落内的每个换行都可能带缩进，故逐段（按行）处理。
    const indents = [];
    s = s.split('\n').map((lineText) => {
      const m = /^[ \t\u3000]+/.exec(lineText);
      if (!m) return lineText;
      let n = 0;
      for (const ch of m[0]) n += ch === '\t' ? 4 : (ch === '\u3000' ? 2 : 1);
      if (!n) return lineText;
      indents.push('&nbsp;'.repeat(n));
      return '\u0000I' + (indents.length - 1) + '\u0000' + lineText.slice(m[0].length);
    }).join('\n');

    s = esc(s);

    // 图片 ![alt](src)
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, function (_, alt, src, title) {
      const real = resolveImage ? resolveImage(src) : src;
      const u = safeUrl(real);
      if (!u) return esc(alt);
      const t = title ? ' title="' + esc(title) + '"' : '';
      return '<img src="' + esc(u) + '" alt="' + esc(alt) + '"' + t + ' loading="lazy">';
    });

    // 链接 [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, href) {
      const u = safeUrl(href);
      if (!u) return label;
      const external = /^https?:/i.test(u) ? ' data-external="1"' : '';
      return '<a href="' + esc(u) + '"' + external + '>' + label + '</a>';
    });

    // 加粗、斜体、删除线
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // 还原行首缩进占位符
    s = s.replace(/\u0000I(\d+)\u0000/g, function (_, i) {
      return indents[Number(i)] || '';
    });

    // 还原行内代码
    s = s.replace(/\u0000C(\d+)\u0000/g, function (_, i) {
      return '<code>' + esc(codes[Number(i)]) + '</code>';
    });

    return s;
  }

  /**
   * 把一行分类为一个块类型。
   * 关键：分类函数只读「去掉前导空格后的内容」，这样缩进过的标题、列表、
   *       引用也能被识别（否则用户先按空格缩进再写 # 就只会看到井号）。
   *       解析主循环与段落收集必须使用同一个分类结果，避免出现不推进的死循环。
   */
  function classify(line) {
    const body = line.replace(/^[ \t\u3000]+/, '');
    if (/^```/.test(body)) return { type: 'fence' };
    if (body === '') return { type: 'blank' };
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(body)) return { type: 'hr' };
    let m = /^(#{1,6})\s+(.*)$/.exec(body);
    if (m) return { type: 'heading', level: Math.min(m[1].length, 3), text: m[2] };
    if (/^>\s?/.test(body)) return { type: 'quote', text: body.replace(/^>\s?/, '') };
    m = /^\d+[.)]\s+(.*)$/.exec(body);
    if (m) return { type: 'ol', text: m[1] };
    m = /^[-*+]\s+(.*)$/.exec(body);
    if (m) return { type: 'ul', text: m[1] };
    return { type: 'text', text: line };
  }

  /** 把行首的缩进空格转换为不会被 HTML 折叠的实体 */
  function keepLeadingIndent(text) {
    return String(text).replace(/^[ \t\u3000]+/, (ws) => {
      let n = 0;
      for (const ch of ws) n += ch === '\t' ? 4 : (ch === '\u3000' ? 2 : 1);
      return '&nbsp;'.repeat(n);
    });
  }
  void keepLeadingIndent; // 缩进逻辑已内联到 inline()，保留此工具以备调用方复用

  /**
   * 渲染整篇 Markdown。
   * @param {string} src 原始 Markdown
   * @param {(src:string)=>string} [resolveImage] 图片地址转换（用于把 citta-img://id 换成实际 dataURL）
   */
  function render(src, resolveImage) {
    const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    let listType = null;   // 'ul' | 'ol' | null

    function closeList() {
      if (listType) { out.push('</' + listType + '>'); listType = null; }
    }

    while (i < lines.length) {
      const cur = classify(lines[i]);

      // 代码块：一直读到下一个围栏
      if (cur.type === 'fence') {
        closeList();
        i++;
        const buf = [];
        while (i < lines.length && !/^\s*```/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++; // 跳过结束围栏
        out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      // 空行
      if (cur.type === 'blank') {
        closeList();
        i++;
        continue;
      }

      if (cur.type === 'hr') {
        closeList();
        out.push('<hr>');
        i++;
        continue;
      }

      if (cur.type === 'heading') {
        closeList();
        out.push('<h' + cur.level + '>' + inline(cur.text, resolveImage) + '</h' + cur.level + '>');
        i++;
        continue;
      }

      // 引用：合并连续的引用行
      if (cur.type === 'quote') {
        closeList();
        const buf = [];
        while (i < lines.length) {
          const c = classify(lines[i]);
          if (c.type !== 'quote') break;
          buf.push(c.text);
          i++;
        }
        out.push('<blockquote>' + inline(buf.join('\n'), resolveImage).replace(/\n/g, '<br>') + '</blockquote>');
        continue;
      }

      if (cur.type === 'ol' || cur.type === 'ul') {
        const want = cur.type;
        if (listType !== want) { closeList(); out.push('<' + want + '>'); listType = want; }
        out.push('<li>' + inline(cur.text, resolveImage) + '</li>');
        i++;
        continue;
      }

      // 普通段落：合并连续的正文行。
      // 循环条件与 classify 完全一致，且每次至少消费一行，绝不空转。
      closeList();
      const buf = [];
      while (i < lines.length && classify(lines[i]).type === 'text') {
        buf.push(lines[i]);
        i++;
      }
      if (!buf.length) { i++; continue; } // 兜底：理论上不会发生
      out.push('<p>' + inline(buf.join('\n'), resolveImage).replace(/\n/g, '<br>') + '</p>');
    }

    closeList();
    return out.join('\n');
  }

  /** 从 Markdown 中提取所有图片 id（citta-img://xxxx） */
  function extractImageIds(src) {
    const ids = [];
    const re = /citta-img:\/\/([0-9a-f]{32})/g;
    let m;
    while ((m = re.exec(String(src || '')))) ids.push(m[1]);
    return ids;
  }

  /** 去掉 Markdown 标记，得到纯文本（用于搜索与摘要） */
  function toPlain(src) {
    return String(src || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '')
      .replace(/[*_~`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  global.CittaMarkdown = { render: render, inline: inline, esc: esc, extractImageIds: extractImageIds, toPlain: toPlain };
})(window);
