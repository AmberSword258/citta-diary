/**
 * 观心 Citta —— 设置面板
 *
 * 功能：外观（浅色/深色/跟随系统）、修改密码、密保问题管理、备份导出/导入、数据统计、锁定、重置
 */
(function (global) {
  'use strict';

  const $ = UI.$, el = UI.el, clear = UI.clear;

  // -------------------------------------------------------------------------
  // 设置面板
  // -------------------------------------------------------------------------
  function open() {
    const body = el('div');

    // 外观：浅色「宣纸」/ 深色「墨夜」/ 跟随系统
    body.appendChild(el('div', { class: 'setting-row' }, [
      el('div', { class: 'sr-label' }, [
        el('div', { text: '外观' }),
        el('span', { class: 'hint', text: '浅色是宣纸，深色是墨夜；「跟随系统」随系统切换' })
      ]),
      (() => {
        const row = el('div', { class: 'chip-row' });
        const chips = {};
        const sync = () => {
          const cur = CittaTheme.get();
          Object.keys(chips).forEach((m) => chips[m].classList.toggle('on', m === cur));
        };
        CittaTheme.MODES.forEach((m) => {
          const b = el('button', {
            class: 'chip', type: 'button', text: CittaTheme.LABEL[m],
            onclick: () => { CittaTheme.set(m); sync(); }
          });
          chips[m] = b;
          row.appendChild(b);
        });
        sync();
        return row;
      })()
    ]));

    // 语言：中文（默认）/ English，切换后重载界面
    body.appendChild(el('div', { class: 'setting-row' }, [
      el('div', { class: 'sr-label' }, [
        el('div', { text: '语言' }),
        el('span', { class: 'hint', text: '界面语言，切换后立即生效' })
      ]),
      (() => {
        const row = el('div', { class: 'chip-row' });
        CittaI18n.list().forEach((l) => {
          row.appendChild(el('button', {
            class: 'chip' + (CittaI18n.get() === l.code ? ' on' : ''),
            type: 'button',
            text: l.label,
            'data-lang': l.code,
            onclick: () => CittaI18n.set(l.code)
          }));
        });
        return row;
      })()
    ]));

    // 本地数据
    const stats = CittaStore.all();
    const chars = stats.reduce((a, e) => a + CittaMarkdown.toPlain(e.content || '').length, 0);
    body.appendChild(settingRow('本地数据',
      stats.length + ' 篇日记 · ' + chars + ' 字 · 全部保存在本机，不上传',
      el('button', { class: 'ghost-btn', text: '打开数据目录', onclick: () => global.citta.openDataDir().then(() => UI.toast('已在文件管理器中打开')) })
    ));

    // Markdown 示例：一键写进 1900-01-01，方便随时翻看写法
    body.appendChild(settingRow('Markdown 示例',
      '把一份语法演示写进 1900-01-01 那天的日记，方便随时翻看',
      el('button', {
        class: 'ghost-btn', text: '写入示例',
        onclick: async () => {
          try {
            const res = await global.citta.sampleDoc();
            if (!res || !res.text) { UI.toast('示例文档缺失'); return; }
            const date = '1900-01-01';
            const prev = CittaStore.get(date);
            await CittaStore.save(date, {
              content: res.text,
              mood: (prev && prev.mood) || 0,
              weather: (prev && prev.weather) || '',
              event: (prev && prev.event) || 'Markdown 示例',
              tags: (prev && prev.tags) || ['示例'],
              images: []
            });
            UI.toast('已写入 1900-01-01');
            await CittaCalendar.goTo(1900, 1, null);
          } catch (e) {
            UI.toast('写入失败：' + e.message);
          }
        }
      })
    ));

    // 编辑器缩进显示（默认关闭，优先保证光标位置准确）
    (() => {
      const hint = el('span', { class: 'hint' });
      const btn = el('button', { class: 'ghost-btn' });
      const refresh = () => {
        const on = CittaEditor.getMirrorIndent();
        hint.textContent = on
          ? '已开启：左侧显示逐段首行缩进，但行末光标可能略有偏移'
          : '已关闭（推荐）：左侧为普通文本域，光标位置最准确';
        btn.textContent = on ? '关闭' : '开启';
      };
      btn.addEventListener('click', () => { CittaEditor.setMirrorIndent(!CittaEditor.getMirrorIndent()); refresh(); });
      body.appendChild(el('div', { class: 'setting-row' }, [
        el('div', { class: 'sr-label' }, [el('div', { text: '编辑区缩进显示' }), hint]),
        btn
      ]));
      refresh();
    })();

    // 备份
    body.appendChild(settingRow('导出备份',
      '导出为 JSON 文件，含全部日记与图片，可用于换机或归档',
      el('button', {
        class: 'ghost-btn', text: '导出',
        onclick: async () => {
          try {
            const res = await global.citta.exportBackup();
            if (res.canceled) return;
            UI.toast('已导出 ' + res.count + ' 篇到 ' + res.file);
          } catch (e) { UI.toast('导出失败：' + e.message); }
        }
      })
    ));

    body.appendChild(settingRow('导入恢复',
      '从备份文件恢复；可选择覆盖或仅补充缺失的日期',
      el('div', { style: { display: 'flex', gap: '6px' } }, [
        el('button', {
          class: 'ghost-btn', text: '覆盖导入',
          onclick: () => doImport(false)
        }),
        el('button', {
          class: 'ghost-btn', text: '合并导入',
          onclick: () => doImport(true)
        })
      ])
    ));

    // 密码
    body.appendChild(settingRow('修改密码',
      '重新包裹加密密钥，已有日记无需重加密',
      el('button', { class: 'ghost-btn', text: '修改', onclick: openChangePassword })
    ));

    // 密保
    body.appendChild(settingRow('密保问题',
      '用于忘记密码时找回；建议定期核对',
      el('button', { class: 'ghost-btn', text: '更新', onclick: openUpdateQuestions })
    ));

    // 清理图片
    body.appendChild(settingRow('清理无用图片',
      '删除已不被任何日记引用的图片，释放空间',
      el('button', {
        class: 'ghost-btn', text: '清理',
        onclick: async () => {
          try {
            const res = await global.citta.gcImages();
            UI.toast(res.removed ? '已清理 ' + res.removed + ' 张图片' : '没有需要清理的图片');
          } catch (e) { UI.toast('清理失败：' + e.message); }
        }
      })
    ));

    // 锁定
    body.appendChild(settingRow('锁定应用',
      '清除内存中的密钥，返回锁屏',
      el('button', { class: 'ghost-btn', text: '锁定', onclick: () => { closeModal(); if (global.CittaApp) global.CittaApp.lock(); } })
    ));

    // 危险区
    const dz = el('div', { class: 'danger-zone' }, [
      el('div', { class: 'dz-title', text: '重置应用（清空全部本地数据）' }),
      el('div', { class: 'dz-hint', text: '将删除所有日记、标签与图片。此操作不可撤销。若只是忘记密码，请用密保问题找回，不要使用本功能。' }),
      el('button', {
        class: 'danger-btn ghost-btn', text: '清空全部数据',
        onclick: () => {
          UI.confirmDialog('最后确认', '这会永久删除本机上的全部日记数据，无法恢复。真的要继续吗？', () => {
            const input = el('input', { type: 'text', placeholder: '输入「清空数据」确认' });
            UI.modal({
              title: '确认清空',
              body: el('div', {}, [
                el('p', { class: 'muted', text: '请输入「清空数据」以执行删除。', style: { marginTop: '0' } }),
                input
              ]),
              actions: [{
                label: '永久删除', danger: true, onClick: async (close) => {
                  if (input.value.trim() !== '清空数据') { UI.toast('输入不匹配'); return; }
                  close();
                  await global.citta.resetAll();
                  CittaStore.reset();
                  UI.toast('已清空');
                  if (global.CittaApp) global.CittaApp.lock();
                }
              }, { label: '取消' }]
            });
          }, '继续');
        }
      })
    ]);
    body.appendChild(dz);

    const closeModal = UI.modal({ title: '设置', body: body, actions: [{ label: '关闭' }] });
  }

  function settingRow(label, hint, control) {
    return el('div', { class: 'setting-row' }, [
      el('div', { class: 'sr-label' }, [
        el('div', { text: label }),
        el('span', { class: 'hint', text: hint })
      ]),
      control
    ]);
  }

  async function doImport(merge) {
    try {
      const res = await global.citta.importBackup(merge);
      if (res.canceled) return;
      await CittaStore.load();
      UI.toast('已恢复 ' + res.entries + ' 篇日记、' + res.images + ' 张图片');
      if (global.CittaApp) global.CittaApp.refreshAll();
    } catch (e) {
      UI.toast('导入失败：' + e.message);
    }
  }

  function openChangePassword() {
    const oldPw = el('input', { type: 'password', placeholder: '当前密码' });
    const newPw = el('input', { type: 'password', placeholder: '新密码（至少 4 位）' });
    const newPw2 = el('input', { type: 'password', placeholder: '确认新密码' });
    const msg = el('div', { class: 'muted small', style: { marginTop: '10px', minHeight: '18px' } });

    UI.modal({
      title: '修改密码',
      body: el('div', { class: 'lock-form' }, [
        el('label', { text: '当前密码' }), oldPw,
        el('label', { text: '新密码' }), newPw,
        el('label', { text: '确认新密码' }), newPw2,
        msg
      ]),
      actions: [
        {
          label: '保存', primary: true, onClick: async (close) => {
            const err = validate(newPw.value, newPw2.value);
            if (err) { msg.textContent = err; msg.style.color = 'var(--vermilion)'; return; }
            try {
              const res = await global.citta.changePassword(oldPw.value, newPw.value);
              if (res.changed) { msg.textContent = '密码已修改'; msg.style.color = 'var(--moss)'; UI.toast('密码已修改'); setTimeout(close, 600); }
              else { msg.textContent = '当前密码不正确'; msg.style.color = 'var(--vermilion)'; }
            } catch (e) { msg.textContent = '修改失败：' + e.message; msg.style.color = 'var(--vermilion)'; }
          }
        },
        { label: '取消' }
      ]
    });
  }

  function validate(pw, pw2) {
    if (!pw || pw.length < 4) return '新密码至少 4 位';
    if (pw !== pw2) return '两次输入的密码不一致';
    return '';
  }

  function openUpdateQuestions() {
    const pw = el('input', { type: 'password', placeholder: '当前密码（用于确认身份）' });
    const qs = [];
    const boxes = [];
    for (let i = 0; i < 3; i++) {
      const q = el('input', { type: 'text', placeholder: '问题 ' + (i + 1), value: '' });
      const a = el('input', { type: 'text', placeholder: '答案 ' + (i + 1) });
      boxes.push({ q: q, a: a });
      qs.push(el('div', { class: 'q-item' }, [
        el('div', { class: 'q-label', text: '密保问题 ' + (i + 1) }),
        q, el('div', { style: { height: '5px' } }), a
      ]));
    }
    const msg = el('div', { class: 'muted small', style: { marginTop: '10px', minHeight: '18px' } });

    // 预填现有问题文本
    global.citta.state().then((st) => {
      (st.questions || []).forEach((text, i) => { if (boxes[i]) boxes[i].q.value = text; });
    });

    UI.modal({
      title: '更新密保问题',
      body: el('div', { class: 'lock-form' }, [
        el('label', { text: '当前密码' }), pw,
        el('div', { style: { height: '10px' } }),
        ...qs, msg
      ]),
      actions: [
        {
          label: '保存', primary: true, onClick: async (close) => {
            const list = [];
            for (let i = 0; i < 3; i++) {
              const q = boxes[i].q.value.trim();
              const a = boxes[i].a.value.trim();
              if (!q || !a) { msg.textContent = '第 ' + (i + 1) + ' 项的问题与答案都需填写'; msg.style.color = 'var(--vermilion)'; return; }
              list.push({ q: q, a: a });
            }
            try {
              const res = await global.citta.updateQuestions(pw.value, list);
              if (res.updated) { UI.toast('密保问题已更新'); close(); }
              else { msg.textContent = '密码不正确'; msg.style.color = 'var(--vermilion)'; }
            } catch (e) { msg.textContent = '更新失败：' + e.message; msg.style.color = 'var(--vermilion)'; }
          }
        },
        { label: '取消' }
      ]
    });
  }

  global.CittaSettings = { open };
})(window);
