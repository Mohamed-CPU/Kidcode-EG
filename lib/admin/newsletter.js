// ================================================================
//  lib/admin/newsletter.js — إدارة المشتركين (مع دعم id)
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES } from '../db/tables.js';
import { getClientIP } from './auth.js';
import { writeAuditLog } from './audit.js';

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

// ============================================================
//  ✅ normalizeIsActive
// ============================================================
function normalizeIsActive(value) {
  const s = String(value || '').trim().toLowerCase();
  return ['نعم', 'نشط', 'yes', 'true', '1', 'active'].includes(s);
}

// ============================================================
//  📧 isValidEmail
// ============================================================
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

// ============================================================
//  🔐 الحقول المسموح بتعديلها
// ============================================================
const EDITABLE_FIELDS = {
  'name': 'string',
  'email': 'email',
  'phone': 'string',
  'is_active': 'enum'
};

// ============================================================
//  📋 getNewsletterList
// ============================================================
export async function getNewsletterList(params) {
  const page = Math.max(1, parseInt(params.page) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(params.pageSize) || PAGE_SIZE_DEFAULT)
  );
  const search = String(params.search || '').trim();
  const status = String(params.status || '').trim().toLowerCase();
  const sortBy = String(params.sortBy || 'timestamp').trim();
  const sortDir = String(params.sortDir || 'desc').trim().toLowerCase() === 'asc';

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const SORTABLE = ['timestamp', 'name', 'email', 'phone', 'is_active', 'id'];
  const safeSort = SORTABLE.includes(sortBy) ? sortBy : 'timestamp';

  let query = supabaseAdmin
    .from(TABLES.NEWSLETTER)
    .select('*', { count: 'exact' });

  if (status === 'active') {
    query = query.in('is_active', ['نعم', 'نشط', 'yes', 'true', '1', 'active']);
  } else if (status === 'inactive') {
    query = query.not('is_active', 'in', '(نعم,نشط,yes,true,1,active)');
  }

  if (search) {
    const safe = search.replace(/[%_,*()'"]/g, '').trim();
    if (safe) {
      const pattern = '%' + safe + '%';
      const orString = [
        'email.ilike.' + pattern,
        'name.ilike.' + pattern,
        'phone.ilike.' + pattern
      ].join(',');

      try {
        query = query.or(orString);
      } catch (e) {
        console.error('[getNewsletterList] or() failed:', e.message);
        query = query.ilike('email', pattern);
      }
    }
  }

  query = query.order(safeSort, { ascending: sortDir }).range(from, to);

  const { data, error, count } = await query;

  if (error) return { success: false, error: error.message };

  const list = (data || []).map(function(row) {
    const rawIsActive = String(row.is_active || '').trim();
    return {
      id: row.id,
      email: String(row.email || '').trim(),
      name: String(row.name || '').trim(),
      phone: String(row.phone || '').trim(),
      isActive: normalizeIsActive(rawIsActive),
      isActiveRaw: rawIsActive,
      timestamp: row.timestamp,
      hasToken: !!String(row.unsubscribe_token || '').trim()
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
//  👤 getSubscriberDetails (by id)
// ============================================================
export async function getSubscriberDetails(id) {
  const numId = parseInt(id);
  if (!numId || numId <= 0) return { success: false, error: 'missing_id' };

  const { data, error } = await supabaseAdmin
    .from(TABLES.NEWSLETTER)
    .select('*')
    .eq('id', numId)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: 'not_found' };

  return { success: true, subscriber: data };
}

// ============================================================
//  ✏️ updateSubscriber (by id, يدعم تغيير email)
// ============================================================
export async function updateSubscriber(params) {
  const numId = parseInt(params.id);
  const updates = params.updates || {};
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!numId || numId <= 0) return { success: false, error: 'missing_id' };
  if (!updates || typeof updates !== 'object') return { success: false, error: 'missing_updates' };

  const { data: existing } = await supabaseAdmin
    .from(TABLES.NEWSLETTER)
    .select('*')
    .eq('id', numId)
    .maybeSingle();

  if (!existing) return { success: false, error: 'not_found' };

  const finalUpdates = {};
  const changesLog = {};

  for (const [key, rawValue] of Object.entries(updates)) {
    const type = EDITABLE_FIELDS[key];
    if (!type) continue;

    let value = rawValue;

    if (type === 'string') {
      value = String(value === null || value === undefined ? '' : value).trim();
      if (value.length > 200) value = value.substring(0, 200);
    }

    if (type === 'email') {
      value = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
      if (!value) continue;
      if (!isValidEmail(value)) {
        return { success: false, error: 'invalid_email', message: 'صيغة البريد غير صحيحة' };
      }
      // ✅ فحص عدم التكرار
      const { data: dup } = await supabaseAdmin
        .from(TABLES.NEWSLETTER)
        .select('id')
        .eq('email', value)
        .neq('id', numId)
        .maybeSingle();

      if (dup) {
        return { success: false, error: 'email_exists', message: 'هذا البريد مسجَّل لمشترك آخر بالفعل' };
      }
    }

    if (key === 'is_active') {
      let isTrue = false;
      if (typeof value === 'boolean') isTrue = value;
      else isTrue = normalizeIsActive(value);
      value = isTrue ? 'نعم' : 'لا';
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

  const { error } = await supabaseAdmin
    .from(TABLES.NEWSLETTER)
    .update(finalUpdates)
    .eq('id', numId);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'update_subscriber',
    target_table: TABLES.NEWSLETTER,
    target_id: String(numId),
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
//  🗑️ deleteSubscriber (by id)
// ============================================================
export async function deleteSubscriber(params) {
  const numId = parseInt(params.id);
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!numId || numId <= 0) return { success: false, error: 'missing_id' };

  const { data: existing } = await supabaseAdmin
    .from(TABLES.NEWSLETTER)
    .select('id, email')
    .eq('id', numId)
    .maybeSingle();

  if (!existing) return { success: false, error: 'not_found' };

  const { error } = await supabaseAdmin
    .from(TABLES.NEWSLETTER)
    .delete()
    .eq('id', numId);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'delete_subscriber',
    target_table: TABLES.NEWSLETTER,
    target_id: String(numId),
    changes: { email: existing.email },
    ip_address: getClientIP(req)
  });

  return { success: true, message: 'تم الحذف النهائي' };
}

// ============================================================
//  🔄 bulkUpdateNewsletter (by ids)
// ============================================================
export async function bulkUpdateNewsletter(params) {
  const ids = Array.isArray(params.ids)
    ? params.ids.map(i => parseInt(i)).filter(n => !isNaN(n) && n > 0)
    : [];
  const newStatus = String(params.status || '').trim();
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (ids.length === 0) {
    return { success: false, error: 'no_selection', message: 'لم يتم تحديد أي مشترك' };
  }
  if (ids.length > 200) {
    return { success: false, error: 'too_many', message: 'الحد الأقصى 200 عنصر' };
  }

  const value = normalizeIsActive(newStatus) ? 'نعم' : 'لا';

  const { error } = await supabaseAdmin
    .from(TABLES.NEWSLETTER)
    .update({ is_active: value })
    .in('id', ids);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'bulk_update_subscribers',
    target_table: TABLES.NEWSLETTER,
    target_id: ids.length + ' subscribers',
    changes: { new_status: value, count: ids.length },
    ip_address: getClientIP(req)
  });

  const countText = ids.length === 1 ? 'مشترك واحد'
                : ids.length === 2 ? 'مشتركان'
                : (ids.length >= 3 && ids.length <= 10) ? ids.length + ' مشتركين'
                : ids.length + ' مشتركًا';
return {
  success: true,
  message: 'تم تحديث ' + countText,
  updated: ids.length
};
}

// ============================================================
//  🗑️ bulkDeleteNewsletter (by ids)
// ============================================================
export async function bulkDeleteNewsletter(params) {
  const ids = Array.isArray(params.ids)
    ? params.ids.map(i => parseInt(i)).filter(n => !isNaN(n) && n > 0)
    : [];
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (ids.length === 0) {
    return { success: false, error: 'no_selection', message: 'لم يتم تحديد أي مشترك' };
  }
  if (ids.length > 200) {
    return { success: false, error: 'too_many', message: 'الحد الأقصى 200 عنصر' };
  }

  const { error } = await supabaseAdmin
    .from(TABLES.NEWSLETTER)
    .delete()
    .in('id', ids);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'bulk_delete_subscribers',
    target_table: TABLES.NEWSLETTER,
    target_id: ids.length + ' subscribers',
    changes: { count: ids.length },
    ip_address: getClientIP(req)
  });

  const countText = ids.length === 1 ? 'مشترك واحد'
                : ids.length === 2 ? 'مشتركين'
                : (ids.length >= 3 && ids.length <= 10) ? ids.length + ' مشتركين'
                : ids.length + ' مشتركًا';
return {
  success: true,
  message: 'تم حذف ' + countText + ' نهائيًا',
  deleted: ids.length
};
}