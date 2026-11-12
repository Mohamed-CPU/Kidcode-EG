// ================================================================
//  lib/admin/withdrawals.js — إدارة طلبات سحب أرباح المسوقين
//  - list + stats + details
//  - update status (with validation + notifications + audit log)
//  - upload screenshot via Cloudinary (signed)
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_WITHDRAW, COLS_MARKETERS } from '../db/tables.js';
import { writeAuditLog } from './audit.js';
import { getClientIP } from './auth.js';
import { notifyMarketerWithdrawStatus } from '../marketer-notify.js';
import {
  uploadToCloudinary,
  isCloudinaryConfigured
} from '../cloudinary.js';

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

// ============================================================
//  🎯 Status flow — الحالات المسموح الانتقال منها/إليها
// ============================================================
const ALLOWED_TRANSITIONS = {
  submitted:    ['under_review', 'rejected', 'failed', 'cancelled'],
  under_review: ['sending', 'rejected', 'failed', 'cancelled'],
  sending:      ['sent', 'failed', 'cancelled'],
  sent:         [],
  rejected:     [],
  cancelled:    [],
  failed:       [],
  expired:      []
};

const STATUS_LABELS = {
  submitted:    'تم إرسال طلب',
  under_review: 'قيد المراجعة',
  sending:      'قيد الإرسال',
  sent:         'تم الإرسال',
  rejected:     'مرفوض',
  cancelled:    'ملغى',
  failed:       'فشل التحويل',
  expired:      'منتهي الصلاحية'
};

// الحالات التي ترسل إشعار للمسوق
const NOTIFY_STATUSES = ['rejected', 'cancelled', 'sent'];

// ============================================================
//  🕐 الوقت
// ============================================================
function nowUTC() {
  return new Date().toISOString();
}

// ============================================================
//  📋 getWithdrawalsList — قائمة الطلبات + فلاتر + ترقيم
// ============================================================
export async function getWithdrawalsList(params) {
  const page = Math.max(1, parseInt(params.page) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(params.pageSize) || PAGE_SIZE_DEFAULT)
  );
  const search = String(params.search || '').trim();
  const status = String(params.status || '').trim();
  const marketerCode = String(params.marketerCode || '').trim().toUpperCase();
  const fromDate = String(params.fromDate || '').trim();
  const toDate = String(params.toDate || '').trim();

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from(TABLES.MARKETER_WITHDRAW_REQUESTS)
    .select('*', { count: 'exact' });

  if (status && STATUS_LABELS[status]) {
    query = query.eq(COLS_WITHDRAW.status, status);
  }
  if (marketerCode) {
    query = query.eq(COLS_WITHDRAW.marketer_code, marketerCode);
  }

  if (search) {
    const safe = search.replace(/[%_,*()'"]/g, '').trim();
    if (safe) {
      const pattern = '%' + safe + '%';
      const orStr = [
        COLS_WITHDRAW.request_id + '.ilike.' + pattern,
        COLS_WITHDRAW.marketer_code + '.ilike.' + pattern,
        COLS_WITHDRAW.marketer_name + '.ilike.' + pattern,
        COLS_WITHDRAW.transfer_number + '.ilike.' + pattern
      ].join(',');
      try {
        query = query.or(orStr);
      } catch (e) {
        query = query.ilike(COLS_WITHDRAW.request_id, pattern);
      }
    }
  }

  // فلترة التواريخ (UTC ISO)
  if (fromDate) {
    try {
      const d = new Date(fromDate);
      if (!isNaN(d.getTime())) {
        d.setUTCHours(0, 0, 0, 0);
        query = query.gte(COLS_WITHDRAW.created_at, d.toISOString());
      }
    } catch (e) {}
  }
  if (toDate) {
    try {
      const d = new Date(toDate);
      if (!isNaN(d.getTime())) {
        d.setUTCHours(23, 59, 59, 999);
        query = query.lte(COLS_WITHDRAW.created_at, d.toISOString());
      }
    } catch (e) {}
  }

  query = query.order(COLS_WITHDRAW.created_at, { ascending: false }).range(from, to);

  const { data, error, count } = await query;

  if (error) {
    console.error('[getWithdrawalsList]', error.message);
    return { success: false, error: error.message };
  }

  const list = (data || []).map(function(r) {
    return {
      id: r[COLS_WITHDRAW.id],
      requestId: r[COLS_WITHDRAW.request_id],
      marketerCode: r[COLS_WITHDRAW.marketer_code],
      marketerName: r[COLS_WITHDRAW.marketer_name],
      marketerEmail: r[COLS_WITHDRAW.marketer_email],
      amount: parseInt(r[COLS_WITHDRAW.amount] || '0', 10),
      method: r[COLS_WITHDRAW.method],
      transferNumber: r[COLS_WITHDRAW.transfer_number],
      status: r[COLS_WITHDRAW.status],
      rejectionReason: r[COLS_WITHDRAW.rejection_reason],
      cancellationReason: r[COLS_WITHDRAW.cancellation_reason],
      screenshotUrl: r[COLS_WITHDRAW.screenshot_url],
      adminNotes: r[COLS_WITHDRAW.admin_notes],
      processedBy: r[COLS_WITHDRAW.processed_by],
      createdAt: r[COLS_WITHDRAW.created_at],
      updatedAt: r[COLS_WITHDRAW.updated_at],
      sentAt: r[COLS_WITHDRAW.sent_at]
    };
  });

  return {
    success: true,
    list,
    pagination: {
      page,
      pageSize,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / pageSize)
    }
  };
}

// ============================================================
//  📊 getWithdrawalsStats
// ============================================================
export async function getWithdrawalsStats() {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.MARKETER_WITHDRAW_REQUESTS)
      .select(COLS_WITHDRAW.status + ',' + COLS_WITHDRAW.amount);

    if (error) return { success: false, error: error.message };

    const stats = {
      total: 0,
      submitted: 0,
      under_review: 0,
      sending: 0,
      sent: 0,
      rejected: 0,
      cancelled: 0,
      failed: 0,
      expired: 0,
      totalAmount: 0,
      totalSentAmount: 0,
      pendingAmount: 0
    };

    (data || []).forEach(function(row) {
      const status = String(row[COLS_WITHDRAW.status] || '').trim();
      const amount = parseInt(row[COLS_WITHDRAW.amount] || '0', 10) || 0;

      stats.total++;
      stats.totalAmount += amount;

      if (status in stats) stats[status]++;

      if (status === 'sent') {
        stats.totalSentAmount += amount;
      } else if (['submitted', 'under_review', 'sending'].includes(status)) {
        stats.pendingAmount += amount;
      }
    });

    return { success: true, stats };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🔍 getWithdrawalDetails
// ============================================================
export async function getWithdrawalDetails(requestId) {
  const cleanId = String(requestId || '').trim();
  if (!cleanId) return { success: false, error: 'missing_request_id' };

  const { data: req, error } = await supabaseAdmin
    .from(TABLES.MARKETER_WITHDRAW_REQUESTS)
    .select('*')
    .eq(COLS_WITHDRAW.request_id, cleanId)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!req) return { success: false, error: 'not_found', message: 'الطلب غير موجود' };

  // بيانات المسوق (قراءة فقط)
  const { data: marketer } = await supabaseAdmin
    .from(TABLES.MARKETERS)
    .select('code,name,email,telegram_chat_id,notification_method')
    .eq(COLS_MARKETERS.code, req[COLS_WITHDRAW.marketer_code])
    .maybeSingle();

  return {
    success: true,
    request: {
      id: req[COLS_WITHDRAW.id],
      requestId: req[COLS_WITHDRAW.request_id],
      marketerCode: req[COLS_WITHDRAW.marketer_code],
      marketerName: req[COLS_WITHDRAW.marketer_name],
      marketerEmail: req[COLS_WITHDRAW.marketer_email],
      amount: parseInt(req[COLS_WITHDRAW.amount] || '0', 10),
      method: req[COLS_WITHDRAW.method],
      transferNumber: req[COLS_WITHDRAW.transfer_number],
      status: req[COLS_WITHDRAW.status],
      rejectionReason: req[COLS_WITHDRAW.rejection_reason],
      cancellationReason: req[COLS_WITHDRAW.cancellation_reason],
      screenshotUrl: req[COLS_WITHDRAW.screenshot_url],
      adminNotes: req[COLS_WITHDRAW.admin_notes],
      processedBy: req[COLS_WITHDRAW.processed_by],
      createdAt: req[COLS_WITHDRAW.created_at],
      updatedAt: req[COLS_WITHDRAW.updated_at],
      sentAt: req[COLS_WITHDRAW.sent_at]
    },
    marketer: marketer ? {
      code: marketer[COLS_MARKETERS.code],
      name: marketer[COLS_MARKETERS.name],
      email: marketer[COLS_MARKETERS.email],
      telegramLinked: !!String(marketer[COLS_MARKETERS.telegram_chat_id] || '').trim(),
      notificationMethod: marketer[COLS_MARKETERS.notification_method]
    } : null
  };
}

// ============================================================
//  ✏️ updateWithdrawalStatus — تغيير الحالة (مع تحقق + إشعار)
// ============================================================
export async function updateWithdrawalStatus(params) {
  const requestId = String(params.requestId || '').trim();
  const newStatus = String(params.newStatus || '').trim();
  const rejectionReason = String(params.rejectionReason || '').trim();
  const cancellationReason = String(params.cancellationReason || '').trim();
  const screenshotUrl = String(params.screenshotUrl || '').trim();
  const adminNotes = String(params.adminNotes || '').trim().substring(0, 500);
  const adminUsername = String(params.adminUsername || 'unknown').trim();
  const req = params.req;

  // 1. تحقق من المدخلات
  if (!requestId) return { success: false, error: 'missing_request_id' };
  if (!newStatus || !STATUS_LABELS[newStatus]) {
    return { success: false, error: 'invalid_status' };
  }

  // 2. جيب الطلب
  const { data: request, error } = await supabaseAdmin
    .from(TABLES.MARKETER_WITHDRAW_REQUESTS)
    .select('*')
    .eq(COLS_WITHDRAW.request_id, requestId)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!request) return { success: false, error: 'not_found' };

  const oldStatus = String(request[COLS_WITHDRAW.status] || '').trim();

  // 3. تحقق من الانتقال المسموح
  const allowed = ALLOWED_TRANSITIONS[oldStatus] || [];
  if (!allowed.includes(newStatus)) {
    return {
      success: false,
      error: 'invalid_transition',
      message: 'لا يمكن الانتقال من حالة "' + (STATUS_LABELS[oldStatus] || oldStatus) +
               '" إلى "' + (STATUS_LABELS[newStatus] || newStatus) + '"'
    };
  }

  // 4. تحقق من المتطلبات الشرطية
  if (newStatus === 'rejected' && rejectionReason.length < 5) {
    return { success: false, error: 'reason_required', message: 'سبب الرفض مطلوب (5 أحرف على الأقل)' };
  }
  if (newStatus === 'cancelled' && cancellationReason.length < 5) {
    return { success: false, error: 'reason_required', message: 'سبب الإلغاء مطلوب (5 أحرف على الأقل)' };
  }
  if (newStatus === 'sent' && !screenshotUrl) {
    return { success: false, error: 'screenshot_required', message: 'سكرين شوت التحويل مطلوب' };
  }
  if (newStatus === 'sent' && !screenshotUrl.startsWith('https://res.cloudinary.com/')) {
    return { success: false, error: 'invalid_screenshot_url', message: 'رابط الصورة غير صالح' };
  }

  // 5. جهّز التحديثات
  const now = nowUTC();
  const updates = {
    [COLS_WITHDRAW.status]: newStatus,
    [COLS_WITHDRAW.updated_at]: now,
    [COLS_WITHDRAW.processed_by]: adminUsername
  };

  if (newStatus === 'rejected') {
    updates[COLS_WITHDRAW.rejection_reason] = rejectionReason;
  }
  if (newStatus === 'cancelled') {
    updates[COLS_WITHDRAW.cancellation_reason] = cancellationReason;
  }
  if (newStatus === 'sent') {
    updates[COLS_WITHDRAW.screenshot_url] = screenshotUrl;
    updates[COLS_WITHDRAW.sent_at] = now;
  }
  if (adminNotes) {
    updates[COLS_WITHDRAW.admin_notes] = adminNotes;
  }

  // 6. حدّث DB
  const { error: updateErr } = await supabaseAdmin
    .from(TABLES.MARKETER_WITHDRAW_REQUESTS)
    .update(updates)
    .eq(COLS_WITHDRAW.request_id, requestId);

  if (updateErr) {
    console.error('[updateWithdrawalStatus]', updateErr.message);
    return { success: false, error: updateErr.message };
  }

  // 7. إشعار للمسوق (فقط للـ rejected/cancelled/sent)
  let notificationResult = null;
  if (NOTIFY_STATUSES.includes(newStatus)) {
    try {
      const methodLabel = request[COLS_WITHDRAW.method] === 'instapay' ? 'انستاباي' : 'محفظة إلكترونية';
      notificationResult = await notifyMarketerWithdrawStatus({
        marketerCode: request[COLS_WITHDRAW.marketer_code],
        status: newStatus,
        requestId: requestId,
        amount: parseInt(request[COLS_WITHDRAW.amount] || '0', 10),
        methodLabel: methodLabel,
        rejectionReason: newStatus === 'rejected' ? rejectionReason : null,
        cancellationReason: newStatus === 'cancelled' ? cancellationReason : null,
        screenshotUrl: newStatus === 'sent' ? screenshotUrl : null
      });
    } catch (e) {
      console.warn('[updateWithdrawalStatus] notify error:', e.message);
    }
  }

  // 8. Audit log
  try {
    await writeAuditLog({
      username: adminUsername,
      action: 'withdrawal_status_changed',
      target_table: TABLES.MARKETER_WITHDRAW_REQUESTS,
      target_id: requestId,
      changes: {
        before: oldStatus,
        after: newStatus,
        marketer_code: request[COLS_WITHDRAW.marketer_code],
        amount: request[COLS_WITHDRAW.amount],
        rejection_reason: newStatus === 'rejected' ? rejectionReason : undefined,
        cancellation_reason: newStatus === 'cancelled' ? cancellationReason : undefined,
        screenshot_uploaded: newStatus === 'sent' ? true : undefined
      },
      ip_address: getClientIP(req),
      user_agent: req ? String(req.headers['user-agent'] || '').substring(0, 300) : null
    });
  } catch (e) {
    console.warn('[updateWithdrawalStatus] audit error:', e.message);
  }

  console.log(`✅ [updateWithdrawalStatus] ${requestId}: ${oldStatus} → ${newStatus} | by: ${adminUsername}`);

  return {
    success: true,
    message: 'تم تحديث الحالة إلى "' + STATUS_LABELS[newStatus] + '"',
    oldStatus,
    newStatus,
    notified: notificationResult
      ? { success: notificationResult.success, channel: notificationResult.channel }
      : null
  };
}

// ============================================================
//  📸 uploadWithdrawalScreenshot — رفع سكرين شوت
//  - Cloudinary signed upload (backend)
//  - folder: kidcode/withdrawals
//  - max 5MB
// ============================================================
export async function uploadWithdrawalScreenshot(params) {
  const requestId = String(params.requestId || '').trim();
  const base64 = String(params.base64 || '').trim();
  const fileName = String(params.fileName || '').trim();
  const mimeType = String(params.mimeType || '').trim().toLowerCase();

  // 1. تحقق من المدخلات
  if (!requestId) return { success: false, error: 'missing_request_id' };
  if (!base64) return { success: false, error: 'missing_file' };

  // 2. تحقق من نوع الملف
  const allowedMimes = ['image/png', 'image/jpeg', 'image/jpg'];
  if (mimeType && !allowedMimes.includes(mimeType)) {
    return { success: false, error: 'invalid_file_type', message: 'يُسمح فقط بـ PNG أو JPG' };
  }

  // 3. تحقق من الحجم (base64 ≈ 1.37 × حجم الصورة الأصلي)
  const base64SizeBytes = base64.length * 0.75;
  const maxBytes = 5 * 1024 * 1024;
  if (base64SizeBytes > maxBytes) {
    return { success: false, error: 'file_too_large', message: 'حجم الصورة يتجاوز 5 ميجابايت' };
  }

  // 4. تأكد أن Cloudinary مهيأ
  if (!isCloudinaryConfigured()) {
    return { success: false, error: 'cloudinary_not_configured', message: 'Cloudinary غير مهيأ' };
  }

  // 5. تأكد أن الطلب موجود
  const { data: request } = await supabaseAdmin
    .from(TABLES.MARKETER_WITHDRAW_REQUESTS)
    .select(COLS_WITHDRAW.request_id + ',' + COLS_WITHDRAW.status)
    .eq(COLS_WITHDRAW.request_id, requestId)
    .maybeSingle();

  if (!request) {
    return { success: false, error: 'request_not_found', message: 'الطلب غير موجود' };
  }

  // 6. ارفع لـ Cloudinary
  const safeFileName = requestId + '_screenshot_' + Date.now();
  const uploadResult = await uploadToCloudinary({
    base64: base64,
    resourceType: 'image',
    fileName: safeFileName,
    folder: 'kidcode/withdrawals',
    tags: 'withdrawal,screenshot,' + requestId
  });

  if (!uploadResult.success) {
    console.error('[uploadWithdrawalScreenshot] Cloudinary failed:', uploadResult.error);
    return {
      success: false,
      error: uploadResult.error || 'upload_failed',
      message: 'تعذر رفع الصورة. حاول مرة أخرى.'
    };
  }

  console.log(`✅ [uploadWithdrawalScreenshot] ${requestId} → ${uploadResult.url}`);

  return {
    success: true,
    url: uploadResult.url,
    publicId: uploadResult.publicId,
    bytes: uploadResult.bytes
  };
}