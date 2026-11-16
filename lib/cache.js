// ================================================================
//  lib/crypto.js — تشفير وفك تشفير البيانات الحساسة
//  - يستخدم خوارزمية AES-256-GCM
//  - يتطلب متغير بيئة ENCRYPTION_KEY (64 حرف hex = 32 بايت)
// ================================================================

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

// ============================================================
//  🔑 getEncryptionKey — قراءة المفتاح من متغيرات البيئة
// ============================================================
function getEncryptionKey() {
  const keyHex = String(process.env.ENCRYPTION_KEY || '').trim();
  if (!keyHex || keyHex.length !== 64) {
    console.warn('⚠️ [crypto] ENCRYPTION_KEY غير موجود أو غير صالح (يجب أن يكون 64 حرف hex). سيتم تعطيل التشفير.');
    return null;
  }
  return Buffer.from(keyHex, 'hex');
}

// ============================================================
//  🔐 encrypt — تشفير النص
//  - يعيد النص بصيغة: iv_hex:authTag_hex:encryptedData_hex
//  - إذا كان النص فارغاً أو المفتاح غير متوفر، يعيد النص كما هو
// ============================================================
export function encrypt(text) {
  if (text === undefined || text === null) return text;
  const str = String(text);
  if (str.trim() === '') return str;

  const key = getEncryptionKey();
  if (!key) return str; // Fail open (إذا لم يوجد مفتاح، نخزن النص كما هو)

  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(str, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');

    // الصيغة النهائية
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (error) {
    console.error('[crypto] encrypt exception:', error.message);
    return str; // في حال الفشل، نخزن النص كما هو
  }
}

// ============================================================
//  🔓 decrypt — فك تشفير النص
//  - إذا كان النص غير مشفر (لا يحتوي على :)، يعيده كما هو
// ============================================================
export function decrypt(text) {
  if (text === undefined || text === null) return text;
  const str = String(text);
  if (str.trim() === '') return str;

  const key = getEncryptionKey();
  if (!key) return str;

  // التحقق مما إذا كان النص مشفراً بناءً على الصيغة (iv:tag:data)
  const parts = str.split(':');
  if (parts.length !== 3) {
    return str; // البيانات قديمة وغير مشفرة
  }

  try {
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    // إذا فشل فك التشفير، فهذا يعني أن البيانات قد تكون غير مشفرة أو المفتاح تغير
    console.warn('[crypto] decrypt failed (fallback to original text):', error.message);
    return str;
  }
}