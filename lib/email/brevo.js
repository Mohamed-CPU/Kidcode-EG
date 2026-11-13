// ================================================================
//  lib/email/brevo.js — إرسال الإيميلات عبر Brevo API
//  - نسخة Node.js من sendEmailViaBrevo + buildEmailHtml + sendFamilyResetEmail
//  - تستخدم fetch مباشر (بدون مكتبات إضافية)
// ================================================================

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const PROJECT_NAME = 'KidCode-EG';
const ADMIN_EMAIL = 'info@kidcode-eg.com';
const SUPPORT_EMAIL = 'support@kidcode-eg.com';

// ============================================================
//  📧 بناء قالب الإيميل (RTL)
// ============================================================
export function buildEmailHtml(title, content, extraHtml = '', qrImageUrl = '', childIDForQR = '') {
  const qrSection = qrImageUrl ? `
    <div style="text-align:center; margin:20px 0;">
      <p style="font-weight:bold; color:#1A1A2E; margin-bottom:10px;">📱 رمز QR الخاص بطفلك:</p>
      <img src="${qrImageUrl}" alt="QR Code" style="max-width:220px; border-radius:12px; border:2px solid #22559F; padding:8px; background:white;">
      ${childIDForQR ? `
        <div style="margin-top:10px; text-align:center;">
          <p style="margin:0; font-size:2rem; font-weight:600; color:#22559F; direction:ltr; font-family: arial;">${childIDForQR}</p>
        </div>
      ` : ''}
    </div>
  ` : '';

  return `
    <html dir="rtl">
    <head><meta charset="UTF-8"></head>
    <body style="font-family: 'Segoe UI', Tahoma, Arial, sans-serif; line-height:1.8; direction:rtl; text-align:right; background:#f9f9f9; padding:20px;">
      <div style="max-width:550px; margin:auto; background:#ffffff; border:1px solid #ddd; border-radius:16px; padding:25px; box-shadow:0 4px 12px rgba(0,0,0,0.05);">
        <h2 style="color:#1a73e8; margin-top:0; text-align:center;">${title}</h2>
        <div style="background:#f8fafc; border-radius:12px; padding:15px; margin:15px 0;">${content}</div>
        ${qrSection}
        ${extraHtml}
        <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">
        <p style="font-size:0.8rem; color:#777; text-align:center;">© ${PROJECT_NAME}</p>
      </div>
    </body>
    </html>
  `;
}

// ============================================================
//  🎁 wrapBodyHtml — يلفّ المحتوى في القالب إن لم يكن HTML كاملًا
//  - إذا بدأ بـ <!DOCTYPE أو <html → يُستخدم كما هو
//  - وإلا → يُلَفّ في buildEmailHtml
// ============================================================
export function wrapBodyHtml(bodyHtml) {
  const str = String(bodyHtml || '').trim();
  if (!str) return buildEmailHtml('إشعار', '<p></p>');
  if (/^<!DOCTYPE/i.test(str) || /^<html/i.test(str)) {
    return str;
  }
  return buildEmailHtml('KidCode-EG', str);
}

// ============================================================
//  📤 إرسال الإيميل عبر Brevo
// ============================================================
export async function sendEmailViaBrevo(options) {
  try {
    // 1. اقرأ مفتاح API من Environment Variables
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      console.error('❌ [Brevo] BREVO_API_KEY غير موجود في Environment Variables');
      return { success: false, error: 'api_key_missing' };
    }

    // 2. تحقق من المدخلات
    if (!options || !options.to || !options.subject) {
      console.error('❌ [Brevo] بيانات ناقصة: to, subject مطلوبة');
      return { success: false, error: 'missing_required_fields' };
    }

    // 3. تطبيع المستلمين (دعم بريد واحد أو مصفوفة)
    let recipients = [];
    if (typeof options.to === 'string') {
      recipients = [{ email: options.to.trim() }];
    } else if (Array.isArray(options.to)) {
      recipients = options.to
        .map(r => (typeof r === 'string' ? { email: r.trim() } : r))
        .filter(r => r.email);
    } else {
      return { success: false, error: 'invalid_recipients' };
    }

    if (recipients.length === 0) {
      return { success: false, error: 'no_valid_recipients' };
    }

    // 4. جهّز الـ payload
    const senderEmail = options.senderEmail || 'no-reply@kidcode-eg.com';
    const senderName = options.senderName || PROJECT_NAME;
    const replyEmail = options.replyToEmail || 'support@kidcode-eg.com';
    const replyName = options.replyToName || 'KidCode Support';

    const payload = {
      sender: { name: senderName, email: senderEmail },
      to: recipients,
      replyTo: { name: replyName, email: replyEmail },
      subject: options.subject,
      htmlContent: options.htmlContent || '<p></p>'
    };

    if (options.textContent) {
      payload.textContent = options.textContent;
    }

    // ✅ 4.1 المرفقات (URLs — Brevo يجلبها من Cloudinary)
    if (Array.isArray(options.attachments) && options.attachments.length > 0) {
      const validAttachments = options.attachments
        .filter(a => a && typeof a.url === 'string' && a.url.startsWith('https://'))
        .map(a => ({
          url: a.url,
          name: String(a.name || 'file').substring(0, 250)
        }));

      if (validAttachments.length > 0) {
        payload.attachment = validAttachments;
      }
    }

    // 5. ابعت الطلب
    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'accept': 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const statusCode = response.status;
    const responseText = await response.text();

    // 6. حلّل الرد
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      result = { raw: responseText };
    }

    if (statusCode >= 200 && statusCode < 300) {
      console.log(`✅ [Brevo] إيميل اتبعت | المستلم: ${recipients.map(r => r.email).join(', ')} | messageId: ${result.messageId || 'N/A'}`);
      return {
        success: true,
        messageId: result.messageId || null,
        recipients: recipients.map(r => r.email),
        statusCode: statusCode
      };
    } else {
      console.error(`❌ [Brevo] فشل الإرسال | كود: ${statusCode} | تفاصيل: ${responseText}`);
      return {
        success: false,
        error: result.message || result.error || 'unknown_error',
        statusCode: statusCode,
        details: result
      };
    }
  } catch (err) {
    console.error(`❌ [Brevo] خطأ: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  🔐 إيميل إعادة تعيين كلمة السر (نفس قالب GAS)
// ============================================================
export async function sendFamilyResetEmail(toEmail, childID, resetLink, expiryMin) {
  try {
    const subject = '🔐 إعادة تعيين كلمة سر حسابك — KidCode-EG';

    // المحتوى الرئيسي
    const content = `
      <p style="margin:0 0 12px; font-size:1rem;">مرحباً،</p>
      <p style="margin:0 0 12px; color:#334155;">
        وصلنا طلب لإعادة تعيين كلمة سر الحساب الخاص بك:
      </p>

      <div style="background:#EFF6FF; border-right:4px solid #22559F; border-radius:10px; padding:12px 16px; margin:14px 0; text-align:center;">
        <p style="margin:0; font-size:0.85rem; color:#64748B;">كود الطفل</p>
        <p style="margin:4px 0 0; font-size:1.2rem; font-weight:900; color:#22559F; letter-spacing:1.5px; direction:ltr; font-family:'Courier New',monospace;">${childID}</p>
      </div>

      <p style="margin:14px 0 6px; color:#334155;">لتغيير كلمة السر، اضغط على الزر التالي:</p>
      <p style="text-align:center; margin:20px 0;">
        <a href="${resetLink}"
           style="display:inline-block; background:linear-gradient(135deg, #22559F, #1A437C); color:#ffffff; padding:14px 30px; text-decoration:none; border-radius:30px; font-weight:900; font-size:0.85rem;">
          🔐 إعادة تعيين كلمة السر
        </a>
      </p>

      <p style="color:#94A3B8; font-size:0.85rem; text-align:center; margin:12px 0 0;">
        ⏱️ الرابط صالح لمدة ${expiryMin} دقيقة فقط
      </p>
    `;

    // تحذير أمني
    const extraHtml = `
      <div style="background:#FEF2F2; border-right:4px solid #DC2626; border-radius:12px; padding:16px 18px; margin:18px 0;">
        <p style="margin:0 0 8px; color:#991B1B; font-weight:900; font-size:1rem;">
          ⚠️ تحذير أمني
        </p>
        <p style="margin:0 0 12px; color:#7F1D1D; font-size:0.9rem; line-height:1.7;">
          إذا لم تكن أنت من طلب إعادة تعيين كلمة السر، فهذا يعني أن شخصاً آخر لديه وصول إلى بريدك الإلكتروني ويحاول الوصول إلى حساب طفلك.
        </p>
        <p style="margin:0; color:#7F1D1D; font-size:0.85rem; line-height:1.7; text-align:center;">
          للمساعدة، تواصل معنا عبر البريد:<br>
          <a href="mailto:support@kidcode-eg.com?subject=${encodeURIComponent('🚨 تنبيه أمني - حساب طفلي ' + childID)}"
             style="color:#22559F; font-weight:700; text-decoration:none;">
            support@kidcode-eg.com
          </a>
        </p>
      </div>

      <hr style="border:0; border-top:1px solid #eee; margin:18px 0;">
      <p style="font-size:0.75rem; color:#94A3B8; text-align:center; margin:0;">
        هذا البريد مرسل تلقائياً من KidCode-EG. يرجى عدم الرد عليه.
      </p>
    `;

    const htmlBody = buildEmailHtml('🔐 إعادة تعيين كلمة السر', content, extraHtml);

    return await sendEmailViaBrevo({
      to: toEmail,
      subject: subject,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'support@kidcode-eg.com',
      replyToName: PROJECT_NAME + ' - Support'
    });
  } catch (e) {
    console.error('❌ [sendFamilyResetEmail]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  📧 sendScanAlertEmail — تنبيه مسح QR
// ============================================================
export async function sendScanAlertEmail(parentEmail, childID, childName, scanTime) {
  try {
    if (!parentEmail) {
      return { success: false, error: 'no_email' };
    }

    const content = `
      <p>تم مسح رمز QR الخاص بطفلك <strong>${childName}</strong> (<strong>${childID}</strong>) في الساعة <strong>${scanTime}</strong>.</p>
      <p>إذا قام الشخص الذي وجد الطفل بمشاركة موقعه، ستتلقى بريداً آخر يحتوي على رابط الموقع.</p>
    `;

    const htmlBody = buildEmailHtml('تنبيه هام', content);

    const result = await sendEmailViaBrevo({
      to: parentEmail,
      subject: `تنبيه: تم مسح رمز الطفل ${childName} - KidCode-EG`,
      htmlContent: htmlBody,
      senderEmail: 'info@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'info@kidcode-eg.com',
      replyToName: PROJECT_NAME + ' - Info'
    });

    if (result.success) {
      console.log(`📧 [sendScanAlertEmail] تم الإرسال إلى ${parentEmail} للطفل ${childID}`);
    } else {
      console.error(`❌ [sendScanAlertEmail] فشل: ${result.error}`);
    }

    return result;

  } catch (e) {
    console.error(`❌ [sendScanAlertEmail] ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  📧 sendLocationEmail — إيميل الموقع
// ============================================================
export async function sendLocationEmail(parentEmail, childID, childName, locationLink, scanTime, addressText, clientIP, isFollowup) {
  try {
    if (!parentEmail) return { success: false, error: 'no_email' };

    const addressHtml = addressText
      ? `<p><strong>العنوان التقريبي:</strong> ${addressText}</p>`
      : '';

    const headerText = isFollowup
      ? '📍 متابعة تلقائية — تحديث موقع الطفل'
      : '📍 تم تحديد موقع طفلك';

    const subjectText = isFollowup
      ? `متابعة: تحديث موقع الطفل ${childName} - KidCode-EG`
      : `تم تحديد موقع الطفل ${childName} - KidCode-EG`;

    const followupBanner = isFollowup
      ? `<div style="background:#EFF6FF; border-right:4px solid #22559F; padding:12px 16px; border-radius:12px; margin-bottom:16px;">
           <strong style="color:#22559F;">🔄 متابعة تلقائية</strong>
           <p style="margin:6px 0 0; font-size:0.9rem; color:#475569;">
             هذا تحديث تلقائي لموقع الطفل خلال نفس الجلسة.
           </p>
         </div>`
      : '';

    const content = `
      ${followupBanner}
      <p>تم مشاركة الموقع التالي للطفل <strong>${childName}</strong> (<strong>${childID}</strong>) في الساعة <strong>${scanTime}</strong>.</p>
      ${addressHtml}
      <p style="margin:20px 0; text-align:center;">
        <a href="${locationLink}"
           target="_blank"
           style="display:inline-block; background-color:#1a73e8; color:white; padding:12px 24px; text-decoration:none; border-radius:30px; font-weight:bold;">
          فتح الموقع في خرائط Google
        </a>
      </p>
    `;

    const htmlBody = buildEmailHtml(headerText, content);

    const result = await sendEmailViaBrevo({
      to: parentEmail,
      subject: subjectText,
      htmlContent: htmlBody,
      senderEmail: 'info@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'info@kidcode-eg.com',
      replyToName: PROJECT_NAME + ' - Info'
    });

    if (result.success) {
      console.log(`📧 [sendLocationEmail] [${isFollowup ? 'متابعة' : 'أول'}] تم الإرسال إلى ${parentEmail} للطفل ${childID}`);
    } else {
      console.error(`❌ [sendLocationEmail] فشل: ${result.error}`);
    }

    return result;

  } catch (e) {
    console.error(`❌ [sendLocationEmail] ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🔔 إيميل إشعار تغيير بصمة الوجه
//  changeType: 'add' | 'update' | 'delete'
// ============================================================
export async function sendFaceDataChangeEmail(child, changeType, details) {
  try {
    if (!child) {
      return { success: false, error: 'child_not_found' };
    }

    const recipient = String(child.email_code || '').trim();
    const childName = String(child.child_name || 'الطفل').trim();
    const childID = String(child.child_id || '').trim();

    // توقيت مصر
    const now = new Date().toLocaleString('sv-SE', {
      timeZone: 'Africa/Cairo',
      hour12: true
    });

    if (!recipient) {
      console.log(`⚠️ [sendFaceDataChangeEmail] لا يوجد بريد للطفل ${childID}`);
      return { success: false, error: 'no_parent_email' };
    }

    let subject = '';
    let content = '';

    switch (changeType) {
      case 'add':
        subject = `تم إضافة بيانات التحقق الرقمي للطفل ${childName}`;
        content = `
          <p>تم إضافة بيانات الوجه (التحقق الرقمي) للطفل <strong>${childName}</strong> (${childID}) بنجاح.</p>
          <p><strong>تاريخ الإضافة:</strong> ${now}</p>
          <p>يمكنك الآن استخدام التحقق الرقمي بالوجه عند العثور على طفلك.</p>
        `;
        break;

      case 'update':
        subject = `تم تحديث بيانات التحقق الرقمي للطفل ${childName}`;
        content = `
          <p>تم تحديث بيانات الوجه (التحقق الرقمي) للطفل <strong>${childName}</strong> (${childID}) بنجاح.</p>
          <p><strong>تاريخ التحديث:</strong> ${now}</p>
          <p>تم استبدال الصورة القديمة بالصورة الجديدة للتحقق الرقمي.</p>
        `;
        break;

      case 'delete':
        subject = `تم حذف بيانات التحقق الرقمي للطفل ${childName}`;
        content = `
          <p>تم حذف بيانات الوجه (التحقق الرقمي) للطفل <strong>${childName}</strong> (${childID}) نهائياً.</p>
          <p><strong>تاريخ الحذف:</strong> ${now}</p>
          <p>لن يكون التحقق الرقمي بالوجه متاحاً لهذا الطفل حتى يتم إعادة إضافة البيانات.</p>
          <p style="color:#e53e3e; font-weight:bold;">إذا لم تقم أنت بهذا الحذف، يرجى التواصل مع الدعم فوراً عبر واتساب.</p>
        `;
        break;

      default:
        return { success: false, error: 'invalid_change_type' };
    }

    if (details) {
      content += `<p><strong>ملاحظات إضافية:</strong> ${details}</p>`;
    }

    content += `
      <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">
      <p style="text-align:center;">
        <a href="https://www.kidcode-eg.com/family-dashboard.html#security"
           target="_blank" style="display:inline-block; background-color:#1a73e8; color:white; padding:10px 24px; text-decoration:none; border-radius:30px; font-weight:bold;">
          الذهاب إلى لوحة تحكم الأسرة
        </a>
      </p>
      <p style="font-size:0.8rem; color:#94a3b8; text-align:center;">
        هذا البريد مرسل تلقائياً من نظام KidCode-EG. يرجى عدم الرد على هذا البريد.
      </p>
    `;

    const htmlBody = buildEmailHtml(subject, content);

    const result = await sendEmailViaBrevo({
      to: recipient,
      subject: subject,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'support@kidcode-eg.com',
      replyToName: PROJECT_NAME + ' - Support'
    });

    if (result.success) {
      console.log(`📧 [sendFaceDataChangeEmail] تم الإرسال إلى ${recipient} للطفل ${childID} (${changeType})`);
    } else {
      console.error(`❌ [sendFaceDataChangeEmail] فشل: ${result.error}`);
    }

    return result;

  } catch (err) {
    console.error(`❌ [sendFaceDataChangeEmail] ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  📧 sendChildUpdateEmail — إيميل إشعار تعديل بيانات الطفل
// ============================================================
export async function sendChildUpdateEmail(parentEmail, childName, childID, changedFields) {
  try {
    if (!parentEmail) {
      return { success: false, error: 'no_email' };
    }

    const fieldsStr = Array.isArray(changedFields) ? changedFields.join('، ') : String(changedFields || '');
    const subject = `تم تحديث بيانات الطفل ${childName} - KidCode-EG`;

    const content = `
      <p>تم تحديث بيانات الطفل <strong>${childName}</strong> (${childID}) بنجاح.</p>
      <p><strong>✏️ الحقول التي تم تعديلها:</strong> ${fieldsStr}</p>
      <p style="color:#e53e3e; font-weight:bold;">⚠️ إذا لم تقم أنت بهذا التعديل، يرجى التواصل مع الدعم فوراً عبر واتساب.</p>
      <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">
      <p style="text-align:center;">
        <a href="https://wa.me/201004135973?text=${encodeURIComponent('السلام عليكم، أريد الاستفسار عن تعديل غير مصرح به للطفل ' + childID)}"
           target="_blank"
           style="display:inline-block; background-color:#25D366; color:white; padding:10px 20px; text-decoration:none; border-radius:30px; font-weight:bold;">
          الإبلاغ عن تعديل غير مصرح به
        </a>
      </p>
    `;

    const htmlBody = buildEmailHtml('تنبيه: تحديث بيانات الطفل', content);

    const result = await sendEmailViaBrevo({
      to: parentEmail,
      subject: subject,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'info@kidcode-eg.com',
      replyToName: PROJECT_NAME + ' - Info'
    });

    if (result.success) {
      console.log(`📧 [sendChildUpdateEmail] تم الإرسال إلى ${parentEmail}`);
    } else {
      console.error(`❌ [sendChildUpdateEmail] فشل: ${result.error}`);
    }

    return result;

  } catch (e) {
    console.error(`❌ [sendChildUpdateEmail] ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  📧 sendMarketerWelcomeEmail — إيميل ترحيب المسوق
// ============================================================
export async function sendMarketerWelcomeEmail(toEmail, name, code, notificationMethod) {
  try {
    if (!toEmail) return { success: false, error: 'no_email' };

    const methodLabel = notificationMethod === 'telegram'
      ? '📱 تليجرام'
      : '📧 البريد الإلكتروني';

    const content = `
      <p>مرحباً <strong>${name}</strong>،</p>
      <p>تم إنشاء حسابك كمسوق في <strong>KidCode-EG</strong> بنجاح.</p>

      <div style="background:#f8fafc; border-radius:12px; padding:15px; margin:15px 0; border-right:4px solid #39a66f;">
        <p style="margin:6px 0;"><strong>🎫 كود المسوق الخاص بك:</strong></p>
        <p style="font-size:1.3rem; font-weight:900; color:#22559f; text-align:center; margin:10px 0; font-family:'Courier New',monospace; letter-spacing:2px;">${code}</p>
      </div>

      <div style="background:#f0f9ff; border-radius:12px; padding:14px 18px; margin:15px 0; border-right:4px solid #0088CC;">
        <p style="margin:0; font-size:0.9rem;">
          <strong>🔔 طريقة الإشعارات المختارة:</strong><br>
          ${methodLabel}
        </p>
        ${notificationMethod === 'telegram' ? `
          <p style="margin:10px 0 0; font-size:0.85rem; color:#0c4a6e;">
            ⚠️ لم يتم تفعيل تليجرام بعد. قم بالربط من <a href="https://www.kidcode-eg.com/marketer-dashboard">لوحة التحكم</a>.
          </p>
        ` : ''}
      </div>

      <p>يمكنك استخدام هذا الكود لتسجيل الدخول إلى <a href="https://www.kidcode-eg.com/marketer-login">لوحة تحكم المسوقين</a> ومتابعة عمولاتك.</p>

      <hr style="border:0; border-top:1px solid #eee; margin:15px 0;">
      <p style="font-size:0.8rem; color:#94a3b8; text-align:center;">
        هذا البريد مرسل تلقائياً من نظام KidCode-EG.
      </p>
    `;

    const htmlBody = buildEmailHtml('مرحباً بك في برنامج الشركاء - KidCode-EG', content);

    const result = await sendEmailViaBrevo({
      to: toEmail,
      subject: 'مرحباً بك في برنامج شركاء KidCode-eg',
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'sales@kidcode-eg.com',
      replyToName: PROJECT_NAME + ' - Sales'
    });

    if (result.success) {
      console.log(`📧 [sendMarketerWelcomeEmail] تم الإرسال إلى ${toEmail} (${code})`);
    }
    return result;

  } catch (e) {
    console.error(`❌ [sendMarketerWelcomeEmail] ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  📧 sendMarketerResetEmail — إيميل إعادة تعيين كلمة سر المسوق
// ============================================================
export async function sendMarketerResetEmail(toEmail, name, code, resetLink) {
  try {
    if (!toEmail) return { success: false, error: 'no_email' };

    const content = `
      <p>مرحباً <strong>${name}</strong>،</p>
      <p>لقد طلبت إعادة تعيين كلمة السر لحساب المسوق الخاص بك (<strong>${code}</strong>).</p>
      <p>لإعادة التعيين، يرجى الضغط على الرابط التالي (صالح لمدة ساعة واحدة):</p>
      <p style="text-align:center; margin:20px 0;">
        <a href="${resetLink}" target="_blank" style="display:inline-block; background-color:#22559f; color:white; padding:12px 28px; border-radius:40px; text-decoration:none; font-weight:bold;">إعادة تعيين كلمة السر</a>
      </p>
      <p>إذا لم تطلب هذا، يرجى التواصل معنا فورًا.</p>
      <hr style="border:0; border-top:1px solid #eee; margin:15px 0;">
      <p style="font-size:0.8rem; color:#94a3b8; text-align:center;">© KidCode-EG 2026</p>
    `;

    const htmlBody = buildEmailHtml('إعادة تعيين كلمة السر', content);

    const result = await sendEmailViaBrevo({
      to: toEmail,
      subject: 'إعادة تعيين كلمة السر - KidCode-eg',
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'support@kidcode-eg.com',
      replyToName: PROJECT_NAME + ' - Support'
    });

    if (result.success) {
      console.log(`📧 [sendMarketerResetEmail] تم الإرسال إلى ${toEmail} (${code})`);
    }
    return result;

  } catch (e) {
    console.error(`❌ [sendMarketerResetEmail] ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🚀 sendDemoWelcomeEmail — إيميل ترحيب بالتجربة
// ============================================================
export async function sendDemoWelcomeEmail(email, name) {
  if (!email) return { success: false, error: 'no_email' };

  try {
    const content = `
      <p>مرحباً <strong>${name || 'عميلنا العزيز'}</strong>،</p>
      <p>شكراً لتسجيلك في التجربة التفاعلية لنظام <strong>${PROJECT_NAME}</strong>.</p>
      <p>أنت الآن في جلسة تجريبية تحاكي العثور على طفل. يمكنك:</p>
      <ul>
        <li>استقبال إشعارات مسح QR.</li>
        <li>مشاركة الموقع الحالي.</li>
        <li>التواصل عبر واتساب بالأرقام المسجلة.</li>
      </ul>
      <p style="color:#e53e3e;"><strong>ملاحظة:</strong> هذه الجلسة تنتهي تلقائياً بعد 5 دقائق.</p>
    `;

    const htmlBody = buildEmailHtml(`مرحباً بك في تجربة ${PROJECT_NAME}`, content);

    const result = await sendEmailViaBrevo({
      to: email,
      subject: `مرحباً بك في تجربة - ${PROJECT_NAME}`,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'support@kidcode-eg.com',
      replyToName: `${PROJECT_NAME} - Support`
    });

    if (result.success) {
      console.log(`📧 [sendDemoWelcomeEmail] تم الإرسال إلى ${email}`);
    } else {
      console.error(`❌ [sendDemoWelcomeEmail] فشل: ${result.error}`);
    }

    return result;

  } catch (e) {
    console.error(`❌ [sendDemoWelcomeEmail] ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  📧 sendTelegramReminderEmail — إيميل تذكير بربط تليجرام
//  (للمسوقين اللي اختاروا telegram لكن لسه ما ربطوش)
// ============================================================
export async function sendTelegramReminderEmail(toEmail, name, code, reminderNumber) {
  try {
    if (!toEmail) return { success: false, error: 'no_email' };

    const subject = `⏰ تذكير: تفعيل الإشعارات الفورية لحسابك كمسوق — ${PROJECT_NAME}`;

    const content = `
      <p style="font-size:1.05rem; margin:0 0 10px;">مرحباً <strong>${name || 'عزيزنا'}</strong>،</p>
      <p style="margin:0 0 16px; color:#475569; line-height:1.85;">
        نود تذكيرك بأن حسابك كمسوق في <strong>${PROJECT_NAME}</strong> مُعد لاستقبال الإشعارات الفورية عبر <strong>تليجرام</strong>،
        إلا أنه لم يتم تفعيل هذه الخدمة حتى الآن.
      </p>

      <div style="background:#f0f9ff; border-right:4px solid #0088CC; border-radius:12px; padding:16px 20px; margin:18px 0;">
        <p style="margin:0 0 10px; color:#0c4a6e; font-weight:800; font-size:1rem;">
          📌 مزايا تفعيل الإشعارات عبر تليجرام:
        </p>
        <ul style="margin:0; padding-right:20px; color:#0c4a6e; font-size:0.95rem; line-height:1.9;">
          <li>استلام الإشعارات لحظياً دون أي تأخير</li>
          <li>متابعة مباشرة على هاتفك المحمول</li>
          <li>تجنّب تأخّر الرسائل في مجلد البريد غير المرغوب فيه</li>
        </ul>
      </div>

      <hr style="border:0; border-top:1px solid #e2e8f0; margin:20px 0;">

      <p style="margin:0 0 16px; color:#1A1A2E; line-height:1.85;">
        لتفعيل الخدمة، يُرجى الدخول إلى لوحة التحكم واختيار <strong>"ربط تليجرام"</strong> من صفحة الإشعارات.
      </p>
    `;

    const extraHtml = `
      <p style="text-align:center; margin:20px 0;">
        <a href="https://www.kidcode-eg.com/marketer-dashboard?open=notifications"
           style="display:inline-block; background:linear-gradient(135deg, #22559F, #1A437C); color:white; padding:14px 32px; text-decoration:none; border-radius:30px; font-weight:bold; font-size:0.95rem;">
          🔗 تفعيل الإشعارات الفورية
        </a>
      </p>

      <hr style="border:0; border-top:1px solid #e2e8f0; margin:20px 0;">

      <div style="background:#F8FAFC; border-radius:12px; padding:14px 18px; text-align:center;">
        <p style="margin:0; font-size:0.85rem; color:#64748B;">كودك كمسوق</p>
        <p style="margin:6px 0 0; font-size:1.3rem; font-weight:900; color:#22559F; direction:ltr; letter-spacing:2px; font-family:'Courier New',monospace;">${code}</p>
      </div>

      <p style="font-size:0.85rem; color:#94a3b8; text-align:center; margin:18px 0 0;">
        في حال احتجت إلى أي مساعدة، فريق الدعم في خدمتك.
      </p>
    `;

    const htmlBody = buildEmailHtml(
      `تفعيل الإشعارات الفورية عبر تليجرام`,
      content,
      extraHtml
    );

    const result = await sendEmailViaBrevo({
      to: toEmail,
      subject: subject,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'sales@kidcode-eg.com',
      replyToName: `${PROJECT_NAME} - Sales`
    });

    if (result.success) {
      console.log(`📧 [sendTelegramReminderEmail] ${code} (#${reminderNumber}) → ${toEmail}`);
    } else {
      console.error(`❌ [sendTelegramReminderEmail] ${code} فشل: ${result.error}`);
    }

    return result;

  } catch (e) {
    console.error(`❌ [sendTelegramReminderEmail] ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  📊 sendFamilyWeeklyReport — التقرير الأسبوعي للأسرة
// ============================================================
export async function sendFamilyWeeklyReport(data) {
  try {
    const {
      email, childName, childID, plan, totalScans,
      weeklyScans, daysRemaining, expiryStatus
    } = data;

    if (!email) return { success: false, error: 'no_email' };

    const subject = `التقرير الأسبوعي لنشاط رمز ${childName} - ${PROJECT_NAME}`;

    const content = `
      <p style="font-size:1.05rem; margin:0 0 10px;">مرحباً،</p>
      <p style="margin:0 0 16px; color:#475569;">
        هذا هو التقرير الأسبوعي لنشاط رمز QR الخاص بطفلك
        <strong>${childName}</strong> (${childID}).
      </p>

      <div style="background:#f8fafc; border-radius:12px; padding:15px 18px; margin:15px 0; border-right:4px solid #22559F;">
        <p style="margin:6px 0;"><strong>عدد مرات المسح هذا الأسبوع:</strong> ${weeklyScans}</p>
        <p style="margin:6px 0; color:#94a3b8; font-size:0.85rem;">
          (إجمالي عدد المسحات الكلي: ${totalScans})
        </p>
        <p style="margin:6px 0;"><strong>الخطة الحالية:</strong> ${plan}</p>
        <p style="margin:6px 0;"><strong>المدة المتبقية:</strong> ${daysRemaining}</p>
        <p style="margin:6px 0;"><strong>حالة الاشتراك:</strong> ${expiryStatus}</p>
      </div>
    `;

    const extraHtml = `
      <hr style="border:0; border-top:1px solid #e2e8f0; margin:20px 0;">
      <p style="text-align:center; margin:16px 0;">
        <a href="https://www.kidcode-eg.com/family-dashboard"
           style="display:inline-block; background:linear-gradient(135deg, #22559F, #1A437C); color:white; padding:12px 28px; text-decoration:none; border-radius:30px; font-weight:bold; font-size:0.95rem;">
          📊 فتح لوحة التحكم
        </a>
      </p>
      <p style="text-align:center; font-size:0.85rem; color:#64748b;">
        يمكنك من خلال لوحة التحكم تحديث بيانات طفلك أو إدارة اشتراكك.
      </p>
    `;

    const htmlBody = buildEmailHtml(
      `التقرير الأسبوعي - ${PROJECT_NAME}`,
      content,
      extraHtml
    );

    const result = await sendEmailViaBrevo({
      to: email,
      subject,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'info@kidcode-eg.com',
      replyToName: `${PROJECT_NAME} - Info`
    });

    if (result.success) {
      console.log(`📧 [sendFamilyWeeklyReport] ${childID} → ${email}`);
    }

    return result;

  } catch (e) {
    console.error(`❌ [sendFamilyWeeklyReport] ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🎁 buildClientWelcomeContent — محتوى بريد الترحيب بالعميل
//  (منقولة من code.gs)
// ============================================================
export function buildClientWelcomeContent(childID, status = 'pending', paymentStatus = 'pending') {
  const isActive = status === 'active';
  const isFree = paymentStatus === 'free';

  let content = '';

  if (isActive) {
    content = `
      <p><strong>رقم معرّف الطفل:</strong> ${childID}</p>
      <p style="color:#166534; background:#E8F5EE; border-right:4px solid #10B981; border-radius:10px; padding:12px 16px; margin:14px 0;">
        <strong>✅ الحساب نشط الآن.</strong>
      </p>
      ${isFree ? `
        <div style="background:#FEF3C7; border-right:4px solid #F59E0B; border-radius:10px; padding:14px 16px; margin:14px 0;">
          <p style="margin:0; color:#92400E; font-weight:700; font-size:0.95rem; line-height:1.75;">
            ⚠️ <strong>تنبيه:</strong> هذا التفعيل خاص بالخطة التجريبية (عرض الإطلاق) ومدته <strong>شهر واحد فقط</strong> من تاريخ التفعيل.
          </p>
        </div>
      ` : ''}
    `;
  } else {
    content = `
      <p>تم استلام طلب تسجيل طفلك بنجاح.</p>
      <p><strong>رقم معرّف الطفل:</strong> ${childID}</p>
      <p style="color:#92400E; background:#FEF3C7; border-right:4px solid #F59E0B; border-radius:10px; padding:12px 16px; margin:14px 0;">
        <strong>⏳ الحساب قيد المراجعة.</strong> سيتم تفعيل حسابك خلال <strong> 24 ساعة</strong> بعد التحقق من الدفع.
      </p>
    `;
  }

  const extraHtml = `
    <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">

    <p style="text-align:center; color:#475569; font-size:0.95rem; margin:12px 0 14px; line-height:1.75;">
      يمكنك متابعة بيانات طفلك وإدارة الاشتراك من خلال لوحة تحكم الأسرة:
    </p>
    <p style="text-align:center; margin:0 0 8px;">
      <a href="https://www.kidcode-eg.com/family-login"
         target="_blank"
         style="display:inline-block; background:linear-gradient(135deg, #22559F, #1A437C); color:#FFFFFF; padding:14px 32px; text-decoration:none; border-radius:30px; font-weight:900; font-size:0.95rem;">
        📊 لوحة تحكم الأسرة
      </a>
    </p>

    <hr style="border:0; border-top:1px solid #eee; margin:22px 0;">

    <p style="text-align:center; font-weight:bold; color:#1A1A2E; font-size:0.95rem; margin:0 0 12px;">
      لأي استفسار أو تعديل، يمكنك التواصل معنا:
    </p>
    <p style="text-align:center; margin:0;">
      <a href="mailto:info@kidcode-eg.com?subject=${encodeURIComponent('استفسار بخصوص الطفل ' + childID)}"
         style="display:inline-block; background-color:#22559f; color:white; padding:12px 28px; text-decoration:none; border-radius:30px; font-weight:bold; font-size:0.9rem;">
        ✉️ تواصل عبر البريد الإلكتروني
      </a>
    </p>
  `;

  return { content, extraHtml };
}

export async function sendClientEmail(email, childID, childLink, qrCodeId, status = 'pending', paymentStatus = 'pending') {
  if (!email) return { success: false, error: 'no_email' };
  try {
    const qrImageUrl = qrCodeId
      ? (qrCodeId.startsWith('http') ? qrCodeId : `https://drive.google.com/thumbnail?id=${qrCodeId}&sz=s800`)
      : '';

    const isActive = status === 'active';

    const { content, extraHtml } = buildClientWelcomeContent(childID, status, paymentStatus);

    const emailTitle = isActive
      ? `🎉 تم تفعيل حساب طفلك بنجاح - ${PROJECT_NAME}`
      : `أهلاً بك في ${PROJECT_NAME}`;

    const subject = isActive
      ? `🎉 تم تفعيل حساب طفلك بنجاح - ${PROJECT_NAME}`
      : `استلام طلب تسجيل طفلك - ${PROJECT_NAME}`;

    const htmlBody = buildEmailHtml(emailTitle, content, extraHtml, qrImageUrl, childID);

    const result = await sendEmailViaBrevo({
      to: email,
      subject: subject,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'info@kidcode-eg.com',
      replyToName: `${PROJECT_NAME} - Info`
    });

    if (result.success) {
      console.log(`📧 [sendClientEmail] ${isActive ? 'تفعيل' : 'استلام طلب'} → ${email} | ${childID} | messageId: ${result.messageId}`);
    } else {
      console.error(`❌ [sendClientEmail] فشل → ${email} | ${childID} | error: ${result.error}`);
    }

    return result;

  } catch (e) {
    console.error(`❌ [sendClientEmail] استثناء: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  📧 sendAdminEmail — إشعار الأدمن بتسجيل جديد
//  (منقولة من code.gs)
// ============================================================
export async function sendAdminEmail(data, qrCodeId) {
  try {
    const qrImageUrl = qrCodeId
      ? (qrCodeId.startsWith('http') ? qrCodeId : `https://drive.google.com/thumbnail?id=${qrCodeId}&sz=s800`)
      : '';

    const content = `
      <p style="margin:5px 0;"><strong>رقم الطفل:</strong> ${data.childID}</p>
      <p style="margin:5px 0;"><strong>الاسم:</strong> ${data.childName || '-'}</p>
      <p style="margin:5px 0;"><strong>الخطة:</strong> ${data.plan}</p>
      <p style="margin:5px 0;"><strong>السعر:</strong> ${data.planPrice}</p>
      <p style="margin:5px 0;"><strong>هاتف الأب:</strong> ${data.fatherPhone || '-'}</p>
      <p style="margin:5px 0;"><strong>هاتف الأم:</strong> ${data.motherPhone || '-'}</p>
    `;

    const htmlBody = buildEmailHtml(
      `تم تسجيل طفل جديد في ${PROJECT_NAME}`,
      content,
      '',
      qrImageUrl
    );

    const result = await sendEmailViaBrevo({
      to: ADMIN_EMAIL,
      subject: `تسجيل جديد - ${PROJECT_NAME}`,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'info@kidcode-eg.com',
      replyToName: `${PROJECT_NAME} - Info`
    });

    if (result.success) {
      console.log(`📧 [sendAdminEmail] تم إرسال إشعار الأدمن للطفل ${data.childID} | messageId: ${result.messageId}`);
    } else {
      console.error(`❌ [sendAdminEmail] فشل إشعار الأدمن للطفل ${data.childID} | error: ${result.error}`);
    }

    return result;

  } catch (e) {
    console.error(`❌ [sendAdminEmail] استثناء: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  📬 sendContactAdminEmail — إشعار الأدمن برسالة تواصل جديدة
// ============================================================
export async function sendContactAdminEmail(data) {
  try {
    const { submissionId, name, email, phone, subject, message, now } = data;

    const content = `
      <p style="font-size:1.05rem; margin:0 0 14px;">📬 <strong>رسالة جديدة من نموذج التواصل</strong></p>
      <div style="background:#F8FAFC; border-radius:12px; padding:16px; margin:16px 0; border-right:4px solid #22559F;">
        <p style="margin:6px 0;"><strong>📋 رقم الرسالة:</strong> <code>${submissionId}</code></p>
        <p style="margin:6px 0;"><strong>👤 الاسم:</strong> ${name}</p>
        <p style="margin:6px 0;"><strong>📧 البريد:</strong> <a href="mailto:${email}">${email}</a></p>
        ${phone ? `<p style="margin:6px 0;"><strong>📱 الهاتف:</strong> <span dir="ltr">${phone}</span></p>` : ''}
        <p style="margin:6px 0;"><strong>📌 الموضوع:</strong> ${subject}</p>
        <p style="margin:6px 0;"><strong>🕒 التوقيت:</strong> ${now}</p>
      </div>
      <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:12px; padding:16px; margin:16px 0;">
        <p style="margin:0 0 8px; color:#64748B; font-size:0.85rem; font-weight:700;">📝 نص الرسالة:</p>
        <div style="white-space:pre-wrap; line-height:1.8; color:#1E293B;">${message}</div>
      </div>
    `;

    const extraHtml = `
      <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">
      <p style="text-align:center;">
        <a href="mailto:${email}?subject=${encodeURIComponent('رد على: ' + subject)}"
           style="display:inline-block; background:#22559F; color:white; padding:12px 24px; text-decoration:none; border-radius:30px; font-weight:bold;">
          ✉️ الرد على ${name}
        </a>
      </p>
    `;

    const htmlBody = buildEmailHtml(
      `📬 رسالة جديدة - ${submissionId}`,
      content,
      extraHtml
    );

    return await sendEmailViaBrevo({
      to: 'info@kidcode-eg.com',
      subject: `📬 [${PROJECT_NAME}] ${subject} - من ${name}`,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: email,
      replyToName: name
    });

  } catch (e) {
    console.error('❌ [sendContactAdminEmail]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  📬 sendContactUserEmail — Auto-reply لمستخدم نموذج التواصل
// ============================================================
export async function sendContactUserEmail(data) {
  try {
    const { email, name, submissionId, subject, now } = data;

    const content = `
      <p>مرحباً <strong>${name}</strong>،</p>
      <p>شكراً لتواصلك معنا! تم استلام رسالتك بنجاح.</p>
      <div style="background:#E8F5EE; border-radius:12px; padding:14px 16px; margin:16px 0; border-right:4px solid #10B981;">
        <p style="margin:0; font-size:0.9rem;">
          <strong>📋 رقم مرجعي:</strong> <code>${submissionId}</code><br>
          <span style="font-size:0.85rem; color:#166534;">احتفظ بهذا الرقم للمتابعة</span>
        </p>
      </div>
      <p><strong>📌 تفاصيل رسالتك:</strong></p>
      <div style="background:#F8FAFC; border-radius:12px; padding:14px 16px; margin:12px 0;">
        <p style="margin:4px 0; font-size:0.9rem;"><strong>الموضوع:</strong> ${subject}</p>
        <p style="margin:4px 0; font-size:0.9rem;"><strong>التوقيت:</strong> ${now}</p>
      </div>
      <p>سيتواصل معك فريقنا خلال <strong>24 ساعة</strong> على البريد الإلكتروني.</p>
      <p>للاستفسارات السريعة، يمكنك التواصل عبر واتساب:</p>
    `;

    const extraHtml = `
      <p style="text-align:center; margin:20px 0;">
        <a href="https://wa.me/201004135973?text=${encodeURIComponent('السلام عليكم، بخصوص الرسالة ' + submissionId)}"
           target="_blank"
           style="display:inline-block; background:#25D366; color:white; padding:12px 24px; text-decoration:none; border-radius:30px; font-weight:bold;">
          💬 تواصل عبر واتساب
        </a>
      </p>
    `;

    const htmlBody = buildEmailHtml(
      `✅ تم استلام رسالتك - ${PROJECT_NAME}`,
      content,
      extraHtml
    );

    return await sendEmailViaBrevo({
      to: email,
      subject: `✅ تم استلام رسالتك - ${submissionId}`,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'info@kidcode-eg.com',
      replyToName: `${PROJECT_NAME} - Info`
    });

  } catch (e) {
    console.error('❌ [sendContactUserEmail]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  📧 sendNewsletterWelcomeEmail — ترحيب بمشترك النشرة
// ============================================================
export async function sendNewsletterWelcomeEmail(email, name, unsubscribeToken) {
  try {
    const unsubscribeLink = `https://www.kidcode-eg.com/unsubscribe.html?token=${unsubscribeToken}`;

    const content = `
      <p>مرحباً <strong>${name}</strong>،</p>
      <p>شكراً لتسجيلك في <strong>نشرة إنذار الاختفاء</strong> من <strong>${PROJECT_NAME}</strong>.</p>
      <p>ستصلك تنبيهات فورية عند الإبلاغ عن اختفاء طفل في منطقتك.</p>
    `;

    const extraHtml = `
      <hr style="border:0; border-top:1px solid #eee; margin:15px 0;">
      <p style="font-size:0.9rem; color:#64748b;">
        يمكنك إلغاء الاشتراك في أي وقت من خلال:
      </p>
      <p style="text-align:center;">
        <a href="${unsubscribeLink}"
           style="display:inline-block; background-color:#e53e3e; color:white; padding:8px 20px; text-decoration:none; border-radius:30px; font-weight:bold; font-size:0.9rem;">
          إلغاء الاشتراك
        </a>
      </p>
    `;

    const htmlBody = buildEmailHtml(
      `مرحباً بك في نشرة - ${PROJECT_NAME}`,
      content,
      extraHtml
    );

    return await sendEmailViaBrevo({
      to: email,
      subject: `مرحباً بك في نشرة ${PROJECT_NAME}`,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'info@kidcode-eg.com',
      replyToName: `${PROJECT_NAME} - Info`
    });

  } catch (e) {
    console.error('❌ [sendNewsletterWelcomeEmail]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  📢 sendMissingAlertEmail — Batch إرسال تنبيه اختفاء
//  - يستخدم Brevo messageVersions
// ============================================================
export async function sendMissingAlertEmail(subscribers, data) {
  try {
    const { childID, childName, imageFileId, reportId, clothes, governorate, district, landmark } = data;

    const imageUrl = imageFileId
      ? `https://drive.google.com/thumbnail?id=${imageFileId}&sz=s400`
      : '';

    const confirmLink = `https://www.kidcode-eg.com/confirm-found.html?report=${reportId}`;

    const subject = `تنبيه: طفل مفقود - ${childName} - ${PROJECT_NAME}`;

    const content = `
      <p style="font-size:1.05rem;">تنبيه هام،</p>
      <p>تم الإبلاغ عن اختفاء الطفل التالي. يرجى نشر الخبر والمساعدة في العثور عليه.</p>
      <div style="background:#f8fafc; border-radius:12px; padding:15px; margin:15px 0; border-right:4px solid #e53e3e;">
        <p><strong>رقم البلاغ:</strong> ${reportId}</p>
        <p><strong>اسم الطفل:</strong> ${childName}</p>
        <p><strong>معرف الطفل:</strong> ${childID}</p>
        ${imageUrl ? `<p style="text-align:center;"><img src="${imageUrl}" alt="صورة الطفل" style="max-width:200px; border-radius:12px; border:1px solid #ccc;"></p>` : ''}
        <p><strong>الملابس:</strong> ${clothes}</p>
        <p><strong>المحافظة:</strong> ${governorate}</p>
        <p><strong>الحي:</strong> ${district}</p>
        <p><strong>العلامة المميزة:</strong> ${landmark}</p>
      </div>
    `;

    const extraHtml = `
      <p style="text-align:center;">
        <a href="${confirmLink}"
           target="_blank"
           style="display:inline-block; background-color:#25D366; color:white; padding:12px 24px; text-decoration:none; border-radius:30px; font-weight:bold;">
          ✅ هل عثرت على الطفل؟ (أبلغنا)
        </a>
      </p>
      <p style="font-size:0.8rem; color:#94a3b8; text-align:center;">
        هذا البريد مرسل للمتطوعين المسجلين في نشرة KidCode-eg.
      </p>
    `;

    const htmlBody = buildEmailHtml(`تنبيه اختفاء - ${PROJECT_NAME}`, content, extraHtml);

    // ✅ Brevo messageVersions
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) return { success: false, error: 'api_key_missing' };

    const messageVersions = subscribers.map(sub => ({
      to: [{ email: sub.email, name: sub.name || '' }]
    }));

    const payload = {
      sender: { name: PROJECT_NAME, email: 'info@kidcode-eg.com' },
      replyTo: { name: `${PROJECT_NAME} - Info`, email: 'info@kidcode-eg.com' },
      subject,
      htmlContent: htmlBody,
      messageVersions
    };

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'accept': 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      console.log(`✅ [sendMissingAlertEmail] batch of ${subscribers.length}`);
      return { success: true, count: subscribers.length };
    } else {
      const text = await response.text();
      console.error(`❌ [sendMissingAlertEmail] ${response.status}: ${text.substring(0, 200)}`);
      return { success: false, error: text.substring(0, 200) };
    }

  } catch (e) {
    console.error('❌ [sendMissingAlertEmail]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🙏 sendVolunteerThanksEmail — شكر المتطوع
// ============================================================
export async function sendVolunteerThanksEmail(email, volunteerName, childName) {
  try {
    const content = `
      <p>عزيزي <strong>${volunteerName}</strong>،</p>
      <p>نتقدم إليك بجزيل الشكر على مساعدتك في العثور على الطفل <strong>${childName}</strong>.</p>
      <p>بفضل مبادرتك الإنسانية، تم لم شمل الطفل بأسرته. نحن نقدر لك وقتك وجهدك.</p>
      <p style="color:#22c55e; font-weight:bold;">✅ تم إغلاق بلاغ الاختفاء بنجاح.</p>
    `;

    const extraHtml = `
      <hr style="border:0; border-top:1px solid #eee; margin:15px 0;">
      <p style="font-size:0.8rem; color:#94a3b8; text-align:center;">
        هذا البريد مرسل تلقائياً من نظام KidCode-eg. شكراً لكونك جزءاً من مجتمعنا الآمن.
      </p>
    `;

    const htmlBody = buildEmailHtml(`شكراً لك - ${PROJECT_NAME}`, content, extraHtml);

    return await sendEmailViaBrevo({
      to: email,
      subject: `شكراً لك على مساعدتك - ${PROJECT_NAME}`,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'info@kidcode-eg.com',
      replyToName: `${PROJECT_NAME} - Info`
    });

  } catch (e) {
    console.error('❌ [sendVolunteerThanksEmail]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🎉 sendParentReportFoundEmail — إشعار الأسرة بالعثور على الطفل
// ============================================================
export async function sendParentReportFoundEmail(data) {
  try {
    const { parentEmail, childName, childID, reportId, volunteerName, volunteerPhone } = data;

    const volunteerPhoneIntl = String(volunteerPhone || '').replace(/\D/g, '').startsWith('20')
      ? String(volunteerPhone).replace(/\D/g, '')
      : '20' + String(volunteerPhone).replace(/\D/g, '').replace(/^0/, '');

    const content = `
      <p>عزيزي ولي الأمر،</p>
      <p>تم إبلاغنا من قبل متطوع بالعثور على طفلك <strong>${childName}</strong> (${childID}).</p>
      <p><strong>رقم البلاغ:</strong> ${reportId}</p>
      <p><strong>اسم المتطوع:</strong> ${volunteerName}</p>
      <p><strong>رقم هاتف المتطوع:</strong> ${volunteerPhone}</p>
      <p style="color:#e53e3e; font-weight:bold;">
        هام: يرجى التواصل مع المتطوع فوراً للتأكد من هوية طفلك واستلامه.
        يجب تأكيد استلام الطفل خلال 24 ساعة من الآن.
      </p>
      <p style="font-size:0.9rem; color:#64748b;">
        تم حفظ صور بطاقة المتطوع في سجلاتنا للتحقق من هويته.
      </p>
    `;

    const extraHtml = `
      <hr style="border:0; border-top:1px solid #eee; margin:15px 0;">
      <p style="text-align:center;">
        <a href="https://wa.me/${volunteerPhoneIntl}"
           target="_blank"
           style="display:inline-block; background-color:#25D366; color:white; padding:10px 20px; text-decoration:none; border-radius:30px; font-weight:bold;">
          تواصل مع المتطوع عبر واتساب
        </a>
      </p>
      <hr style="border:0; border-top:1px solid #eee; margin:15px 0;">
      <p style="font-size:0.9rem; text-align:center;">
        بعد التأكد من استلام طفلك، يرجى تأكيد إغلاق البلاغ:
      </p>
      <p style="text-align:center;">
        <a href="https://www.kidcode-eg.com/confirm-received.html?report=${reportId}"
           target="_blank"
           style="display:inline-block; background-color:#1a73e8; color:white; padding:10px 20px; text-decoration:none; border-radius:30px; font-weight:bold;">
          تأكيد استلام الطفل
        </a>
      </p>
    `;

    const htmlBody = buildEmailHtml(
      `تم الإبلاغ عن العثور على ${childName} - ${PROJECT_NAME}`,
      content,
      extraHtml
    );

    return await sendEmailViaBrevo({
      to: parentEmail,
      subject: `تم الإبلاغ عن العثور على طفلك ${childName} - ${PROJECT_NAME}`,
      htmlContent: htmlBody,
      senderEmail: 'info@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'info@kidcode-eg.com',
      replyToName: `${PROJECT_NAME} - Info`
    });

  } catch (e) {
    console.error('❌ [sendParentReportFoundEmail]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  ✅ sendParentReportClosedEmail — تأكيد إغلاق البلاغ
// ============================================================
export async function sendParentReportClosedEmail(parentEmail, childName, feedback) {
  try {
    const content = `
      <p>عزيزي ولي الأمر،</p>
      <p>تم تأكيد استلام طفلك <strong>${childName}</strong> وإغلاق بلاغ الاختفاء بنجاح.</p>
      <p>نشكر لك ثقتك بنا، ونتمنى لك ولطفلك دوام السلامة.</p>
      ${feedback ? `<p><strong>تقييمك:</strong> ${feedback}</p>` : ''}
    `;

    const extraHtml = `
      <hr style="border:0; border-top:1px solid #eee; margin:15px 0;">
      <p style="font-size:0.8rem; color:#94a3b8; text-align:center;">
        هذا البريد مرسل تلقائياً من نظام KidCode-eg.
      </p>
    `;

    const htmlBody = buildEmailHtml(`تم إغلاق البلاغ - ${PROJECT_NAME}`, content, extraHtml);

    return await sendEmailViaBrevo({
      to: parentEmail,
      subject: `تم إغلاق بلاغ اختفاء الطفل ${childName} - ${PROJECT_NAME}`,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'info@kidcode-eg.com',
      replyToName: `${PROJECT_NAME} - Info`
    });

  } catch (e) {
    console.error('❌ [sendParentReportClosedEmail]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🚨 sendEscalationAdminEmail — تصعيد بلاغ للأدمن
// ============================================================
export async function sendEscalationAdminEmail(data) {
  try {
    const { reportId, childName, childID, volunteerName, volunteerPhone, parentPhone } = data;

    const content = `
      <p style="font-size:1.05rem;">تنبيه هام للأدمن،</p>
      <p>لم يقم ولي الأمر بتأكيد استلام الطفل خلال <strong>24 ساعة</strong> من إبلاغ المتطوع بالعثور عليه.</p>
      <div style="background:#f8fafc; border-radius:12px; padding:15px; margin:15px 0; border-right:4px solid #e53e3e;">
        <p><strong>رقم البلاغ:</strong> ${reportId}</p>
        <p><strong>الطفل:</strong> ${childName} (${childID})</p>
        <p><strong>اسم المتطوع:</strong> ${volunteerName || 'غير متوفر'}</p>
        <p><strong>رقم هاتف المتطوع:</strong> ${volunteerPhone || 'غير متوفر'}</p>
        <p><strong>رقم ولي الأمر:</strong> ${parentPhone || 'غير متوفر'}</p>
      </div>
      <p style="color:#e53e3e; font-weight:bold;">
        ⏰ يرجى التدخل الفوري والتواصل مع الطرفين للتأكد من سلامة الطفل.
      </p>
    `;

    const htmlBody = buildEmailHtml(`بلاغ لم يُؤكد - ${PROJECT_NAME}`, content);

    return await sendEmailViaBrevo({
      to: process.env.ADMIN_EMAIL || 'info@kidcode-eg.com',
      subject: `تنبيه: بلاغ اختفاء لم يتم تأكيده خلال 24 ساعة - ${reportId}`,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'info@kidcode-eg.com',
      replyToName: `${PROJECT_NAME} - Info`
    });

  } catch (e) {
    console.error('❌ [sendEscalationAdminEmail]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🔐 sendAdminPasswordResetEmail — رابط تغيير كلمة مرور الأدمن
// ============================================================
export async function sendAdminPasswordResetEmail(toEmail, adminName, resetLink) {
  try {
    if (!toEmail) return { success: false, error: 'no_email' };

    const content = `
      <p>مرحباً <strong>${adminName}</strong>،</p>
      <p>تم طلب تغيير كلمة السر لحساب الأدمن الخاص بك.</p>
      <p>اضغط على الزر التالي لتغيير كلمة السر (صالح 15 دقيقة):</p>
      <p style="text-align:center; margin:20px 0;">
        <a href="${resetLink}"
           style="display:inline-block; background:#6366F1; color:white; padding:14px 32px; text-decoration:none; border-radius:30px; font-weight:bold;">
          🔑 تغيير كلمة السر
        </a>
      </p>
    `;

    const extraHtml = `
      <div style="background:#FEF2F2; border-right:4px solid #DC2626; border-radius:12px; padding:14px 18px; margin:18px 0;">
        <p style="margin:0 0 8px; color:#991B1B; font-weight:900;">⚠️ لم تطلب هذا التغيير؟</p>
        <p style="margin:0 0 12px; color:#7F1D1D; font-size:0.9rem; line-height:1.7;">
          إذا لم تكن أنت من طلب هذا التغيير، فهذا يعني أن شخصًا آخر لديه وصول إلى حسابك.
        </p>
        <p style="text-align:center; margin:0;">
          <a href="https://www.kidcode-eg.com/admin/reset-password.html?token=${extractTokenFromLink(resetLink)}&action=iDidntRequest"
             style="display:inline-block; background:#DC2626; color:white; padding:12px 24px; text-decoration:none; border-radius:30px; font-weight:bold; font-size:0.9rem;">
            🚫 لم أطلب هذا — أبلغ فريق الأمان
          </a>
        </p>
      </div>
    `;

    const htmlBody = buildEmailHtml('🔐 تغيير كلمة مرور الأدمن', content, extraHtml);

    return await sendEmailViaBrevo({
      to: toEmail,
      subject: '🔐 طلب تغيير كلمة مرور لوحة الأدمن',
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'info@kidcode-eg.com',
      replyToName: PROJECT_NAME + ' - Info'
    });
  } catch (e) {
    console.error('❌ [sendAdminPasswordResetEmail]', e.message);
    return { success: false, error: e.message };
  }
}

// مساعد لاستخراج التوكن من الرابط
function extractTokenFromLink(link) {
  const match = String(link).match(/token=([a-f0-9]+)/);
  return match ? match[1] : '';
}

// ============================================================
//  📬 sendBulkEmailViaBrevo — إرسال لعدة مستلمين (فردي)
//  - يستخدم sendEmailViaBrevo لكل مستلم (نفس دالة الترحيب)
//  - تأخير 120ms بين الرسائل لتفادي rate limits
//  - يرجّع { sent, failed, failures }
// ============================================================
export async function sendBulkEmailViaBrevo(recipients, buildContentFn, options) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'api_key_missing', sent: 0, failed: recipients.length, failures: [] };
  }

  let totalSent = 0;
  let totalFailed = 0;
  const failures = [];

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    try {
      const content = buildContentFn(recipient);

      const result = await sendEmailViaBrevo({
        to: recipient.email,
        subject: content.subject,
        htmlContent: content.htmlContent,
        attachments: options.attachments || [],
        senderEmail: options.senderEmail || 'no-reply@kidcode-eg.com',
        senderName: options.senderName || PROJECT_NAME,
        replyToEmail: options.replyToEmail || 'support@kidcode-eg.com',
        replyToName: options.replyToName || PROJECT_NAME + ' Support'
      });

      if (result.success) {
        totalSent++;
      } else {
        totalFailed++;
        failures.push({ email: recipient.email, error: result.error || 'unknown' });
        console.warn(`❌ [bulk] فشل ${recipient.email}: ${result.error}`);
      }
    } catch (err) {
      totalFailed++;
      failures.push({ email: recipient.email, error: err.message });
      console.error(`❌ [bulk] استثناء ${recipient.email}: ${err.message}`);
    }

    // تأخير بين الرسائل (120ms) — Brevo يسمح 100 req/sec
    if (i < recipients.length - 1) {
      await new Promise(function(r) { setTimeout(r, 120); });
    }
  }

  console.log(`📊 [bulk] اكتمل: ${totalSent} نجح، ${totalFailed} فشل من ${recipients.length}`);

  return {
    success: totalSent > 0,
    sent: totalSent,
    failed: totalFailed,
    failures: failures
  };
}

// ============================================================
//  🆕 sendAdminWelcomeEmail — بريد ترحيب بمسؤول جديد
// ============================================================
export async function sendAdminWelcomeEmail(toEmail, fullName, username, tempPassword) {
  try {
    if (!toEmail) return { success: false, error: 'no_email' };

    const content = `
      <p>مرحباً <strong>${fullName}</strong>،</p>
      <p>تم إنشاء حساب مسؤول جديد لك في <strong>لوحة تحكم KidCode-EG</strong>.</p>

      <div style="background:#F8FAFC; border-radius:12px; padding:16px; margin:16px 0; border-right:4px solid #6366F1;">
        <p style="margin:6px 0;"><strong>اسم المستخدم:</strong> <code style="background:#E0E7FF; padding:2px 8px; border-radius:4px; font-family:monospace;">${username}</code></p>
        <p style="margin:6px 0;"><strong>كلمة السر المؤقتة:</strong></p>
        <p style="font-size:1.2rem; font-weight:900; color:#6366F1; font-family:monospace; text-align:center; background:#F1F5F9; padding:12px; border-radius:8px; margin:8px 0; letter-spacing:1px;">${tempPassword}</p>
      </div>

      <div style="background:#FEF3C7; border-right:4px solid #F59E0B; border-radius:12px; padding:14px 18px; margin:16px 0;">
        <p style="margin:0 0 6px; color:#92400E; font-weight:900;">⚠️ تنبيه مهم</p>
        <p style="margin:0; color:#78350F; font-size:0.9rem; line-height:1.7;">
          يجب عليك <strong>تغيير كلمة السر فورًا</strong> عند أول تسجيل دخول.
          لن يمكنك استخدام اللوحة قبل تعيين كلمة مرور جديدة خاصة بك.
        </p>
      </div>

      <p style="text-align:center; margin:20px 0;">
        <a href="https://www.kidcode-eg.com/admin/"
           style="display:inline-block; background:#6366F1; color:white; padding:14px 32px; text-decoration:none; border-radius:30px; font-weight:bold;">
          🔐 دخول لوحة الأدمن
        </a>
      </p>
    `;

    const htmlBody = buildEmailHtml('🆕 حساب مسؤول جديد', content);

    return await sendEmailViaBrevo({
      to: toEmail,
      subject: '🆕 حساب مسؤول جديد - KidCode-EG',
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'info@kidcode-eg.com',
      replyToName: PROJECT_NAME + ' - Info'
    });
  } catch (e) {
    console.error('❌ [sendAdminWelcomeEmail]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🔗 sendAdminTelegramLinkEmail — بريد ربط تليجرام
// ============================================================
export async function sendAdminTelegramLinkEmail(toEmail, fullName, telegramURL, expiresInDays) {
  try {
    if (!toEmail) return { success: false, error: 'no_email' };

    const days = expiresInDays || 7;

    const content = `
      <p style="margin:0 0 12px;">مرحباً <strong>${fullName}</strong>،</p>
      <p style="margin:0 0 12px; color:#334155; line-height:1.85;">
        تم إصدار كود ربط لحسابك في <strong>لوحة تحكم KidCode-EG</strong> بحسابك على تليجرام.
        بالضغط على الزر التالي، سيتم فتح البوت تلقائياً وربط حسابك مباشرة.
      </p>
    `;

    const extraHtml = `
      <p style="text-align:center; margin:22px 0;">
        <a href="${telegramURL}"
           style="display:inline-block; background:linear-gradient(135deg, #0088CC, #006699); color:#FFFFFF; padding:16px 36px; text-decoration:none; border-radius:30px; font-weight:900; font-size:1rem;">
          🤖 اضغط هنا لفتح البوت والربط
        </a>
      </p>

      <p style="text-align:center; font-size:0.85rem; color:#64748B; margin:16px 0 8px;">
        أو انسخ الرابط التالي والصقه في المتصفح:
      </p>
      <p style="text-align:center; font-size:0.8rem; background:#F1F5F9; padding:10px 14px; border-radius:8px; word-break:break-all; font-family:'Courier New',monospace; color:#1E293B; direction:ltr; margin:0;">
        ${telegramURL}
      </p>

      <div style="background:#FEF3C7; border-right:4px solid #F59E0B; border-radius:12px; padding:14px 18px; margin:18px 0;">
        <p style="margin:0 0 6px; color:#92400E; font-weight:900; font-size:0.95rem;">⚠️ تنبيهات مهمة</p>
        <ul style="margin:6px 0 0; padding-right:20px; color:#78350F; font-size:0.9rem; line-height:1.9;">
          <li>الرابط صالح لمدة <strong>${days} أيام</strong> فقط</li>
          <li>يُستخدم <strong>مرة واحدة فقط</strong> لربط حسابك</li>
          <li>لا تشاركه مع أي شخص آخر</li>
          <li>إذا لم تكن تتوقع هذه الرسالة، يرجى إبلاغ superAdmin فوراً</li>
        </ul>
      </div>

      <hr style="border:0; border-top:1px solid #eee; margin:18px 0;">
      <p style="font-size:0.75rem; color:#94A3B8; text-align:center; margin:0;">
        هذا البريد مرسل تلقائياً من KidCode-EG. يرجى عدم الرد عليه.
      </p>
    `;

    const htmlBody = buildEmailHtml('🔗 ربط حسابك بتليجرام', content, extraHtml);

    return await sendEmailViaBrevo({
      to: toEmail,
      subject: '🔗 ربط حسابك بتليجرام - KidCode-EG',
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'info@kidcode-eg.com',
      replyToName: PROJECT_NAME + ' - Info'
    });
  } catch (e) {
    console.error('❌ [sendAdminTelegramLinkEmail]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🔐 sendChildIdChangedEmail — إيميل إشعار تغيير كود الطفل
// ============================================================
export async function sendChildIdChangedEmail(toEmail, childName, oldID, newID, qrUrl, reasonLabel) {
  try {
    if (!toEmail) return { success: false, error: 'no_email' };

    const content = `
      <p style="font-size:1.05rem; margin:0 0 10px;">مرحباً،</p>
      <p style="margin:0 0 16px; color:#475569;">
        تم تحديث كود الطفل <strong>${childName}</strong> بناءً على طلب أو لأسباب أمنية.
      </p>

      <div style="background:#FEF3C7; border-right:4px solid #F59E0B; border-radius:12px; padding:14px 18px; margin:16px 0;">
        <p style="margin:0; color:#78350F; font-size:0.9rem; line-height:1.8;">
          <strong>⚠️ تنبيه:</strong> الكود القديم <code style="background:white; padding:2px 8px; border-radius:6px; font-family:monospace;">${oldID}</code> توقف عن العمل ولن يكون صالحًا بعد الآن.
        </p>
      </div>

      <div style="background:#ECFDF5; border-right:4px solid #10B981; border-radius:12px; padding:20px; margin:20px 0; text-align:center;">
        <p style="margin:0 0 6px; color:#065F46; font-size:0.85rem; font-weight:700; letter-spacing:1px;">
          الكود الجديد
        </p>
        <p style="margin:0; font-size:2rem; font-weight:900; color:#047857; font-family:monospace; letter-spacing:2px; direction:ltr;">
          ${newID}
        </p>
      </div>

      <div style="background:#F0F9FF; border-right:4px solid #0088CC; border-radius:12px; padding:14px 18px; margin:16px 0;">
        <p style="margin:0 0 6px; color:#0C4A6E; font-weight:800; font-size:0.9rem;">
          📌 سبب التغيير:
        </p>
        <p style="margin:0; color:#0C4A6E; font-size:0.9rem;">${reasonLabel}</p>
      </div>
    `;

    const extraHtml = `
      ${qrUrl ? `
      <div style="text-align:center; margin:20px 0;">
        <p style="margin:0 0 12px; color:#334155; font-weight:700;">📱 رمز QR الجديد:</p>
        <img src="${qrUrl}" alt="QR Code" style="max-width:220px; border-radius:12px; border:2px solid #10B981; padding:8px; background:white;">
      </div>
      ` : ''}

      <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">

      <div style="background:#FEF2F2; border-right:4px solid #DC2626; border-radius:12px; padding:14px 18px; margin:16px 0;">
        <p style="margin:0 0 8px; color:#991B1B; font-weight:900; font-size:0.9rem;">
          🚨 ماذا تفعل الآن؟
        </p>
        <ul style="margin:0; padding-right:20px; color:#7F1D1D; font-size:0.85rem; line-height:1.9;">
          <li>احفظ الكود الجديد في مكان آمن</li>
          <li>اطبع رمز QR الجديد واستبدل القديم فورًا</li>
          <li>تخلص من أي نسخ قديمة للكارت أو الميدالية</li>
          <li>سجّل دخول لوحة الأسرة بالكود الجديد عند الحاجة</li>
        </ul>
      </div>

      <p style="text-align:center; margin:20px 0;">
        <a href="https://www.kidcode-eg.com/family-login"
           style="display:inline-block; background:linear-gradient(135deg, #22559F, #1A437C); color:white; padding:14px 32px; text-decoration:none; border-radius:30px; font-weight:bold; font-size:0.95rem;">
          🔐 دخول لوحة الأسرة
        </a>
      </p>

      <p style="font-size:0.8rem; color:#94A3B8; text-align:center; margin-top:20px;">
        إذا لم تطلب هذا التغيير، تواصل معنا فورًا:
        <a href="mailto:support@kidcode-eg.com" style="color:#22559F; font-weight:700;">support@kidcode-eg.com</a>
      </p>
    `;

    const htmlBody = buildEmailHtml('🔐 تم تحديث كود طفلك', content, extraHtml);

    return await sendEmailViaBrevo({
      to: toEmail,
      subject: '🔐 تم تحديث كود الطفل ' + childName + ' — كود جديد: ' + newID,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'support@kidcode-eg.com',
      replyToName: PROJECT_NAME + ' - Support'
    });

  } catch (e) {
    console.error('❌ [sendChildIdChangedEmail]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  💳 sendPaymentRequiredEmail — بريد "يرجى إتمام الدفع"
//  للخطط المدفوعة — بدون QR (يُرسل بعد الدفع فقط)
// ============================================================
export async function sendPaymentRequiredEmail(toEmail, childName, childID, plan, amount, paymentLink) {
  try {
    if (!toEmail) return { success: false, error: 'no_email' };

    const content = `
      <p style="font-size:1.05rem; margin:0 0 12px;">مرحباً،</p>
      <p style="margin:0 0 16px; color:#334155; line-height:1.85;">
        تم تسجيل الطفل <strong>${childName}</strong> بنجاح في <strong>KidCode-EG</strong>.
      </p>

      <div style="background:#FEF3C7; border-right:4px solid #F59E0B; border-radius:12px; padding:14px 18px; margin:16px 0;">
        <p style="margin:0 0 8px; color:#92400E; font-weight:900; font-size:1rem;">
          ⚠️ الحساب في انتظار الدفع
        </p>
        <p style="margin:0; color:#78350F; font-size:0.9rem; line-height:1.7;">
          لإتمام تفعيل الحساب، يرجى إتمام عملية الدفع عبر الإنترنت.
        </p>
      </div>

      <div style="background:#EFF6FF; border-radius:12px; padding:16px 20px; margin:16px 0; border-right:4px solid #22559F;">
        <p style="margin:6px 0; color:#1E3A8A;"><strong>🆔 كود الطفل:</strong> <code style="background:white; padding:2px 8px; border-radius:6px; font-family:monospace;">${childID}</code></p>
        <p style="margin:6px 0; color:#1E3A8A;"><strong>📋 الباقة:</strong> ${plan}</p>
        <p style="margin:6px 0; color:#1E3A8A;"><strong>💰 المبلغ:</strong> ${amount} ج.م</p>
      </div>

      <p style="margin:16px 0 8px; color:#334155;">يمكنك إتمام الدفع الآن بالضغط على الزر:</p>
    `;

    const extraHtml = `
      <p style="text-align:center; margin:22px 0;">
        <a href="${paymentLink}"
           style="display:inline-block; background:linear-gradient(135deg, #22559F, #1A437C); color:white; padding:16px 36px; text-decoration:none; border-radius:30px; font-weight:900; font-size:1rem;">
          💳 إتمام الدفع الآن
        </a>
      </p>

      <p style="text-align:center; font-size:0.85rem; color:#64748B; margin:16px 0 8px;">
        أو انسخ الرابط:
      </p>
      <p style="text-align:center; font-size:0.75rem; background:#F1F5F9; padding:10px 14px; border-radius:8px; word-break:break-all; direction:ltr; font-family:'Courier New',monospace;">
        ${paymentLink}
      </p>

      <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">
      <p style="font-size:0.8rem; color:#94A3B8; text-align:center; margin:0;">
        بعد إتمام الدفع، سيصلك رمز QR الخاص بطفلك على هذا البريد خلال دقائق.
      </p>
    `;

    const htmlBody = buildEmailHtml('💳 يرجى إتمام الدفع', content, extraHtml);

    return await sendEmailViaBrevo({
      to: toEmail,
      subject: '💳 يرجى إتمام الدفع - KidCode-EG',
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'support@kidcode-eg.com',
      replyToName: PROJECT_NAME + ' - Support'
    });
  } catch (e) {
    console.error('❌ [sendPaymentRequiredEmail]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  💸 sendRefundEmail — إيميل استرداد المبلغ
//  يُرسل تلقائيًا عند تنفيذ الاسترداد (سواء كان الإشعار الأساسي
//  تليجرام وفشل، أو كانت طريقة الإشعار البريد مباشرة)
// ============================================================
export async function sendRefundEmail(toEmail, childName, childID, amount, currency, plan, refundId, reason) {
  try {
    if (!toEmail) return { success: false, error: 'no_email' };

    const amountStr = String(amount || 0) + ' ' + String(currency || 'EGP');
    const planStr = plan || 'غير محددة';
    const refundIdStr = refundId || '—';
    const reasonStr = reason || 'غير محدد';

    const content = `
      <p style="font-size:1.05rem; margin:0 0 10px;">مرحباً،</p>
      <p style="margin:0 0 16px; color:#475569; line-height:1.85;">
        تم تنفيذ طلب استرداد مبلغ الاشتراك الخاص بالطفل
        <strong>${childName}</strong> (<code style="background:#F1F5F9; padding:2px 8px; border-radius:6px; font-family:monospace; color:#22559F;">${childID}</code>).
      </p>

      <div style="background:#ECFDF5; border-right:4px solid #10B981; border-radius:12px; padding:20px; margin:20px 0; text-align:center;">
        <p style="margin:0 0 6px; color:#065F46; font-size:0.85rem; font-weight:700; letter-spacing:1px;">
          المبلغ المُسترد
        </p>
        <p style="margin:0; font-size:2rem; font-weight:900; color:#047857; font-family:monospace; letter-spacing:1px; direction:ltr;">
          ${amountStr}
        </p>
      </div>

      <div style="background:#F8FAFC; border-radius:12px; padding:16px 20px; margin:16px 0; border-right:4px solid #22559F;">
        <p style="margin:6px 0; color:#334155;"><strong>📋 الباقة الملغاة:</strong> ${planStr}</p>
        <p style="margin:6px 0; color:#334155;"><strong>🆔 رقم الاسترداد:</strong> <code style="background:white; padding:2px 8px; border-radius:6px; font-family:monospace;">${refundIdStr}</code></p>
        <p style="margin:6px 0; color:#334155;"><strong>📝 سبب الاسترداد:</strong> ${reasonStr}</p>
      </div>

      <div style="background:#FEF3C7; border-right:4px solid #F59E0B; border-radius:12px; padding:14px 18px; margin:16px 0;">
        <p style="margin:0; color:#78350F; font-size:0.9rem; line-height:1.8;">
          <strong>⏱️ متى يصل المبلغ؟</strong><br>
          سيصل المبلغ إلى حسابك خلال <strong>5-7 أيام عمل</strong> من تاريخ هذه الرسالة،
          عبر نفس وسيلة الدفع الأصلية (بطاقة / محفظة إلكترونية / تحويل بنكي).
        </p>
      </div>
    `;

    const extraHtml = `
      <div style="background:#FEF2F2; border-right:4px solid #DC2626; border-radius:12px; padding:14px 18px; margin:16px 0;">
        <p style="margin:0 0 8px; color:#991B1B; font-weight:900; font-size:0.9rem;">
          🚨 ملاحظات مهمة
        </p>
        <ul style="margin:0; padding-right:20px; color:#7F1D1D; font-size:0.85rem; line-height:1.9;">
          <li>تم <strong>إلغاء اشتراك الطفل فورًا</strong> (status = expired)</li>
          <li>رمز QR القديم لن يعمل بعد الآن</li>
          <li>بيانات الطفل باقية في النظام بأمان</li>
          <li>يمكنك التسجيل مجددًا في أي وقت لاحق</li>
        </ul>
      </div>

      <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">

      <p style="text-align:center; margin:16px 0 12px; color:#475569; font-size:0.95rem;">
        لأي استفسار بخصوص الاسترداد أو إعادة التسجيل:
      </p>

      <p style="text-align:center; margin:0 0 12px;">
        <a href="https://wa.me/201004135973?text=${encodeURIComponent('السلام عليكم، بخصوص استرداد مبلغ الطفل ' + childID)}"
           target="_blank"
           style="display:inline-block; background:#25D366; color:white; padding:12px 24px; text-decoration:none; border-radius:30px; font-weight:bold; font-size:0.9rem;">
          💬 تواصل عبر واتساب
        </a>
      </p>

      <p style="text-align:center; font-size:0.8rem; color:#94A3B8; margin:18px 0 0;">
        أو راسلنا على
        <a href="mailto:support@kidcode-eg.com" style="color:#22559F; font-weight:700;">support@kidcode-eg.com</a>
      </p>
    `;

    const htmlBody = buildEmailHtml('💸 تم استرداد مبلغ الاشتراك', content, extraHtml);

    const result = await sendEmailViaBrevo({
      to: toEmail,
      subject: '💸 تم استرداد مبلغ الاشتراك — ' + childName,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'support@kidcode-eg.com',
      replyToName: PROJECT_NAME + ' - Support'
    });

    if (result.success) {
      console.log(`📧 [sendRefundEmail] تم الإرسال إلى ${toEmail} | ${childID} | refund: ${refundIdStr}`);
    } else {
      console.error(`❌ [sendRefundEmail] فشل: ${result.error}`);
    }

    return result;

  } catch (e) {
    console.error('❌ [sendRefundEmail]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🔐 sendMarketerPasswordOTPEmail — إرسال OTP لتغيير كلمة السر
//  يُرسل من داخل الداشبورد عندما يختار المسوق قناة "email"
// ============================================================
export async function sendMarketerPasswordOTPEmail(toEmail, name, code, otp, expiresMinutes) {
  try {
    if (!toEmail) return { success: false, error: 'no_email' };

    const minutes = expiresMinutes || 5;

    const content = `
      <p style="font-size:1.05rem; margin:0 0 10px;">مرحباً <strong>${name}</strong>،</p>
      <p style="margin:0 0 16px; color:#475569; line-height:1.85;">
        وصلنا طلب لتغيير كلمة السر الخاصة بحسابك كمسوق في <strong>KidCode-EG</strong>.
        لإتمام العملية، أدخل الرمز التالي في لوحة التحكم:
      </p>

      <div style="background:#F0F9FF; border-right:4px solid #0088CC; border-radius:16px; padding:22px 20px; margin:20px 0; text-align:center;">
        <p style="margin:0 0 8px; color:#0C4A6E; font-size:0.85rem; font-weight:700; letter-spacing:1px;">
          رمز التحقق
        </p>
        <p style="margin:0; font-size:2.4rem; font-weight:900; color:#22559F; font-family:'Courier New',monospace; letter-spacing:12px; direction:ltr;">
          ${otp}
        </p>
      </div>

      <div style="background:#FEF3C7; border-right:4px solid #F59E0B; border-radius:12px; padding:14px 18px; margin:18px 0;">
        <p style="margin:0; color:#78350F; font-size:0.9rem; line-height:1.8;">
          ⏱️ <strong>الرمز صالح لمدة ${minutes} دقائق فقط</strong><br>
          ⚠️ لا تشاركه مع أي شخص — حتى لو ادّعى أنه من فريق الدعم
        </p>
      </div>
    `;

    const extraHtml = `
      <div style="background:#FEF2F2; border-right:4px solid #DC2626; border-radius:12px; padding:14px 18px; margin:18px 0;">
        <p style="margin:0 0 6px; color:#991B1B; font-weight:900; font-size:0.92rem;">
          🚨 لم تطلب هذا التغيير؟
        </p>
        <p style="margin:0; color:#7F1D1D; font-size:0.88rem; line-height:1.75;">
          إذا لم تكن أنت من طلب تغيير كلمة السر، فهذا يعني أن شخصاً آخر لديه وصول إلى حسابك.
          يرجى التواصل مع الدعم فوراً وتأمين حسابك.
        </p>
      </div>

      <hr style="border:0; border-top:1px solid #eee; margin:18px 0;">
      <p style="font-size:0.78rem; color:#94A3B8; text-align:center; margin:0;">
        كود المسوق: <code style="font-family:monospace; color:#22559F;">${code}</code> • هذا البريد مرسل تلقائياً من KidCode-EG
      </p>
    `;

    const htmlBody = buildEmailHtml('🔐 رمز تغيير كلمة السر', content, extraHtml);

    const result = await sendEmailViaBrevo({
      to: toEmail,
      subject: '🔐 رمز تغيير كلمة السر - KidCode-EG',
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'support@kidcode-eg.com',
      replyToName: PROJECT_NAME + ' - Support'
    });

    if (result.success) {
      console.log(`📧 [sendMarketerPasswordOTPEmail] ${code} → ${toEmail}`);
    } else {
      console.error(`❌ [sendMarketerPasswordOTPEmail] ${code} فشل: ${result.error}`);
    }

    return result;

  } catch (e) {
    console.error('❌ [sendMarketerPasswordOTPEmail]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  💸 sendMarketerWithdrawRequestEmail — إرسال طلب السحب للإدارة
//  to: sales@kidcode-eg.com | reply-to: marketer email
// ============================================================
export async function sendMarketerWithdrawRequestEmail(data) {
  try {
    const {
      requestId, marketerCode, marketerName, marketerEmail,
      amount, methodLabel, transferNumber,
      earnedBalance, pendingBalance, totalChildren, requestedAt
    } = data;

    const nowCairo = new Date(requestedAt || Date.now()).toLocaleString('ar-EG', {
      timeZone: 'Africa/Cairo',
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const subject = `💸 [طلب سحب] ${marketerCode} — ${amount} ج.م — ${methodLabel}`;

    const content = `
      <p style="font-size:1.05rem; margin:0 0 12px;">📬 <strong>طلب سحب أرباح جديد</strong></p>
      <p style="margin:0 0 16px; color:#475569;">
        تم استلام طلب سحب من أحد المسوقين. يرجى مراجعته والتحويل خلال 48 ساعة عمل.
      </p>

      <div style="background:#EFF6FF; border-right:4px solid #22559F; border-radius:12px; padding:16px 20px; margin:16px 0; text-align:center;">
        <p style="margin:0 0 6px; color:#1E3A8A; font-size:0.85rem; font-weight:700; letter-spacing:1px;">
          المبلغ المطلوب
        </p>
        <p style="margin:0; font-size:2rem; font-weight:900; color:#22559F; direction:ltr;">
          ${amount} <span style="font-size:1rem;">ج.م</span>
        </p>
      </div>

      <div style="background:#F8FAFC; border-radius:12px; padding:16px 20px; margin:16px 0;">
        <p style="margin:6px 0;"><strong>🔖 رقم الطلب:</strong> <code style="background:white; padding:2px 8px; border-radius:6px; font-family:monospace;">${requestId}</code></p>
        <p style="margin:6px 0;"><strong>👤 اسم المسوق:</strong> ${marketerName}</p>
        <p style="margin:6px 0;"><strong>🎫 كود المسوق:</strong> <code style="background:white; padding:2px 8px; border-radius:6px; font-family:monospace;">${marketerCode}</code></p>
        <p style="margin:6px 0;"><strong>📧 البريد:</strong> ${marketerEmail || '—'}</p>
        <p style="margin:6px 0;"><strong>💳 طريقة الاستلام:</strong> ${methodLabel}</p>
        <p style="margin:6px 0;"><strong>📱 رقم التحويل:</strong> <code style="background:white; padding:2px 8px; border-radius:6px; font-family:monospace; direction:ltr;">${transferNumber}</code></p>
        <p style="margin:6px 0;"><strong>🕒 وقت الطلب:</strong> ${nowCairo}</p>
      </div>

      <div style="background:#ECFDF5; border-right:4px solid #10B981; border-radius:12px; padding:14px 18px; margin:16px 0;">
        <p style="margin:0 0 6px; color:#065F46; font-weight:900; font-size:0.9rem;">📊 الرصيد الحالي للمسوق</p>
        <p style="margin:4px 0; color:#065F46;">✅ مستحق: <strong>${earnedBalance} ج.م</strong></p>
        <p style="margin:4px 0; color:#065F46;">⏳ معلق: ${pendingBalance} ج.م</p>
        <p style="margin:4px 0; color:#065F46;">👶 إجمالي الأطفال: ${totalChildren}</p>
      </div>
    `;

    const extraHtml = `
      <div style="background:#FEF3C7; border-right:4px solid #F59E0B; border-radius:12px; padding:14px 18px; margin:16px 0;">
        <p style="margin:0 0 6px; color:#92400E; font-weight:900; font-size:0.9rem;">⚡ مطلوب إجراء</p>
        <p style="margin:0; color:#78350F; font-size:0.88rem; line-height:1.75;">
          يرجى تحويل المبلغ على رقم <strong style="direction:ltr; unicode-bidi:embed;">${transferNumber}</strong>
          عبر <strong>${methodLabel}</strong> ثم الرد على هذا البريد لتأكيد التنفيذ.
        </p>
      </div>

      <p style="text-align:center; margin:20px 0;">
        <a href="https://wa.me/2${transferNumber.replace(/^0/, '')}?text=${encodeURIComponent('بخصوص طلب السحب ' + requestId)}"
           style="display:inline-block; background:#25D366; color:white; padding:12px 24px; text-decoration:none; border-radius:30px; font-weight:bold; font-size:0.9rem;">
          💬 تواصل مع المسوق
        </a>
      </p>

      <hr style="border:0; border-top:1px solid #eee; margin:18px 0;">
      <p style="font-size:0.78rem; color:#94A3B8; text-align:center; margin:0;">
        رقم الطلب: <strong>${requestId}</strong> • تم إنشاء هذا الطلب تلقائياً من لوحة تحكم المسوق
      </p>
    `;

    const htmlBody = buildEmailHtml(`💸 طلب سحب — ${marketerCode}`, content, extraHtml);

    return await sendEmailViaBrevo({
      to: 'sales@kidcode-eg.com',
      subject,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: marketerEmail || 'sales@kidcode-eg.com',
      replyToName: marketerName || PROJECT_NAME
    });

  } catch (e) {
    console.error('❌ [sendMarketerWithdrawRequestEmail]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  ✅ sendWithdrawConfirmationToMarketer — تأكيد استلام الطلب للمسوق
// ============================================================
export async function sendWithdrawConfirmationToMarketer(data) {
  try {
    const {
      requestId, marketerCode, marketerName, marketerEmail,
      amount, methodLabel, transferNumber, earnedBalance, requestedAt
    } = data;

    if (!marketerEmail) {
      return { success: false, error: 'no_email' };
    }

    const nowCairo = new Date(requestedAt || Date.now()).toLocaleString('ar-EG', {
      timeZone: 'Africa/Cairo',
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const subject = `✅ تم استلام طلب السحب — ${requestId}`;

    const content = `
      <p style="font-size:1.05rem; margin:0 0 12px;">مرحباً <strong>${marketerName}</strong>،</p>
      <p style="margin:0 0 16px; color:#475569; line-height:1.85;">
        تم استلام طلب سحب الأرباح الخاص بك بنجاح، وسيتم التواصل معك خلال <strong>48 ساعة عمل</strong>.
      </p>

      <div style="background:#ECFDF5; border-right:4px solid #10B981; border-radius:16px; padding:20px; margin:20px 0; text-align:center;">
        <p style="margin:0 0 6px; color:#065F46; font-size:0.85rem; font-weight:700; letter-spacing:1px;">
          رقم طلبك
        </p>
        <p style="margin:0; font-size:1.6rem; font-weight:900; color:#047857; font-family:monospace; letter-spacing:2px; direction:ltr;">
          ${requestId}
        </p>
      </div>

      <div style="background:#F8FAFC; border-radius:12px; padding:16px 20px; margin:16px 0;">
        <p style="margin:6px 0;"><strong>💰 المبلغ:</strong> ${amount} ج.م</p>
        <p style="margin:6px 0;"><strong>💳 طريقة الاستلام:</strong> ${methodLabel}</p>
        <p style="margin:6px 0;"><strong>📱 رقم التحويل:</strong> <code style="background:white; padding:2px 8px; border-radius:6px; font-family:monospace; direction:ltr;">${transferNumber}</code></p>
        <p style="margin:6px 0;"><strong>🕒 وقت الطلب:</strong> ${nowCairo}</p>
      </div>

      <div style="background:#FEF3C7; border-right:4px solid #F59E0B; border-radius:12px; padding:14px 18px; margin:16px 0;">
        <p style="margin:0 0 6px; color:#92400E; font-weight:900; font-size:0.9rem;">⏱️ ماذا يحدث الآن؟</p>
        <ul style="margin:0; padding-right:20px; color:#78350F; font-size:0.88rem; line-height:1.85;">
          <li>سيراجع فريق الإدارة طلبك</li>
          <li>سيتم التحويل على الرقم المسجل خلال 48 ساعة عمل</li>
          <li>ستصلك رسالة تأكيد بعد تنفيذ التحويل</li>
        </ul>
      </div>
    `;

    const extraHtml = `
      <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">

      <p style="text-align:center; margin:16px 0 10px; color:#475569; font-size:0.92rem;">
        لأي استفسار بخصوص طلبك:
      </p>

      <p style="text-align:center; margin:0 0 12px;">
        <a href="mailto:sales@kidcode-eg.com?subject=${encodeURIComponent('استفسار بخصوص طلب السحب ' + requestId)}"
           style="display:inline-block; background:linear-gradient(135deg, #22559F, #1A437C); color:white; padding:12px 26px; text-decoration:none; border-radius:30px; font-weight:bold; font-size:0.9rem;">
          ✉️ تواصل مع المبيعات
        </a>
      </p>

      <hr style="border:0; border-top:1px solid #eee; margin:18px 0;">
      <p style="font-size:0.78rem; color:#94A3B8; text-align:center; margin:0;">
        كود المسوق: <code style="font-family:monospace; color:#22559F;">${marketerCode}</code> • هذا البريد مرسل تلقائياً من KidCode-EG
      </p>
    `;

    const htmlBody = buildEmailHtml('✅ تم استلام طلب السحب', content, extraHtml);

    const result = await sendEmailViaBrevo({
      to: marketerEmail,
      subject,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'sales@kidcode-eg.com',
      replyToName: PROJECT_NAME + ' - Sales'
    });

    if (result.success) {
      console.log(`📧 [sendWithdrawConfirmationToMarketer] ${marketerCode} → ${marketerEmail}`);
    }
    return result;

  } catch (e) {
    console.error('❌ [sendWithdrawConfirmationToMarketer]', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  💸 sendWithdrawStatusEmail — إيميل تغيير حالة طلب السحب
//  status: 'rejected' | 'cancelled' | 'sent'
// ============================================================
export async function sendWithdrawStatusEmail(toEmail, marketerName, marketerCode, data) {
  try {
    if (!toEmail) return { success: false, error: 'no_email' };

    const statusConfig = {
      submitted: {
        subject: `📤 تم استلام طلب السحب - ${data.requestId}`,
        title: '📤 تم استلام طلب السحب',
        color: '#22559F',
        bg: '#EFF6FF',
        message: 'تم استلام طلب السحب الخاص بك بنجاح. سيتم مراجعته والتواصل معك قريباً.'
      },
      sending: {
        subject: `💸 طلب السحب قيد الإرسال - ${data.requestId}`,
        title: '💸 طلب السحب قيد الإرسال',
        color: '#F59E0B',
        bg: '#FEF3C7',
        message: 'جاري تحويل مبلغ السحب إلى حسابك. يرجى الانتظار.'
      },
      failed: {
        subject: `⚠️ فشل تحويل طلب السحب - ${data.requestId}`,
        title: '⚠️ فشل تحويل طلب السحب',
        color: '#DC2626',
        bg: '#FEF2F2',
        message: 'تعذر إتمام عملية التحويل. يرجى التواصل مع الإدارة للاستفسار.'
      },
      rejected: {
        subject: `❌ تم رفض طلب السحب - ${data.requestId}`,
        title: '❌ تم رفض طلب السحب',
        color: '#DC2626',
        bg: '#FEF2F2',
        message: 'نأسف لإبلاغك بأنه تم رفض طلب السحب. يمكنك التواصل مع الإدارة للاستفسار.'
      },
      cancelled: {
        subject: `⚪ تم إلغاء طلب السحب - ${data.requestId}`,
        title: '⚪ تم إلغاء طلب السحب',
        color: '#64748B',
        bg: '#F1F5F9',
        message: 'تم إلغاء طلب السحب. يمكنك تقديم طلب جديد في أي وقت.'
      },
      sent: {
        subject: `✅ تم تحويل مبلغ السحب - ${data.requestId}`,
        title: '✅ تم تحويل طلب السحب',
        color: '#10B981',
        bg: '#ECFDF5',
        message: 'تم تحويل المبلغ المطلوب إلى الرقم المسجل. يرجى التحقق من استلام المبلغ.'
      }
    };

    const cfg = statusConfig[data.status] || statusConfig.submitted;

    const content = `
      <p style="font-size:1.05rem; margin:0 0 12px;">مرحباً <strong>${marketerName}</strong>،</p>

      <div style="background:${cfg.bg}; border-right:4px solid ${cfg.color}; border-radius:12px; padding:16px 20px; margin:16px 0;">
        <p style="margin:0; color:${cfg.color}; font-weight:700; font-size:1rem; line-height:1.7;">${cfg.message}</p>
      </div>

      <div style="background:#F8FAFC; border-radius:12px; padding:16px 20px; margin:16px 0;">
        <p style="margin:6px 0;"><strong>🔖 رقم الطلب:</strong> <code style="background:white; padding:2px 8px; border-radius:6px; font-family:monospace;">${data.requestId}</code></p>
        <p style="margin:6px 0;"><strong>💰 المبلغ:</strong> ${data.amount} ج.م</p>
        <p style="margin:6px 0;"><strong>💳 الطريقة:</strong> ${data.methodLabel}</p>
      </div>

      ${(data.status === 'rejected' || data.status === 'failed') && data.rejectionReason ? `
        <div style="background:#FEF2F2; border-right:4px solid #DC2626; border-radius:12px; padding:14px 18px; margin:16px 0;">
          <p style="margin:0 0 6px; color:#991B1B; font-weight:900; font-size:0.9rem;">📝 ${data.status === 'failed' ? 'سبب الفشل' : 'سبب الرفض'}:</p>
          <p style="margin:0; color:#7F1D1D; font-size:0.9rem; line-height:1.75;">${data.rejectionReason}</p>
        </div>
      ` : ''}

      ${data.status === 'cancelled' && data.cancellationReason ? `
        <div style="background:#F1F5F9; border-right:4px solid #64748B; border-radius:12px; padding:14px 18px; margin:16px 0;">
          <p style="margin:0 0 6px; color:#334155; font-weight:900; font-size:0.9rem;">📝 سبب الإلغاء:</p>
          <p style="margin:0; color:#475569; font-size:0.9rem; line-height:1.75;">${data.cancellationReason}</p>
        </div>
      ` : ''}

      ${data.status === 'sent' && data.screenshotUrl ? `
        <div style="background:#ECFDF5; border-right:4px solid #10B981; border-radius:12px; padding:14px 18px; margin:16px 0;">
          <p style="margin:0 0 8px; color:#065F46; font-weight:900; font-size:0.9rem;">📸 سكرين شوت التحويل:</p>
          <p style="text-align:center; margin:8px 0;">
            <a href="${data.screenshotUrl}" target="_blank">
              <img src="${data.screenshotUrl}" alt="التحويل" style="max-width:100%; border-radius:8px; border:2px solid #10B981;">
            </a>
          </p>
        </div>
      ` : ''}
    `;

    const extraHtml = `
      <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">
      <p style="text-align:center; margin:16px 0 12px; color:#475569; font-size:0.92rem;">
        لأي استفسار بخصوص طلبك:
      </p>
      <p style="text-align:center; margin:0 0 12px;">
        <a href="mailto:sales@kidcode-eg.com?subject=${encodeURIComponent('استفسار بخصوص طلب السحب ' + data.requestId)}"
           style="display:inline-block; background:linear-gradient(135deg, #22559F, #1A437C); color:white; padding:12px 26px; text-decoration:none; border-radius:30px; font-weight:bold; font-size:0.9rem;">
          ✉️ تواصل مع المبيعات
        </a>
      </p>
      <p style="font-size:0.78rem; color:#94A3B8; text-align:center; margin:16px 0 0;">
        كود المسوق: <code style="font-family:monospace; color:#22559F;">${marketerCode}</code> • هذا البريد مرسل تلقائياً من KidCode-EG
      </p>
    `;

    const htmlBody = buildEmailHtml(cfg.title, content, extraHtml);

    const result = await sendEmailViaBrevo({
      to: toEmail,
      subject: cfg.subject,
      htmlContent: htmlBody,
      senderEmail: 'no-reply@kidcode-eg.com',
      senderName: PROJECT_NAME,
      replyToEmail: 'sales@kidcode-eg.com',
      replyToName: PROJECT_NAME + ' - Sales'
    });

    if (result.success) {
      console.log(`📧 [sendWithdrawStatusEmail] ${marketerCode} | ${data.status} → ${toEmail}`);
    }

    return result;

  } catch (e) {
    console.error('❌ [sendWithdrawStatusEmail]', e.message);
    return { success: false, error: e.message };
  }
}