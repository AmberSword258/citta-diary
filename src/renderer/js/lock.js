/**
 * 观心 Citta —— 启动锁屏
 *
 * 状态机：
 *   setup    首次使用：设置密码 + 三个密保问题
 *   unlock   日常解锁
 *   recover  忘记密码：回答任一密保问题后重置密码
 *   reset    密保也遗忘：清空全部本地数据（明确警告）
 */
(function (global) {
  'use strict';

  const $ = UI.$, el = UI.el, clear = UI.clear;

  // 预设密保问题，用户也可自定义
  const PRESET_QUESTIONS = [
    '我的第一所学校叫什么名字？',
    '我最喜欢的书是哪一本？',
    '我母亲的名字是什么？',
    '我童年最好的朋友叫什么？',
    '我最想去的地方是哪里？',
    '我最喜欢的一首歌是什么？'
  ];

  let mode = 'unlock';
  let questions = [];   // 服务端保存的问题文本
  let onUnlocked = null;

  // -------------------------------------------------------------------------
  // 应用图标：主进程读取项目根目录的 logo.png / logo.ico，回传 data URL
  // -------------------------------------------------------------------------

  let logoAsked = false;   // 只请求一次（图标是静态资源）

  /** 把 logo 贴到锁屏顶部；图标缺失时保持空白，不显示破图 */
  async function applyLogo() {
    const img = $('#lock-logo');
    if (!img || logoAsked) return;
    logoAsked = true;
    img.addEventListener('error', () => { img.classList.remove('ready'); });
    try {
      const res = await global.citta.logo();
      const src = res && res.dataUrl;
      if (!src) { img.removeAttribute('src'); return; }
      await new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
        img.src = src;
      });
      img.classList.add('ready');
    } catch (e) {
      img.removeAttribute('src');
    }
  }

  function setMessage(msg, ok) {
    const node = $('#lock-msg');
    node.textContent = msg || '';
    // 提示只用朱砂或淡墨，不引入新色
    node.style.color = ok ? 'var(--ink-400)' : 'var(--vermilion)';
  }

  /** 校验密码强度（仅做最低要求提示，不强制） */
  function checkPassword(pw) {
    if (!pw || pw.length < 4) return '密码至少 4 位';
    return '';
  }

  // -------------------------------------------------------------------------
  // 各界面
  // -------------------------------------------------------------------------

  function renderSetup() {
    const body = $('#lock-body');
    clear(body);
    setMessage('首次使用：设置密码，并回答三个密保问题。');

    const form = el('div', { class: 'lock-form' });

    const pw1 = el('input', { type: 'password', id: 'setup-pw1', placeholder: '设置密码（至少 4 位）' });
    const pw2 = el('input', { type: 'password', id: 'setup-pw2', placeholder: '再输入一次' });
    // 两个密码并排，省下一行高度，整张卡在小窗口里也放得下
    form.appendChild(el('label', { text: '密码（至少 4 位，用于加密本机全部日记）' }));
    form.appendChild(el('div', { class: 'row' }, [pw1, pw2]));

    form.appendChild(el('label', { text: '密保问题（忘记密码时用）' }));
    const qInputs = [];
    const aInputs = [];
    for (let i = 0; i < 3; i++) {
      const box = el('div', { class: 'q-item' });
      const sel = el('select');
      for (const q of PRESET_QUESTIONS) {
        sel.appendChild(el('option', { value: q, text: q }));
      }
      sel.appendChild(el('option', { value: '__custom__', text: '自定义问题…' }));
      sel.selectedIndex = i;
      const custom = el('input', { type: 'text', placeholder: '自定义问题', style: { marginTop: '5px', display: 'none' } });
      sel.addEventListener('change', () => {
        custom.style.display = sel.value === '__custom__' ? 'block' : 'none';
      });
      const ans = el('input', { type: 'text', placeholder: '答案' });
      box.appendChild(sel);
      box.appendChild(custom);
      box.appendChild(ans);
      form.appendChild(box);
      qInputs.push({ sel, custom });
      aInputs.push(ans);
    }

    const submit = el('button', {
      class: 'primary-btn',
      text: '设置并进入',
      onclick: async () => {
        const pw = pw1.value;
        const err = checkPassword(pw);
        if (err) { setMessage(err); return; }
        if (pw !== pw2.value) { setMessage('两次输入的密码不一致'); return; }

        const qs = [];
        for (let i = 0; i < 3; i++) {
          const q = qInputs[i].sel.value === '__custom__' ? qInputs[i].custom.value.trim() : qInputs[i].sel.value;
          const a = aInputs[i].value.trim();
          if (!q) { setMessage('第 ' + (i + 1) + ' 个密保问题不能为空'); return; }
          if (!a) { setMessage('第 ' + (i + 1) + ' 个密保答案不能为空'); return; }
          qs.push({ q: q, a: a });
        }

        submit.disabled = true;
        try {
          await global.citta.setup(pw, qs);
          setMessage('设置成功', true);
          if (onUnlocked) onUnlocked();
        } catch (e) {
          setMessage('设置失败：' + e.message);
          submit.disabled = false;
        }
      }
    });

    const actions = el('div', { class: 'actions' }, [submit]);
    form.appendChild(actions);
    body.appendChild(form);
    pw1.focus();
  }

  function renderUnlock() {
    const body = $('#lock-body');
    clear(body);
    setMessage('');

    const form = el('div', { class: 'lock-form' });
    const pw = el('input', { type: 'password', id: 'unlock-pw', placeholder: '请输入密码' });
    const btn = el('button', {
      class: 'primary-btn',
      text: '解锁',
      onclick: doUnlock
    });
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') doUnlock(); });

    form.appendChild(el('label', { text: '密码' }));
    form.appendChild(pw);
    form.appendChild(el('div', { class: 'actions' }, [btn]));

    const links = el('div', { class: 'lock-links' }, [
      el('button', { text: '忘记密码？', onclick: () => { mode = 'recover'; render(); } }),
      el('button', { text: '重置应用', onclick: () => { mode = 'reset'; render(); } })
    ]);
    form.appendChild(links);

    body.appendChild(form);
    pw.focus();

    async function doUnlock() {
      const v = pw.value;
      if (!v) { setMessage('请输入密码'); return; }
      btn.disabled = true;
      try {
        const res = await global.citta.unlock(v);
        if (res.unlocked) {
          setMessage('', true);
          if (onUnlocked) onUnlocked();
        } else {
          setMessage('密码不正确');
          btn.disabled = false;
          pw.select();
        }
      } catch (e) {
        setMessage('解锁失败：' + e.message);
        btn.disabled = false;
      }
    }
  }

  function renderRecover() {
    const body = $('#lock-body');
    clear(body);
    setMessage('回答任意一个密保问题即可重置密码');

    const form = el('div', { class: 'lock-form' });
    const picks = [];

    questions.forEach((q, i) => {
      const box = el('div', { class: 'q-item' });
      box.appendChild(el('div', { class: 'q-label', text: (i + 1) + '. ' + q }));
      const ans = el('input', { type: 'text', placeholder: '答案' });
      box.appendChild(ans);
      form.appendChild(box);
      picks.push(ans);
    });

    const np1 = el('input', { type: 'password', placeholder: '新密码（至少 4 位）' });
    const np2 = el('input', { type: 'password', placeholder: '确认新密码' });
    form.appendChild(el('label', { text: '新密码' }));
    form.appendChild(np1);
    form.appendChild(el('label', { text: '确认新密码' }));
    form.appendChild(np2);

    const submit = el('button', {
      class: 'primary-btn',
      text: '验证并重置',
      onclick: async () => {
        const err = checkPassword(np1.value);
        if (err) { setMessage(err); return; }
        if (np1.value !== np2.value) { setMessage('两次输入的密码不一致'); return; }
        const filled = picks.map((x, i) => ({ i: i, v: x.value.trim() })).filter((x) => x.v);
        if (!filled.length) { setMessage('请至少回答一个问题'); return; }

        submit.disabled = true;
        let lastErr = '';
        for (const item of filled) {
          try {
            const res = await global.citta.resetPasswordWithAnswer(item.i, item.v, np1.value);
            if (res.changed) {
              setMessage('密码已重置', true);
              if (onUnlocked) onUnlocked();
              return;
            }
          } catch (e) { lastErr = e.message; }
        }
        setMessage(lastErr || '密保答案不正确');
        submit.disabled = false;
      }
    });

    form.appendChild(el('div', { class: 'actions' }, [submit]));
    form.appendChild(el('div', { class: 'lock-links' }, [
      el('button', { text: '← 返回解锁', onclick: () => { mode = 'unlock'; render(); } })
    ]));
    body.appendChild(form);
    if (picks[0]) picks[0].focus();
  }

  function renderReset() {
    const body = $('#lock-body');
    clear(body);
    setMessage('');

    // 警示不用边框容器，只用一条 hairline 与朱色文字
    const warn = el('div', {
      style: {
        fontSize: '13px', lineHeight: '1.95', color: 'var(--ink-400)',
        borderTop: '1px solid var(--hairline)', paddingTop: '18px', marginBottom: '26px'
      }
    });
    warn.appendChild(el('div', { text: '重置将清空全部本地数据', style: { color: 'var(--vermilion)', marginBottom: '6px', letterSpacing: '0.08em' } }));
    warn.appendChild(el('div', { text: '包括所有日记、心情记录、标签与图片。此操作无法撤销，且不会上传任何数据。' }));
    warn.appendChild(el('div', { text: '如果只是想不起密码，建议先回到上一步用密保问题找回。', style: { marginTop: '6px' } }));
    body.appendChild(warn);

    const confirmInput = el('input', { type: 'text', placeholder: '请输入「清空数据」四个字以确认' });
    body.appendChild(confirmInput);

    const btn = el('button', {
      class: 'danger-btn ghost-btn',
      text: '确认清空并重新开始',
      style: { width: '100%', marginTop: '12px', padding: '9px' },
      onclick: async () => {
        if (confirmInput.value.trim() !== '清空数据') { setMessage('请输入「清空数据」以确认'); return; }
        btn.disabled = true;
        try {
          await global.citta.resetAll();
          setMessage('已清空，请重新设置密码', true);
          mode = 'setup';
          render();
        } catch (e) {
          setMessage('清空失败：' + e.message);
          btn.disabled = false;
        }
      }
    });
    body.appendChild(btn);
    body.appendChild(el('div', { class: 'lock-links' }, [
      el('button', { text: '← 返回解锁', onclick: () => { mode = 'unlock'; render(); } })
    ]));
    confirmInput.focus();
  }

  function render() {
    if (mode === 'setup') renderSetup();
    else if (mode === 'recover') renderRecover();
    else if (mode === 'reset') renderReset();
    else renderUnlock();
  }

  /** 显示锁屏 */
  async function show() {
    applyLogo();
    const st = await global.citta.state();
    questions = st.questions || [];
    mode = st.hasVault ? 'unlock' : 'setup';
    $('#lock').classList.remove('hidden');
    $('#shell').classList.add('hidden');
    render();
  }

  function hide() {
    $('#lock').classList.add('hidden');
  }

  /** 绑定解锁成功回调 */
  function onUnlock(fn) { onUnlocked = fn; }

  global.CittaLock = { show, hide, onUnlock, render, applyLogo };
})(window);
