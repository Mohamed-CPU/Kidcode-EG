// ================================================================
//  lib/db/marketer-read.js — دوال قراءة المسوقين (Supabase)
//  - Read-only actions فقط
//  - Response shape مطابق تماماً لـ GAS
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN, COLS_MARKETERS, COLS_WITHDRAW } from './tables.js';

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
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (typeof value === 'string' && !value.includes('T') && value.includes('-')) {
    return value.split(' ')[0];
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  // ✅ Cairo date via Intl
  try {
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
  } catch (e) {
    return String(value);
  }
}

// ============================================================
//  🔐 Password Verification — SHA-256
// ============================================================
function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;
  const strHash = String(storedHash).trim();
  if (strHash.indexOf('$') !== -1) {
    const parts = strHash.split('$');
    if (parts.length !== 2) return false;
    const salt = parts[0];
    const expectedHash = parts[1];
    const inputHash = crypto.createHash('sha256').update(salt + password).digest('base64');
    return inputHash === expectedHash;
  }
  const legacyHash = crypto.createHash('sha256').update(password).digest('base64');
  return legacyHash === strHash;
}

// ============================================================
//  1️⃣ getMarketerStats
// ============================================================
export async function getMarketerStats(params) {
  try {
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

    // 🆕 حساب المرسل والمحجوز
    let totalSent = 0;
    let totalReserved = 0;

    try {
      const { data: sentReqs, error: sentErr } = await supabaseAdmin
        .from(TABLES.MARKETER_WITHDRAW_REQUESTS)
        .select(COLS_WITHDRAW.amount)
        .eq(COLS_WITHDRAW.marketer_code, cleanCode)
        .eq(COLS_WITHDRAW.status, 'sent');

      if (sentErr) {
        console.warn(`⚠️ [getMarketerStats] Sent reqs error:`, sentErr.message);
      } else {
        (sentReqs || []).forEach(function(w) {
          const amt = parseInt(w[COLS_WITHDRAW.amount] || '0', 10);
          if (!isNaN(amt) && amt > 0) totalSent += amt;
        });
      }

      const { data: activeReqs, error: activeErr } = await supabaseAdmin
        .from(TABLES.MARKETER_WITHDRAW_REQUESTS)
        .select(COLS_WITHDRAW.amount)
        .eq(COLS_WITHDRAW.marketer_code, cleanCode)
        .in(COLS_WITHDRAW.status, ['submitted', 'under_review', 'sending']);

      if (activeErr) {
        console.warn(`⚠️ [getMarketerStats] Active reqs error:`, activeErr.message);
      } else {
        (activeReqs || []).forEach(function(w) {
          const amt = parseInt(w[COLS_WITHDRAW.amount] || '0', 10);
          if (!isNaN(amt) && amt > 0) totalReserved += amt;
        });
      }
    } catch (e) {
      console.warn(`⚠️ [getMarketerStats] withdrawals query exception:`, e.message);
    }

    const rawEarnedRounded = Math.round(totalEarnedCommission);
    const earnedAfterSent = Math.max(0, rawEarnedRounded - totalSent);
    const availableBalance = Math.max(0, earnedAfterSent - totalReserved);

    const elapsed = Date.now() - t0;
    console.log(`✅ [getMarketerStats] ${cleanCode} (${elapsed}ms) — ${totalChildren} children`);

    return {
      success: true,
      stats: {
        totalChildren: totalChildren,
        totalEarnedCommission: earnedAfterSent,
        totalPendingCommission: Math.round(totalPendingCommission),
        totalSent: totalSent,
        totalReserved: totalReserved,
        availableBalance: availableBalance,
        orders: orders
      }
    };
  } catch (globalErr) {
    console.error(`❌ [getMarketerStats] global error:`, globalErr.message);
    return { success: false, error: globalErr.message };
  }
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
    return { success: true, valid: false, reason: 'not_found' };
  }

  const isActive = String(data.is_active || '').trim();
  if (isActive !== 'نشط') {
    console.log(`⚡ [validateMarketerCode] ${cleanCode} INACTIVE (${elapsed}ms)`);
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
//  🕐 parseEgyptDate
// ============================================================
function parseEgyptDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const str = String(value).trim();
  if (!str) return null;
  if (/[Zz]$/.test(str) || /[+-]\d{2}:?\d{2}$/.test(str)) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (match) {
    return new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10), parseInt(match[4], 10), parseInt(match[5], 10), parseInt(match[6], 10));
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// ============================================================
//  📬 getMarketersNeedingReminder
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
      const chatId = String(m.telegram_chat_id || '').trim();
      if (chatId) continue;
      const reminderCount = parseInt(m.telegram_reminder_count || '0', 10);
      if (reminderCount >= 5) continue;

      const lastReminderRaw = m.last_telegram_reminder_at;

      if (lastReminderRaw) {
        const lastTime = parseEgyptDate(lastReminderRaw);
        if (lastTime && (now - lastTime.getTime()) < FIVE_DAYS_MS) continue;
      } else {
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
//  🆕 4️⃣ getWithdrawHistory
// ============================================================
export async function getWithdrawHistory(params) {
  const cleanCode = String(params.code || params.marketerCode || '').trim().toUpperCase();
  if (!cleanCode) return { success: false, error: 'الكود مطلوب' };

  const t0 = Date.now();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    await supabaseAdmin
      .from(TABLES.MARKETER_WITHDRAW_REQUESTS)
      .update({
        [COLS_WITHDRAW.status]: 'expired',
        [COLS_WITHDRAW.updated_at]: new Date().toISOString()
      })
      .eq(COLS_WITHDRAW.marketer_code, cleanCode)
      .in(COLS_WITHDRAW.status, ['submitted', 'under_review'])
      .lt(COLS_WITHDRAW.created_at, sevenDaysAgo);
  } catch (e) {
    console.warn(`⚠️ [getWithdrawHistory] auto-expire:`, e.message);
  }

  const { data, error } = await supabaseAdmin
    .from(TABLES.MARKETER_WITHDRAW_REQUESTS)
    .select('*')
    .eq(COLS_WITHDRAW.marketer_code, cleanCode)
    .order(COLS_WITHDRAW.created_at, { ascending: false })
    .limit(200);

  if (error) {
    console.error(`❌ [getWithdrawHistory] ${cleanCode} (${Date.now() - t0}ms)`, error.message);
    return { success: false, error: error.message };
  }

  const requests = (data || []).map(function(r) {
    const method = String(r[COLS_WITHDRAW.method] || '').trim();
    return {
      id: r[COLS_WITHDRAW.id],
      requestId: r[COLS_WITHDRAW.request_id],
      amount: parseInt(r[COLS_WITHDRAW.amount] || '0', 10),
      method: method,
      methodLabel: method === 'instapay' ? 'انستاباي' : 'محفظة إلكترونية',
      transferNumber: String(r[COLS_WITHDRAW.transfer_number] || '').trim(),
      status: String(r[COLS_WITHDRAW.status] || '').trim(),
      rejectionReason: r[COLS_WITHDRAW.rejection_reason] || null,
      cancellationReason: r[COLS_WITHDRAW.cancellation_reason] || null,
      screenshotUrl: r[COLS_WITHDRAW.screenshot_url] || null,
      createdAt: r[COLS_WITHDRAW.created_at],
      updatedAt: r[COLS_WITHDRAW.updated_at],
      sentAt: r[COLS_WITHDRAW.sent_at]
    };
  });

  const elapsed = Date.now() - t0;
  console.log(`✅ [getWithdrawHistory] ${cleanCode} (${elapsed}ms) — ${requests.length} requests`);

  return {
    success: true,
    requests: requests
  };
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
    case 'getWithdrawHistory':
      return await getWithdrawHistory(params);
    default:
      return null;
  }
}