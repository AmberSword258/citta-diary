'use strict';

/**
 * 观心 Citta —— 本地存储层
 *
 * 目录结构（位于 Electron 的 userData 下，全部离线）：
 *   vault.json     密钥库（口令/密保的校验信息与包裹后的主密钥）
 *   entries.json   日记密文集合（每条日记独立 IV）
 *   images/        图片密文（每张图独立 IV）
 *   backups/       备份导出目录（默认位置）
 *
 * 内存中只缓存解密后的日记；写盘时逐条加密，避免整体重写。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('./crypto');

class Storage {
  /** @param {string} baseDir Electron userData 目录 */
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.vaultPath = path.join(baseDir, 'vault.json');
    this.entriesPath = path.join(baseDir, 'entries.json');
    this.imagesDir = path.join(baseDir, 'images');
    this.backupsDir = path.join(baseDir, 'backups');

    /** @type {object|null} 密钥库 */
    this.vault = null;
    /** @type {Buffer|null} 主密钥（仅在已解锁时存在） */
    this.masterKey = null;
    /** @type {Map<string, object>} 已解密的日记缓存，key 为日期 'YYYY-MM-DD' */
    this.entries = new Map();
    /** 待写盘的节流句柄 */
    this._saveTimer = null;
    this._dirty = false;
  }

  // -------------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------------

  /** 初始化目录并读取密钥库 */
  init() {
    for (const dir of [this.baseDir, this.imagesDir, this.backupsDir]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(this.vaultPath)) {
      try {
        this.vault = JSON.parse(fs.readFileSync(this.vaultPath, 'utf8'));
      } catch (e) {
        this.vault = null;
      }
    }
    return { hasVault: !!this.vault, locked: !this.masterKey };
  }

  /** 是否已完成首次密码设置 */
  hasVault() {
    return !!this.vault;
  }

  /** 是否已解锁（主密钥在手） */
  isUnlocked() {
    return !!this.masterKey;
  }

  /** 首次设置密码：创建密钥库并解锁 */
  setup(password, questions) {
    if (this.vault) throw new Error('密码已设置');
    const { vault, masterKey } = crypto.createVault(password, questions);
    this.vault = vault;
    this.masterKey = masterKey;
    this._writeVault();
    this._writeEntries();
    return true;
  }

  /** 用密码解锁并载入日记 */
  unlock(password) {
    if (!this.vault) throw new Error('尚未设置密码');
    const mk = crypto.unlockWithPassword(this.vault, password);
    if (!mk) return false;
    this.masterKey = mk;
    this._loadEntries();
    return true;
  }

  /** 用密保答案解锁（找回密码） */
  unlockWithAnswer(index, answer) {
    if (!this.vault) throw new Error('尚未设置密码');
    const mk = crypto.unlockWithAnswer(this.vault, index, answer);
    if (!mk) return false;
    this.masterKey = mk;
    this._loadEntries();
    return true;
  }

  /** 锁定：清除内存中的密钥与明文 */
  lock() {
    this.masterKey = null;
    this.entries.clear();
    return true;
  }

  /** 取密保问题文本列表 */
  getQuestions() {
    if (!this.vault) return [];
    return this.vault.questions.map((q) => q.q);
  }

  /** 修改密码 */
  changePassword(oldPassword, newPassword) {
    if (!this.masterKey) throw new Error('未解锁');
    const check = crypto.unlockWithPassword(this.vault, oldPassword);
    if (!check) return false;
    this.vault = crypto.rewrapWithPassword(this.vault, this.masterKey, newPassword);
    this._writeVault();
    return true;
  }

  /** 用密保重置密码 */
  resetPasswordWithAnswer(index, answer, newPassword) {
    if (!this.vault) throw new Error('尚未设置密码');
    const mk = crypto.unlockWithAnswer(this.vault, index, answer);
    if (!mk) return false;
    this.masterKey = mk;
    this.vault = crypto.rewrapWithPassword(this.vault, mk, newPassword);
    this._writeVault();
    this._loadEntries();
    return true;
  }

  /** 更新密保问题（需已解锁并提供当前密码） */
  updateQuestions(password, questions) {
    if (!this.masterKey) throw new Error('未解锁');
    if (!crypto.unlockWithPassword(this.vault, password)) return false;
    this.vault = crypto.rewrapWithQuestions(this.vault, this.masterKey, questions);
    this._writeVault();
    return true;
  }

  /** 危险操作：清空全部本地数据（忘记密码且密保也遗忘时使用） */
  resetAll() {
    this.masterKey = null;
    this.entries.clear();
    for (const f of [this.vaultPath, this.entriesPath]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    if (fs.existsSync(this.imagesDir)) {
      fs.rmSync(this.imagesDir, { recursive: true, force: true });
      fs.mkdirSync(this.imagesDir, { recursive: true });
    }
    this.vault = null;
    return true;
  }

  // -------------------------------------------------------------------------
  // 日记读写
  // -------------------------------------------------------------------------

  /** 读取并解密全部日记到内存 */
  _loadEntries() {
    this.entries.clear();
    if (!fs.existsSync(this.entriesPath)) return;
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(this.entriesPath, 'utf8'));
    } catch (e) {
      return;
    }
    const list = (raw && raw.entries) || {};
    for (const date of Object.keys(list)) {
      const rec = list[date];
      try {
        const json = crypto.decryptWithKey(this.masterKey, rec.data);
        const entry = JSON.parse(json);
        entry.date = date;
        entry.createdAt = rec.createdAt || entry.createdAt;
        entry.updatedAt = rec.updatedAt || entry.updatedAt;
        this.entries.set(date, entry);
      } catch (e) {
        // 单条解密失败（例如密文损坏）不应影响其它日记
        this.entries.set(date, {
          date,
          error: '该日记解密失败，可能是文件损坏'
        });
      }
    }
  }

  /** 返回全部日记（按日期倒序） */
  listEntries() {
    const out = [];
    for (const e of this.entries.values()) out.push(e);
    out.sort((a, b) => (a.date < b.date ? 1 : -1));
    return out;
  }

  /** 取单篇 */
  getEntry(date) {
    return this.entries.get(date) || null;
  }

  /**
   * 保存日记（新增或覆盖）。
   * @param {string} date 'YYYY-MM-DD'
   * @param {object} data 日记内容（正文、心情、天气、大事、标签、图片等）
   */
  saveEntry(date, data) {
    if (!this.masterKey) throw new Error('未解锁');
    const now = new Date().toISOString();
    const prev = this.entries.get(date) || {};
    const entry = Object.assign({}, prev, data, {
      date,
      createdAt: prev.createdAt || now,
      updatedAt: now
    });
    this.entries.set(date, entry);
    this._scheduleSave();
    return entry;
  }

  /** 删除日记 */
  deleteEntry(date) {
    if (!this.masterKey) throw new Error('未解锁');
    const ok = this.entries.delete(date);
    if (ok) this._scheduleSave();
    return ok;
  }

  /** 批量导入（恢复备份时使用），merge 为 true 时不覆盖已有同日日记 */
  importEntries(list, merge) {
    if (!this.masterKey) throw new Error('未解锁');
    let count = 0;
    for (const e of list) {
      if (!e || !e.date) continue;
      if (merge && this.entries.has(e.date)) continue;
      this.entries.set(e.date, e);
      count++;
    }
    if (count) this._scheduleSave();
    return count;
  }

  /** 全量替换（从备份整体恢复） */
  replaceAll(list) {
    if (!this.masterKey) throw new Error('未解锁');
    this.entries.clear();
    for (const e of list) if (e && e.date) this.entries.set(e.date, e);
    this._scheduleSave();
    return this.entries.size;
  }

  // -------------------------------------------------------------------------
  // 图片
  // -------------------------------------------------------------------------

  /** 保存图片（传入 dataURL），返回图片 id */
  saveImage(dataURL) {
    if (!this.masterKey) throw new Error('未解锁');
    const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(String(dataURL || ''));
    if (!m) throw new Error('图片格式不支持');
    const mime = m[1];
    const buf = Buffer.from(m[2], 'base64');
    const id = crypto.randomHex(16);
    const payload = crypto.encryptWithKey(this.masterKey, buf.toString('base64'));
    fs.writeFileSync(path.join(this.imagesDir, id + '.bin'),
      JSON.stringify({ mime, data: payload }), 'utf8');
    return { id, mime, size: buf.length };
  }

  /** 读取图片并还原为 dataURL（按需调用，用于预览） */
  readImage(id) {
    if (!this.masterKey) throw new Error('未解锁');
    if (!/^[0-9a-f]{32}$/.test(String(id))) throw new Error('图片 id 非法');
    const p = path.join(this.imagesDir, id + '.bin');
    if (!fs.existsSync(p)) return null;
    const rec = JSON.parse(fs.readFileSync(p, 'utf8'));
    const b64 = crypto.decryptWithKey(this.masterKey, rec.data);
    return 'data:' + rec.mime + ';base64,' + b64;
  }

  /** 列出全部图片 id（导出备份时使用） */
  listImages() {
    if (!fs.existsSync(this.imagesDir)) return [];
    return fs.readdirSync(this.imagesDir)
      .filter((f) => f.endsWith('.bin'))
      .map((f) => f.replace(/\.bin$/, ''));
  }

  /** 删除未被任何日记引用的图片 */
  gcImages() {
    const used = new Set();
    for (const e of this.entries.values()) {
      for (const id of (e.images || [])) used.add(id);
      const inline = String(e.content || '').match(/citta-img:\/\/([0-9a-f]{32})/g) || [];
      for (const s of inline) used.add(s.replace('citta-img://', ''));
    }
    let removed = 0;
    for (const id of this.listImages()) {
      if (!used.has(id)) {
        fs.unlinkSync(path.join(this.imagesDir, id + '.bin'));
        removed++;
      }
    }
    return removed;
  }

  // -------------------------------------------------------------------------
  // 备份
  // -------------------------------------------------------------------------

  /**
   * 导出备份（明文 JSON，由调用方决定存放位置）。
   * 说明：备份文件本身是明文，便于跨设备迁移；若需加密可改用 exportEncrypted。
   */
  exportBackup() {
    if (!this.masterKey) throw new Error('未解锁');
    const images = {};
    for (const id of this.listImages()) {
      const d = this.readImage(id);
      if (d) images[id] = d;
    }
    return {
      format: 'citta-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      count: this.entries.size,
      entries: this.listEntries(),
      images
    };
  }

  /** 从备份 JSON 恢复 */
  importBackup(payload, merge) {
    if (!this.masterKey) throw new Error('未解锁');
    if (!payload || payload.format !== 'citta-backup' || !Array.isArray(payload.entries)) {
      throw new Error('不是有效的观心 Citta 备份文件');
    }
    // 先恢复图片
    let imgCount = 0;
    const images = payload.images || {};
    for (const id of Object.keys(images)) {
      if (!/^[0-9a-f]{32}$/.test(id)) continue;
      const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(images[id]);
      if (!m) continue;
      const enc = crypto.encryptWithKey(this.masterKey, m[2]);
      fs.writeFileSync(path.join(this.imagesDir, id + '.bin'),
        JSON.stringify({ mime: m[1], data: enc }), 'utf8');
      imgCount++;
    }
    const count = merge
      ? this.importEntries(payload.entries, true)
      : this.replaceAll(payload.entries);
    return { entries: count, images: imgCount };
  }

  // -------------------------------------------------------------------------
  // 写盘
  // -------------------------------------------------------------------------

  /** 节流写盘：多次连续保存只落盘一次 */
  _scheduleSave() {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.flush();
    }, 400);
  }

  /** 立即写盘 */
  flush() {
    if (!this._dirty) return false;
    this._writeEntries();
    this._dirty = false;
    return true;
  }

  _writeVault() {
    if (!this.vault) return;
    const tmp = this.vaultPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.vault, null, 1), 'utf8');
    fs.renameSync(tmp, this.vaultPath);
  }

  _writeEntries() {
    if (!this.masterKey) return;
    const out = { version: 1, updatedAt: new Date().toISOString(), entries: {} };
    for (const [date, entry] of this.entries) {
      const copy = Object.assign({}, entry);
      delete copy.error;
      out.entries[date] = {
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        data: crypto.encryptWithKey(this.masterKey, JSON.stringify(copy))
      };
    }
    const tmp = this.entriesPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out), 'utf8');
    fs.renameSync(tmp, this.entriesPath);
  }

  /** 统计信息（用于首屏概览） */
  stats() {
    const list = this.listEntries();
    let words = 0;
    const byMood = {};
    for (const e of list) {
      const text = String(e.content || '').replace(/\s/g, '');
      words += text.length;
      if (e.mood) byMood[e.mood] = (byMood[e.mood] || 0) + 1;
    }
    return { count: list.length, words, byMood, images: this.listImages().length };
  }
}

module.exports = { Storage };
