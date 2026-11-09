// ================================================================
//  lib/admin/account.js — إدارة حساب الأدمن نفسه
//  - عرض الجلسات النشطة
//  - إنهاء جلسة أخرى
//  - تغيير كلمة السر (مع كلمة السر الحالية)
//  - تحديث الاسم الكامل
//  - عرض آخر العمليات
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES } from '../db/tables.js';
import { hashPassword, verifyPassword, getClientIP } from './auth.js';
import { writeAuditLog } from './audit.js';

// ============================================================
//  🕐 توقيت مصر
// ============================================================
function nowEgypt() {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).replace('T', ' ');
}

// ============================================================
//  📊 getMySessions — عرض كل الجلسات النشطة للمستخدم
// ============================================================
export async function getMySessions(username, currentSessionToken) {
  const { data, error } = await supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .select('session_token, ip_address, user_agent, created_at, last_activity_at, expires_at, status')
    .eq('username', username)
    .in('status', ['active', 'frozen'])
    .order('last_activity_at', { ascending: false });

  if (error) return { success: false, error: error.message };

  const sessions = (data || []).map(function(s) {
    return {
      isCurrent: s.session_token === currentSessionToken,
      ip_address: s.ip_address || '—',
      user_agent: s.user_agent || '—',
      created_at: s.created_at,
      last_activity_at: s.last_activity_at,
      expires_at: s.expires_at,
      status: s.status
    };
  });

  return { success: true, sessions: sessions };
}

// ============================================================
//  🚪 terminateSession — إنهاء جلسة أخرى
// ============================================================
export async function terminateSession(username, targetIp, targetUA, currentSessionToken) {
  if (!targetIp || !targetUA) {
    return { success: false, error: 'missing_target', message: 'بيانات الجلسة غير مكتملة' };
  }

  // ابحث عن الجلسة المطابقة (بدون الجلسة الحالية)
  const { data: candidates, error } = await supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .select('session_token')
    .eq('username', username)
    .eq('ip_address', targetIp)
    .eq('user_agent', targetUA)
    .in('status', ['active', 'frozen'])
    .neq('session_token', currentSessionToken);

  if (error) return { success: false, error: error.message };

  if (!candidates || candidates.length === 0) {
    return { success: false, error: 'not_found', message: 'لم يتم العثور على الجلسة المطلوبة' };
  }

  // أنهِ كل الجلسات المطابقة
  const tokensToTerminate = candidates.map(c => c.session_token);

  const { error: updateError } = await supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .update({ status: 'logged_out' })
    .in('session_token', tokensToTerminate);

  if (updateError) return { success: false, error: updateError.message };

  // ✅ إذا كانت الجلسات المنهية جزءًا من تعارض، فكّ تجميد الجلسة الحالية
  // (لأن المستخدم حسم التعارض بإنهاء الجلسة الأخرى)
  await supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .update({
      status: 'active',
      frozen_at: null,
      frozen_reason: null,
      conflict_flag: 'لا'
    })
    .eq('session_token', currentSessionToken)
    .eq('status', 'frozen')
    .eq('frozen_reason', 'conflict');

  return { success: true, terminated: tokensToTerminate.length };
}

// ============================================================
//  🔐 changeMyPassword — تغيير كلمة السر (بكلمة السر الحالية)
// ============================================================
export async function changeMyPassword(params) {
  const { username, currentPassword, newPassword, currentSessionToken, req } = params;

  if (!username || !currentPassword || !newPassword) {
    return { success: false, error: 'missing_fields', message: 'كل الحقول مطلوبة' };
  }

  // 1. فحص قوة كلمة السر الجديدة
  const strength = validateAdminPassword(newPassword);
  if (!strength.valid) {
    return { success: false, error: 'weak_password', message: strength.errors.join(' | ') };
  }

  // 2. فحص أن الجديدة مختلفة عن الحالية
  if (currentPassword === newPassword) {
    return { success: false, error: 'same_password', message: 'كلمة السر الجديدة يجب أن تختلف عن الحالية' };
  }

  // 3. جيب الحساب
  const { data: admin, error } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .select('password_hash')
    .eq('username', username)
    .maybeSingle();

  if (error || !admin) {
    return { success: false, error: 'account_not_found' };
  }

  // 4. تحقق من كلمة السر الحالية
  const ok = await verifyPassword(currentPassword, admin.password_hash);
  if (!ok) {
    await writeAuditLog({
      username: username,
      action: 'change_password_failed_wrong_current',
      ip_address: getClientIP(req)
    });
    return { success: false, error: 'wrong_password', message: 'كلمة السر الحالية غير صحيحة' };
  }

  // 5. شفّر الجديدة
  const newHash = hashPassword(newPassword);

  // 6. حدّث
  const { error: updateError } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .update({ password_hash: newHash })
    .eq('username', username);

  if (updateError) return { success: false, error: updateError.message };

  // 7. أنهِ كل الجلسات الأخرى (نُبقي الجلسة الحالية)
  await supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .update({ status: 'logged_out' })
    .eq('username', username)
    .neq('session_token', currentSessionToken)
    .in('status', ['active', 'frozen']);

  // 8. سجّل
  await writeAuditLog({
    username: username,
    action: 'password_changed',
    ip_address: getClientIP(req)
  });

  return { success: true, message: 'تم تغيير كلمة السر. تم إنهاء الجلسات الأخرى.' };
}

// ============================================================
//  👤 updateMyProfile — تحديث الاسم الكامل
// ============================================================
export async function updateMyProfile(params) {
  const { username, fullName, req } = params;

  const cleanName = String(fullName || '').trim();
  if (!cleanName) {
    return { success: false, error: 'missing_name', message: 'الاسم مطلوب' };
  }
  if (cleanName.length > 100) {
    return { success: false, error: 'name_too_long', message: 'الاسم طويل جدًا (الحد 100 حرف)' };
  }

  const { error } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .update({ full_name: cleanName })
    .eq('username', username);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: username,
    action: 'profile_updated',
    changes: { full_name: cleanName },
    ip_address: getClientIP(req)
  });

  return { success: true, fullName: cleanName, message: 'تم تحديث الاسم' };
}

// ============================================================
//  📋 getMyAuditLog — آخر 20 عملية للمستخدم
// ============================================================
export async function getMyAuditLog(username, limit) {
  limit = Math.min(parseInt(limit) || 20, 100);

  const { data, error } = await supabaseAdmin
    .from(TABLES.ADMIN_AUDIT_LOG)
    .select('id, action, target_table, target_id, changes, ip_address, user_agent, created_at')
    .eq('username', username)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return { success: false, error: error.message };

  return { success: true, logs: data || [] };
}

// ============================================================
//  🔐 validateAdminPassword
// ============================================================
function validateAdminPassword(password) {
  const errors = [];
  if (!password || password.length < 10) errors.push('10 أحرف على الأقل');
  if (!/[A-Z]/.test(password)) errors.push('حرف كبير واحد على الأقل');
  if (!/[a-z]/.test(password)) errors.push('حرف صغير واحد على الأقل');
  if (!/[0-9]/.test(password)) errors.push('رقم واحد على الأقل');
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) errors.push('رمز خاص واحد');
  if (/[\u0600-\u06FF]/.test(password)) errors.push('بدون حروف عربية');
  return { valid: errors.length === 0, errors };
}