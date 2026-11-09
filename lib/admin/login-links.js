// ================================================================
//  lib/admin/login-links.js — روابط الدخول لمرة واحدة
//  - توكن عشوائي 64 حرف (hex)
//  - صلاحية 5 دقايق فقط
//  - استخدام مرة واحدة (ذرّي)
//  - رابط واحد نشط لكل مسؤول
//  - يُلغي أي رابط قديم عند التوليد
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { TABLES } from '../db/tables.js';
import { writeAuditLog } from './audit.js';
import { getClientIP } from './auth.js';

// ================================================================
//  🔧 الثوابت
// ================================================================
const TOKEN_BYTES   = 32;                     // 64 hex chars
const TTL_MINUTES   = 5;                      // مدة الصلاحية
const BASE_URL      = 'https://www.kidcode-eg.com';
const ENTER_PATH    = '/admin/enter.html';

// ================================================================
//  🕐 التوقيتات — UTC ISO (متوافقة مع timestamptz)
// ================================================================
function nowUTC() {
  return new Date().toISOString();
}

function futureUTC(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

// ================================================================
//  🎲 generateToken — توكن عشوائي 64 hex
// ================================================================
function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

// ================================================================
//  🆕 createLoginLink — توليد رابط دخول جديد
//  - يُلغي أي روابط نشطة سابقة لنفس المسؤول
//  - يُرجِع التوكن + وقت الانتهاء + الرابط الكامل
// ================================================================
export async function createLoginLink(username, req, source) {
  const uname = String(username || '').trim();
  if (!uname) return { success: false, error: 'missing_username' };

  const src = String(source || 'telegram_link').trim();

  // ✅ حماية من req = null
  let ipAddress = null;
  let userAgent = null;

  if (req) {
    try {
      ipAddress = getClientIP(req) || null;
    } catch (e) {
      ipAddress = null;
    }
    try {
      userAgent = String((req.headers && req.headers['user-agent']) || '').substring(0, 300) || null;
    } catch (e) {
      userAgent = null;
    }
  }

  // 1. إلغاء أي روابط نشطة سابقة لنفس المسؤول (أمان: رابط واحد فقط)
  try {
    await supabaseAdmin
      .from(TABLES.ADMIN_LOGIN_LINKS)
      .update({ used: 'نعم' })
      .eq('username', uname)
      .eq('used', 'لا');
  } catch (e) {
    // نكمل — الإلغاء ليس حرجًا
  }

  // 2. توليد توكن فريد (5 محاولات لتفادي التصادم نظريًا)
  let token = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateToken();
    try {
      const { data } = await supabaseAdmin
        .from(TABLES.ADMIN_LOGIN_LINKS)
        .select('token')
        .eq('token', candidate)
        .maybeSingle();

      if (!data) { token = candidate; break; }
    } catch (e) {
      // نكمل
    }
  }

  if (!token) {
    return { success: false, error: 'token_collision', message: 'تعذر توليد توكن فريد' };
  }

  // 3. الإدراج في قاعدة البيانات
  const expiresAt = futureUTC(TTL_MINUTES);

  const { error: insertErr } = await supabaseAdmin
    .from(TABLES.ADMIN_LOGIN_LINKS)
    .insert({
      token: token,
      username: uname,
      expires_at: expiresAt,
      used: 'لا',
      ip_address: ipAddress,
      user_agent: userAgent,
      created_at: nowUTC()
    });

  if (insertErr) {
    return { success: false, error: 'db_insert_failed', message: insertErr.message };
  }

  // 4. Audit Log (best-effort)
  try {
    await writeAuditLog({
      username: uname,
      action: 'login_link_generated',
      target_table: TABLES.ADMINS,
      target_id: uname,
      changes: { source: src },
      ip_address: ipAddress,
      user_agent: userAgent
    });
  } catch (e) {}

  return {
    success: true,
    token: token,
    expiresAt: expiresAt,
    ttlMinutes: TTL_MINUTES,
    url: BASE_URL + ENTER_PATH + '?token=' + token
  };
}

// ================================================================
//  🔍 verifyLoginLink — التحقق من صلاحية توكن (بدون استهلاك)
// ================================================================
export async function verifyLoginLink(token) {
  const t = String(token || '').trim();
  if (!t) return { success: false, error: 'missing_token', message: 'التوكن مطلوب' };

  let row = null;
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.ADMIN_LOGIN_LINKS)
      .select('token,username,expires_at,used')
      .eq('token', t)
      .maybeSingle();

    if (error) return { success: false, error: 'db_error', message: error.message };
    row = data;
  } catch (e) {
    return { success: false, error: 'db_exception', message: e.message };
  }

  if (!row) {
    return { success: false, error: 'invalid_token', message: 'الرابط غير صحيح' };
  }

  if (String(row.used || '').trim() === 'نعم') {
    return { success: false, error: 'used_token', message: 'الرابط مُستخدم بالفعل' };
  }

  const expiresMs = new Date(row.expires_at).getTime();
  if (isNaN(expiresMs) || Date.now() >= expiresMs) {
    return { success: false, error: 'expired_token', message: 'انتهت صلاحية الرابط' };
  }

  return {
    success: true,
    username: String(row.username || '').trim(),
    expiresAt: row.expires_at
  };
}

// ================================================================
//  ✅ consumeLoginLink — استهلاك التوكن (ذرّي)
//  - يتحقق من التوكن
//  - يعلّمه كمستخدم بطريقة atomic (لو اتنين حاولوا، واحد بس ينجح)
// ================================================================
export async function consumeLoginLink(token) {
  const t = String(token || '').trim();
  if (!t) return { success: false, error: 'missing_token' };

  // 1. تحقق أولي (لجلب username + التأكد من الصلاحية)
  const verify = await verifyLoginLink(t);
  if (!verify.success) return verify;

  // 2. استهلاك ذرّي: update مع شرط used='لا'
  //    لو صف واحد فقط تأثر → نجحنا
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.ADMIN_LOGIN_LINKS)
      .update({ used: 'نعم' })
      .eq('token', t)
      .eq('used', 'لا')
      .select('username');

    if (error) {
      return { success: false, error: 'consume_failed', message: error.message };
    }

    if (!data || data.length === 0) {
      // يعني حد تاني سبقنا خلال الميلي ثانية
      return { success: false, error: 'race_lost', message: 'تم استخدام الرابط للتو' };
    }
  } catch (e) {
    return { success: false, error: 'consume_exception', message: e.message };
  }

  return {
    success: true,
    username: verify.username
  };
}

// ================================================================
//  🔗 getEnterURL — بناء رابط /admin/enter من توكن
//  (مفيد للاختبار + إعادة الإرسال)
// ================================================================
export function getEnterURL(token) {
  const t = String(token || '').trim();
  if (!t) return '';
  return BASE_URL + ENTER_PATH + '?token=' + t;
}

// ================================================================
//  🧹 cleanupExpiredLoginLinks — حذف الروابط المنتهية
//  يُستدعى من Cron (مرحلة 2)
// ================================================================
export async function cleanupExpiredLoginLinks() {
  try {
    const { error } = await supabaseAdmin
      .from(TABLES.ADMIN_LOGIN_LINKS)
      .delete()
      .lt('expires_at', nowUTC());

    return { success: !error, error: error ? error.message : null };
  } catch (e) {
    return { success: false, error: e.message };
  }
}