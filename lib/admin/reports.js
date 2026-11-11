// ================================================================
//  lib/admin/reports.js — إدارة بلاغات الاختفاء
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN } from '../db/tables.js';
import { getClientIP } from './auth.js';
import { writeAuditLog } from './audit.js';

// ============================================================
//  🕐 دوال الوقت
// ============================================================
function nowUTC() {
  // ⚠️ للكتابة في timestamptz — UTC ISO
  return new Date().toISOString();
}

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

// ============================================================
//  🔐 الحقول المسموح بتعديلها
// ============================================================
const EDITABLE_FIELDS = {
  'clothes': 'string',
  'governorate': 'string',
  'district': 'string',
  'landmark': 'string',
  'volunteer_name': 'string',
  'volunteer_phone': 'string',
  'is_resolved': 'enum'
};

const VALID_STATUS = ['لا', 'awaiting_confirmation', 'نعم'];

// ============================================================
//  📋 getReportsList
// ============================================================
export async function getReportsList(params) {
  const page = Math.max(1, parseInt(params.page) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(params.pageSize) || PAGE_SIZE_DEFAULT)
  );
  const search = String(params.search || '').trim();
  const status = String(params.status || '').trim();
  const sortDir = String(params.sortDir || 'desc').trim().toLowerCase() === 'asc';

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from(TABLES.MISSING_REPORTS)
    .select('*', { count: 'exact' });

  // فلترة الحالة
  if (status) {
    if (status === 'open') {
      query = query.eq('is_resolved', 'لا');
    } else if (status === 'awaiting') {
      query = query.eq('is_resolved', 'awaiting_confirmation');
    } else if (status === 'resolved') {
      query = query.eq('is_resolved', 'نعم');
    } else if (VALID_STATUS.includes(status)) {
      query = query.eq('is_resolved', status);
    }
  }

  // البحث
  if (search) {
    const safe = search.replace(/[%_,*()'"]/g, '').trim();
    if (safe) {
      const pattern = '%' + safe + '%';
      const orString = [
        'report_id.ilike.' + pattern,
        'child_id.ilike.' + pattern,
        'volunteer_name.ilike.' + pattern,
        'volunteer_phone.ilike.' + pattern,
        'district.ilike.' + pattern
      ].join(',');

      try {
        query = query.or(orString);
      } catch (e) {
        console.error('[getReportsList] or() failed:', e.message);
        query = query.ilike('child_id', pattern);
      }
    }
  }

  query = query.order('report_time', { ascending: sortDir }).range(from, to);

  const { data, error, count } = await query;

  if (error) return { success: false, error: error.message };

  const rows = data || [];

  // جلب أسماء الأطفال
  const uniqueChildIds = [...new Set(rows.map(r => r.child_id).filter(Boolean))];
  let childMap = {};

  if (uniqueChildIds.length > 0) {
    try {
      const { data: children } = await supabaseAdmin
        .from(TABLES.CHILDREN)
        .select(`${COLS_CHILDREN.child_id},${COLS_CHILDREN.child_name},${COLS_CHILDREN.status},${COLS_CHILDREN.child_image_url}`)
        .in(COLS_CHILDREN.child_id, uniqueChildIds);

      (children || []).forEach(c => {
        childMap[c[COLS_CHILDREN.child_id]] = {
          name: c[COLS_CHILDREN.child_name] || '',
          status: c[COLS_CHILDREN.status] || '',
          imageUrl: c[COLS_CHILDREN.child_image_url] || ''
        };
      });
    } catch (e) {}
  }

  const list = rows.map(function(r) {
    const childInfo = childMap[r.child_id] || {};
    return {
      reportID: String(r.report_id || '').trim(),
      childID: String(r.child_id || '').trim(),
      childName: childInfo.name || '',
      childStatus: childInfo.status || '',
      childImageUrl: childInfo.imageUrl || '',
      reportTime: r.report_time,
      clothes: String(r.clothes || '').trim(),
      governorate: String(r.governorate || '').trim(),
      district: String(r.district || '').trim(),
      landmark: String(r.landmark || '').trim(),
      isResolved: String(r.is_resolved || 'لا').trim(),
      resolvedTime: r.resolved_time,
      resolvedBy: String(r.resolved_by || '').trim(),
      volunteerName: String(r.volunteer_name || '').trim(),
      volunteerPhone: String(r.volunteer_phone || '').trim(),
      hasVolunteerId: !!(r.front_id_file || r.back_id_file),
      foundConfirmedAt: r.found_confirmed_at
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
//  📊 getReportsStats
// ============================================================
export async function getReportsStats() {
  try {
    const [total, open, awaiting, resolved] = await Promise.all([
      supabaseAdmin.from(TABLES.MISSING_REPORTS).select('report_id', { count: 'exact', head: true }),
      supabaseAdmin.from(TABLES.MISSING_REPORTS).select('report_id', { count: 'exact', head: true }).eq('is_resolved', 'لا'),
      supabaseAdmin.from(TABLES.MISSING_REPORTS).select('report_id', { count: 'exact', head: true }).eq('is_resolved', 'awaiting_confirmation'),
      supabaseAdmin.from(TABLES.MISSING_REPORTS).select('report_id', { count: 'exact', head: true }).eq('is_resolved', 'نعم')
    ]);

    return {
      success: true,
      total: total.count || 0,
      open: open.count || 0,
      awaiting: awaiting.count || 0,
      resolved: resolved.count || 0
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🔍 getReportDetails
// ============================================================
export async function getReportDetails(reportID) {
  const cleanID = String(reportID || '').trim();
  if (!cleanID) return { success: false, error: 'missing_report_id' };

  const { data: report, error } = await supabaseAdmin
    .from(TABLES.MISSING_REPORTS)
    .select('*')
    .eq('report_id', cleanID)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!report) return { success: false, error: 'not_found', message: 'البلاغ غير موجود' };

  // جيب بيانات الطفل
  let child = null;
  if (report.child_id) {
    const { data: c } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select(`${COLS_CHILDREN.child_id},${COLS_CHILDREN.child_name},${COLS_CHILDREN.status},${COLS_CHILDREN.child_image_url},${COLS_CHILDREN.father_phone},${COLS_CHILDREN.mother_phone},${COLS_CHILDREN.email_code}`)
      .eq(COLS_CHILDREN.child_id, report.child_id)
      .maybeSingle();

    if (c) {
      child = {
        childID: c[COLS_CHILDREN.child_id],
        childName: c[COLS_CHILDREN.child_name],
        status: c[COLS_CHILDREN.status],
        imageUrl: c[COLS_CHILDREN.child_image_url],
        fatherPhone: c[COLS_CHILDREN.father_phone],
        motherPhone: c[COLS_CHILDREN.mother_phone],
        email: c[COLS_CHILDREN.email_code]
      };
    }
  }

  return { success: true, report: report, child: child };
}

// ============================================================
//  ✏️ updateReport
// ============================================================
export async function updateReport(params) {
  const reportID = String(params.reportID || '').trim();
  const updates = params.updates || {};
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!reportID) return { success: false, error: 'missing_report_id' };
  if (!updates || typeof updates !== 'object') return { success: false, error: 'missing_updates' };

  const { data: existing } = await supabaseAdmin
    .from(TABLES.MISSING_REPORTS)
    .select('*')
    .eq('report_id', reportID)
    .maybeSingle();

  if (!existing) return { success: false, error: 'not_found' };

  const finalUpdates = {};
  const changesLog = {};

  for (const [key, rawValue] of Object.entries(updates)) {
    const type = EDITABLE_FIELDS[key];
    if (!type) continue;

    let value = rawValue;

    if (type === 'enum') {
      if (key === 'is_resolved' && !VALID_STATUS.includes(value)) continue;
    }

    if (type === 'string') {
      value = String(value === null || value === undefined ? '' : value).trim();
      if (value.length > 500) value = value.substring(0, 500);
    }

    const oldValue = existing[key];
    const oldStr = oldValue === null || oldValue === undefined ? '' : String(oldValue);
    const newStr = value === null || value === undefined ? '' : String(value);
    if (oldStr === newStr) continue;

    finalUpdates[key] = value;
    changesLog[key] = { before: oldStr.substring(0, 100), after: newStr.substring(0, 100) };
  }

  if (Object.keys(finalUpdates).length === 0) {
    return { success: true, message: 'لا توجد تغييرات', changedFields: [] };
  }

  // لو تغيّرت الحالة إلى "نعم" → حدّث resolved_time + resolved_by
  if (finalUpdates.is_resolved === 'نعم' && existing.is_resolved !== 'نعم') {
    // ✅ UTC ISO — timestamptz يفهمها صح
    finalUpdates.resolved_time = nowUTC();
    finalUpdates.resolved_by = adminUsername;
  }

  const { error } = await supabaseAdmin
    .from(TABLES.MISSING_REPORTS)
    .update(finalUpdates)
    .eq('report_id', reportID);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'update_report',
    target_table: TABLES.MISSING_REPORTS,
    target_id: reportID,
    changes: changesLog,
    ip_address: getClientIP(req),
    user_agent: req ? String(req.headers['user-agent'] || '').substring(0, 300) : null
  });

  return {
    success: true,
    message: 'تم التحديث بنجاح',
    changedFields: Object.keys(changesLog)
  };
}

// ============================================================
//  ✅ closeReport — إغلاق بلاغ (من الأدمن مباشرة)
// ============================================================
export async function closeReport(params) {
  const reportID = String(params.reportID || '').trim();
  const adminUsername = params.adminUsername || 'unknown';
  const note = String(params.note || '').trim();
  const req = params.req;

  if (!reportID) return { success: false, error: 'missing_report_id' };

  const { data: existing } = await supabaseAdmin
    .from(TABLES.MISSING_REPORTS)
    .select('report_id, is_resolved, child_id')
    .eq('report_id', reportID)
    .maybeSingle();

  if (!existing) return { success: false, error: 'not_found' };
  if (existing.is_resolved === 'نعم') {
    return { success: false, error: 'already_closed', message: 'البلاغ مغلق بالفعل' };
  }

  const { error } = await supabaseAdmin
    .from(TABLES.MISSING_REPORTS)
    .update({
      is_resolved: 'نعم',
      // ✅ UTC ISO — timestamptz يفهمها صح
      resolved_time: nowUTC(),
      resolved_by: adminUsername
    })
    .eq('report_id', reportID);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'close_report',
    target_table: TABLES.MISSING_REPORTS,
    target_id: reportID,
    changes: {
      child_id: existing.child_id,
      note: note || null
    },
    ip_address: getClientIP(req),
    user_agent: req ? String(req.headers['user-agent'] || '').substring(0, 300) : null
  });

  return { success: true, message: 'تم إغلاق البلاغ' };
}

// ============================================================
//  🗑️ deleteReport
// ============================================================
export async function deleteReport(params) {
  const reportID = String(params.reportID || '').trim();
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!reportID) return { success: false, error: 'missing_report_id' };

  const { data: existing } = await supabaseAdmin
    .from(TABLES.MISSING_REPORTS)
    .select('report_id, child_id')
    .eq('report_id', reportID)
    .maybeSingle();

  if (!existing) return { success: false, error: 'not_found' };

  const { error } = await supabaseAdmin
    .from(TABLES.MISSING_REPORTS)
    .delete()
    .eq('report_id', reportID);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'delete_report',
    target_table: TABLES.MISSING_REPORTS,
    target_id: reportID,
    changes: { child_id: existing.child_id },
    ip_address: getClientIP(req)
  });

  return { success: true, message: 'تم الحذف النهائي' };
}