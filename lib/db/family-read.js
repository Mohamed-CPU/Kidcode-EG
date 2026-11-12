// ================================================================
//  lib/db/family-read.js — دوال قراءة لوحة الأسرة (Supabase)
//  ⚠️ بعد Migration: كل الأعمدة الزمنية timestamptz (UTC)
//  ✅ القراءة: new Date(iso) مباشرة | العرض: Cairo time عبر Intl
//  ❌ مفيش تحويلات يدوية للتوقيت | مفيش مقارنات نصية
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN, COLS_FACE } from './tables.js';

// ============================================================
//  🕐 دوال التواريخ
// ============================================================
function nowUTC() {
  // للكتابة في DB
  return new Date().toISOString();
}

// تحويل أي قيمة لـ Date — آمن مع ISO (timestamptz) و Date object
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// ============================================================
//  📅 formatDateTimeLikeGAS — ترجع ISO 8601 UTC صريح
//  ⚠️ بعد Migration: الـ Frontend يستخدم Intl + Africa/Cairo للعرض
//  ✅ يطابق الـ Spec: كل ما يُرسل للـ Frontend = ISO مع Z
// ============================================================
function formatDateTimeLikeGAS(value) {
  if (!value) return '';

  // ✅ timestamptz من Supabase → ISO UTC جاهز
  // نرجعه كما هو — الـ Frontend يعرضه بـ Intl
  const d = toDate(value);
  if (!d) return String(value);
  return d.toISOString();
}

// "YYYY-MM-DD" — بالقيمة في Cairo
function formatDateOnlyLikeGAS(value) {
  if (!value) return '';

  // ✅ backward-compat: "YYYY-MM-DD" خام → رجعه كما هو
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const d = toDate(value);
  if (!d) return String(value);

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  const get = t => (parts.find(p => p.type === t)?.value || '00');

  return `${get('year')}-${get('month')}-${get('day')}`;
}

// ============================================================
//  🌍 cairoMidnightUTC — تحويل "YYYY-MM-DD" (بداية يوم Cairo) → Date UTC
//  يحسب DST تلقائياً عبر Intl
// ============================================================
function cairoMidnightUTC(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return null;

  // نفترض التاريخ كأنه UTC (probe)
  const naiveUTC = Date.UTC(y, m - 1, d, 0, 0, 0);

  // نحسب إيه القيمة اللي Cairo هيعرضها لو الـ probe كان UTC
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(new Date(naiveUTC));
  const get = t => parseInt(parts.find(p => p.type === t)?.value || '0', 10);
  const cairoAsUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));

  // الفرق = الـ offset الحقيقي لـ Cairo في ذلك اليوم (يشمل DST)
  const offsetMs = cairoAsUTC - naiveUTC;

  // الوقت الحقيقي UTC لـ 00:00:00 Cairo = naiveUTC - offset
  return new Date(naiveUTC - offsetMs);
}

// ============================================================
//  📊 preparePeriod — يرجع Cairo dates للعرض + UTC Dates للفلترة
//  - Cairo date boundaries (00:00:00 → 23:59:59) بتحسب DST تلقائياً
// ============================================================
function preparePeriod(fromDate, toDate) {
  const now = new Date();
  let fromCairo, toCairo;

  if (fromDate) {
    fromCairo = String(fromDate).trim().split(' ')[0];
  } else {
    const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    fromCairo = formatDateOnlyLikeGAS(d);
  }

  if (toDate) {
    toCairo = String(toDate).trim().split(' ')[0];
  } else {
    toCairo = formatDateOnlyLikeGAS(now);
  }

  // نطاق UTC الحقيقي
  const fromUTC = cairoMidnightUTC(fromCairo);           // 00:00:00 Cairo
  const toStartUTC = cairoMidnightUTC(toCairo);          // 00:00:00 Cairo (بداية to)
  const toUTC = toStartUTC
    ? new Date(toStartUTC.getTime() + 24 * 60 * 60 * 1000 - 1)  // 23:59:59.999 Cairo
    : null;

  // حساب الأيام (inclusive) — ✅ دقيق 100% وبيتجاهل DST (التوقيت الصيفي)
  // بنحسبها بناءً على التواريخ التقويمية اللي جاية من الفرونت (Cairo)
  let days = 30;
  if (fromCairo && toCairo) {
    const [y1, m1, d1] = fromCairo.split('-').map(Number);
    const [y2, m2, d2] = toCairo.split('-').map(Number);
    const utc1 = Date.UTC(y1, m1 - 1, d1);
    const utc2 = Date.UTC(y2, m2 - 1, d2);
    // +1 لأننا بنحسب اليوم الأول والأخير مع بعض
    days = Math.round((utc2 - utc1) / 86400000) + 1;
    console.log(`📅 [preparePeriod] From: ${fromCairo} To: ${toCairo} -> Calculated ${days} days`);
  }

  return {
    from: fromCairo,   // للعرض
    to: toCairo,       // للعرض
    fromUTC,           // Date object — للفلترة
    toUTC,             // Date object — للفلترة
    days
  };
}

// ============================================================
//  🧮 Helpers — التنسيق والأرقام
// ============================================================
function formatArabicCount(count, forms) {
  if (count === 1) return forms.singular;
  if (count === 2) return forms.dual;
  if (count >= 3 && count <= 10) return count + ' ' + forms.plural;
  return count + ' ' + forms.singular;
}

function calculateAge(birthDateStr) {
  if (!birthDateStr) return 'غير محدد';
  let normalized = String(birthDateStr).trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    const d = new Date(normalized);
    if (isNaN(d.getTime())) return 'تاريخ غير صحيح';
    normalized = d.toISOString().split('T')[0];
  }
  const parts = normalized.split('-');
  const year = parseInt(parts[0], 10); const month = parseInt(parts[1], 10) - 1; const day = parseInt(parts[2], 10);

  // ✅ Cairo "today" via Intl (DST-aware) — بدل Local TZ
  const todayParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const getP = (t) => parseInt(todayParts.find(p => p.type === t).value, 10);
  const todayYear = getP('year');
  const todayMonth = getP('month') - 1;
  const todayDay = getP('day');

  let years = todayYear - year; let months = todayMonth - month; let days = todayDay - day;
  if (days < 0) { months--; const prevMonth = new Date(Date.UTC(todayYear, todayMonth, 0)).getUTCDate(); days += prevMonth; }
  if (months < 0) { years--; months += 12; }
  if (years <= 0 && months === 0 && days === 0) return 'أقل من يوم';
  const parts2 = [];
  if (years > 0) parts2.push(formatArabicCount(years, { singular: 'سنة', dual: 'سنتان', plural: 'سنوات' }));
  if (months > 0) parts2.push(formatArabicCount(months, { singular: 'شهر', dual: 'شهران', plural: 'أشهر' }));
  if (days > 0) parts2.push(formatArabicCount(days, { singular: 'يوم', dual: 'يومان', plural: 'أيام' }));
  return parts2.length === 0 ? 'أقل من يوم' : parts2.join(' و ');
}

// ============================================================
//  🧹 Normalization
// ============================================================
function normalizeNotes(value) {
  if (value === null || value === undefined) return '[]';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch (e) { return '[]'; }
}

function normalizeCourtRequested(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  const str = String(value).trim().toLowerCase();
  return ['نعم', 'yes', 'true', '1'].includes(str);
}

function toStr(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

// ============================================================
//  🔧 تحويل الفاصلة العربية لنقطة + رقم
// ============================================================
function toNumericCoord(value) {
  if (value === null || value === undefined || value === '') return null;
  const str = String(value).trim().replace(/[٫،]/g, '.').replace(/,/g, '.');
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

function toEnglishDecimalStr(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/[٫،]/g, '.').replace(/,/g, '.');
}

function isInvalidCoord(value) {
  if (value === null || value === undefined || value === '') return true;
  const str = String(value).trim().toUpperCase();
  const invalid = ['REFUSED', 'FAILED', 'UNAVAILABLE', 'UNDEFINED', 'NULL', 'NAN', '#NUM!'];
  return invalid.includes(str);
}

// ============================================================
//  📊 buildFamilyReportSummary — ملخص للتقارير
// ============================================================
function buildFamilyReportSummary(child) {
  const scanCount = parseInt(child[COLS_CHILDREN.scan_count] || '0', 10);
  const lastScan = String(child[COLS_CHILDREN.last_scan] || '').trim();
  const lastLocation = String(child[COLS_CHILDREN.last_location] || '').trim();
  const plan = String(child[COLS_CHILDREN.plan] || '').trim();
  const status = String(child[COLS_CHILDREN.status] || '').trim().toLowerCase();
  const expiryRaw = child[COLS_CHILDREN.expiry_date];
  const registrationRaw = child[COLS_CHILDREN.registration_date];

  let daysRemaining = null;
  let expiryDateStr = null;
  if (expiryRaw) {
    const expiryDate = toDate(expiryRaw);
    if (expiryDate) {
      daysRemaining = Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      expiryDateStr = formatDateOnlyLikeGAS(expiryDate);
    }
  }

  const registrationDateStr = registrationRaw
    ? formatDateOnlyLikeGAS(registrationRaw)
    : null;

  return {
    childID: String(child[COLS_CHILDREN.child_id] || '').trim(),
    childName: String(child[COLS_CHILDREN.child_name] || '').trim(),
    age: calculateAge(child[COLS_CHILDREN.birth_date]),
    plan: plan,
    status: status,
    totalScans: scanCount,
    lastScan: lastScan || 'لا يوجد',
    lastLocation: lastLocation || 'لا يوجد',
    expiryDate: expiryDateStr,
    daysRemaining: daysRemaining,
    registrationDate: registrationDateStr
  };
}

// ============================================================
//  1️⃣ getChildDataForFamily
// ============================================================
export async function getChildDataForFamily(params) {
  const cleanID = String(params.childID || '').trim();
  if (!cleanID) return { success: false, error: 'childID مطلوب' };

  const t0 = Date.now();
  const { data, error } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.child_id, cleanID)
    .limit(1)
    .maybeSingle();
  const elapsed = Date.now() - t0;

  if (error) {
    console.error(`❌ [getChildDataForFamily] ${cleanID} (${elapsed}ms)`, error.message);
    return { success: false, error: error.message };
  }
  if (!data) {
    console.log(`⚡ [getChildDataForFamily] ${cleanID} NOT FOUND (${elapsed}ms)`);
    return { success: false, error: 'الطفل غير موجود' };
  }

  console.log(`✅ [getChildDataForFamily] ${cleanID} (${elapsed}ms)`);

  // Fetch payment & marketer info
  let marketerDiscount = 0;
  const marketerID = toStr(data[COLS_CHILDREN.marketer_id]).trim();
  if (marketerID) {
    try {
      const { data: marketer } = await supabaseAdmin
        .from(TABLES.MARKETERS)
        .select('discount_percent,is_active')
        .eq('code', marketerID)
        .maybeSingle();
      if (marketer && String(marketer.is_active || '').trim() === 'نشط') {
        marketerDiscount = parseFloat(marketer.discount_percent) || 0;
      }
    } catch (e) {}
  }

  let lastPayment = null;
  let hasPaidHistory = false;
  try {
    const { data: lp } = await supabaseAdmin
      .from(TABLES.PAYMENTS)
      .select('status,type,amount_cents,plan,created_at')
      .eq('child_id', cleanID)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    lastPayment = lp;

    const { count } = await supabaseAdmin
      .from(TABLES.PAYMENTS)
      .select('id', { count: 'exact', head: true })
      .eq('child_id', cleanID)
      .eq('status', 'paid');
    hasPaidHistory = (count || 0) > 0;
  } catch (e) {}

  return {
    success: true,
    data: {
      email: toStr(data[COLS_CHILDREN.email_code]),
      childName: toStr(data[COLS_CHILDREN.child_name]),
      birthDate: toStr(data[COLS_CHILDREN.birth_date]),
      googleMapsAddress: toStr(data[COLS_CHILDREN.google_maps]),
      detailedAddress: toStr(data[COLS_CHILDREN.detailed_address]),
      fatherPhone: toStr(data[COLS_CHILDREN.father_phone]),
      motherName: toStr(data[COLS_CHILDREN.mother_name]),
      motherPhone: toStr(data[COLS_CHILDREN.mother_phone]),
      notes: normalizeNotes(data[COLS_CHILDREN.notes]),
      plan: toStr(data[COLS_CHILDREN.plan]),
      expiryDate: formatDateTimeLikeGAS(data[COLS_CHILDREN.expiry_date]),
      imageFileId: toStr(data[COLS_CHILDREN.child_image_url]),
      status: String(data[COLS_CHILDREN.status] || '').trim().toLowerCase(),
      marketerId: toStr(data[COLS_CHILDREN.marketer_id]),
      courtRequested: normalizeCourtRequested(data[COLS_CHILDREN.court_requested]),

      // Payment data
      marketerDiscount,
      hasPaidHistory,
      lastPaymentStatus: lastPayment ? lastPayment.status : null,
      lastPaymentType: lastPayment ? lastPayment.type : null,
      lastPaymentAmount: lastPayment ? Math.round(lastPayment.amount_cents / 100) : null,
      lastPaymentPlan: lastPayment ? lastPayment.plan : null
    }
  };
}

// ============================================================
//  2️⃣ getFaceStatus
// ============================================================
export async function getFaceStatus(params) {
  const cleanID = String(params.childID || '').trim();
  if (!cleanID) return { success: false, error: 'معرف الطفل مطلوب' };

  const t0 = Date.now();
  const { data, error } = await supabaseAdmin
    .from(TABLES.FACE_FEATURES)
    .select('child_id,created_at,updated_at,is_active')
    .eq(COLS_FACE.child_id, cleanID)
    .maybeSingle();
  const elapsed = Date.now() - t0;

  if (error) {
    console.error(`❌ [getFaceStatus] ${cleanID} (${elapsed}ms)`, error.message);
    return { success: false, error: error.message };
  }

  const isActive = data && (
    data.is_active === true || String(data.is_active || '').trim() === 'نعم'
  );

  if (!data || !isActive) {
    console.log(`⚡ [getFaceStatus] ${cleanID} NO DATA (${elapsed}ms)`);
    return { success: true, hasFaceData: false };
  }

  console.log(`✅ [getFaceStatus] ${cleanID} (${elapsed}ms)`);

  return {
    success: true,
    hasFaceData: true,
    createdAt: formatDateTimeLikeGAS(data.created_at),
    updatedAt: formatDateTimeLikeGAS(data.updated_at)
  };
}

// ============================================================
//  3️⃣ getTelegramStatus
// ============================================================
export async function getTelegramStatus(params) {
  const cleanID = String(params.childID || '').trim();
  if (!cleanID) return { success: false, error: 'childID مطلوب' };

  const t0 = Date.now();
  const { data, error } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select([
      COLS_CHILDREN.telegram_chat_id_father,
      COLS_CHILDREN.telegram_chat_id_mother,
      COLS_CHILDREN.telegram_linked_at_father,
      COLS_CHILDREN.telegram_linked_at_mother,
      COLS_CHILDREN.notification_method,
    ].join(','))
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();
  const elapsed = Date.now() - t0;

  if (error) {
    console.error(`❌ [getTelegramStatus] ${cleanID} (${elapsed}ms)`, error.message);
    return { success: false, error: error.message };
  }
  if (!data) {
    console.log(`⚡ [getTelegramStatus] ${cleanID} NOT FOUND (${elapsed}ms)`);
    return { success: false, error: 'child_not_found' };
  }

  const fatherChatId = String(data.telegram_chat_id_father || '').trim();
  const motherChatId = String(data.telegram_chat_id_mother || '').trim();
  const fatherLinkedAt = formatDateTimeLikeGAS(data.telegram_linked_at_father);
  const motherLinkedAt = formatDateTimeLikeGAS(data.telegram_linked_at_mother);
  const method = String(data.notification_method || 'email').trim() || 'email';

  console.log(`✅ [getTelegramStatus] ${cleanID} (${elapsed}ms)`);

  return {
    success: true,
    father: {
      isLinked: !!fatherChatId,
      chatId: fatherChatId || null,
      linkedAt: fatherLinkedAt || null
    },
    mother: {
      isLinked: !!motherChatId,
      chatId: motherChatId || null,
      linkedAt: motherLinkedAt || null
    },
    anyLinked: !!(fatherChatId || motherChatId),
    notificationMethod: method
  };
}

// ============================================================
//  4️⃣ hasFamilyPassword
// ============================================================
export async function hasFamilyPassword(params) {
  const cleanID = String(params.childID || '').trim();
  if (!cleanID) return false;

  const t0 = Date.now();
  const { data, error } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select(COLS_CHILDREN.family_password_hash)
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();
  const elapsed = Date.now() - t0;

  if (error) {
    console.error(`❌ [hasFamilyPassword] ${cleanID} (${elapsed}ms)`, error.message);
    return false;
  }

  const hasPwd = !!(data && data[COLS_CHILDREN.family_password_hash]);
  console.log(`✅ [hasFamilyPassword] ${cleanID} → ${hasPwd} (${elapsed}ms)`);
  return hasPwd;
}

// ============================================================
//  5️⃣ getFamilyReports
// ============================================================
export async function getFamilyReports(params) {
  const cleanID = String(params.childID || '').trim();
  if (!cleanID) return { success: false, error: 'childID مطلوب' };

  const t0 = Date.now();

  // ============================================================
  //  1️⃣ جيب الطفل
  // ============================================================
  let child = null;
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select('*')
      .eq(COLS_CHILDREN.child_id, cleanID)
      .maybeSingle();

    if (error) {
      console.error(`❌ [getFamilyReports] child query error:`, {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      return { success: false, error: 'database_error', detail: error.message };
    }
    child = data;
  } catch (e) {
    console.error(`❌ [getFamilyReports] child exception:`, e.message, e.stack);
    return { success: false, error: 'server_error', detail: e.message };
  }

  if (!child) return { success: false, error: 'child_not_found', message: 'الطفل غير موجود' };

  const status = String(child[COLS_CHILDREN.status] || '').trim().toLowerCase();
  if (status === 'deleted') {
    return { success: false, error: 'account_deleted', code: 'account_deleted' };
  }

  // ============================================================
  //  2️⃣ Period — Cairo dates + UTC Date objects للفلترة
  // ============================================================
  let period;
  try {
    period = preparePeriod(params.fromDate, params.toDate);
    if (!period || !period.from || !period.to || !period.fromUTC || !period.toUTC) {
      throw new Error('Invalid period');
    }
  } catch (e) {
    console.error(`❌ [getFamilyReports] preparePeriod error:`, e.message);
    // Fallback: آخر 30 يوم
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    period = preparePeriod(
      formatDateOnlyLikeGAS(from),
      formatDateOnlyLikeGAS(now)
    );
  }

  // ============================================================
  //  3️⃣ Summary
  // ============================================================
  let summary;
  try {
    summary = buildFamilyReportSummary(child);
  } catch (e) {
    console.error(`❌ [getFamilyReports] buildFamilyReportSummary error:`, e.message);
    summary = {
      childID: cleanID,
      childName: String(child[COLS_CHILDREN.child_name] || ''),
      age: 'غير محدد',
      plan: String(child[COLS_CHILDREN.plan] || ''),
      status: status,
      totalScans: 0,
      lastScan: 'لا يوجد',
      lastLocation: 'لا يوجد',
      expiryDate: null,
      daysRemaining: null,
      registrationDate: null
    };
  }

  // ============================================================
  //  4️⃣ Scan rows — جلبها (نفلتر في JS بـ Date)
  // ============================================================
  let scanRows = [];
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.SCAN_LOGS)
      .select('*')
      .eq('child_id', cleanID)
      .order('timestamp', { ascending: false })
      .limit(500);

    if (error) {
      console.error(`❌ [getFamilyReports] scan query error:`, {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
    } else {
      scanRows = data || [];
    }
  } catch (e) {
    console.error(`❌ [getFamilyReports] scan exception:`, e.message, e.stack);
  }

  // ============================================================
  //  5️⃣ Process scan logs — فلترة بـ Date.getTime()
  // ============================================================
  const locationLogs = [];
  const dailyMap = {};
  const fromMs = period.fromUTC.getTime();
  const toMs = period.toUTC.getTime();
  let matchedCount = 0;
  let skippedRows = 0;

  // ✅ 1. تجهيز الـ dailyMap بكل أيام الفترة (عشان الرسم البياني يظهر كامل)
  let currentDay = new Date(period.from + 'T12:00:00Z');
  const endDay = new Date(period.to + 'T12:00:00Z');
  while (currentDay <= endDay) {
    const dateStr = currentDay.toISOString().split('T')[0];
    dailyMap[dateStr] = { date: dateStr, scans: 0, locations: 0 };
    currentDay.setUTCDate(currentDay.getUTCDate() + 1);
  }

  // ✅ 2. إضافة المسحات الفعلية
  for (let i = 0; i < scanRows.length; i++) {
    const row = scanRows[i];
    try {
      const rawTs = row.timestamp;
      if (!rawTs) { skippedRows++; continue; }

      // ✅ ISO من timestamptz → Date
      const scanDate = toDate(rawTs);
      if (!scanDate) { skippedRows++; continue; }

      const scanMs = scanDate.getTime();
      if (scanMs < fromMs || scanMs > toMs) continue;

      const formatted = formatDateTimeLikeGAS(scanDate);
      matchedCount++;


      const lat = row.latitude;
      const lng = row.longitude;
      const source = String(row.location_source || 'unknown').trim();
      const hasLatLng = !isInvalidCoord(lat) && !isInvalidCoord(lng);

      if (hasLatLng && locationLogs.length < 500) {
        const latNum = toNumericCoord(lat);
        const lngNum = toNumericCoord(lng);
        const latStr = toEnglishDecimalStr(lat);
        const lngStr = toEnglishDecimalStr(lng);

        locationLogs.push({
          timestamp: formatted,
          lat: latNum !== null ? latNum : latStr,
          lng: lngNum !== null ? lngNum : lngStr,
          address: String(row.address || '').trim(),
          source: source || 'unknown',
          mapsLink: `https://maps.google.com/?q=${latStr},${lngStr}`,
          ip: String(row.ip || '').trim()
        });
      }

      // ✅ dateOnly بالقيمة في Cairo (عشان dailyStats)
      const dateOnly = formatDateOnlyLikeGAS(scanDate);
      if (dateOnly) {
        if (!dailyMap[dateOnly]) dailyMap[dateOnly] = { date: dateOnly, scans: 0, locations: 0 };
        dailyMap[dateOnly].scans++;
        if (hasLatLng) dailyMap[dateOnly].locations++;
      }
    } catch (rowErr) {
      skippedRows++;
      if (skippedRows <= 3) {
        console.warn(`⚠️ [getFamilyReports] row ${i} skipped:`, rowErr.message, {
          timestamp: row.timestamp,
          child_id: row.child_id
        });
      }
    }
  }

  const dailyStats = Object.values(dailyMap).sort(function(a, b) {
    return a.date.localeCompare(b.date);
  });

  const elapsed = Date.now() - t0;
  console.log(
    `✅ [getFamilyReports] ${cleanID} (${elapsed}ms) | ` +
    `period: ${period.from} → ${period.to} (Cairo) | ` +
    `rows: ${scanRows.length} | matched: ${matchedCount} | ` +
    `locations: ${locationLogs.length} | daily: ${dailyStats.length} | ` +
    `skipped: ${skippedRows}`
  );

  return {
    success: true,
    summary: summary,
    locationLogs: locationLogs,
    dailyStats: dailyStats,
    period: {
      from: period.from,
      to: period.to,
      days: period.days
    },
    projectName: 'KidCode-EG'
  };
}

// ============================================================
//  6️⃣ getScanReport
// ============================================================
export async function getScanReport(params) {
  const cleanID = String(params.childID || '').trim();
  if (!cleanID) return { success: false, error: 'معرف الطفل مطلوب' };

  const t0 = Date.now();

  const { data: child, error: childError } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (childError) return { success: false, error: childError.message };
  if (!child) return { success: false, error: 'الطفل غير موجود' };

  const scanCount = parseInt(child[COLS_CHILDREN.scan_count] || '0', 10);
  const lastScan = String(child[COLS_CHILDREN.last_scan] || '').trim();
  const lastLocation = String(child[COLS_CHILDREN.last_location] || '').trim();
  const expiryRaw = child[COLS_CHILDREN.expiry_date];
  const status = String(child[COLS_CHILDREN.status] || '').trim();
  const plan = String(child[COLS_CHILDREN.plan] || '').trim();

  const { data: scanRows, error: scanError } = await supabaseAdmin
    .from(TABLES.SCAN_LOGS)
    .select('*')
    .eq('child_id', cleanID)
    .order('timestamp', { ascending: false })
    .limit(10);

  if (scanError) return { success: false, error: scanError.message };

  const scanLogs = (scanRows || []).map(function(row) {
    const latNum = toNumericCoord(row.latitude);
    const lngNum = toNumericCoord(row.longitude);
    return {
      timestamp: formatDateTimeLikeGAS(row.timestamp),
      lat: latNum !== null ? latNum : toEnglishDecimalStr(row.latitude),
      lng: lngNum !== null ? lngNum : toEnglishDecimalStr(row.longitude),
      source: String(row.location_source || '').trim(),
      ip: String(row.ip || '').trim()
    };
  });

  let daysRemaining = null;
  if (expiryRaw) {
    const expiry = toDate(expiryRaw);
    if (expiry) {
      daysRemaining = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    }
  }

  console.log(`✅ [getScanReport] ${cleanID} (${Date.now() - t0}ms)`);

  return {
    success: true,
    data: {
      scanCount: scanCount,
      lastScan: lastScan,
      lastLocation: lastLocation,
      scanLogs: scanLogs,
      expiryDate: formatDateOnlyLikeGAS(expiryRaw),   // ✅ تاريخ Cairo
      daysRemaining: daysRemaining,
      status: status,
      plan: plan
    }
  };
}

// ============================================================
//  7️⃣ verifyFamilySession — التحقق من الجلسة
//  ✅ مقارنة Date.getTime() | تنظيف بـ ISO UTC
// ============================================================
export async function verifyFamilySession(params) {
  const token = String(params.session || '').trim();
  if (!token) {
    return { valid: false, error: 'session_token مطلوب' };
  }

  const t0 = Date.now();
  const { data, error } = await supabaseAdmin
    .from(TABLES.FAMILY_SESSIONS)
    .select('session_token,child_id,status,expires_at')
    .eq('session_token', token)
    .maybeSingle();
  const elapsed = Date.now() - t0;

  if (error) {
    console.error(`❌ [verifyFamilySession] (${elapsed}ms)`, error.message);
    return { valid: false, error: 'خطأ في قراءة الجلسة' };
  }

  if (!data) {
    console.log(`⚡ [verifyFamilySession] NOT FOUND (${elapsed}ms)`);
    return { valid: false, error: 'الجلسة غير موجودة' };
  }

  const status = String(data.status || '').trim().toLowerCase();
  if (status !== 'active') {
    console.log(`⚡ [verifyFamilySession] STATUS=${status} (${elapsed}ms)`);
    return { valid: false, error: 'الجلسة غير نشطة' };
  }

  // ✅ فحص expires_at — ISO من timestamptz
  const expiresRaw = data.expires_at;
  if (expiresRaw) {
    const expiresDate = toDate(expiresRaw);
    if (expiresDate && Date.now() >= expiresDate.getTime()) {
      console.log(`⏰ [verifyFamilySession] EXPIRED (${elapsed}ms) | expires: ${expiresRaw}`);

      // ✅ نظّف كل الجلسات المنتهية لنفس الطفل — UTC ISO
      try {
        const nowISO = nowUTC();

        await supabaseAdmin
          .from(TABLES.FAMILY_SESSIONS)
          .update({ status: 'expired' })
          .eq('child_id', data.child_id)
          .eq('status', 'active')
          .lt('expires_at', nowISO);

        console.log(`🧹 [verifyFamilySession] تم تنظيف جلسات ${data.child_id}`);
      } catch (e) {
        console.warn('⚠️ [verifyFamilySession] فشل تحديث status:', e.message);
      }

      return { valid: false, error: 'انتهت صلاحية الجلسة' };
    }
  }

  console.log(`✅ [verifyFamilySession] ${data.child_id} (${elapsed}ms)`);

  return {
    valid: true,
    child_id: String(data.child_id).trim()
  };
}

// ============================================================
//  🚀 Dispatcher
// ============================================================
export async function handleSupabaseRead(innerAction, params) {
  switch (innerAction) {
    case 'getChildDataForFamily':
      return await getChildDataForFamily(params);
    case 'getFaceStatus':
      return await getFaceStatus(params);
    case 'getTelegramStatus':
      return await getTelegramStatus(params);
    case 'hasFamilyPassword':
      return await hasFamilyPassword(params);
    case 'getFamilyReports':
      return await getFamilyReports(params);
    case 'getScanReport':
      return await getScanReport(params);
    case 'verifyFamilySession':
      return await verifyFamilySession(params);
    default:
      return null;
  }
}