// ================================================================
//  lib/notify.js — إشعارات الأسرة (Supabase + Telegram + Email)
//  - notifyFamily: الراوتر الرئيسي
//  - buildTelegramMessage: بناء رسالة تليجرام حسب نوع الحدث
//  - sendTelegramToAllParentsWithRetry: للأب + الأم
//  - sendTelegramWithRetry: retry logic
//  - sendEmailNotification: fallback للإيميل
// ================================================================

import { supabaseAdmin } from './supabase.js';
import { TABLES, COLS_CHILDREN } from './db/tables.js';
import { sendViaTelegram } from './telegram.js';
import { sendScanAlertEmail, sendLocationEmail, sendChildUpdateEmail, sendFamilyWeeklyReport, sendChildIdChangedEmail, sendRefundEmail } from './email/brevo.js';

// ============================================================
//  🕐 توقيت مصر
// ============================================================
function nowEgypt() {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).replace('T', ' ');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
//  📤 sendTelegramWithRetry — إرسال مع Retry
// ============================================================
async function sendTelegramWithRetry(chatId, message, options = {}, maxAttempts = 3) {
  const RETRY_DELAYS = [3000, 5000, 8000]; // ms

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`🔄 [sendTelegramWithRetry] محاولة ${attempt}/${maxAttempts} للـ chat ${String(chatId).substring(0, 6)}***`);

    const result = await sendViaTelegram(chatId, message, options);

    if (result.success) {
      if (attempt > 1) {
        console.log(`✅ [sendTelegramWithRetry] نجحت في المحاولة ${attempt}`);
      }
      return {
        success: true,
        attempts: attempt,
        messageId: result.messageId,
        lastError: null
      };
    }

    lastError = result.error;

    if (attempt < maxAttempts) {
      let delayMs = RETRY_DELAYS[attempt - 1] || 5000;

      // احترام Retry-After
      if (result.retryAfter && result.retryAfter > 0) {
        delayMs = Math.max(delayMs, result.retryAfter * 1000);
        console.log(`⏱️ [sendTelegramWithRetry] Rate limit — انتظار ${delayMs}ms`);
      }

      console.log(`⏳ [sendTelegramWithRetry] فشل: "${lastError}" — انتظار ${delayMs}ms`);
      await sleep(delayMs);
    }
  }

  console.log(`❌ [sendTelegramWithRetry] فشل بعد ${maxAttempts} محاولات. آخر خطأ: "${lastError}"`);

  return {
    success: false,
    attempts: maxAttempts,
    messageId: null,
    lastError: lastError
  };
}

// ============================================================
//  📢 sendTelegramToAllParentsWithRetry — للأب + الأم
// ============================================================
async function sendTelegramToAllParentsWithRetry(child, message, options = {}) {
  try {
    // جمع chat_ids (بدون تكرار)
    const recipients = [];
    const fatherChat = String(child[COLS_CHILDREN.telegram_chat_id_father] || '').trim();
    const motherChat = String(child[COLS_CHILDREN.telegram_chat_id_mother] || '').trim();

    if (fatherChat) {
      recipients.push({ chatId: fatherChat, parentType: 'father' });
    }
    if (motherChat && motherChat !== fatherChat) {
      recipients.push({ chatId: motherChat, parentType: 'mother' });
    }

    if (recipients.length === 0) {
      return {
        success: true,
        totalChats: 0,
        sentCount: 0,
        failedCount: 0,
        noRecipients: true
      };
    }

    console.log(`📤 [sendToAllWithRetry] إرسال لـ ${recipients.length} parent`);

    // ✅ إرسال متوازي (أسرع بكتير من forEach)
    const results = await Promise.all(
      recipients.map(async (rec) => {
        const result = await sendTelegramWithRetry(rec.chatId, message, options, 3);
        const parentLabel = rec.parentType === 'father' ? 'الأب' : 'الأم';

        if (result.success) {
          console.log(`  ✅ ${parentLabel} — نجح في المحاولة ${result.attempts}`);
        } else {
          console.log(`  ❌ ${parentLabel} — فشل بعد ${result.attempts} محاولات`);
        }

        return {
          chatId: rec.chatId,
          parentType: rec.parentType,
          success: result.success,
          attempts: result.attempts,
          messageId: result.messageId,
          lastError: result.lastError
        };
      })
    );

    const sentCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    console.log(`📊 [sendToAllWithRetry] ${sentCount} نجح، ${failedCount} فشل`);

    return {
      success: sentCount > 0,
      totalChats: recipients.length,
      sentCount,
      failedCount,
      details: results
    };

  } catch (err) {
    console.error(`❌ [sendTelegramToAllParentsWithRetry] ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  📝 buildTelegramMessage — بناء الرسالة حسب النوع
// ============================================================
export function buildTelegramMessage(eventType, data) {
  const childName = String(data.childName || 'طفل').trim();
  const childID = String(data.childID || '').trim();
  const now = nowEgypt();
  const divider = '━━━━━━━━━━━━━━━━━━━';

  // scan_alert
  if (eventType === 'scan_alert') {
    const text =
      `🔔 <b>تم مسح رمز QR الخاص بطفلك</b>\n` +
      `\n` +
      `👶 <b>الطفل:</b> ${childName}\n` +
      `🆔 <b>المعرف:</b> <code>${childID}</code>\n` +
      `🕒 <b>الوقت:</b> ${now}\n` +
      `\n` +
      `${divider}\n` +
      `\n` +
      `⚠️ <i>إذا قام الشخص الذي وجد الطفل بمشاركة موقعه، ستصلك رسالة أخرى تحتوي على رابط الموقع.</i>\n` +
      `\n` +
      `<i>هذا إشعار تلقائي من KidCode-EG</i>`;

    return { text, inlineKeyboard: null };
  }

  // location
  if (eventType === 'location') {
    const locationLink = data.locationLink || '#';
    const addressText = data.addressText || 'غير متاح';
    const accuracyText = data.accuracy ? `\n🎯 <b>الدقة:</b> ±${Math.round(data.accuracy)} متر` : '';

    const text =
      `📍 <b>تم تحديد موقع طفلك</b>\n` +
      `\n` +
      `👶 <b>الطفل:</b> ${childName}\n` +
      `🆔 <b>المعرف:</b> <code>${childID}</code>\n` +
      `🕒 <b>الوقت:</b> ${now}\n` +
      `\n` +
      `${divider}\n` +
      `\n` +
      `📌 <b>العنوان التقريبي:</b>\n` +
      `${addressText}${accuracyText}\n` +
      `\n` +
      `🔗 <i>اضغط على الزر أدناه لفتح الموقع على الخريطة</i>`;

    return {
      text,
      inlineKeyboard: [
        [
          { text: '🗺️ افتح الموقع في خرائط Google', url: locationLink }
        ]
      ]
    };
  }

  // missing_report
  if (eventType === 'missing_report') {
    const reportId = data.reportId || '---';
    const clothes = data.clothes || '---';
    const governorate = data.governorate || '---';
    const district = data.district || '---';
    const landmark = data.landmark || '---';
    const age = data.age || 'غير محدد';

    const text =
      `🚨 <b>بلاغ اختفاء طفل</b>\n` +
      `\n` +
      `👶 <b>الاسم:</b> ${childName}\n` +
      `🆔 <b>المعرف:</b> <code>${childID}</code>\n` +
      `🎂 <b>العمر:</b> ${age}\n` +
      `\n` +
      `${divider}\n` +
      `\n` +
      `👕 <b>الملابس:</b>\n${clothes}\n` +
      `\n` +
      `📍 <b>الموقع:</b>\n${governorate} - ${district}\n` +
      `🏢 <b>علامة مميزة:</b>\n${landmark}\n` +
      `\n` +
      `${divider}\n` +
      `\n` +
      `📋 <b>رقم البلاغ:</b> <code>${reportId}</code>\n` +
      `🕒 <b>التوقيت:</b> ${now}\n` +
      `\n` +
      `✅ <i>تم إشعار جميع المتطوعين فوراً</i>\n` +
      `\n` +
      `⚠️ <b>مهم:</b> <i>يرجى تأكيد استلام الطفل خلال 24 ساعة من لحظة العثور عليه.</i>`;

    return {
      text,
      inlineKeyboard: [
        [
          {
            text: '📞 تواصل مع الدعم',
            url: 'https://wa.me/201004135973?text=' + encodeURIComponent('استفسار بخصوص بلاغ الطفل ' + childID)
          }
        ]
      ]
    };
  }

  // ============================================================
  //  ✏️ child_update — تعديل بيانات الطفل
  // ============================================================
  if (eventType === 'child_update') {
    const changedFields = data.changedFields || [];
    const fieldsStr = Array.isArray(changedFields)
      ? changedFields.join('، ')
      : String(changedFields || '');

    const text =
      `✏️ <b>تم تحديث بيانات طفلك</b>\n` +
      `\n` +
      `👶 <b>الطفل:</b> ${childName}\n` +
      `🆔 <b>المعرف:</b> <code>${childID}</code>\n` +
      `🕒 <b>الوقت:</b> ${now}\n` +
      `\n` +
      `${divider}\n` +
      `\n` +
      `📝 <b>الحقول التي تم تعديلها:</b>\n${fieldsStr}\n` +
      `\n` +
      `⚠️ <i>إذا لم تقم أنت بهذا التعديل، يرجى التواصل مع الدعم فوراً.</i>`;

    return {
      text,
      inlineKeyboard: [
        [
          {
            text: '👨‍👩‍👧 لوحة تحكم الأسرة',
            url: 'https://www.kidcode-eg.com/family-dashboard.html#data'
          }
        ],
        [
          {
            text: '📞 تواصل مع الدعم',
            url: 'https://wa.me/201004135973?text=' + encodeURIComponent('استفسار عن تعديل غير مصرح به للطفل ' + childID)
          }
        ]
      ]
    };
  }

  // ============================================================
  //  📊 weekly_report — التقرير الأسبوعي للأسرة
  // ============================================================
  if (eventType === 'weekly_report') {
    const plan = data.plan || 'غير محددة';
    const totalScans = data.totalScans || 0;
    const weeklyScans = data.weeklyScans || 0;
    const daysRemaining = data.daysRemaining || 'غير متاح';
    const expiryStatus = data.expiryStatus || 'نشط';

    // أيقونة حسب حالة الاشتراك
    const statusIcon = (expiryStatus === 'ينتهي قريباً') ? '⚠️' : '✅';

    const text =
      `📊 <b>التقرير الأسبوعي لطفلك</b>\n` +
      `\n` +
      `👶 <b>الطفل:</b> ${childName}\n` +
      `🆔 <b>المعرف:</b> <code>${childID}</code>\n` +
      `📋 <b>الباقة:</b> ${plan}\n` +
      `🕒 <b>الوقت:</b> ${now}\n` +
      `\n` +
      `${divider}\n` +
      `\n` +
      `📱 <b>مسحات هذا الأسبوع:</b> <b>${weeklyScans}</b>\n` +
      `📊 <b>إجمالي المسحات:</b> ${totalScans}\n` +
      `\n` +
      `⏰ <b>المدة المتبقية:</b> ${daysRemaining}\n` +
      `${statusIcon} <b>حالة الاشتراك:</b> ${expiryStatus}\n` +
      `\n` +
      `${divider}\n` +
      `\n` +
      `<i>هذا تقرير أسبوعي تلقائي من KidCode-EG</i>`;

    const inlineKeyboard = [];
    inlineKeyboard.push([
      {
        text: '📊 افتح لوحة التحكم',
        url: 'https://www.kidcode-eg.com/family-dashboard.html'
      }
    ]);

    // لو الاشتراك قارب على الانتهاء — نضيف زر تجديد
    if (expiryStatus === 'ينتهي قريباً') {
      inlineKeyboard.push([
        {
          text: '🔄 جدد الاشتراك الآن',
          url: 'https://wa.me/201004135973?text=' + encodeURIComponent('السلام عليكم، أريد تجديد اشتراك الطفل ' + childID)
        }
      ]);
    }

    return { text, inlineKeyboard };
  }

    // ============================================================
  //  🔐 child_id_revoked — تغيير كود الطفل
  // ============================================================
  if (eventType === 'child_id_revoked') {
    const oldChildID = data.oldChildID || '—';
    const newChildID = data.newChildID || '—';
    const reasonLabel = data.reasonLabel || '—';

    const text =
      '🔐 <b>تم تحديث كود طفلك</b>\n' +
      '\n' +
      '👶 <b>الطفل:</b> ' + childName + '\n' +
      '🕒 <b>الوقت:</b> ' + now + '\n' +
      '\n' +
      divider + '\n' +
      '\n' +
      '🚫 <b>الكود القديم (ملغى):</b>\n' +
      '<code>' + oldChildID + '</code>\n' +
      '\n' +
      '✅ <b>الكود الجديد:</b>\n' +
      '<code>' + newChildID + '</code>\n' +
      '\n' +
      divider + '\n' +
      '\n' +
      '📌 <b>سبب التغيير:</b>\n' + reasonLabel + '\n' +
      '\n' +
      '⚠️ <b>مهم:</b>\n' +
      '• احفظ الكود الجديد\n' +
      '• اطبع QR الجديد واستبدله\n' +
      '• تخلص من النسخ القديمة\n' +
      '\n' +
      '<i>إذا لم تطلب هذا التغيير، تواصل معنا فورًا.</i>';

    const inlineKeyboard = [
      [{ text: '🔐 دخول لوحة الأسرة', url: 'https://www.kidcode-eg.com/family-login' }],
      [{ text: '📞 تواصل مع الدعم', url: 'https://wa.me/201004135973?text=' + encodeURIComponent('استفسار بخصوص تغيير كود الطفل ' + newChildID) }]
    ];

    return { text, inlineKeyboard };
  }

  // ============================================================
  //  💸 refund_completed — تم استرداد المبلغ
  // ============================================================
  if (eventType === 'refund_completed') {
    const amount = data.amount || 0;
    const currency = data.currency || 'EGP';
    const plan = data.plan || 'غير محددة';
    const reason = data.reason || '—';
    const refundId = data.refundId || '—';

    const text =
      '💸 <b>تم استرداد مبلغ الاشتراك</b>\n' +
      '\n' +
      '👶 <b>الطفل:</b> ' + childName + '\n' +
      '🆔 <b>المعرف:</b> <code>' + childID + '</code>\n' +
      '🕒 <b>الوقت:</b> ' + now + '\n' +
      '\n' +
      divider + '\n' +
      '\n' +
      '💰 <b>المبلغ:</b> <b>' + amount + ' ' + currency + '</b>\n' +
      '📋 <b>الباقة:</b> ' + plan + '\n' +
      '🆔 <b>رقم الاسترداد:</b> <code>' + refundId + '</code>\n' +
      '\n' +
      divider + '\n' +
      '\n' +
      '📝 <b>سبب الاسترداد:</b>\n' + reason + '\n' +
      '\n' +
      '⚠️ <b>مهم:</b>\n' +
      '• تم إلغاء اشتراك الطفل\n' +
      '• سيصل المبلغ خلال 5-7 أيام عمل\n' +
      '• حسب طريقة الدفع الأصلية\n' +
      '\n' +
      '<i>إذا كان لديك استفسار، تواصل مع الدعم.</i>';

    return {
      text,
      inlineKeyboard: [
        [
          {
            text: '📞 تواصل مع الدعم',
            url: 'https://wa.me/201004135973?text=' + encodeURIComponent('استفسار عن استرداد مبلغ الطفل ' + childID)
          }
        ]
      ]
    };
  }

  // default
  return {
    text: `📢 إشعار من KidCode-EG\n\n👶 ${childName}\n🕒 ${now}`,
    inlineKeyboard: null
  };
}

// ============================================================
//  📧 sendEmailNotification — Fallback للإيميل
// ============================================================
async function sendEmailNotification(child, eventType, eventData, extra = {}) {
  try {
    const childID = String(child[COLS_CHILDREN.child_id] || '').trim();
    const childName = String(child[COLS_CHILDREN.child_name] || 'طفل').trim();
    const parentEmail = String(child[COLS_CHILDREN.email_code] || '').trim();

    if (!parentEmail) {
      console.log(`⚠️ [sendEmailNotification] مفيش إيميل للطفل ${childID}`);
      return {
        success: false,
        error: 'no_email',
        channel: 'none',
        fallbackUsed: !!extra.telegram
      };
    }

    let emailResult = null;
    const now = nowEgypt();

    switch (eventType) {
      case 'scan_alert':
        emailResult = await sendScanAlertEmail(parentEmail, childID, childName, now);
        break;

      case 'location':
        emailResult = await sendLocationEmail(
          parentEmail,
          childID,
          childName,
          eventData.locationLink || '#',
          now,
          eventData.addressText || '',
          eventData.clientIP || 'UNKNOWN',
          false
        );
        break;

      case 'missing_report':
        console.log(`ℹ️ [sendEmailNotification] missing_report → يتخطى`);
        return { success: true, channel: 'email', skipped: true };
      case 'child_update':
        emailResult = await sendChildUpdateEmail(
          parentEmail,
          childName,
          childID,
          eventData.changedFields || []
        );
        break;

      case 'child_id_revoked':
        emailResult = await sendChildIdChangedEmail(
          parentEmail,
          childName,
          eventData.oldChildID || '',
          eventData.newChildID || '',
          eventData.newQRUrl || '',
          eventData.reasonLabel || ''
        );
        break;

      case 'weekly_report':
        emailResult = await sendFamilyWeeklyReport({
          email: parentEmail,
          childName: childName,
          childID: childID,
          plan: eventData.plan || '',
          totalScans: eventData.totalScans || 0,
          weeklyScans: eventData.weeklyScans || 0,
          daysRemaining: eventData.daysRemaining || 'غير متاح',
          expiryStatus: eventData.expiryStatus || 'نشط'
        });
        break;

      // ✅ جديد: refund_completed — إيميل استرداد المبلغ
      case 'refund_completed':
        emailResult = await sendRefundEmail(
          parentEmail,
          childName,
          childID,
          eventData.amount || 0,
          eventData.currency || 'EGP',
          eventData.plan || '',
          eventData.refundId || '',
          eventData.reason || ''
        );
        break;

      default:
        console.log(`⚠️ [sendEmailNotification] eventType غير معروف: ${eventType}`);
        return { success: false, error: 'unknown_event_type' };
    }

    const success = emailResult && emailResult.success;

    console.log(`${success ? '✅' : '❌'} [sendEmailNotification] ${eventType} → ${parentEmail}`);

    return {
      success,
      channel: success ? 'email' : 'none',
      email: emailResult,
      fallbackUsed: !!extra.telegram,
      fallbackReason: extra.fallbackReason || null
    };

  } catch (err) {
    console.error(`❌ [sendEmailNotification] ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  🚀 notifyFamily — الراوتر الرئيسي
// ============================================================
export async function notifyFamily(params) {
  try {
    const cleanID = String(params.childID || '').trim().toUpperCase();
    const eventType = String(params.eventType || '').trim();
    const eventData = params.eventData || {};

    if (!cleanID) return { success: false, error: 'child_id_missing' };
    if (!eventType) return { success: false, error: 'event_type_missing' };

    // ✅ إذا مرر المستدعي `_preloadedChild` → استخدمه بدون Query إضافي
    //    (مفيد للـ Cron Jobs اللي بتقرأ كل الأطفال مرة واحدة)
    let child = params._preloadedChild || null;

    if (!child) {
      // 1. جيب الطفل من Supabase
      const { data, error } = await supabaseAdmin
        .from(TABLES.CHILDREN)
        .select('*')
        .eq(COLS_CHILDREN.child_id, cleanID)
        .maybeSingle();

      if (error || !data) {
        console.log(`❌ [notifyFamily] طفل غير موجود: ${cleanID}`);
        return { success: false, error: 'child_not_found' };
      }
      child = data;
    }

    const childName = String(child[COLS_CHILDREN.child_name] || 'طفل').trim();
    const parentEmail = String(child[COLS_CHILDREN.email_code] || '').trim();

    // 2. طريقة الإشعارات
    const method = String(child[COLS_CHILDREN.notification_method] || 'email').trim().toLowerCase();

    console.log(`📨 [notifyFamily] طفل ${cleanID} | event: ${eventType} | method: ${method}`);

    // 3. مسار تليجرام
    if (method === 'telegram') {
      const fatherChat = String(child[COLS_CHILDREN.telegram_chat_id_father] || '').trim();
      const motherChat = String(child[COLS_CHILDREN.telegram_chat_id_mother] || '').trim();

      if (!fatherChat && !motherChat) {
        console.log(`⚠️ [notifyFamily] method=telegram لكن مفيش parents → Fallback للإيميل`);
        return await sendEmailNotification(child, eventType, eventData, {
          fallbackReason: 'no_telegram_parents'
        });
      }

      const messageObj = buildTelegramMessage(eventType, {
        childID: cleanID,
        childName: childName,
        ...eventData
      });

      const telegramOptions = {};
      if (messageObj.inlineKeyboard) {
        telegramOptions.inlineKeyboard = messageObj.inlineKeyboard;
      }

      const telegramResult = await sendTelegramToAllParentsWithRetry(
        child,
        messageObj.text,
        telegramOptions
      );

      if (telegramResult.success && telegramResult.sentCount > 0) {
        console.log(`✅ [notifyFamily] تليجرام نجح (${telegramResult.sentCount}/${telegramResult.totalChats})`);

        if (telegramResult.failedCount > 0 && parentEmail) {
          console.log(`⚠️ [notifyFamily] ${telegramResult.failedCount} parent فشل → إيميل احتياطي`);
          try {
            await sendEmailNotification(child, eventType, eventData, {
              fallbackReason: 'partial_telegram_failure'
            });
          } catch (e) {
            console.error('⚠️ فشل الإيميل الاحتياطي:', e.message);
          }
        }

        return {
          success: true,
          channel: 'telegram',
          telegram: telegramResult,
          fallbackUsed: false
        };
      }

      // كل المحاولات فشلت
      console.log(`❌ [notifyFamily] تليجرام فشل كلياً → Fallback للإيميل`);

      if (!parentEmail) {
        return {
          success: false,
          error: 'no_fallback_email',
          channel: 'none',
          telegram: telegramResult
        };
      }

      return await sendEmailNotification(child, eventType, eventData, {
        telegram: telegramResult,
        fallbackReason: 'telegram_failed'
      });
    }

    // 4. مسار الإيميل المباشر
    console.log(`📧 [notifyFamily] مسار الإيميل المباشر`);
    return await sendEmailNotification(child, eventType, eventData);

  } catch (err) {
    console.error(`❌ [notifyFamily] ${err.message}`);
    return { success: false, error: err.message };
  }
}