// ================================================================
//  lib/admin/dashboard.js — إحصائيات لوحة المعلومات
//  ⚠️ بعد Migration: registration_date/created_at = timestamptz
//  ✅ getRegistrationsChart: grouping بتوقيت Cairo (مش UTC)
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN, COLS_MARKETERS } from '../db/tables.js';

// ============================================================
//  🕐 دوال الوقت
// ============================================================
function cairoDateStr(date) {
  // "YYYY-MM-DD" بتوقيت Cairo — للـ grouping في المخططات
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  const g = t => (parts.find(p => p.type === t)?.value || '');
  return `${g('year')}-${g('month')}-${g('day')}`;
}

// ============================================================
//  📊 getDashboardStats — كل الإحصائيات مرة واحدة
// ============================================================
export async function getDashboardStats() {
  const t0 = Date.now();

  try {
    const [
      childrenData,
      marketersCount,
      newsletterCount,
      reportsCount,
      adminsCount,
      registrationsChart,
      recentRegistrations,
      recentActivity
    ] = await Promise.all([
      getChildrenStats(),
      getMarketersCount(),
      getNewsletterCount(),
      getReportsCount(),
      getAdminsCount(),
      getRegistrationsChart(30),
      getRecentRegistrations(10),
      getRecentActivity(10)
    ]);

    return {
      success: true,
      stats: {
        children: childrenData.total,
        childrenByStatus: childrenData.byStatus,
        marketers: marketersCount,
        newsletter: newsletterCount,
        reports: reportsCount,
        admins: adminsCount
      },
      registrationsChart: registrationsChart,
      recentRegistrations: recentRegistrations,
      recentActivity: recentActivity,
      elapsedMs: Date.now() - t0
    };

  } catch (e) {
    console.error('[dashboard] error:', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  👶 getChildrenStats — إجمالي الأطفال + توزيع الحالة
// ============================================================
async function getChildrenStats() {
  const { data, error } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select(COLS_CHILDREN.status);

  if (error) return { total: 0, byStatus: {} };

  const byStatus = {
    active: 0,
    pending: 0,
    disabled: 0,
    suspended: 0,
    expired: 0,
    deleted: 0,
    other: 0
  };

  (data || []).forEach(function(row) {
    const s = String(row[COLS_CHILDREN.status] || '').trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(byStatus, s)) {
      byStatus[s]++;
    } else {
      byStatus.other++;
    }
  });

  return { total: (data || []).length, byStatus: byStatus };
}

// ============================================================
//  🧑‍💼 getMarketersCount
// ============================================================
async function getMarketersCount() {
  const { count } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .select('*', { count: 'exact', head: true })
    .eq(COLS_MARKETERS.is_active, 'نشط');

  return count || 0;
}

// ============================================================
//  📧 getNewsletterCount
// ============================================================
async function getNewsletterCount() {
  const { count } = await supabaseAdmin
    .from(TABLES.NEWSLETTER)
    .select('*', { count: 'exact', head: true });

  return count || 0;
}

// ============================================================
//  🚨 getReportsCount — البلاغات غير المحلولة
// ============================================================
async function getReportsCount() {
  try {
    const { count } = await supabaseAdmin
      .from(TABLES.MISSING_REPORTS)
      .select('*', { count: 'exact', head: true })
      .neq('is_resolved', 'نعم');
    return count || 0;
  } catch (e) {
    const { count } = await supabaseAdmin
      .from(TABLES.MISSING_REPORTS)
      .select('*', { count: 'exact', head: true });
    return count || 0;
  }
}

// ============================================================
//  🛡️ getAdminsCount
// ============================================================
async function getAdminsCount() {
  const { count } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .select('*', { count: 'exact', head: true })
    .eq('is_active', 'نشط');

  return count || 0;
}

// ============================================================
//  📈 getRegistrationsChart — تسجيلات آخر N يومًا
//  ✅ grouping بتوقيت Cairo — طفل اتسجل 23:00 Cairo يظهر في نفس اليوم
// ============================================================
async function getRegistrationsChart(days) {
  const now = new Date();

  const { data, error } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select(`${COLS_CHILDREN.registration_date},${COLS_CHILDREN.timestamp}`);

  if (error) return [];

  // ✅ خريطة الأيام بتوقيت Cairo (مش UTC)
  const dayMap = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const key = cairoDateStr(d);
    if (key) dayMap[key] = 0;
  }

  (data || []).forEach(function(row) {
    const raw = row[COLS_CHILDREN.registration_date] || row[COLS_CHILDREN.timestamp];
    if (!raw) return;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return;
    // ✅ key بتوقيت Cairo — يطابق dayMap keys
    const key = cairoDateStr(d);
    if (key && dayMap[key] !== undefined) dayMap[key]++;
  });

  return Object.keys(dayMap).sort().map(function(k) {
    return { date: k, count: dayMap[k] };
  });
}

// ============================================================
//  👶 getRecentRegistrations
// ============================================================
async function getRecentRegistrations(limit) {
  const { data, error } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select([
      COLS_CHILDREN.child_id,
      COLS_CHILDREN.child_name,
      COLS_CHILDREN.status,
      COLS_CHILDREN.plan,
      COLS_CHILDREN.registration_date
    ].join(','))
    .order(COLS_CHILDREN.registration_date, { ascending: false })
    .limit(limit);

  if (error) return [];

  return (data || []).map(function(row) {
    return {
      childID: row[COLS_CHILDREN.child_id],
      childName: row[COLS_CHILDREN.child_name],
      status: row[COLS_CHILDREN.status],
      plan: row[COLS_CHILDREN.plan],
      registrationDate: row[COLS_CHILDREN.registration_date]
    };
  });
}

// ============================================================
//  📋 getRecentActivity
// ============================================================
async function getRecentActivity(limit) {
  const { data, error } = await supabaseAdmin
    .from(TABLES.ADMIN_AUDIT_LOG)
    .select('id, username, action, target_table, target_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return [];

  return data || [];
}