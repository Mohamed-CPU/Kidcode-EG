// ================================================================
//  lib/db/cleanup.js — تنظيف البيانات القديمة على Supabase
//  - cleanupExpiredTokens: حذف التوكنات الأقدم من شهر
//  - markExpiredTokensAsUsed: تعليم التوكنات المنتهية كـ "used"
//  - cleanupExpiredSessions: تعليم الجلسات المنتهية كـ "expired"
//  - cleanupLoginAttempts: حذف محاولات الدخول القديمة
//  ✅ كل المقارنات UTC ISO — متوافقة مع timestamptz
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES } from './tables.js';

// ============================================================
//  🕐 توقيت UTC (للحفظ/المقارنة في DB)
// ============================================================
function nowUTC() {
  return new Date().toISOString();
}

function utcMinusMs(ms) {
  return new Date(Date.now() - ms).toISOString();
}

// ============================================================
//  1️⃣ cleanupExpiredTokens
//  - حذف TempTokens اللي expiresat أقدم من شهر
// ============================================================
export async function cleanupExpiredTokens() {
  const t0 = Date.now();
  const cutoff = utcMinusMs(30 * 24 * 60 * 60 * 1000); // قبل شهر

  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.TEMP_TOKENS)
      .delete()
      .lt('expiresat', cutoff)
      .select('token');

    if (error) {
      console.error('❌ [cleanupExpiredTokens]', error.message);
      return { success: false, error: error.message, deleted: 0 };
    }

    const deleted = (data || []).length;
    console.log(`🗑️ [cleanupExpiredTokens] حذف ${deleted} توكن (>30 يوم) (${Date.now() - t0}ms)`);
    return { success: true, deleted };

  } catch (e) {
    console.error('❌ [cleanupExpiredTokens]', e.message);
    return { success: false, error: e.message, deleted: 0 };
  }
}

// ============================================================
//  2️⃣ markExpiredTokensAsUsed
//  - تعليم TempTokens اللي expiresat < الآن و used='لا' كـ used='نعم'
// ============================================================
export async function markExpiredTokensAsUsed() {
  const t0 = Date.now();
  const now = nowUTC();

  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.TEMP_TOKENS)
      .update({ used: 'نعم' })
      .lt('expiresat', now)
      .eq('used', 'لا')
      .select('token');

    if (error) {
      console.error('❌ [markExpiredTokensAsUsed]', error.message);
      return { success: false, error: error.message, updated: 0 };
    }

    const updated = (data || []).length;
    if (updated > 0) {
      console.log(`⏰ [markExpiredTokensAsUsed] تم تعليم ${updated} توكن (${Date.now() - t0}ms)`);
    }
    return { success: true, updated };

  } catch (e) {
    console.error('❌ [markExpiredTokensAsUsed]', e.message);
    return { success: false, error: e.message, updated: 0 };
  }
}

// ============================================================
//  3️⃣ cleanupExpiredSessions
//  - تعليم FamilySessions اللي expires_at < الآن و status='active' كـ 'expired'
// ============================================================
export async function cleanupExpiredSessions() {
  const t0 = Date.now();
  const now = nowUTC();

  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.FAMILY_SESSIONS)
      .update({ status: 'expired' })
      .lt('expires_at', now)
      .eq('status', 'active')
      .select('session_token');

    if (error) {
      console.error('❌ [cleanupExpiredSessions]', error.message);
      return { success: false, error: error.message, updated: 0 };
    }

    const updated = (data || []).length;
    if (updated > 0) {
      console.log(`🔒 [cleanupExpiredSessions] تم تعليم ${updated} جلسة كمنتهية (${Date.now() - t0}ms)`);
    }
    return { success: true, updated };

  } catch (e) {
    console.error('❌ [cleanupExpiredSessions]', e.message);
    return { success: false, error: e.message, updated: 0 };
  }
}

// ============================================================
//  4️⃣ cleanupLoginAttempts
//  - حذف LoginAttempts اللي locked_until أقدم من يوم (أو منتهية)
// ============================================================
export async function cleanupLoginAttempts() {
  const t0 = Date.now();
  const cutoff = utcMinusMs(24 * 60 * 60 * 1000); // قبل يوم

  try {
    // 1. امسح اللي locked_until أقدم من يوم
    const { data: data1, error: error1 } = await supabaseAdmin
      .from(TABLES.LOGIN_ATTEMPTS)
      .delete()
      .lt('locked_until', cutoff)
      .not('locked_until', 'is', null)
      .select('child_id');

    if (error1) {
      console.error('❌ [cleanupLoginAttempts] locked:', error1.message);
    }

    const deletedLocked = (data1 || []).length;

    // 2. امسح اللي last_attempt_at أقدم من 48 ساعة (بدون قفل)
    const cutoff2 = utcMinusMs(48 * 60 * 60 * 1000);
    const { data: data2, error: error2 } = await supabaseAdmin
      .from(TABLES.LOGIN_ATTEMPTS)
      .delete()
      .lt('last_attempt_at', cutoff2)
      .is('locked_until', null)
      .select('child_id');

    if (error2) {
      console.error('❌ [cleanupLoginAttempts] old:', error2.message);
    }

    const deletedOld = (data2 || []).length;
    const totalDeleted = deletedLocked + deletedOld;

    if (totalDeleted > 0) {
      console.log(`🧹 [cleanupLoginAttempts] حذف ${totalDeleted} (${deletedLocked} مقفول + ${deletedOld} قديم) (${Date.now() - t0}ms)`);
    }
    return { success: true, deleted: totalDeleted, lockedDeleted: deletedLocked, oldDeleted: deletedOld };

  } catch (e) {
    console.error('❌ [cleanupLoginAttempts]', e.message);
    return { success: false, error: e.message, deleted: 0 };
  }
}

// ============================================================
//  🚀 runAllCleanups — يشغّل الأربعة بالترتيب
// ============================================================
export async function runAllCleanups() {
  const t0 = Date.now();
  console.log('🧹 [Cleanup] بدء التنظيف الشامل...');

  const result = {
    success: true,
    timestamp: nowUTC(),
    tokens: null,
    sessions: null,
    loginAttempts: null,
    markUsed: null
  };

  // 1. تعليم التوكنات المنتهية كـ used
  try {
    result.markUsed = await markExpiredTokensAsUsed();
  } catch (e) {
    result.markUsed = { success: false, error: e.message };
  }

  // 2. تعليم الجلسات المنتهية
  try {
    result.sessions = await cleanupExpiredSessions();
  } catch (e) {
    result.sessions = { success: false, error: e.message };
  }

  // 3. حذف محاولات الدخول القديمة
  try {
    result.loginAttempts = await cleanupLoginAttempts();
  } catch (e) {
    result.loginAttempts = { success: false, error: e.message };
  }

  // 4. حذف التوكنات القديمة (>30 يوم)
  try {
    result.tokens = await cleanupExpiredTokens();
  } catch (e) {
    result.tokens = { success: false, error: e.message };
  }

  console.log(`✅ [Cleanup] اكتمل (${Date.now() - t0}ms)`);
  return result;
}