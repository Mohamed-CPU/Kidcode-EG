// ================================================================
//  lib/db/missing-reports.js — بلاغات الاختفاء
//  ⚠️ بعد Migration: MissingReports timestamps = timestamptz
//  ✅ الكتابة: nowUTC() | القيم الفارغة: null (مش '')
//  🐛 Fix: '' في timestamptz كان بيكسر reportMissing
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN } from './tables.js';
import { notifyFamily } from '../notify.js';
import { sendMissingAlertToSubscribers } from './newsletter.js';
import {
  sendVolunteerThanksEmail,
  sendParentReportFoundEmail,
  sendParentReportClosedEmail,
  sendEscalationAdminEmail
} from '../email/brevo.js';
import { uploadToCloudinary } from '../cloudinary.js';

// ============================================================
//  🕐 دوال الوقت
// ============================================================
function nowUTC() {
  // ⚠️ للكتابة في timestamptz — UTC ISO
  return new Date().toISOString();
}

// ============================================================
//  📱 تنسيق أرقام الهواتف
// ============================================================
function formatPhoneLocal(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('20') && digits.length === 12) return '0' + digits.substring(2);
  if (digits.startsWith('20') && digits.length === 11) return '0' + digits.substring(2);
  if (digits.length === 11 && digits.startsWith('01')) return digits;
  if (digits.length === 10) return '0' + digits;
  return digits;
}

function formatPhoneInternational(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('20') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 11) return '20' + digits.substring(1);
  if (digits.length === 10 || digits.length === 11) return '20' + digits;
  return digits;
}

// ============================================================
//  🖼️ حفظ صور البطاقة عبر Cloudinary
// ============================================================
async function saveMissingIdImage(reportId, side, imageBase64) {
  try {
    if (!imageBase64) return '';

    const result = await uploadToCloudinary({
      base64: imageBase64,
      resourceType: 'image',
      folder: 'kidcode/missing_ids',
      fileName: `${reportId}_${side}`
    });

    if (result.success) {
      return result.url;
    }

    console.error(`❌ [saveMissingIdImage/${side}]`, result.error);
    return '';
  } catch (e) {
    console.error(`❌ [saveMissingIdImage/${side}]`, e.message);
    return '';
  }
}

// ============================================================
//  1️⃣ findActiveReport
// ============================================================
export async function findActiveReport(childID) {
  if (!childID) return null;
  try {
    const { data } = await supabaseAdmin
      .from(TABLES.MISSING_REPORTS)
      .select('*')
      .eq('child_id', childID)
      .in('is_resolved', ['لا', 'awaiting_confirmation'])
      .limit(1)
      .maybeSingle();

    if (!data) return null;

    return {
      clothes: String(data.clothes || ''),
      governorate: String(data.governorate || ''),
      district: String(data.district || ''),
      landmark: String(data.landmark || ''),
      status: String(data.is_resolved || '').trim()
    };

  } catch (err) {
    console.error('❌ [findActiveReport]', err.message);
    return null;
  }
}

// ============================================================
//  2️⃣ reportMissing
//  ✅ report_time: nowUTC() | 🐛 resolved_time/found_confirmed_at: null (مش '')
// ============================================================
export async function reportMissing(params) {
  try {
    const childID = String(params.childID || '').trim();
    const clothes = String(params.clothes || '').trim();
    const governorate = String(params.governorate || '').trim();
    const district = String(params.district || '').trim();
    const landmark = String(params.landmark || '').trim();

    if (!childID) return { success: false, error: 'معرّف الطفل مطلوب' };
    if (!clothes) return { success: false, error: 'الملابس مطلوبة' };
    if (!governorate) return { success: false, error: 'المحافظة مطلوبة' };
    if (!district) return { success: false, error: 'الحي مطلوب' };
    if (!landmark) return { success: false, error: 'العلامة المميزة مطلوبة' };

    // 1. جيب الطفل
    const { data: child } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select('*')
      .eq(COLS_CHILDREN.child_id, childID)
      .maybeSingle();

    if (!child) return { success: false, error: 'الطفل غير موجود' };

    const status = String(child[COLS_CHILDREN.status] || '').trim().toLowerCase();
    if (status !== 'active') {
      return { success: false, error: 'الحساب غير نشط. يرجى التواصل مع الدعم.' };
    }

    // 2. فحص بلاغ نشط
    const existing = await findActiveReport(childID);
    if (existing && existing.status === 'لا') {
      return { success: false, error: 'يوجد بلاغ نشط لهذا الطفل بالفعل.' };
    }

    // 3. إنشاء بلاغ جديد — ✅ UTC ISO
    const now = nowUTC();
    const reportId = 'RPT-' + crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase();

    const { error: insErr } = await supabaseAdmin
      .from(TABLES.MISSING_REPORTS)
      .insert({
        report_id: reportId,
        child_id: childID,
        report_time: now,
        clothes, governorate, district, landmark,
        is_resolved: 'لا',
        // 🐛 Fix: كان '' → timestamptz يرفضها. نستخدم null
        resolved_time: null,
        resolved_by: '',
        volunteer_name: '',
        volunteer_phone: '',
        front_id_file: '',
        back_id_file: '',
        // 🐛 Fix: كان '' → timestamptz يرفضها. نستخدم null
        found_confirmed_at: null
      });

    if (insErr) return { success: false, error: insErr.message };

    console.log(`✅ [reportMissing] ${childID} → ${reportId}`);

    // 4. إشعار الأسرة
    const childName = String(child[COLS_CHILDREN.child_name] || 'الطفل').trim();
    const childAge = String(child[COLS_CHILDREN.age] || '').trim();

    try {
      await notifyFamily({
        childID,
        eventType: 'missing_report',
        eventData: {
          reportId, clothes, governorate, district, landmark,
          age: childAge
        }
      });
    } catch (e) {
      console.warn('⚠️ [reportMissing] notifyFamily:', e.message);
    }

    // 5. تنبيه المشتركين
    try {
      await sendMissingAlertToSubscribers(
        childID,
        { reportId, clothes, governorate, district, landmark },
        {
          childName,
          imageFileId: String(child[COLS_CHILDREN.child_image_url] || '')
        }
      );
    } catch (e) {
      console.warn('⚠️ [reportMissing] subscribers alert:', e.message);
    }

    return {
      success: true,
      reportId,
      message: 'تم إرسال البلاغ بنجاح! سيتم إشعار المتطوعين فوراً.'
    };

  } catch (err) {
    console.error('❌ [reportMissing]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  3️⃣ volunteerFound
//  ✅ found_confirmed_at: nowUTC()
// ============================================================
export async function volunteerFound(params) {
  try {
    const reportId = String(params.reportId || '').trim();
    const name = decodeURIComponent(String(params.name || '').trim());
    const phone = String(params.phone || '').trim();
    let idFrontBase64 = String(params.idFront || '').trim().replace(/\s/g, '');
    let idBackBase64 = String(params.idBack || '').trim().replace(/\s/g, '');

    if (!reportId) return { success: false, error: 'رقم البلاغ مطلوب' };
    if (!name) return { success: false, error: 'الاسم مطلوب' };
    if (!phone || phone.replace(/\D/g, '').length < 10) {
      return { success: false, error: 'رقم هاتف غير صحيح' };
    }
    if (!idFrontBase64 || !idBackBase64) {
      return { success: false, error: 'صور البطاقة مطلوبة' };
    }

    // 1. جيب البلاغ
    const { data: report } = await supabaseAdmin
      .from(TABLES.MISSING_REPORTS)
      .select('*')
      .eq('report_id', reportId)
      .maybeSingle();

    if (!report) return { success: false, error: 'البلاغ غير موجود' };

    const status = String(report.is_resolved || '').trim();
    if (status !== 'لا' && status !== 'awaiting_confirmation') {
      return { success: false, error: 'هذا البلاغ تم حله نهائياً' };
    }

    const childID = String(report.child_id || '').trim();
    const cleanPhone = phone.replace(/\D/g, '');

    // 2. رفع صور البطاقة (best-effort)
    let frontFileId = '';
    let backFileId = '';
    try {
      frontFileId = await saveMissingIdImage(reportId, 'front', idFrontBase64);
      backFileId = await saveMissingIdImage(reportId, 'back', idBackBase64);
    } catch (e) {
      console.warn('⚠️ [volunteerFound] image save:', e.message);
    }

    // 3. تحديث البلاغ — ✅ UTC ISO
    const now = nowUTC();
    const { error: updErr } = await supabaseAdmin
      .from(TABLES.MISSING_REPORTS)
      .update({
        is_resolved: 'awaiting_confirmation',
        volunteer_name: name,
        volunteer_phone: cleanPhone,
        front_id_file: frontFileId,
        back_id_file: backFileId,
        found_confirmed_at: now
      })
      .eq('report_id', reportId);

    if (updErr) return { success: false, error: updErr.message };

    console.log(`✅ [volunteerFound] ${reportId} | ${name}`);

    // 4. إيميل لولي الأمر
    try {
      const { data: child } = await supabaseAdmin
        .from(TABLES.CHILDREN)
        .select('*')
        .eq(COLS_CHILDREN.child_id, childID)
        .maybeSingle();

      if (child) {
        const parentEmail = String(child[COLS_CHILDREN.email_code] || '').trim();
        const childName = String(child[COLS_CHILDREN.child_name] || 'الطفل').trim();

        if (parentEmail) {
          await sendParentReportFoundEmail({
            parentEmail,
            childName,
            childID,
            reportId,
            volunteerName: name,
            volunteerPhone: cleanPhone
          });
        }
      }
    } catch (e) {
      console.warn('⚠️ [volunteerFound] parent email:', e.message);
    }

    return {
      success: true,
      message: 'تم تأكيد العثور على الطفل بنجاح! سيتم إشعار أسرة الطفل فوراً.'
    };

  } catch (err) {
    console.error('❌ [volunteerFound]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  4️⃣ getReportDetails
// ============================================================
export async function getReportDetails(params) {
  const reportId = String(params.reportId || '').trim();
  if (!reportId) return { success: false, error: 'رقم البلاغ مطلوب' };

  try {
    const { data: report } = await supabaseAdmin
      .from(TABLES.MISSING_REPORTS)
      .select('*')
      .eq('report_id', reportId)
      .maybeSingle();

    if (!report) return { success: false, error: 'البلاغ غير موجود' };

    const childID = String(report.child_id || '').trim();
    let childFullName = '';

    if (childID) {
      const { data: child } = await supabaseAdmin
        .from(TABLES.CHILDREN)
        .select(COLS_CHILDREN.child_name)
        .eq(COLS_CHILDREN.child_id, childID)
        .maybeSingle();
      if (child) childFullName = String(child[COLS_CHILDREN.child_name] || '');
    }

    return {
      success: true,
      data: {
        childID,
        childName: childFullName,
        isResolved: String(report.is_resolved || ''),
        volunteerName: String(report.volunteer_name || ''),
        volunteerPhone: formatPhoneLocal(report.volunteer_phone || '')
      }
    };

  } catch (err) {
    console.error('❌ [getReportDetails]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  5️⃣ confirmReceived
//  ✅ resolved_time: nowUTC()
// ============================================================
export async function confirmReceived(params) {
  const reportId = String(params.reportId || '').trim();
  const feedback = String(params.feedback || '').trim();

  if (!reportId) return { success: false, error: 'رقم البلاغ مطلوب' };

  try {
    const { data: report } = await supabaseAdmin
      .from(TABLES.MISSING_REPORTS)
      .select('*')
      .eq('report_id', reportId)
      .maybeSingle();

    if (!report) return { success: false, error: 'البلاغ غير موجود' };

    const status = String(report.is_resolved || '').trim();
    if (status === 'نعم') return { success: false, error: 'هذا البلاغ تم حله بالفعل' };
    if (status !== 'awaiting_confirmation') {
      return { success: false, error: 'هذا البلاغ غير صالح للتأكيد' };
    }

    const childID = String(report.child_id || '').trim();
    const volunteerName = String(report.volunteer_name || '').trim();
    const volunteerPhone = String(report.volunteer_phone || '').trim();

    // 1. تحديث البلاغ — ✅ UTC ISO
    const now = nowUTC();
    const { error: updErr } = await supabaseAdmin
      .from(TABLES.MISSING_REPORTS)
      .update({
        is_resolved: 'نعم',
        resolved_time: now,
        resolved_by: 'ولي الأمر'
      })
      .eq('report_id', reportId);

    if (updErr) return { success: false, error: updErr.message };

    console.log(`✅ [confirmReceived] ${reportId}`);

    // 2. جيب بيانات الطفل
    let childName = 'الطفل';
    let parentEmail = '';
    if (childID) {
      const { data: child } = await supabaseAdmin
        .from(TABLES.CHILDREN)
        .select('*')
        .eq(COLS_CHILDREN.child_id, childID)
        .maybeSingle();
      if (child) {
        childName = String(child[COLS_CHILDREN.child_name] || 'الطفل').trim();
        parentEmail = String(child[COLS_CHILDREN.email_code] || '').trim();
      }
    }

    // 3. شكر المتطوع (نبحث بالـ phone)
    if (volunteerName && volunteerPhone) {
      try {
        const phoneDigits = volunteerPhone.replace(/\D/g, '');
        const { data: sub } = await supabaseAdmin
          .from(TABLES.NEWSLETTER)
          .select('email')
          .ilike('phone', `%${phoneDigits}%`)
          .limit(1)
          .maybeSingle();

        if (sub && sub.email) {
          await sendVolunteerThanksEmail(sub.email, volunteerName, childName);
        }
      } catch (e) {
        console.warn('⚠️ [confirmReceived] volunteer thanks:', e.message);
      }
    }

    // 4. تأكيد لولي الأمر
    if (parentEmail) {
      try {
        await sendParentReportClosedEmail(parentEmail, childName, feedback);
      } catch (e) {
        console.warn('⚠️ [confirmReceived] parent email:', e.message);
      }
    }

    return {
      success: true,
      message: 'تم تأكيد استلام الطفل وإغلاق البلاغ بنجاح. شكراً لك.'
    };

  } catch (err) {
    console.error('❌ [confirmReceived]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  6️⃣ escalateMissingReport
//  ✅ قراءة found_confirmed_at بـ new Date() — شغال صح مع timestamptz ISO
// ============================================================
export async function escalateMissingReport() {
  try {
    console.log('⏰ [escalateMissingReport] بدء الفحص...');

    const now = Date.now();
    const cutoff24h = new Date(now - 24 * 60 * 60 * 1000);

    const { data: reports, error } = await supabaseAdmin
      .from(TABLES.MISSING_REPORTS)
      .select('*')
      .eq('is_resolved', 'awaiting_confirmation');

    if (error) return { success: false, error: error.message };
    if (!reports || reports.length === 0) {
      console.log('ℹ️ [escalateMissingReport] لا توجد بلاغات معلقة');
      return { success: true, escalated: 0 };
    }

    let escalatedCount = 0;

    for (const report of reports) {
      const foundAt = report.found_confirmed_at;
      if (!foundAt) continue;

      // ✅ timestamptz بيرجع ISO → new Date() بتفهمه صح
      const foundDate = new Date(foundAt);
      if (isNaN(foundDate.getTime())) continue;
      if (foundDate >= cutoff24h) continue;

      // ✅ البلاغ مضى عليه > 24 ساعة → تصعيد
      const reportId = String(report.report_id).trim();
      const childID = String(report.child_id || '').trim();
      const volunteerName = String(report.volunteer_name || 'غير متوفر').trim();
      const volunteerPhone = formatPhoneLocal(report.volunteer_phone || '');

      let childName = 'الطفل';
      let parentPhone = '';
      if (childID) {
        const { data: child } = await supabaseAdmin
          .from(TABLES.CHILDREN)
          .select(`${COLS_CHILDREN.child_name},${COLS_CHILDREN.father_phone},${COLS_CHILDREN.mother_phone}`)
          .eq(COLS_CHILDREN.child_id, childID)
          .maybeSingle();
        if (child) {
          childName = String(child[COLS_CHILDREN.child_name] || 'الطفل');
          parentPhone = formatPhoneLocal(
            child[COLS_CHILDREN.father_phone] || child[COLS_CHILDREN.mother_phone] || ''
          );
        }
      }

      try {
        await sendEscalationAdminEmail({
          reportId, childName, childID,
          volunteerName, volunteerPhone, parentPhone
        });
        escalatedCount++;
        console.log(`🚨 [escalateMissingReport] ${reportId}`);
      } catch (e) {
        console.warn(`⚠️ [escalateMissingReport] ${reportId}:`, e.message);
      }
    }

    console.log(`✅ [escalateMissingReport] escalated=${escalatedCount}`);
    return { success: true, escalated: escalatedCount };

  } catch (err) {
    console.error('❌ [escalateMissingReport]', err.message);
    return { success: false, error: err.message };
  }
}