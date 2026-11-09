// ================================================================
//  lib/db/weekly-reports.js — التقارير الأسبوعية للأسرة
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN } from './tables.js';
import { notifyFamily } from '../notify.js';

const DELAY_MS = 150;
const MAX_PER_RUN = 90;

// ============================================================
//  🕐 توقيت مصر
// ============================================================
function nowEgyptDate() {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).split(' ')[0]; // yyyy-mm-dd
}

// ============================================================
//  📅 حساب المدة المتبقية
// ============================================================
function calculateDaysRemaining(expiryRaw) {
  if (!expiryRaw) return { days: null, text: 'غير متاح' };
  const expiry = new Date(expiryRaw);
  if (isNaN(expiry.getTime())) return { days: null, text: 'غير متاح' };

  const diffMs = expiry.getTime() - Date.now();
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (days <= 0) return { days: 0, text: '⛔ منتهي' };

  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  const remainingDays = days % 30;

  const parts = [];
  if (years > 0) parts.push(years + ' سنة');
  if (months > 0) parts.push(months + ' شهر');
  if (remainingDays > 0) parts.push(remainingDays + ' يوم');

  return { days, text: parts.length ? parts.join(' و ') : 'أقل من يوم' };
}

// ============================================================
//  🚀 sendWeeklyFamilyReports
// ============================================================
export async function sendWeeklyFamilyReports() {
  const t0 = Date.now();
  console.log('📊 [WeeklyFamilyReports] بدء المعالجة...');

  try {
    // 1. جيب كل الأطفال النشطين
    // ✅ نوسع الـ select ليشمل حقول الإشعارات + تليجرام
    const { data: children, error } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select('child_id,child_name,email_code,status,plan,expiry_date,scan_count,notification_method,telegram_chat_id_father,telegram_chat_id_mother,telegram_chat_id')
      .eq(COLS_CHILDREN.status, 'active');

    if (error) {
      console.error('❌ [WeeklyFamilyReports] SELECT:', error.message);
      return { success: false, error: error.message };
    }

    if (!children || children.length === 0) {
      console.log('ℹ️ [WeeklyFamilyReports] مفيش أطفال نشطين');
      return { success: true, sent: 0, failed: 0, total: 0 };
    }

    // 2. جيب ScanLogs آخر 7 أيام
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const { data: scanRows } = await supabaseAdmin
      .from(TABLES.SCAN_LOGS)
      .select('child_id,timestamp')
      .gte('timestamp', weekAgo.toISOString());

    // 3. تجميع عدد المسحات الأسبوعية لكل طفل
    const weeklyScansMap = {};
    (scanRows || []).forEach(row => {
      const id = String(row.child_id || '').trim();
      if (id) weeklyScansMap[id] = (weeklyScansMap[id] || 0) + 1;
    });

    // 4. الإرسال
    let sentCount = 0;
    let errorCount = 0;
    const limited = children.slice(0, MAX_PER_RUN);

    for (const child of limited) {
      const childID = String(child[COLS_CHILDREN.child_id]).trim();
      const plan = String(child[COLS_CHILDREN.plan] || '').trim();
      const totalScans = parseInt(child[COLS_CHILDREN.scan_count] || '0', 10);
      const weeklyScans = weeklyScansMap[childID] || 0;
      const duration = calculateDaysRemaining(child[COLS_CHILDREN.expiry_date]);

      // ✅ فحص: عند إيميل أو chat_id على الأقل؟
      const hasEmail = !!String(child[COLS_CHILDREN.email_code] || '').trim();
      const hasTelegram =
        !!String(child[COLS_CHILDREN.telegram_chat_id_father] || '').trim() ||
        !!String(child[COLS_CHILDREN.telegram_chat_id_mother] || '').trim() ||
        !!String(child[COLS_CHILDREN.telegram_chat_id] || '').trim();

      if (!hasEmail && !hasTelegram) {
        // مفيش أي قناة إشعار → تخطى
        errorCount++;
        continue;
      }

      try {
        // ✅ notifyFamily بتحدد التليجرام/الإيميل تلقائيًا حسب notification_method
        const result = await notifyFamily({
          childID: childID,
          eventType: 'weekly_report',
          eventData: {
            plan: plan,
            totalScans: totalScans,
            weeklyScans: weeklyScans,
            daysRemaining: duration.text,
            expiryStatus: (duration.days !== null && duration.days <= 30) ? 'ينتهي قريباً' : 'نشط'
          },
          // ✅ نمرر الطفل كامل بدون Query إضافي
          _preloadedChild: child
        });

        if (result && result.success) {
          sentCount++;
        } else {
          errorCount++;
          console.log(`⚠️ [WeeklyFamilyReports] فشل ${childID}: ${result.error || 'unknown'}`);
        }
      } catch (err) {
        errorCount++;
        console.error(`❌ [WeeklyFamilyReports] ${childID}:`, err.message);
      }

      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    console.log(`✅ [WeeklyFamilyReports] اكتمل: ${sentCount}/${limited.length} (${Date.now() - t0}ms)`);

    return {
      success: true,
      sent: sentCount,
      failed: errorCount,
      total: limited.length,
      period: nowEgyptDate()
    };

  } catch (err) {
    console.error('❌ [WeeklyFamilyReports]', err.message);
    return { success: false, error: err.message };
  }
}