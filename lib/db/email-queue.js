// ================================================================
//  lib/db/email-queue.js — معالجة الطوابير
//  - processEmailQueue: إعادة إرسال بريد ترحيب الأطفال
//  - processBulkEmailQueue: معالجة طابور الحملات (EmailQueue)
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN } from './tables.js';
import { sendClientEmail, buildEmailHtml, wrapBodyHtml, sendEmailViaBrevo } from '../email/brevo.js';

const MAX_RETRIES = 3;
const MAX_PER_RUN = 90;
const DELAY_MS = 150;

const BULK_MAX_PER_RUN = 200;
const BULK_MAX_ATTEMPTS = 3;
const BULK_DELAY_MS = 200;

// ============================================================
//  🕐 توقيت مصر
// ============================================================
function nowEgypt() {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).replace('T', ' ');
}

// ============================================================
//  🔄 applyPlaceholders
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
//  🚀 processEmailQueue — إعادة إرسال بريد ترحيب الأطفال
//  (يبقى كما هو — لا تغيير)
// ============================================================
export async function processEmailQueue() {
  const t0 = Date.now();
  console.log('📬 [EmailQueue] بدء المعالجة...');

  try {
    const { data: children, error } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select(`child_id,child_name,email_code,status,email_sent,email_retry_count,qr_code_pics,child_link`)
      .in('status', ['active', 'pending'])
      .neq(COLS_CHILDREN.email_sent, 'تم')
      .lt(COLS_CHILDREN.email_retry_count, MAX_RETRIES)
      .not('email_code', 'is', null)
      .limit(MAX_PER_RUN);

    if (error) {
      console.error('❌ [EmailQueue] SELECT error:', error.message);
      return { success: false, error: error.message };
    }

    const eligible = (children || []).filter(c => {
      const email = String(c[COLS_CHILDREN.email_code] || '').trim();
      return email.length > 0;
    });

    if (eligible.length === 0) {
      console.log('ℹ️ [EmailQueue] مفيش إيميلات للإرسال');
      return { success: true, sent: 0, failed: 0, total: 0 };
    }

    console.log(`📤 [EmailQueue] ${eligible.length} إيميل للإرسال`);

    let sentCount = 0;
    let errorCount = 0;

    for (const child of eligible) {
      const childID = String(child[COLS_CHILDREN.child_id]).trim();
      const email = String(child[COLS_CHILDREN.email_code]).trim();
      const qrFileId = String(child[COLS_CHILDREN.qr_code_pics] || '').trim();

      try {
        const emailResult = await sendClientEmail(email, childID, '', qrFileId);

        if (emailResult && emailResult.success) {
          await supabaseAdmin
            .from(TABLES.CHILDREN)
            .update({
              [COLS_CHILDREN.email_sent]: 'تم',
              [COLS_CHILDREN.email_retry_count]: 0
            })
            .eq(COLS_CHILDREN.child_id, childID);

          sentCount++;
          console.log(`✅ [EmailQueue] ${childID} → ${email}`);
        } else {
          const currentRetry = parseInt(child[COLS_CHILDREN.email_retry_count] || '0', 10);
          await supabaseAdmin
            .from(TABLES.CHILDREN)
            .update({ [COLS_CHILDREN.email_retry_count]: currentRetry + 1 })
            .eq(COLS_CHILDREN.child_id, childID);

          errorCount++;
          console.warn(`⚠️ [EmailQueue] فشل ${childID}: ${emailResult?.error}`);
        }
      } catch (err) {
        errorCount++;
        console.error(`❌ [EmailQueue] استثناء ${childID}:`, err.message);
      }

      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    console.log(`✅ [EmailQueue] اكتمل: ${sentCount} نجح، ${errorCount} فشل (${Date.now() - t0}ms)`);

    return {
      success: true,
      sent: sentCount,
      failed: errorCount,
      total: eligible.length
    };

  } catch (err) {
    console.error('❌ [EmailQueue]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  📬 processBulkEmailQueue — معالجة طابور الحملات
//  - يقرأ من جدول EmailQueue حيث status=pending و scheduled_for <= الآن
//  - يرسل عبر Brevo ويُحدِّث الحالة
// ============================================================
export async function processBulkEmailQueue() {
  const t0 = Date.now();
  console.log('📬 [BulkEmailQueue] بدء المعالجة...');

  try {
    const now = nowEgypt();

    // 1. جيب الصفوف المستحقة
    const { data: rows, error } = await supabaseAdmin
      .from(TABLES.EMAIL_QUEUE)
      .select('id,campaign_id,recipient_email,recipient_name,subject,body_html,attachments,attempts,status,scheduled_for')
      .eq('status', 'pending')
      .lte('scheduled_for', now)
      .lt('attempts', BULK_MAX_ATTEMPTS)
      .order('scheduled_for', { ascending: true })
      .limit(BULK_MAX_PER_RUN);

    if (error) {
      console.error('❌ [BulkEmailQueue] SELECT error:', error.message);
      return { success: false, error: error.message };
    }

    if (!rows || rows.length === 0) {
      console.log('ℹ️ [BulkEmailQueue] مفيش رسائل للإرسال');
      return { success: true, sent: 0, failed: 0, total: 0 };
    }

    console.log(`📤 [BulkEmailQueue] ${rows.length} رسالة للإرسال`);

    let sentCount = 0;
    let failedCount = 0;

    // 2. إرسال كل رسالة
    for (const row of rows) {
      try {
        // استبدال المتغيرات
        const params2 = {
          name: row.recipient_name || '',
          email: row.recipient_email || ''
        };
        const personalizedSubject = applyPlaceholders(row.subject, params2);
        const personalizedBody = applyPlaceholders(row.body_html, params2);
        // ✅ auto-detect: HTML كامل أم inline
        const wrappedHtml = wrapBodyHtml(personalizedBody);

        // ✅ المرفقات
        const attachments = Array.isArray(row.attachments) ? row.attachments : [];

        const result = await sendEmailViaBrevo({
          to: row.recipient_email,
          subject: personalizedSubject,
          htmlContent: wrappedHtml,
          attachments: attachments,
          senderEmail: 'info@kidcode-eg.com',
          senderName: 'KidCode-EG',
          replyToEmail: 'info@kidcode-eg.com',
          replyToName: 'KidCode-EG - Info'
        });

        if (result && result.success) {
          await supabaseAdmin
            .from(TABLES.EMAIL_QUEUE)
            .update({
              status: 'sent',
              sent_at: nowEgypt(),
              last_error: null
            })
            .eq('id', row.id);

          sentCount++;
        } else {
          const newAttempts = (parseInt(row.attempts || '0', 10) + 1);
          const newStatus = newAttempts >= BULK_MAX_ATTEMPTS ? 'failed' : 'pending';

          await supabaseAdmin
            .from(TABLES.EMAIL_QUEUE)
            .update({
              attempts: newAttempts,
              status: newStatus,
              last_error: String(result?.error || 'unknown').substring(0, 500)
            })
            .eq('id', row.id);

          failedCount++;
          console.warn(`⚠️ [BulkEmailQueue] فشل ${row.recipient_email}: ${result?.error}`);
        }
      } catch (err) {
        failedCount++;
        console.error(`❌ [BulkEmailQueue] استثناء ${row.recipient_email}:`, err.message);

        const newAttempts = (parseInt(row.attempts || '0', 10) + 1);
        const newStatus = newAttempts >= BULK_MAX_ATTEMPTS ? 'failed' : 'pending';

        try {
          await supabaseAdmin
            .from(TABLES.EMAIL_QUEUE)
            .update({
              attempts: newAttempts,
              status: newStatus,
              last_error: String(err.message || '').substring(0, 500)
            })
            .eq('id', row.id);
        } catch (e) {}
      }

      await new Promise(r => setTimeout(r, BULK_DELAY_MS));
    }

    console.log(`✅ [BulkEmailQueue] اكتمل: ${sentCount} نجح، ${failedCount} فشل (${Date.now() - t0}ms)`);

    return {
      success: true,
      sent: sentCount,
      failed: failedCount,
      total: rows.length
    };

  } catch (err) {
    console.error('❌ [BulkEmailQueue]', err.message);
    return { success: false, error: err.message };
  }
}