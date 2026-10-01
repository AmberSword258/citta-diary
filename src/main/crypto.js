'use strict';

/**
 * 观心 Citta —— 加密模块
 *
 * 设计要点（本地优先 + 隐私保护）：
 *  1. 生成一个随机的「主密钥」(MK)，所有日记与图片都用它做 AES-256-GCM 加密。
 *  2. MK 本身被「口令密钥」(PWK) 包裹（AES-256-GCM）后存盘；
 *     口令密钥由用户密码经 scrypt 派生。这样改密码只需重新包裹 MK，无需重加密全部数据。
 *  3. 三个密保答案各自派生一把「找回密钥」(RWK)，同样包裹一份 MK 副本。
 *     答对任一密保问题即可解出 MK，从而重置密码。
 *  4. 重置（忘记密码且密保也遗忘）会清空全部本地数据，并给出明确提示。
 *
 * 所有密钥只存在于内存中，进程退出即消失；磁盘上永远只有密文。
 */

const crypto = require('crypto');

const SCRYPT_N = 16384;   // CPU/内存开销参数
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;       // AES-256
const IV_LEN = 12;        // GCM 推荐 96 bit
const TAG_LEN = 16;

/** 生成随机字节的 hex 串 */
function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** 由密码与 salt 派生 32 字节密钥 */
function deriveKey(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.scryptSync(Buffer.from(password, 'utf8'), salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 256 * 1024 * 1024
  });
}

/** AES-256-GCM 加密，返回 base64(iv)：base64(tag+data) 形式 */
function encryptWithKey(key, plaintext) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('base64') + ':' + Buffer.concat([tag, data]).toString('base64');
}

/** AES-256-GCM 解密；密文被篡改或密钥错误时抛异常 */
function decryptWithKey(key, payload) {
  const [ivB64, bodyB64] = String(payload).split(':');
  if (!ivB64 || !bodyB64) throw new Error('密文格式错误');
  const iv = Buffer.from(ivB64, 'base64');
  const body = Buffer.from(bodyB64, 'base64');
  const tag = body.subarray(0, TAG_LEN);
  const data = body.subarray(TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** 对密保答案做规范化（去空格、转小写），避免用户输入差异导致找回失败 */
function normalizeAnswer(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '');
}

/** 口令/答案的验证用哈希（只用于校验，不用于加密） */
function hashSecret(secret, saltHex) {
  const dk = deriveKey(secret, saltHex);
  return crypto.createHash('sha256').update(dk).digest('hex');
}

/**
 * 创建新的密钥库结构。
 * @returns {{vault:object, masterKey:Buffer}}
 */
function createVault(password, questions) {
  const masterKey = crypto.randomBytes(KEY_LEN);
  const pwSalt = randomHex(16);
  const pwKey = deriveKey(password, pwSalt);

  const vault = {
    version: 1,
    kdf: { algo: 'scrypt', N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, keyLen: KEY_LEN },
    // 口令校验哈希（与包裹用的派生密钥同源，但界面只暴露哈希）
    pwSalt,
    pwCheck: hashSecret(password, pwSalt + 'check'),
    // 用口令密钥包裹主密钥
    wrappedByPassword: encryptWithKey(pwKey, masterKey.toString('base64')),
    // 密保问题（仅存问题文本与答案哈希，不存答案明文）
    questions: (questions || []).map((q) => {
      const salt = randomHex(16);
      return {
        q: q.q,
        salt,
        answerHash: hashSecret(normalizeAnswer(q.a), salt),
        // 用「答案派生密钥」包裹一份主密钥（密保找回时使用）
        wrapped: encryptWithKey(deriveKey(normalizeAnswer(q.a), salt), masterKey.toString('base64'))
      };
    }),
    createdAt: new Date().toISOString()
  };
  return { vault, masterKey };
}

/** 用密码解锁，返回主密钥；密码错误返回 null */
function unlockWithPassword(vault, password) {
  try {
    if (hashSecret(password, vault.pwSalt + 'check') !== vault.pwCheck) return null;
    const pwKey = deriveKey(password, vault.pwSalt);
    const mkB64 = decryptWithKey(pwKey, vault.wrappedByPassword);
    return Buffer.from(mkB64, 'base64');
  } catch (e) {
    return null;
  }
}

/** 校验某个密保答案是否正确 */
function checkAnswer(vault, index, answer) {
  const item = vault.questions[index];
  if (!item) return false;
  return hashSecret(normalizeAnswer(answer), item.salt) === item.answerHash;
}

/** 用密保答案取出主密钥 */
function unlockWithAnswer(vault, index, answer) {
  const item = vault.questions[index];
  if (!item) return null;
  if (!checkAnswer(vault, index, answer)) return null;
  try {
    const key = deriveKey(normalizeAnswer(answer), item.salt);
    const mkB64 = decryptWithKey(key, item.wrapped);
    return Buffer.from(mkB64, 'base64');
  } catch (e) {
    return null;
  }
}

/** 修改密码：仅重新包裹主密钥，数据无需重加密 */
function rewrapWithPassword(vault, masterKey, newPassword) {
  const pwSalt = randomHex(16);
  const pwKey = deriveKey(newPassword, pwSalt);
  vault.pwSalt = pwSalt;
  vault.pwCheck = hashSecret(newPassword, pwSalt + 'check');
  vault.wrappedByPassword = encryptWithKey(pwKey, masterKey.toString('base64'));
  vault.updatedAt = new Date().toISOString();
  return vault;
}

/** 重新设置密保问题（同样只重新包裹主密钥） */
function rewrapWithQuestions(vault, masterKey, questions) {
  vault.questions = (questions || []).map((q) => {
    const salt = randomHex(16);
    return {
      q: q.q,
      salt,
      answerHash: hashSecret(normalizeAnswer(q.a), salt),
      wrapped: encryptWithKey(deriveKey(normalizeAnswer(q.a), salt), masterKey.toString('base64'))
    };
  });
  return vault;
}

module.exports = {
  KEY_LEN,
  randomHex,
  deriveKey,
  encryptWithKey,
  decryptWithKey,
  normalizeAnswer,
  hashSecret,
  createVault,
  unlockWithPassword,
  checkAnswer,
  unlockWithAnswer,
  rewrapWithPassword,
  rewrapWithQuestions
};
