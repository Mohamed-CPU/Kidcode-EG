// ================================================================
//  lib/db/contact.js — نموذج التواصل
// ================================================================

import crypto from 'crypto';
import { cacheGet, cachePut } from '../cache.js';
import { sendContactAdminEmail, sendContactUserEmail } from '../email/brevo.js';

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
//  🚀 sendContactFormEmail
// ============================================================
export async function sendContactFormEmail(data) {
  try {
    const name = String(data.name || '').trim().substring(0, 60);
    const email = String(data.email || '').trim().toLowerCase().substring(0, 100);
    const phone = String(data.phone || '').trim().substring(0, 20);
    const subject = String(data.subject || '').trim().substring(0, 100);
    const message = String(data.message || '').trim().substring(0, 1500);

    // ✅ Validation
    if (!name || name.length < 2) return { success: false, error: 'الاسم مطلوب' };
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return { success: false, error: 'البريد الإلكتروني غير صحيح' };
    }
    if (!subject) return { success: false, error: 'الموضوع مطلوب' };
    if (!message || message.length < 10) {
      return { success: false, error: 'الرسالة قصيرة جداً' };
    }

    // ✅ Rate Limiting
    const rateKey = 'contact_' + email.replace(/[^a-z0-9]/g, '_');
    if (cacheGet(rateKey)) {
      return { success: false, error: 'يرجى الانتظار قبل إرسال رسالة أخرى' };
    }
    cachePut(rateKey, '1', 120);

    const now = nowEgypt();
    const submissionId = 'MSG-' + crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase();

    // 1. إيميل الأدمن
    const adminResult = await sendContactAdminEmail({
      submissionId, name, email, phone, subject, message, now
    });

    if (!adminResult.success) {
      console.error(`❌ [sendContactFormEmail] admin: ${adminResult.error}`);
      return { success: false, error: 'فشل إرسال الرسالة. يرجى المحاولة مرة أخرى.' };
    }

    // 2. Auto-reply (best-effort)
    try {
      await sendContactUserEmail({ email, name, submissionId, subject, now });
    } catch (e) {
      console.warn('⚠️ [sendContactFormEmail] auto-reply:', e.message);
    }

    console.log(`✅ [sendContactFormEmail] ${submissionId} | ${email}`);
    return { success: true, submissionId, message: 'تم استلام رسالتك بنجاح' };

  } catch (err) {
    console.error('❌ [sendContactFormEmail]', err.message);
    return { success: false, error: err.message };
  }
}