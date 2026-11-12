// ================================================================
//  lib/db/registration.js — تسجيل طفل جديد (Vercel + Supabase)
//  - Supabase-First
//  - الصور + QR → GAS Proxy (Drive)
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN } from './tables.js';
import { getAppConfigValue, setAppConfigValue } from './app-config.js';
import { validateMarketerCode } from './marketer-read.js';
import { notifyMarketer } from '../marketer-notify.js';
import { sendAdminEmail, sendClientEmail, sendPaymentRequiredEmail } from '../email/brevo.js';
import { validatePasswordStrength, hashFamilyPassword } from './family-write.js';
import { uploadToCloudinary } from '../cloudinary.js';

// ============================================================
//  🕐 توقيت UTC (للحفظ في DB — timestamptz)
// ============================================================
function nowUTC() {
  return new Date().toISOString();
}

// ============================================================
//  صياغة العدد مع الوحدة الزمنية وفق قواعد العربية
// ============================================================
function formatArabicCount(count, forms) {
  if (count === 1) return forms.singular;
  if (count === 2) return forms.dual;
  if (count >= 3 && count <= 10) return count + ' ' + forms.plural;
  return count + ' ' + forms.singular;
}

// ============================================================
//  📅 حساب العمر من تاريخ الميلاد
// ============================================================
function calculateAge(birthDateStr) {
  if (!birthDateStr) return 'غير محدد';
  const parts = String(birthDateStr).trim().split('-');
  if (parts.length !== 3) return 'تاريخ غير صحيح';

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  const today = new Date();
  let years = today.getFullYear() - year;
  let months = today.getMonth() - month;
  if (today.getDate() < day) months--;
  if (months < 0) { years--; months += 12; }

  if (years <= 0 && months === 0) return 'أقل من شهر';

  if (years === 0) {
    return formatArabicCount(months, {
      singular: 'شهر',
      dual: 'شهران',
      plural: 'أشهر'
    });
  }

  if (months === 0) {
    return formatArabicCount(years, {
      singular: 'سنة',
      dual: 'سنتان',
      plural: 'سنوات'
    });
  }

  const yearsText = formatArabicCount(years, {
    singular: 'سنة',
    dual: 'سنتان',
    plural: 'سنوات'
  });
  const monthsText = formatArabicCount(months, {
    singular: 'شهر',
    dual: 'شهران',
    plural: 'أشهر'
  });

  return yearsText + ' و ' + monthsText;
}

// ============================================================
//  📅 حساب تاريخ انتهاء الاشتراك
// ============================================================

function calculateExpiryDate(plan) {
  const now = new Date();
  if (plan === 'عرض بداية الإطلاق') {
    return new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }
  if (plan === '6 أشهر') {
    return new Date(now.getFullYear(), now.getMonth() + 6, now.getDate());
  }
  if (plan === 'عام واحد') {
    return new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  }
  return null;
}

function formatExpiryForSupabase(date) {
  if (!date) return '';
  // ✅ UTC ISO — timestamptz تفهمها كـ منتصف ليل UTC (نفس السلوك السابق)
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T00:00:00.000Z`;
}

// ============================================================
//  🔢 توليد كود طفل فريد (KC-XXXXX)
// ============================================================
async function generateUniqueChildID() {
  for (let i = 0; i < 100; i++) {
    const num = Math.floor(Math.random() * 90000) + 10000;
    const id = 'KC-' + num;
    const { data } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select(COLS_CHILDREN.child_id)
      .eq(COLS_CHILDREN.child_id, id)
      .maybeSingle();
    if (!data) return id;
  }
  throw new Error('تعذر إنشاء كود فريد للطفل');
}

// ============================================================
//  🔤 تطبيع النص العربي (للمقارنة)
// ============================================================
function normalizeArabicString(str) {
  if (!str) return '';
  let normalized = String(str);
  const alifMap = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ٲ': 'ا', 'ٳ': 'ا' };
  const yaMap = { 'ى': 'ي', 'ئ': 'ي' };
  const taMap = { 'ة': 'ه' };
  const wawMap = { 'ؤ': 'و' };
  for (const [key, value] of Object.entries(alifMap)) normalized = normalized.replace(new RegExp(key, 'g'), value);
  for (const [key, value] of Object.entries(yaMap)) normalized = normalized.replace(new RegExp(key, 'g'), value);
  for (const [key, value] of Object.entries(taMap)) normalized = normalized.replace(new RegExp(key, 'g'), value);
  for (const [key, value] of Object.entries(wawMap)) normalized = normalized.replace(new RegExp(key, 'g'), value);
  normalized = normalized.replace(/[\u064B-\u065F]/g, '');
  return normalized.trim().replace(/\s+/g, ' ');
}

// ============================================================
//  🔍 فحص تعارض التسجيل (نفس الاسم + نفس تاريخ الميلاد)
// ============================================================
async function checkChildRegistrationConflict(childName, birthDate) {
  if (!childName || !birthDate) return { hasConflict: false };

  const normalizedInputName = normalizeArabicString(childName);

  // اقرأ كل الأطفال (نادراً ما يكون عدد كبير) — الفحص النصي في Node
  const { data: children } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select(`${COLS_CHILDREN.child_id},${COLS_CHILDREN.child_name},${COLS_CHILDREN.birth_date},${COLS_CHILDREN.status}`);

  if (!children || children.length === 0) return { hasConflict: false };

  for (const c of children) {
    const storedName = c[COLS_CHILDREN.child_name];
    if (!storedName) continue;

    const normalizedStoredName = normalizeArabicString(storedName);
    if (normalizedStoredName !== normalizedInputName) continue;

    let storedBirth = String(c[COLS_CHILDREN.birth_date] || '').trim();
    if (storedBirth.includes('T')) storedBirth = storedBirth.split('T')[0];
    if (storedBirth.includes(' ')) storedBirth = storedBirth.split(' ')[0];

    const inputBirth = String(birthDate).trim();
    if (storedBirth !== inputBirth) continue;

    const status = String(c[COLS_CHILDREN.status] || '').trim().toLowerCase();
    return {
      hasConflict: true,
      isDeleted: status === 'deleted',
      childID: String(c[COLS_CHILDREN.child_id] || '').trim(),
      childName: String(storedName).trim(),
    };
  }

  return { hasConflict: false };
}

// ============================================================
//  🖼️ حفظ صورة عبر Cloudinary
// ============================================================
async function saveChildImageToCloudinary(childID, imageBase64) {
  try {
    if (!imageBase64) return '';
    
    const result = await uploadToCloudinary({
      base64: imageBase64,
      resourceType: 'image',
      folder: 'kidcode/children',
      fileName: childID
    });

    if (result.success) {
      return result.url; // بترجع Cloudinary URL بدل الـ Drive ID
    }
    
    console.error('[saveChildImageToCloudinary] Failed:', result.error);
    return '';
  } catch (e) {
    console.error('❌ [saveChildImageToCloudinary] EXCEPTION:', e.message);
    return '';
  }
}

function buildQRCodeURL(childID) {
  const targetUrl = 'https://www.kidcode-eg.com/redirect.html?id=' + encodeURIComponent(childID);
  return 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(targetUrl);
}

// ✅ دالة جديدة لرفع الـ QR على Cloudinary
async function saveQRCodeToCloudinary(childID) {
  try {
    const qrApiUrl = buildQRCodeURL(childID);
    const res = await fetch(qrApiUrl);
    if (!res.ok) return buildQRCodeURL(childID); // لو فشل يرجع الرابط القديم

    const arrayBuffer = await res.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    const { uploadToCloudinary } = await import('../cloudinary.js');
    const result = await uploadToCloudinary({
      base64,
      folder: 'kidcode/qr_codes',
      fileName: childID
    });

    if (result.success) {
      return result.url; // رابط Cloudinary
    }
    return buildQRCodeURL(childID); // Fallback
  } catch (e) {
    console.error('❌ [saveQRCodeToCloudinary]', e.message);
    return buildQRCodeURL(childID);
  }
}

// ============================================================
//  🎫 بناء رابط الطفل (child_link)
// ============================================================
function buildChildLink(childID) {
  return 'https://www.kidcode-eg.com/redirect.html?action=childView&id=' + encodeURIComponent(childID);
}

function buildChildToken(childID) {
  // SHA256 + base64 + 32 char (نفس منطق GAS)
  const raw = childID + Date.now() + Math.random().toString(36).substring(2, 15) + crypto.randomUUID();
  return crypto.createHash('sha256').update(raw).digest('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
}

// ============================================================
//  🚀 الدالة الرئيسية
// ============================================================
export async function handleRegistration(params) {
  const t0 = Date.now();

  try {
    // 1. قراءة الباراميترز
    const childName = String(params.childName || '').trim();
    const birthDate = String(params.birthDate || '').trim();
    const googleMapsAddress = String(params.googleMapsAddress || '').trim();
    const detailedAddress = String(params.detailedAddress || '').trim();
    const fatherPhone = String(params.fatherPhone || '').trim();
    const motherName = String(params.motherName || '').trim();
    const motherPhone = String(params.motherPhone || '').trim();
    const notesRaw = String(params.notes || '[]');
    const emailCode = String(params.emailCode || '').trim();
    const familyPassword = String(params.familyPassword || '').trim();
    const plan = String(params.plan || '').trim();

    const notificationMethodRaw = String(params.notificationMethod || 'email').trim().toLowerCase();
    const notificationMethod = ['telegram', 'email'].includes(notificationMethodRaw) ? notificationMethodRaw : 'email';

    const imageBase64 = String(params.imageBase64 || '');
    const faceImageBase64 = String(params.faceImageBase64 || '');
    const marketerId = String(params.marketerId || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    // 2. Validation أساسي
    if (!childName || !birthDate || !detailedAddress || !emailCode || !plan) {
      return { success: false, error: 'بيانات ناقصة' };
    }

    // 2.1 التحقق من كلمة السر (للوحة تحكم الأسرة)
    if (!familyPassword) {
      return { success: false, error: '🔐 كلمة السر مطلوبة للوحة تحكم الأسرة' };
    }
    const pwdStrength = validatePasswordStrength(familyPassword);
    if (!pwdStrength.valid) {
      return {
        success: false,
        error: '🔐 كلمة السر غير صالحة: ' + pwdStrength.errors.join('، ')
      };
    }

    // 3. حساب السعر الأساسي
    let planPrice = 0;
    if (plan === 'عرض بداية الإطلاق') planPrice = 0;
    else if (plan === '6 أشهر') planPrice = 250;
    else if (plan === 'عام واحد') planPrice = 500;
    else return { success: false, error: 'الخطة غير صحيحة' };

    // 4. تطبيق خصم المسوق
    let finalPrice = planPrice;
    let discountPercent = 0;
    let marketerValid = false;

    if (planPrice > 0 && marketerId) {
      try {
        const validation = await validateMarketerCode({ code: marketerId });
        if (validation.success && validation.valid) {
          marketerValid = true;
          discountPercent = validation.discount || 10;
          finalPrice = Math.round(planPrice * (1 - discountPercent / 100));
          console.log(`✅ [register] discount ${discountPercent}% → final ${finalPrice}`);
        }
      } catch (e) {
        console.warn('⚠️ [register] marketer validation failed:', e.message);
      }
    }

    // 5. فحص التعارض
    const conflict = await checkChildRegistrationConflict(childName, birthDate);
    if (conflict.hasConflict) {
      if (conflict.isDeleted) {
        return { success: false, error: '⚠️ هذا الطفل كان مسجلاً وتم حذفه. لا يمكن إعادة التسجيل. للاستفسار: support@kidcode-eg.com' };
      }
      return { success: false, error: '⚠️ هذا الطفل مسجل بالفعل. لا يمكن تسجيل نفس الطفل أكثر من مرة.' };
    }

    // 6. إدارة العروض المتبقية
    let currentRemaining = 0;
    if (plan === 'عرض بداية الإطلاق') {
      const stored = await getAppConfigValue('remaining_offers');
      currentRemaining = parseInt(stored || '30', 10);
      if (currentRemaining <= 0) {
        return { success: false, error: 'لا توجد عروض مجانية متبقية' };
      }
      await setAppConfigValue('remaining_offers', currentRemaining - 1);
      currentRemaining = currentRemaining - 1;
    } else {
      const stored = await getAppConfigValue('remaining_offers');
      currentRemaining = parseInt(stored || '30', 10);
    }

    // 7. توليد كود الطفل
    const childID = await generateUniqueChildID();
    const childToken = buildChildToken(childID);
    const childLink = buildChildLink(childID);

    // 8. حفظ صورة الطفل (Cloudinary)
    let imageFileId = '';
    if (imageBase64) {
      imageFileId = await saveChildImageToCloudinary(childID, imageBase64);
    }

    // 9. توليد QR ورفعه على Cloudinary
    const qrFileId = await saveQRCodeToCloudinary(childID);

    // 10. حساب التواريخ
    const age = calculateAge(birthDate);
    const now = new Date();
    const expiryDate = calculateExpiryDate(plan);
    const expiryStr = formatExpiryForSupabase(expiryDate);
    const registrationDate = nowUTC();
    const paymentStatus = (plan === 'عرض بداية الإطلاق') ? 'free' : 'pending';

    // ⚠️ ملاحظة: الخطة المدفوعة تظل 'pending' حتى يتم الدفع عبر Paymob
    // (الـ webhook هو المسؤول الوحيد عن التفعيل)
    let initialStatus = 'pending';
    if (paymentStatus === 'free') {
      initialStatus = 'active';
      console.log(`🎉 [register] AUTO-ACTIVATE (free offer) ${childID}`);
    }

    // 12. INSERT في Supabase
    const childRow = {
      [COLS_CHILDREN.timestamp]: registrationDate,
      [COLS_CHILDREN.child_id]: childID,
      [COLS_CHILDREN.child_token]: childToken,
      [COLS_CHILDREN.child_link]: childLink,
      [COLS_CHILDREN.child_name]: childName,
      [COLS_CHILDREN.birth_date]: birthDate,
      [COLS_CHILDREN.age]: age,
      [COLS_CHILDREN.child_image_url]: imageFileId,
      [COLS_CHILDREN.google_maps]: googleMapsAddress,
      [COLS_CHILDREN.detailed_address]: detailedAddress,
      [COLS_CHILDREN.father_phone]: fatherPhone,
      [COLS_CHILDREN.mother_name]: motherName,
      [COLS_CHILDREN.mother_phone]: motherPhone,
      [COLS_CHILDREN.notes]: notesRaw,
      [COLS_CHILDREN.email_code]: emailCode,
      [COLS_CHILDREN.plan]: plan,
      [COLS_CHILDREN.plan_price]: finalPrice,
      [COLS_CHILDREN.status]: initialStatus,
      [COLS_CHILDREN.expiry_date]: expiryStr,
      [COLS_CHILDREN.registration_date]: registrationDate,
      [COLS_CHILDREN.scan_count]: 0,
      [COLS_CHILDREN.qr_code_pics]: qrFileId,
      [COLS_CHILDREN.marketer_id]: marketerId,
      [COLS_CHILDREN.email_sent]: 'لا',
      [COLS_CHILDREN.email_retry_count]: 0,
      [COLS_CHILDREN.payment_status]: paymentStatus,
      [COLS_CHILDREN.discount_percent]: discountPercent,
      [COLS_CHILDREN.original_price]: planPrice,
      [COLS_CHILDREN.notification_method]: notificationMethod,
      [COLS_CHILDREN.family_password_hash]: hashFamilyPassword(familyPassword),
      [COLS_CHILDREN.family_password_set_at]: registrationDate,
      [COLS_CHILDREN.court_requested]: 'لا',
    };

    const { error: insertError } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .insert(childRow);

    if (insertError) {
      console.error(`❌ [register] INSERT (${Date.now() - t0}ms)`, insertError.message);
      return { success: false, error: 'فشل حفظ بيانات الطفل: ' + insertError.message };
    }

    console.log(`✅ [register] INSERT ${childID} (${Date.now() - t0}ms)`);

    // 🆕 Auto-login: إنشاء جلسة عائلية فورًا بعد التسجيل
    let familySession = null;
    try {
      const { createFamilySession } = await import('./family-write.js');
      const sessionResult = await createFamilySession(childID);
      if (sessionResult && sessionResult.success) {
        familySession = {
          sessionToken: sessionResult.session_token,
          expiresAt: sessionResult.expires_at,
          durationMin: sessionResult.duration_min
        };
        console.log(`✅ [register] Auto-login session created for ${childID}`);
      } else {
        console.warn('⚠️ [register] Session creation returned no success');
      }
    } catch (e) {
      console.warn('⚠️ [register] Auto-login failed:', e.message);
    }

    // 13. إشعار المسوق
    if (marketerValid && marketerId) {
      try {
        const expectedDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
        // ✅ تاريخ القاهرة (وليس UTC) — لأن العملية تُعرض للمسوق
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Africa/Cairo',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).formatToParts(expectedDate);
        const expectedDateStr =
          parts.find(p => p.type === 'year').value + '-' +
          parts.find(p => p.type === 'month').value + '-' +
          parts.find(p => p.type === 'day').value;
        const planLabels = {
          'عرض بداية الإطلاق': 'عرض الإطلاق',
          '6 أشهر': 'نصف سنوية',
          'عام واحد': 'سنوية'
        };

        const notifyResult = await notifyMarketer({
          marketerCode: marketerId,
          eventType: 'new_client',
          eventData: {
            childName,
            childID,
            plan: planLabels[plan] || plan,
            finalPrice,
            commission: planPrice - finalPrice,
            expectedDate: expectedDateStr
          }
        });

        console.log(`📨 [register] notifyMarketer: channel=${notifyResult.channel || '?'}`);
      } catch (e) {
        console.warn('⚠️ [register] notifyMarketer failed:', e.message);
      }
    }

    // 14. إرسال إيميل الأدمن
    if (emailCode) {
      try {
        await sendAdminEmail({
          childID,
          childName,
          birthDate,
          age,
          fatherPhone,
          motherPhone,
          plan,
          planPrice,
          googleMapsAddress
        }, qrFileId);
      } catch (e) {
        console.warn('⚠️ [register] admin email failed:', e.message);
      }

      // 15. إرسال بريد العميل
      const isPaidPlan = (plan === '6 أشهر' || plan === 'عام واحد');
      try {
        let emailResult;

        if (isPaidPlan) {
          // 🆕 بريد "يرجى إتمام الدفع" (بدون QR)
          const paymentLink = 'https://www.kidcode-eg.com/payment.html?childID=' +
            encodeURIComponent(childID) + '&plan=' + encodeURIComponent(plan);
          emailResult = await sendPaymentRequiredEmail(
            emailCode, childName, childID, plan, finalPrice, paymentLink
          );
        } else {
          // ✅ الخطة المجانية → الترحيب + QR
          emailResult = await sendClientEmail(
            emailCode, childID, childLink, qrFileId, initialStatus, paymentStatus
          );
        }

        if (emailResult && emailResult.success) {
          await supabaseAdmin
            .from(TABLES.CHILDREN)
            .update({
              [COLS_CHILDREN.email_sent]: 'تم',
              [COLS_CHILDREN.email_retry_count]: 0
            })
            .eq(COLS_CHILDREN.child_id, childID);
          console.log(`✅ [register] client email sent for ${childID}`);
        }
      } catch (e) {
        console.warn('⚠️ [register] client email failed:', e.message);
      }
    }

    // 16. حفظ بصمة الوجه
    if (faceImageBase64) {
      try {
        const { saveFaceFeatures } = await import('./face.js');
        const faceResult = await saveFaceFeatures({
          childID,
          faceImage: faceImageBase64
        });
        if (faceResult.success) {
          console.log(`✅ [register] face features saved for ${childID}`);
        } else {
          console.warn(`⚠️ [register] face features failed: ${faceResult.error}`);
        }
      } catch (e) {
        console.warn('⚠️ [register] face features exception:', e.message);
      }
    }

    // 17. رسالة النجاح
    const isPaidPlanFinal = (plan === '6 أشهر' || plan === 'عام واحد');
    let msg;
    if (!isPaidPlanFinal) {
      msg = '🎉 تم تفعيل حسابك بنجاح! جاري إرسال رمز المتابعة.';
    } else {
      msg = 'تم استلام طلبك. يرجى إتمام الدفع لتفعيل الحساب.';
    }

    console.log(`✅ [register] DONE ${childID} (${Date.now() - t0}ms)`);

    // 🆕 رابط الدفع
    const paymentLink = isPaidPlanFinal
      ? 'https://www.kidcode-eg.com/payment.html?childID=' +
        encodeURIComponent(childID) + '&plan=' + encodeURIComponent(plan)
      : null;

    return {
      success: true,
      childID,
      childName,
      age,
      plan,
      childLink,
      paymentRequired: isPaidPlanFinal,
      paymentLink: paymentLink,
      remainingOffers: currentRemaining,
      message: msg,
      familySession: familySession
    };

  } catch (err) {
    console.error(`❌ [register] FATAL (${Date.now() - t0}ms)`, err.message);
    return { success: false, error: err.message };
  }
}