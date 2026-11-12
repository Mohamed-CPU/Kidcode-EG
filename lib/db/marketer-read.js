// ================================================================
//  lib/db/marketer-read.js — دوال قراءة المسوقين (Supabase)
//  - Read-only actions فقط
//  - Response shape مطابق تماماً لـ GAS
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN } from './tables.js';

// ============================================================
//  Helpers
// ============================================================

function toStr(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function toNum(value) {
  if (value === null || value === undefined) return 0;
  const str = String(value).trim().replace(/[٫،]/g, '.');
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function formatDateOnlyLikeGAS(value) {
  if (!value) return '';
  // date-only strings pass through
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (typeof value === 'string' && !value.includes('T') && value.includes('-')) {
    return value.split(' ')[0];
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  // ✅ Cairo date via Intl — عشان التسجيل الساعة 01:00 Cairo (23:00 UTC اليوم السابق) يظهر على اليوم الصح
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  const yyyy = parts.find(p => p.type === 'year').value;
  const mm = parts.find(p => p.type === 'month').value;
  const dd = parts.find(p => p.type === 'day').value;
  return `${yyyy}-${mm}-${dd}`;
}

// ============================================================
//  🔐 Password Verification — SHA-256 (نفس منطق GAS)
// ============================================================
function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;

  const strHash = String(storedHash).trim();

  // الصيغة الجديدة: salt$hash
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

  // الصيغة القديمة (بدون salt) — للتوافق
  const legacyHash = crypto
    .createHash('sha256')
    .update(password)
    .digest('base64');

  return legacyHash === strHash;
}

// ============================================================
//  1️⃣ getMarketerStats
// ============================================================
export async function getMarketerStats(params) {
  const cleanCode = String(params.code || '').trim().toUpperCase();
  if (!cleanCode) return { success: false, error: 'الكود مطلوب' };

  const t0 = Date.now();

  const { data: children, error } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.marketer_id, cleanCode);

  if (error) {
    console.error(`❌ [getMarketerStats] ${cleanCode} (${Date.now() - t0}ms)`, error.message);
    return { success: false, error: error.message };
  }

  const nowMs = Date.now();
  const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

  let totalChildren = 0;
  let totalEarnedCommission = 0;
  let totalPendingCommission = 0;
  const orders = [];

  (children || []).forEach(function(child) {
    const originalPrice = toNum(child[COLS_CHILDREN.original_price]);
    const finalPrice = toNum(child[COLS_CHILDREN.plan_price]);

    let commission = 0;
    if (originalPrice > 0 && finalPrice > 0) {
      commission = originalPrice - finalPrice;
      if (commission < 0) commission = 0;
    }

    const regRaw = child[COLS_CHILDREN.registration_date] || child[COLS_CHILDREN.timestamp];
    const regDate = regRaw ? new Date(regRaw) : new Date(nowMs);
    const regMs = isNaN(regDate.getTime()) ? nowMs : regDate.getTime();

    const status = String(child[COLS_CHILDREN.status] || '').trim().toLowerCase();

    if (status !== 'active' && status !== 'paid' && status !== 'disabled') {
      return;
    }

    totalChildren++;

    const daysSince = (nowMs - regMs) / (1000 * 60 * 60 * 24);
    const isEarned = (nowMs - regMs) >= FOURTEEN_DAYS_MS;

    if (isEarned) totalEarnedCommission += commission;
    else totalPendingCommission += commission;

    orders.push({
      childID: toStr(child[COLS_CHILDREN.child_id]),
      childName: toStr(child[COLS_CHILDREN.child_name]),
      plan: toStr(child[COLS_CHILDREN.plan]),
      originalPrice: originalPrice,
      finalPrice: finalPrice,
      discount: commission,
      commission: commission,
      registrationDate: formatDateOnlyLikeGAS(regRaw),
      daysAgo: Math.floor(daysSince),
      isEarned: isEarned,
      status: status
    });
  });

  orders.sort(function(a, b) {
    return String(b.registrationDate).localeCompare(String(a.registrationDate));
  });

  const elapsed = Date.now() - t0;
  console.log(`✅ [getMarketerStats] ${cleanCode} (${elapsed}ms) — ${totalChildren} children`);

  return {
    success: true,
    stats: {
      totalChildren: totalChildren,
      totalEarnedCommission: Math.round(totalEarnedCommission),
      totalPendingCommission: Math.round(totalPendingCommission),
      orders: orders
    }
  };
}

// ============================================================
//  2️⃣ validateMarketerCode
// ============================================================
export async function validateMarketerCode(params) {
  const cleanCode = String(params.code || '').trim().toUpperCase();
  if (!cleanCode) {
    return { success: false, valid: false, error: 'الكود مطلوب' };
  }

  const t0 = Date.now();
  const { data, error } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .select('code,name,discount_percent,is_active')
    .eq('code', cleanCode)
    .maybeSingle();
  const elapsed = Date.now() - t0;

  if (error) {
    console.error(`❌ [validateMarketerCode] ${cleanCode} (${elapsed}ms)`, error.message);
    return { success: false, valid: false, error: error.message };
  }

  if (!data) {
    console.log(`⚡ [validateMarketerCode] ${cleanCode} NOT FOUND (${elapsed}ms)`);
    // ✅ reason: not_found — كود غير موجود بالكل
    return { success: true, valid: false, reason: 'not_found' };
  }

  const isActive = String(data.is_active || '').trim();
  if (isActive !== 'نشط') {
    console.log(`⚡ [validateMarketerCode] ${cleanCode} INACTIVE (${elapsed}ms)`);
    // ✅ reason: inactive — كود موجود لكن غير نشط
    return { success: true, valid: false, reason: 'inactive' };
  }

  const discount = parseFloat(data.discount_percent) || 10;
  const owner = data.name || 'مسوق';

  console.log(`✅ [validateMarketerCode] ${cleanCode} (${elapsed}ms) — discount ${discount}%`);

  return {
    success: true,
    valid: true,
    discount: discount,
    owner: owner,
    reason: 'active'
  };
}

// ============================================================
//  3️⃣ marketerLogin
// ============================================================
export async function marketerLogin(params) {
  const cleanCode = String(params.code || '').trim().toUpperCase();
  const password = String(params.password || '').trim();

  if (!cleanCode) return { success: false, error: 'الكود مطلوب' };
  if (!password) return { success: false, error: 'كلمة السر مطلوبة' };

  const t0 = Date.now();
  const { data, error } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .select('*')
    .eq('code', cleanCode)
    .maybeSingle();
  const elapsed = Date.now() - t0;

  if (error) {
    console.error(`❌ [marketerLogin] ${cleanCode} (${elapsed}ms)`, error.message);
    return { success: false, error: error.message };
  }

  if (!data) {
    console.log(`❌ [marketerLogin] ${cleanCode} NOT FOUND (${elapsed}ms)`);
    return { success: false, error: 'الكود غير صحيح أو غير مسجل' };
  }

  const isActive = String(data.is_active || '').trim();
  if (isActive !== 'نشط') {
    console.log(`❌ [marketerLogin] ${cleanCode} INACTIVE (${elapsed}ms)`);
    return { success: false, error: 'الحساب غير نشط، يرجى التواصل مع الدعم' };
  }

  const storedHash = data.password_hash || '';
  if (!verifyPassword(password, storedHash)) {
    console.log(`❌ [marketerLogin] ${cleanCode} WRONG PASSWORD (${elapsed}ms)`);
    return { success: false, error: 'كلمة السر غير صحيحة' };
  }

  console.log(`✅ [marketerLogin] ${cleanCode} (${elapsed}ms)`);

  return {
    success: true,
    code: cleanCode,
    name: data.name || 'مسوق',
    phone: data.phone || '',
    email: data.email || ''
  };
}

// ============================================================
//  🕐 parseEgyptDate — تفسير توقيت مصر
// ============================================================
function parseEgyptDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  const str = String(value).trim();
  if (!str) return null;

  // ISO with timezone
  if (/[Zz]$/.test(str) || /[+-]\d{2}:?\d{2}$/.test(str)) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  // Cairo time (no timezone)
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (match) {
    return new Date(
      parseInt(match[1], 10),
      parseInt(match[2], 10) - 1,
      parseInt(match[3], 10),
      parseInt(match[4], 10),
      parseInt(match[5], 10),
      parseInt(match[6], 10)
    );
  }

  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// ============================================================
//  📬 getMarketersNeedingReminder
//  - يدور على المسوقين المؤهلين للتذكير
//  - Max count لتطبيق الـ daily cap
// ============================================================
export async function getMarketersNeedingReminder(maxCount = 30) {
  const t0 = Date.now();

  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .select('code,name,email,telegram_chat_id,notification_method,is_active,created_at,last_telegram_reminder_at,telegram_reminder_count')
      .eq('notification_method', 'telegram')
      .eq('is_active', 'نشط')
      .limit(500);

    if (error) {
      console.error(`❌ [getMarketersNeedingReminder] (${Date.now() - t0}ms)`, error.message);
      return { success: false, error: error.message, marketers: [] };
    }

    const now = Date.now();
    const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
    const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

    const eligible = [];

    for (const m of (data || [])) {
      // 1. مربوط بتليجرام؟ → تخطى
      const chatId = String(m.telegram_chat_id || '').trim();
      if (chatId) continue;

      // 2. وصل 5 تذكيرات؟ → تخطى
      const reminderCount = parseInt(m.telegram_reminder_count || '0', 10);
      if (reminderCount >= 5) continue;

      const lastReminderRaw = m.last_telegram_reminder_at;

      if (lastReminderRaw) {
        // عنده تذكير سابق → يجب ان يمر 5 أيام
        const lastTime = parseEgyptDate(lastReminderRaw);
        if (lastTime && (now - lastTime.getTime()) < FIVE_DAYS_MS) continue;
      } else {
        // أول تذكير → يجب ان يمر يومين من التسجيل
        const createdAt = parseEgyptDate(m.created_at);
        if (createdAt && (now - createdAt.getTime()) < TWO_DAYS_MS) continue;
      }

      eligible.push({
        code: String(m.code || '').trim(),
        name: String(m.name || 'مسوق').trim(),
        email: String(m.email || '').trim(),
        reminderCount: reminderCount,
        createdAt: m.created_at
      });

      if (eligible.length >= maxCount) break;
    }

    console.log(`✅ [getMarketersNeedingReminder] ${eligible.length} مؤهل (${Date.now() - t0}ms)`);

    return { success: true, marketers: eligible, total: eligible.length };

  } catch (err) {
    console.error(`❌ [getMarketersNeedingReminder] ${err.message}`);
    return { success: false, error: err.message, marketers: [] };
  }
}

// ============================================================
//  🚀 Dispatcher
// ============================================================
export async function handleSupabaseMarketerRead(innerAction, params) {
  switch (innerAction) {
    case 'getMarketerStats':
      return await getMarketerStats(params);
    case 'validateMarketerCode':
      return await validateMarketerCode(params);
    case 'marketerLogin':
      return await marketerLogin(params);
    default:
      return null;
  }
}