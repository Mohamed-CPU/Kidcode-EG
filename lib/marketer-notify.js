// ================================================================
//  lib/marketer-notify.js — إشعارات المسوقين (Supabase + Telegram + Email)
//  - notifyMarketer: الراوتر الرئيسي
//  - buildMarketerMessage: بناء رسالة تليجرام
//  - buildMarketerEmailHtml: بناء محتوى الإيميل
//  - sendTelegramToMarketer: إرسال تليجرام
//  - sendMarketerEmail: إرسال إيميل
//  - calculateMarketerTotals: حساب المجاميع
// ================================================================

import { supabaseAdmin } from './supabase.js';
import { TABLES, COLS_MARKETERS, COLS_CHILDREN, COLS_WITHDRAW } from './db/tables.js';
import { sendViaTelegram } from './telegram.js';
import {
  sendEmailViaBrevo,
  buildEmailHtml,
  sendWithdrawStatusEmail
} from './email/brevo.js';

// ============================================================
//  🕐 توقيت مصر
// ============================================================
function nowEgypt() {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).replace('T', ' ');
}

const PROJECT_NAME = 'KidCode-EG';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
//  📤 sendTelegramWithRetry — إرسال مع 3 محاولات
// ============================================================
async function sendTelegramWithRetry(chatId, message, options = {}, maxAttempts = 3) {
  const RETRY_DELAYS = [3000, 5000, 8000];

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await sendViaTelegram(chatId, message, options);

    if (result.success) {
      if (attempt > 1) console.log(`✅ [sendTelegramWithRetry] نجحت في المحاولة ${attempt}`);
      return { success: true, attempts: attempt, messageId: result.messageId, lastError: null };
    }

    lastError = result.error;

    if (attempt < maxAttempts) {
      let delayMs = RETRY_DELAYS[attempt - 1] || 5000;
      if (result.retryAfter && result.retryAfter > 0) {
        delayMs = Math.max(delayMs, result.retryAfter * 1000);
      }
      console.log(`⏳ [sendTelegramWithRetry] محاولة ${attempt} فشلت — انتظار ${delayMs}ms`);
      await sleep(delayMs);
    }
  }

  return { success: false, attempts: maxAttempts, messageId: null, lastError };
}

// ============================================================
//  📝 buildMarketerMessage — بناء رسالة تليجرام
// ============================================================
function buildMarketerMessage(eventType, data) {
  const marketerName = String(data.marketerName || 'مُسوّق').trim();
  const marketerCode = String(data.marketerCode || '').trim();
  const now = nowEgypt();
  const divider = '━━━━━━━━━━━━━━━━━━━';

  // 1️⃣ عميل جديد
  if (eventType === 'new_client') {
    const childName = data.childName || 'غير معروف';
    const childID = data.childID || '---';
    const plan = data.plan || 'غير محددة';
    const finalPrice = data.finalPrice || 0;
    const commission = data.commission || 0;
    const expectedDate = data.expectedDate || '';

    const text =
      `🎉 <b>عميل جديد!</b>\n\n` +
      `تم تسجيل طفل جديد باستخدام كودك.\n\n` +
      `${divider}\n\n` +
      `👤 <b>الطفل:</b> ${childName}\n` +
      `🆔 <b>المعرف:</b> <code>${childID}</code>\n` +
      `📋 <b>الباقة:</b> ${plan}\n` +
      `💰 <b>السعر:</b> ${finalPrice} ج.م\n` +
      `🎫 <b>كودك:</b> <code>${marketerCode}</code>\n\n` +
      `${divider}\n\n` +
      `💵 <b>عمولتك:</b> <b>${commission} ج.م</b> (معلقة)\n` +
      `⏳ تصبح مستحقة بعد <b>14 يوماً</b>\n` +
      (expectedDate ? `📅 التاريخ المتوقع: <b>${expectedDate}</b>\n` : '') +
      `\n<i>يتم احتساب العمولة بعد انتهاء فترة الاسترداد القانونية (14 يوماً).</i>`;

    return {
      text,
      inlineKeyboard: [[{ text: '📊 اعرض إحصائياتك', callback_data: 'my_stats' }]]
    };
  }

  // 2️⃣ عمولة مستحقة
  if (eventType === 'commission_earned') {
    const childName = data.childName || 'غير معروف';
    const childID = data.childID || '---';
    const commission = data.commission || 0;
    const totalEarned = data.totalEarned || 0;
    const totalPending = data.totalPending || 0;

    const text =
      `✅ <b>عمولة جديدة مستحقة!</b>\n\n` +
      `انقضت فترة الاسترداد القانونية (14 يوماً)، وأصبحت عمولتك مستحقة الصرف.\n\n` +
      `${divider}\n\n` +
      `👤 <b>العميل:</b> ${childName}\n` +
      `🆔 <b>المعرف:</b> <code>${childID}</code>\n` +
      `💰 <b>العمولة:</b> <b>${commission} ج.م</b>\n\n` +
      `${divider}\n\n` +
      `💵 <b>رصيدك المستحق:</b> <b>${totalEarned} ج.م</b>\n` +
      `⏳ <b>معلق:</b> ${totalPending} ج.م\n\n` +
      `📢 للاستفسار عن السحب: <a href="https://t.me/Kidcode_EG">@Kidcode_EG</a>`;

    return {
      text,
      inlineKeyboard: [[{
        text: '💰 تواصل لسحب مستحقاتك',
        url: 'https://wa.me/201004135973?text=' + encodeURIComponent('السلام عليكم، أريد سحب مستحقاتي كمسوق ' + marketerCode)
      }]]
    };
  }

  // 3️⃣ تقرير أسبوعي
  if (eventType === 'weekly_report') {
    const newClientsThisWeek = data.newClientsThisWeek || 0;
    const commissionsThisWeek = data.commissionsThisWeek || 0;
    const totalEarned = data.totalEarned || 0;
    const totalPending = data.totalPending || 0;
    const totalChildren = data.totalChildren || 0;
    const totalCommissionAllTime = data.totalCommissionAllTime || 0;
    const periodText = data.periodText || '';
    const needsTelegramLink = data.needsTelegramLink === true;

    const telegramReminderLine = needsTelegramLink
      ? `\n${divider}\n\n⚠️ <b>ملاحظة:</b>\n<i>أنت اخترت إشعارات تليجرام لكن لم يتم الربط بعد. حالياً تصلك الإشعارات على البريد الإلكتروني.</i>\n`
      : '';

    const text =
      `📊 <b>تقريرك الأسبوعي</b>\n\n` +
      `🗓️ <b>الفترة:</b> ${periodText}\n\n` +
      `${divider}\n\n` +
      `👶 <b>عملاء جدد:</b> ${newClientsThisWeek}\n` +
      `💰 <b>عمولات هذا الأسبوع:</b> ${commissionsThisWeek} ج.م\n\n` +
      `💵 <b>الرصيد المستحق:</b> <b>${totalEarned} ج.م</b>\n` +
      `⏳ <b>معلق:</b> ${totalPending} ج.م\n\n` +
      `${divider}\n\n` +
      `📈 <b>إجمالي أدائك:</b>\n` +
      `• الأطفال المسجلون: <b>${totalChildren}</b>\n` +
      `• إجمالي العمولات: <b>${totalCommissionAllTime} ج.م</b>\n` +
      telegramReminderLine +
      `\n🎫 <b>كودك:</b> <code>${marketerCode}</code>`;

    const inlineKeyboard = needsTelegramLink
      ? [
          [{ text: '🔗 اربط تليجرام الآن', url: 'https://www.kidcode-eg.com/marketer-dashboard?open=notifications' }],
          [{ text: '📊 لوحة التحكم', url: 'https://www.kidcode-eg.com/marketer-dashboard' }]
        ]
      : [[{ text: '📊 لوحة التحكم', url: 'https://www.kidcode-eg.com/marketer-dashboard' }]];

    return { text, inlineKeyboard };
  }

  // 4️⃣ حذف عميل
  if (eventType === 'client_deleted') {
    const childID = data.childID || '---';
    const reason = data.reason || 'حذف خلال 14 يوم من التسجيل — العمولة ملغاة';

    const text =
      `🗑️ <b>تم حذف أحد عملائك</b>\n\n` +
      `${divider}\n\n` +
      `🆔 <b>معرف الطفل:</b> <code>${childID}</code>\n` +
      `📌 <b>السبب:</b> ${reason}\n\n` +
      `${divider}\n\n` +
      `💰 <i>تم إلغاء عمولة هذا العميل.</i>\n\n` +
      `📢 للاستفسار: <a href="https://t.me/Kidcode_EG">@Kidcode_EG</a>`;

    return {
      text,
      inlineKeyboard: [[{
        text: '📞 تواصل مع الدعم',
        url: 'https://wa.me/201004135973?text=' + encodeURIComponent('استفسار بخصوص حذف عميل ' + childID)
      }]]
    };
  }

  // default
  return {
    text: `📢 إشعار من KidCode-EG\n\n${marketerName}`,
    inlineKeyboard: null
  };
}

// ============================================================
//  📧 buildMarketerEmailHtml — قوالب الإيميلات
//  returns: { title, content, extraHtml }
// ============================================================
function buildMarketerEmailHtml(eventType, data) {
  const marketerName = String(data.marketerName || 'مُسوّق').trim();
  const marketerCode = String(data.marketerCode || '').trim();
  const divider = `<hr style="border:0; border-top:1px solid #e2e8f0; margin:20px 0;">`;

  // 1️⃣ عميل جديد
  if (eventType === 'new_client') {
    const childName = data.childName || 'غير معروف';
    const childID = data.childID || '---';
    const plan = data.plan || 'غير محددة';
    const finalPrice = data.finalPrice || 0;
    const commission = data.commission || 0;
    const expectedDate = data.expectedDate || '';

    const title = `🎉 عميل جديد - ${marketerCode}`;

    const content = `
      <p style="font-size:1.05rem; margin:0 0 10px;">مرحباً <strong>${marketerName}</strong>،</p>
      <p style="margin:0 0 16px; color:#475569;">تم تسجيل طفل جديد باستخدام كودك الخاص.</p>

      <div style="background:#f0f9ff; border-right:4px solid #0088CC; border-radius:12px; padding:16px 20px; margin:18px 0;">
        <p style="margin:6px 0; color:#0c4a6e;"><strong>👤 الطفل:</strong> ${childName}</p>
        <p style="margin:6px 0; color:#0c4a6e;"><strong>🆔 المعرف:</strong> <code style="background:white; padding:2px 8px; border-radius:6px; font-family:monospace; color:#0088CC;">${childID}</code></p>
        <p style="margin:6px 0; color:#0c4a6e;"><strong>📋 الباقة:</strong> ${plan}</p>
        <p style="margin:6px 0; color:#0c4a6e;"><strong>💰 السعر:</strong> ${finalPrice} ج.م</p>
        <p style="margin:6px 0; color:#0c4a6e;"><strong>🎫 كودك:</strong> <code style="background:white; padding:2px 8px; border-radius:6px; font-family:monospace; color:#0088CC;">${marketerCode}</code></p>
      </div>

      ${divider}

      <div style="background:#e8f5ee; border-right:4px solid #10B981; border-radius:12px; padding:16px 20px; margin:18px 0;">
        <p style="margin:6px 0; color:#166534; font-size:1.05rem;">
          💵 <strong>عمولتك:</strong> <span style="font-size:1.3rem; font-weight:900;">${commission} ج.م</span> <span style="color:#64748b; font-size:0.9rem;">(معلقة)</span>
        </p>
        <p style="margin:6px 0; color:#166534; font-size:0.9rem;">⏳ تصبح مستحقة بعد <strong>14 يوماً</strong></p>
        ${expectedDate ? `<p style="margin:6px 0; color:#166534; font-size:0.9rem;">📅 التاريخ المتوقع: <strong>${expectedDate}</strong></p>` : ''}
      </div>

      <p style="font-size:0.85rem; color:#64748B; margin:14px 0 0; text-align:center;">يتم احتساب العمولة بعد انتهاء فترة الاسترداد القانونية (14 يوماً).</p>
    `;

    const extraHtml = `
      ${divider}
      <p style="text-align:center; margin:16px 0 10px; font-weight:700; color:#1A1A2E;">لمتابعة أدائك:</p>
      <p style="text-align:center; margin:12px 0;">
        <a href="https://www.kidcode-eg.com/marketer-dashboard" style="display:inline-block; background:linear-gradient(135deg, #22559F, #1A437C); color:white; padding:12px 28px; text-decoration:none; border-radius:30px; font-weight:bold; font-size:0.95rem;">
          📊 اعرض إحصائياتك
        </a>
      </p>
    `;

    return { title, content, extraHtml };
  }

  // 2️⃣ عمولة مستحقة
  if (eventType === 'commission_earned') {
    const childName = data.childName || 'غير معروف';
    const childID = data.childID || '---';
    const commission = data.commission || 0;
    const totalEarned = data.totalEarned || 0;
    const totalPending = data.totalPending || 0;

    const title = `✅ عمولة جديدة مستحقة - ${marketerCode}`;

    const content = `
      <p style="font-size:1.05rem; margin:0 0 10px;">مرحباً <strong>${marketerName}</strong>،</p>
      <p style="margin:0 0 16px; color:#475569;">انقضت فترة الاسترداد القانونية (14 يوماً)، وأصبحت عمولتك مستحقة الصرف.</p>

      <div style="background:#e8f5ee; border-right:4px solid #10B981; border-radius:12px; padding:16px 20px; margin:18px 0;">
        <p style="margin:6px 0; color:#166534;"><strong>👤 العميل:</strong> ${childName}</p>
        <p style="margin:6px 0; color:#166534;"><strong>🆔 المعرف:</strong> <code style="background:white; padding:2px 8px; border-radius:6px; font-family:monospace; color:#10B981;">${childID}</code></p>
        <p style="margin:6px 0; color:#166534; font-size:1.05rem;">
          <strong>💰 العمولة:</strong> <span style="font-size:1.3rem; font-weight:900;">${commission} ج.م</span>
        </p>
      </div>

      ${divider}

      <div style="background:#f8fafc; border-radius:12px; padding:16px 20px; margin:18px 0;">
        <p style="margin:6px 0; font-size:1rem;">💵 <strong>رصيدك المستحق:</strong> <span style="color:#10B981; font-weight:900; font-size:1.15rem;">${totalEarned} ج.م</span></p>
        <p style="margin:6px 0; font-size:0.95rem; color:#64748B;">⏳ <strong>معلق:</strong> ${totalPending} ج.م</p>
      </div>
    `;

    const extraHtml = `
      ${divider}
      <p style="text-align:center; margin:16px 0 10px; font-weight:700; color:#1A1A2E;">لسحب مستحقاتك:</p>
      <p style="text-align:center; margin:12px 0;">
        <a href="https://wa.me/201004135973?text=${encodeURIComponent('السلام عليكم، أريد سحب مستحقاتي كمسوق ' + marketerCode)}" style="display:inline-block; background:#25D366; color:white; padding:12px 28px; text-decoration:none; border-radius:30px; font-weight:bold; font-size:0.95rem;">
          💰 تواصل لسحب مستحقاتك
        </a>
      </p>
    `;

    return { title, content, extraHtml };
  }

  // 3️⃣ تقرير أسبوعي
  if (eventType === 'weekly_report') {
    const newClientsThisWeek = data.newClientsThisWeek || 0;
    const commissionsThisWeek = data.commissionsThisWeek || 0;
    const totalEarned = data.totalEarned || 0;
    const totalPending = data.totalPending || 0;
    const totalChildren = data.totalChildren || 0;
    const totalCommissionAllTime = data.totalCommissionAllTime || 0;
    const periodText = data.periodText || '';
    const needsTelegramLink = data.needsTelegramLink === true;

    const title = `📊 تقريرك الأسبوعي - ${marketerCode}`;

    const telegramReminderBox = needsTelegramLink ? `
      <div style="background:#fef3c7; border-right:4px solid #f59e0b; border-radius:12px; padding:16px 20px; margin:18px 0;">
        <p style="margin:0 0 8px; color:#92400e; font-weight:900; font-size:1rem;">⚠️ ملاحظة: حساب تليجرام غير مربوط</p>
        <p style="margin:0 0 12px; color:#78350f; font-size:0.9rem; line-height:1.7;">أنت اخترت إشعارات تليجرام وقت التسجيل، لكن لم يتم الربط بعد. حالياً تصلك الإشعارات على البريد الإلكتروني.</p>
        <div style="text-align:center;">
          <a href="https://www.kidcode-eg.com/marketer-dashboard?open=notifications" style="display:inline-block; background:linear-gradient(135deg, #0088CC, #006699); color:white; padding:11px 26px; text-decoration:none; border-radius:30px; font-weight:800; font-size:0.9rem;">
            🔗 اربط تليجرام الآن
          </a>
        </div>
      </div>
    ` : '';

    const content = `
      <p style="font-size:1.05rem; margin:0 0 10px;">مرحباً <strong>${marketerName}</strong>،</p>
      <p style="margin:0 0 16px; color:#475569;">هذا ملخص أدائك خلال الأسبوع الماضي.</p>

      ${periodText ? `
      <div style="background:#f0f4ff; border-right:4px solid #22559F; border-radius:12px; padding:12px 16px; margin:16px 0; text-align:center;">
        <p style="margin:0; color:#22559F; font-weight:700; font-size:0.95rem;">🗓️ <strong>الفترة:</strong> ${periodText}</p>
      </div>
      ` : ''}

      <h3 style="font-size:0.95rem; color:#22559F; margin:16px 0 10px; font-weight:900;">📈 أداء هذا الأسبوع</h3>
      <div style="background:#f8fafc; border-radius:12px; padding:16px 20px; margin:12px 0;">
        <p style="margin:6px 0;"><strong>👶 عملاء جدد:</strong> ${newClientsThisWeek}</p>
        <p style="margin:6px 0;"><strong>💰 عمولات هذا الأسبوع:</strong> ${commissionsThisWeek} ج.م</p>
      </div>

      ${divider}

      <h3 style="font-size:0.95rem; color:#22559F; margin:16px 0 10px; font-weight:900;">💼 إجمالي أدائك</h3>
      <div style="background:#e8f5ee; border-right:4px solid #10B981; border-radius:12px; padding:16px 20px; margin:12px 0;">
        <p style="margin:6px 0;"><strong>👶 إجمالي الأطفال:</strong> <span style="font-weight:900;">${totalChildren}</span></p>
        <p style="margin:6px 0;"><strong>💰 إجمالي العمولات:</strong> <span style="font-weight:900;">${totalCommissionAllTime} ج.م</span></p>
        <p style="margin:10px 0 0; padding-top:10px; border-top:1px solid #d1fae5;">
          <strong>✅ رصيد مستحق:</strong> <span style="color:#10B981; font-weight:900; font-size:1.1rem;">${totalEarned} ج.م</span>
        </p>
        <p style="margin:6px 0;"><strong>⏳ معلق:</strong> ${totalPending} ج.م</p>
      </div>

      ${telegramReminderBox}
    `;

    const extraHtml = `
      ${divider}
      <p style="text-align:center; margin:12px 0;">
        <a href="https://www.kidcode-eg.com/marketer-dashboard" style="display:inline-block; background:linear-gradient(135deg, #22559F, #1A437C); color:white; padding:12px 28px; text-decoration:none; border-radius:30px; font-weight:bold; font-size:0.95rem;">
          📊 الذهاب إلى لوحة التحكم
        </a>
      </p>
    `;

    return { title, content, extraHtml };
  }

  // 4️⃣ حذف عميل
  if (eventType === 'client_deleted') {
    const childID = data.childID || '---';
    const reason = data.reason || 'حذف خلال 14 يوم من التسجيل';

    const title = `🗑️ تم حذف عميل - ${marketerCode}`;

    const content = `
      <p style="font-size:1.05rem; margin:0 0 10px;">مرحباً <strong>${marketerName}</strong>،</p>
      <p style="margin:0 0 16px; color:#475569;">تم حذف أحد عملائك من النظام.</p>

      <div style="background:#fef2f2; border-right:4px solid #ef4444; border-radius:12px; padding:16px 20px; margin:18px 0;">
        <p style="margin:6px 0; color:#991b1b;"><strong>🆔 معرف الطفل:</strong> <code style="background:white; padding:2px 8px; border-radius:6px; font-family:monospace; color:#ef4444;">${childID}</code></p>
        <p style="margin:6px 0; color:#991b1b;"><strong>📌 السبب:</strong> ${reason}</p>
      </div>

      ${divider}

      <div style="background:#fef3c7; border-right:4px solid #f59e0b; border-radius:12px; padding:14px 18px; margin:18px 0;">
        <p style="margin:0; color:#92400e; font-size:0.95rem;">💰 <strong>ملاحظة:</strong> تم إلغاء عمولة هذا العميل (حذف خلال 14 يوم من التسجيل).</p>
      </div>
    `;

    const extraHtml = `
      ${divider}
      <p style="text-align:center; margin:12px 0;">
        <a href="https://wa.me/201004135973?text=${encodeURIComponent('السلام عليكم، بخصوص حذف عميل ' + childID + ' — كمسوق ' + marketerCode)}" style="display:inline-block; background:#25D366; color:white; padding:12px 28px; text-decoration:none; border-radius:30px; font-weight:bold; font-size:0.95rem;">
          💬 تواصل مع الدعم
        </a>
      </p>
    `;

    return { title, content, extraHtml };
  }

  // default
  return {
    title: `إشعار من KidCode-EG`,
    content: `<p>مرحباً ${marketerName}،</p>`,
    extraHtml: ''
  };
}

// ============================================================
//  📧 sendMarketerEmail — إرسال إيميل للمسوق
// ============================================================
async function sendMarketerEmail(marketer, eventType, eventData) {
  try {
    if (!marketer.email) {
      return { success: false, error: 'no_email' };
    }

    const emailData = {
      marketerName: marketer.name,
      marketerCode: marketer.code,
      ...eventData
    };

    const template = buildMarketerEmailHtml(eventType, emailData);
    const htmlBody = buildEmailHtml(template.title, template.content, template.extraHtml);

    const subjectsMap = {
      'new_client': `🎉 عميل جديد - ${marketer.code}`,
      'commission_earned': `✅ عمولة مستحقة - ${marketer.code}`,
      'weekly_report': `📊 تقريرك الأسبوعي - ${marketer.code}`,
      'client_deleted': `🗑️ تم حذف عميل - ${marketer.code}`
    };
    const subject = subjectsMap[eventType] || `إشعار - ${marketer.code}`;

    const result = await sendEmailViaBrevo({
      to: marketer.email,
      subject,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'sales@kidcode-eg.com',
      replyToName: PROJECT_NAME + ' - Sales'
    });

    if (result.success) {
      console.log(`📧 [sendMarketerEmail] ${marketer.code} | ${eventType} → ${marketer.email}`);
    }

    return result;

  } catch (err) {
    console.error(`❌ [sendMarketerEmail] ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  📤 sendTelegramToMarketer — إرسال تليجرام
// ============================================================
async function sendTelegramToMarketer(chatId, message, options = {}, maxAttempts = 3) {
  if (!chatId) {
    return { success: false, error: 'not_linked', skipped: true };
  }
  return await sendTelegramWithRetry(chatId, message, options, maxAttempts);
}

// ============================================================
//  🚀 notifyMarketer — الراوتر الرئيسي
//  params: { marketerCode, eventType, eventData }
// ============================================================
export async function notifyMarketer(params) {
  try {
    const cleanCode = String(params.marketerCode || '').trim().toUpperCase();
    const eventType = String(params.eventType || '').trim();
    const eventData = params.eventData || {};

    if (!cleanCode) return { success: false, error: 'marketer_code_missing' };
    if (!eventType) return { success: false, error: 'event_type_missing' };

    console.log(`📨 [notifyMarketer] ${cleanCode} | event: ${eventType}`);

    // 1. جيب المسوق من Supabase
    const { data: marketer, error } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .select('*')
      .eq(COLS_MARKETERS.code, cleanCode)
      .maybeSingle();

    if (error || !marketer) {
      console.log(`❌ [notifyMarketer] المسوق غير موجود: ${cleanCode}`);
      return { success: false, error: 'marketer_not_found' };
    }

    const marketerObj = {
      code: cleanCode,
      name: String(marketer[COLS_MARKETERS.name] || 'مُسوّق').trim(),
      email: String(marketer[COLS_MARKETERS.email] || '').trim(),
      chatId: String(marketer[COLS_MARKETERS.telegram_chat_id] || '').trim(),
      notificationMethod: String(marketer[COLS_MARKETERS.notification_method] || 'email').trim().toLowerCase()
    };

    // 2. لو اختار الإيميل مباشرة
    if (marketerObj.notificationMethod === 'email') {
      console.log(`📧 [notifyMarketer] ${cleanCode} اختار الإيميل`);
      const emailResult = await sendMarketerEmail(marketerObj, eventType, eventData);
      return { success: emailResult.success, channel: 'email', email: emailResult, fallbackUsed: false };
    }

    // 3. اختار تليجرام لكن غير مربوط → Fallback للإيميل
    if (!marketerObj.chatId) {
      console.log(`⚠️ [notifyMarketer] ${cleanCode} method=telegram لكن غير مربوط → Fallback`);
      const emailResult = await sendMarketerEmail(marketerObj, eventType, eventData);
      return {
        success: emailResult.success,
        channel: 'email',
        email: emailResult,
        fallbackUsed: true,
        fallbackReason: 'not_linked'
      };
    }

    // 4. عندنا chat_id → جرّب تليجرام
    const messageObj = buildMarketerMessage(eventType, {
      marketerName: marketerObj.name,
      marketerCode: marketerObj.code,
      ...eventData
    });

    const telegramOptions = {};
    if (messageObj.inlineKeyboard) {
      telegramOptions.inlineKeyboard = messageObj.inlineKeyboard;
    }

    const telegramResult = await sendTelegramToMarketer(marketerObj.chatId, messageObj.text, telegramOptions, 3);

    // 5. تليجرام نجح
    if (telegramResult.success) {
      console.log(`✅ [notifyMarketer] ${cleanCode} | ${eventType} | تليجرام محاولة ${telegramResult.attempts}`);
      return {
        success: true,
        channel: 'telegram',
        attempts: telegramResult.attempts,
        messageId: telegramResult.messageId,
        fallbackUsed: false
      };
    }

    // 6. تليجرام فشل → Fallback إيميل
    console.log(`❌ [notifyMarketer] ${cleanCode} | تليجرام فشل → Fallback`);

    const emailResult = await sendMarketerEmail(marketerObj, eventType, eventData);

    return {
      success: emailResult.success,
      channel: emailResult.success ? 'email' : 'none',
      telegram: telegramResult,
      email: emailResult,
      fallbackUsed: true,
      fallbackReason: 'telegram_failed'
    };

  } catch (err) {
    console.error(`❌ [notifyMarketer] ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  💰 calculateMarketerTotals — حساب earned / pending
// ============================================================
export async function calculateMarketerTotals(marketerCode) {
  const cleanCode = String(marketerCode || '').trim().toUpperCase();
  const result = {
    earned: 0,             // 💰 الإجمالي الخام (للعرض في البريد/التقارير)
    pending: 0,
    total: 0,
    sent: 0,               // ✅ المرسل فعلاً
    reserved: 0,           // 🔒 المحجوز (نشط)
    earnedAfterSent: 0,    // 💰 بعد خصم المرسل
    available: 0,          // ✅ المتاح للسحب
    childrenCount: 0,
    children: []
  };

  try {
    const { data: children, error } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select('*')
      .eq(COLS_CHILDREN.marketer_id, cleanCode);

    if (error || !children) return result;

    const now = Date.now();

    for (const child of children) {
      const status = String(child[COLS_CHILDREN.status] || '').trim().toLowerCase();
      if (status === 'deleted') continue;

      const originalPrice = parseFloat(child[COLS_CHILDREN.original_price]) || 0;
      const finalPrice = parseFloat(child[COLS_CHILDREN.plan_price]) || 0;
      const commission = Math.max(0, originalPrice - finalPrice);
      if (commission === 0) continue;

      const regRaw = child[COLS_CHILDREN.registration_date] || child[COLS_CHILDREN.timestamp];
      const regDate = regRaw ? new Date(regRaw).getTime() : now;
      const daysSince = (now - regDate) / (1000 * 60 * 60 * 24);
      const isEarned = daysSince >= 14;

      if (isEarned) result.earned += commission;
      else result.pending += commission;
      result.total += commission;
      result.childrenCount++;

      result.children.push({
        childID: String(child[COLS_CHILDREN.child_id] || '').trim(),
        childName: String(child[COLS_CHILDREN.child_name] || '').trim(),
        commission,
        isEarned,
        regDate,
        daysSince: Math.floor(daysSince)
      });
    }

    result.earned = Math.round(result.earned);
    result.pending = Math.round(result.pending);
    result.total = Math.round(result.total);

    // 🆕 حساب المرسل (sent) والمحجوز (نشط) بشكل منفصل
    try {
      const { data: sentReqs } = await supabaseAdmin
        .from(TABLES.MARKETER_WITHDRAW_REQUESTS)
        .select(COLS_WITHDRAW.amount)
        .eq(COLS_WITHDRAW.marketer_code, cleanCode)
        .eq(COLS_WITHDRAW.status, 'sent');

      (sentReqs || []).forEach(function(w) {
        const amt = parseInt(w[COLS_WITHDRAW.amount] || '0', 10);
        if (!isNaN(amt) && amt > 0) result.sent += amt;
      });

      const { data: activeReqs } = await supabaseAdmin
        .from(TABLES.MARKETER_WITHDRAW_REQUESTS)
        .select(COLS_WITHDRAW.amount)
        .eq(COLS_WITHDRAW.marketer_code, cleanCode)
        .in(COLS_WITHDRAW.status, ['submitted', 'under_review', 'sending']);

      (activeReqs || []).forEach(function(w) {
        const amt = parseInt(w[COLS_WITHDRAW.amount] || '0', 10);
        if (!isNaN(amt) && amt > 0) result.reserved += amt;
      });
    } catch (e) {
      console.warn(`⚠️ [calculateMarketerTotals] withdrawals:`, e.message);
    }

    // 💰 العمولات المستحقة بعد خصم المرسل
    result.earnedAfterSent = Math.max(0, result.earned - result.sent);
    // ✅ الرصيد المتاح
    result.available = Math.max(0, result.earnedAfterSent - result.reserved);

  } catch (err) {
    console.error(`❌ [calculateMarketerTotals] ${err.message}`);
  }

  return result;
}

// ============================================================
//  🔐 sendMarketerPasswordOTP — راوتر إرسال OTP بكلمة السر
//  - telegram + مربوط → sendViaTelegram
//  - email (أو telegram غير مربوط) → sendMarketerPasswordOTPEmail
// ============================================================
export async function sendMarketerPasswordOTP(marketer, otp, expiresMinutes) {
  try {
    const name = String(marketer.name || 'مسوق').trim();
    const code = String(marketer.code || '').trim().toUpperCase();
    const email = String(marketer.email || '').trim();
    const chatId = String(marketer.telegram_chat_id || '').trim();
    const method = String(marketer.notification_method || 'email').trim().toLowerCase();
    const minutes = expiresMinutes || 5;

    // 1. تليجرام
    if (method === 'telegram' && chatId) {
      const text =
        `🔐 <b>رمز تغيير كلمة السر</b>\n\n` +
        `مرحباً <b>${name}</b>،\n\n` +
        `لإتمام تغيير كلمة السر، أدخل الرمز التالي في لوحة التحكم:\n\n` +
        `<code style="font-size:22px; font-weight:900; letter-spacing:4px;">${otp}</code>\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n` +
        `⏱️ <b>صالح لمدة:</b> ${minutes} دقائق\n` +
        `⚠️ <b>لا تشارك الرمز مع أي شخص</b>\n\n` +
        `<i>إذا لم تطلب هذا التغيير، يرجى تجاهل الرسالة وتأمين حسابك.</i>`;

      const result = await sendViaTelegram(chatId, text);

      if (result.success) {
        console.log(`✅ [sendMarketerPasswordOTP] ${code} → telegram`);
        return { success: true, channel: 'telegram' };
      }

      // فشل تليجرام → fallback للإيميل
      console.warn(`⚠️ [sendMarketerPasswordOTP] ${code} telegram failed → fallback email`);
      if (!email) {
        return { success: false, channel: 'none', error: 'telegram_failed_no_email_fallback' };
      }
      // يكمل للإيميل
    }

    // 2. إيميل
    if (!email) {
      return { success: false, channel: 'none', error: 'no_email' };
    }

    const emailResult = await sendMarketerPasswordOTPEmail(email, name, code, otp, minutes);

    if (emailResult.success) {
      console.log(`✅ [sendMarketerPasswordOTP] ${code} → email`);
      return { success: true, channel: 'email' };
    }

    console.error(`❌ [sendMarketerPasswordOTP] ${code} email failed: ${emailResult.error}`);
    return { success: false, channel: 'none', error: emailResult.error || 'send_failed' };

  } catch (err) {
    console.error(`❌ [sendMarketerPasswordOTP] ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  🆕 buildWithdrawStatusMessage — بناء رسالة تليجرام لتغيير الحالة
// ============================================================
function buildWithdrawStatusMessage(status, data) {
  const divider = '━━━━━━━━━━━━━━━━━━━';

  const statusConfig = {
    submitted: { emoji: '📤', title: 'تم استلام طلب السحب' },
    sending:   { emoji: '💸', title: 'طلب السحب قيد الإرسال' },
    failed:    { emoji: '⚠️', title: 'فشل تحويل طلب السحب' },
    rejected:  { emoji: '❌', title: 'تم رفض طلب السحب' },
    cancelled: { emoji: '⚪', title: 'تم إلغاء طلب السحب' },
    sent:      { emoji: '✅', title: 'تم تحويل طلب السحب' }
  };

  const cfg = statusConfig[status] || { emoji: '📩', title: 'تحديث طلب السحب' };

  let text =
    `${cfg.emoji} <b>${cfg.title}</b>\n\n` +
    `${divider}\n\n` +
    `🔖 <b>رقم الطلب:</b> <code>${data.requestId}</code>\n` +
    `💰 <b>المبلغ:</b> ${data.amount} ج.م\n` +
    `💳 <b>الطريقة:</b> ${data.methodLabel}\n`;

  if ((status === 'rejected' || status === 'failed') && data.rejectionReason) {
    text +=
      `\n${divider}\n\n` +
      `📝 <b>${status === 'failed' ? 'سبب الفشل' : 'سبب الرفض'}:</b>\n${data.rejectionReason}\n`;
  } else if (status === 'cancelled' && data.cancellationReason) {
    text +=
      `\n${divider}\n\n` +
      `📝 <b>سبب الإلغاء:</b>\n${data.cancellationReason}\n`;
  } else if (status === 'sent') {
    if (data.screenshotUrl) {
      text +=
        `\n${divider}\n\n` +
        `📸 <b>سكرين شوت التحويل:</b>\n<a href="${data.screenshotUrl}">اضغط لعرض الصورة</a>\n`;
    }
    text +=
      `\n${divider}\n\n` +
      `<i>يرجى التحقق من استلام المبلغ في حسابك.</i>`;
  } else if (status === 'submitted') {
    text +=
      `\n${divider}\n\n` +
      `<i>سيتم مراجعة طلبك والتواصل معك قريباً.</i>`;
  } else if (status === 'sending') {
    text +=
      `\n${divider}\n\n` +
      `<i>جاري تحويل المبلغ إلى حسابك، يرجى الانتظار.</i>`;
  }

  return text;
}

// ============================================================
//  🆕 notifyMarketerWithdrawStatus — إشعار المسوق بتغيير حالة الطلب
//  - يقرأ قناة المسوق المختارة (telegram/email)
//  - fallback: telegram → email عند الفشل
//  - الحالات المدعومة: rejected, cancelled, sent فقط
// ============================================================
export async function notifyMarketerWithdrawStatus(params) {
  try {
    const cleanCode = String(params.marketerCode || '').trim().toUpperCase();
    const status = String(params.status || '').trim().toLowerCase();

    if (!cleanCode) return { success: false, error: 'marketer_code_missing' };
    if (!['submitted', 'sending', 'failed', 'rejected', 'cancelled', 'sent'].includes(status)) {
      return { success: false, error: 'unsupported_status' };
    }

    // 1. جيب المسوق
    const { data: marketer, error } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .select('code,name,email,telegram_chat_id,notification_method')
      .eq(COLS_MARKETERS.code, cleanCode)
      .maybeSingle();

    if (error || !marketer) {
      return { success: false, error: 'marketer_not_found' };
    }

    const marketerName = String(marketer[COLS_MARKETERS.name] || 'مسوق').trim();
    const email = String(marketer[COLS_MARKETERS.email] || '').trim();
    const chatId = String(marketer[COLS_MARKETERS.telegram_chat_id] || '').trim();
    const method = String(marketer[COLS_MARKETERS.notification_method] || 'email').trim().toLowerCase();

    const notifData = {
      requestId: String(params.requestId || '').trim(),
      amount: parseInt(params.amount || '0', 10),
      methodLabel: String(params.methodLabel || '').trim(),
      rejectionReason: params.rejectionReason || null,
      cancellationReason: params.cancellationReason || null,
      screenshotUrl: params.screenshotUrl || null
    };

    // 2. telegram (لو مختار ومربوط)
    if (method === 'telegram' && chatId) {
      const text = buildWithdrawStatusMessage(status, notifData);
      const result = await sendViaTelegram(chatId, text);

      if (result.success) {
        console.log(`✅ [notifyMarketerWithdrawStatus] ${cleanCode} | ${status} | telegram`);
        return { success: true, channel: 'telegram' };
      }

      console.warn(`⚠️ [notifyMarketerWithdrawStatus] ${cleanCode} telegram failed → fallback email`);
    }

    // 3. email
    if (!email) {
      return { success: false, channel: 'none', error: 'no_email' };
    }

    const emailResult = await sendWithdrawStatusEmail(email, marketerName, cleanCode, {
      ...notifData,
      status
    });

    if (emailResult.success) {
      console.log(`✅ [notifyMarketerWithdrawStatus] ${cleanCode} | ${status} | email`);
      return { success: true, channel: 'email' };
    }

    return { success: false, channel: 'none', error: emailResult.error || 'send_failed' };

  } catch (err) {
    console.error(`❌ [notifyMarketerWithdrawStatus] ${err.message}`);
    return { success: false, error: err.message };
  }
}