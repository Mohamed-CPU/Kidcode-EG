// ================================================================
//  lib/admin/auth.js — المصادقة الأساسية للأدمن
//  - hashPassword: تشفير bcrypt
//  - verifyPassword: التحقق من كلمة السر
//  - login: تسجيل دخول (يستدعي sessions)
//  - logout: تسجيل خروج
// ================================================================

import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../supabase.js';
import { TABLES } from '../db/tables.js';
import { createSession, freezeAllActiveSessions } from './sessions.js';
import { checkRateLimit, recordFailedAttempt, resetAttempts } from './rate-limit.js';
import { writeAuditLog } from './audit.js';

const BCRYPT_COST = 12;

// ============================================================
//  🕐 توقيت مصر
// ============================================================
function nowEgypt() {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).replace('T', ' ');
}

function futureEgypt(minutes) {
  const future = new Date(Date.now() + minutes * 60 * 1000);
  return future.toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).replace('T', ' ');
}

// ============================================================
//  🔐 hashPassword — تشفير كلمة السر
// ============================================================
export function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Invalid password');
  }
  const salt = bcrypt.genSaltSync(BCRYPT_COST);
  return bcrypt.hashSync(password, salt);
}

// ============================================================
//  🔐 verifyPassword — التحقق من كلمة السر
// ============================================================
export async function verifyPassword(password, hash) {
  if (!password || !hash) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch (e) {
    return false;
  }
}

// ============================================================
//  🚀 login — تسجيل الدخول
//  يرجّع: { success, sessionToken, csrfToken, user, conflict, ... }
// ============================================================
export async function login(params, req) {
  const username = String(params.username || '').trim();
  const password = String(params.password || '').trim();
  const ipAddress = getClientIP(req);
  const userAgent = String(req.headers['user-agent'] || '').substring(0, 300);

  // 1. تحقق من المدخلات
  if (!username || !password) {
    return { success: false, error: 'missing_credentials', message: 'اسم المستخدم وكلمة السر مطلوبان' };
  }

  // 2. Rate Limiting
  const rateCheck = await checkRateLimit(username, ipAddress);
  if (!rateCheck.allowed) {
    await writeAuditLog({
      username: username,
      action: 'login_blocked_rate_limit',
      ip_address: ipAddress,
      user_agent: userAgent
    });
    return {
      success: false,
      error: 'rate_limited',
      message: 'محاولات كثيرة فاشلة. حاول بعد ' + rateCheck.remaining_min + ' دقيقة.'
    };
  }

  // 3. جيب الحساب
  const { data: admin, error } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .select('*')
    .eq('username', username)
    .maybeSingle();

  if (error || !admin) {
    await recordFailedAttempt(username, ipAddress);
    await writeAuditLog({
      username: username,
      action: 'login_failed_unknown_user',
      ip_address: ipAddress,
      user_agent: userAgent
    });
    return { success: false, error: 'invalid_credentials', message: 'بيانات الدخول غير صحيحة' };
  }

  // 4. فحص الحالة
  const isActive = String(admin.is_active || '').trim();
  if (isActive !== 'نشط') {
    await writeAuditLog({
      username: username,
      action: 'login_failed_inactive',
      ip_address: ipAddress,
      user_agent: userAgent
    });
    return {
      success: false,
      error: 'account_inactive',
      message: 'الحساب معطَّل. يرجى التواصل مع superAdmin لإعادة التفعيل.'
    };
  }

  // 5. تحقق من كلمة السر
  const ok = await verifyPassword(password, admin.password_hash);
  if (!ok) {
    await recordFailedAttempt(username, ipAddress);
    await writeAuditLog({
      username: username,
      action: 'login_failed_wrong_password',
      ip_address: ipAddress,
      user_agent: userAgent
    });
    return { success: false, error: 'invalid_credentials', message: 'بيانات الدخول غير صحيحة' };
  }

  // 6. نجاح — امسح العدّاد
  await resetAttempts(username);

  // 7. أنشئ جلسة جديدة
  const sessionResult = await createSession({
    username: username,
    ipAddress: ipAddress,
    userAgent: userAgent
  });

  if (!sessionResult.success) {
    return { success: false, error: 'session_creation_failed', message: 'خطأ في إنشاء الجلسة' };
  }

  // 8. هل هناك تعارض؟
  let conflict = false;
  let conflictInfo = null;
  if (sessionResult.conflict) {
    conflict = true;
    conflictInfo = sessionResult.conflictInfo;

    // ✅ جمّد كل الجلسات النشطة (بما فيها الجديدة)
    //    حتى يقرر المستخدم: تسجيل خروج أو تغيير كلمة السر
    await freezeAllActiveSessions(username, 'conflict');

    await writeAuditLog({
      username: username,
      action: 'session_conflict_detected',
      changes: { other_session: conflictInfo },
      ip_address: ipAddress,
      user_agent: userAgent
    });
  }

  // 9. تحديث آخر تسجيل دخول
  await supabaseAdmin
    .from(TABLES.ADMINS)
    .update({ last_login_at: nowEgypt() })
    .eq('username', username);

  await writeAuditLog({
    username: username,
    action: conflict ? 'login_success_conflict' : 'login_success',
    ip_address: ipAddress,
    user_agent: userAgent
  });

  // ✅ فحص must_change_password
  const mustChangePassword = String(admin.must_change_password || '').trim() === 'نعم';

  return {
    success: true,
    sessionToken: sessionResult.sessionToken,
    csrfToken: sessionResult.csrfToken,
    expiresAt: sessionResult.expiresAt,
    user: {
      username: admin.username,
      fullName: admin.full_name,
      permissions: admin.permissions || {},
      isSuperAdmin: admin.username === 'super_admin',
      themePreference: admin.theme_preference || 'light',
      mustChangePassword: mustChangePassword
    },
    conflict: conflict,
    frozen: conflict,
    conflictInfo: conflictInfo
  };
}

// ============================================================
//  🚪 logout — تسجيل الخروج
// ============================================================
export async function logout(sessionToken, username, req) {
  const ipAddress = getClientIP(req);
  const userAgent = String(req.headers['user-agent'] || '').substring(0, 300);

  // 1. حدّث الجلسة الحالية
  await supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .update({ status: 'logged_out' })
    .eq('session_token', sessionToken);

  // 2. هل هناك جلسات أخرى مجمّدة بسبب التعارض؟
  //    إذا نعم، فُكّ تجميدها (سيعمل الجهاز الآخر فورًا)
  await supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .update({
      status: 'active',
      frozen_at: null,
      frozen_reason: null,
      conflict_flag: 'لا'
    })
    .eq('username', username)
    .eq('status', 'frozen')
    .eq('frozen_reason', 'conflict');

  await writeAuditLog({
    username: username,
    action: 'logout',
    ip_address: ipAddress,
    user_agent: userAgent
  });

  return { success: true };
}

// ============================================================
//  🌐 getClientIP — استخراج IP من الطلب
// ============================================================
export function getClientIP(req) {
  // ✅ حماية: لو req = null (زي ما بيحصل من webhook تليجرام)
  if (!req || !req.headers) return 'UNKNOWN';

  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'UNKNOWN';
}