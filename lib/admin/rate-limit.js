// ================================================================
//  lib/admin/rate-limit.js — حماية من المحاولات المتكررة
//  - 5 محاولات فاشلة → قفل 30 دقيقة
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES } from '../db/tables.js';

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;
const LOCK_MINUTES = 30;

// ✅ UTC ISO — للكتابة في timestamptz
function nowUTC() {
  return new Date().toISOString();
}

// ✅ ISO UTC — يتفادى أي التباس في المنطقة الزمنية
function futureUTC(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

// ============================================================
//  🔍 checkRateLimit — هل مسموح بالمحاولة؟
// ============================================================
export async function checkRateLimit(username, ipAddress) {
  const { data, error } = await supabaseAdmin
    .from(TABLES.ADMIN_LOGIN_ATTEMPTS)
    .select('*')
    .eq('username', username)
    .eq('ip_address', ipAddress)
    .maybeSingle();

  if (error || !data) {
    return { allowed: true, remaining: MAX_ATTEMPTS };
  }

  const now = Date.now();
  const lockedUntil = data.locked_until ? new Date(data.locked_until).getTime() : 0;

  // 1. هل مقفول؟
  if (lockedUntil && now < lockedUntil) {
    const remainingMin = Math.ceil((lockedUntil - now) / 60000);
    return {
      allowed: false,
      locked: true,
      remaining_min: remainingMin
    };
  }

  // 2. القفل انتهى → امسح السجل
  if (lockedUntil && now >= lockedUntil) {
    await resetAttempts(username, ipAddress);
    return { allowed: true, remaining: MAX_ATTEMPTS };
  }

  // 3. في نافذة المحاولات
  const firstAt = data.first_attempt_at ? new Date(data.first_attempt_at).getTime() : 0;
  if (firstAt && (now - firstAt) < WINDOW_MINUTES * 60 * 1000) {
    const remaining = MAX_ATTEMPTS - (data.attempt_count || 0);
    return {
      allowed: remaining > 0,
      remaining: Math.max(0, remaining)
    };
  }

  // 4. النافذة خلصت → صفّر
  await resetAttempts(username, ipAddress);
  return { allowed: true, remaining: MAX_ATTEMPTS };
}

// ============================================================
//  📝 recordFailedAttempt — تسجيل محاولة فاشلة
// ============================================================
export async function recordFailedAttempt(username, ipAddress) {
  const { data } = await supabaseAdmin
    .from(TABLES.ADMIN_LOGIN_ATTEMPTS)
    .select('*')
    .eq('username', username)
    .eq('ip_address', ipAddress)
    .maybeSingle();

  // ✅ UTC ISO — timestamptz يفهمها صح
  const now = nowUTC();

  if (!data) {
    // أول محاولة
    await supabaseAdmin
      .from(TABLES.ADMIN_LOGIN_ATTEMPTS)
      .insert({
        username: username,
        ip_address: ipAddress,
        attempt_count: 1,
        first_attempt_at: now,
        last_attempt_at: now
      });
    return;
  }

  const newCount = (data.attempt_count || 0) + 1;
  const updates = {
    attempt_count: newCount,
    last_attempt_at: now
  };

  // قفل عند الوصول للحد؟
  if (newCount >= MAX_ATTEMPTS) {
    updates.locked_until = futureUTC(LOCK_MINUTES);
  }

  await supabaseAdmin
    .from(TABLES.ADMIN_LOGIN_ATTEMPTS)
    .update(updates)
    .eq('username', username)
    .eq('ip_address', ipAddress);
}

// ============================================================
//  ♻️ resetAttempts — مسح العدّاد
// ============================================================
export async function resetAttempts(username, ipAddress) {
  let query = supabaseAdmin
    .from(TABLES.ADMIN_LOGIN_ATTEMPTS)
    .delete()
    .eq('username', username);

  if (ipAddress) {
    query = query.eq('ip_address', ipAddress);
  }

  await query;
}

// ============================================================
//  🔔 hasTooManyFailedAttempts — للتنبيه على تليجرام
//  (5 محاولات من IPs مختلفة لنفس المستخدم)
// ============================================================
export async function hasTooManyFailedAttempts(username) {
  const { data } = await supabaseAdmin
    .from(TABLES.ADMIN_LOGIN_ATTEMPTS)
    .select('id')
    .eq('username', username);

  return (data || []).length >= 3; // 3 IPs مختلفة = تنبيه
}