/**
 * 观心 Citta —— 界面语言（中文默认 / English）
 *
 * 做法：不改动各处已有的中文文案，而是在渲染后按「字典 + 规则」把界面文字
 * 换成英文。这样所有视图（日历、列表、统计、编辑器、设置、锁屏）自动覆盖，
 * 新写的界面文字只要补进字典即可。
 *
 * 重要：只翻译「界面」，绝不碰用户内容（日记正文、预览、标签、大事、搜索片段）。
 */
(function (global) {
  'use strict';

  const KEY = 'citta.lang';
  const LANGS = ['zh', 'en'];
  const LABEL = { zh: '中文', en: 'English' };

  // 不翻译的容器：这些地方是用户自己写的东西
  const SKIP = [
    'textarea', 'input', 'pre', 'code', 'script', 'style',
    '.markdown', '#ed-mirror', '.ec-body', '.side-preview', '.d-event', '.ec-event',
    '.tag-suggest', '.d-lunar', '.side-lunar', '.ct-sub', '.d-num',
    '.ec-lunar', '.ec-date', '.name', '[data-no-i18n]'
  ].join(',');

  // -------------------------------------------------------------------------
  // 词典：完整命中即整段替换
  // -------------------------------------------------------------------------
  const EXACT = {
    // 顶栏与标签页
    '搜索': 'Search', '设置': 'Settings', '日历': 'Calendar', '日记': 'Journal', '统计': 'Stats',
    '今天': 'Today', '收起': 'Close', '返回': 'Back', '← 返回': '← Back', '观心': 'Citta',
    '搜索（Ctrl+F）': 'Search (Ctrl+F)', '关闭搜索': 'Close search',
    '搜索标题与正文…（Esc 关闭）': 'Search titles and text… (Esc to close)',
    '图片预览': 'Image preview',
    // 锁屏
    'Citta · 本地日记': 'Citta · Local Journal',
    '所有数据仅保存在本机 · 不联网 · 不上传': 'Everything stays on this machine · offline · nothing uploaded',
    '密码（至少 4 位，用于加密本机全部日记）': 'Password (4+ characters; encrypts all entries on this machine)',
    '设置密码（至少 4 位）': 'Set a password (4+ characters)',
    '再输入一次': 'Repeat the password',
    '密保问题（忘记密码时用）': 'Security questions (for password recovery)',
    '自定义问题…': 'Custom question…', '自定义问题': 'Custom question', '答案': 'Answer',
    '设置并进入': 'Save and enter', '密码': 'Password', '请输入密码': 'Enter your password',
    '解锁': 'Unlock', '忘记密码？': 'Forgot password?', '重置应用': 'Reset app',
    '← 返回解锁': '← Back to unlock', '密码至少 4 位': 'Password must be at least 4 characters',
    '两次输入的密码不一致': 'The two passwords do not match',
    '首次使用：设置密码，并回答三个密保问题。': 'First run: choose a password and answer three security questions.',
    '回答任意一个密保问题即可重置密码': 'Answer any one security question to reset the password',
    '新密码': 'New password', '新密码（至少 4 位）': 'New password (4+ characters)',
    '确认新密码': 'Repeat new password', '验证并重置': 'Verify and reset',
    '请至少回答一个问题': 'Answer at least one question',
    '密码已重置': 'Password reset', '密保答案不正确': 'Security answer is incorrect',
    '密码不正确': 'Password is incorrect', '设置成功': 'Saved',
    '重置将清空全部本地数据': 'Resetting erases all local data',
    '包括所有日记、心情记录、标签与图片。此操作无法撤销，且不会上传任何数据。':
      'This includes every entry, mood record, tag and image. It cannot be undone, and nothing is uploaded.',
    '如果只是想不起密码，建议先回到上一步用密保问题找回。':
      'If you simply forgot the password, go back and use a security question instead.',
    '请输入「清空数据」四个字以确认': 'Type 清空数据 to confirm',
    '确认清空并重新开始': 'Erase everything and start over',
    '已清空，请重新设置密码': 'Erased — please set a new password',
    '我的第一所学校叫什么名字？': 'What was the name of my first school?',
    '我最喜欢的书是哪一本？': 'Which book do I like most?',
    '我母亲的名字是什么？': 'What is my mother’s name?',
    '我童年最好的朋友叫什么？': 'What was my best friend’s name as a child?',
    '我最想去的地方是哪里？': 'Where do I most want to go?',
    '我最喜欢的一首歌是什么？': 'What is my favourite song?',
    // 日历
    '选择年月': 'Choose year and month', '上个月': 'Previous month', '下个月': 'Next month',
    '上一年': 'Previous year', '下一年': 'Next year', '上十二年': 'Previous 12 years', '下十二年': 'Next 12 years',
    '选择年份': 'Choose a year', '回到月份': 'Back to months', '回到今天': 'Back to today',
    '尚未落笔': 'Nothing written yet', '写日记': 'Write', '继续编辑': 'Continue editing', '删除': 'Delete',
    '有记录': 'Has an entry', '编辑这一天': 'Edit this day', '写这一天的日记': 'Write this day',
    '查看农历详情': 'Lunar details', '日期详情': 'Date details', '农历': 'Lunar', '公历': 'Gregorian',
    '相对今天': 'Relative to today', '节气': 'Solar term', '节日': 'Festival', '关闭': 'Close',
    '一': 'Mon', '二': 'Tue', '三': 'Wed', '四': 'Thu', '五': 'Fri', '六': 'Sat', '日': 'Sun',
    // 列表与筛选
    '视图': 'View', '全部': 'All', '年份': 'Year', '月份': 'Month', '标签': 'Tags',
    '全部日记': 'All entries', '按年份': 'By year', '按月': 'By month', '按标签': 'By tag',
    '空纸一张': 'No entries', '并无所得': 'No results', '尚空': 'Empty', '（无正文）': '(no text)',
    '置顶': 'Pin', '取消置顶': 'Unpin', '编辑': 'Edit', '导出为 Markdown': 'Export as Markdown',
    '删除日记': 'Delete entry', '已置顶': 'Pinned', '已取消置顶': 'Unpinned', '已删除': 'Deleted',
    '已导出': 'Exported', '当前没有可导出的日记': 'No entries to export', '未记录心情': 'No mood recorded',
    '心情': 'Mood', '天气': 'Weather', '大事': 'Highlight',
    // 编辑器
    '缩进': 'Indent', '预览': 'Preview', '保存': 'Save', '已保存': 'Saved', '已是最新': 'Up to date',
    '首行缩进': 'First-line indent', '关闭': 'Close', '开启': 'Turn on', '文字': 'Text', '分栏': 'Split',
    '插入本地图片': 'Insert image', '读取文件失败': 'Failed to read the file',
    '内容为空，未保存': 'Empty, nothing saved', '图片不存在': 'Image not found',
    '切换缩进方式（首行缩进 / 关闭）': 'Switch indent mode (first line / off)',
    '每个段落只缩进第一行': 'Indent the first line of every paragraph',
    '不自动缩进，由你手打空格': 'No automatic indent; type spaces yourself',
    '已开启编辑区缩进显示（注意：行末光标可能略有偏移）':
      'Indent guides enabled (the caret at line end may drift slightly)',
    '已关闭编辑区缩进显示（光标位置最准确）': 'Indent guides disabled (caret position is exact)',
    '已关闭自动缩进': 'Automatic indent off', '上次修改': 'Last modified',
    '草稿保存失败': 'Draft save failed', '正在保存图片…': 'Saving image…',
    '晴朗': 'Sunny',
    '晴': 'Sunny', '多云': 'Cloudy', '阴': 'Overcast', '小雨': 'Light rain', '大雨': 'Heavy rain',
    '雷雨': 'Thunderstorm', '雪': 'Snow', '雾': 'Fog', '风': 'Wind',
    '很低落': 'Very low', '有点低落': 'A bit low', '平静': 'Calm', '不错': 'Good', '很开心': 'Very happy',
    '一级标题': 'Heading 1', '二级标题': 'Heading 2', '三级标题': 'Heading 3',
    '加粗': 'Bold', '斜体': 'Italic', '删除线': 'Strikethrough', '无序列表': 'Bullet list',
    '有序列表': 'Numbered list', '引用': 'Quote', '分割线': 'Divider', '链接': 'Link', '图片': 'Image',
    '写点什么…支持 Markdown：# 标题、**加粗**、*斜体*、- 列表、> 引用、--- 分割线、[链接](url)':
      'Write something… Markdown supported: # heading, **bold**, *italic*, - list, > quote, --- rule, [link](url)',
    '这一天发生的重要事情（可选）': 'Something notable about this day (optional)',
    '用空格或逗号分隔（可选）': 'Separate with spaces or commas (optional)',
    '在左侧输入内容，这里会实时预览。': 'Type on the left; the preview updates live.',
    // 统计
    '写作概览': 'Writing overview', '只在本机': 'local only', '总篇数': 'Entries', '总字数': 'Characters',
    '连续写作天数': 'Streak (days)', '本月': 'This month', '全年': 'Whole year',
    '心情分布': 'Mood distribution', '心情走向': 'Mood trend', '常用标签': 'Frequent tags',
    '年度小结': 'Year in review', '尚无墨迹': 'Nothing yet',
    '月度记录时间轴': 'Monthly timeline', '当月心情分布': 'Mood distribution this month',
    // 设置
    '设置': 'Settings', '外观': 'Appearance', '跟随系统': 'System', '浅色': 'Light', '深色': 'Dark',
    '浅色是宣纸，深色是墨夜；「跟随系统」随系统切换':
      'Light is paper, dark is ink night; “System” follows the OS',
    '语言': 'Language', '界面语言，切换后立即生效': 'Interface language, applied immediately',
    '本地数据': 'Local data', '打开数据目录': 'Open data folder',
    '已在文件管理器中打开': 'Opened in the file manager',
    '编辑区缩进显示': 'Indent guides in editor',
    '已开启：左侧显示逐段首行缩进，但行末光标可能略有偏移':
      'On: paragraphs show their indent, but the caret at line end can drift slightly',
    '已关闭（推荐）：左侧为普通文本域，光标位置最准确':
      'Off (recommended): plain text area, caret position is exact',
    '导出备份': 'Export backup',
    '导出为 JSON 文件，含全部日记与图片，可用于换机或归档':
      'Export a JSON file with every entry and image, for migration or archiving',
    '导出': 'Export', '导入恢复': 'Import backup',
    'Markdown 示例': 'Markdown sample',
    '把一份语法演示写进 1900-01-01 那天的日记，方便随时翻看':
      'Write a syntax demo into the entry dated 1900-01-01 so you can look it up anytime',
    '写入示例': 'Add sample', '示例文档缺失': 'Sample document not found',
    '已写入 1900-01-01': 'Written to 1900-01-01', '写入失败：': 'Write failed: ',
    '从备份文件恢复；可选择覆盖或仅补充缺失的日期':
      'Restore from a backup file; overwrite or only fill in missing dates',
    '覆盖导入': 'Overwrite', '合并导入': 'Merge',
    '修改密码': 'Change password', '重新包裹加密密钥，已有日记无需重加密':
      'Rewraps the key; existing entries are not re-encrypted',
    '修改': 'Change', '当前密码': 'Current password', '当前密码（用于确认身份）': 'Current password (to confirm)',
    '保存': 'Save', '取消': 'Cancel', '确定': 'OK', '继续': 'Continue', '问题': 'Question',
    '密保问题': 'Security questions', '用于忘记密码时找回；建议定期核对':
      'Used to recover a forgotten password; review them now and then',
    '更新': 'Update', '更新密保问题': 'Update security questions', '密保问题已更新': 'Security questions updated',
    '密码已修改': 'Password changed', '当前密码不正确': 'Current password is incorrect',
    '新密码至少 4 位': 'The new password needs at least 4 characters',
    '清理无用图片': 'Clean up unused images', '删除已不被任何日记引用的图片，释放空间':
      'Delete images no entry refers to and free up space',
    '清理': 'Clean', '已清理': 'Cleaned up', '没有需要清理的图片': 'Nothing to clean up',
    '锁定应用': 'Lock app', '清除内存中的密钥，返回锁屏': 'Drop the key from memory and return to the lock screen',
    '锁定': 'Lock',
    '重置应用（清空全部本地数据）': 'Reset app (erase all local data)',
    '将删除所有日记、标签与图片。此操作不可撤销。若只是忘记密码，请用密保问题找回，不要使用本功能。':
      'This deletes every entry, tag and image and cannot be undone. If you merely forgot your password, use a security question instead.',
    '清空全部数据': 'Erase all data', '最后确认': 'Final confirmation',
    '这会永久删除本机上的全部日记数据，无法恢复。真的要继续吗？':
      'This permanently deletes all diary data on this machine. Continue?',
    '输入「清空数据」确认': 'Type 清空数据 to confirm', '确认清空': 'Erase', '永久删除': 'Delete forever',
    '输入不匹配': 'Input does not match', '已清空': 'Erased',
    // 提示与错误
    '当前不在编辑状态': 'Not editing right now', '未解锁': 'Locked',
    '取消': 'Cancel', '确定': 'OK', '刚刚': 'just now',
    '载入数据失败：': 'Failed to load data: ', '重新载入': 'Reload'
  };

  // -------------------------------------------------------------------------
  // 规则：处理带数字/年月的动态文案（按顺序应用，命中即停）
  // -------------------------------------------------------------------------
  const RULES = [
    // 年月日与标题
    [/^(\d{4}) 年 (\d{1,2}) 月$/, (m, y, mo) => MONTHS[Number(mo) - 1] + ' ' + y],
    [/^(\d{4}) 年$/, '$1'],
    [/^(\d{4}) – (\d{4})$/, (m, a, b) => a + ' – ' + b],
    [/^(\d{1,2}) 月$/, (m, n) => MONTHS[Number(n) - 1]],
    [/^(\d{4}) 年 (\d{1,2}) 月 (\d{1,2}) 日$/, (m, y, mo, d) => MONTHS[Number(mo) - 1] + ' ' + Number(d) + ', ' + y],
    [/^(\d{4})年(\d{1,2})月(\d{1,2})日 星期(.)$/, (m, y, mo, d, w) =>
      (WEEKDAYS[w] || w) + ', ' + MONTHS[Number(mo) - 1] + ' ' + Number(d) + ', ' + y],
    [/^(\d{4})年(\d{1,2})月(\d{1,2})日$/, (m, y, mo, d) => MONTHS[Number(mo) - 1] + ' ' + Number(d) + ', ' + y],
    [/^(\d{1,2})月(\d{1,2})日 星期(.)$/, (m, mo, d, w) =>
      (WEEKDAYS[w] || w) + ', ' + MONTHS[Number(mo) - 1] + ' ' + Number(d)],
    // 相对时间
    [/^(\d+) 天前$/, (m, n) => n + ' days ago'],
    [/^(\d+) 天后$/, (m, n) => 'in ' + n + ' days'],
    [/^(\d+) 小时前$/, (m, n) => n + ' hours ago'],
    [/^(\d+) 分钟前$/, (m, n) => n + ' minutes ago'],
    [/^昨天$/, () => 'Yesterday'],
    [/^明天$/, () => 'Tomorrow'],
    // 计数与单位
    [/^共 (\d+) 篇$/, (m, n) => n + ' entries'],
    [/^(\d+) 篇$/, (m, n) => n + ' entries'],
    [/^(\d+) 条结果$/, (m, n) => n + ' results'],
    [/^找到 (\d+) 条$/, (m, n) => n + ' found'],
    [/^（搜索：(.+)）$/, (m, q) => '(search: ' + q + ')'],
    [/^(\d+) 篇日记 · (\d+) 字 · 全部保存在本机，不上传$/,
      (m, a, b) => a + ' entries · ' + b + ' characters · stored locally, never uploaded'],
    [/^(\d+) 篇日记、([\d,]+) 字$/, (m, a, b) => a + ' entries · ' + b + ' characters'],
    [/^(\d+) 分$/, (m, n) => n + ' / 5'],
    [/^(\d+) 字 · (\d+) 行 · 支持 Markdown$/, (m, a, b) => a + ' characters · ' + b + ' lines · Markdown supported'],
    [/^(\d+) 字$/, (m, n) => n + ' characters'],
    [/^(\d+) 个字符$/, (m, n) => n + ' characters'],
    [/^(\d+) 字符$/, (m, n) => n + ' chars'],
    [/^(\d+) 张图片$/, (m, n) => n + ' images'],
    [/^(\d+) 篇到 (.+)$/, (m, n, f) => n + ' entries to ' + f],
    [/^(\d+) 篇日记、(\d+) 字$/, (m, a, b) => a + ' entries · ' + b + ' characters'],
    // 统计文案
    [/^(\d+) 年 · 写作与心情$/, (m, y) => y + ' · writing and mood'],
    [/^(\d+) 年 · 心情走向$/, (m, y) => y + ' · mood trend'],
    [/^(\d+) 年 (\d+) 月 · 心情分布$/, (m, y, mo) => MONTHS[Number(mo) - 1] + ' ' + y + ' · mood distribution'],
    [/^(\d+) 年 (\d+) 月 · (.+)$/, (m, y, mo, rest) => MONTHS[Number(mo) - 1] + ' ' + y + ' · ' + rest],
    [/^本月 (\d+) 篇　其中 (\d+) 篇记了心情　均 ([\d.]+)$/,
      (m, a, b, c) => 'This month ' + a + ' entries · ' + b + ' with mood · avg ' + c],
    [/^(\d+) 篇　墨点浓淡即当月心情$/, (m, n) => n + ' entries · dot colour tells that month’s mood'],
    [/^这一年写下 (\d+) 篇　共 (\d+) 字$/, (m, a, b) => a + ' entries this year · ' + b + ' characters'],
    [/^当前连续写作 (\d+) 天$/, (m, n) => 'Current streak ' + n + ' days'],
    [/^全部记录 (\d+) 篇　([\d,]+) 字$/, (m, a, b) => 'All entries ' + a + ' · ' + b + ' characters'],
    // 其他拼接文案
    [/^心情：(.+) · 天气：(.+)$/, (m, a, b) => 'Mood: ' + translate(a) + ' · Weather: ' + translate(b)],
    [/^星期(.) · (.+)$/, (m, w, rest) => (WEEKDAYS[w] || w) + ' · ' + translate(rest)],
    [/^星期(.)$/, (m, w) => WEEKDAYS[w] || m],
    [/^最后修改：(.+)$/, (m, v) => 'Last modified: ' + v],
    [/^最后修改 (.+)$/, (m, v) => 'Last modified ' + v],
    [/^心情：(.+)$/, (m, v) => 'Mood: ' + translate(v)],
    [/^天气：(.+)$/, (m, v) => 'Weather: ' + translate(v)],
    [/^大事：(.+)$/, (m, v) => 'Highlight: ' + v],
    [/^标签：(.+)$/, (m, v) => 'Tags: ' + v],
    [/^心情 (.+)$/, (m, v) => 'Mood ' + translate(v)],
    [/^(\d) · (.+)$/, (m, n, label) => n + ' · ' + translate(label)],
    [/^(\d+) 个密保问题不能为空$/, (m, n) => 'Security question ' + n + ' cannot be empty'],
    [/^(\d+) 个密保答案不能为空$/, (m, n) => 'Answer ' + n + ' cannot be empty'],
    [/^第 (\d+) 项的问题与答案都需填写$/, (m, n) => 'Question and answer ' + n + ' are both required'],
    [/^草稿已自动保存 · (.+)$/, (m, t) => 'Draft autosaved · ' + t],
    [/^删除后无法恢复，确定要删除 (.+) 的日记吗？$/, (m, d) => 'This cannot be undone. Delete the entry for ' + d + '?'],
    [/^(.+) 的日记后无法恢复，确定吗？$/, (m, d) => 'Deleting ' + d + ' cannot be undone. Continue?'],
    [/^导出失败：(.+)$/, (m, v) => 'Export failed: ' + v],
    [/^导入失败：(.+)$/, (m, v) => 'Import failed: ' + v],
    [/^修改失败：(.+)$/, (m, v) => 'Change failed: ' + v],
    [/^更新失败：(.+)$/, (m, v) => 'Update failed: ' + v],
    [/^清理失败：(.+)$/, (m, v) => 'Cleanup failed: ' + v],
    [/^设置失败：(.+)$/, (m, v) => 'Setup failed: ' + v],
    [/^解锁失败：(.+)$/, (m, v) => 'Unlock failed: ' + v],
    [/^清空失败：(.+)$/, (m, v) => 'Erase failed: ' + v],
    [/^保存失败：(.*)$/, (m, v) => 'Save failed: ' + v],
    [/^载入数据失败：(.+)$/, (m, v) => 'Failed to load data: ' + v],
    [/^图片读取失败：(.+)$/, (m, v) => 'Failed to read image: ' + v],
    [/^图片保存失败：(.+)$/, (m, v) => 'Failed to save image: ' + v],
    [/^图片超过 8MB，已跳过：(.+)$/, (m, f) => 'Image over 8MB, skipped: ' + f],
    [/^请输入「清空数据」以确认$/, () => 'Type 清空数据 to confirm'],
    [/^请输入「清空数据」以执行删除。$/, () => 'Type 清空数据 to perform the deletion.']
  ];

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = { 一: 'Monday', 二: 'Tuesday', 三: 'Wednesday', 四: 'Thursday', 五: 'Friday', 六: 'Saturday', 日: 'Sunday' };

  let lang = 'zh';
  let observer = null;
  const done = new WeakSet();

  function read() {
    try {
      const v = global.localStorage.getItem(KEY);
      return LANGS.indexOf(v) >= 0 ? v : 'zh';
    } catch (e) { return 'zh'; }
  }

  /** 单条文本 → 目标语言（zh 时原样返回） */
  function translate(text) {
    if (lang === 'zh' || !text) return text;
    if (!/[\u4e00-\u9fa5]/.test(text)) return text;
    if (EXACT[text]) return EXACT[text];
    for (let i = 0; i < RULES.length; i++) {
      const r = RULES[i];
      if (r[0].test(text)) {
        if (typeof r[1] === 'function') return text.replace(r[0], r[1]);
        return text.replace(r[0], r[1]);
      }
    }
    return text;
  }

  const ATTRS = ['placeholder', 'title', 'aria-label'];

  function shouldSkip(node) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== document.body) {
      if (el.matches && el.matches(SKIP)) return true;
      el = el.parentElement;
    }
    return false;
  }

  function walk(root) {
    if (lang === 'zh' || !root) return;
    // 文本节点
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (done.has(n) || !n.nodeValue.trim() ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    texts.forEach((n) => {
      done.add(n);
      if (shouldSkip(n)) return;
      const out = translate(n.nodeValue.trim());
      if (out !== n.nodeValue.trim()) n.nodeValue = n.nodeValue.replace(n.nodeValue.trim(), out);
    });
    // 属性
    const els = root.querySelectorAll ? root.querySelectorAll('[placeholder],[title],[aria-label]') : [];
    Array.prototype.forEach.call(els, (el) => {
      // 日历格子的 title 里是农历与用户写的大事，不译
      if (el.closest && el.closest('.cell')) return;
      ATTRS.forEach((a) => {
        const v = el.getAttribute(a);
        if (!v) return;
        const out = translate(v);
        if (out !== v) el.setAttribute(a, out);
      });
    });
  }

  function observe() {
    if (observer || lang === 'zh') return;
    observer = new MutationObserver((records) => {
      records.forEach((r) => {
        if (r.type === 'characterData') {
          done.delete(r.target);
          const n = r.target;
          if (n.parentElement && !shouldSkip(n)) {
            const out = translate(n.nodeValue.trim());
            if (out !== n.nodeValue.trim()) n.nodeValue = n.nodeValue.replace(n.nodeValue.trim(), out);
          }
          return;
        }
        if (r.type === 'attributes') {
          const el = r.target;
          const v = el.getAttribute(r.attributeName);
          if (!v || (el.closest && el.closest('.cell'))) return;
          const out = translate(v);
          if (out !== v) el.setAttribute(r.attributeName, out);   // 收敛：译完就不再匹配
          return;
        }
        r.addedNodes && Array.prototype.forEach.call(r.addedNodes, (n) => {
          if (n.nodeType === 1 || n.nodeType === 3) walk(n.nodeType === 1 ? n : n.parentElement || n);
        });
      });
    });
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS
    });
  }

  /** 全量重刷（切语言、重渲染之后调用） */
  function refresh() {
    if (lang === 'zh') return;
    walk(document.body);
  }

  /** 切换语言：存起来后重载界面，保证每一处都干净地按新语言重绘 */
  function set(next) {
    const want = LANGS.indexOf(next) >= 0 ? next : 'zh';
    try { global.localStorage.setItem(KEY, want); } catch (e) { /* 忽略 */ }
    if (want === lang) return;
    global.location.reload();
  }

  /** 启动时按存储值生效 */
  function applyInitial() {
    lang = read();
    document.documentElement.setAttribute('data-lang', lang);
    document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
    applyStatic();
    if (lang === 'en') { refresh(); observe(); }
  }

  /** index.html 里写死的那几处，直接按 data-i18n 替换 */
  function applyStatic() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), (el) => {
      const zh = el.getAttribute('data-i18n');
      el.textContent = lang === 'en' ? translate(zh) : zh;
    });
  }

  function get() { return lang; }
  function list() { return LANGS.map((l) => ({ code: l, label: LABEL[l] })); }

  // 启动时按存储值生效（此刻只有 index.html 的静态文字在）
  document.addEventListener('DOMContentLoaded', applyInitial);

  global.CittaI18n = {
    get, set, list, translate, refresh, LABEL,
    // 调试/测试：列出当前界面上还没被翻译的中文
    untranslated: () => {
      const out = new Set();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      while (walker.nextNode()) {
        const n = walker.currentNode;
        const t = n.nodeValue.trim();
        if (!t || !/[\u4e00-\u9fa5]/.test(t)) continue;
        if (shouldSkip(n)) continue;
        if (translate(t) === t) out.add(t);
      }
      Array.prototype.forEach.call(document.querySelectorAll('[placeholder],[title],[aria-label]'), (el) => {
        if (el.closest && el.closest('.cell')) return;   // 日历格子标题是农历与用户大事
        ATTRS.forEach((a) => {
          const v = el.getAttribute(a);
          if (v && /[\u4e00-\u9fa5]/.test(v) && translate(v) === v) out.add(a + '=' + v);
        });
      });
      return Array.from(out);
    }
  };
})(window);
