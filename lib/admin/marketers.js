// ================================================================
//  lib/admin/marketers.js — إدارة المسوقين من لوحة الأدمن
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_MARKETERS, COLS_CHILDREN } from '../db/tables.js';
import { hashPassword } from './auth.js';
import { getClientIP } from './auth.js';
import { writeAuditLog } from './audit.js';

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

// ============================================================
//  🔐 الحقول المسموح بتعديلها
// ============================================================
const EDITABLE_FIELDS = {
  'name': 'string',
  'phone': 'string',
  'email': 'string',
  'governorate': 'string',
  'discount_percent': 'int',
  'is_active': 'enum',
  'notification_method': 'enum'
};

const VALID_STATUS = ['نشط', 'غير نشط', 'محذوف'];
const VALID_NOTIFICATION = ['telegram', 'email'];

// ============================================================
//  📋 getMarketersList — قائمة مع فلاتر وترقيم
// ============================================================
export async function getMarketersList(params) {
  const page = Math.max(1, parseInt(params.page) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(params.pageSize) || PAGE_SIZE_DEFAULT)
  );
  const search = String(params.search || '').trim();
  const status = String(params.status || '').trim();
  const sortBy = String(params.sortBy || 'created_at').trim();
  const sortDir = String(params.sortDir || 'desc').trim().toLowerCase() === 'asc';

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const SORTABLE = ['created_at', 'name', 'code', 'phone', 'discount_percent', 'is_active'];
  const safeSort = SORTABLE.includes(sortBy) ? sortBy : 'created_at';

  let query = supabaseAdmin
    .from(TABLES.MARKETERS)
    .select([
      COLS_MARKETERS.code,
      COLS_MARKETERS.name,
      COLS_MARKETERS.phone,
      COLS_MARKETERS.email,
      COLS_MARKETERS.governorate,
      COLS_MARKETERS.discount_percent,
      COLS_MARKETERS.is_active,
      COLS_MARKETERS.created_at,
      COLS_MARKETERS.telegram_chat_id,
      COLS_MARKETERS.notification_method
    ].join(','), { count: 'exact' });

  if (status && VALID_STATUS.includes(status)) {
    query = query.eq(COLS_MARKETERS.is_active, status);
  }

  if (search) {
    const safe = search.replace(/[%_,*()'"]/g, '').trim();
    if (safe) {
      const pattern = '%' + safe + '%';
      const orString = [
        COLS_MARKETERS.code + '.ilike.' + pattern,
        COLS_MARKETERS.name + '.ilike.' + pattern,
        COLS_MARKETERS.phone + '.ilike.' + pattern,
        COLS_MARKETERS.email + '.ilike.' + pattern,
        COLS_MARKETERS.governorate + '.ilike.' + pattern
      ].join(',');

      console.log('[getMarketersList] search:', safe);
      try {
        query = query.or(orString);
      } catch (e) {
        console.error('[getMarketersList] or() failed:', e.message);
        query = query.ilike(COLS_MARKETERS.code, pattern);
      }
    }
  }

  query = query.order(safeSort, { ascending: sortDir }).range(from, to);

  const { data, error, count } = await query;

  if (error) return { success: false, error: error.message };

  const list = (data || []).map(function(row) {
    return {
      code: String(row[COLS_MARKETERS.code] || '').trim(),
      name: String(row[COLS_MARKETERS.name] || '').trim(),
      phone: String(row[COLS_MARKETERS.phone] || '').trim(),
      email: String(row[COLS_MARKETERS.email] || '').trim(),
      governorate: String(row[COLS_MARKETERS.governorate] || '').trim(),
      discountPercent: parseInt(row[COLS_MARKETERS.discount_percent] || 10),
      isActive: String(row[COLS_MARKETERS.is_active] || '').trim(),
      createdAt: row[COLS_MARKETERS.created_at],
      telegramLinked: !!String(row[COLS_MARKETERS.telegram_chat_id] || '').trim(),
      notificationMethod: String(row[COLS_MARKETERS.notification_method] || 'email')
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
//  🧑‍💼 getMarketerDetails — كل بيانات المسوق + إحصائياته
// ============================================================
export async function getMarketerDetails(marketerCode) {
  const cleanCode = String(marketerCode || '').trim().toUpperCase();
  if (!cleanCode) return { success: false, error: 'missing_code' };

  // 1. جيب المسوق
  const { data, error } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .select('*')
    .eq(COLS_MARKETERS.code, cleanCode)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: 'not_found', message: 'المسوق غير موجود' };

  // نظّف الحقول الحساسة
  const safe = { ...data };
  delete safe.password_hash;
  delete safe.reset_token;
  delete safe.reset_token_expiry;

  // 2. إحصائيات
  const { data: children } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select([
      COLS_CHILDREN.child_id,
      COLS_CHILDREN.child_name,
      COLS_CHILDREN.status,
      COLS_CHILDREN.original_price,
      COLS_CHILDREN.plan_price,
      COLS_CHILDREN.registration_date,
      COLS_CHILDREN.timestamp
    ].join(','))
    .eq(COLS_CHILDREN.marketer_id, cleanCode)
    .order(COLS_CHILDREN.registration_date, { ascending: false });

  const childrenList = children || [];
  const now = Date.now();
  const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

  let totalCommission = 0;
  let earnedCommission = 0;
  let pendingCommission = 0;
  let activeChildren = 0;
  let newThisWeek = 0;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const clients = childrenList.map(function(c) {
    const original = parseFloat(c[COLS_CHILDREN.original_price]) || 0;
    const final = parseFloat(c[COLS_CHILDREN.plan_price]) || 0;
    const commission = Math.max(0, original - final);

    const regRaw = c[COLS_CHILDREN.registration_date] || c[COLS_CHILDREN.timestamp];
    const regDate = regRaw ? new Date(regRaw).getTime() : 0;
    const isEarned = (now - regDate) >= FOURTEEN_DAYS;

    if (String(c[COLS_CHILDREN.status] || '').toLowerCase() === 'active') activeChildren++;
    if (regDate >= weekAgo) newThisWeek++;

    totalCommission += commission;
    if (isEarned) earnedCommission += commission;
    else pendingCommission += commission;

    return {
      childID: c[COLS_CHILDREN.child_id],
      childName: c[COLS_CHILDREN.child_name],
      status: c[COLS_CHILDREN.status],
      commission: commission,
      isEarned: isEarned,
      registrationDate: regRaw
    };
  });

  return {
    success: true,
    marketer: safe,
    stats: {
      totalClients: childrenList.length,
      activeClients: activeChildren,
      newThisWeek: newThisWeek,
      totalCommission: Math.round(totalCommission),
      earnedCommission: Math.round(earnedCommission),
      pendingCommission: Math.round(pendingCommission)
    },
    clients: clients.slice(0, 100)
  };
}

// ============================================================
//  ✏️ updateMarketer — تحديث حقول محددة
// ============================================================
export async function updateMarketer(params) {
  const cleanCode = String(params.marketerCode || '').trim().toUpperCase();
  const updates = params.updates || {};
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!cleanCode) return { success: false, error: 'missing_code' };
  if (!updates || typeof updates !== 'object') return { success: false, error: 'missing_updates' };

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .select('*')
    .eq(COLS_MARKETERS.code, cleanCode)
    .maybeSingle();

  if (fetchErr) return { success: false, error: fetchErr.message };
  if (!existing) return { success: false, error: 'not_found' };

  const finalUpdates = {};
  const changesLog = {};

  for (const [key, rawValue] of Object.entries(updates)) {
    const type = EDITABLE_FIELDS[key];
    if (!type) continue;

    let value = rawValue;

    if (type === 'enum') {
      if (key === 'is_active' && !VALID_STATUS.includes(value)) continue;
      if (key === 'notification_method' && !VALID_NOTIFICATION.includes(value)) continue;
    }

    if (type === 'int') {
      const num = parseInt(value);
      if (isNaN(num) || num < 0 || num > 100) continue;
      value = num;
    }

    if (type === 'string') {
      value = String(value === null || value === undefined ? '' : value).trim();
      if (key === 'name' && value.length < 2) continue;
      if (key === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) continue;
      if (value.length > 200) value = value.substring(0, 200);
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

  const { error: updateErr } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .update(finalUpdates)
    .eq(COLS_MARKETERS.code, cleanCode);

  if (updateErr) return { success: false, error: updateErr.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'update_marketer',
    target_table: TABLES.MARKETERS,
    target_id: cleanCode,
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
//  🔄 toggleMarketerActive — تفعيل / تعطيل
// ============================================================
export async function toggleMarketerActive(params) {
  const cleanCode = String(params.marketerCode || '').trim().toUpperCase();
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!cleanCode) return { success: false, error: 'missing_code' };

  const { data: marketer } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .select(COLS_MARKETERS.is_active)
    .eq(COLS_MARKETERS.code, cleanCode)
    .maybeSingle();

  if (!marketer) return { success: false, error: 'not_found' };

  const current = String(marketer[COLS_MARKETERS.is_active] || '').trim();
  const newStatus = current === 'نشط' ? 'غير نشط' : 'نشط';

  const { error } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .update({ [COLS_MARKETERS.is_active]: newStatus })
    .eq(COLS_MARKETERS.code, cleanCode);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'toggle_marketer_active',
    target_table: TABLES.MARKETERS,
    target_id: cleanCode,
    changes: { is_active: { before: current, after: newStatus } },
    ip_address: getClientIP(req)
  });

  return {
    success: true,
    is_active: newStatus,
    message: 'تم التحديث إلى: ' + newStatus
  };
}

// ============================================================
//  🔐 resetMarketerPassword — إعادة تعيين كلمة السر
// ============================================================
export async function resetMarketerPassword(params) {
  const cleanCode = String(params.marketerCode || '').trim().toUpperCase();
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!cleanCode) return { success: false, error: 'missing_code' };

  // نضع كلمة مرور مؤقتة معروفة ونرسلها للأدمن ليُبلّغها للمسوق
  const tempPassword = generateTempPassword();
  const hash = hashPassword(tempPassword);

  const { error } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .update({
      [COLS_MARKETERS.password_hash]: hash,
      [COLS_MARKETERS.reset_token]: null,
      [COLS_MARKETERS.reset_token_expiry]: null
    })
    .eq(COLS_MARKETERS.code, cleanCode);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'reset_marketer_password',
    target_table: TABLES.MARKETERS,
    target_id: cleanCode,
    ip_address: getClientIP(req)
  });

  return {
    success: true,
    tempPassword: tempPassword,
    message: 'تم إعادة التعيين. كلمة السر المؤقتة: ' + tempPassword
  };
}

function generateTempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  let pass = '';
  for (let i = 0; i < 12; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

// ============================================================
//  🗑️ hardDeleteMarketer — حذف نهائي
// ============================================================
export async function hardDeleteMarketer(params) {
  const cleanCode = String(params.marketerCode || '').trim().toUpperCase();
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!cleanCode) return { success: false, error: 'missing_code' };

  // 1. فحص وجود أطفال مرتبطين
  const { count: childrenCount } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select(COLS_CHILDREN.child_id, { count: 'exact', head: true })
    .eq(COLS_CHILDREN.marketer_id, cleanCode);

  if (childrenCount && childrenCount > 0) {
    // نُفرِّغ marketer_id من الأطفال المرتبطين (historical — التسجيل يبقى)
    await supabaseAdmin
      .from(TABLES.CHILDREN)
      .update({ [COLS_CHILDREN.marketer_id]: '' })
      .eq(COLS_CHILDREN.marketer_id, cleanCode);
  }

  // 2. حذف المسوق
  const { error } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .delete()
    .eq(COLS_MARKETERS.code, cleanCode);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'hard_delete_marketer',
    target_table: TABLES.MARKETERS,
    target_id: cleanCode,
    changes: { children_affected: childrenCount || 0 },
    ip_address: getClientIP(req)
  });

  return {
    success: true,
    message: childrenCount > 0
      ? 'تم الحذف. تم فصل ' + childrenCount + ' طفل عن المسوق'
      : 'تم الحذف النهائي'
  };
}

// ============================================================
//  🔄 bulkUpdateStatus — تحديث حالة مجموعة
// ============================================================
export async function bulkUpdateMarketers(params) {
  const codes = Array.isArray(params.codes) ? params.codes : [];
  const newStatus = String(params.status || '').trim();
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (codes.length === 0) return { success: false, error: 'no_selection', message: 'لم يتم تحديد أي مسوق' };
  if (codes.length > 200) return { success: false, error: 'too_many' };
  if (!VALID_STATUS.includes(newStatus)) return { success: false, error: 'invalid_status' };

  const { error } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .update({ [COLS_MARKETERS.is_active]: newStatus })
    .in(COLS_MARKETERS.code, codes);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'bulk_update_marketers',
    target_table: TABLES.MARKETERS,
    target_id: codes.length + ' marketers',
    changes: { new_status: newStatus, count: codes.length },
    ip_address: getClientIP(req)
  });

  const countText = codes.length === 1 ? 'مسوق واحد'
                : codes.length === 2 ? 'مسوقان'
                : (codes.length >= 3 && codes.length <= 10) ? codes.length + ' مسوقين'
                : codes.length + ' مسوقًا';
return {
  success: true,
  message: 'تم تحديث ' + countText,
  updated: codes.length
};
}