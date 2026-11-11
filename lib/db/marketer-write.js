// ================================================================
//  lib/db/marketer-write.js — دوال كتابة المسوقين (Supabase)
//  ⚠️ بعد Migration: كل الأعمدة الزمنية timestamptz
//  ✅ الكتابة: nowUTC() / futureUTC() | العرض: formatCairoDateTime()
//  🐛 Fix: '' في timestamptz كان بيسبب خطأ → استبدلناها بـ null
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_MARKETERS } from './tables.js';
import { sendMarketerWelcomeEmail, sendMarketerResetEmail } from '../email/brevo.js';
import { generateShortCode } from '../telegram.js';

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
    default:
      return null;
  }
}