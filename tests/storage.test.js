/**
 * 存储与加密层单元测试（在真实 Electron 主进程环境中运行）
 */
'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tempDir = path.join(os.tmpdir(), 'citta-unit-' + Date.now());
app.setPath('userData', tempDir);

const { Storage } = require('../src/main/storage');

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e && e.message }); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }

app.whenReady().then(() => {
  const store = new Storage(tempDir);
  store.init();

  check('初始无密钥库', () => assert(store.hasVault() === false, '应为空'));
  check('未解锁时不可写日记', () => {
    let threw = false;
    try { store.saveEntry('2024-01-01', { content: 'x' }); } catch (e) { threw = true; }
    assert(threw, '未解锁却允许写入');
  });

  check('设置密码并解锁', () => {
    store.setup('pw-123456', [{ q: 'q1', a: 'a1' }, { q: 'q2', a: 'a2' }, { q: 'q3', a: 'a3' }]);
    assert(store.hasVault(), '密钥库未创建');
    assert(store.isUnlocked(), '应处于解锁状态');
    assert(store.getQuestions().length === 3, '密保问题数应为 3');
  });

  check('保存与读取日记', () => {
    store.saveEntry('2024-05-01', { content: '# 标题\n正文', mood: 4, weather: '晴', event: '大事', tags: ['a', 'b'], images: [] });
    const e = store.getEntry('2024-05-01');
    assert(e && e.mood === 4 && e.event === '大事', '读回的内容不符');
    assert(e.createdAt && e.updatedAt, '缺少时间戳');
  });

  check('更新日记保留 createdAt', () => {
    const before = store.getEntry('2024-05-01').createdAt;
    store.saveEntry('2024-05-01', { content: '改过了', mood: 5, weather: '阴', event: '', tags: [], images: [] });
    const after = store.getEntry('2024-05-01');
    assert(after.createdAt === before, 'createdAt 被覆盖');
    assert(after.content === '改过了' && after.mood === 5, '更新未生效');
    // 写盘为节流模式，这里强制落盘，供后续「重新打开」的用例读取
    assert(store.flush() === true, 'flush 未写入');
  });

  check('密码错误无法解锁', () => {
    const s2 = new Storage(tempDir);
    s2.init();
    assert(s2.unlock('wrong-password') === false, '错误密码竟解锁成功');
    assert(s2.unlock('pw-123456') === true, '正确密码解锁失败');
    const e = s2.getEntry('2024-05-01');
    assert(e && e.mood === 5, '重新解锁后数据不一致');
  });

  check('密保答案找回', () => {
    const s3 = new Storage(tempDir);
    s3.init();
    assert(s3.unlockWithAnswer(1, '错误答案') === false, '错误答案竟通过');
    assert(s3.unlockWithAnswer(1, 'a2') === true, '正确答案未通过');
    assert(s3.getEntry('2024-05-01').mood === 5, '找回后数据不一致');
  });

  check('修改密码后旧密码失效', () => {
    assert(store.changePassword('pw-123456', 'new-pw-9999') === true, '改密码失败');
    const s4 = new Storage(tempDir);
    s4.init();
    assert(s4.unlock('pw-123456') === false, '旧密码仍可用');
    assert(s4.unlock('new-pw-9999') === true, '新密码不可用');
  });

  check('图片保存与读取（id 为 32 位十六进制）', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const info = store.saveImage(png);
    assert(info && info.id, 'saveImage 未返回 id');
    assert(/^[0-9a-f]{32}$/.test(info.id), 'id 格式不对：' + JSON.stringify(info.id));
    assert(info.mime === 'image/png', 'mime 不对：' + info.mime);
    assert(store.readImage(info.id) === png, '读回的图片与原始不一致');
  });

  check('非法图片 id 被拒绝', () => {
    let threw = false;
    try { store.readImage('undefined'); } catch (e) { threw = true; }
    assert(threw, '非法 id 未被拒绝');
  });

  check('磁盘上不含明文', () => {
    const raw = fs.readFileSync(path.join(tempDir, 'entries.json'), 'utf8');
    assert(raw.indexOf('# 标题') === -1, 'entries.json 出现明文正文');
    assert(raw.indexOf('改过了') === -1, 'entries.json 出现明文正文');
    const vault = fs.readFileSync(path.join(tempDir, 'vault.json'), 'utf8');
    assert(vault.indexOf('pw-123456') === -1, 'vault.json 出现明文密码');
    assert(vault.indexOf('a2') === -1 || vault.indexOf('answerHash') !== -1, 'vault 结构异常');
  });

  check('备份导出与恢复', () => {
    const backup = store.exportBackup();
    assert(backup.format === 'citta-backup', '备份格式标识错误');
    assert(backup.entries.length >= 1, '备份没有内容');
    assert(Object.keys(backup.images).length >= 1, '备份未包含图片');

    store.deleteEntry('2024-05-01');
    assert(store.getEntry('2024-05-01') === null, '删除失败');
    const res = store.importBackup(backup, false);
    assert(res.entries >= 1, '恢复条目数为 0');
    assert(store.getEntry('2024-05-01').mood === 5, '恢复后数据不符');
  });

  check('合并导入不覆盖已有日期', () => {
    store.saveEntry('2024-05-01', { content: '本地版本', mood: 1, weather: '', event: '', tags: [], images: [] });
    const backup = {
      format: 'citta-backup', version: 1, entries: [
        { date: '2024-05-01', content: '备份版本', mood: 5, createdAt: '', updatedAt: '' },
        { date: '2024-06-01', content: '新增日期', mood: 3, createdAt: '', updatedAt: '' }
      ], images: {}
    };
    const r1 = store.importBackup(backup, true);
    assert(store.getEntry('2024-05-01').content === '本地版本', '合并导入覆盖了已有日期');
    assert(store.getEntry('2024-06-01') !== null, '合并导入未新增日期');
    assert(r1.entries === 1, '合并导入计数错误：' + r1.entries);
    const r2 = store.importBackup(backup, false);
    assert(store.getEntry('2024-05-01').content === '备份版本', '覆盖导入未生效');
    assert(r2.entries === 2, '覆盖导入计数错误：' + r2.entries);
  });

  check('无效备份文件被拒绝', () => {
    let threw = false;
    try { store.importBackup({ nope: true }, false); } catch (e) { threw = true; }
    assert(threw, '非法备份未被拒绝');
  });

  check('图片垃圾回收', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const a = store.saveImage(png);
    const b = store.saveImage(png);
    // 只让 a 被引用
    store.saveEntry('2024-07-01', { content: '![x](citta-img://' + a.id + ')', mood: 0, weather: '', event: '', tags: [], images: [a.id] });
    const removed = store.gcImages();
    assert(removed >= 1, '未清理无用图片');
    assert(store.readImage(a.id) !== null, '被引用的图片被误删');
    assert(store.readImage(b.id) === null, '未引用的图片未删除');
  });

  check('重置清空全部数据', () => {
    store.resetAll();
    assert(store.hasVault() === false, '密钥库未清除');
    assert(store.isUnlocked() === false, '仍处于解锁状态');
    assert(fs.existsSync(path.join(tempDir, 'entries.json')) === false, 'entries.json 未删除');
    const s5 = new Storage(tempDir);
    s5.init();
    assert(s5.hasVault() === false, '重新初始化后仍有密钥库');
    assert(s5.listEntries().length === 0, '仍有残留数据');
  });

  check('损坏的单条密文不影响其他日记', () => {
    const s6 = new Storage(tempDir);
    s6.init();
    s6.setup('pw-x-1234', [{ q: '1', a: '1' }, { q: '2', a: '2' }, { q: '3', a: '3' }]);
    s6.saveEntry('2024-01-01', { content: 'ok1', mood: 0, weather: '', event: '', tags: [], images: [] });
    s6.saveEntry('2024-01-02', { content: 'ok2', mood: 0, weather: '', event: '', tags: [], images: [] });
    s6.flush();
    // 破坏第二条密文
    const p = path.join(tempDir, 'entries.json');
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    raw.entries['2024-01-02'].data = 'AAAA:BBBB';
    fs.writeFileSync(p, JSON.stringify(raw), 'utf8');

    const s7 = new Storage(tempDir);
    s7.init();
    assert(s7.unlock('pw-x-1234'), '解锁失败');
    assert(s7.getEntry('2024-01-01').content === 'ok1', '完好日记读不到');
    assert(s7.getEntry('2024-01-02').error, '损坏日记未标记错误');
    assert(s7.listEntries().length === 2, '列表数量不对');
  });

  // 输出
  let failed = 0;
  for (const r of results) {
    if (r.ok) console.log('  ✓ ' + r.name);
    else { failed++; console.log('  ✗ ' + r.name + '\n      ' + r.err); }
  }
  console.log('\n存储/加密单元测试：' + (results.length - failed) + '/' + results.length + ' 通过');
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  app.exit(failed ? 1 : 0);
});
