// ================================================================
//  lib/admin/scan-logs.js — سجل المسحات
//  ⚠️ بعد Migration: ScanLogs.timestamp = timestamptz
//  ✅ المقارنات: ISO UTC | فلترة التواريخ: cairoDateBoundaryUTC (DST-aware)
//  🐛 Fix: فلترة fromDate/toDate كانت متأخرة ساعتين
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN } from '../db/tables.js';
import { getClientIP } from './auth.js';
import { writeAuditLog } from './audit.js';

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

// ============================================================
//  🕐 دوال الوقت
// ============================================================
function nowUTC() {
  return new Date().toISOString();
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
//  📋 getScanLogsList
//  ✅ فلترة fromDate/toDate بـ UTC boundaries (Cairo-aware)
// ============================================================
export async function getScanLogsList(params) {
  const page = Math.max(1, parseInt(params.page) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(params.pageSize) || PAGE_SIZE_DEFAULT)
  );
  const search = String(params.search || '').trim();
  const childID = String(params.childID || '').trim();
  const source = String(params.source || '').trim();
  const fromDate = String(params.fromDate || '').trim();
  const toDate = String(params.toDate || '').trim();
  const sortDir = String(params.sortDir || 'desc').trim().toLowerCase() === 'asc';

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from(TABLES.SCAN_LOGS)
    .select('*', { count: 'exact' });

  // ✅ فلترة من تاريخ — 00:00:00 Cairo (يحسب DST)
  if (fromDate) {
    const fromUTC = cairoDateBoundaryUTC(fromDate, false);
    if (fromUTC) {
      query = query.gte('timestamp', fromUTC);
    }
  }
  // ✅ فلترة لتاريخ — 23:59:59.999 Cairo (يحسب DST)
  if (toDate) {
    const toUTC = cairoDateBoundaryUTC(toDate, true);
    if (toUTC) {
      query = query.lte('timestamp', toUTC);
    }
  }

  // فلترة الطفل (حقل مخصص)
  if (childID) {
    const safeCID = childID.replace(/[%_,()'"]/g, '').trim();
    if (safeCID) {
      query = query.ilike('child_id', '%' + safeCID + '%');
    }
  }

  // فلترة المصدر
  if (source) {
    query = query.eq('location_source', source);
  }

  // ✅ البحث العام — استراتيجية محسّنة
  if (search) {
    // نظّف الأحرف الخاصة — نحتفظ بـ % لأننا سنستخدمها
    const safe = search.replace(/[_,()'"]/g, '').trim();

    if (safe) {
      console.log('[getScanLogsList] search term:', safe);

      // استراتيجية 1: إذا كان يشبه كود طفل → ilike مباشر
      const looksLikeChildCode = /^(?:kc[-\s]?)?\d{2,}$/i.test(safe);

      if (looksLikeChildCode) {
        const codeOnly = safe.replace(/^kc[-\s]?/i, '');
        console.log('[getScanLogsList] child code detected:', codeOnly);
        query = query.ilike('child_id', '%' + codeOnly + '%');
      } else {
        // استراتيجية 2: بحث عام — نستخدم % داخل or()
        // ملاحظة: PostgREST يقبل % كـ wildcard، وليس *
        const pattern = '%' + safe + '%';
        const orString = [
          'child_id.ilike.' + pattern,
          'address.ilike.' + pattern,
          'ip.ilike.' + pattern
        ].join(',');

        console.log('[getScanLogsList] or string:', orString);

        try {
          query = query.or(orString);
        } catch (orError) {
          console.error('[getScanLogsList] or() failed:', orError.message);
          query = query.ilike('child_id', pattern);
        }
      }
    }
  }

  query = query.order('timestamp', { ascending: sortDir }).range(from, to);

  const { data, error, count } = await query;

  if (error) {
    console.error('[getScanLogsList] query error:', error.message);
    return { success: false, error: error.message };
  }

  const rows = data || [];

  // جلب أسماء الأطفال
  const uniqueChildIds = [...new Set(rows.map(r => r.child_id).filter(Boolean))];
  let nameMap = {};

  if (uniqueChildIds.length > 0) {
    try {
      const { data: children } = await supabaseAdmin
        .from(TABLES.CHILDREN)
        .select(`${COLS_CHILDREN.child_id},${COLS_CHILDREN.child_name}`)
        .in(COLS_CHILDREN.child_id, uniqueChildIds);

      (children || []).forEach(c => {
        nameMap[c[COLS_CHILDREN.child_id]] = c[COLS_CHILDREN.child_name] || '';
      });
    } catch (e) {
      console.warn('[getScanLogsList] child names fetch failed:', e.message);
    }
  }

  const list = rows.map(function(r) {
    const lat = String(r.latitude || '').trim();
    const lng = String(r.longitude || '').trim();
    const hasCoords = isNumericCoord(lat) && isNumericCoord(lng);
    const mapsLink = hasCoords
      ? `https://maps.google.com/?q=${lat},${lng}`
      : '';

    return {
      id: r.id,
      timestamp: r.timestamp,   // ISO من timestamptz — الفرونت بيتعامل معاه
      childID: String(r.child_id || '').trim(),
      childName: nameMap[r.child_id] || '',
      latitude: lat,
      longitude: lng,
      address: String(r.address || '').trim(),
      source: String(r.location_source || '').trim(),
      userAgent: String(r.user_agent || '').trim(),
      ip: String(r.ip || '').trim(),
      mapsLink: mapsLink,
      hasCoords: hasCoords
    };
  });

  return {
    success: true,
    list: list,
    pagination: {
      page: page,
      pageSize: pageSize,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / pageSize)
    }
  };
}

// ============================================================
//  🗺️ isNumericCoord
// ============================================================
function isNumericCoord(value) {
  const s = String(value || '').trim().toUpperCase();
  if (!s) return false;
  if (['REFUSED', 'FAILED', 'UNAVAILABLE', 'UNDEFINED', 'NULL', 'NAN', '#NUM!'].includes(s)) {
    return false;
  }
  const num = parseFloat(s.replace(/[٫،]/g, '.').replace(/,/g, '.'));
  return !isNaN(num);
}

// ============================================================
//  📊 getScanLogsStats
//  ✅ مقارنات UTC ISO (كانت Cairo string → shift +2h)
// ============================================================
export async function getScanLogsStats() {
  // ✅ UTC ISO — timestamptz يفهمها صح
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const [totalRes, last24hRes, last7dRes] = await Promise.all([
      supabaseAdmin.from(TABLES.SCAN_LOGS).select('id', { count: 'exact', head: true }),
      supabaseAdmin.from(TABLES.SCAN_LOGS).select('id', { count: 'exact', head: true }).gte('timestamp', yesterday),
      supabaseAdmin.from(TABLES.SCAN_LOGS).select('id', { count: 'exact', head: true }).gte('timestamp', weekAgo)
    ]);

    return {
      success: true,
      total: totalRes.count || 0,
      last24h: last24hRes.count || 0,
      last7d: last7dRes.count || 0
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🗑️ deleteScanLog
// ============================================================
export async function deleteScanLog(params) {
  const id = parseInt(params.id);
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!id || id <= 0) return { success: false, error: 'missing_id' };

  const { error } = await supabaseAdmin
    .from(TABLES.SCAN_LOGS)
    .delete()
    .eq('id', id);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'delete_scan_log',
    target_table: TABLES.SCAN_LOGS,
    target_id: String(id),
    ip_address: getClientIP(req)
  });

  return { success: true, message: 'تم حذف السجل' };
}

// ============================================================
//  🧹 cleanupOldScanLogs — حذف السجلات الأقدم من N شهر
//  ✅ cutoff: ISO UTC (كان Cairo string → shift +2h)
// ============================================================
export async function cleanupOldScanLogs(params) {
  const months = parseInt(params.months) || 12;
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (months < 1 || months > 60) {
    return { success: false, error: 'invalid_months', message: 'عدد الأشهر يجب أن يكون بين 1 و 60' };
  }

  // ✅ UTC ISO — timestamptz يفهمها صح
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - months);
  const cutoff = cutoffDate.toISOString();

  // اعدّ أولاً
  const { count } = await supabaseAdmin
    .from(TABLES.SCAN_LOGS)
    .select('id', { count: 'exact', head: true })
    .lt('timestamp', cutoff);

  if (!count || count === 0) {
    return { success: true, deleted: 0, message: 'لا توجد سجلات أقدم من ' + months + ' شهر' };
  }

  // احذف
  const { error } = await supabaseAdmin
    .from(TABLES.SCAN_LOGS)
    .delete()
    .lt('timestamp', cutoff);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'cleanup_scan_logs',
    target_table: TABLES.SCAN_LOGS,
    target_id: count + ' records',
    changes: { before_date: cutoff, deleted: count },
    ip_address: getClientIP(req)
  });

  const countText = count === 1 ? 'سجل واحد'
                : count === 2 ? 'سجلين'
                : (count >= 3 && count <= 10) ? count + ' سجلات'
                : count + ' سجلًا';
const monthsText = months === 1 ? 'شهر واحد'
                 : months === 2 ? 'شهرين'
                 : (months >= 3 && months <= 10) ? months + ' أشهر'
                 : months + ' شهرًا';
return {
  success: true,
  deleted: count,
  message: 'تم حذف ' + countText + ' أقدم من ' + monthsText
};
}