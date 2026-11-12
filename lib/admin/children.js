// ================================================================
//  lib/admin/children.js — إدارة الأطفال من لوحة الأدمن
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN } from '../db/tables.js';
import { getClientIP } from './auth.js';
import { writeAuditLog } from './audit.js';
import { uploadToCloudinary } from '../cloudinary.js';

// ============================================================
//  🕐 دوال مساعدة
// ============================================================
function formatArabicCount(count, forms) {
  if (count === 1) return forms.singular;
  if (count === 2) return forms.dual;
  if (count >= 3 && count <= 10) return count + ' ' + forms.plural;
  return count + ' ' + forms.singular;
}

function calculateAge(birthDateStr) {
  if (!birthDateStr) return 'غير محدد';
  let normalized = String(birthDateStr).trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    const d = new Date(normalized);
    if (isNaN(d.getTime())) return 'تاريخ غير صحيح';
    normalized = d.toISOString().split('T')[0];
  }
  const parts = normalized.split('-');
  const year = parseInt(parts[0], 10); const month = parseInt(parts[1], 10) - 1; const day = parseInt(parts[2], 10);

  // ✅ Cairo "today" via Intl (DST-aware)
  const todayParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const getP = (t) => parseInt(todayParts.find(p => p.type === t).value, 10);
  const todayYear = getP('year');
  const todayMonth = getP('month') - 1;
  const todayDay = getP('day');

  let years = todayYear - year; let months = todayMonth - month; let days = todayDay - day;
  if (days < 0) { months--; const prevMonth = new Date(Date.UTC(todayYear, todayMonth, 0)).getUTCDate(); days += prevMonth; }
  if (months < 0) { years--; months += 12; }
  if (years <= 0 && months === 0 && days === 0) return 'أقل من يوم';
  const parts2 = [];
  if (years > 0) parts2.push(formatArabicCount(years, { singular: 'سنة', dual: 'سنتان', plural: 'سنوات' }));
  if (months > 0) parts2.push(formatArabicCount(months, { singular: 'شهر', dual: 'شهران', plural: 'أشهر' }));
  if (days > 0) parts2.push(formatArabicCount(days, { singular: 'يوم', dual: 'يومان', plural: 'أيام' }));
  return parts2.length === 0 ? 'أقل من يوم' : parts2.join(' و ');
}

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

// ============================================================
//  🔐 الحقول المسموح بتعديلها من لوحة الأدمن
// ============================================================
const EDITABLE_FIELDS = {
  'child_name': 'string',
  'birth_date': 'date',
  'google_maps': 'string',
  'detailed_address': 'string',
  'father_phone': 'string',
  'mother_name': 'string',
  'mother_phone': 'string',
  'notes': 'string',
  'email_code': 'string',
  'plan': 'enum',
  'plan_price': 'int',
  'status': 'enum',
  'payment_status': 'enum',
  'notification_method': 'enum',
  'court_requested': 'enum',
  'marketer_id': 'marketer_code'
};

const VALID_STATUS = ['active', 'pending', 'disabled', 'suspended', 'expired', 'refunding', 'refunded', 'deleted'];
const VALID_PLANS = ['عرض بداية الإطلاق', '6 أشهر', 'عام واحد'];
const VALID_PAYMENT_STATUS = ['free', 'pending', 'confirmed', 'failed'];
const VALID_NOTIFICATION = ['telegram', 'email'];
const VALID_COURT = ['نعم', 'لا'];

// ============================================================
//  📋 getChildrenList — قائمة مع فلاتر وترقيم
// ============================================================
export async function getChildrenList(params) {
  const page = Math.max(1, parseInt(params.page) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(params.pageSize) || PAGE_SIZE_DEFAULT)
  );
  const search = String(params.search || '').trim();
  const status = String(params.status || '').trim();
  const plan = String(params.plan || '').trim();
  const sortBy = String(params.sortBy || 'registration_date').trim();
  const sortDir = String(params.sortDir || 'desc').trim().toLowerCase() === 'asc' ? true : false;

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // الحقول المسموح الترتيب بها
  const SORTABLE = [
    'registration_date',
    'child_name',
    'child_id',
    'status',
    'plan',
    'expiry_date',
    'scan_count'
  ];
  const safeSort = SORTABLE.includes(sortBy) ? sortBy : 'registration_date';

  let query = supabaseAdmin
    .from(TABLES.CHILDREN)
    .select([
      COLS_CHILDREN.child_id,
      COLS_CHILDREN.child_name,
      COLS_CHILDREN.birth_date,
      COLS_CHILDREN.age,
      COLS_CHILDREN.father_phone,
      COLS_CHILDREN.mother_phone,
      COLS_CHILDREN.email_code,
      COLS_CHILDREN.plan,
      COLS_CHILDREN.status,
      COLS_CHILDREN.expiry_date,
      COLS_CHILDREN.registration_date,
      COLS_CHILDREN.scan_count,
      COLS_CHILDREN.marketer_id,
      COLS_CHILDREN.last_scan
    ].join(','), { count: 'exact' });

  // فلترة الحالة
  if (status && VALID_STATUS.includes(status)) {
    query = query.eq(COLS_CHILDREN.status, status);
  }

  // فلترة الخطة
  if (plan && VALID_PLANS.includes(plan)) {
    query = query.eq(COLS_CHILDREN.plan, plan);
  }

  // البحث
  if (search) {
    // تنظيف شامل من الأحرف التي قد تكسر صيغة or()
    const safe = search.replace(/[%_,*()'"]/g, '').trim();
    if (safe) {
      // PostgREST يستخدم * كحرف بديل رسمي داخل ?or=() بدلًا من %
      const pattern = '%' + safe + '%';
      const orString = [
        COLS_CHILDREN.child_id + '.ilike.' + pattern,
        COLS_CHILDREN.child_name + '.ilike.' + pattern,
        COLS_CHILDREN.father_phone + '.ilike.' + pattern,
        COLS_CHILDREN.mother_phone + '.ilike.' + pattern,
        COLS_CHILDREN.email_code + '.ilike.' + pattern
      ].join(',');

      // تشخيصي — يظهر في Vercel Logs فقط
      console.log('[getChildrenList] search term:', safe);
      console.log('[getChildrenList] or string:', orString);

      try {
        query = query.or(orString);
      } catch (orError) {
        console.error('[getChildrenList] or() failed:', orError.message);
        // Fallback: ابحث في child_id فقط
        query = query.ilike(COLS_CHILDREN.child_id, pattern);
      }
    }
  }

  query = query.order(safeSort, { ascending: sortDir }).range(from, to);

  const { data, error, count } = await query;

  if (error) {
    return { success: false, error: error.message };
  }

  const list = (data || []).map(function(row) {
    return {
      childID: row[COLS_CHILDREN.child_id],
      childName: row[COLS_CHILDREN.child_name],
      birthDate: row[COLS_CHILDREN.birth_date],
      age: row[COLS_CHILDREN.age],
      fatherPhone: row[COLS_CHILDREN.father_phone],
      motherPhone: row[COLS_CHILDREN.mother_phone],
      email: row[COLS_CHILDREN.email_code],
      plan: row[COLS_CHILDREN.plan],
      status: row[COLS_CHILDREN.status],
      expiryDate: row[COLS_CHILDREN.expiry_date],
      registrationDate: row[COLS_CHILDREN.registration_date],
      scanCount: row[COLS_CHILDREN.scan_count],
      marketerID: row[COLS_CHILDREN.marketer_id],
      lastScan: row[COLS_CHILDREN.last_scan]
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
    },
    filters: { search: search, status: status, plan: plan, sortBy: safeSort, sortDir: sortDir ? 'asc' : 'desc' }
  };
}

// ============================================================
//  👶 getChildDetails — كل بيانات طفل (للمودال)
// ============================================================
export async function getChildDetails(childID) {
  const cleanID = String(childID || '').trim();
  if (!cleanID) return { success: false, error: 'missing_child_id' };

  const { data, error } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: 'child_not_found', message: 'الطفل غير موجود' };

  // تنظيف: لا نرسل كلمات السر
  const safe = { ...data };
  delete safe[COLS_CHILDREN.family_password_hash];
  delete safe['family_password_hash'];
  delete safe['password_hash'];

  return { success: true, child: safe };
}

// ============================================================
//  ✏️ updateChild — تحديث حقول محددة
//  (calculateAge انتقلت إلى lib/shared/format.js — النسخة الدقيقة بالأيام)
// ============================================================
export async function updateChild(params) {
  const cleanID = String(params.childID || '').trim();
  const updates = params.updates || {};
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!cleanID) return { success: false, error: 'missing_child_id' };
  if (!updates || typeof updates !== 'object') {
    return { success: false, error: 'missing_updates' };
  }

  // 1. اقرأ الطفل الحالي (للتحقق + Audit)
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (fetchErr) return { success: false, error: fetchErr.message };
  if (!existing) return { success: false, error: 'child_not_found' };

  // 2. بنِ قائمة الحقول المسموحة + التحقق من القيم
  const finalUpdates = {};
  const changesLog = {};

  for (const [key, rawValue] of Object.entries(updates)) {
    const type = EDITABLE_FIELDS[key];
    if (!type) continue; // حقل غير مسموح

    let value = rawValue;

    // التحقق حسب النوع
    if (type === 'enum') {
      if (key === 'status' && !VALID_STATUS.includes(value)) continue;
      if (key === 'plan' && !VALID_PLANS.includes(value)) continue;
      if (key === 'payment_status' && !VALID_PAYMENT_STATUS.includes(value)) continue;
      if (key === 'notification_method' && !VALID_NOTIFICATION.includes(value)) continue;
      if (key === 'court_requested' && !VALID_COURT.includes(value)) continue;
    }

    if (type === 'int') {
      const num = parseInt(value);
      if (isNaN(num) || num < 0) continue;
      value = num;
    }

    if (type === 'string') {
      value = String(value === null || value === undefined ? '' : value).trim();
      if (key === 'child_name' && value.length < 3) continue;
      if (key === 'email_code' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) continue;
      if (value.length > 500) value = value.substring(0, 500);
    }

    // ✅ معالجة birth_date
    if (type === 'date') {
      value = String(value === null || value === undefined ? '' : value).trim();
      if (!value) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return { success: false, error: 'invalid_date', message: 'صيغة تاريخ الميلاد غير صحيحة' };
      }
      const d = new Date(value + 'T00:00:00Z');
      if (isNaN(d.getTime())) {
        return { success: false, error: 'invalid_date', message: 'تاريخ الميلاد غير صالح' };
      }
      // فحص أن التاريخ في الماضي وليس بعيد جدًا
      const now = Date.now();
      const fiveYearsAgo = now - 5 * 365 * 24 * 60 * 60 * 1000;
      if (d.getTime() > now) {
        return { success: false, error: 'future_date', message: 'تاريخ الميلاد لا يمكن أن يكون في المستقبل' };
      }
    }

    // ✅ معالجة marketer_id
    if (type === 'marketer_code') {
      const code = String(value === null || value === undefined ? '' : value).trim().toUpperCase();
      if (!code) {
        value = '';
      } else {
        // التحقق من وجود الكود في MarketersUnified
        const { data: mk } = await supabaseAdmin
          .from(TABLES.MARKETERS)
          .select('code,is_active')
          .eq('code', code)
          .maybeSingle();

        if (!mk) {
          return { success: false, error: 'invalid_marketer_code', message: 'كود المسوق "' + code + '" غير موجود في النظام' };
        }
        if (String(mk.is_active || '').trim() !== 'نشط') {
          return { success: false, error: 'inactive_marketer', message: 'حساب المسوق "' + code + '" غير نشط حاليًا' };
        }
        value = code;
      }
    }

    // لا تغيير فعلي؟
    const oldValue = existing[key];
    const oldStr = oldValue === null || oldValue === undefined ? '' : String(oldValue);
    const newStr = value === null || value === undefined ? '' : String(value);
    if (oldStr === newStr) continue;

    finalUpdates[key] = value;
    changesLog[key] = { before: oldStr.substring(0, 100), after: newStr.substring(0, 100) };
  }

  // ✅ إذا تغيّر تاريخ الميلاد، أعد حساب العمر تلقائيًا
  if (finalUpdates['birth_date']) {
    finalUpdates['age'] = calculateAge(finalUpdates['birth_date']);
  }

  if (Object.keys(finalUpdates).length === 0) {
    return { success: true, message: 'لا توجد تغييرات', changedFields: [] };
  }

  // 3. نفّذ التحديث
  const { error: updateErr } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .update(finalUpdates)
    .eq(COLS_CHILDREN.child_id, cleanID);

  if (updateErr) return { success: false, error: updateErr.message };

  // 4. سجّل في Audit Log
  await writeAuditLog({
    username: adminUsername,
    action: 'update_child',
    target_table: TABLES.CHILDREN,
    target_id: cleanID,
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
//  🗑️ deleteChild — حذف (soft delete)
// ============================================================
export async function deleteChild(params) {
  const cleanID = String(params.childID || '').trim();
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!cleanID) return { success: false, error: 'missing_child_id' };

  const { data: child } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select(`${COLS_CHILDREN.child_id},${COLS_CHILDREN.status},${COLS_CHILDREN.court_requested}`)
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (!child) return { success: false, error: 'child_not_found' };

  // فحص COURT_REQUESTED
  const court = String(child[COLS_CHILDREN.court_requested] || '').trim();
  if (court === 'نعم') {
    return {
      success: false,
      error: 'court_requested',
      message: 'الطفل مطلوب قضائيًا — لا يمكن حذفه'
    };
  }

  const { error } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .update({ [COLS_CHILDREN.status]: 'deleted' })
    .eq(COLS_CHILDREN.child_id, cleanID);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'delete_child',
    target_table: TABLES.CHILDREN,
    target_id: cleanID,
    ip_address: getClientIP(req),
    user_agent: req ? String(req.headers['user-agent'] || '').substring(0, 300) : null
  });

  return { success: true, message: 'تم حذف الطفل (حذف منطقي)' };
}

// ============================================================
//  📅 extendSubscription — تمديد الاشتراك
// ============================================================
export async function extendSubscription(params) {
  const cleanID = String(params.childID || '').trim();
  const months = parseInt(params.months) || 0;
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!cleanID) return { success: false, error: 'missing_child_id' };
  if (months < 1 || months > 24) {
    return { success: false, error: 'invalid_months', message: 'عدد الأشهر يجب أن يكون بين 1 و 24 شهرًا' };
  }

  const { data: child } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select(`${COLS_CHILDREN.child_id},${COLS_CHILDREN.expiry_date}`)
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (!child) return { success: false, error: 'child_not_found' };

  // احسب التاريخ الجديد
  const currentExpiry = child[COLS_CHILDREN.expiry_date];
  let baseDate = new Date();

  if (currentExpiry) {
    const d = new Date(currentExpiry);
    if (!isNaN(d.getTime()) && d.getTime() > Date.now()) {
      baseDate = d;
    }
  }

  const newDate = new Date(baseDate);
  newDate.setMonth(newDate.getMonth() + months);

  // ✅ UTC ISO — منتصف ليل UTC
  const yyyy = newDate.getUTCFullYear();
  const mm = String(newDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(newDate.getUTCDate()).padStart(2, '0');
  const newExpiry = yyyy + '-' + mm + '-' + dd + 'T00:00:00.000Z';

  const { error } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .update({
      [COLS_CHILDREN.expiry_date]: newExpiry,
      [COLS_CHILDREN.status]: 'active'
    })
    .eq(COLS_CHILDREN.child_id, cleanID);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'extend_subscription',
    target_table: TABLES.CHILDREN,
    target_id: cleanID,
    changes: {
      months: months,
      old_expiry: currentExpiry,
      new_expiry: newExpiry
    },
    ip_address: getClientIP(req)
  });

  const monthsText = months === 1 ? 'شهر واحد'
                 : months === 2 ? 'شهران'
                 : (months >= 3 && months <= 10) ? months + ' أشهر'
                 : months + ' شهرًا';
return { success: true, message: `تم التمديد ${monthsText}`, newExpiry: newExpiry };
}

// ============================================================
//  🔐 resetChildPassword — حذف كلمة سر الأسرة (لإعادة التعيين)
// ============================================================
export async function resetChildPassword(params) {
  const cleanID = String(params.childID || '').trim();
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!cleanID) return { success: false, error: 'missing_child_id' };

  // لا نحذف — فقط نُرسل رابط إعادة تعيين للأسرة
  // لكن من لوحة الأدمن، يمكننا حذف كلمة السر لجعل الأسرة تعيد التعيين
  const { error } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .update({
      [COLS_CHILDREN.family_password_hash]: null,
      [COLS_CHILDREN.family_password_set_at]: null
    })
    .eq(COLS_CHILDREN.child_id, cleanID);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'reset_child_password',
    target_table: TABLES.CHILDREN,
    target_id: cleanID,
    ip_address: getClientIP(req)
  });

  return {
    success: true,
    message: 'تم حذف كلمة السر. يجب على الأسرة تعيين واحدة جديدة عند الدخول التالي.'
  };
}

// ============================================================
//  🔥 hardDeleteChild — حذف نهائي من قاعدة البيانات
// ============================================================
export async function hardDeleteChild(params) {
  const cleanID = String(params.childID || '').trim();
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!cleanID) return { success: false, error: 'missing_child_id' };

  // 1. تحقق من وجود الطفل + جلب روابط الصور
  const { data: child } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select(`${COLS_CHILDREN.child_id}, ${COLS_CHILDREN.child_image_url}, ${COLS_CHILDREN.qr_code_pics}`)
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (!child) return { success: false, error: 'child_not_found' };

  const imageUrl = child[COLS_CHILDREN.child_image_url];
  const qrUrl = child[COLS_CHILDREN.qr_code_pics];

  // 2. حذف البيانات المرتبطة (best-effort)
  const cleanupTasks = [
    supabaseAdmin.from(TABLES.FACE_FEATURES).delete().eq('child_id', cleanID),
    supabaseAdmin.from(TABLES.FAMILY_SESSIONS).delete().eq('child_id', cleanID),
    supabaseAdmin.from(TABLES.CHILD_EDIT_LOG).delete().eq('child_id', cleanID),
    supabaseAdmin.from(TABLES.TEMP_TOKENS).delete().eq('childid', cleanID),
    supabaseAdmin.from(TABLES.PENDING_LINKS).delete().eq('child_id', cleanID),
    supabaseAdmin.from(TABLES.UNLINK_OTPS).delete().eq('child_id', cleanID),
    supabaseAdmin.from(TABLES.FAMILY_RESET_TOKENS).delete().eq('child_id', cleanID)
  ];
  await Promise.allSettled(cleanupTasks);

  // 3. حذف الطفل من الداتابيز
  const { error } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .delete()
    .eq(COLS_CHILDREN.child_id, cleanID);

  if (error) return { success: false, error: error.message };

  // 4. حذف الصور من Cloudinary (بعد التأكد إن الطفل اتمسح من الداتابيز)
  try {
    const { extractPublicId, deleteFromCloudinary } = await import('../cloudinary.js');
    
    // حذف صورة الطفل
    if (imageUrl) {
      const imgPublicId = extractPublicId(imageUrl);
      if (imgPublicId) {
        await deleteFromCloudinary({ publicId: imgPublicId, resourceType: 'image' });
      }
    }

    // حذف صورة الـ QR
    if (qrUrl) {
      const qrPublicId = extractPublicId(qrUrl);
      if (qrPublicId) {
        await deleteFromCloudinary({ publicId: qrPublicId, resourceType: 'image' });
      }
    }
  } catch (cloudinaryErr) {
    console.error('⚠️ [hardDeleteChild] Cloudinary cleanup failed:', cloudinaryErr.message);
    // مش هنوقف العملية لو Cloudinary فشل، الطفل خلاص اتمسح من الداتابيز
  }

  // 5. Audit
  await writeAuditLog({
    username: adminUsername,
    action: 'hard_delete_child',
    target_table: TABLES.CHILDREN,
    target_id: cleanID,
    ip_address: getClientIP(req),
    user_agent: req ? String(req.headers['user-agent'] || '').substring(0, 300) : null
  });

  return { success: true, message: 'تم الحذف النهائي ومسح الصور من Cloudinary' };
}

export async function uploadChildImage(params) {
  const cleanID = String(params.childID || '').trim();
  const imageBase64 = String(params.imageBase64 || '');
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (!cleanID || !imageBase64) {
    return { success: false, error: 'missing_data' };
  }

  // 1. جيب الصورة القديمة
  const { data: child } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select(COLS_CHILDREN.child_image_url)
    .eq(COLS_CHILDREN.child_id, cleanID)
    .maybeSingle();

  if (!child) return { success: false, error: 'child_not_found' };

  // 2. ارفع على Cloudinary
  let newImageUrl = '';
  try {
    const result = await uploadToCloudinary({
      base64: imageBase64,
      folder: 'kidcode/children',
      fileName: cleanID // هياخد اسم الطفل بالظبط
    });
    
    if (result.success) {
      newImageUrl = result.url;
    } else {
      return { success: false, error: 'upload_failed', message: result.error };
    }
  } catch (e) {
    return { success: false, error: 'exception', message: e.message };
  }

  // 3. حدّث Supabase
  const { error: updateErr } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .update({ [COLS_CHILDREN.child_image_url]: newImageUrl })
    .eq(COLS_CHILDREN.child_id, cleanID);

  if (updateErr) return { success: false, error: updateErr.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'update_child_image',
    target_table: TABLES.CHILDREN,
    target_id: cleanID,
    ip_address: getClientIP(req)
  });

  return { success: true, url: newImageUrl, message: 'تم رفع الصورة' };
}

// ============================================================
//  🔄 bulkUpdateStatus — تحديث حالة مجموعة
// ============================================================
export async function bulkUpdateStatus(params) {
  const childIDs = Array.isArray(params.childIDs) ? params.childIDs : [];
  const newStatus = String(params.status || '').trim();
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  if (childIDs.length === 0) {
    return { success: false, error: 'no_selection', message: 'لم يتم تحديد أي طفل' };
  }
  if (childIDs.length > 200) {
    return { success: false, error: 'too_many', message: 'الحد الأقصى 200 عنصر' };
  }
  if (!VALID_STATUS.includes(newStatus)) {
    return { success: false, error: 'invalid_status' };
  }

  // إذا كانت الحالة "deleted"، افحص COURT_REQUESTED أولاً
  if (newStatus === 'deleted') {
    const { data: courtChildren } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select(COLS_CHILDREN.child_id)
      .in(COLS_CHILDREN.child_id, childIDs)
      .eq(COLS_CHILDREN.court_requested, 'نعم');

  if (courtChildren && courtChildren.length > 0) {
    const courtCountText = courtChildren.length === 1 ? 'طفل واحد'
                         : courtChildren.length === 2 ? 'طفلان'
                         : (courtChildren.length >= 3 && courtChildren.length <= 10) ? courtChildren.length + ' أطفال'
                         : courtChildren.length + ' طفلًا';

    return {
      success: false,
      error: 'court_requested_present',
      message: `${courtCountText} مطلوب قضائيًا ولا يمكن حذفه`
    };
  }
  }

  const { error } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .update({ [COLS_CHILDREN.status]: newStatus })
    .in(COLS_CHILDREN.child_id, childIDs);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'bulk_update_status',
    target_table: TABLES.CHILDREN,
    target_id: childIDs.length + ' children',
    changes: { new_status: newStatus, count: childIDs.length },
    ip_address: getClientIP(req)
  });

  const updatedCountText = childIDs.length === 1 ? 'عنصر واحد'
                        : childIDs.length === 2 ? 'عنصرين'
                        : (childIDs.length >= 3 && childIDs.length <= 10) ? childIDs.length + ' عناصر'
                        : childIDs.length + ' عنصرًا';

  return {
    success: true,
    message: `تم تحديث ${updatedCountText} إلى "${newStatus}"`,
    updated: childIDs.length
  };
}