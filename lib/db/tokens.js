// ================================================================
//  lib/db/tokens.js — إدارة TempTokens (QR Scan Tokens)
//  - createOneTimeToken: إنشاء/استرجاع توكن مؤقت
//  - validateOneTimeToken: التحقق من التوكن
//  - getActiveTokenForChild: البحث عن توكن نشط
//  - markTokenAsUsed: تعليم التوكن كمستخدم
//  - markTokenAsCounted: تعليم التوكن كمحسوب
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN } from './tables.js';

// ============================================================
//  🕐 دوال التواريخ
// ============================================================
function nowEgypt() {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).replace('T', ' ');
}

function toEgypt(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).replace('T', ' ');
}

function futureEgypt(minutes) {
  const future = new Date(Date.now() + minutes * 60 * 1000);
  return toEgypt(future);
}

function cairoComponentsToUtcDate(year, monthIdx, day, hour, minute, second) {
  const dateAsUtc = new Date(Date.UTC(year, monthIdx, day, hour, minute, second));
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const parts = dtf.formatToParts(dateAsUtc);
  const get = (t) => parseInt(parts.find(p => p.type === t)?.value || '0', 10);
  const cairoY = get('year'); const cairoMo = get('month'); const cairoD = get('day');
  const cairoH = get('hour'); const cairoMi = get('minute'); const cairoS = get('second');
  const desiredMs = Date.UTC(year, monthIdx, day, hour, minute, second);
  const actualMs = Date.UTC(cairoY, cairoMo - 1, cairoD, cairoH, cairoMi, cairoS);
  const diffMs = actualMs - desiredMs;
  return new Date(dateAsUtc.getTime() - diffMs);
}

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
    return cairoComponentsToUtcDate(
      parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10),
      parseInt(match[4], 10), parseInt(match[5], 10), parseInt(match[6], 10)
    );
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

const TOKEN_DURATION_MIN = 5;

// ============================================================
//  🔑 generateToken — UUID 24 حرف
// ============================================================
function generateToken() {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 24);
}

// ============================================================
//  🔍 getActiveTokenForChild — توكن نشط (مُصحّح)
// ============================================================
export async function getActiveTokenForChild(childID) {
  const cleanID = String(childID || '').trim();
  if (!cleanID) return null;

  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.TEMP_TOKENS)
      .select('token,childid,expiresat,used')
      .eq('childid', cleanID)
      .eq('used', 'لا')
      .order('expiresat', { ascending: false })
      .limit(5);

    if (error || !data || data.length === 0) return null;

    // ✅ افحص كل واحد بالكود (مش SQL)
    const nowMs = Date.now();
    for (const row of data) {
      const expDate = parseEgyptDate(row.expiresat);
      if (expDate && nowMs < expDate.getTime()) {
        return {
          token: row.token,
          childID: String(row.childid || '').trim(),
          expiresAt: row.expiresat
        };
      }
    }
    return null;

  } catch (e) {
    console.error('❌ [getActiveTokenForChild]', e.message);
    return null;
  }
}

// ============================================================
//  ✅ createOneTimeToken — إنشاء أو استرجاع توكن
// ============================================================
export async function createOneTimeToken(params) {
  const cleanID = String(params.childID || '').trim();

  if (!cleanID) {
    return {
      success: false,
      code: 'child_not_found',
      childID: cleanID,
      message: 'معرف الطفل مفقود.'
    };
  }

  const t0 = Date.now();

  try {
    // 1. جيب الطفل
    const { data: child, error } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select('*')
      .eq(COLS_CHILDREN.child_id, cleanID)
      .maybeSingle();

    if (error || !child) {
      console.log(`❌ [createOneTimeToken] ${cleanID} NOT FOUND`);
      return {
        success: false,
        code: 'child_not_found',
        childID: cleanID,
        message: 'لا يوجد طفل مسجل بهذا المعرف.'
      };
    }

    const childName = String(child[COLS_CHILDREN.child_name] || '').trim();
    const status = String(child[COLS_CHILDREN.status] || '').trim().toLowerCase();
    const expiryRaw = child[COLS_CHILDREN.expiry_date];

    // 2. فحص الحالات بالترتيب
    if (status === 'deleted') {
      return { success: false, code: 'account_deleted', childID: cleanID, childName,
        message: 'هذا الحساب تم حذفه. للاستفسار تواصل مع الدعم: support@kidcode-eg.com' };
    }
    if (status === 'disabled') {
      return { success: false, code: 'account_disabled', childID: cleanID, childName,
        message: 'هذا الحساب معطّل مؤقتاً من قبل ولي الأمر.' };
    }
    if (status === 'pending') {
      return { success: false, code: 'account_pending', childID: cleanID, childName,
        message: 'الحساب قيد التفعيل، سيتم تفعيله خلال 24 ساعة.' };
    }
    if (status === 'suspended') {
      return { success: false, code: 'account_suspended', childID: cleanID, childName,
        message: 'هذا الحساب موقوف مؤقتاً من قِبل الإدارة.' };
    }

    // فحص expiry
    if (expiryRaw) {
      const expiryDate = new Date(expiryRaw).getTime();
      if (!isNaN(expiryDate) && expiryDate < Date.now()) {
        // حدّث status
        if (status === 'active') {
          await supabaseAdmin
            .from(TABLES.CHILDREN)
            .update({ [COLS_CHILDREN.status]: 'expired' })
            .eq(COLS_CHILDREN.child_id, cleanID);
        }
        return { success: false, code: 'account_expired', childID: cleanID, childName,
          message: 'انتهى اشتراك هذا الحساب.' };
      }
    }

    if (status !== 'active') {
      return { success: false, code: 'account_inactive', childID: cleanID, childName,
        message: 'هذا الحساب غير نشط حالياً.' };
    }

    // 3. ابحث عن توكن نشط
    const active = await getActiveTokenForChild(cleanID);

    let token;
    if (active) {
      token = active.token;
      console.log(`🔄 [createOneTimeToken] ${cleanID} — توكن نشط موجود`);
    } else {
      // 4. أنشئ توكن جديد
      token = generateToken();
      const createdAt = nowEgypt();
      const expiresAt = futureEgypt(TOKEN_DURATION_MIN);

      // INSERT في Supabase
      const { error: insertError } = await supabaseAdmin
        .from(TABLES.TEMP_TOKENS)
        .insert({
          token,
          childid: cleanID,
          createdat: createdAt,
          expiresat: expiresAt,
          used: 'لا',
          counted: 'لا'
        });

      if (insertError) {
        console.error(`❌ [createOneTimeToken] insert error:`, insertError.message);
        return { success: false, code: 'server_error', childID: cleanID, childName,
          message: 'خطأ في الخادم. تواصل مع الدعم.' };
      }

      console.log(`✅ [createOneTimeToken] ${cleanID} — توكن جديد (${Date.now() - t0}ms)`);
    }

    // 5. نجاح
    return {
      success: true,
      token,
      childID: cleanID,
      childName
    };

  } catch (err) {
    console.error(`❌ [createOneTimeToken] ${err.message}`);
    return { success: false, code: 'server_error', childID: cleanID,
      message: 'حدث خطأ غير متوقع. تواصل مع الدعم.' };
  }
}

// ============================================================
//  ✅ validateOneTimeToken — التحقق من التوكن (مُصحّح)
// ============================================================
export async function validateOneTimeToken(token) {
  if (!token) return null;

  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.TEMP_TOKENS)
      .select('*')
      .eq('token', token)
      .maybeSingle();

    if (error || !data) return null;

    const used = String(data.used || '').trim();
    const expiresRaw = data.expiresat;

    // ✅ فحص used
    if (used === 'نعم') {
      console.log(`⛔ [validateOneTimeToken] التوكن معطّل (USED='نعم')`);
      return null;
    }

    // ✅ فحص expiry بطريقة موحّدة
    if (expiresRaw) {
      const expiresDate = parseEgyptDate(expiresRaw);
      if (expiresDate && Date.now() > expiresDate.getTime()) {
        console.log(`⏰ [validateOneTimeToken] التوكن منتهي`);
        return null;
      }
    }

    return {
      childID: String(data.childid || '').trim(),
      valid: true,
      expiry: expiresRaw
    };

  } catch (e) {
    console.error('❌ [validateOneTimeToken]', e.message);
    return null;
  }
}

// ============================================================
//  ✅ markTokenAsUsed — تعليم التوكن كمستخدم
// ============================================================
export async function markTokenAsUsed(token) {
  try {
    if (!token) return { success: false, error: 'token_missing' };

    const { error } = await supabaseAdmin
      .from(TABLES.TEMP_TOKENS)
      .update({ used: 'نعم' })
      .eq('token', token);

    if (error) {
      console.error(`❌ [markTokenAsUsed]`, error.message);
      return { success: false, error: error.message };
    }

    console.log(`✅ [markTokenAsUsed] ${String(token).substring(0, 8)}...`);
    return { success: true };

  } catch (e) {
    console.error('❌ [markTokenAsUsed]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  ✅ markTokenAsCounted — تعليم التوكن كمحسوب (ذرّي)
//  - يحدّث counted = 'نعم' فقط إذا لم تكن 'نعم' بالفعل
//  - يعيد wasCounted = true إذا نجح التحديث (أي أن هذا أول طلب)
//  - يعيد wasCounted = false إذا كان محسوبًا مسبقًا (طلب مكرر)
// ============================================================
export async function markTokenAsCounted(token) {
  try {
    if (!token) return { success: false, wasCounted: false, error: 'token_missing' };

    const { data, error } = await supabaseAdmin
      .from(TABLES.TEMP_TOKENS)
      .update({ counted: 'نعم' })
      .eq('token', token)
      .neq('counted', 'نعم')
      .select('token');

    if (error) {
      return { success: false, wasCounted: false, error: error.message };
    }

    // إذا أرجع Supabase صفًا، فالتحديث نجح → هذا أول طلب
    // إذا أرجع مصفوفة فارغة، فالقيمة كانت 'نعم' بالفعل → طلب مكرر
    const wasCounted = Array.isArray(data) && data.length > 0;

    return { success: true, wasCounted };

  } catch (e) {
    return { success: false, wasCounted: false, error: e.message };
  }
}