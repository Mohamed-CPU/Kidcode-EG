// ================================================================
//  lib/db/marketer-write.js — دوال كتابة المسوقين (Supabase)
//  ⚠️ بعد Migration: كل الأعمدة الزمنية timestamptz
//  ✅ الكتابة: nowUTC() / futureUTC() | العرض: formatCairoDateTime()
//  🐛 Fix: '' في timestamptz كان بيسبب خطأ → استبدلناها بـ null
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_MARKETERS, COLS_WITHDRAW } from './tables.js';
import {
  sendMarketerWelcomeEmail,
  sendMarketerResetEmail,
  sendMarketerWithdrawRequestEmail,
  sendWithdrawConfirmationToMarketer
} from '../email/brevo.js';
import { generateShortCode } from '../telegram.js';
import { sendMarketerPasswordOTP, calculateMarketerTotals, notifyMarketerWithdrawStatus } from '../marketer-notify.js';
import { cacheGet, cachePut } from '../cache.js';

// ============================================================
//  🕐 دوال الوقت
// ============================================================
function nowUTC() {
  // للكتابة في timestamptz
  return new Date().toISOString();
}

function futureUTC(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

// للعرض فقط (Cairo display)
function formatCairoDateTime(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).replace('T', ' ');
}

// ============================================================
//  🔐 Hash helpers (نفس منطق GAS — salt$hash)
// ============================================================
function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Invalid password');
  }
  const salt = crypto.randomBytes(12).toString('hex').substring(0, 16);
  const digest = crypto.createHash('sha256').update(salt + password).digest('base64');
  return salt + '$' + digest;
}

// 🆕 التحقق من كلمة سر ضد hash مخزّن (salt$hash)
function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;

  const strHash = String(storedHash).trim();

  if (strHash.indexOf('$') !== -1) {
    const parts = strHash.split('$');
    if (parts.length !== 2) return false;
    const salt = parts[0];
    const expectedHash = parts[1];
    const inputHash = crypto
      .createHash('sha256')
      .update(salt + password)
      .digest('base64');
    return inputHash === expectedHash;
  }

  // صيغة قديمة (بدون salt)
  const legacyHash = crypto
    .createHash('sha256')
    .update(password)
    .digest('base64');
  return legacyHash === strHash;
}

// 🆕 فحص قوة كلمة السر (نفس منطق الفرونت)
function validatePasswordStrength(pwd) {
  if (typeof pwd !== 'string') return false;
  return pwd.length >= 8
    && /[A-Za-z]/.test(pwd)
    && /[0-9]/.test(pwd)
    && /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(pwd)
    && !/[\u0600-\u06FF]/.test(pwd);
}

// 🆕 مسح كل حقول OTP
async function clearOtpFields(code) {
  try {
    await supabaseAdmin
      .from(TABLES.MARKETERS)
      .update({
        [COLS_MARKETERS.password_otp]: null,
        [COLS_MARKETERS.password_otp_expires]: null,
        [COLS_MARKETERS.password_pending_hash]: null,
        [COLS_MARKETERS.password_otp_attempts]: 0
      })
      .eq(COLS_MARKETERS.code, code);
  } catch (e) {
    console.warn(`⚠️ [clearOtpFields] ${code}:`, e.message);
  }
}

// 🆕 توليد OTP رقمي 6 أرقام
function generateOTP() {
  return String(Math.floor(Math.random() * 900000) + 100000);
}

// ============================================================
//  🔢 generateUniqueMarketerCode — MA + 4 أرقام
// ============================================================
async function generateUniqueMarketerCode() {
  for (let i = 0; i < 100; i++) {
    const num = Math.floor(Math.random() * 9000) + 1000;
    const code = 'MA' + num;
    const { data } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .select('code')
      .eq('code', code)
      .maybeSingle();
    if (!data) return code;
  }
  throw new Error('تعذر إنشاء كود فريد للمسوق');
}

// ============================================================
//  1️⃣ registerMarketer
// ============================================================
export async function registerMarketer(params) {
  try {
    const name = String(params.name || '').trim();
    const phone = String(params.phone || '').trim();
    const email = String(params.email || '').trim().toLowerCase();
    const governorate = String(params.governorate || '').trim();
    const password = String(params.password || '').trim();
    const confirm = String(params.confirmPassword || '').trim();

    const methodRaw = String(params.notificationMethod || 'email').trim().toLowerCase();
    const finalMethod = ['telegram', 'email'].includes(methodRaw) ? methodRaw : 'email';

    // 1. Validation
    if (!name) return { success: false, error: 'الاسم مطلوب' };
    if (!phone || phone.replace(/\D/g, '').length < 10) {
      return { success: false, error: 'رقم هاتف غير صحيح' };
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { success: false, error: 'بريد إلكتروني غير صحيح' };
    }
    if (!governorate) return { success: false, error: 'المحافظة مطلوبة' };
    if (password.length < 8) {
      return { success: false, error: 'كلمة السر يجب أن تكون 8 أحرف على الأقل' };
    }
    if (password !== confirm) {
      return { success: false, error: 'كلمة السر غير متطابقة مع تأكيدها' };
    }

    const t0 = Date.now();

    // 2. فحص التكرار (email + phone)
    const { data: dup } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .select('code,email,phone')
      .or(`email.eq.${email},phone.eq.${phone}`)
      .limit(1);

    if (dup && dup.length > 0) {
      if (String(dup[0].email || '').toLowerCase() === email) {
        return { success: false, error: 'هذا البريد الإلكتروني مسجل بالفعل' };
      }
      return { success: false, error: 'رقم الهاتف مسجل بالفعل' };
    }

    // 3. كود فريد
    const code = await generateUniqueMarketerCode();

    // 4. Hash + INSERT
    const hashedPassword = hashPassword(password);
    // ✅ UTC ISO
    const now = nowUTC();

    const { error: insertError } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .insert({
        code: code,
        name: name,
        phone: phone,
        email: email,
        governorate: governorate,
        password_hash: hashedPassword,
        reset_token: '',
        // 🐛 Fix: كان '' → timestamptz يرفضها. نستخدم null
        reset_token_expiry: null,
        discount_percent: 10,
        is_active: 'نشط',
        created_at: now,
        telegram_chat_id: '',
        // 🐛 Fix: كان '' → timestamptz يرفضها. نستخدم null
        telegram_linked_at: null,
        notification_method: finalMethod
      });

    if (insertError) {
      console.error(`❌ [registerMarketer] ${code} (${Date.now() - t0}ms)`, insertError.message);
      return { success: false, error: insertError.message };
    }

    console.log(`✅ [registerMarketer] ${code} | ${name} | method: ${finalMethod} (${Date.now() - t0}ms)`);

    // 5. إيميل الترحيب (best-effort)
    try {
      await sendMarketerWelcomeEmail(email, name, code, finalMethod);
    } catch (e) {
      console.error('⚠️ [registerMarketer] welcome email error:', e.message);
    }

    // 6. نجاح
    return {
      success: true,
      message: 'تم إنشاء الحساب بنجاح! سيصلك بريد تأكيد قريباً.',
      code: code,
      name: name,
      email: email,
      notificationMethod: finalMethod
    };

  } catch (err) {
    console.error('❌ [registerMarketer]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  2️⃣ marketerForgotPassword
// ============================================================
export async function marketerForgotPassword(params) {
  try {
    const code = String(params.code || '').trim().toUpperCase();
    if (!code) return { success: false, error: 'يرجى إدخال كود المسوق' };

    const t0 = Date.now();

    // 1. جيب المسوق
    const { data: marketer, error } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .select('*')
      .eq(COLS_MARKETERS.code, code)
      .maybeSingle();

    if (error) return { success: false, error: error.message };
    if (!marketer) return { success: false, error: 'الكود غير صحيح أو غير مسجل' };

    const email = String(marketer[COLS_MARKETERS.email] || '').trim();
    const name = String(marketer[COLS_MARKETERS.name] || 'مسوق').trim();

    if (!email) {
      return { success: false, error: 'لا يوجد بريد إلكتروني مسجل لهذا المسوق' };
    }

    // 2. token + expiry (ساعة) — ✅ UTC ISO
    const resetToken = crypto.randomUUID().replace(/-/g, '').substring(0, 32);
    const expiry = futureUTC(60);

    // 3. UPDATE
    const { error: updateError } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .update({
        [COLS_MARKETERS.reset_token]: resetToken,
        [COLS_MARKETERS.reset_token_expiry]: expiry
      })
      .eq(COLS_MARKETERS.code, code);

    if (updateError) return { success: false, error: updateError.message };

    // 4. إيميل
    const resetLink = 'https://www.kidcode-eg.com/marketer-reset-password.html?token=' + resetToken;

    try {
      await sendMarketerResetEmail(email, name, code, resetLink);
    } catch (e) {
      console.error('⚠️ [marketerForgotPassword] email error:', e.message);
    }

    console.log(`✅ [marketerForgotPassword] ${code} (${Date.now() - t0}ms)`);

    return {
      success: true,
      message: 'تم إرسال رابط إعادة التعيين إلى بريدك الإلكتروني.'
    };

  } catch (err) {
    console.error('❌ [marketerForgotPassword]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  3️⃣ marketerResetPassword
//  ✅ مقارنة Date.getTime() بدل مقارنة نصية
// ============================================================
export async function marketerResetPassword(params) {
  try {
    const token = String(params.token || '').trim();
    const newPassword = String(params.newPassword || '').trim();
    const confirmPassword = String(params.confirmPassword || '').trim();

    if (!token) return { success: false, error: 'رمز إعادة التعيين مطلوب' };
    if (newPassword.length < 8) {
      return { success: false, error: 'كلمة السر يجب أن تكون 8 أحرف على الأقل' };
    }
    if (newPassword !== confirmPassword) {
      return { success: false, error: 'كلمة السر غير متطابقة مع تأكيدها' };
    }

    const t0 = Date.now();

    // 1. دوّر على المسوق بالتوكن
    const { data: marketer, error } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .select('*')
      .eq(COLS_MARKETERS.reset_token, token)
      .maybeSingle();

    if (error) return { success: false, error: error.message };
    if (!marketer) return { success: false, error: 'رمز إعادة التعيين غير صالح' };

    // 2. فحص expiry — ✅ مقارنة Date
    const expiryRaw = marketer[COLS_MARKETERS.reset_token_expiry];
    if (!expiryRaw) return { success: false, error: 'رمز إعادة التعيين غير صالح' };

    const expiryDate = new Date(expiryRaw);
    if (isNaN(expiryDate.getTime()) || Date.now() > expiryDate.getTime()) {
      return { success: false, error: 'انتهت صلاحية رابط إعادة التعيين، يرجى طلب رابط جديد' };
    }

    // 3. hash + UPDATE
    const hashed = hashPassword(newPassword);

    const { error: updateError } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .update({
        [COLS_MARKETERS.password_hash]: hashed,
        [COLS_MARKETERS.reset_token]: '',
        // 🐛 Fix: كان '' → timestamptz يرفضها. نستخدم null
        [COLS_MARKETERS.reset_token_expiry]: null
      })
      .eq(COLS_MARKETERS.code, marketer[COLS_MARKETERS.code]);

    if (updateError) return { success: false, error: updateError.message };

    console.log(`✅ [marketerResetPassword] ${marketer[COLS_MARKETERS.code]} (${Date.now() - t0}ms)`);

    return {
      success: true,
      message: 'تم تحديث كلمة السر بنجاح، يمكنك تسجيل الدخول الآن.'
    };

  } catch (err) {
    console.error('❌ [marketerResetPassword]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  4️⃣ getMarketerTelegramStatus
//  ✅ linkedAt = Cairo display (مش ISO خام)
// ============================================================
export async function getMarketerTelegramStatus(params) {
  const code = String(params.marketerCode || params.code || '').trim().toUpperCase();
  if (!code) return { success: false, error: 'marketer_code_missing' };

  const { data, error } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .select('telegram_chat_id,telegram_linked_at,notification_method')
    .eq(COLS_MARKETERS.code, code)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: 'marketer_not_found' };

  const chatId = String(data.telegram_chat_id || '').trim();
  // ✅ Cairo display — للعرض في الواجهة
  const linkedAt = formatCairoDateTime(data.telegram_linked_at);
  const method = String(data.notification_method || 'email').trim() || 'email';

  return {
    success: true,
    isLinked: !!chatId,
    chatId: chatId || null,
    linkedAt: linkedAt || null,
    notificationMethod: method
  };
}

// ============================================================
//  5️⃣ generateMarketerLinkToken
//  ✅ nowUTC() + futureUTC(10)
// ============================================================
export async function generateMarketerLinkToken(params) {
  const code = String(params.marketerCode || params.code || '').trim().toUpperCase();
  if (!code) return { success: false, error: 'marketer_code_missing' };

  const t0 = Date.now();

  // 1. جيب المسوق
  const { data: marketer, error } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .select('*')
    .eq(COLS_MARKETERS.code, code)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!marketer) return { success: false, error: 'marketer_not_found', message: 'المسوق غير موجود' };

  // 2. حالة الحساب
  const isActive = String(marketer[COLS_MARKETERS.is_active] || '').trim();
  if (isActive !== 'نشط') {
    return { success: false, error: 'marketer_inactive', message: 'حساب المسوق غير نشط' };
  }

  // 3. مربوط بالفعل؟
  const existingChat = String(marketer[COLS_MARKETERS.telegram_chat_id] || '').trim();
  if (existingChat) {
    return { success: false, error: 'already_linked', message: 'حساب المسوق مربوط بتليجرام بالفعل' };
  }

  // 4. توليد التوكن M_ + 10 chars — ✅ UTC ISO
  const token = 'M_' + generateShortCode(10);
  const expiresAt = futureUTC(10);

  // 5. INSERT في TelegramPendingLinks — ✅ UTC ISO
  const { error: insertError } = await supabaseAdmin
    .from(TABLES.PENDING_LINKS)
    .insert({
      token: token,
      child_id: code,
      created_at: nowUTC(),
      expires_at: expiresAt,
      status: 'pending',
      parent_type: '',
      user_type: 'marketer'
    });

  if (insertError) {
    console.error(`❌ [generateMarketerLinkToken] ${code} (${Date.now() - t0}ms)`, insertError.message);
    return { success: false, error: insertError.message };
  }

  const deepLink = 'https://t.me/KidcodeEGbot?start=' + token;

  console.log(`✅ [generateMarketerLinkToken] ${code} | token: ${token} (${Date.now() - t0}ms)`);

  return {
    success: true,
    token: token,
    deepLink: deepLink,
    expiresAt: expiresAt,
    marketerName: String(marketer[COLS_MARKETERS.name] || '').trim(),
    marketerCode: code,
    userType: 'marketer'
  };
}

// ============================================================
//  6️⃣ unlinkMarketerTelegram
//  🐛 Fix: telegram_linked_at = null (مش '')
// ============================================================
export async function unlinkMarketerTelegram(params) {
  const code = String(params.marketerCode || params.code || '').trim().toUpperCase();
  if (!code) return { success: false, error: 'marketer_code_missing' };

  const t0 = Date.now();

  const { error } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .update({
      [COLS_MARKETERS.telegram_chat_id]: '',
      // 🐛 Fix: كان '' → timestamptz يرفضها
      [COLS_MARKETERS.telegram_linked_at]: null,
      [COLS_MARKETERS.notification_method]: 'email'
    })
    .eq(COLS_MARKETERS.code, code);

  if (error) return { success: false, error: error.message };

  // تحديث PendingLinks
  try {
    await supabaseAdmin
      .from(TABLES.PENDING_LINKS)
      .update({ status: 'unlinked' })
      .eq('child_id', code)
      .eq('user_type', 'marketer')
      .in('status', ['pending', 'linked']);
  } catch (e) {}

  console.log(`✅ [unlinkMarketerTelegram] ${code} (${Date.now() - t0}ms)`);
  return { success: true, message: 'تم فك الربط بنجاح' };
}

// ============================================================
//  7️⃣ setMarketerNotificationMethod
// ============================================================
export async function setMarketerNotificationMethod(params) {
  const code = String(params.marketerCode || params.code || '').trim().toUpperCase();
  const method = String(params.method || '').trim().toLowerCase();

  if (!code) return { success: false, error: 'marketer_code_missing' };
  if (!['telegram', 'email'].includes(method)) {
    return { success: false, error: 'invalid_method' };
  }

  const { data: marketer, error } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .select('telegram_chat_id')
    .eq(COLS_MARKETERS.code, code)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!marketer) return { success: false, error: 'marketer_not_found' };

  // لو telegram → يجب chat_id
  const chatId = String(marketer[COLS_MARKETERS.telegram_chat_id] || '').trim();
  if (method === 'telegram' && !chatId) {
    return { success: false, error: 'not_linked', message: 'يجب ربط تليجرام أولاً' };
  }

  const { error: updateError } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .update({ [COLS_MARKETERS.notification_method]: method })
    .eq(COLS_MARKETERS.code, code);

  if (updateError) return { success: false, error: updateError.message };

  console.log(`✅ [setMarketerNotificationMethod] ${code} → ${method}`);
  return { success: true, method: method };
}

// ============================================================
//  8️⃣ marketerDeleteAccount — حذف حساب المسوق (Soft Delete)
//  🐛 Fix: telegram_linked_at = null (مش '')
// ============================================================
export async function marketerDeleteAccount(params) {
  const code = String(params.code || '').trim().toUpperCase();
  const confirm = String(params.confirm || '').trim();

  // 1. تحقق من المدخلات
  if (!code) {
    return { success: false, error: 'كود المسوق مطلوب' };
  }
  if (confirm !== 'DELETE') {
    return { success: false, error: 'يجب كتابة DELETE (أحرف كبيرة) للتأكيد' };
  }

  const t0 = Date.now();

  // 2. جيب المسوق
  const { data: marketer, error } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .select('*')
    .eq(COLS_MARKETERS.code, code)
    .maybeSingle();

  if (error) {
    console.error(`❌ [marketerDeleteAccount] ${code} (${Date.now() - t0}ms)`, error.message);
    return { success: false, error: error.message };
  }
  if (!marketer) {
    return { success: false, error: 'الكود غير موجود أو تم حذفه مسبقاً' };
  }

  const marketerName = String(marketer[COLS_MARKETERS.name] || 'غير معروف').trim();

  // 3. حدّث is_active = 'محذوف'
  const { error: updateError } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .update({
      [COLS_MARKETERS.is_active]: 'محذوف',
      [COLS_MARKETERS.telegram_chat_id]: '',
      // 🐛 Fix: كان '' → timestamptz يرفضها
      [COLS_MARKETERS.telegram_linked_at]: null,
      [COLS_MARKETERS.notification_method]: 'email'
    })
    .eq(COLS_MARKETERS.code, code);

  if (updateError) {
    console.error(`❌ [marketerDeleteAccount] update (${Date.now() - t0}ms)`, updateError.message);
    return { success: false, error: updateError.message };
  }

  // 4. حدّث PendingLinks
  try {
    await supabaseAdmin
      .from(TABLES.PENDING_LINKS)
      .update({ status: 'unlinked' })
      .eq('child_id', code)
      .eq('user_type', 'marketer')
      .in('status', ['pending', 'linked']);
  } catch (e) {
    console.warn('⚠️ [marketerDeleteAccount] pending links:', e.message);
  }

  console.log(`🗑️ [marketerDeleteAccount] ${code} — ${marketerName} (${Date.now() - t0}ms)`);

  // 5. نجاح
  return {
    success: true,
    message: `تم حذف حساب المسوق (${code}) بنجاح`
  };
}

// ============================================================
//  📝 markTelegramReminderSent — تحديث حقول التذكير
//  ✅ nowUTC() لـ last_telegram_reminder_at
// ============================================================
export async function markTelegramReminderSent(code) {
  const cleanCode = String(code || '').trim().toUpperCase();
  if (!cleanCode) return { success: false, error: 'code_missing' };

  try {
    // 1. اقرأ العدّاد الحالي
    const { data: marketer, error: readError } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .select('telegram_reminder_count')
      .eq(COLS_MARKETERS.code, cleanCode)
      .maybeSingle();

    if (readError) return { success: false, error: readError.message };
    if (!marketer) return { success: false, error: 'marketer_not_found' };

    const currentCount = parseInt(marketer.telegram_reminder_count || '0', 10);
    const newCount = currentCount + 1;

    // 2. حدّث الحقول — ✅ UTC ISO
    const { error: updateError } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .update({
        last_telegram_reminder_at: nowUTC(),
        telegram_reminder_count: newCount
      })
      .eq(COLS_MARKETERS.code, cleanCode);

    if (updateError) return { success: false, error: updateError.message };

    console.log(`📝 [markTelegramReminderSent] ${cleanCode} → #${newCount}`);
    return { success: true, newCount: newCount };

  } catch (err) {
    console.error(`❌ [markTelegramReminderSent] ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  🔐 9️⃣ requestPasswordChangeOTP
//  - التحقق من كلمة السر الحالية
//  - توليد OTP + إرسالها عبر القناة المختارة
//  - تخزين OTP hash + pending password hash
// ============================================================
export async function requestPasswordChangeOTP(params) {
  try {
    const cleanCode = String(params.marketerCode || '').trim().toUpperCase();
    const currentPassword = String(params.currentPassword || '').trim();
    const newPassword = String(params.newPassword || '').trim();

    // 1. التحقق من المدخلات
    if (!cleanCode) return { success: false, error: 'كود المسوق مطلوب' };
    if (!currentPassword) return { success: false, error: 'كلمة السر الحالية مطلوبة' };
    if (!newPassword) return { success: false, error: 'كلمة السر الجديدة مطلوبة' };
    if (!validatePasswordStrength(newPassword)) {
      return {
        success: false,
        error: 'كلمة السر لا تحقق الشروط (8+ أحرف، حرف + رقم + رمز خاص)'
      };
    }
    if (currentPassword === newPassword) {
      return { success: false, error: 'كلمة السر الجديدة يجب أن تكون مختلفة عن الحالية' };
    }

    // 2. Rate limit — منع طلبات متكررة سريعة (45 ثانية)
    const rateKey = 'otp_req_mk:' + cleanCode;
    if (cacheGet(rateKey)) {
      return {
        success: false,
        error: 'rate_limited',
        message: 'يرجى الانتظار قليلاً قبل طلب رمز جديد'
      };
    }

    // 3. جيب المسوق
    const { data: marketer, error: readError } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .select('*')
      .eq(COLS_MARKETERS.code, cleanCode)
      .maybeSingle();

    if (readError) return { success: false, error: readError.message };
    if (!marketer) return { success: false, error: 'الكود غير صحيح أو غير مسجل' };

    const isActive = String(marketer[COLS_MARKETERS.is_active] || '').trim();
    if (isActive !== 'نشط') {
      return { success: false, error: 'الحساب غير نشط، يرجى التواصل مع الدعم' };
    }

    // 4. تحقق من كلمة السر الحالية
    const storedHash = marketer[COLS_MARKETERS.password_hash] || '';
    if (!verifyPassword(currentPassword, storedHash)) {
      return { success: false, error: 'كلمة السر الحالية غير صحيحة' };
    }

    // 5. تحقق من قناة الإشعارات
    const method = String(marketer[COLS_MARKETERS.notification_method] || 'email').trim().toLowerCase();
    const chatId = String(marketer[COLS_MARKETERS.telegram_chat_id] || '').trim();
    const email = String(marketer[COLS_MARKETERS.email] || '').trim();

    if (method === 'telegram' && !chatId) {
      return {
        success: false,
        error: 'not_linked',
        message: 'تليجرام غير مربوط — يرجى ربطه أولاً أو تحويل الإرسال للبريد'
      };
    }
    if (method === 'email' && !email) {
      return {
        success: false,
        error: 'no_email',
        message: 'لا يوجد بريد إلكتروني مسجل — يرجى التواصل مع الدعم'
      };
    }

    // 6. توليد OTP + Hash
    const otp = generateOTP();
    const otpHash = hashPassword(otp);
    const pendingHash = hashPassword(newPassword);
    const expiresAt = futureUTC(5); // 5 دقائق

    // 7. حفظ في DB (قبل الإرسال لضمان الاتساق)
    const { error: updateError } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .update({
        [COLS_MARKETERS.password_otp]: otpHash,
        [COLS_MARKETERS.password_otp_expires]: expiresAt,
        [COLS_MARKETERS.password_pending_hash]: pendingHash,
        [COLS_MARKETERS.password_otp_attempts]: 0
      })
      .eq(COLS_MARKETERS.code, cleanCode);

    if (updateError) {
      console.error(`❌ [requestPasswordChangeOTP] ${cleanCode} DB:`, updateError.message);
      return { success: false, error: updateError.message };
    }

    // 8. إرسال OTP
    const notifyResult = await sendMarketerPasswordOTP(marketer, otp, 5);

    if (!notifyResult.success) {
      // فشل الإرسال → نظّف الحقول وأبلغ المستخدم
      await clearOtpFields(cleanCode);
      return {
        success: false,
        error: 'send_failed',
        message: 'تعذر إرسال رمز التحقق. حاول مرة أخرى أو غيّر القناة.'
      };
    }

    // 9. نجاح — وضع Rate Limit
    cachePut(rateKey, 1, 45);

    console.log(`✅ [requestPasswordChangeOTP] ${cleanCode} | channel: ${notifyResult.channel}`);

    return {
      success: true,
      channel: notifyResult.channel,
      expiresInSeconds: 300,
      message: 'تم إرسال رمز التحقق'
    };

  } catch (err) {
    console.error('❌ [requestPasswordChangeOTP]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  🔐 🔟 confirmPasswordChange
//  - التحقق من OTP
//  - مقارنة كلمة السر الجديدة مع pending hash
//  - حفظ كلمة السر + تنظيف
// ============================================================
export async function confirmPasswordChange(params) {
  try {
    const cleanCode = String(params.marketerCode || '').trim().toUpperCase();
    const otp = String(params.otp || '').trim();
    const newPassword = String(params.newPassword || '').trim();

    // 1. التحقق من المدخلات
    if (!cleanCode) return { success: false, error: 'كود المسوق مطلوب' };
    if (!otp || !/^\d{6}$/.test(otp)) {
      return { success: false, error: 'رمز التحقق يجب أن يكون 6 أرقام' };
    }
    if (!newPassword) return { success: false, error: 'كلمة السر الجديدة مطلوبة' };
    if (!validatePasswordStrength(newPassword)) {
      return { success: false, error: 'كلمة السر لا تحقق الشروط' };
    }

    // 2. جيب المسوق
    const { data: marketer, error: readError } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .select('*')
      .eq(COLS_MARKETERS.code, cleanCode)
      .maybeSingle();

    if (readError) return { success: false, error: readError.message };
    if (!marketer) return { success: false, error: 'الكود غير صحيح أو غير مسجل' };

    // 3. تحقق من وجود OTP
    const storedOtpHash = marketer[COLS_MARKETERS.password_otp];
    const expiresRaw = marketer[COLS_MARKETERS.password_otp_expires];
    const pendingHash = marketer[COLS_MARKETERS.password_pending_hash];

    if (!storedOtpHash || !expiresRaw || !pendingHash) {
      return { success: false, error: 'لا يوجد طلب تغيير كلمة سر قيد التنفيذ' };
    }

    // 4. تحقق من expiry
    const expiresDate = new Date(expiresRaw);
    if (isNaN(expiresDate.getTime()) || Date.now() > expiresDate.getTime()) {
      await clearOtpFields(cleanCode);
      return { success: false, error: 'انتهت صلاحية رمز التحقق، يرجى طلب رمز جديد' };
    }

    // 5. تحقق من عدد المحاولات (حد أقصى 5)
    const attempts = parseInt(marketer[COLS_MARKETERS.password_otp_attempts] || '0', 10);
    if (attempts >= 5) {
      await clearOtpFields(cleanCode);
      return {
        success: false,
        error: 'too_many_attempts',
        message: 'تجاوزت عدد المحاولات المسموح — يرجى طلب رمز جديد'
      };
    }

    // 6. التحقق من OTP
    if (!verifyPassword(otp, storedOtpHash)) {
      const newAttempts = attempts + 1;
      await supabaseAdmin
        .from(TABLES.MARKETERS)
        .update({ [COLS_MARKETERS.password_otp_attempts]: newAttempts })
        .eq(COLS_MARKETERS.code, cleanCode);

      console.warn(`⚠️ [confirmPasswordChange] ${cleanCode} wrong OTP (attempt ${newAttempts}/5)`);

      return {
        success: false,
        error: 'invalid_otp',
        message: 'رمز التحقق غير صحيح. باقي ' + (5 - newAttempts) + ' محاولات'
      };
    }

    // 7. تحقق من تطابق كلمة السر الجديدة مع pending hash
    if (!verifyPassword(newPassword, pendingHash)) {
      return {
        success: false,
        error: 'password_mismatch',
        message: 'كلمة السر الجديدة لا تتطابق مع الطلب الأصلي — يرجى البدء من جديد'
      };
    }

    // 8. تحديث كلمة السر + تنظيف OTP
    const { error: updateError } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .update({
        [COLS_MARKETERS.password_hash]: pendingHash,
        [COLS_MARKETERS.password_otp]: null,
        [COLS_MARKETERS.password_otp_expires]: null,
        [COLS_MARKETERS.password_pending_hash]: null,
        [COLS_MARKETERS.password_otp_attempts]: 0
      })
      .eq(COLS_MARKETERS.code, cleanCode);

    if (updateError) {
      console.error(`❌ [confirmPasswordChange] ${cleanCode} DB:`, updateError.message);
      return { success: false, error: updateError.message };
    }

    console.log(`✅ [confirmPasswordChange] ${cleanCode} — password updated`);

    return {
      success: true,
      message: 'تم تغيير كلمة السر بنجاح. يرجى تسجيل الدخول من جديد.'
    };

  } catch (err) {
    console.error('❌ [confirmPasswordChange]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  💸 1️⃣1️⃣ submitWithdrawRequest
//  - التحقق من المسوق والنشاط والرصيد
//  - Rate limit: طلب واحد كل ساعة
//  - إرسال إيميل للإدارة (sales@) + تأكيد للمسوق
// ============================================================
// ============================================================
//  🆕 generateWithdrawRequestId — رقم مرجعي بسيط (WD + 4 أرقام)
//  - Collision check: جرّب 20 مرة
//  - فشل → WD + 6 أرقام (fallback)
// ============================================================
async function generateWithdrawRequestId() {
  // 1. جرّب WD + 4 أرقام (1000-9999)
  for (let i = 0; i < 20; i++) {
    const id = 'WD' + String(Math.floor(Math.random() * 9000) + 1000);
    const { data } = await supabaseAdmin
      .from(TABLES.MARKETER_WITHDRAW_REQUESTS)
      .select(COLS_WITHDRAW.request_id)
      .eq(COLS_WITHDRAW.request_id, id)
      .maybeSingle();
    if (!data) return id;
  }

  // 2. فشل → WD + 6 أرقام (100000-999999)
  for (let i = 0; i < 20; i++) {
    const id = 'WD' + String(Math.floor(Math.random() * 900000) + 100000);
    const { data } = await supabaseAdmin
      .from(TABLES.MARKETER_WITHDRAW_REQUESTS)
      .select(COLS_WITHDRAW.request_id)
      .eq(COLS_WITHDRAW.request_id, id)
      .maybeSingle();
    if (!data) return id;
  }

  throw new Error('تعذر إنشاء رقم مرجعي فريد — حاول مرة أخرى بعد قليل');
}

// ============================================================
//  💸 submitWithdrawRequest — إرسال طلب سحب
//  - التحقق من availableBalance (بعد خصم sending + sent)
//  - إنشاء طلب في DB (قبل الإيميل)
//  - إرسال إيميل للإدارة + نسخة تأكيد للمسوق
// ============================================================
export async function submitWithdrawRequest(params) {
  try {
    const cleanCode = String(params.marketerCode || '').trim().toUpperCase();
    const amountRaw = params.amount;
    const method = String(params.method || '').trim().toLowerCase();
    const transferNumber = String(params.transferNumber || '').trim();

    // 1. التحقق من المدخلات
    if (!cleanCode) return { success: false, error: 'كود المسوق مطلوب' };

    const amount = parseInt(amountRaw, 10);
    if (!amount || amount < 1) {
      return { success: false, error: 'المبلغ غير صحيح' };
    }
    if (!['instapay', 'wallet'].includes(method)) {
      return { success: false, error: 'طريقة الاستلام غير صحيحة' };
    }
    if (!transferNumber || !/^01[0125]\d{8}$/.test(transferNumber)) {
      return { success: false, error: 'رقم التحويل غير صحيح (11 رقم يبدأ بـ 010/011/012/015)' };
    }

    // 2. Rate limit: طلب واحد كل ساعة
    const rateKey = 'withdraw_req:' + cleanCode;
    if (cacheGet(rateKey)) {
      return {
        success: false,
        error: 'rate_limited',
        message: 'لديك طلب سحب حديث — يرجى الانتظار ساعة قبل طلب جديد'
      };
    }

    // 3. جيب المسوق
    const { data: marketer, error: readError } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .select('code,name,email,is_active')
      .eq(COLS_MARKETERS.code, cleanCode)
      .maybeSingle();

    if (readError) return { success: false, error: readError.message };
    if (!marketer) return { success: false, error: 'الكود غير صحيح أو غير مسجل' };

    const isActive = String(marketer[COLS_MARKETERS.is_active] || '').trim();
    if (isActive !== 'نشط') {
      return { success: false, error: 'الحساب غير نشط، يرجى التواصل مع الدعم' };
    }

    // 4. 🆕 منع تعدد الطلبات النشطة — حماية مزدوجة
    try {
      const { data: existingActive, error: activeErr } = await supabaseAdmin
        .from(TABLES.MARKETER_WITHDRAW_REQUESTS)
        .select(COLS_WITHDRAW.request_id + ',' + COLS_WITHDRAW.status)
        .eq(COLS_WITHDRAW.marketer_code, cleanCode)
        .in(COLS_WITHDRAW.status, ['submitted', 'under_review', 'sending'])
        .order(COLS_WITHDRAW.created_at, { ascending: false })
        .limit(1);

      if (!activeErr && existingActive && existingActive.length > 0) {
        const activeReq = existingActive[0];
        const statusLabels = {
          submitted: 'تم إرسال الطلب',
          under_review: 'قيد المراجعة',
          sending: 'قيد الإرسال'
        };
        const statusLabel = statusLabels[activeReq[COLS_WITHDRAW.status]] || activeReq[COLS_WITHDRAW.status];
        const canCancel = ['submitted', 'under_review'].includes(activeReq[COLS_WITHDRAW.status]);

        console.log(`⏸️ [submitWithdrawRequest] ${cleanCode} | active request exists: ${activeReq[COLS_WITHDRAW.request_id]} (${activeReq[COLS_WITHDRAW.status]})`);

        return {
          success: false,
          error: 'active_request_exists',
          message: 'لديك طلب سحب قيد المعالجة (رقم: ' + activeReq[COLS_WITHDRAW.request_id] + ' — ' + statusLabel + '). ' +
                   (canCancel
                     ? 'يرجى الانتظار حتى يتم البت فيه، أو يمكنك إلغاؤه من تاب "طلبات السحب".'
                     : 'يرجى الانتظار حتى يتم التحويل.')
        };
      }
    } catch (e) {
      console.warn(`⚠️ [submitWithdrawRequest] active check failed:`, e.message);
    }

    // 5. احسب الرصيد المتاح (بعد خصم الطلبات النشطة)
    const totals = await calculateMarketerTotals(cleanCode);
    if (amount > totals.available) {
      return {
        success: false,
        error: 'amount_exceeds_balance',
        message: 'المبلغ يتجاوز الرصيد المتاح (' + totals.available + ' ج.م)'
      };
    }

    // 5. توليد رقم مرجعي فريد
    let requestId;
    try {
      requestId = await generateWithdrawRequestId();
    } catch (idErr) {
      console.error('❌ [submitWithdrawRequest] id generation:', idErr.message);
      return {
        success: false,
        error: 'id_generation_failed',
        message: 'تعذر إنشاء رقم مرجعي — حاول مرة أخرى بعد قليل'
      };
    }

    const marketerName = String(marketer[COLS_MARKETERS.name] || 'مسوق').trim();
    const marketerEmail = String(marketer[COLS_MARKETERS.email] || '').trim();
    const methodLabel = method === 'instapay' ? 'انستاباي' : 'محفظة إلكترونية';
    const now = nowUTC();

    // 6. حفظ في DB (قبل الإرسال — لضمان حفظ الطلب)
    const { error: insertErr } = await supabaseAdmin
      .from(TABLES.MARKETER_WITHDRAW_REQUESTS)
      .insert({
        [COLS_WITHDRAW.request_id]: requestId,
        [COLS_WITHDRAW.marketer_code]: cleanCode,
        [COLS_WITHDRAW.marketer_name]: marketerName,
        [COLS_WITHDRAW.marketer_email]: marketerEmail,
        [COLS_WITHDRAW.amount]: amount,
        [COLS_WITHDRAW.method]: method,
        [COLS_WITHDRAW.transfer_number]: transferNumber,
        [COLS_WITHDRAW.status]: 'submitted',
        [COLS_WITHDRAW.created_at]: now,
        [COLS_WITHDRAW.updated_at]: now
      });

    if (insertErr) {
      console.error(`❌ [submitWithdrawRequest] DB insert:`, insertErr.message);
      return {
        success: false,
        error: 'db_error',
        message: 'تعذر حفظ الطلب. حاول مرة أخرى.'
      };
    }

    // 7. بناء بيانات الإيميل
    const requestData = {
      requestId,
      marketerCode: cleanCode,
      marketerName,
      marketerEmail,
      amount,
      method,
      methodLabel,
      transferNumber,
      earnedBalance: totals.earned,
      pendingBalance: totals.pending,
      totalChildren: totals.childrenCount,
      requestedAt: now
    };

    // 8. إرسال إيميل الإدارة (best-effort — الطلب محفوظ بغض النظر)
    try {
      await sendMarketerWithdrawRequestEmail(requestData);
    } catch (e) {
      console.error('❌ [submitWithdrawRequest] admin email:', e.message);
    }

    // 9. إرسال نسخة تأكيد للمسوق عبر القناة المختارة (best-effort)
    try {
      await notifyMarketerWithdrawStatus({
        marketerCode: cleanCode,
        status: 'submitted',
        requestId,
        amount,
        methodLabel
      });
    } catch (e) {
      console.warn('⚠️ [submitWithdrawRequest] marketer confirmation:', e.message);
    }

    // 10. Rate limit — ساعة واحدة
    cachePut(rateKey, 1, 3600);

    console.log(`✅ [submitWithdrawRequest] ${cleanCode} | ${amount} ج.م | ${method} | ${requestId}`);

    return {
      success: true,
      requestId,
      message: 'تم إرسال طلبك بنجاح'
    };

  } catch (err) {
    console.error('❌ [submitWithdrawRequest]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  🆕 cancelWithdrawRequest — إلغاء طلب سحب من المسوق
//  - مسموح فقط في: submitted, under_review
// ============================================================
export async function cancelWithdrawRequest(params) {
  try {
    const cleanCode = String(params.marketerCode || '').trim().toUpperCase();
    const requestId = String(params.requestId || '').trim();

    if (!cleanCode) return { success: false, error: 'كود المسوق مطلوب' };
    if (!requestId) return { success: false, error: 'رقم الطلب مطلوب' };

    // 1. جيب الطلب
    const { data: request, error } = await supabaseAdmin
      .from(TABLES.MARKETER_WITHDRAW_REQUESTS)
      .select('*')
      .eq(COLS_WITHDRAW.request_id, requestId)
      .eq(COLS_WITHDRAW.marketer_code, cleanCode)
      .maybeSingle();

    if (error) return { success: false, error: error.message };
    if (!request) {
      return { success: false, error: 'not_found', message: 'الطلب غير موجود' };
    }

    // 2. تحقق من الحالة
    const currentStatus = String(request[COLS_WITHDRAW.status] || '').trim();
    if (!['submitted', 'under_review'].includes(currentStatus)) {
      const statusLabels = {
        sending: 'قيد الإرسال',
        sent: 'تم الإرسال',
        rejected: 'مرفوض',
        cancelled: 'ملغى',
        failed: 'فشل',
        expired: 'منتهي الصلاحية'
      };
      return {
        success: false,
        error: 'cannot_cancel',
        message: 'لا يمكن إلغاء طلب في حالة "' + (statusLabels[currentStatus] || currentStatus) + '"'
      };
    }

    // 3. حدّث الطلب
    const now = nowUTC();
    const { error: updateErr } = await supabaseAdmin
      .from(TABLES.MARKETER_WITHDRAW_REQUESTS)
      .update({
        [COLS_WITHDRAW.status]: 'cancelled',
        [COLS_WITHDRAW.cancellation_reason]: 'إلغاء من قِبل المسوق',
        [COLS_WITHDRAW.updated_at]: now
      })
      .eq(COLS_WITHDRAW.request_id, requestId);

    if (updateErr) {
      console.error(`❌ [cancelWithdrawRequest] update:`, updateErr.message);
      return { success: false, error: updateErr.message };
    }

    console.log(`✅ [cancelWithdrawRequest] ${cleanCode} | ${requestId}`);

    return {
      success: true,
      message: 'تم إلغاء الطلب بنجاح'
    };

  } catch (err) {
    console.error('❌ [cancelWithdrawRequest]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  🚀 Dispatcher
// ============================================================
export async function handleSupabaseMarketerWrite(innerAction, params) {
  switch (innerAction) {
    case 'registerMarketer':
      return await registerMarketer(params);
    case 'forgotPassword':
      return await marketerForgotPassword(params);
    case 'resetPassword':
      return await marketerResetPassword(params);
    case 'getMarketerTelegramStatus':
      return await getMarketerTelegramStatus(params);
    case 'generateMarketerLinkToken':
      return await generateMarketerLinkToken(params);
    case 'unlinkMarketerTelegram':
      return await unlinkMarketerTelegram(params);
    case 'setMarketerNotificationMethod':
      return await setMarketerNotificationMethod(params);
    case 'marketerDeleteAccount':
      return await marketerDeleteAccount(params);
    case 'markTelegramReminderSent':
      return await markTelegramReminderSent(params);
    case 'requestPasswordChangeOTP':
      return await requestPasswordChangeOTP(params);
    case 'confirmPasswordChange':
      return await confirmPasswordChange(params);
    case 'submitWithdrawRequest':
      return await submitWithdrawRequest(params);
    // 🆕 إلغاء طلب سحب
    case 'cancelWithdrawRequest':
      return await cancelWithdrawRequest(params);
    default:
      return null;
  }
}