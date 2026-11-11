// ================================================================
//  lib/db/children.js — منطق صفحة الطفل (QR Scan)
//  ⚠️ بعد Migration: كل الأعمدة الزمنية timestamptz (UTC)
//  ✅ الكتابة في DB: new Date().toISOString() فقط
//  ✅ العرض البشري (إيميلات): nowEgyptDisplay()
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN } from './tables.js';
import { validateOneTimeToken, markTokenAsCounted, parseEgyptDate } from './tokens.js';
import { notifyFamily } from '../notify.js';

// ============================================================
//  🕐 دوال مساعدة
// ============================================================
function nowUTC() {
  // ⚠️ للكتابة في timestamptz — UTC ISO صريح
  return new Date().toISOString();
}

function nowEgyptDisplay() {
  // ⚠️ للعرض البشري فقط (إيميلات/تليجرام/رسائل نصية) — ممنوع للكتابة في DB
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).replace('T', ' ');
}

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
  const today = new Date();
  let years = today.getFullYear() - year; let months = today.getMonth() - month; let days = today.getDate() - day;
  if (days < 0) { months--; const prevMonth = new Date(today.getFullYear(), today.getMonth(), 0).getDate(); days += prevMonth; }
  if (months < 0) { years--; months += 12; }
  if (years <= 0 && months === 0 && days === 0) return 'أقل من يوم';
  const parts2 = [];
  if (years > 0) parts2.push(formatArabicCount(years, { singular: 'سنة', dual: 'سنتان', plural: 'سنوات' }));
  if (months > 0) parts2.push(formatArabicCount(months, { singular: 'شهر', dual: 'شهران', plural: 'أشهر' }));
  if (days > 0) parts2.push(formatArabicCount(days, { singular: 'يوم', dual: 'يومان', plural: 'أيام' }));
  return parts2.length === 0 ? 'أقل من يوم' : parts2.join(' و ');
}

// ============================================================
//  🚀 getChildData — الدالة الرئيسية
// ============================================================

export async function getChildData(params) {
  try {
    const id = String(params.id || '').trim();
    const tempToken = String(params.tempToken || '').trim();
    const demoToken = String(params.demo || '').trim();

    if (!id) {
      return {
        success: false,
        code: 'child_not_found',
        message: 'معرف الطفل مفقود.'
      };
    }

    const t0 = Date.now();

    // ============================================================
    //  ✅ مسار التجربة (Demo)
    //  - نتجاهل التوكن العادي
    //  - نتحقق من DemoSession بدلاً منه
    // ============================================================
    if (demoToken) {
      return await getDemoChildData(id, demoToken, t0);
    }

    // 1. فحص التوكن
    const tokenData = await validateOneTimeToken(tempToken);
    if (!tokenData || tokenData.childID !== id) {
      return {
        success: false,
        code: 'invalid_token',
        childID: id,
        message: 'انتهت صلاحية الجلسة، يرجى إعادة مسح رمز QR.'
      };
    }

    // 2. جيب الطفل
    const { data: child, error } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select('*')
      .eq(COLS_CHILDREN.child_id, id)
      .maybeSingle();

    if (error || !child) {
      return {
        success: false,
        code: 'child_not_found',
        childID: id,
        message: 'لا يوجد طفل بهذا المعرف.'
      };
    }

    const childName = String(child[COLS_CHILDREN.child_name] || '').trim();
    const status = String(child[COLS_CHILDREN.status] || '').trim().toLowerCase();
    const expiryRaw = child[COLS_CHILDREN.expiry_date];

    // 3. فحص الحالات بالترتيب
    if (status === 'deleted') {
      return { success: false, code: 'account_deleted', childID: id, childName,
        message: 'هذا الحساب تم حذفه. للاستفسار تواصل مع الدعم: support@kidcode-eg.com' };
    }
    if (status === 'disabled') {
      return { success: false, code: 'account_disabled', childID: id, childName,
        message: 'هذا الحساب معطّل مؤقتاً من قبل ولي الأمر.' };
    }
    if (status === 'pending') {
      return { success: false, code: 'account_pending', childID: id, childName,
        message: 'الحساب قيد التفعيل، سيتم تفعيله خلال 24 ساعة.' };
    }
    if (status === 'suspended') {
      return { success: false, code: 'account_suspended', childID: id, childName,
        message: 'هذا الحساب موقوف مؤقتاً.' };
    }

    // 4. فحص expiry — timestamptz → parseEgyptDate (ISO آمن)
    if (expiryRaw) {
      const expiryDate = parseEgyptDate(expiryRaw);
      if (expiryDate && expiryDate.getTime() < Date.now()) {
        if (status === 'active') {
          await supabaseAdmin
            .from(TABLES.CHILDREN)
            .update({ [COLS_CHILDREN.status]: 'expired' })
            .eq(COLS_CHILDREN.child_id, id);
        }
        return { success: false, code: 'account_expired', childID: id, childName,
          message: 'انتهى اشتراك هذا الحساب.' };
      }
    }

    if (status !== 'active') {
      return { success: false, code: 'account_inactive', childID: id, childName,
        message: 'هذا الحساب غير نشط.' };
    }

    // ============================================================
    //  5. ✅ العدّاد: مرة واحدة فقط لكل توكن (ذرّي)
    //  - نحاول تعليم التوكن كمحسوب
    //  - إذا نجح التعليم (wasCounted = true) → نزيد العدّاد ونرسل الإشعار
    //  - إذا كان محسوبًا مسبقًا (wasCounted = false) → لا نفعل شيئًا
    // ============================================================
    try {
      const countResult = await markTokenAsCounted(tempToken);

      if (countResult.success && countResult.wasCounted === true) {
        const currentCount = parseInt(child[COLS_CHILDREN.scan_count] || '0', 10) + 1;
        // ✅ UTC ISO للكتابة في timestamptz
        const nowISO = nowUTC();

        const { error: updateError } = await supabaseAdmin
          .from(TABLES.CHILDREN)
          .update({
            [COLS_CHILDREN.scan_count]: currentCount,
            [COLS_CHILDREN.last_scan]: nowISO,
            [COLS_CHILDREN.last_scan_email_sent]: nowISO
          })
          .eq(COLS_CHILDREN.child_id, id);

        if (updateError) {
          console.error(`❌ [getChildData] scan_count update:`, updateError.message);
        } else {
          console.log(`📊 [getChildData] COUNTED: ${id} → scan_count=${currentCount}`);
        }

        // إرسال إشعار المسح
        try {
          const notifyResult = await notifyFamily({
            childID: id,
            eventType: 'scan_alert',
            eventData: {}
          });
          console.log(`📨 [getChildData] scan_alert: channel=${notifyResult.channel || '?'}`);
        } catch (notifyErr) {
          console.error(`❌ [getChildData] notifyFamily scan_alert:`, notifyErr.message);
        }

      } else if (countResult.success && countResult.wasCounted === false) {
        console.log(`ℹ️ [getChildData] محسوب مسبقاً — لا زيادة (${Date.now() - t0}ms)`);
      } else {
        console.warn(`⚠️ [getChildData] فشل تعليم التوكن: ${countResult.error}`);
      }
    } catch (countErr) {
      console.error(`⚠️ [getChildData] count logic:`, countErr.message);
    }

    // 6. بناء بيانات الصورة (Cloudinary فقط)
    const rawImageId = String(child[COLS_CHILDREN.child_image_url] || '').trim();
    const imageUrl = rawImageId.startsWith('http') ? rawImageId : '';

    // 7. Notes (معالجة ذكية للنص العادي والمصفوفات)
    let notes = [];
    const rawNotes = child[COLS_CHILDREN.notes];
    if (rawNotes) {
        try {
            const parsed = JSON.parse(rawNotes);
            if (Array.isArray(parsed)) {
                notes = parsed;
            } else if (typeof parsed === 'string') {
                notes = parsed.split(/[،,]+/).map(n => n.trim()).filter(Boolean);
            } else {
                notes = [String(rawNotes)];
            }
        } catch (e) {
            // لو الكود مش JSON، يبقى نص عادي، نفصله عند الفاصلة
            notes = String(rawNotes).split(/[،,]+/).map(n => n.trim()).filter(Boolean);
        }
    }

    // 8. نجاح
    return {
      success: true,
      child: {
        id: child[COLS_CHILDREN.child_id],
        name: child[COLS_CHILDREN.child_name],
        age: calculateAge(child[COLS_CHILDREN.birth_date]),
        fatherPhone: child[COLS_CHILDREN.father_phone] || '',
        motherPhone: child[COLS_CHILDREN.mother_phone] || '',
        googleMaps: child[COLS_CHILDREN.google_maps] || '',
        detailedAddress: child[COLS_CHILDREN.detailed_address] || '',
        imageUrl: imageUrl,
        notes: notes,
        plan: child[COLS_CHILDREN.plan] || '',
        activeReport: null,   // TODO: MissingReports
        hasActiveReport: false
      },
      projectName: 'KidCode-EG',
      expiresAt: tokenData.expiry || null
    };

  } catch (err) {
    console.error(`❌ [getChildData] ${err.message}`);
    return {
      success: false,
      code: 'server_error',
      message: 'حدث خطأ غير متوقع. تواصل مع الدعم.'
    };
  }
}

// ============================================================
//  ✅ getDemoChildData — مسار الطفل التجريبي
//  - يتحقق من DemoSession (5 دقائق)
//  - يعرض بيانات الطفل الحقيقي (KC-01007) مع استبدال:
//    • الاسم   → اسم المستخدم التجريبي
//    • تليفون الأب → تليفون المستخدم التجريبي
//    • تليفون الأم → فاضي
// ============================================================
async function getDemoChildData(id, demoToke, t0) {
  try {
    // 1. التحقق من الجلسة
    const { getDemoSession, DEMO_SESSION_MINUTES } = await import('./demo.js');
    const session = await getDemoSession(demoToke);

    if (!session) {
      console.log(`🚫 [getDemoChildData] جلسة منتهية أو غير موجودة (${id})`);
      return {
        success: false,
        code: 'demo_session_expired',
        childID: id,
        message: 'انتهت صلاحية جلسة التجربة.'
      };
    }

    // 2. جيب الطفل
    const { data: child, error } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select('*')
      .eq(COLS_CHILDREN.child_id, id)
      .maybeSingle();

    if (error || !child) {
      return {
        success: false,
        code: 'child_not_found',
        childID: id,
        message: 'الطفل التجريبي غير موجود.'
      };
    }

    // 3. فحص حالة الطفل
    const status = String(child[COLS_CHILDREN.status] || '').trim().toLowerCase();
    const expiryRaw = child[COLS_CHILDREN.expiry_date];

    if (status === 'deleted') {
      return { success: false, code: 'account_deleted', childID: id,
        message: 'هذا الحساب تم حذفه.' };
    }
    if (status === 'pending') {
      return { success: false, code: 'account_pending', childID: id,
        message: 'الحساب قيد التفعيل.' };
    }
    if (status === 'suspended') {
      return { success: false, code: 'account_suspended', childID: id,
        message: 'الحساب موقوف مؤقتاً.' };
    }

    // فحص expiry — timestamptz → parseEgyptDate (ISO آمن)
    if (expiryRaw) {
      const expiryDate = parseEgyptDate(expiryRaw);
      if (expiryDate && expiryDate.getTime() < Date.now()) {
        return { success: false, code: 'account_expired', childID: id,
          message: 'انتهى اشتراك الحساب التجريبي.' };
      }
    }

    if (status !== 'active') {
      return { success: false, code: 'account_inactive', childID: id,
        message: 'الحساب غير نشط.' };
    }

    // 4. بناء بيانات الصورة
    const rawImageId = String(child[COLS_CHILDREN.child_image_url] || '').trim();
    const imageUrl = rawImageId.startsWith('http') ? rawImageId : '';

    // 5. Notes (معالجة ذكية للنص العادي والمصفوفات)
    let notes = [];
    const rawNotes = child[COLS_CHILDREN.notes];
    if (rawNotes) {
        try {
            const parsed = JSON.parse(rawNotes);
            if (Array.isArray(parsed)) {
                notes = parsed;
            } else if (typeof parsed === 'string') {
                notes = parsed.split(/[،,]+/).map(n => n.trim()).filter(Boolean);
            } else {
                notes = [String(rawNotes)];
            }
        } catch (e) {
            // لو الكود مش JSON، يبقى نص عادي، نفصله عند الفاصلة
            notes = String(rawNotes).split(/[،,]+/).map(n => n.trim()).filter(Boolean);
        }
    }

    // 6. session.expiresAt من demo.js هو ISO (بعد تعديل demo.js القادم)
    //    لكن parseEgyptDate المبسّطة في tokens.js بتتعامل مع أي صيغة ISO بأمان
    const sessionExpiry = parseEgyptDate(session.expiresAt);
    if (!sessionExpiry || isNaN(sessionExpiry.getTime())) {
      console.warn('⚠️ [getDemoChildData] session.expiresAt غير صالح:', session.expiresAt);
      sessionExpiry = new Date(Date.now() + 5 * 60 * 1000);
    }

    // 7. تليفون المستخدم (bigint → "201012345678")
    const demoPhoneIntl = session.phone || '';

    // ============================================================
    //  ✅ إيميل تنبيه المسح (مرة واحدة لكل جلسة)
    //  ⚠️ nowEgyptDisplay() — للعرض في الإيميل فقط
    // ============================================================
    try {
      const { cacheGet, cachePut } = await import('../cache.js');
      const notifiedKey = 'demo_notified_' + demoToke;

      if (!cacheGet(notifiedKey)) {
        const { sendScanAlertEmail } = await import('../email/brevo.js');
        await sendScanAlertEmail(
          session.email,
          String(child[COLS_CHILDREN.child_id]).trim(),
          session.name || 'طفل تجريبي',
          nowEgyptDisplay()   // ← Cairo display text for email body
        );
        cachePut(notifiedKey, 'true', 600);  // 10 دقايق
        console.log(`📧 [getDemoChildData] scan alert → ${session.email}`);
      } else {
        console.log(`⏭️ [getDemoChildData] scan alert مُرسل مسبقاً`);
      }
    } catch (emailErr) {
      console.warn('⚠️ [getDemoChildData] scan email failed:', emailErr.message);
    }

    console.log(`✅ [getDemoChildData] ${id} | session: ${demoToke} | age: ${calculateAge(child[COLS_CHILDREN.birth_date])} (${Date.now() - t0}ms)`);

    // 8. نجاح — نستبدل الاسم + تليفون الأب ببيانات المستخدم التجريبي
    return {
      success: true,
      child: {
        id: child[COLS_CHILDREN.child_id],
        name: session.name || 'مستخدم تجريبي',
        age: calculateAge(child[COLS_CHILDREN.birth_date]),
        fatherPhone: demoPhoneIntl,
        motherPhone: '',                              // نخفي رقم الأم في التجربة
        googleMaps: child[COLS_CHILDREN.google_maps] || '',
        detailedAddress: child[COLS_CHILDREN.detailed_address] || '',
        imageUrl: imageUrl,
        notes: notes,
        plan: child[COLS_CHILDREN.plan] || '',
        activeReport: null,
        hasActiveReport: false
      },
      projectName: 'KidCode-EG',
      // ✅ ISO UTC صريح بـ Z — جاهز لـ parseToDate في المتصفح
      expiresAt: sessionExpiry.toISOString()
    };

  } catch (err) {
    console.error(`❌ [getDemoChildData] ${err.message}`);
    return {
      success: false,
      code: 'server_error',
      message: 'حدث خطأ غير متوقع.'
    };
  }
}