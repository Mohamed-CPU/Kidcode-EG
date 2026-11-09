// ================================================================
//  lib/db/demo.js — إدارة جلسات التجربة (Demo Sessions)
//  - registerDemoSession: إنشاء جلسة جديدة + إيميل ترحيب
//  - getDemoSession: التحقق من الجلسة (5 دقائق)
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { TABLES } from './tables.js';
import { sendDemoWelcomeEmail } from '../email/brevo.js';

// ============================================================
//  🕐 دوال مساعدة
// ============================================================
function nowEgypt() {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).replace('T', ' ');
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

const DEMO_CHILD_ID = 'KC-01007';
const DEMO_SESSION_MINUTES = 5;

// ============================================================
//  🔢 تطبيع رقم الهاتف (يتخزن bigint بصيغة 20xxxxxxxxxx)
//  01012345678  →  201012345678
// ============================================================
function normalizeDemoPhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.substring(1);
  if (!digits.startsWith('20')) digits = '20' + digits;
  if (digits.length > 12) digits = digits.substring(digits.length - 12);
  return digits;
}

// ============================================================
//  🔑 توليد Demo Token — 12 حرف (نفس صيغة GAS)
// ============================================================
function generateDemoToken() {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 12).toUpperCase();
}

// ============================================================
//  1️⃣ registerDemoSession — إنشاء جلسة جديدة
// ============================================================
export async function registerDemoSession(params) {
  const name = String(params.name || '').trim();
  const email = String(params.email || '').trim().toLowerCase();
  const phoneRaw = String(params.phone || '').trim();

  // ============================================================
  //  Validation
  // ============================================================
  if (!name) {
    return { success: false, error: 'الاسم مطلوب' };
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: 'بريد إلكتروني غير صحيح' };
  }

  const cleanPhone = phoneRaw.replace(/\D/g, '');
  if (!cleanPhone || cleanPhone.length !== 11) {
    return { success: false, error: 'رقم هاتف غير صحيح (11 رقم)' };
  }

  const t0 = Date.now();

  try {
    // ============================================================
    //  INSERT في Supabase
    //  - phone: نرسله كنص (bigint-friendly)
    // ============================================================
    const token = generateDemoToken();
    const createdAt = nowEgypt();
    const phoneIntl = normalizeDemoPhone(cleanPhone);

    const { error: insertError } = await supabaseAdmin
      .from(TABLES.DEMO_SESSIONS)
      .insert({
        demotoken: token,
        childid: DEMO_CHILD_ID,
        fullname: name,
        email: email,
        phone: phoneIntl,
        createdat: createdAt,
        status: 'Active'
      });

    if (insertError) {
      console.error(`❌ [registerDemoSession] INSERT (${Date.now() - t0}ms)`, insertError.message);
      return { success: false, error: insertError.message };
    }

    console.log(`✅ [registerDemoSession] ${token} | ${name} (${Date.now() - t0}ms)`);

    // ============================================================
    //  إيميل ترحيب (best-effort — مش بنوقف لو فشل)
    // ============================================================
    try {
      await sendDemoWelcomeEmail(email, name);
    } catch (e) {
      console.warn('⚠️ [registerDemoSession] welcome email failed:', e.message);
    }

    // ============================================================
    //  نجاح — نفس صيغة redirectUrl بتاعة GAS
    // ============================================================
    return {
      success: true,
      token: token,
      redirectUrl: 'https://www.kidcode-eg.com/childView.html?id=' +
                   DEMO_CHILD_ID + '&demo=' + token
    };

  } catch (err) {
    console.error(`❌ [registerDemoSession] ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  2️⃣ getDemoSession — التحقق من الجلسة
//  - status = 'Active'
//  - العمر < 5 دقائق
// ============================================================
export async function getDemoSession(demoToken) {
  const cleanToken = String(demoToken || '').trim();
  if (!cleanToken) return null;

  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.DEMO_SESSIONS)
      .select('*')
      .eq('demotoken', cleanToken)
      .maybeSingle();

    if (error) {
      console.error('❌ [getDemoSession]', error.message);
      return null;
    }

    if (!data) return null;

    // فحص status
    const status = String(data.status || '').trim();
    if (status !== 'Active') return null;

    // فحص expiry (5 دقائق)
    const createdAt = parseEgyptDate(data.createdat);
    if (!createdAt) return null;

    const ageMs = Date.now() - createdAt.getTime();
    if (ageMs > DEMO_SESSION_MINUTES * 60 * 1000) {
      // علّم الجلسة كـ Expired
      try {
        await supabaseAdmin
          .from(TABLES.DEMO_SESSIONS)
          .update({ status: 'Expired' })
          .eq('demotoken', cleanToken);
      } catch (e) {}
      return null;
    }

    // ✅ حساب وقت الانتهاء بوقت Cairo الصحيح
    // (createdAt اتحسب فوق كـ Date object → Cairo time)
    const expiresAt = new Date(createdAt.getTime() + DEMO_SESSION_MINUTES * 60 * 1000);

    // ✅ phone بيتخزن bigint → بيرجع String من Supabase
    return {
      token: cleanToken,
      childID: String(data.childid || '').trim(),
      name: String(data.fullname || '').trim(),
      email: String(data.email || '').trim(),
      phone: data.phone ? String(data.phone) : '',
      createdAt: data.createdat,
      expiresAt: expiresAt.toISOString(),  // ← ISO string (UTC) للـ frontend
      status: status
    };

  } catch (err) {
    console.error('❌ [getDemoSession]', err.message);
    return null;
  }
}

// ============================================================
//  Constants (للتصدير)
// ============================================================
export { DEMO_CHILD_ID, DEMO_SESSION_MINUTES };