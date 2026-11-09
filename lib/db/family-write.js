// ================================================================
//  lib/db/family-write.js — دوال كتابة لوحة الأسرة (Supabase)
//  - Auth (Login + Session + Rate Limiting)
//  - Disable / Enable Account
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN, COLS_FACE } from './tables.js';
import { sendFamilyResetEmail, sendFaceDataChangeEmail } from '../email/brevo.js';
import { notifyFamily } from '../notify.js';
import { saveFaceFeatures, saveFaceFeaturesFromFamily } from './face.js';
import { generateShortCode } from '../telegram.js';
import { validateMarketerCode } from './marketer-read.js';

// ============================================================
//  🕐 توقيت مصر
// ============================================================
function nowEgypt() {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).replace('T', ' ');
}

function toEgypt(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).replace('T', ' ');
}

function futureEgypt(minutes) {
  const future = new Date(Date.now() + minutes * 60 * 1000);
  return toEgypt(future);
}

// ============================================================
//  🔐 دوال الباسوورد
// ============================================================
export function hashFamilyPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Invalid password');
  }
  const salt = crypto.randomBytes(12).toString('hex').substring(0, 16);
  const digest = crypto.createHash('sha256').update(salt + password).digest('base64');
  return salt + '$' + digest;
}

export function verifyFamilyPassword(password, storedHash) {
  if (!password || !storedHash) return false;
  const strHash = String(storedHash).trim();

  if (strHash.indexOf('$') !== -1) {
    const parts = strHash.split('$');
    if (parts.length !== 2) return false;
    const salt = parts[0];
    const expectedHash = parts[1];
    const inputHash = crypto.createHash('sha256').update(salt + password).digest('base64');
    return inputHash === expectedHash;
  }

  const legacyHash = crypto.createHash('sha256').update(password).digest('base64');
  return legacyHash === strHash;
}

export function validatePasswordStrength(password) {
  const errors = [];
  if (!password || typeof password !== 'string') {
    return { valid: false, errors: ['كلمة السر مطلوبة'] };
  }
  if (password.length < 8) errors.push('يجب 8 حروف على الأقل');
  if (!/[A-Za-z]/.test(password)) errors.push('يجب أن تحتوي على حرف إنجليزي واحد على الأقل (A-Z)');
  if (!/[0-9]/.test(password)) errors.push('يجب أن تحتوي على رقم واحد على الأقل');
  const SPECIAL_CHARS = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/;
  if (!SPECIAL_CHARS.test(password)) errors.push('يجب أن تحتوي على رمز خاص (@ # $ % ! ... إلخ)');
  if (/[\u0600-\u06FF]/.test(password)) errors.push('يجب أن تكون كلمة السر بحروف إنجليزية فقط');
  return { valid: errors.length === 0, errors };
}

// ============================================================
//  Constants
// ============================================================
const FAMILY_SESSION_DURATION_MIN = 30;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MIN = 30;
const LOGIN_LOCK_DURATION_MIN = 30;
const FAMILY_RESET_TOKEN_EXPIRY_MIN = 5;
const FAMILY_FORGOT_MAX_ATTEMPTS = 10;
const FAMILY_FORGOT_WINDOW_SEC = 3600;

// ============================================================
//  🔑 Session Token Generator
// ============================================================
function generateSessionToken() {
  const uuid1 = crypto.randomUUID().replace(/-/g, '');
  const uuid2 = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
  return uuid1 + uuid2; // 48 chars
}

// ============================================================
//  📅 Date aliases — ⚠️ الأسماء دي legacy من GAS
//  nowISO() بيرجّع Cairo format "2026-11-07 15:30:45" (مش ISO حقيقي)
//  futureISO(m) نفس الحكاية
//  في #7 هيتم تحويلهم لـ UTC ISO
// ============================================================
function nowISO() {
  return nowEgypt();
}

function futureISO(minutes) {
  return futureEgypt(minutes);
}

// ============================================================
//  Helper: التحقق من الجلسة
// ============================================================
async function getSessionChild(sessionToken) {
  if (!sessionToken) return null;

  const { data, error } = await supabaseAdmin
    .from(TABLES.FAMILY_SESSIONS)
    .select('session_token,child_id,status')
    .eq('session_token', sessionToken)
    .maybeSingle();

  if (error || !data) return null;

  const status = String(data.status || '').trim().toLowerCase();
  if (status !== 'active') return null;

  return String(data.child_id || '').trim();
}

// ============================================================
//  Helper: إنهاء الجلسات الأخرى
// ============================================================
async function terminateOtherSessions(childID, currentSessionToken) {
  try {
    let query = supabaseAdmin
      .from(TABLES.FAMILY_SESSIONS)
      .update({ status: 'logged_out' })
      .eq('child_id', childID)
      .eq('status', 'active');

    if (currentSessionToken) {
      query = query.neq('session_token', currentSessionToken);
    }

    const { error } = await query;
    if (error) {
      console.error('⚠️ [terminateOtherSessions]', error.message);
    }
  } catch (e) {
    console.error('⚠️ [terminateOtherSessions]', e.message);
  }
}

// ============================================================
//  Helper: إنهاء كل الجلسات (بما فيها الحالية)
// ============================================================
async function terminateAllSessions(childID) {
  try {
    const { error } = await supabaseAdmin
      .from(TABLES.FAMILY_SESSIONS)
      .update({ status: 'logged_out' })
      .eq('child_id', childID)
      .eq('status', 'active');

    if (error) {
      console.error('⚠️ [terminateAllSessions]', error.message);
      return { success: false, error: error.message };
    }

    console.log(`🔒 [terminateAllSessions] تم إنهاء كل جلسات: ${childID}`);
    return { success: true };
  } catch (e) {
    console.error('⚠️ [terminateAllSessions]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🧹 Helper: تنظيف الجلسات المنتهية
//  - بتتنادى عند إنشاء جلسة جديدة
//  - بتحوّل كل الجلسات المنتهية لـ status = 'expired'
// ============================================================
async function cleanupExpiredSessions(childID) {
  if (!childID) return;

  try {
    const nowStr = nowEgypt();   // "2026-10-07 22:47:00"

    const { error } = await supabaseAdmin
      .from(TABLES.FAMILY_SESSIONS)
      .update({ status: 'expired' })
      .eq('child_id', childID)
      .eq('status', 'active')
      .lt('expires_at', nowStr);

    if (error) {
      console.warn('⚠️ [cleanupExpiredSessions]', error.message);
    } else {
      console.log(`🧹 [cleanupExpiredSessions] تم تنظيف جلسات ${childID}`);
    }
  } catch (e) {
    console.warn('⚠️ [cleanupExpiredSessions]', e.message);
  }
}

// ============================================================
//  Helper: تحديث بصمة الوجه
// ============================================================
async function updateFaceActive(childID, isActive) {
  try {
    const value = isActive ? 'نعم' : 'لا';
    const { error } = await supabaseAdmin
      .from(TABLES.FACE_FEATURES)
      .update({ is_active: value, updated_at: nowISO() })
      .eq(COLS_FACE.child_id, childID);

    if (error) {
      console.error('⚠️ [updateFaceActive]', error.message);
    }
  } catch (e) {
    console.error('⚠️ [updateFaceActive]', e.message);
  }
}

// ============================================================
//  🚦 Rate Limiting — CheckLoginAttempts
// ============================================================
async function checkLoginAttempts(childID) {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.LOGIN_ATTEMPTS)
      .select('*')
      .eq('child_id', childID)
      .maybeSingle();

    if (error) {
      console.error('⚠️ [checkLoginAttempts]', error.message);
      return { allowed: true, remaining: LOGIN_MAX_ATTEMPTS };
    }

    if (!data) {
      return { allowed: true, remaining: LOGIN_MAX_ATTEMPTS };
    }

    const now = Date.now();
    const count = Number(data.attempt_count) || 0;
    const firstAttempt = data.first_attempt_at ? new Date(data.first_attempt_at).getTime() : 0;
    const lockedUntil = data.locked_until ? new Date(data.locked_until).getTime() : 0;

    // لو مقفول
    if (lockedUntil && now < lockedUntil) {
      const remainingMin = Math.ceil((lockedUntil - now) / 60000);
      return {
        allowed: false,
        locked_until: new Date(lockedUntil),
        remaining_min: remainingMin,
        message: 'تم قفل الحساب مؤقتاً. حاول بعد ' + remainingMin + ' دقيقة.'
      };
    }

    // لو القفل انتهى
    if (lockedUntil && now >= lockedUntil) {
      await resetLoginAttempts(childID);
      return { allowed: true, remaining: LOGIN_MAX_ATTEMPTS };
    }

    // لو في النافذة
    if (firstAttempt && (now - firstAttempt) < LOGIN_WINDOW_MIN * 60 * 1000) {
      const remaining = LOGIN_MAX_ATTEMPTS - count;
      return {
        allowed: remaining > 0,
        remaining: Math.max(0, remaining),
        message: remaining > 0 ? null : 'تجاوزت الحد المسموح.'
      };
    }

    // النافذة خلصت → صفّر
    return { allowed: true, remaining: LOGIN_MAX_ATTEMPTS };
  } catch (e) {
    console.error('❌ [checkLoginAttempts]', e.message);
    return { allowed: true, remaining: LOGIN_MAX_ATTEMPTS };
  }
}

async function recordLoginAttempt(childID, success) {
  try {
    if (success) {
      await resetLoginAttempts(childID);
      return { success: true, action: 'reset' };
    }

    const now = Date.now();

    // اقرأ الحالة الحالية
    const { data } = await supabaseAdmin
      .from(TABLES.LOGIN_ATTEMPTS)
      .select('*')
      .eq('child_id', childID)
      .maybeSingle();

    let count = 1;
    let firstAttempt = now;

    if (data) {
      count = (Number(data.attempt_count) || 0) + 1;
      firstAttempt = data.first_attempt_at ? new Date(data.first_attempt_at).getTime() : now;
    }

    let lockedUntil = null;
      if (count >= LOGIN_MAX_ATTEMPTS) {
      lockedUntil = futureEgypt(LOGIN_LOCK_DURATION_MIN);
    }

    const row = {
      child_id: childID,
      attempt_count: count,
      first_attempt_at: toEgypt(firstAttempt),
      last_attempt_at: toEgypt(now),
      locked_until: lockedUntil
    };

    if (data) {
      await supabaseAdmin
        .from(TABLES.LOGIN_ATTEMPTS)
        .update(row)
        .eq('child_id', childID);
    } else {
      await supabaseAdmin
        .from(TABLES.LOGIN_ATTEMPTS)
        .insert(row);
    }

    console.log(`📝 [LoginAttempt] ${childID} → ${count}/${LOGIN_MAX_ATTEMPTS}` + (lockedUntil ? ' 🔒' : ''));

    return {
      success: true,
      action: 'incremented',
      count: count,
      remaining: Math.max(0, LOGIN_MAX_ATTEMPTS - count),
      locked: !!lockedUntil
    };
  } catch (e) {
    console.error('❌ [recordLoginAttempt]', e.message);
    return { success: false, error: e.message };
  }
}

async function resetLoginAttempts(childID) {
  try {
    await supabaseAdmin
      .from(TABLES.LOGIN_ATTEMPTS)
      .delete()
      .eq('child_id', childID);
    return { success: true };
  } catch (e) {
    console.error('❌ [resetLoginAttempts]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🔐 OTP لفك ربط تليجرام
//  - generateOTP: 6 أرقام
//  - requestUnlinkOTP: إرسال OTP على تليجرام الوالد نفسه
//  - verifyUnlinkOTP: التحقق من OTP
// ============================================================

function generateOTP() {
  // 6 أرقام من 0-9
  return String(Math.floor(100000 + Math.random() * 900000));
}

const UNLINK_OTP_EXPIRY_MIN = 5;
const UNLINK_OTP_MAX_ATTEMPTS = 3;

// ============================================================
//  📩 requestUnlinkOTP — إرسال OTP لفك ربط تليجرام
//  - يتحقق إن الوالد مربوط
//  - يولّد OTP 6 أرقام
//  - يخزّنه في UnlinkOTPs (صلاحية 5 دقايق)
//  - يبعته على تليجرام الوالد
// ============================================================
export async function requestUnlinkOTP(params) {
  const cleanID = String(params.childID || '').trim().toUpperCase();
  const cleanParent = String(params.parentType || '').trim().toLowerCase();

  if (!cleanID) {
    return { success: false, error: 'كود الطفل مطلوب' };
  }
  if (!['father', 'mother'].includes(cleanParent)) {
    return { success: false, error: 'نوع الوالد غير صالح' };
  }

  const t0 = Date.now();

  // 1. جيب الطفل
  const { data: child, error: childError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (childError) {
    console.error(`❌ [requestUnlinkOTP] ${cleanID} (${Date.now() - t0}ms)`, childError.message);
    return { success: false, error: childError.message };
  }
  if (!child) {
    return { success: false, error: 'الطفل غير موجود' };
  }

  // 2. جيب chat_id للوالد
  const chatIdField = cleanParent === 'father'
    ? COLS_CHILDREN.telegram_chat_id_father
    : COLS_CHILDREN.telegram_chat_id_mother;

  const chatId = String(child[chatIdField] || '').trim();
  if (!chatId) {
    const label = cleanParent === 'father' ? 'الأب' : 'الأم';
    console.log(`⚠️ [requestUnlinkOTP] ${cleanID} — ${label} مش مربوط`);
    return { success: false, error: `حساب ${label} غير مربوط بتليجرام` };
  }

  // 3. امسح أي OTP قديم غير مستخدم لنفس الوالد (يخليه used = true)
  try {
    await supabaseAdmin
      .from(TABLES.UNLINK_OTPS)
      .update({ used: 'true' })
      .eq('child_id', cleanID)
      .eq('parent_type', cleanParent)
      .eq('used', 'false');
  } catch (e) {
    console.warn('⚠️ [requestUnlinkOTP] فشل مسح OTP القديم:', e.message);
  }

  // 3.5 ✅ نظّف كل الـ OTPs المنتهية (أي طفل) — تحويل used = true
  try {
    const nowUtc = new Date().toISOString();
    await supabaseAdmin
      .from(TABLES.UNLINK_OTPS)
      .update({ used: 'true' })
      .eq('used', 'false')
      .lt('expires_at', nowUtc);
    console.log(`🧹 [requestUnlinkOTP] cleanup expired OTPs (before: ${nowUtc})`);
  } catch (e) {
    console.warn('⚠️ [requestUnlinkOTP] cleanup expired:', e.message);
  }

  // 4. ولّد OTP + احسب وقت الانتهاء
  const otp = generateOTP();
  const expiresAt = futureEgypt(UNLINK_OTP_EXPIRY_MIN);

  // 5. خزّنه في Supabase
  const { error: insertError } = await supabaseAdmin
    .from(TABLES.UNLINK_OTPS)
    .insert({
      child_id: cleanID,
      parent_type: cleanParent,
      otp_code: otp,
      expires_at: expiresAt,
      used: 'false',
      attempts: 0,
      created_at: nowEgypt()   // ✅ وقت القاهرة
    });

  if (insertError) {
    console.error(`❌ [requestUnlinkOTP] insert (${Date.now() - t0}ms)`, insertError.message);
    return { success: false, error: 'فشل توليد رمز التحقق' };
  }

  // 6. ابعت OTP على تليجرام
  const { sendViaTelegram } = await import('../telegram.js');
  const parentLabel = cleanParent === 'father' ? 'الأب' : 'الأم';
  const childName = String(child[COLS_CHILDREN.child_name] || cleanID).trim();

  const message =
    `🔐 <b>رمز التحقق لفك ربط تليجرام</b>\n\n` +
    `👶 الطفل: <b>${childName}</b>\n` +
    `📱 الوالد: <b>${parentLabel}</b>\n\n` +
    `الرمز: <code>${otp}</code>\n\n` +
    `⏱️ صالح لمدة <b>${UNLINK_OTP_EXPIRY_MIN} دقائق</b>\n` +
    `⚠️ لا تشارك هذا الرمز مع أي شخص.\n\n` +
    'إذا لم تكن أنت من طلب فك الربط، يرجى التواصل مع الدعم فوراً.';

  const sendResult = await sendViaTelegram(chatId, message);

  if (!sendResult.success) {
    console.error(`❌ [requestUnlinkOTP] فشل إرسال تليجرام (${Date.now() - t0}ms):`, sendResult.error);
    // امسح الـ OTP لأن الإرسال فشل
    try {
      await supabaseAdmin
        .from(TABLES.UNLINK_OTPS)
        .update({ used: 'true' })
        .eq('child_id', cleanID)
        .eq('parent_type', cleanParent)
        .eq('otp_code', otp)
        .eq('used', 'false');
    } catch (e) {}
    return { success: false, error: 'فشل إرسال الرمز على تليجرام. حاول مرة أخرى.' };
  }

  console.log(`✅ [requestUnlinkOTP] ${cleanID} | ${cleanParent} | OTP sent (${Date.now() - t0}ms)`);

  return {
    success: true,
    parentType: cleanParent,
    expiresAt: expiresAt,
    expiryMinutes: UNLINK_OTP_EXPIRY_MIN,
    message: `تم إرسال رمز التحقق على تليجرام ${parentLabel}`
  };
}

// ============================================================
//  🚦 Rate Limiting خاص بـ Forgot Password
//  (منفصل عن LoginAttempts)
// ============================================================

// فحص + زيادة العدّاد (Passive)
async function checkPasswordResetAttempts(childID) {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.PASSWORD_RESET_ATTEMPTS)
      .select('*')
      .eq('child_id', childID)
      .maybeSingle();

    if (error) {
      console.error('⚠️ [checkPasswordResetAttempts]', error.message);
      // فشل القراءة → نسمح (Fail Open)
      return { allowed: true, count: 0 };
    }

    const now = Date.now();
    const WINDOW_MS = FAMILY_FORGOT_WINDOW_SEC * 1000;

    // مفيش سجل → أول محاولة
    if (!data) {
      await supabaseAdmin
        .from(TABLES.PASSWORD_RESET_ATTEMPTS)
        .insert({
          child_id: childID,
          attempt_count: '1',
          first_attempt_at: toEgypt(now),
          last_attempt_at: toEgypt(now),
          locked_until: null
        });
      return { allowed: true, count: 1 };
    }

    const count = parseInt(data.attempt_count || '0', 10);
    const firstAt = data.first_attempt_at ? new Date(data.first_attempt_at).getTime() : 0;

    // ✅ لو النافذة انتهت (أكتر من ساعة) → صفّر وابدأ من جديد
    if (!firstAt || (now - firstAt) > WINDOW_MS) {
      await supabaseAdmin
        .from(TABLES.PASSWORD_RESET_ATTEMPTS)
        .update({
          attempt_count: '1',
          first_attempt_at: toEgypt(now),
          last_attempt_at: toEgypt(now),
          locked_until: null
        })
        .eq('child_id', childID);
      return { allowed: true, count: 1 };
    }

    // ✅ جوه النافذة → زوّد العدّاد
    const newCount = count + 1;
    const allowed = newCount <= FAMILY_FORGOT_MAX_ATTEMPTS;

    await supabaseAdmin
      .from(TABLES.PASSWORD_RESET_ATTEMPTS)
      .update({
        attempt_count: String(newCount),
        last_attempt_at: new Date(now).toISOString(),
        locked_until: allowed
          ? null
          : new Date(firstAt + WINDOW_MS).toISOString()
      })
      .eq('child_id', childID);

    return { allowed: allowed, count: newCount };
  } catch (e) {
    console.error('❌ [checkPasswordResetAttempts]', e.message);
    // Fail Open — لو في خطأ، اسمح
    return { allowed: true, count: 0 };
  }
}

// ============================================================
//  1️⃣ createFamilySession (Internal)
// ============================================================
export async function createFamilySession(childID) {
  // 🧹 نظّف الجلسات المنتهية القديمة قبل إنشاء الجلسة الجديدة
  await cleanupExpiredSessions(childID);

  const token = generateSessionToken();
  const now = nowISO();
  const expiresAt = futureISO(FAMILY_SESSION_DURATION_MIN);

  const { error } = await supabaseAdmin
    .from(TABLES.FAMILY_SESSIONS)
    .insert({
      session_token: token,
      child_id: childID,
      created_at: now,
      expires_at: expiresAt,
      last_activity_at: now,
      status: 'active'
    });

  if (error) {
    console.error('❌ [createFamilySession]', error.message);
    return { success: false, error: error.message };
  }

  console.log(`✅ [createFamilySession] ${childID} | expires: ${expiresAt}`);

  return {
    success: true,
    session_token: token,
    expires_at: expiresAt,
    duration_min: FAMILY_SESSION_DURATION_MIN
  };
}

// ============================================================
//  2️⃣ familyLogin
// ============================================================
export async function familyLogin(params) {
  const childID = String(params.childID || '').trim().toUpperCase();
  const password = String(params.password || '').trim();
  const email = String(params.email || '').trim().toLowerCase();

  if (!childID) {
    return { success: false, mode: 'error', error: 'كود الطفل مطلوب' };
  }

  const t0 = Date.now();

  // 1. Rate limiting
  const rateCheck = await checkLoginAttempts(childID);
  if (!rateCheck.allowed) {
    return {
      success: false,
      mode: 'error',
      error: rateCheck.message,
      locked: true,
      locked_until: rateCheck.locked_until
    };
  }

  // 2. جيب الطفل
  const { data: child, error: childError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.child_id, childID)
    .maybeSingle();

  if (childError) {
    console.error(`❌ [familyLogin] ${childID} (${Date.now() - t0}ms)`, childError.message);
    return { success: false, mode: 'error', error: childError.message };
  }

  if (!child) {
    await recordLoginAttempt(childID, false);
    console.log(`❌ [familyLogin] ${childID} NOT FOUND (${Date.now() - t0}ms)`);
    return { success: false, mode: 'error', error: 'كود الطفل غير موجود' };
  }

  const status = String(child[COLS_CHILDREN.status] || '').trim().toLowerCase();
  const storedEmail = String(child[COLS_CHILDREN.email_code] || '').trim().toLowerCase();
  const storedHash = String(child[COLS_CHILDREN.family_password_hash] || '').trim();

  // 3. فحص المحذوف
  if (status === 'deleted') {
    await recordLoginAttempt(childID, false);
    console.log(`❌ [familyLogin] ${childID} DELETED (${Date.now() - t0}ms)`);
    return {
      success: false,
      mode: 'error',
      error: 'هذا الحساب تم حذفه. للاستفسار تواصل مع الدعم.',
      deleted: true
    };
  }

  // 4. Login Mode (فيه كلمة السر)
  if (storedHash) {
    if (!password) {
      await recordLoginAttempt(childID, false);
      return { success: false, mode: 'error', error: 'كلمة السر مطلوبة' };
    }

    if (!verifyFamilyPassword(password, storedHash)) {
      const rec = await recordLoginAttempt(childID, false);
      console.log(`❌ [familyLogin] ${childID} WRONG PWD (${Date.now() - t0}ms)`);
      return {
        success: false,
        mode: 'error',
        error: 'كلمة السر غير صحيحة',
        remaining_attempts: rec.remaining || 0
      };
    }

    // نجاح — امسح العدّاد
    await resetLoginAttempts(childID);

    // أنشئ جلسة
    const session = await createFamilySession(childID);
    if (!session.success) {
      return { success: false, mode: 'error', error: 'فشل إنشاء الجلسة: ' + session.error };
    }

    console.log(`✅ [familyLogin] ${childID} LOGIN (${Date.now() - t0}ms)`);

    return {
      success: true,
      mode: 'login',
      session_token: session.session_token,
      expires_at: session.expires_at,
      child_id: childID,
      duration_min: session.duration_min
    };
  }

  // 5. Migration Mode (مفيش كلمة سر)
  if (!email) {
    await recordLoginAttempt(childID, false);
    return {
      success: false,
      mode: 'migration',
      requires_password_setup: true,
      error: 'لم يتم تعيين كلمة سر بعد. أدخل البريد الالكتروني المسجل لإنشاء كلمة سر جديدة.'
    };
  }

  if (email !== storedEmail) {
    const rec = await recordLoginAttempt(childID, false);
    return {
      success: false,
      mode: 'migration',
      requires_password_setup: true,
      error: 'البريد الالكتروني غير مطابق للسجل',
      remaining_attempts: rec.remaining || 0
    };
  }

  console.log(`🔓 [familyLogin] ${childID} MIGRATION MODE (${Date.now() - t0}ms)`);

  return {
    success: true,
    mode: 'migration',
    child_id: childID,
    requires_password_setup: true,
    message: 'البريد الالكتروني صحيح. قم بتعيين كلمة سر جديدة للحساب.',
    password_rules: {
      min_length: 8,
      requires_letters: true,
      requires_numbers: true,
      requires_symbols: true
    }
  };
}

// ============================================================
//  5️⃣ familyLogout — إنهاء جلسة واحدة
// ============================================================
export async function familyLogout(params) {
  // 1. نجيب التوكن من الباراميترز (بنقبل اسمين للاحتياط)
  const sessionToken = String(params.session || params.sessionToken || '').trim();

  // 2. لو مفيش توكن → نرجع خطأ
  if (!sessionToken) {
    return { success: false, error: 'session_token مطلوب' };
  }

  const t0 = Date.now();

  // 3. نعدّل في جدول FamilySessions:
  //    - status يبقى 'logged_out'
  //    - بس للصف اللي session_token = التوكن بتاعنا
  const { error } = await supabaseAdmin
    .from(TABLES.FAMILY_SESSIONS)
    .update({ status: 'logged_out' })
    .eq('session_token', sessionToken);

  // 4. لو حصل خطأ في Supabase
  if (error) {
    console.error(`❌ [familyLogout] (${Date.now() - t0}ms)`, error.message);
    return { success: false, error: error.message };
  }

  console.log(`✅ [familyLogout] (${Date.now() - t0}ms)`);

  // 5. نجاح
  return { success: true, message: 'تم تسجيل الخروج' };
}

// ============================================================
//  3️⃣ disableChildAccount
// ============================================================
export async function disableChildAccount(params) {
  const cleanID = String(params.childID || '').trim().toUpperCase();
  const password = String(params.password || '').trim();
  const sessionToken = String(params.session || '').trim();

  if (!cleanID || !password) {
    return { success: false, error: 'البيانات ناقصة' };
  }

  const t0 = Date.now();

  if (sessionToken) {
    const sessionChild = await getSessionChild(sessionToken);
    if (!sessionChild || sessionChild !== cleanID) {
      return { success: false, error: 'الجلسة غير صالحة' };
    }
  }

  const { data: child, error: childError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (childError) return { success: false, error: childError.message };
  if (!child) return { success: false, error: 'الطفل غير موجود' };

  const statusRaw = String(child[COLS_CHILDREN.status] || '').trim().toLowerCase();
  if (statusRaw === 'deleted') return { success: false, error: 'الحساب محذوف — لا يمكن تعطيله' };
  if (statusRaw === 'disabled') return { success: false, error: 'الحساب معطّل بالفعل' };
  if (statusRaw === 'pending') return {
    success: false,
    error: 'الحساب قيد التفعيل — لا يمكن تعطيله قبل التفعيل',
    reason: 'pending'
  };
  if (statusRaw === 'expired') return {
    success: false,
    error: 'الحساب منتهي الاشتراك — جدّد أولاً',
    reason: 'expired'
  };

  const storedHash = child[COLS_CHILDREN.family_password_hash];
  if (!storedHash) return { success: false, error: 'يجب تعيين كلمة سر قبل التعطيل' };
  if (!verifyFamilyPassword(password, storedHash)) {
    return { success: false, error: 'كلمة السر غير صحيحة' };
  }

  const { error: updateError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .update({ status: 'disabled' })
    .eq(COLS_CHILDREN.child_id, cleanID);

  if (updateError) return { success: false, error: updateError.message };

  await updateFaceActive(cleanID, false);
  await terminateOtherSessions(cleanID, sessionToken);

  console.log(`✅ [disableChildAccount] ${cleanID} (${Date.now() - t0}ms)`);

  return {
    success: true,
    message: 'تم تعطيل الحساب بنجاح.',
    status: 'disabled',
    cache_invalidate: true   // ← ✅ يخلي الفرونت يمسح الـ cache
  };
}

// ============================================================
//  4️⃣ enableChildAccount
// ============================================================
export async function enableChildAccount(params) {
  const cleanID = String(params.childID || '').trim().toUpperCase();
  const sessionToken = String(params.session || '').trim();

  if (!cleanID) return { success: false, error: 'كود الطفل مطلوب' };

  const t0 = Date.now();

  if (sessionToken) {
    const sessionChild = await getSessionChild(sessionToken);
    if (!sessionChild || sessionChild !== cleanID) {
      return { success: false, error: 'الجلسة غير صالحة' };
    }
  }

  const { data: child, error: childError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select(COLS_CHILDREN.status)
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (childError) return { success: false, error: childError.message };
  if (!child) return { success: false, error: 'الطفل غير موجود' };

  const statusRaw = String(child[COLS_CHILDREN.status] || '').trim().toLowerCase();
  if (statusRaw === 'deleted') return { success: false, error: 'الحساب محذوف — لا يمكن تفعيله' };
  if (statusRaw !== 'disabled') return { success: false, error: 'الحساب غير معطّل حالياً' };

  const { error: updateError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .update({ status: 'active' })
    .eq(COLS_CHILDREN.child_id, cleanID);

  if (updateError) return { success: false, error: updateError.message };

  await updateFaceActive(cleanID, true);

  console.log(`✅ [enableChildAccount] ${cleanID} (${Date.now() - t0}ms)`);

  return {
    success: true,
    message: 'تم تفعيل الحساب بنجاح.',
    status: 'active',
    cache_invalidate: true   // ← ✅
  };
}

// ============================================================
//  6️⃣ setFamilyPassword — تعيين/تغيير كلمة السر الأسرة
// ============================================================
export async function setFamilyPassword(params) {
  // 1. نجيب الباراميترز
  const cleanID = String(params.childID || '').trim().toUpperCase();
  const password = String(params.password || '').trim();

  // 2. تحقق من المدخلات
  if (!cleanID || !password) {
    return { success: false, error: 'بيانات ناقصة' };
  }

  // 3. تحقق من قوة كلمة السر
  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    return { success: false, error: strength.errors.join(' | ') };
  }

  const t0 = Date.now();

  // 4. تأكد إن الطفل موجود
  const { data: child, error: childError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select(COLS_CHILDREN.child_id)
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (childError) {
    console.error(`❌ [setFamilyPassword] ${cleanID} (${Date.now() - t0}ms)`, childError.message);
    return { success: false, error: childError.message };
  }
  if (!child) {
    console.log(`❌ [setFamilyPassword] ${cleanID} NOT FOUND (${Date.now() - t0}ms)`);
    return { success: false, error: 'الطفل غير موجود' };
  }

  // 5. اعمل hash لكلمة السر
  let hashed;
  try {
    hashed = hashFamilyPassword(password);
  } catch (e) {
    console.error('❌ [setFamilyPassword] hash error:', e.message);
    return { success: false, error: 'فشل تشفير كلمة السر' };
  }

  // 6. حدّث في قاعدة البيانات
  const now = nowEgypt();
  const { error: updateError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .update({
      [COLS_CHILDREN.family_password_hash]: hashed,
      [COLS_CHILDREN.family_password_set_at]: now
    })
    .eq(COLS_CHILDREN.child_id, cleanID);

  if (updateError) {
    console.error(`❌ [setFamilyPassword] update (${Date.now() - t0}ms)`, updateError.message);
    return { success: false, error: updateError.message };
  }

  console.log(`✅ [setFamilyPassword] ${cleanID} (${Date.now() - t0}ms)`);

  // 7. نجاح
  return { success: true, message: 'تم تعيين كلمة السر بنجاح' };
}

// ============================================================
//  7️⃣ completeFamilyMigration — إكمال الترحيل
//  (تعيين كلمة السر + إنشاء جلسة مباشرة)
// ============================================================
export async function completeFamilyMigration(params) {
  // 1. نجيب الباراميترز
  const cleanID = String(params.childID || '').trim().toUpperCase();
  const email = String(params.email || '').trim().toLowerCase();
  const password = String(params.password || '').trim();

  // 2. تحقق من المدخلات
  if (!cleanID || !email || !password) {
    return { success: false, error: 'كل الحقول مطلوبة' };
  }

  const t0 = Date.now();

  // 3. جيب الطفل من Supabase
  const { data: child, error: childError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (childError) {
    console.error(`❌ [completeFamilyMigration] ${cleanID} (${Date.now() - t0}ms)`, childError.message);
    return { success: false, error: childError.message };
  }
  if (!child) {
    console.log(`❌ [completeFamilyMigration] ${cleanID} NOT FOUND (${Date.now() - t0}ms)`);
    return { success: false, error: 'كود الطفل غير موجود' };
  }

  // 4. اقرأ القيم المهمة
  const status = String(child[COLS_CHILDREN.status] || '').trim().toLowerCase();
  const storedEmail = String(child[COLS_CHILDREN.email_code] || '').trim().toLowerCase();
  const storedHash = String(child[COLS_CHILDREN.family_password_hash] || '').trim();

  // 5. فحص الحساب المحذوف
  if (status === 'deleted') {
    return {
      success: false,
      error: 'هذا الحساب تم حذفه. تواصل مع الدعم: support@kidcode-eg.com'
    };
  }

  // 6. فحص لو عنده كلمة سر بالفعل
  if (storedHash) {
    return {
      success: false,
      error: 'تم إنشاء كلمة سر للحساب بالفعل. استخدم صفحة الدخول.'
    };
  }

  // 7. تحقق من الإيميل
  if (email !== storedEmail) {
    console.log(`❌ [completeFamilyMigration] ${cleanID} EMAIL MISMATCH (${Date.now() - t0}ms)`);
    return { success: false, error: 'البريد الإلكتروني غير مطابق' };
  }

  // 8. عيّن كلمة السر (بنسخة Supabase)
  const passwordResult = await setFamilyPassword({ childID: cleanID, password: password });
  if (!passwordResult.success) {
    return { success: false, error: passwordResult.error };
  }

  // 9. أنشئ جلسة جديدة (بنفس الدالة اللي familyLogin بيستخدمها)
  const session = await createFamilySession(cleanID);
  if (!session.success) {
    return {
      success: false,
      error: 'تم تعيين كلمة السر ولكن فشل إنشاء الجلسة. قم بتسجيل الدخول.'
    };
  }

  // 10. صفّر Rate Limiting
  await resetLoginAttempts(cleanID);

  console.log(`✅ [completeFamilyMigration] ${cleanID} (${Date.now() - t0}ms)`);

  // 11. نجاح
  return {
    success: true,
    session_token: session.session_token,
    expires_at: session.expires_at,
    child_id: cleanID,
    duration_min: session.duration_min,
    message: 'تم تعيين كلمة السر بنجاح. مرحباً بك!'
  };
}

// ============================================================
//  8️⃣ changeFamilyPassword — تغيير كلمة السر من داخل اللوحة
//  - يتحقق من كلمة السر الحالي
//  - يحدّث كلمة السر الجديد
//  - ينهي كل الجلسات (بما فيها الحالية)
// ============================================================
export async function changeFamilyPassword(params) {
  // 1. نجيب الباراميترز
  const cleanID = String(params.childID || '').trim().toUpperCase();
  const currentPassword = String(params.currentPassword || '').trim();
  const newPassword = String(params.newPassword || '').trim();

  // 2. تحقق من المدخلات
  if (!cleanID || !currentPassword || !newPassword) {
    return { success: false, error: 'كل الحقول مطلوبة' };
  }

  // 3. تحقق من قوة كلمة السر الجديد
  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) {
    return { success: false, error: strength.errors.join(' | ') };
  }

  // 4. كلمة السر الجديدة يجب ان تكون مختلفة
  if (currentPassword === newPassword) {
    return { success: false, error: 'كلمة السر الجديدة يجب أن تكون مختلفة' };
  }

  const t0 = Date.now();

  // 5. جيب الطفل من Supabase
  const { data: child, error: childError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (childError) {
    console.error(`❌ [changeFamilyPassword] ${cleanID} (${Date.now() - t0}ms)`, childError.message);
    return { success: false, error: childError.message };
  }
  if (!child) {
    console.log(`❌ [changeFamilyPassword] ${cleanID} NOT FOUND (${Date.now() - t0}ms)`);
    return { success: false, error: 'الطفل غير موجود' };
  }

  // 6. افحص وجود كلمة سر قديمة
  const storedHash = String(child[COLS_CHILDREN.family_password_hash] || '').trim();
  if (!storedHash) {
    return { success: false, error: 'لا يوجد كلمة سر مسجلة — استخدم البريد الإلكتروني أول مرة' };
  }

  // 7. تحقق من كلمة السر الحالية
  if (!verifyFamilyPassword(currentPassword, storedHash)) {
    console.log(`❌ [changeFamilyPassword] ${cleanID} WRONG PWD (${Date.now() - t0}ms)`);
    return { success: false, error: 'كلمة السر الحالية غير صحيحة' };
  }

  // 8. اعمل hash لكلمة السر الجديدة
  let newHash;
  try {
    newHash = hashFamilyPassword(newPassword);
  } catch (e) {
    console.error('❌ [changeFamilyPassword] hash error:', e.message);
    return { success: false, error: 'فشل تشفير كلمة السر' };
  }

  // 9. حدّث في قاعدة البيانات
  const now = nowEgypt();
  const { error: updateError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .update({
      [COLS_CHILDREN.family_password_hash]: newHash,
      [COLS_CHILDREN.family_password_set_at]: now
    })
    .eq(COLS_CHILDREN.child_id, cleanID);

  if (updateError) {
    console.error(`❌ [changeFamilyPassword] update (${Date.now() - t0}ms)`, updateError.message);
    return { success: false, error: updateError.message };
  }

  // 10. أنهي كل الجلسات (بما فيها الحالية)
  const termResult = await terminateAllSessions(cleanID);
  if (!termResult.success) {
    console.error(`⚠️ [changeFamilyPassword] فشل إنهاء الجلسات (${Date.now() - t0}ms)`);
    // ما نوقفش — كلمة السر اتغير فعلاً
  }

  // 11. صفّر Rate Limiting
  await resetLoginAttempts(cleanID);

  console.log(`✅ [changeFamilyPassword] ${cleanID} (${Date.now() - t0}ms)`);

  // 12. نجاح
  return {
    success: true,
    message: 'تم تغيير كلمة السر. سيتم تسجيل الخروج من جميع الأجهزة.',
    sessions_terminated: true
  };
}

// ============================================================
//  9️⃣ familyForgotPassword — إرسال رابط إعادة التعيين
//  - الرد الموحّد (ما بيكشفش لو الكود صح أو غلط)
//  - Rate Limiting: 10 محاولات / ساعة
// ============================================================
export async function familyForgotPassword(params) {
  // ✅ الرد الموحّد — نفس الرد في كل الحالات
  const GENERIC_SUCCESS_RESPONSE = {
    success: true,
    message: 'إذا كان الكود صحيحاً، سيصلك بريد إلكتروني لإعادة تعيين كلمة السر.'
  };

  try {
    // 1. نجيب الباراميترز
    const cleanID = String(params.childID || '').trim().toUpperCase();
    if (!cleanID) {
      return { success: false, error: 'كود الطفل مطلوب' };
    }

    const t0 = Date.now();

    // 2. Rate Limiting (Passive)
    const rateCheck = await checkPasswordResetAttempts(cleanID);
    if (!rateCheck.allowed) {
      console.log(`🚫 [familyForgotPassword] Rate limited: ${cleanID} | محاولات: ${rateCheck.count}/${FAMILY_FORGOT_MAX_ATTEMPTS}`);
      return GENERIC_SUCCESS_RESPONSE;   // ✅ نفس الرد
    }

    // 3. فحص الطفل
    const { data: child, error: childError } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select('*')
      .eq(COLS_CHILDREN.child_id, cleanID)
      .maybeSingle();

    if (childError) {
      console.error(`❌ [familyForgotPassword] ${cleanID} (${Date.now() - t0}ms)`, childError.message);
      return GENERIC_SUCCESS_RESPONSE;   // ✅ نفس الرد
    }

    if (!child) {
      console.log(`🔒 [familyForgotPassword] كود غير موجود: ${cleanID} (${Date.now() - t0}ms)`);
      return GENERIC_SUCCESS_RESPONSE;   // ✅ نفس الرد
    }

    // 4. فحص الحساب المحذوف
    const status = String(child[COLS_CHILDREN.status] || '').trim().toLowerCase();
    if (status === 'deleted') {
      console.log(`🚫 [familyForgotPassword] حساب محذوف: ${cleanID} (${Date.now() - t0}ms)`);
      return GENERIC_SUCCESS_RESPONSE;   // ✅ نفس الرد
    }

    // 5. فحص الإيميل
    const storedEmail = String(child[COLS_CHILDREN.email_code] || '').trim();
    if (!storedEmail) {
      console.log(`⚠️ [familyForgotPassword] مفيش إيميل: ${cleanID} (${Date.now() - t0}ms)`);
      return GENERIC_SUCCESS_RESPONSE;   // ✅ نفس الرد
    }

    // 6. توليد token عشوائي (48 حرف)
    const token = crypto.randomUUID().replace(/-/g, '') +
                  crypto.randomUUID().replace(/-/g, '').substring(0, 16);

    // 7. حساب وقت الانتهاء
    const expiresAt = futureEgypt(FAMILY_RESET_TOKEN_EXPIRY_MIN);

    // 8. خزّن التوكن في Supabase
    const { error: insertError } = await supabaseAdmin
      .from(TABLES.FAMILY_RESET_TOKENS)
      .insert({
        token: token,
        child_id: cleanID,
        expires_at: expiresAt,
        used: 'false',
        created_at: nowEgypt()
      });

    if (insertError) {
      console.error(`❌ [familyForgotPassword] insert token (${Date.now() - t0}ms)`, insertError.message);
      return GENERIC_SUCCESS_RESPONSE;   // ✅ نفس الرد
    }

    // 9. ابعت الإيميل
    const resetLink = 'https://www.kidcode-eg.com/family-reset-password?token=' + token;
    const emailResult = await sendFamilyResetEmail(
      storedEmail,
      cleanID,
      resetLink,
      FAMILY_RESET_TOKEN_EXPIRY_MIN
    );

    console.log(`📧 [familyForgotPassword] ${cleanID} (${Date.now() - t0}ms) | email: ${emailResult.success}`);

    // ✅ نفس الرد
    return GENERIC_SUCCESS_RESPONSE;

  } catch (e) {
    console.error('❌ [familyForgotPassword]', e.message);
    // ✅ حتى لو حصل خطأ، نرجع نفس الرد (أمان)
    return GENERIC_SUCCESS_RESPONSE;
  }
}

// ============================================================
//  🔟 familyResetPassword — إعادة تعيين كلمة السر بالتوكن
//  - يتحقق من التوكن (used + expiry)
//  - يعيّن كلمة السر الجديدة
//  - يمسح التوكن (One-Time Use)
//  - ينهي كل الجلسات
//  ⚠️ المقارنة بتوقيت مصر (string comparison)
// ============================================================
export async function familyResetPassword(params) {
  // 1. نجيب الباراميترز
  const token = String(params.token || '').trim();
  const newPassword = String(params.newPassword || '').trim();

  // 2. تحقق من المدخلات
  if (!token || !newPassword) {
    return { success: false, error: 'البيانات ناقصة' };
  }

  // 3. تحقق من قوة كلمة السر
  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) {
    return { success: false, error: strength.errors.join(' | ') };
  }

  const t0 = Date.now();

  // 4. اقرأ التوكن من Supabase
  const { data: tokenRow, error: tokenError } = await supabaseAdmin
    .from(TABLES.FAMILY_RESET_TOKENS)
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (tokenError) {
    console.error(`❌ [familyResetPassword] token read (${Date.now() - t0}ms)`, tokenError.message);
    return { success: false, error: 'حدث خطأ غير متوقع' };
  }

  if (!tokenRow) {
    console.log(`❌ [familyResetPassword] TOKEN NOT FOUND (${Date.now() - t0}ms)`);
    return { success: false, error: 'التوكن غير صحيح أو انتهت صلاحيته' };
  }

  // 5. تحقق إن التوكن مش مستخدم
  const usedStr = String(tokenRow.used || '').trim().toLowerCase();
  if (usedStr === 'true') {
    console.log(`❌ [familyResetPassword] TOKEN USED (${Date.now() - t0}ms)`);
    return { success: false, error: 'التوكن مستخدم بالفعل. اطلب رابط جديد.' };
  }

  // 6. ✅ فحص Expiry — مقارنة نصية بتوقيت مصر
  const expiresAtRaw = tokenRow.expires_at;
  if (expiresAtRaw) {
    // حوّل لصيغة "YYYY-MM-DD HH:MM:SS"
    let expiresAtStr = String(expiresAtRaw).trim();
    if (expiresAtStr.includes('T')) {
      expiresAtStr = expiresAtStr.replace('T', ' ').split('.')[0];
    }

    const nowStr = nowEgypt();   // "2026-10-02 04:30:00"

    if (nowStr > expiresAtStr) {
      // امسح التوكن المنتهي
      await supabaseAdmin
        .from(TABLES.FAMILY_RESET_TOKENS)
        .update({ used: 'true' })
        .eq('token', token);

      console.log(`⏰ [familyResetPassword] TOKEN EXPIRED (${Date.now() - t0}ms)`);
      return { success: false, error: 'انتهت صلاحية التوكن. اطلب رابط جديد.' };
    }
  }

  // 7. اقرأ كود الطفل
  const cleanID = String(tokenRow.child_id || '').trim().toUpperCase();
  if (!cleanID) {
    return { success: false, error: 'التوكن غير صالح' };
  }

  // 8. عيّن كلمة السر الجديدة (بنستخدم setFamilyPassword)
  const setResult = await setFamilyPassword({ childID: cleanID, password: newPassword });
  if (!setResult.success) {
    console.error(`❌ [familyResetPassword] setFamilyPassword failed (${Date.now() - t0}ms)`, setResult.error);
    return { success: false, error: setResult.error };
  }

  // 9. امسح التوكن (One-Time Use)
  await supabaseAdmin
    .from(TABLES.FAMILY_RESET_TOKENS)
    .update({ used: 'true' })
    .eq('token', token);

  // 10. أنهي كل الجلسات القديمة
  await terminateAllSessions(cleanID);

  // 11. صفّر Rate Limiting
  await resetLoginAttempts(cleanID);

  console.log(`✅ [familyResetPassword] ${cleanID} (${Date.now() - t0}ms)`);

  // 12. نجاح
  return {
    success: true,
    message: 'تم تعيين كلمة السر بنجاح. يمكنك الدخول الآن.'
  };
}

// ============================================================
//  1️⃣1️⃣ deleteFaceFeatures — حذف بصمة الوجه (Soft Delete)
//  - يحدّث IS_ACTIVE = 'لا' بدل الحذف الفعلي
//  - يبعت إيميل إشعار
// ============================================================
export async function deleteFaceFeatures(params) {
  // 1. نجيب الباراميترز
  const cleanID = String(params.childID || '').trim().toUpperCase();
  if (!cleanID) {
    return { success: false, error: 'معرف الطفل مطلوب' };
  }

  const t0 = Date.now();

  // 2. تأكد إن الطفل موجود + جيب بياناته (للإيميل)
  const { data: child, error: childError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (childError) {
    console.error(`❌ [deleteFaceFeatures] child read (${Date.now() - t0}ms)`, childError.message);
    return { success: false, error: childError.message };
  }

  if (!child) {
    console.log(`❌ [deleteFaceFeatures] ${cleanID} NOT FOUND (${Date.now() - t0}ms)`);
    return { success: false, error: 'الطفل غير موجود' };
  }

  // 3. تأكد إن عنده صف في FaceFeatures
  const { data: faceRow, error: faceError } = await supabaseAdmin
    .from(TABLES.FACE_FEATURES)
    .select('child_id')
    .eq(COLS_FACE.child_id, cleanID)
    .maybeSingle();

  if (faceError) {
    console.error(`❌ [deleteFaceFeatures] face read (${Date.now() - t0}ms)`, faceError.message);
    return { success: false, error: faceError.message };
  }

  if (!faceRow) {
    console.log(`❌ [deleteFaceFeatures] ${cleanID} NO FACE DATA (${Date.now() - t0}ms)`);
    return { success: false, error: 'لم يتم العثور على بيانات وجه لهذا الطفل' };
  }

  // 4. حدّث is_active = 'لا' + updated_at
  const { error: updateError } = await supabaseAdmin
    .from(TABLES.FACE_FEATURES)
    .update({
      is_active: 'لا',
      updated_at: nowEgypt()
    })
    .eq(COLS_FACE.child_id, cleanID);

  if (updateError) {
    console.error(`❌ [deleteFaceFeatures] update (${Date.now() - t0}ms)`, updateError.message);
    return { success: false, error: updateError.message };
  }

  // 5. ابعت إيميل إشعار (best-effort — مش بنوقف لو فشل)
  try {
    await sendFaceDataChangeEmail(child, 'delete', 'تم حذف بيانات الوجه بنجاح.');
  } catch (e) {
    console.error('⚠️ [deleteFaceFeatures] email error:', e.message);
  }

  console.log(`✅ [deleteFaceFeatures] ${cleanID} (${Date.now() - t0}ms)`);

  // 6. نجاح
  return {
    success: true,
    message: 'تم حذف بيانات الوجه بنجاح'
  };
}

// ============================================================
//  1️⃣2️⃣ setNotificationMethod — تحديد طريقة الإشعارات
//  - 'telegram' | 'email'
//  - لو telegram → يجب ان يكون فيه chat_id مربوط
// ============================================================
export async function setNotificationMethod(params) {
  const cleanID = String(params.childID || '').trim().toUpperCase();
  const method = String(params.method || '').trim().toLowerCase();

  if (!cleanID) {
    return { success: false, error: 'كود الطفل مطلوب' };
  }

  if (!['telegram', 'email'].includes(method)) {
    return { success: false, error: 'طريقة إشعار غير صالحة' };
  }

  const t0 = Date.now();

  // 1. جيب الطفل
  const { data: child, error: childError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (childError) {
    console.error(`❌ [setNotificationMethod] ${cleanID} (${Date.now() - t0}ms)`, childError.message);
    return { success: false, error: childError.message };
  }
  if (!child) return { success: false, error: 'الطفل غير موجود' };

  // 2. لو telegram → يجب ان chat_id مربوط
  if (method === 'telegram') {
    const fatherChat = String(child[COLS_CHILDREN.telegram_chat_id_father] || '').trim();
    const motherChat = String(child[COLS_CHILDREN.telegram_chat_id_mother] || '').trim();
    const legacyChat = String(child[COLS_CHILDREN.telegram_chat_id] || '').trim();

    if (!fatherChat && !motherChat && !legacyChat) {
      console.log(`⚠️ [setNotificationMethod] ${cleanID} — مفيش chat_id مربوط`);
      return { success: false, error: 'يجب ربط تليجرام أولاً' };
    }
  }

  // 3. حدّث
  const { error: updateError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .update({ [COLS_CHILDREN.notification_method]: method })
    .eq(COLS_CHILDREN.child_id, cleanID);

  if (updateError) {
    console.error(`❌ [setNotificationMethod] update (${Date.now() - t0}ms)`, updateError.message);
    return { success: false, error: updateError.message };
  }

  console.log(`✅ [setNotificationMethod] ${cleanID} → ${method} (${Date.now() - t0}ms)`);

  return {
    success: true,
    method: method,
    message: 'تم تحديث طريقة الإشعارات'
  };
}

// ============================================================
//  🔍 verifyUnlinkOTP — التحقق من OTP
//  - يرجّع { valid: true } أو { valid: false, reason, attemptsLeft }
// ============================================================
async function verifyUnlinkOTP(childID, parentType, otp) {
  // 1. اقرأ آخر OTP غير مستخدم
  const { data: otpRow, error } = await supabaseAdmin
    .from(TABLES.UNLINK_OTPS)
    .select('*')
    .eq('child_id', childID)
    .eq('parent_type', parentType)
    .eq('used', 'false')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('❌ [verifyUnlinkOTP] read error:', error.message);
    return { valid: false, reason: 'server_error' };
  }

  if (!otpRow) {
    return { valid: false, reason: 'no_otp' };
  }

  // 2. فحص الـ attempts
  const attempts = parseInt(otpRow.attempts || '0', 10);
  if (attempts >= UNLINK_OTP_MAX_ATTEMPTS) {
    // علّمه كمستخدم
    await supabaseAdmin
      .from(TABLES.UNLINK_OTPS)
      .update({ used: 'true' })
      .eq('id', otpRow.id);
    return { valid: false, reason: 'too_many_attempts' };
  }

  // 3. فحص الـ expiry (مقارنة نصية)
  const expiresAtStr = String(otpRow.expires_at || '').trim().replace('T', ' ').split('.')[0];
  const nowStr = nowEgypt();
  if (expiresAtStr && nowStr > expiresAtStr) {
    await supabaseAdmin
      .from(TABLES.UNLINK_OTPS)
      .update({ used: 'true' })
      .eq('id', otpRow.id);
    return { valid: false, reason: 'expired' };
  }

  // 4. فحص الـ OTP
  if (String(otpRow.otp_code).trim() !== String(otp).trim()) {
    const newAttempts = attempts + 1;
    await supabaseAdmin
      .from(TABLES.UNLINK_OTPS)
      .update({ attempts: newAttempts })
      .eq('id', otpRow.id);
    return {
      valid: false,
      reason: 'wrong_otp',
      attemptsLeft: Math.max(0, UNLINK_OTP_MAX_ATTEMPTS - newAttempts)
    };
  }

  // 5. ✅ صح — علّمه كمستخدم
  await supabaseAdmin
    .from(TABLES.UNLINK_OTPS)
    .update({ used: 'true' })
    .eq('id', otpRow.id);

  return { valid: true, otpId: otpRow.id };
}

// ============================================================
//  1️⃣3️⃣ unlinkTelegram — فك ربط والد واحد أو الاتنين
//  - parentType: 'father' | 'mother' | '' (الاتنين)
//  - لو الاتنين اتفكوا → reset legacy + notification_method = 'email'
// ============================================================
export async function unlinkTelegram(params) {
  const cleanID = String(params.childID || '').trim().toUpperCase();
  const cleanParent = String(params.parentType || '').trim().toLowerCase();
  const otp = String(params.otp || '').trim();

  if (!cleanID) {
    return { success: false, error: 'كود الطفل مطلوب' };
  }
  if (!['father', 'mother'].includes(cleanParent)) {
    return { success: false, error: 'نوع الوالد غير صالح' };
  }
  if (!otp) {
    return { success: false, error: 'رمز التحقق مطلوب' };
  }

  const t0 = Date.now();

  // 0. ✅ تحقق من OTP قبل أي حاجة
  const otpCheck = await verifyUnlinkOTP(cleanID, cleanParent, otp);
  if (!otpCheck.valid) {
    const reasons = {
      'no_otp': 'لا يوجد رمز تحقق نشط. يرجى طلب رمز جديد.',
      'expired': 'انتهت صلاحية الرمز. اطلب رمز جديد.',
      'too_many_attempts': 'تجاوزت الحد الأقصى للمحاولات. اطلب رمز جديد.',
      'wrong_otp': 'الرمز غير صحيح.' + (otpCheck.attemptsLeft !== undefined ? ` متبقي ${otpCheck.attemptsLeft} محاولة.` : ''),
      'server_error': 'حدث خطأ. حاول مرة أخرى.'
    };
    console.log(`🚫 [unlinkTelegram] OTP failed: ${otpCheck.reason}`);
    return {
      success: false,
      error: reasons[otpCheck.reason] || 'فشل التحقق من الرمز',
      reason: otpCheck.reason,
      attemptsLeft: otpCheck.attemptsLeft
    };
  }

  // 1. جيب الطفل
  const { data: child, error: childError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (childError) {
    console.error(`❌ [unlinkTelegram] ${cleanID} (${Date.now() - t0}ms)`, childError.message);
    return { success: false, error: childError.message };
  }
  if (!child) return { success: false, error: 'الطفل غير موجود' };

  // 2. حدد مين هيتفك
  const unlinkFather = !cleanParent || cleanParent === 'father';
  const unlinkMother = !cleanParent || cleanParent === 'mother';

  // 3. جهّز التحديثات
  const updates = {};

  if (unlinkFather) {
    updates[COLS_CHILDREN.telegram_chat_id_father] = '';
    updates[COLS_CHILDREN.telegram_linked_at_father] = '';
  }
  if (unlinkMother) {
    updates[COLS_CHILDREN.telegram_chat_id_mother] = '';
    updates[COLS_CHILDREN.telegram_linked_at_mother] = '';
  }

  // 4. لو الاتنين اتفكوا → صفّر legacy + غيّر method
  const remainingFather = unlinkFather
    ? ''
    : String(child[COLS_CHILDREN.telegram_chat_id_father] || '').trim();
  const remainingMother = unlinkMother
    ? ''
    : String(child[COLS_CHILDREN.telegram_chat_id_mother] || '').trim();

  if (!remainingFather && !remainingMother) {
    updates[COLS_CHILDREN.telegram_chat_id] = '';
    updates[COLS_CHILDREN.telegram_linked_at] = '';
    updates[COLS_CHILDREN.notification_method] = 'email';
    console.log(`📌 [unlinkTelegram] ${cleanID} — الاتنين اتفكوا → notification_method = email`);
  }

  // 5. نفّذ التحديث
  const { error: updateError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .update(updates)
    .eq(COLS_CHILDREN.child_id, cleanID);

  if (updateError) {
    console.error(`❌ [unlinkTelegram] update (${Date.now() - t0}ms)`, updateError.message);
    return { success: false, error: updateError.message };
  }

  // 6. حدّث TelegramPendingLinks (best-effort)
  try {
    let pendingQuery = supabaseAdmin
      .from(TABLES.PENDING_LINKS)
      .update({ status: 'unlinked' })
      .eq('child_id', cleanID)
      .in('status', ['pending', 'linked']);

    if (cleanParent === 'father' || cleanParent === 'mother') {
      pendingQuery = pendingQuery.eq('parent_type', cleanParent);
    }

    const { error: pendingError } = await pendingQuery;
    if (pendingError) {
      console.warn('⚠️ [unlinkTelegram] pending update:', pendingError.message);
    }
  } catch (e) {
    console.warn('⚠️ [unlinkTelegram] pending catch:', e.message);
  }

  // 7. رسالة النجاح
  const label = cleanParent === 'father' ? 'الأب'
              : cleanParent === 'mother' ? 'الأم'
              : 'الوالدين';

  console.log(`✅ [unlinkTelegram] ${cleanID} — فك ربط ${label} (${Date.now() - t0}ms)`);

  return {
    success: true,
    message: `تم فك ربط ${label} بنجاح`
  };
}

// ============================================================
//  1️⃣4️⃣ generateLinkToken — توليد توكن لربط تليجرام
//  - يتحقق إن الـ parent مش مربوط بالفعل
//  - يولّد كود 6 أحرف
//  - يخزّنه في TelegramPendingLinks (صلاحية 10 دقائق)
//  - يرجّع deepLink + expiresAt
// ============================================================
export async function generateLinkToken(params) {
  const cleanID = String(params.childID || '').trim().toUpperCase();
  const cleanParent = String(params.parentType || 'father').trim().toLowerCase();

  // 1. التحقق من المدخلات
  if (!cleanID) {
    return { success: false, error: 'child_id_missing', message: 'كود الطفل مطلوب' };
  }
  if (!['father', 'mother'].includes(cleanParent)) {
    return { success: false, error: 'invalid_parent_type', message: 'نوع الوالد غير صالح' };
  }

  const t0 = Date.now();

  // 2. جيب الطفل
  const { data: child, error: childError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (childError) {
    console.error(`❌ [generateLinkToken] ${cleanID} (${Date.now() - t0}ms)`, childError.message);
    return { success: false, error: childError.message };
  }
  if (!child) {
    console.log(`❌ [generateLinkToken] ${cleanID} NOT FOUND (${Date.now() - t0}ms)`);
    return { success: false, error: 'child_not_found', message: 'الطفل غير موجود' };
  }

  // 3. هل الـ parent مربوط بالفعل؟
  const chatIdField = cleanParent === 'father'
    ? COLS_CHILDREN.telegram_chat_id_father
    : COLS_CHILDREN.telegram_chat_id_mother;

  const existingChatId = String(child[chatIdField] || '').trim();
  if (existingChatId) {
    const parentLabel = cleanParent === 'father' ? 'الأب' : 'الأم';
    console.log(`⚠️ [generateLinkToken] ${cleanID} — ${parentLabel} مربوط بالفعل`);
    return {
      success: false,
      error: 'already_linked',
      message: `حساب ${parentLabel} مربوط بتليجرام بالفعل`,
      chatId: existingChatId
    };
  }

  // 4. ولّد التوكن + احسب وقت الانتهاء
  const token = generateShortCode(6);
  // ✅ ISO 8601 UTC — صلاحية 5 دقايق
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // 5. احفظ في TelegramPendingLinks
  const { error: insertError } = await supabaseAdmin
    .from(TABLES.PENDING_LINKS)
    .insert({
      token: token,
      child_id: cleanID,
      created_at: nowEgypt(),
      expires_at: expiresAt,
      status: 'pending',
      parent_type: cleanParent,
      user_type: 'parent'
    });

  if (insertError) {
    console.error(`❌ [generateLinkToken] insert (${Date.now() - t0}ms)`, insertError.message);
    return { success: false, error: insertError.message };
  }

  const deepLink = `https://t.me/KidcodeEGbot?start=${token}`;

  console.log(`✅ [generateLinkToken] ${cleanID} | ${cleanParent} | token: ${token} (${Date.now() - t0}ms)`);

  // 6. نجاح
  return {
    success: true,
    token: token,
    deepLink: deepLink,
    expiresAt: expiresAt,
    parentType: cleanParent,
    childName: String(child[COLS_CHILDREN.child_name] || '').trim()
  };
}

// ============================================================
//  1️⃣5️⃣ updateChildData — تعديل بيانات الطفل
//  - يحدّث حقول محددة في KidCode-eg (بدون timestamp)
//  - يسجّل التعديل في ChildEditLog
//  - يبعت إيميل إشعار
// ============================================================
export async function updateChildData(params) {
  const cleanID = String(params.childID || '').trim().toUpperCase();
  if (!cleanID) return { success: false, error: 'الطفل غير موجود' };

  // 1. Parse updatedFields (may come as JSON string)
  let updatedFields = params.updatedFields;
  if (typeof updatedFields === 'string') {
    try { updatedFields = JSON.parse(updatedFields); } catch (e) { updatedFields = {}; }
  }
  if (!updatedFields || typeof updatedFields !== 'object') updatedFields = {};

  const t0 = Date.now();

  // 2. جيب الطفل
  const { data: child, error: childError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (childError) {
    console.error(`❌ [updateChildData] ${cleanID} (${Date.now() - t0}ms)`, childError.message);
    return { success: false, error: childError.message };
  }
  if (!child) return { success: false, error: 'الطفل غير موجود' };

  const parentEmail = String(child[COLS_CHILDREN.email_code] || '').trim();
  const childName = String(child[COLS_CHILDREN.child_name] || cleanID).trim();

  // 3. خريطة أسماء الحقول
  const fieldNameMap = {
    'GOOGLE_MAPS': 'رابط خرائط Google',
    'DETAILED_ADDRESS': 'العنوان التفصيلي',
    'FATHER_PHONE': 'رقم هاتف الأب',
    'MOTHER_NAME': 'اسم الأم',
    'MOTHER_PHONE': 'رقم هاتف الأم',
    'NOTES': 'الملاحظات',
    'MARKETER_ID': 'كود المسوق'
  };

  const changedFieldsList = [];
  const updates = {};

  // 4. Loop through fields
  for (const [fieldName, newValue] of Object.entries(updatedFields)) {
    if (newValue === undefined || newValue === null) continue;

    // 🔒 حماية BIRTH_DATE (read-only)
    if (fieldName === 'BIRTH_DATE') {
      console.log('🔒 [updateChildData] تجاهل BIRTH_DATE (read-only)');
      continue;
    }

    // 🔒 حماية MARKETER_ID (لو مسجل مسبقاً)
    if (fieldName === 'MARKETER_ID') {
      const existingMarketer = String(child[COLS_CHILDREN.marketer_id] || '').trim();
      if (existingMarketer) {
        console.log('🔒 [updateChildData] تجاهل MARKETER_ID (مسجل مسبقاً)');
        continue;
      }

      const newMarketerCode = String(newValue || '').trim().toUpperCase();
      if (newMarketerCode) {
        // ✅ تحقق من الكود
        const validation = await validateMarketerCode({ code: newMarketerCode });
        if (!validation.success || !validation.valid) {
          console.log('🚫 [updateChildData] كود مسوق غير صحيح:', newMarketerCode);
          return { success: false, error: 'كود المسوق غير صحيح أو غير نشط' };
        }
        console.log('✅ [updateChildData] كود مسوق صحيح:', newMarketerCode);
      }
    }

    // جيب القيمة القديمة
    let oldValue = '';
    switch (fieldName) {
      case 'GOOGLE_MAPS': oldValue = child[COLS_CHILDREN.google_maps] || ''; break;
      case 'DETAILED_ADDRESS': oldValue = child[COLS_CHILDREN.detailed_address] || ''; break;
      case 'FATHER_PHONE': oldValue = child[COLS_CHILDREN.father_phone] || ''; break;
      case 'MOTHER_NAME': oldValue = child[COLS_CHILDREN.mother_name] || ''; break;
      case 'MOTHER_PHONE': oldValue = child[COLS_CHILDREN.mother_phone] || ''; break;
      case 'NOTES': oldValue = child[COLS_CHILDREN.notes] || '[]'; break;
      case 'MARKETER_ID': oldValue = child[COLS_CHILDREN.marketer_id] || ''; break;
      default: continue;
    }

    const newValueStr = String(newValue || '').trim();
    const oldValueStr = String(oldValue || '').trim();

    // لو مفيش تغيير فعلي
    if (newValueStr === oldValueStr) continue;

    const displayName = fieldNameMap[fieldName] || fieldName;
    if (!changedFieldsList.includes(displayName)) {
      changedFieldsList.push(displayName);
    }

    // Map to column
    switch (fieldName) {
      case 'GOOGLE_MAPS': updates[COLS_CHILDREN.google_maps] = newValueStr; break;
      case 'DETAILED_ADDRESS': updates[COLS_CHILDREN.detailed_address] = newValueStr; break;
      case 'FATHER_PHONE': updates[COLS_CHILDREN.father_phone] = newValueStr; break;
      case 'MOTHER_NAME': updates[COLS_CHILDREN.mother_name] = newValueStr; break;
      case 'MOTHER_PHONE': updates[COLS_CHILDREN.mother_phone] = newValueStr; break;
      case 'NOTES': updates[COLS_CHILDREN.notes] = newValueStr; break;
      case 'MARKETER_ID': updates[COLS_CHILDREN.marketer_id] = newValueStr; break;
    }
  }

  // 5. معالجة الصورة — عبر GAS Proxy (Google Drive)
  if (params.imageBase64) {
    try {
      const oldImageId = String(child[COLS_CHILDREN.child_image_url] || '').trim();
      
      console.log(`🖼️ [updateChildData] رفع صورة جديدة (old: ${oldImageId || 'none'})`);

      const gasResponse = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveChildImage',
          childID: cleanID,
          imageBase64: params.imageBase64,
          oldImageId: oldImageId
        })
      });

      const gasData = await gasResponse.json();
      
      if (gasData.success && gasData.fileId) {
        updates[COLS_CHILDREN.child_image_url] = gasData.fileId;
        changedFieldsList.push('صورة الطفل');
        console.log(`✅ [updateChildData] صورة جديدة: ${gasData.fileId}`);
      } else {
        console.error('⚠️ [updateChildData] فشل حفظ الصورة:', gasData.error);
        // نكمل بدون صورة — التعديلات النصية بتتنجح
      }
    } catch (e) {
      console.error('⚠️ [updateChildData] image proxy error:', e.message);
      // نكمل بدون صورة
    }
  }

  // 6. لو مفيش تغييرات
  if (Object.keys(updates).length === 0) {
    return {
      success: true,
      message: 'لا توجد تغييرات',
      changedFields: []
    };
  }

  // 7. حدّث في Supabase
  const { error: updateError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .update(updates)
    .eq(COLS_CHILDREN.child_id, cleanID);

  if (updateError) {
    console.error(`❌ [updateChildData] update (${Date.now() - t0}ms)`, updateError.message);
    return { success: false, error: updateError.message };
  }

  console.log(`✅ [updateChildData] ${cleanID} — ${changedFieldsList.length} حقول (${Date.now() - t0}ms)`);

  // 8. سجّل في ChildEditLog
  try {
    await supabaseAdmin
      .from(TABLES.CHILD_EDIT_LOG)
      .insert({
        id: crypto.randomUUID(),
        child_id: cleanID,
        edited_at: nowEgypt(),
        changed_fields: JSON.stringify(changedFieldsList)
      });
    console.log(`📝 [updateChildData] تم التسجيل في ChildEditLog`);
  } catch (logErr) {
    console.error('⚠️ [updateChildData] log error:', logErr.message);
  }

  // 9. إرسال إشعار (حسب notification_method)
  if (changedFieldsList.length > 0) {
    try {
      const notifyResult = await notifyFamily({
        childID: cleanID,
        eventType: 'child_update',
        eventData: { changedFields: changedFieldsList }
      });
      console.log(`📨 [updateChildData] إشعار: channel=${notifyResult.channel || '?'} | fallback=${notifyResult.fallbackUsed || false}`);
    } catch (e) {
      console.error('⚠️ [updateChildData] notify error:', e.message);
    }
  }

  // 10. نجاح
  return {
    success: true,
    message: 'تم تحديث البيانات بنجاح، سيصلك إشعار عبر قناة التواصل المختارة لديك.',
    changedFields: changedFieldsList
  };
}

// ============================================================
//  1️⃣6️⃣ requestRefund — طلب استرداد من لوحة الأسرة
//  - يتحقق من كلمة السر
//  - يتحقق من مرور 14 يوم كاملة
//  - يتحقق من scan_count <= 10
//  - يغير حالة الطفل والدفع إلى refunding
//  - يرسل إشعار تليجرام وإيميل للدعم
// ============================================================
export async function requestRefund(params) {
  const cleanID = String(params.childID || '').trim().toUpperCase();
  const password = String(params.password || '').trim();
  const sessionToken = String(params.session || '').trim();
  const reason = String(params.reason || 'طلب استرداد من لوحة الأسرة').trim();

  if (!cleanID || !password) {
    return { success: false, error: 'البيانات ناقصة' };
  }

  const t0 = Date.now();

  // 1. جيب الطفل
  const { data: child, error: childError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (childError) return { success: false, error: childError.message };
  if (!child) return { success: false, error: 'الطفل غير موجود' };

  // 2. فحص الحالة
  const statusRaw = String(child[COLS_CHILDREN.status] || '').trim().toLowerCase();
  if (statusRaw === 'deleted' || statusRaw === 'refunded') {
    return { success: false, error: 'الحساب محذوف أو مسترد بالفعل' };
  }
  if (statusRaw === 'refunding') {
    return { success: false, error: 'يوجد طلب استرداد قيد المراجعة بالفعل' };
  }

  // 3. فحص كلمة السر
  const storedHash = String(child[COLS_CHILDREN.family_password_hash] || '').trim();
  if (!storedHash) return { success: false, error: 'يجب تعيين كلمة سر أولًا' };
  if (!verifyFamilyPassword(password, storedHash)) {
    return { success: false, error: 'كلمة السر غير صحيحة' };
  }

  // 4. جلب آخر عملية دفع مدفوعة
  const { data: payment } = await supabaseAdmin
    .from(TABLES.PAYMENTS)
    .select('*')
    .eq('child_id', cleanID)
    .eq('status', 'paid')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!payment) {
    return { success: false, error: 'لا توجد عملية دفع مؤهلة للاسترداد' };
  }

  // 5. فحص مرور 14 يوم
  const paidAt = payment.paid_at || payment.created_at;
  const daysSincePaid = paidAt ? Math.floor((Date.now() - new Date(paidAt).getTime()) / 86400000) : 0;
  if (daysSincePaid < 14) {
    return { success: false, error: 'before_14_days', message: 'لم تمر أربعة عشر يوماً كاملة على عملية الدفع.' };
  }

  // 6. فحص scan_count
  const scanCount = parseInt(child[COLS_CHILDREN.scan_count] || 0, 10);
  if (scanCount > 10) {
    return { success: false, error: 'service_used', message: 'تم تجاوز الحد الأقصى للمسحات (10).' };
  }

  // 7. تحديث الحالات إلى refunding
  await supabaseAdmin
    .from(TABLES.CHILDREN)
    .update({ [COLS_CHILDREN.status]: 'refunding' })
    .eq(COLS_CHILDREN.child_id, cleanID);

  await supabaseAdmin
    .from(TABLES.PAYMENTS)
    .update({ status: 'refunding', refund_reason: reason })
    .eq('id', payment.id);

  console.log(`✅ [requestRefund] ${cleanID} → refunding (${Date.now() - t0}ms)`);

  // 8. إرسال الإشعارات (تليجرام + إيميل)
  try {
    const { sendViaTelegram } = await import('../telegram.js');
    const adminChatId = process.env.ADMIN_CHAT_ID || '201004135973';
    const tgMsg = `⚠️ <b>طلب استرداد جديد</b>\n\n👶 الطفل: <b>${child[COLS_CHILDREN.child_name]}</b> (${cleanID})\n💳 المبلغ: ${(payment.amount_cents/100)} EGP\n📅 تاريخ الدفع: ${paidAt}\n📝 السبب: ${reason}\n\nيرجى مراجعة لوحة التحكم لتأكيد الاسترداد.`;
    await sendViaTelegram(adminChatId, tgMsg);

    // إرسال إيميل للدعم
    const brevoApiKey = process.env.BREVO_API_KEY;
    if (brevoApiKey) {
      await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': brevoApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: { name: 'KidCode System', email: 'no-reply@kidcode-eg.com' },
          to: [{ email: 'support@kidcode-eg.com', name: 'Support Team' }],
          subject: `طلب استرداد جديد - ${cleanID}`,
          htmlContent: `<p>تم تقديم طلب استرداد جديد للطفل <b>${child[COLS_CHILDREN.child_name]}</b> (${cleanID}).</p><p>المبلغ: ${(payment.amount_cents/100)} EGP</p><p>يرجى الدخول للوحة التحكم لتأكيد الاسترداد.</p>`
        })
      });
    }
  } catch (e) {
    console.error('⚠️ [requestRefund] Notification error:', e.message);
  }

  return { success: true, message: 'تم تقديم طلب الاسترداد بنجاح. سيتم مراجعته.' };
}

// ============================================================
//  1️⃣7️⃣ cancelRefundRequest — إلغاء طلب الاسترداد بواسطة الأسرة
// ============================================================
export async function cancelRefundRequest(params) {
  const cleanID = String(params.childID || '').trim().toUpperCase();
  const sessionToken = String(params.session || '').trim();

  if (!cleanID) return { success: false, error: 'كود الطفل مطلوب' };

  // 1. فحص الجلسة
  if (sessionToken) {
    const sessionChild = await getSessionChild(sessionToken);
    if (!sessionChild || sessionChild !== cleanID) {
      return { success: false, error: 'الجلسة غير صالحة' };
    }
  }

  // 2. جيب الطفل
  const { data: child } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select(COLS_CHILDREN.status)
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (!child) return { success: false, error: 'الطفل غير موجود' };
  if (String(child[COLS_CHILDREN.status]).toLowerCase() !== 'refunding') {
    return { success: false, error: 'لا يوجد طلب استرداد قيد المراجعة لإلغائه' };
  }

  // 3. إرجاع الحالة إلى active
  await supabaseAdmin
    .from(TABLES.CHILDREN)
    .update({ [COLS_CHILDREN.status]: 'active' })
    .eq(COLS_CHILDREN.child_id, cleanID);

  // 4. إرجاع آخر عملية دفع إلى paid
  await supabaseAdmin
    .from(TABLES.PAYMENTS)
    .update({ status: 'paid', refund_reason: null })
    .eq('child_id', cleanID)
    .eq('status', 'refunding');

  console.log(`✅ [cancelRefundRequest] ${cleanID} → active`);

  return { success: true, message: 'تم إلغاء طلب الاسترداد وإعادة تفعيل الحساب.' };
}

// ============================================================
//  1️⃣8️⃣ deleteChildAccount — حذف الحساب (Soft Delete)
//  - COURT_REQUESTED check
//  - Password verify
//  - status → 'DELETED'
//  - تعطيل الوجه + إنهاء الجلسات + تصفير Rate Limiting
// ============================================================
export async function deleteChildAccount(params) {
  const cleanID = String(params.childID || '').trim().toUpperCase();
  const password = String(params.password || '').trim();
  const sessionToken = String(params.session || '').trim();

  if (!cleanID || !password) {
    return { success: false, error: 'البيانات ناقصة' };
  }

  const t0 = Date.now();

  // 1. جيب الطفل
  const { data: child, error: childError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (childError) {
    console.error(`❌ [deleteChildAccount] ${cleanID} (${Date.now() - t0}ms)`, childError.message);
    return { success: false, error: childError.message };
  }
  if (!child) return { success: false, error: 'الطفل غير موجود' };

  // 2. COURT check
  const courtRaw = String(child[COLS_CHILDREN.court_requested] || '').trim().toLowerCase();
  if (['نعم', 'yes', 'true'].includes(courtRaw)) {
    console.log(`⚖️ [deleteChildAccount] COURT_REQUESTED: ${cleanID}`);
    return {
      success: false,
      error: 'COURT_REQUESTED',
      message: 'عفواً، بيانات الطفل مطلوبة قضائياً ولا يمكن حذفها. يمكنك تعطيل الحساب.',
      can_disable: true
    };
  }

  // 3. Session verify
  if (sessionToken) {
    const sessionChild = await getSessionChild(sessionToken);
    if (!sessionChild || sessionChild !== cleanID) {
      return { success: false, error: 'الجلسة غير صالحة' };
    }
  }

  // 4. فحص الحالة الحالية
  const statusRaw = String(child[COLS_CHILDREN.status] || '').trim().toLowerCase();
  if (statusRaw === 'deleted') {
    return { success: false, error: 'الحساب محذوف بالفعل' };
  }

  // 5. فحص كلمة السر
  const storedHash = String(child[COLS_CHILDREN.family_password_hash] || '').trim();
  if (!storedHash) {
    return { success: false, error: 'يجب تعيين كلمة سر أولًا قبل الحذف' };
  }
  if (!verifyFamilyPassword(password, storedHash)) {
    console.log(`❌ [deleteChildAccount] ${cleanID} WRONG PWD (${Date.now() - t0}ms)`);
    return { success: false, error: 'كلمة السر غير صحيحة' };
  }

  // 6. حدّث status = 'DELETED' (Soft Delete)
  const { error: updateError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .update({ [COLS_CHILDREN.status]: 'DELETED' })
    .eq(COLS_CHILDREN.child_id, cleanID);

  if (updateError) {
    console.error(`❌ [deleteChildAccount] update (${Date.now() - t0}ms)`, updateError.message);
    return { success: false, error: updateError.message };
  }

  // 7. تعطيل بصمة الوجه
  await updateFaceActive(cleanID, false);

  // 8. إنهاء كل الجلسات
  await terminateAllSessions(cleanID);

  // 9. تصفير Rate Limiting
  await resetLoginAttempts(cleanID);

    // 10. commission check + marketer notification
  try {
    const marketerId = String(child[COLS_CHILDREN.marketer_id] || '').trim();
    const regRaw = child[COLS_CHILDREN.registration_date] || child[COLS_CHILDREN.timestamp];

    if (marketerId && regRaw) {
      const regDate = new Date(regRaw).getTime();
      const daysSince = Math.floor((Date.now() - regDate) / (1000 * 60 * 60 * 24));

      if (daysSince <= 14) {
        console.log(`💰 [deleteChildAccount] عمولة ملغاة (حذف بعد ${daysSince} يوم) → إشعار المسوق`);

        const { notifyMarketer } = await import('../marketer-notify.js');
        await notifyMarketer({
          marketerCode: marketerId,
          eventType: 'client_deleted',
          eventData: {
            childID: cleanID,
            reason: `حذف خلال 14 يوم من التسجيل — العمولة ملغاة (${daysSince} يوم)`
          }
        });
      }
    }
  } catch (e) {
    console.error('⚠️ [deleteChildAccount] marketer notification error:', e.message);
    // ما نوقفش — الحساب اتحذف فعلاً
  }

  console.log(`✅ [deleteChildAccount] ${cleanID} (${Date.now() - t0}ms)`);

  // 11. نجاح
  return {
    success: true,
    message: 'تم حذف الحساب بنجاح.',
    commission_cancelled: false
  };
}

// ============================================================
//  🚀 Dispatcher
// ============================================================
export async function handleSupabaseWrite(innerAction, params) {
  switch (innerAction) {
    case 'familyLogin':
      return await familyLogin(params);
    case 'familyLogout':
      return await familyLogout(params);
    case 'setFamilyPassword':
      return await setFamilyPassword(params);
    case 'completeFamilyMigration':
      return await completeFamilyMigration(params);
    case 'changeFamilyPassword':
      return await changeFamilyPassword(params);
    case 'familyForgotPassword':
      return await familyForgotPassword(params);
    case 'familyResetPassword':
      return await familyResetPassword(params);
    case 'deleteFaceFeatures':
      return await deleteFaceFeatures(params);
    case 'saveFaceFeatures':
      return await saveFaceFeatures(params);
    case 'saveFaceFeaturesFromFamily':
      return await saveFaceFeaturesFromFamily(params);
    case 'setNotificationMethod':
      return await setNotificationMethod(params);
    case 'unlinkTelegram':
      return await unlinkTelegram(params);
    case 'requestUnlinkOTP':
      return await requestUnlinkOTP(params);
    case 'generateLinkToken':
      return await generateLinkToken(params);
    case 'updateChildData':
      return await updateChildData(params);
    case 'deleteChildAccount':
      return await deleteChildAccount(params);
    case 'requestRefund':
      return await requestRefund(params);
    case 'cancelRefundRequest':
      return await cancelRefundRequest(params);
    case 'disableChildAccount':
      return await disableChildAccount(params);
    case 'enableChildAccount':
      return await enableChildAccount(params);
    default:
      return null;
  }
}