// ================================================================
//  lib/admin/link-codes.js — أكواد ربط تليجرام بالمسؤولين
//  - توليد كود LINK-XXXX-XXXX (صلاحية 7 أيام)
//  - كود واحد نشط لكل مسؤول (الجديد يُلغي القديم)
//  - الاستخدام مرة واحدة فقط
//  - تخزين chat_id في AdminAccounts بعد الربط
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { TABLES } from '../db/tables.js';
import { writeAuditLog } from './audit.js';

// ================================================================
//  🔧 الثوابت
// ================================================================
const BOT_USERNAME = 'KidcodeEGbot';
const CODE_TTL_MIN = 7 * 24 * 60; // 7 أيام بالدقائق

// أبجدية بدون الحروف/الأرقام المتشابهة (I, O, 0, 1)
// عشان المسؤول لو اضطر يكتبه يدويًا ميحصلش لبس
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ================================================================
//  🎲 توليد كتلة عشوائية بطول محدد من الأبجدية الآمنة
// ================================================================
function randomBlock(len) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

// ================================================================
//  🎫 generateCode — يولّد كود بصيغة LINK-XXXX-XXXX
//  (32^8 ≈ 1.1 تريليون احتمال → آمن ضد التخمين)
// ================================================================
function generateCode() {
  return 'LINK-' + randomBlock(4) + '-' + randomBlock(4);
}

// ================================================================
//  🕐 nowISO — الوقت الحالي بصيغة UTC ISO
//  (متوافق مع timestamp with time zone في Supabase)
// ================================================================
function nowISO() {
  return new Date().toISOString();
}

// ================================================================
//  🕐 futureISO — وقت مستقبلي بصيغة UTC ISO
// ================================================================
function futureISO(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

// ================================================================
//  🔗 buildTelegramLinkURL — يبني رابط تليجرام مع الـ payload
//  يفتح البوت ويبعت /start link_XXXX تلقائيًا
// ================================================================
export function buildTelegramLinkURL(code) {
  const payload = 'link_' + String(code || '').trim().toUpperCase();
  return 'https://t.me/' + BOT_USERNAME + '?start=' + encodeURIComponent(payload);
}

// ================================================================
//  🆕 generateLinkCode — توليد كود جديد لمسؤول
//  - يُلغي أي أكواد نشطة سابقة لنفس المسؤول
//  - يُرجِع الكود + وقت الانتهاء + رابط تليجرام جاهز
// ================================================================
export async function generateLinkCode(username, createdBy) {
  const uname = String(username || '').trim();
  if (!uname) return { success: false, error: 'missing_username' };

  const by = String(createdBy || 'system').trim();

  // 1. إلغاء كل الأكواد النشطة السابقة لنفس المسؤول
  try {
    await supabaseAdmin
      .from(TABLES.ADMIN_LINK_CODES)
      .update({ used: 'نعم', used_at: nowISO() })
      .eq('username', uname)
      .eq('used', 'لا');
  } catch (e) {
    // نكمل — إلغاء القديم ليس حرجًا
  }

  // 2. توليد كود فريد (محاولات متعددة لتفادي التصادم)
  let code = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateCode();
    try {
      const { data } = await supabaseAdmin
        .from(TABLES.ADMIN_LINK_CODES)
        .select('code')
        .eq('code', candidate)
        .maybeSingle();

      if (!data) {
        code = candidate;
        break;
      }
    } catch (e) {
      // نكمل المحاولة التالية
    }
  }

  if (!code) {
    return { success: false, error: 'code_collision', message: 'تعذر توليد كود فريد' };
  }

  // 3. الإدراج في قاعدة البيانات
  const expiresAt = futureISO(CODE_TTL_MIN);

  const { error: insertErr } = await supabaseAdmin
    .from(TABLES.ADMIN_LINK_CODES)
    .insert({
      code: code,
      username: uname,
      expires_at: expiresAt,
      used: 'لا',
      created_by: by,
      created_at: nowISO()
    });

  if (insertErr) {
    return { success: false, error: 'db_insert_failed', message: insertErr.message };
  }

  // 4. Audit Log (best-effort)
  try {
    await writeAuditLog({
      username: by,
      action: 'admin_link_code_generated',
      target_table: TABLES.ADMINS,
      target_id: uname
    });
  } catch (e) {}

  return {
    success: true,
    code: code,
    expiresAt: expiresAt,
    telegramURL: buildTelegramLinkURL(code)
  };
}

// ================================================================
//  🔍 verifyLinkCode — التحقق من صلاحية كود (بدون استهلاك)
//  يُرجِع بيانات المسؤول لو الكود صالح
// ================================================================
export async function verifyLinkCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return { success: false, error: 'missing_code', message: 'الكود مطلوب' };

  let row = null;
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.ADMIN_LINK_CODES)
      .select('code,username,expires_at,used,used_at')
      .eq('code', c)
      .maybeSingle();

    if (error) return { success: false, error: 'db_error', message: error.message };
    row = data;
  } catch (e) {
    return { success: false, error: 'db_exception', message: e.message };
  }

  if (!row) {
    return { success: false, error: 'invalid_code', message: 'الكود غير صحيح' };
  }

  if (String(row.used || '').trim() === 'نعم') {
    return { success: false, error: 'used_code', message: 'الكود مُستخدم بالفعل' };
  }

  const expiresMs = new Date(row.expires_at).getTime();
  if (isNaN(expiresMs) || Date.now() >= expiresMs) {
    return { success: false, error: 'expired_code', message: 'انتهت صلاحية الكود' };
  }

  return {
    success: true,
    username: String(row.username || '').trim(),
    expiresAt: row.expires_at
  };
}

// ================================================================
//  ✅ consumeLinkCode — استهلاك الكود وربط chat_id بالمسؤول
//  - يتحقق من الكود
//  - يعلّمه كمستخدم
//  - يحدّث AdminAccounts.telegram_chat_id
// ================================================================
export async function consumeLinkCode(code, chatId) {
  const c = String(code || '').trim().toUpperCase();
  const cid = String(chatId || '').trim();

  if (!cid) return { success: false, error: 'missing_chat_id' };

  // 1. تحقق أولي
  const verify = await verifyLinkCode(c);
  if (!verify.success) return verify;

  const username = verify.username;

  // 2. تعليم الكود كمستخدم (ذرّي: فقط لو لسه 'لا')
  try {
    const { error: useErr } = await supabaseAdmin
      .from(TABLES.ADMIN_LINK_CODES)
      .update({
        used: 'نعم',
        used_at: nowISO(),
        used_chat_id: cid
      })
      .eq('code', c)
      .eq('used', 'لا');

    if (useErr) {
      return { success: false, error: 'consume_failed', message: useErr.message };
    }
  } catch (e) {
    return { success: false, error: 'consume_exception', message: e.message };
  }

  // 3. تحديث AdminAccounts — ربط chat_id
  try {
    const { error: linkErr } = await supabaseAdmin
      .from(TABLES.ADMINS)
      .update({
        telegram_chat_id: cid,
        telegram_linked_at: nowISO()
      })
      .eq('username', username);

    if (linkErr) {
      return { success: false, error: 'link_failed', message: linkErr.message };
    }
  } catch (e) {
    return { success: false, error: 'link_exception', message: e.message };
  }

  // 4. Audit Log (best-effort)
  try {
    await writeAuditLog({
      username: username,
      action: 'admin_telegram_linked',
      target_table: TABLES.ADMINS,
      target_id: username,
      changes: { chat_id: cid }
    });
  } catch (e) {}

  return {
    success: true,
    username: username,
    chatId: cid
  };
}

// ================================================================
//  👤 getAdminByChatId — جلب مسؤول من chat_id تليجرام
//  يُستخدم في Webhook لمعرفة مين بيبعت الأمر
// ================================================================
export async function getAdminByChatId(chatId) {
  const cid = String(chatId || '').trim();
  if (!cid) return null;

  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.ADMINS)
      .select('username,full_name,is_active,permissions,telegram_chat_id,telegram_linked_at')
      .eq('telegram_chat_id', cid)
      .maybeSingle();

    if (error || !data) return null;
    return data;
  } catch (e) {
    return null;
  }
}

// ================================================================
//  🔍 isAdminLinked — هل المسؤول مربوط بتليجرام؟
// ================================================================
export async function isAdminLinked(username) {
  const uname = String(username || '').trim();
  if (!uname) return false;

  try {
    const { data } = await supabaseAdmin
      .from(TABLES.ADMINS)
      .select('telegram_chat_id')
      .eq('username', uname)
      .maybeSingle();

    return !!(data && String(data.telegram_chat_id || '').trim());
  } catch (e) {
    return false;
  }
}

// ================================================================
//  🆘 generateBootstrapCode — كود ربط super_admin الأولي
//  - صيغة أطول: BOOT-XXXX-XXXX-XXXX (12 حرف)
//  - صلاحية 24 ساعة
//  - مرة واحدة فقط
//  - يُستدعى فقط من initSuperAdmin
// ================================================================
export async function generateBootstrapCode() {
  // 1. إلغاء أي bootstrap codes نشطة سابقة (احتياطي)
  try {
    await supabaseAdmin
      .from(TABLES.ADMIN_LINK_CODES)
      .update({ used: 'نعم', used_at: nowISO() })
      .eq('username', 'super_admin')
      .eq('used', 'لا');
  } catch (e) {}

  // 2. توليد كود فريد (12 حرف بدل 8)
  let code = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = 'BOOT-' + randomBlock(4) + '-' + randomBlock(4) + '-' + randomBlock(4);
    try {
      const { data } = await supabaseAdmin
        .from(TABLES.ADMIN_LINK_CODES)
        .select('code')
        .eq('code', candidate)
        .maybeSingle();

      if (!data) { code = candidate; break; }
    } catch (e) {}
  }

  if (!code) {
    return { success: false, error: 'code_collision' };
  }

  // 3. إدراج الكود (صلاحية 24 ساعة)
  const expiresAt = futureISO(24 * 60); // 1440 دقيقة

  const { error } = await supabaseAdmin
    .from(TABLES.ADMIN_LINK_CODES)
    .insert({
      code: code,
      username: 'super_admin',
      expires_at: expiresAt,
      used: 'لا',
      created_by: 'system',
      created_at: nowISO()
    });

  if (error) return { success: false, error: error.message };

  return { success: true, code: code, expiresAt: expiresAt };
}

// ================================================================
//  🧹 cleanupExpiredLinkCodes — حذف الأكواد المنتهية (اختياري)
//  يُستدعى من Cron (مرحلة 2)
// ================================================================
export async function cleanupExpiredLinkCodes() {
  try {
    const { error } = await supabaseAdmin
      .from(TABLES.ADMIN_LINK_CODES)
      .delete()
      .lt('expires_at', nowISO())
      .eq('used', 'نعم');

    return { success: !error, error: error ? error.message : null };
  } catch (e) {
    return { success: false, error: e.message };
  }
}