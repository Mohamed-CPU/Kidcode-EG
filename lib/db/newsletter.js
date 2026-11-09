// ================================================================
//  lib/db/newsletter.js — إدارة النشرة البريدية
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { TABLES } from './tables.js';
import { sendNewsletterWelcomeEmail, sendMissingAlertEmail } from '../email/brevo.js';

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
//  1️⃣ subscribeNewsletter
// ============================================================
export async function subscribeNewsletter(params) {
  const name = String(params.name || '').trim();
  const email = String(params.email || '').trim().toLowerCase();
  const phone = String(params.phone || '').trim();

  if (!name) return { success: false, error: 'الاسم مطلوب' };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: 'بريد إلكتروني غير صحيح' };
  }
  if (!phone || phone.replace(/\D/g, '').length < 10) {
    return { success: false, error: 'رقم هاتف غير صحيح' };
  }

  try {
    // ✅ التحقق من التكرار (نشط)
    const { data: existing } = await supabaseAdmin
      .from(TABLES.NEWSLETTER)
      .select('email,is_active')
      .eq('email', email)
      .maybeSingle();

    if (existing && String(existing.is_active || '').trim() === 'نشط') {
      return { success: false, error: 'هذا البريد الإلكتروني مسجل بالفعل في النشرة.' };
    }

    // ✅ إنشاء token للإلغاء
    const unsubscribeToken = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
    const now = nowEgypt();

    // ✅ INSERT أو UPDATE
    if (existing) {
      // كان مسجل قبل وملغي → نحدّث
      const { error: updErr } = await supabaseAdmin
        .from(TABLES.NEWSLETTER)
        .update({
          name, phone,
          is_active: 'نشط',
          unsubscribe_token: unsubscribeToken,
          timestamp: now
        })
        .eq('email', email);
      if (updErr) return { success: false, error: updErr.message };
    } else {
      const { error: insErr } = await supabaseAdmin
        .from(TABLES.NEWSLETTER)
        .insert({
          timestamp: now,
          name, email, phone,
          is_active: 'نشط',
          unsubscribe_token: unsubscribeToken
        });
      if (insErr) return { success: false, error: insErr.message };
    }

    console.log(`✅ [subscribeNewsletter] ${email}`);

    // ✅ إيميل ترحيبي (best-effort)
    try {
      await sendNewsletterWelcomeEmail(email, name, unsubscribeToken);
    } catch (e) {
      console.warn('⚠️ [subscribeNewsletter] welcome email:', e.message);
    }

    return { success: true, message: 'تم التسجيل بنجاح! سيصلك بريد تأكيد قريباً.' };

  } catch (err) {
    console.error('❌ [subscribeNewsletter]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  2️⃣ unsubscribeSubscriber
// ============================================================
export async function unsubscribeSubscriber(params) {
  const token = String(params.token || '').trim();
  if (!token) return { success: false, error: 'رمز إلغاء الاشتراك مطلوب' };

  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.NEWSLETTER)
      .select('email,name,is_active')
      .eq('unsubscribe_token', token)
      .maybeSingle();

    if (error) return { success: false, error: error.message };
    if (!data) return { success: false, error: 'رمز إلغاء الاشتراك غير صالح' };

    if (String(data.is_active || '').trim() !== 'نشط') {
      return { success: false, error: 'تم إلغاء الاشتراك بالفعل' };
    }

    const { error: updErr } = await supabaseAdmin
      .from(TABLES.NEWSLETTER)
      .update({ is_active: 'ملغي' })
      .eq('unsubscribe_token', token);

    if (updErr) return { success: false, error: updErr.message };

    console.log(`✅ [unsubscribeSubscriber] ${data.email}`);
    return {
      success: true,
      message: 'تم إلغاء اشتراكك من النشرة بنجاح. لن تصلك أي رسائل تنبيه مستقبلاً.'
    };

  } catch (err) {
    console.error('❌ [unsubscribeSubscriber]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  3️⃣ getActiveSubscribers
// ============================================================
export async function getActiveSubscribers() {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.NEWSLETTER)
      .select('name,email,phone,unsubscribe_token')
      .eq('is_active', 'نشط');

    if (error) {
      console.error('❌ [getActiveSubscribers]', error.message);
      return [];
    }

    return (data || []).map(row => ({
      name: String(row.name || '').trim(),
      email: String(row.email || '').trim(),
      phone: String(row.phone || '').trim(),
      token: String(row.unsubscribe_token || '').trim()
    })).filter(s => s.email);

  } catch (err) {
    console.error('❌ [getActiveSubscribers]', err.message);
    return [];
  }
}

// ============================================================
//  4️⃣ sendMissingAlertToSubscribers
//  - يُستدعى عند إنشاء بلاغ اختفاء
// ============================================================
export async function sendMissingAlertToSubscribers(childID, reportData, childData) {
  try {
    const subscribers = await getActiveSubscribers();
    if (subscribers.length === 0) {
      console.log('ℹ️ [sendMissingAlertToSubscribers] لا يوجد مشتركون نشطون');
      return { success: true, sent: 0, failed: 0 };
    }

    const childName = String(childData.childName || 'الطفل').trim();
    const imageFileId = String(childData.imageFileId || '').trim();

    const reportId = reportData.reportId || '';
    const clothes = reportData.clothes || '';
    const governorate = reportData.governorate || '';
    const district = reportData.district || '';
    const landmark = reportData.landmark || '';

    // ✅ Brevo Batch — 100 per batch
    const BATCH_SIZE = 100;
    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
      const batch = subscribers.slice(i, i + BATCH_SIZE);

      try {
        const result = await sendMissingAlertEmail(batch, {
          childID,
          childName,
          imageFileId,
          reportId,
          clothes,
          governorate,
          district,
          landmark
        });

        if (result.success) {
          sentCount += batch.length;
        } else {
          failedCount += batch.length;
        }
      } catch (e) {
        failedCount += batch.length;
        console.error('⚠️ [sendMissingAlertToSubscribers] batch error:', e.message);
      }
    }

    console.log(`✅ [sendMissingAlertToSubscribers] sent=${sentCount} failed=${failedCount}`);
    return { success: true, sent: sentCount, failed: failedCount };

  } catch (err) {
    console.error('❌ [sendMissingAlertToSubscribers]', err.message);
    return { success: false, error: err.message };
  }
}