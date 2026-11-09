// ================================================================
//  lib/admin/audit-log.js — سجل العمليات
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES } from '../db/tables.js';

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

// ============================================================
//  📋 getAuditLogList
// ============================================================
export async function getAuditLogList(params) {
  try {
    const page = Math.max(1, parseInt(params.page) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(params.pageSize) || 50));
    const search = String(params.search || '').trim();
    const username = String(params.username || '').trim();
    const action = String(params.action || '').trim();
    const targetTable = String(params.targetTable || '').trim();
    const fromDate = String(params.fromDate || '').trim();
    const toDate = String(params.toDate || '').trim();
    const sortDir = String(params.sortDir || 'desc').trim().toLowerCase() === 'asc';

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // ✅ select محدد — نتجنب '*' وجلب الأعمدة الكبيرة
    let query = supabaseAdmin
      .from(TABLES.ADMIN_AUDIT_LOG)
      .select('id,created_at,username,action,target_table,target_id,changes,ip_address,user_agent');

    // الفلاتر
    if (fromDate) query = query.gte('created_at', fromDate + ' 00:00:00');
    if (toDate) query = query.lte('created_at', toDate + ' 23:59:59');
    if (username) query = query.eq('username', username);
    if (action) query = query.eq('action', action);
    if (targetTable) query = query.eq('target_table', targetTable);

    // البحث — فقط على أعمدة نصية قصيرة
    if (search) {
      const safe = search.replace(/[%_,*()'"]/g, '').trim();
      if (safe) {
        const pattern = '%' + safe + '%';
        try {
          query = query.or([
            'action.ilike.' + pattern,
            'username.ilike.' + pattern,
            'target_id.ilike.' + pattern
          ].join(','));
        } catch (orErr) {
          console.warn('[getAuditLogList] or() failed:', orErr.message);
          query = query.ilike('action', pattern);
        }
      }
    }

    // ✅ بدون count: 'exact' في الاستعلام الأساسي — هذا كان سبب الفشل
    query = query.order('created_at', { ascending: sortDir }).range(from, to);

    const { data, error } = await query;

    if (error) {
      console.error('[getAuditLogList] query error:', JSON.stringify({
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      }));
      return {
        success: false,
        error: error.message,
        code: error.code || null,
        hint: error.hint || null
      };
    }

    // ✅ count منفصل — best-effort
    let total = 0;
    try {
      let countQuery = supabaseAdmin
        .from(TABLES.ADMIN_AUDIT_LOG)
        .select('id', { count: 'exact', head: true });

      if (fromDate) countQuery = countQuery.gte('created_at', fromDate + ' 00:00:00');
      if (toDate) countQuery = countQuery.lte('created_at', toDate + ' 23:59:59');
      if (username) countQuery = countQuery.eq('username', username);
      if (action) countQuery = countQuery.eq('action', action);
      if (targetTable) countQuery = countQuery.eq('target_table', targetTable);

      const { count } = await countQuery;
      total = count || 0;
    } catch (countErr) {
      console.warn('[getAuditLogList] count failed:', countErr.message);
      total = (data || []).length;
    }

    const list = (data || []).map(function(row) {
      return {
        id: row.id,
        username: String(row.username || '').trim(),
        action: String(row.action || '').trim(),
        targetTable: String(row.target_table || '').trim(),
        targetID: String(row.target_id || '').trim(),
        changes: row.changes,
        ipAddress: String(row.ip_address || '').trim(),
        userAgent: String(row.user_agent || '').trim(),
        createdAt: row.created_at
      };
    });

    return {
      success: true,
      list: list,
      pagination: {
        page: page,
        pageSize: pageSize,
        total: total,
        totalPages: total > 0 ? Math.ceil(total / pageSize) : 1
      }
    };
  } catch (e) {
    console.error('[getAuditLogList] exception:', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  📊 getAuditLogStats
// ============================================================
export async function getAuditLogStats() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const fmt = function(d) {
    return d.toLocaleString('sv-SE', { timeZone: 'Africa/Cairo', hour12: false }).replace('T', ' ');
  };

  try {
    const [total, todayRes, weekRes] = await Promise.all([
      supabaseAdmin.from(TABLES.ADMIN_AUDIT_LOG).select('id', { count: 'exact', head: true }),
      supabaseAdmin.from(TABLES.ADMIN_AUDIT_LOG).select('id', { count: 'exact', head: true }).gte('created_at', fmt(today)),
      supabaseAdmin.from(TABLES.ADMIN_AUDIT_LOG).select('id', { count: 'exact', head: true }).gte('created_at', fmt(week))
    ]);

    return {
      success: true,
      total: total.count || 0,
      today: todayRes.count || 0,
      thisWeek: weekRes.count || 0
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🎯 getAuditLogFilters — قوائم المستخدمين والأكشنات
// ============================================================
export async function getAuditLogFilters() {
  try {
    // آخر 1000 صف لجمع القيم الفريدة
    const { data, error } = await supabaseAdmin
      .from(TABLES.ADMIN_AUDIT_LOG)
      .select('username, action, target_table')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) return { success: false, error: error.message };

    const usernames = new Set();
    const actions = new Set();
    const tables = new Set();

    (data || []).forEach(function(r) {
      if (r.username) usernames.add(String(r.username).trim());
      if (r.action) actions.add(String(r.action).trim());
      if (r.target_table) tables.add(String(r.target_table).trim());
    });

    return {
      success: true,
      usernames: Array.from(usernames).sort(),
      actions: Array.from(actions).sort(),
      targetTables: Array.from(tables).sort()
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  📤 exportAuditLog — تصدير CSV
// ============================================================
export async function exportAuditLog(params) {
  const search = String(params.search || '').trim();
  const username = String(params.username || '').trim();
  const action = String(params.action || '').trim();
  const targetTable = String(params.targetTable || '').trim();
  const fromDate = String(params.fromDate || '').trim();
  const toDate = String(params.toDate || '').trim();

  let query = supabaseAdmin
    .from(TABLES.ADMIN_AUDIT_LOG)
    .select('id,created_at,username,action,target_table,target_id,ip_address,user_agent,changes');

  if (fromDate) query = query.gte('created_at', fromDate + ' 00:00:00');
  if (toDate) query = query.lte('created_at', toDate + ' 23:59:59');
  if (username) query = query.eq('username', username);
  if (action) query = query.eq('action', action);
  if (targetTable) query = query.eq('target_table', targetTable);

  if (search) {
    const safe = search.replace(/[%_,*()'"]/g, '').trim();
    if (safe) {
      const pattern = '%' + safe + '%';
      query = query.or([
        'action.ilike.' + pattern,
        'username.ilike.' + pattern,
        'target_id.ilike.' + pattern
      ].join(','));
    }
  }

  query = query.order('created_at', { ascending: false }).limit(5000);

  const { data, error } = await query;
  if (error) return { success: false, error: error.message };

  const rows = (data || []).map(function(r) {
    return {
      id: r.id,
      created_at: r.created_at || '',
      username: r.username || '',
      action: r.action || '',
      target_table: r.target_table || '',
      target_id: r.target_id || '',
      ip_address: r.ip_address || '',
      user_agent: r.user_agent || '',
      changes_summary: r.changes ? JSON.stringify(r.changes) : ''
    };
  });

  return { success: true, rows: rows };
}