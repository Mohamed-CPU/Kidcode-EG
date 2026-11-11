// ================================================================
//  lib/admin/emails.js — مركز البريد (Backend)
//  ⚠️ بعد Migration: EmailCampaigns + EmailQueue = timestamptz
//  ✅ الكتابة: nowUTC() | scheduled_for: nextMidnightUTC() (DST-aware)
//  🐛 Fix: فلترة fromDate/toDate كانت متأخرة ساعتين
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN, COLS_MARKETERS } from '../db/tables.js';
import { getClientIP } from './auth.js';
import { writeAuditLog } from './audit.js';
import {
  buildEmailHtml,
  wrapBodyHtml,
  sendBulkEmailViaBrevo,
  sendEmailViaBrevo
} from '../email/brevo.js';
import {
  uploadToCloudinary,
  detectResourceType
} from '../cloudinary.js';
import {
  getEmailTemplates,
  getEmailTemplateDetails,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  seedDefaultTemplates
} from '../db/email-templates.js';

const IMMEDIATE_LIMIT = 200;
const PROJECT_NAME = 'KidCode-EG';

// ✅ حدود المرفقات
const MAX_ATTACHMENTS_COUNT = 5;
const MAX_TOTAL_ATTACHMENTS_BYTES = 8 * 1024 * 1024; // 8MB

// ============================================================
//  🔍 validateAttachments — فحص المرفقات قبل الحفظ
// ============================================================
function validateAttachments(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { success: true, list: [] };
  }
  if (raw.length > MAX_ATTACHMENTS_COUNT) {
    return { success: false, error: 'too_many_attachments', message: 'الحد الأقصى ' + MAX_ATTACHMENTS_COUNT + ' مرفقات' };
  }

  const list = [];
  let totalBytes = 0;

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const url = String(item.url || '').trim();
    if (!url.startsWith('https://')) {
      return { success: false, error: 'invalid_attachment_url', message: 'رابط مرفق غير صالح' };
    }
    const name = String(item.name || 'file').substring(0, 250);
    const size = parseInt(item.size || 0, 10) || 0;
    const type = String(item.type || '').substring(0, 50);

    totalBytes += size;
    if (totalBytes > MAX_TOTAL_ATTACHMENTS_BYTES) {
      return { success: false, error: 'attachments_too_large', message: 'حجم المرفقات يتجاوز 8 ميجابايت' };
    }
    list.push({ url, name, size, type });
  }

  return { success: true, list };
}

// ============================================================
//  🕐 دوال الوقت
// ============================================================
function nowUTC() {
  // ⚠️ للكتابة في timestamptz — UTC ISO
  return new Date().toISOString();
}

// ─────────────────────────────────────────────────────────────
//  🕛 nextMidnightUTC — 00:05 Cairo من اليوم التالي (UTC ISO)
//  - يحسب DST تلقائياً عبر Intl
// ─────────────────────────────────────────────────────────────
function nextMidnightUTC() {
  const now = new Date();

  // مكونات Cairo لليوم الحالي
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const get = t => parseInt(parts.find(p => p.type === t)?.value || '0', 10);
  const cairoY = get('year');
  const cairoM = get('month');
  const cairoD = get('day');

  // 00:05 من اليوم التالي (Cairo) — نفترض كأنها UTC (probe)
  const naiveUTC = Date.UTC(cairoY, cairoM - 1, cairoD + 1, 0, 5, 0);

  // نحسب إيه اللي Cairo هيعرضه لو الـ probe كان UTC
  const probe = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(new Date(naiveUTC));
  const pget = t => parseInt(probe.find(p => p.type === t)?.value || '0', 10);
  const cairoAsUTC = Date.UTC(
    pget('year'), pget('month') - 1, pget('day'),
    pget('hour'), pget('minute'), pget('second')
  );

  const offsetMs = cairoAsUTC - naiveUTC;
  return new Date(naiveUTC - offsetMs).toISOString();
}

// ─────────────────────────────────────────────────────────────
//  📅 cairoDateBoundaryUTC — حدود اليوم Cairo (UTC ISO)
//  - "2026-11-12" + endOfDay=false → 00:00:00 Cairo UTC ISO
//  - "2026-11-12" + endOfDay=true  → 23:59:59.999 Cairo UTC ISO
//  - يحسب DST تلقائياً
// ─────────────────────────────────────────────────────────────
function cairoDateBoundaryUTC(dateStr, endOfDay) {
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  const [y, m, d] = parts;

  const naiveUTC = Date.UTC(y, m - 1, d, 0, 0, 0);

  const probe = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(new Date(naiveUTC));
  const pget = t => parseInt(probe.find(p => p.type === t)?.value || '0', 10);
  const cairoAsUTC = Date.UTC(
    pget('year'), pget('month') - 1, pget('day'),
    pget('hour'), pget('minute'), pget('second')
  );
  const offsetMs = cairoAsUTC - naiveUTC;
  const startUTC = naiveUTC - offsetMs;

  return new Date(endOfDay ? startUTC + 24 * 60 * 60 * 1000 - 1 : startUTC).toISOString();
}

// ============================================================
//  🎯 buildRecipients — جمع المستلمين حسب الفلتر
//  ✅ فلترة registration_date بـ UTC boundaries (Cairo-aware)
// ============================================================
async function buildRecipients(type, filter) {
  filter = filter || {};

  // ==========================================================
  //  الأطفال
  // ==========================================================
  if (type === 'children') {
    let query = supabaseAdmin
      .from(TABLES.CHILDREN)
      .select(`${COLS_CHILDREN.child_id},${COLS_CHILDREN.child_name},${COLS_CHILDREN.email_code},${COLS_CHILDREN.status},${COLS_CHILDREN.plan},${COLS_CHILDREN.registration_date},${COLS_CHILDREN.marketer_id}`);

    if (filter.status) {
      query = query.eq(COLS_CHILDREN.status, filter.status);
    }
    if (filter.plan) {
      query = query.eq(COLS_CHILDREN.plan, filter.plan);
    }
    // ✅ فلترة fromDate — 00:00:00 Cairo (يحسب DST)
    if (filter.fromDate) {
      const fromUTC = cairoDateBoundaryUTC(filter.fromDate, false);
      if (fromUTC) {
        query = query.gte(COLS_CHILDREN.registration_date, fromUTC);
      }
    }
    // ✅ فلترة toDate — 23:59:59.999 Cairo (يحسب DST)
    if (filter.toDate) {
      const toUTC = cairoDateBoundaryUTC(filter.toDate, true);
      if (toUTC) {
        query = query.lte(COLS_CHILDREN.registration_date, toUTC);
      }
    }
    if (filter.hasMarketer === true) {
      query = query.neq(COLS_CHILDREN.marketer_id, '');
    } else if (filter.hasMarketer === false) {
      query = query.or(`${COLS_CHILDREN.marketer_id}.is.null,${COLS_CHILDREN.marketer_id}.eq.`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    // فلترة البريد الصالح
    return (data || [])
      .filter(c => {
        const email = String(c[COLS_CHILDREN.email_code] || '').trim();
        return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      })
      .map(c => ({
        email: String(c[COLS_CHILDREN.email_code]).trim().toLowerCase(),
        name: String(c[COLS_CHILDREN.child_name] || '').trim(),
        params: {
          name: c[COLS_CHILDREN.child_name] || '',
          child_id: c[COLS_CHILDREN.child_id] || '',
          code: c[COLS_CHILDREN.child_id] || ''
        }
      }));
  }

  // ==========================================================
  //  المسوقون
  // ==========================================================
  if (type === 'marketers') {
    let query = supabaseAdmin
      .from(TABLES.MARKETERS)
      .select(`${COLS_MARKETERS.code},${COLS_MARKETERS.name},${COLS_MARKETERS.email},${COLS_MARKETERS.is_active},${COLS_MARKETERS.governorate},${COLS_MARKETERS.telegram_chat_id}`);

    if (filter.isActive) {
      query = query.eq(COLS_MARKETERS.is_active, filter.isActive);
    }
    if (filter.governorate) {
      query = query.eq(COLS_MARKETERS.governorate, filter.governorate);
    }
    if (filter.hasTelegram === true) {
      query = query.neq(COLS_MARKETERS.telegram_chat_id, '');
    } else if (filter.hasTelegram === false) {
      query = query.or(`${COLS_MARKETERS.telegram_chat_id}.is.null,${COLS_MARKETERS.telegram_chat_id}.eq.`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return (data || [])
      .filter(m => {
        const email = String(m[COLS_MARKETERS.email] || '').trim();
        return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      })
      .map(m => ({
        email: String(m[COLS_MARKETERS.email]).trim().toLowerCase(),
        name: String(m[COLS_MARKETERS.name] || '').trim(),
        params: {
          name: m[COLS_MARKETERS.name] || '',
          code: m[COLS_MARKETERS.code] || '',
          marketer_code: m[COLS_MARKETERS.code] || ''
        }
      }));
  }

  // ==========================================================
  //  المشتركون
  // ==========================================================
  if (type === 'newsletter') {
    let query = supabaseAdmin
      .from(TABLES.NEWSLETTER)
      .select('id,name,email,is_active');

    if (filter.isActive === 'active') {
      query = query.in('is_active', ['نعم', 'نشط', 'yes', 'true', '1', 'active']);
    } else if (filter.isActive === 'inactive') {
      query = query.not('is_active', 'in', '(نعم,نشط,yes,true,1,active)');
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return (data || [])
      .filter(s => {
        const email = String(s.email || '').trim();
        return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      })
      .map(s => ({
        email: String(s.email).trim().toLowerCase(),
        name: String(s.name || '').trim(),
        params: {
          name: s.name || '',
          email: s.email || ''
        }
      }));
  }

  throw new Error('invalid_type');
}

// ============================================================
//  📊 getRecipientsCount — عدد المستلمين المتوقع
// ============================================================
export async function getRecipientsCount(params) {
  const type = String(params.type || '').trim();
  const filter = params.filter || {};

  try {
    const recipients = await buildRecipients(type, filter);

    // إزالة التكرار (نفس البريد)
    const uniqueEmails = new Set(recipients.map(r => r.email));

    return {
      success: true,
      count: uniqueEmails.size,
      immediate: Math.min(uniqueEmails.size, IMMEDIATE_LIMIT),
      queued: Math.max(0, uniqueEmails.size - IMMEDIATE_LIMIT)
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🔄 applyPlaceholders — استبدال المتغيرات
// ============================================================
function applyPlaceholders(template, params) {
  if (!template) return '';
  let result = String(template);
  for (const [key, value] of Object.entries(params || {})) {
    const regex = new RegExp('\\{' + key + '\\}', 'g');
    result = result.replace(regex, String(value || ''));
  }
  return result;
}

// ============================================================
//  📤 sendBulkEmail — إرسال جماعي مع طابور
// ============================================================
export async function sendBulkEmail(params) {
  const type = String(params.type || '').trim();
  const filter = params.filter || {};
  const subject = String(params.subject || '').trim();
  const bodyHtml = String(params.bodyHtml || '').trim();
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!subject) return { success: false, error: 'missing_subject', message: 'الموضوع مطلوب' };
  if (!bodyHtml) return { success: false, error: 'missing_body', message: 'المحتوى مطلوب' };

  // ✅ التحقق من المرفقات
  const attValidation = validateAttachments(params.attachments);
  if (!attValidation.success) return attValidation;
  const attachments = attValidation.list;

  // 1. جمع المستلمين
  let recipients;
  try {
    recipients = await buildRecipients(type, filter);
  } catch (e) {
    return { success: false, error: 'invalid_type', message: e.message };
  }

  // 2. إزالة التكرار
  const uniqueMap = new Map();
  recipients.forEach(r => {
    if (!uniqueMap.has(r.email)) uniqueMap.set(r.email, r);
  });
  recipients = Array.from(uniqueMap.values());

  if (recipients.length === 0) {
    return { success: false, error: 'no_recipients', message: 'لا يوجد مستلمون يطابقون الفلتر' };
  }

  // 3. تقسيم فوري/طابور
  const immediate = recipients.slice(0, IMMEDIATE_LIMIT);
  const queued = recipients.slice(IMMEDIATE_LIMIT);

  // 4. إنشاء Campaign — ✅ UTC ISO
  const { data: campaign, error: campError } = await supabaseAdmin
    .from(TABLES.EMAIL_CAMPAIGNS)
    .insert({
      admin_username: adminUsername,
      subject: subject,
      body_html: bodyHtml,
      attachments: attachments.length > 0 ? attachments : null,
      recipient_type: type,
      recipient_filter: filter,
      recipient_count: recipients.length,
      immediate_count: immediate.length,
      queued_count: queued.length,
      status: queued.length > 0 ? 'partially_sent' : 'sending',
      created_at: nowUTC()
    })
    .select()
    .single();

  if (campError) {
    console.error('[sendBulkEmail] campaign insert error:', campError.message);
    return { success: false, error: 'campaign_insert_failed', message: campError.message };
  }

  const campaignId = campaign.id;

  // 5. الإرسال الفوري (200 كحد أقصى)
  let sendResult = { sent: 0, failed: 0 };
  if (immediate.length > 0) {
    try {
      const result = await sendBulkEmailViaBrevo(
        immediate,
        function(recipient) {
          const personalizedSubject = applyPlaceholders(subject, recipient.params);
          const personalizedBody = applyPlaceholders(bodyHtml, recipient.params);
          const wrappedHtml = wrapBodyHtml(personalizedBody);
          return { subject: personalizedSubject, htmlContent: wrappedHtml };
        },
        {
          senderEmail: 'info@kidcode-eg.com',
          senderName: PROJECT_NAME,
          replyToEmail: 'info@kidcode-eg.com',
          replyToName: PROJECT_NAME + ' - Info',
          attachments: attachments
        }
      );
      sendResult = { sent: result.sent, failed: result.failed };
    } catch (e) {
      console.error('[sendBulkEmail] immediate send error:', e.message);
      sendResult = { sent: 0, failed: immediate.length };
    }
  }

  // 6. إدراج الطابور الليلي — ✅ nextMidnightUTC (DST-aware) + nowUTC
  let queuedCount = 0;
  let scheduledForISO = null;
  if (queued.length > 0) {
    scheduledForISO = nextMidnightUTC();
    const createdAtISO = nowUTC();
    const rows = queued.map(r => ({
      campaign_id: campaignId,
      recipient_email: r.email,
      recipient_name: r.name || '',
      subject: subject,
      body_html: bodyHtml,
      attachments: attachments.length > 0 ? attachments : null,
      status: 'pending',
      attempts: 0,
      scheduled_for: scheduledForISO,
      created_at: createdAtISO
    }));

    // إدراج على دفعات
    const INSERT_BATCH = 100;
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const batch = rows.slice(i, i + INSERT_BATCH);
      const { error: insertErr } = await supabaseAdmin
        .from(TABLES.EMAIL_QUEUE)
        .insert(batch);
      if (insertErr) {
        console.error('[sendBulkEmail] queue insert error:', insertErr.message);
      } else {
        queuedCount += batch.length;
      }
    }
  }

  // 7. تحديث حالة الحملة — ✅ UTC ISO
  const finalStatus = queuedCount > 0 ? 'partially_sent' : 'sent';
  await supabaseAdmin
    .from(TABLES.EMAIL_CAMPAIGNS)
    .update({
      status: finalStatus,
      sent_at: nowUTC()
    })
    .eq('id', campaignId);

  // 8. Audit
  await writeAuditLog({
    username: adminUsername,
    action: 'send_bulk_email',
    target_table: TABLES.EMAIL_CAMPAIGNS,
    target_id: String(campaignId),
    changes: {
      type: type,
      total: recipients.length,
      immediate_sent: sendResult.sent,
      queued: queuedCount
    },
    ip_address: getClientIP(req)
  });

  const sentText = sendResult.sent === 1 ? 'رسالة واحدة'
                 : sendResult.sent === 2 ? 'رسالتين'
                 : (sendResult.sent >= 3 && sendResult.sent <= 10) ? sendResult.sent + ' رسائل'
                 : sendResult.sent + ' رسالة';

  return {
    success: true,
    campaignId: campaignId,
    total: recipients.length,
    immediateSent: sendResult.sent,
    immediateFailed: sendResult.failed,
    queued: queuedCount,
    scheduledFor: scheduledForISO,
    message: queuedCount > 0
      ? `تم إرسال ${sentText} الآن، و${queuedCount} في الطابور الليلي (00:05)`
      : `تم إرسال ${sentText}`
  };
}

// ============================================================
//  📧 sendCustomEmail — إرسال لقائمة بريدات مخصصة
// ============================================================
export async function sendCustomEmail(params) {
  const subject = String(params.subject || '').trim();
  const bodyHtml = String(params.bodyHtml || '').trim();
  const emailsRaw = Array.isArray(params.emails) ? params.emails : [];
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!subject) return { success: false, error: 'missing_subject' };
  if (!bodyHtml) return { success: false, error: 'missing_body' };

  // ✅ التحقق من المرفقات
  const attValidation = validateAttachments(params.attachments);
  if (!attValidation.success) return attValidation;
  const attachments = attValidation.list;

  // تنظيف وتحقق من البريدات
  const validEmails = [];
  const seen = new Set();
  for (const raw of emailsRaw) {
    const email = String(raw || '').trim().toLowerCase();
    if (!email) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    validEmails.push({ email: email, name: '', params: { email: email, name: '' } });
  }

  if (validEmails.length === 0) {
    return { success: false, error: 'no_valid_emails', message: 'لا توجد بريدات صالحة' };
  }

  // نفس منطق sendBulkEmail
  const immediate = validEmails.slice(0, IMMEDIATE_LIMIT);
  const queued = validEmails.slice(IMMEDIATE_LIMIT);

  // ✅ UTC ISO
  const { data: campaign, error } = await supabaseAdmin
    .from(TABLES.EMAIL_CAMPAIGNS)
    .insert({
      admin_username: adminUsername,
      subject: subject,
      body_html: bodyHtml,
      attachments: attachments.length > 0 ? attachments : null,
      recipient_type: 'custom',
      recipient_filter: { emails: validEmails.slice(0, 50).map(e => e.email) },
      recipient_count: validEmails.length,
      immediate_count: immediate.length,
      queued_count: queued.length,
      status: queued.length > 0 ? 'partially_sent' : 'sending',
      created_at: nowUTC()
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  let sendResult = { sent: 0, failed: 0 };
  if (immediate.length > 0) {
    try {
      const result = await sendBulkEmailViaBrevo(
        immediate,
        function(r) {
          const wrappedHtml = wrapBodyHtml(bodyHtml);
          return { subject: subject, htmlContent: wrappedHtml };
        },
        {
          senderEmail: 'info@kidcode-eg.com',
          senderName: PROJECT_NAME,
          replyToEmail: 'info@kidcode-eg.com',
          replyToName: PROJECT_NAME + ' - Info',
          attachments: attachments
        }
      );
      sendResult = { sent: result.sent, failed: result.failed };
    } catch (e) {
      sendResult = { sent: 0, failed: immediate.length };
    }
  }

  let queuedCount = 0;
  if (queued.length > 0) {
    const midnight = nextMidnightUTC();
    const createdAtISO = nowUTC();
    const rows = queued.map(r => ({
      campaign_id: campaign.id,
      recipient_email: r.email,
      recipient_name: '',
      subject: subject,
      body_html: bodyHtml,
      attachments: attachments.length > 0 ? attachments : null,
      status: 'pending',
      attempts: 0,
      scheduled_for: midnight,
      created_at: createdAtISO
    }));

    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error: insertErr } = await supabaseAdmin
        .from(TABLES.EMAIL_QUEUE)
        .insert(batch);
      if (!insertErr) queuedCount += batch.length;
    }
  }

  // ✅ UTC ISO
  await supabaseAdmin
    .from(TABLES.EMAIL_CAMPAIGNS)
    .update({
      status: queuedCount > 0 ? 'partially_sent' : 'sent',
      sent_at: nowUTC()
    })
    .eq('id', campaign.id);

  await writeAuditLog({
    username: adminUsername,
    action: 'send_custom_email',
    target_table: TABLES.EMAIL_CAMPAIGNS,
    target_id: String(campaign.id),
    changes: { total: validEmails.length, sent: sendResult.sent, queued: queuedCount },
    ip_address: getClientIP(req)
  });

  const sentTextCustom = sendResult.sent === 1 ? 'رسالة واحدة'
                       : sendResult.sent === 2 ? 'رسالتين'
                       : (sendResult.sent >= 3 && sendResult.sent <= 10) ? sendResult.sent + ' رسائل'
                       : sendResult.sent + ' رسالة';

  return {
    success: true,
    campaignId: campaign.id,
    total: validEmails.length,
    immediateSent: sendResult.sent,
    queued: queuedCount,
    message: queuedCount > 0
      ? `تم إرسال ${sentTextCustom} الآن، و${queuedCount} في الطابور الليلي`
      : `تم إرسال ${sentTextCustom}`
  };
}

// ============================================================
//  🎯 sendSingleEmail — إرسال لطفل/مسوق/مشترك واحد
// ============================================================
export async function sendSingleEmail(params) {
  const type = String(params.type || '').trim();
  const identifier = String(params.identifier || '').trim();
  const subject = String(params.subject || '').trim();
  const bodyHtml = String(params.bodyHtml || '').trim();
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!subject) return { success: false, error: 'missing_subject' };
  if (!bodyHtml) return { success: false, error: 'missing_body' };
  if (!identifier) return { success: false, error: 'missing_identifier' };

  // ✅ التحقق من المرفقات
  const attValidation = validateAttachments(params.attachments);
  if (!attValidation.success) return attValidation;
  const attachments = attValidation.list;

  let email = '';
  let name = '';
  let params2 = {};

  // ----- طفل -----
  if (type === 'child') {
    const { data } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select(`${COLS_CHILDREN.child_id},${COLS_CHILDREN.child_name},${COLS_CHILDREN.email_code}`)
      .eq(COLS_CHILDREN.child_id, identifier.toUpperCase())
      .maybeSingle();

    if (!data) return { success: false, error: 'not_found', message: 'الطفل غير موجود' };
    email = String(data[COLS_CHILDREN.email_code] || '').trim().toLowerCase();
    name = String(data[COLS_CHILDREN.child_name] || '').trim();
    params2 = { name: name, child_id: data[COLS_CHILDREN.child_id], code: data[COLS_CHILDREN.child_id] };
  }
  // ----- مسوق -----
  else if (type === 'marketer') {
    const { data } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .select(`${COLS_MARKETERS.code},${COLS_MARKETERS.name},${COLS_MARKETERS.email}`)
      .eq(COLS_MARKETERS.code, identifier.toUpperCase())
      .maybeSingle();

    if (!data) return { success: false, error: 'not_found', message: 'المسوق غير موجود' };
    email = String(data[COLS_MARKETERS.email] || '').trim().toLowerCase();
    name = String(data[COLS_MARKETERS.name] || '').trim();
    params2 = { name: name, code: data[COLS_MARKETERS.code], marketer_code: data[COLS_MARKETERS.code] };
  }
  // ----- مشترك -----
  else if (type === 'subscriber') {
    const { data } = await supabaseAdmin
      .from(TABLES.NEWSLETTER)
      .select('email,name')
      .eq('email', identifier.toLowerCase())
      .maybeSingle();

    if (!data) return { success: false, error: 'not_found', message: 'المشترك غير موجود' };
    email = data.email;
    name = String(data.name || '').trim();
    params2 = { name: name, email: email };
  }
  else {
    return { success: false, error: 'invalid_type' };
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: 'no_email', message: 'لا يوجد بريد صالح' };
  }

  const personalizedSubject = applyPlaceholders(subject, params2);
  const personalizedBody = applyPlaceholders(bodyHtml, params2);
  const wrappedHtml = wrapBodyHtml(personalizedBody);

  const result = await sendEmailViaBrevo({
    to: email,
    subject: personalizedSubject,
    htmlContent: wrappedHtml,
    attachments: attachments,
    senderEmail: 'info@kidcode-eg.com',
    senderName: PROJECT_NAME,
    replyToEmail: 'info@kidcode-eg.com',
    replyToName: PROJECT_NAME + ' - Info'
  });

  await writeAuditLog({
    username: adminUsername,
    action: 'send_single_email',
    target_table: type === 'child' ? TABLES.CHILDREN : (type === 'marketer' ? TABLES.MARKETERS : TABLES.NEWSLETTER),
    target_id: identifier,
    changes: { email: email, subject: subject },
    ip_address: getClientIP(req)
  });

  if (!result.success) {
    return { success: false, error: result.error || 'send_failed', message: 'فشل الإرسال' };
  }

  return {
    success: true,
    email: email,
    name: name,
    message: 'تم الإرسال بنجاح'
  };
}

// ============================================================
//  📋 getCampaignsList — سجل الحملات
//  ⚠️ قراءة فقط — created_at/sent_at بيرجعوا ISO جاهز للفرونت
// ============================================================
export async function getCampaignsList(params) {
  const page = Math.max(1, parseInt(params.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize) || 30));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabaseAdmin
    .from(TABLES.EMAIL_CAMPAIGNS)
    .select('id,admin_username,subject,recipient_type,recipient_count,immediate_count,queued_count,status,created_at,sent_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) return { success: false, error: error.message };

  return {
    success: true,
    list: data || [],
    pagination: {
      page: page,
      pageSize: pageSize,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / pageSize)
    }
  };
}

// ============================================================
//  📊 getQueueStats — إحصائيات الطابور
// ============================================================
export async function getQueueStats() {
  try {
    const [pending, sent, failed] = await Promise.all([
      supabaseAdmin.from(TABLES.EMAIL_QUEUE).select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabaseAdmin.from(TABLES.EMAIL_QUEUE).select('id', { count: 'exact', head: true }).eq('status', 'sent'),
      supabaseAdmin.from(TABLES.EMAIL_QUEUE).select('id', { count: 'exact', head: true }).eq('status', 'failed')
    ]);

    // متى موعد الإرسال القادم
    const { data: nextRow } = await supabaseAdmin
      .from(TABLES.EMAIL_QUEUE)
      .select('scheduled_for')
      .eq('status', 'pending')
      .order('scheduled_for', { ascending: true })
      .limit(1)
      .maybeSingle();

    return {
      success: true,
      pending: pending.count || 0,
      sent: sent.count || 0,
      failed: failed.count || 0,
      nextScheduled: nextRow ? nextRow.scheduled_for : null
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🚫 cancelCampaign — إلغاء إرسال حملة (المتبقي في الطابور فقط)
// ============================================================
export async function cancelCampaign(params) {
  const id = parseInt(params.id);
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!id || id <= 0) return { success: false, error: 'missing_id' };

  const { error } = await supabaseAdmin
    .from(TABLES.EMAIL_QUEUE)
    .update({ status: 'cancelled' })
    .eq('campaign_id', id)
    .eq('status', 'pending');

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'cancel_campaign',
    target_table: TABLES.EMAIL_CAMPAIGNS,
    target_id: String(id),
    ip_address: getClientIP(req)
  });

  return { success: true, message: 'تم إلغاء الرسائل المتبقية في الطابور' };
}

// ============================================================
//  📤 uploadEmailAsset — رفع صورة/ملف لـ Cloudinary
// ============================================================
export async function uploadEmailAsset(params) {
  const base64 = String(params.base64 || '');
  const fileName = String(params.fileName || '').trim();
  const mimeType = String(params.mimeType || '').trim();

  if (!base64) {
    return { success: false, error: 'missing_file', message: 'الملف مطلوب' };
  }

  // الحد الأقصى: 4MB (Base64 → ~5.4MB in transit، أقل من Vercel's 4.5MB)
  const sizeBytes = Math.ceil((base64.length * 3) / 4);
  const MAX_FILE_SIZE = 4 * 1024 * 1024;
  if (sizeBytes > MAX_FILE_SIZE) {
    return {
      success: false,
      error: 'file_too_large',
      message: 'حجم الملف يتجاوز 4 ميجابايت'
    };
  }

  const resourceType = detectResourceType(fileName, mimeType);

  const result = await uploadToCloudinary({
    base64,
    resourceType,
    fileName,
    tags: 'email-asset'
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error || 'upload_failed',
      message: 'فشل رفع الملف، يرجى المحاولة مرة أخرى'
    };
  }

  return {
    success: true,
    url: result.url,
    publicId: result.publicId,
    bytes: result.bytes,
    format: result.format,
    resourceType: result.resourceType,
    originalName: fileName
  };
}

// ============================================================
//  📋 getEmailTemplatesList — قائمة القوالب (Seed تلقائي)
// ============================================================
export async function getEmailTemplatesList(params) {
  try {
    // ✅ Seed تلقائي في أول استدعاء
    await seedDefaultTemplates();

    const filters = {
      category: params && params.category,
      activeOnly: params && params.activeOnly === true
    };

    const result = await getEmailTemplates(filters);
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🔍 getEmailTemplate — قالب واحد (مع body_html)
// ============================================================
export async function getEmailTemplate(params) {
  return await getEmailTemplateDetails(params.id);
}

// ============================================================
//  ➕ createEmailTemplateAction
// ============================================================
export async function createEmailTemplateAction(params) {
  const result = await createEmailTemplate({
    name: params.name,
    category: params.category,
    subject: params.subject,
    bodyHtml: params.bodyHtml,
    createdBy: params.adminUsername
  });

  if (result.success) {
    await writeAuditLog({
      username: params.adminUsername,
      action: 'create_email_template',
      target_table: TABLES.EMAIL_TEMPLATES,
      target_id: String(result.template.id),
      changes: { name: params.name, category: params.category },
      ip_address: getClientIP(params.req)
    });
  }

  return result;
}

// ============================================================
//  ✏️ updateEmailTemplateAction
// ============================================================
export async function updateEmailTemplateAction(params) {
  const result = await updateEmailTemplate({
    id: params.id,
    updates: params.updates || {}
  });

  if (result.success) {
    await writeAuditLog({
      username: params.adminUsername,
      action: 'update_email_template',
      target_table: TABLES.EMAIL_TEMPLATES,
      target_id: String(params.id),
      changes: { keys: Object.keys(params.updates || {}) },
      ip_address: getClientIP(params.req)
    });
  }

  return result;
}

// ============================================================
//  🗑️ deleteEmailTemplateAction
// ============================================================
export async function deleteEmailTemplateAction(params) {
  const result = await deleteEmailTemplate({ id: params.id });

  if (result.success) {
    await writeAuditLog({
      username: params.adminUsername,
      action: 'delete_email_template',
      target_table: TABLES.EMAIL_TEMPLATES,
      target_id: String(params.id),
      ip_address: getClientIP(params.req)
    });
  }

  return result;
}