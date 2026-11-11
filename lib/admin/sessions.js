// ================================================================
//  lib/admin/sessions.js — إدارة الجلسات + كشف التعارض + التجميد
//  ⚠️ بعد Migration: AdminSessions timestamps = timestamptz
//  ✅ الكتابة: nowUTC() / futureUTC() | العرض: Cairo display (Telegram)
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { TABLES } from '../db/tables.js';

const SESSION_DURATION_HOURS = 6;
const FREEZE_TIMEOUT_MS = 5 * 60 * 1000; // 5 دقائق

// ============================================================
//  🕐 دوال الوقت
// ============================================================
function nowUTC() {
  // ⚠️ للكتابة في timestamptz — UTC ISO
  return new Date().toISOString();
}

function futureUTC(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function nowEgyptDisplay() {
  // ⚠️ للعرض فقط في رسائل تليجرام
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).replace('T', ' ');
}

// ============================================================
//  🔑 generateSessionToken — 64 حرف عشوائي
// ============================================================
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ============================================================
//  🧹 cleanupStaleSessions — حذف الجلسات العالقة
//  الجلسات النشطة التي مر عليها أكثر من 30 دقيقة بدون نشاط
//  تُعتبر عالقة (المستخدم أغلق المتصفح دون تسجيل خروج)
// ============================================================
async function cleanupStaleSessions(username) {
  if (!username) return;

  // ✅ 30 دقيقة مضت — UTC ISO
  const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  try {
    await supabaseAdmin
      .from(TABLES.ADMIN_SESSIONS)
      .update({ status: 'expired' })
      .eq('username', username)
      .eq('status', 'active')
      .lt('last_activity_at', stale);
  } catch (e) {
    // فشل صامت — نكمل
  }
}

// ============================================================
//  ⏱️ computeSecondsLeft — حساب الثواني المتبقية في التجميد
//  frozen_at = ISO من timestamptz → new Date() كافي
// ============================================================
function computeSecondsLeft(frozenAtRaw) {
  const DEFAULT = Math.floor(FREEZE_TIMEOUT_MS / 1000);

  if (!frozenAtRaw) return DEFAULT;

  try {
    const frozenDate = new Date(frozenAtRaw);
    if (isNaN(frozenDate.getTime())) return DEFAULT;

    const elapsed = Math.max(0, Date.now() - frozenDate.getTime());
    const remainingMs = Math.max(0, FREEZE_TIMEOUT_MS - elapsed);
    return Math.floor(remainingMs / 1000);
  } catch (e) {
    return DEFAULT;
  }
}

// ============================================================
//  🚀 createSession — إنشاء جلسة جديدة + كشف التعارض
// ============================================================
export async function createSession(params) {
  const { username, ipAddress, userAgent } = params;

  // 0. ✅ نظّف الجلسات العالقة أولاً
  await cleanupStaleSessions(username);

  // 1. هل هناك جلسات نشطة أخرى لنفس الحساب؟
  const { data: activeSessions } = await supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .select('session_token, ip_address, user_agent, created_at, last_activity_at')
    .eq('username', username)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  const existingSessions = activeSessions || [];
  const hasConflict = existingSessions.length > 0;

  // 2. أنشئ التوكنات + التوقيتات (UTC)
  const sessionToken = generateSessionToken();
  const csrfToken = generateCsrfToken();
  const now = nowUTC();
  const expiresAt = futureUTC(SESSION_DURATION_HOURS);

  // 3. أدخل الجلسة الجديدة
  const { error } = await supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .insert({
      session_token: sessionToken,
      username: username,
      csrf_token: csrfToken,
      created_at: now,
      expires_at: expiresAt,
      last_activity_at: now,
      ip_address: ipAddress,
      user_agent: userAgent,
      status: 'active',
      conflict_flag: hasConflict ? 'نعم' : 'لا'
    });

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    sessionToken,
    csrfToken,
    expiresAt,
    conflict: hasConflict,
    conflictInfo: hasConflict && existingSessions[0] ? {
      ip_address: existingSessions[0].ip_address,
      user_agent: existingSessions[0].user_agent,
      created_at: existingSessions[0].created_at,
      last_activity_at: existingSessions[0].last_activity_at
    } : null
  };
}

// ============================================================
//  🧊 freezeOtherSessions — تجميد كل الجلسات النشطة الأخرى
// ============================================================
export async function freezeOtherSessions(username, currentSessionToken, reason) {
  const { error } = await supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .update({
      status: 'frozen',
      frozen_at: nowUTC(),
      frozen_reason: reason,
      conflict_flag: 'نعم'
    })
    .eq('username', username)
    .eq('status', 'active')
    .neq('session_token', currentSessionToken);

  return { success: !error, error: error?.message };
}

// ============================================================
//  🧊 freezeAllActiveSessions — تجميد كل الجلسات النشطة (بما فيها الجديدة)
//  يُستخدم عند اكتشاف تعارض — لضمان عدم عمل أي جلسة
// ============================================================
export async function freezeAllActiveSessions(username, reason) {
  const { error } = await supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .update({
      status: 'frozen',
      frozen_at: nowUTC(),
      frozen_reason: reason,
      conflict_flag: 'نعم'
    })
    .eq('username', username)
    .eq('status', 'active');

  return { success: !error, error: error?.message };
}

// ============================================================
//  🔍 verifySession — التحقق من جلسة
// ============================================================
export async function verifySession(sessionToken) {
  if (!sessionToken) return { valid: false, error: 'no_token' };

  const { data: session, error } = await supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .select('*')
    .eq('session_token', sessionToken)
    .maybeSingle();

  if (error || !session) return { valid: false, error: 'not_found' };

  // 1. فحص الحالة
  const status = String(session.status || '').trim().toLowerCase();

  if (status === 'logged_out' || status === 'expired') {
    return { valid: false, error: 'logged_out' };
  }

  // 2. فحص الانتهاء — expires_at = ISO من timestamptz
  const expiresDate = new Date(session.expires_at);
  if (isNaN(expiresDate.getTime()) || Date.now() >= expiresDate.getTime()) {
    await supabaseAdmin
      .from(TABLES.ADMIN_SESSIONS)
      .update({ status: 'expired' })
      .eq('session_token', sessionToken);
    return { valid: false, error: 'expired' };
  }

  // 3. إذا كانت مجمّدة — أرجعلها مع السبب
  if (status === 'frozen') {
    return {
      valid: true,
      frozen: true,
      frozenReason: session.frozen_reason,
      frozenAt: session.frozen_at,
      session: session
    };
  }

  // 4. تحديث last_activity_at (بدون انتظار) — ✅ UTC ISO
  supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .update({ last_activity_at: nowUTC() })
    .eq('session_token', sessionToken)
    .then(() => {})
    .catch(() => {});

  // 5. جيب بيانات المستخدم
  const { data: admin } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .select('username, full_name, permissions, theme_preference, is_active, must_change_password')
    .eq('username', session.username)
    .maybeSingle();

  if (!admin || String(admin.is_active || '').trim() !== 'نشط') {
    return { valid: false, error: 'account_inactive' };
  }

  return {
    valid: true,
    frozen: false,
    session: session,
    user: {
      username: admin.username,
      fullName: admin.full_name,
      permissions: admin.permissions || {},
      isSuperAdmin: admin.username === 'super_admin',
      themePreference: admin.theme_preference || 'light',
      mustChangePassword: String(admin.must_change_password || '').trim() === 'نعم'
    }
  };
}

// ============================================================
//  📊 getSessionStatus — فحص الحالة فقط (للـ Polling)
// ============================================================
export async function getSessionStatus(sessionToken) {
  if (!sessionToken) return { status: 'invalid' };

  const { data: session, error } = await supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .select('status, frozen_reason, frozen_at, expires_at, username')
    .eq('session_token', sessionToken)
    .maybeSingle();

  if (error || !session) return { status: 'invalid' };

  // ✅ فحص الحساب أولاً — قبل أي حالة أخرى
  const { data: admin } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .select('is_active, must_change_password')
    .eq('username', session.username)
    .maybeSingle();

  if (!admin || String(admin.is_active || '').trim() !== 'نشط') {
    return { status: 'disabled' };
  }

  // ✅ فحص must_change_password
  const mustChange = String(admin.must_change_password || '').trim() === 'نعم';

  const status = String(session.status || '').trim().toLowerCase();
  const expiresDate = new Date(session.expires_at);
  const expiresAt = isNaN(expiresDate.getTime()) ? 0 : expiresDate.getTime();

  if (status === 'logged_out') return { status: 'logged_out' };
  if (status === 'expired' || Date.now() >= expiresAt) return { status: 'expired' };

  if (status === 'frozen') {
    // 1. احسب الثواني المتبقية بطريقة آمنة
    const isManual = String(session.frozen_reason || '') === 'manual';
    const secondsLeft = isManual ? -1 : computeSecondsLeft(session.frozen_at);

    // 2. إذا انتهت المهلة → عطّل الحساب
    if (!isManual && secondsLeft <= 0) {
      await disableAccountForFrozenTimeout(session.username, session.frozen_reason);
      return { status: 'disabled' };
    }

    // 3. اجلب معلومات الجلسة الأخرى (للتعارض)
    let conflictInfo = null;
    if (session.frozen_reason === 'conflict') {
      const { data: otherSessions } = await supabaseAdmin
        .from(TABLES.ADMIN_SESSIONS)
        .select('ip_address, user_agent, created_at, last_activity_at')
        .eq('username', session.username)
        .neq('session_token', sessionToken)
        .in('status', ['frozen', 'active'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (otherSessions && otherSessions.length > 0) {
        conflictInfo = otherSessions[0];
      }
    }

    return {
      status: 'frozen',
      frozenReason: session.frozen_reason,
      frozenAt: session.frozen_at,
      username: session.username,
      secondsLeft: secondsLeft,
      conflictInfo: conflictInfo,
      mustChangePassword: mustChange
    };
  }

  return { status: 'active', mustChangePassword: mustChange };
}

// ============================================================
//  🔒 disableAccountForFrozenTimeout — تعطيل الحساب بعد انتهاء مهلة التجميد
//  يُستدعى عند تجاوز 5 دقائق بدون حل التعارض
// ============================================================
export async function disableAccountForFrozenTimeout(username, freezeReason) {
  if (!username) return { success: false };

  try {
    // 1. عطّل الحساب
    await supabaseAdmin
      .from(TABLES.ADMINS)
      .update({ is_active: 'غير نشط' })
      .eq('username', username);

    // 2. أنهِ كل الجلسات (active + frozen)
    await supabaseAdmin
      .from(TABLES.ADMIN_SESSIONS)
      .update({ status: 'logged_out' })
      .eq('username', username)
      .in('status', ['active', 'frozen']);

    // 3. سجّل في Audit Log
    try {
      const { writeAuditLog } = await import('./audit.js');
      await writeAuditLog({
        username: 'system',
        action: 'account_disabled_frozen_timeout',
        target_table: 'AdminAccounts',
        target_id: username,
        changes: { reason: freezeReason || 'conflict', timeout_seconds: 300 }
      });
    } catch (e) {}

    // 4. إشعار superAdmin على تليجرام
    try {
      const adminChatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
      if (adminChatId) {
        const { sendViaTelegram } = await import('../telegram.js');
        // ✅ Cairo display فقط للرسالة
        const nowDisplay = nowEgyptDisplay();

        await sendViaTelegram(adminChatId,
          `🔒 <b>تعطيل تلقائي للحساب</b>\n\n` +
          `الحساب: <code>${username}</code>\n` +
          `السبب: انتهت مهلة التجميد (5 دقائق) دون حل التعارض\n` +
          `نوع التجميد: ${freezeReason || 'conflict'}\n` +
          `🕐 ${nowDisplay}\n\n` +
          `⚠️ لتفعيل الحساب مرة أخرى، استخدم لوحة تحكم superAdmin.`
        );
      }
    } catch (e) {}

    console.log(`🔒 [disableAccountForFrozenTimeout] ${username} — تم التعطيل`);
    return { success: true };

  } catch (e) {
    console.error(`❌ [disableAccountForFrozenTimeout] ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🧹 cleanupExpiredSessions — حذف الجلسات المنتهية
// ============================================================
export async function cleanupExpiredSessions() {
  // ✅ UTC ISO
  const now = nowUTC();
  const { error } = await supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .update({ status: 'expired' })
    .eq('status', 'active')
    .lt('expires_at', now);

  return { success: !error };
}