// ================================================================
//  lib/admin/revoke-id.js — تغيير كود الطفل (Revoke)
//  - revokeChildId: توليد كود جديد + نقل البيانات
//  - checkRevoked: فحص لو الكود ملغى (للـ redirect)
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN } from '../db/tables.js';
import { getClientIP } from './auth.js';
import { writeAuditLog } from './audit.js';
import { notifyFamily } from '../notify.js';

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
//  🔧 الثوابت
// ============================================================
const REVOKE_COOLDOWN_HOURS = 12;

const VALID_REASONS = [
  'leaked_data',
  'lost_qr',
  'family_request',
  'other'
];

const REASON_LABELS_AR = {
  'leaked_data':    'تسريب بيانات الطفل',
  'lost_qr':        'فقدان أو سرقة رمز QR',
  'family_request': 'طلب من الأسرة',
  'other':          'سبب آخر'
};

// ============================================================
//  🔢 توليد كود فريد (نفس منطق registration.js)
// ============================================================
async function generateUniqueChildID() {
  for (let i = 0; i < 100; i++) {
    const num = Math.floor(Math.random() * 90000) + 10000;
    const id = 'KC-' + num;
    const { data } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select(COLS_CHILDREN.child_id)
      .eq(COLS_CHILDREN.child_id, id)
      .maybeSingle();
    if (!data) return id;
  }
  throw new Error('تعذر إنشاء كود فريد للطفل');
}

// ============================================================
//  🎫 توليد token جديد
// ============================================================
function buildChildToken(childID) {
  const raw = childID + Date.now() + Math.random().toString(36).substring(2, 15) + crypto.randomUUID();
  return crypto.createHash('sha256').update(raw).digest('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
}

// ============================================================
//  🔗 روابط الطفل
// ============================================================
function buildChildLink(childID) {
  return 'https://www.kidcode-eg.com/redirect.html?action=childView&id=' + encodeURIComponent(childID);
}

function buildQRCodeURL(childID) {
  const targetUrl = 'https://www.kidcode-eg.com/redirect.html?id=' + encodeURIComponent(childID);
  return 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(targetUrl);
}

// ============================================================
//  ⏱️ فحص Cooldown (12 ساعة)
// ============================================================
async function checkRevokeCooldown(currentChildID) {
  try {
    const { data } = await supabaseAdmin
      .from(TABLES.REVOKED_CHILD_IDS)
      .select('revoked_at')
      .eq('new_child_id', currentChildID)
      .order('revoked_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data || !data.revoked_at) return { allowed: true };

    const revokedAt = new Date(data.revoked_at).getTime();
    if (isNaN(revokedAt)) return { allowed: true };

    const hoursSince = (Date.now() - revokedAt) / (1000 * 60 * 60);
    if (hoursSince < REVOKE_COOLDOWN_HOURS) {
      const remainingMin = Math.ceil((REVOKE_COOLDOWN_HOURS - hoursSince) * 60);
      return {
        allowed: false,
        remainingMin: remainingMin,
        message: 'آخر تغيير كان قبل ' + Math.round(hoursSince * 60) + ' دقيقة. يمكن إعادة التغيير بعد ' + remainingMin + ' دقيقة.'
      };
    }

    return { allowed: true };

  } catch (e) {
    return { allowed: true };
  }
}

// ============================================================
//  🚀 revokeChildId — الدالة الرئيسية
// ============================================================
export async function revokeChildId(params) {
  const oldID = String(params.childID || '').trim().toUpperCase();
  let reason = String(params.reason || '').trim();
  let notes = String(params.notes || '').trim();
  const adminUsername = params.adminUsername || 'unknown';
  const req = params.req;

  // ═══════════════════════════════════════════
  //  1. Validation
  // ═══════════════════════════════════════════
  if (!oldID) {
    return { success: false, error: 'missing_child_id', message: 'كود الطفل مطلوب' };
  }

  if (!VALID_REASONS.includes(reason)) {
    return { success: false, error: 'invalid_reason', message: 'يرجى اختيار سبب صالح' };
  }

  if (!notes || notes.length < 10) {
    return {
      success: false,
      error: 'missing_notes',
      message: 'ملاحظات الأدمن إلزامية (10 أحرف على الأقل)'
    };
  }

  if (notes.length > 500) notes = notes.substring(0, 500);

  const t0 = Date.now();

  // ═══════════════════════════════════════════
  //  2. جيب الطفل
  // ═══════════════════════════════════════════
  const { data: child, error: fetchErr } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .select('*')
    .eq(COLS_CHILDREN.child_id, oldID)
    .maybeSingle();

  if (fetchErr) return { success: false, error: 'fetch_failed', message: fetchErr.message };
  if (!child) return { success: false, error: 'child_not_found', message: 'الطفل غير موجود' };

  const status = String(child[COLS_CHILDREN.status] || '').trim().toLowerCase();
  if (status === 'deleted') {
    return { success: false, error: 'child_deleted', message: 'لا يمكن تغيير كود طفل محذوف' };
  }

  // ═══════════════════════════════════════════
  //  3. Cooldown
  // ═══════════════════════════════════════════
  const cooldown = await checkRevokeCooldown(oldID);
  if (!cooldown.allowed) {
    return { success: false, error: 'cooldown', message: cooldown.message };
  }

  // ═══════════════════════════════════════════
  //  4. توليد الكود الجديد
  // ═══════════════════════════════════════════
  let newID;
  try {
    newID = await generateUniqueChildID();
  } catch (e) {
    return { success: false, error: 'id_generation_failed', message: e.message };
  }

  const newToken = buildChildToken(newID);
  const newLink = buildChildLink(newID);
  const newQRUrl = buildQRCodeURL(newID);

  console.log('[revokeChildId] ' + oldID + ' → ' + newID);

  // ═══════════════════════════════════════════
  //  5. تحديث الجدول الرئيسي
  // ═══════════════════════════════════════════
  const { error: updateMainErr } = await supabaseAdmin
    .from(TABLES.CHILDREN)
    .update({
      [COLS_CHILDREN.child_id]: newID,
      [COLS_CHILDREN.child_token]: newToken,
      [COLS_CHILDREN.child_link]: newLink,
      [COLS_CHILDREN.qr_code_pics]: newQRUrl
    })
    .eq(COLS_CHILDREN.child_id, oldID);

  if (updateMainErr) {
    return {
      success: false,
      error: 'main_update_failed',
      message: 'فشل تحديث الجدول الرئيسي: ' + updateMainErr.message
    };
  }

  // ═══════════════════════════════════════════
  //  6. تحديث الجداول المرتبطة (best-effort)
  // ═══════════════════════════════════════════
  const updateResults = {};

  try {
    await supabaseAdmin.from(TABLES.FACE_FEATURES).update({ child_id: newID }).eq('child_id', oldID);
    updateResults.face_features = 'ok';
  } catch (e) { updateResults.face_features = 'failed'; }

  try {
    await supabaseAdmin.from(TABLES.SCAN_LOGS).update({ child_id: newID }).eq('child_id', oldID);
    updateResults.scan_logs = 'ok';
  } catch (e) { updateResults.scan_logs = 'failed'; }

  try {
    await supabaseAdmin.from(TABLES.MISSING_REPORTS).update({ child_id: newID }).eq('child_id', oldID);
    updateResults.missing_reports = 'ok';
  } catch (e) { updateResults.missing_reports = 'failed'; }

  try {
    await supabaseAdmin.from(TABLES.CHILD_EDIT_LOG).update({ child_id: newID }).eq('child_id', oldID);
    updateResults.child_edit_log = 'ok';
  } catch (e) { updateResults.child_edit_log = 'failed'; }

  // ✅ نقل سجل المدفوعات للكود الجديد
  try {
    await supabaseAdmin.from(TABLES.PAYMENTS).update({ child_id: newID }).eq('child_id', oldID);
    updateResults.payments = 'ok';
  } catch (e) { updateResults.payments = 'failed'; }

  // ═══════════════════════════════════════════
  //  7. حذف البيانات المؤقتة (الأسرة تُطرد)
  // ═══════════════════════════════════════════

  try {
    await supabaseAdmin.from(TABLES.FAMILY_SESSIONS).delete().eq('child_id', oldID);
    updateResults.family_sessions = 'deleted';
  } catch (e) { updateResults.family_sessions = 'failed'; }

  try {
    await supabaseAdmin.from(TABLES.TEMP_TOKENS).delete().eq('childid', oldID);
    updateResults.temp_tokens = 'deleted';
  } catch (e) { updateResults.temp_tokens = 'failed'; }

  try {
    await supabaseAdmin.from(TABLES.LOGIN_ATTEMPTS).delete().eq('child_id', oldID);
    updateResults.login_attempts = 'deleted';
  } catch (e) { updateResults.login_attempts = 'failed'; }

  try {
    await supabaseAdmin.from(TABLES.PASSWORD_RESET_ATTEMPTS).delete().eq('child_id', oldID);
    updateResults.password_reset_attempts = 'deleted';
  } catch (e) { updateResults.password_reset_attempts = 'failed'; }

  try {
    await supabaseAdmin.from(TABLES.FAMILY_RESET_TOKENS).delete().eq('child_id', oldID);
    updateResults.family_reset_tokens = 'deleted';
  } catch (e) { updateResults.family_reset_tokens = 'failed'; }

  try {
    await supabaseAdmin.from(TABLES.UNLINK_OTPS).delete().eq('child_id', oldID);
    updateResults.unlink_otps = 'deleted';
  } catch (e) { updateResults.unlink_otps = 'failed'; }

  try {
    await supabaseAdmin.from(TABLES.PENDING_LINKS).delete().eq('child_id', oldID);
    updateResults.pending_links = 'deleted';
  } catch (e) { updateResults.pending_links = 'failed'; }

  console.log('[revokeChildId] updates:', updateResults);

  // ═══════════════════════════════════════════
  //  8. سجّل في RevokedChildIds
  // ═══════════════════════════════════════════
  const reasonLabel = REASON_LABELS_AR[reason] || reason;

  const { error: insertRevokedErr } = await supabaseAdmin
    .from(TABLES.REVOKED_CHILD_IDS)
    .insert({
      old_child_id: oldID,
      new_child_id: newID,
      revoked_at: nowEgypt(),
      revoked_by: adminUsername,
      reason: reason,
      notes: notes,
      notified_via: 'لا'
    });

  if (insertRevokedErr) {
    console.error('[revokeChildId] RevokedChildIds insert:', insertRevokedErr.message);
  }

  // ═══════════════════════════════════════════
  //  9. إشعار الأسرة (حسب notification_method)
  // ═══════════════════════════════════════════
  let notifiedVia = 'لا';

  try {
    const childName = String(child[COLS_CHILDREN.child_name] || 'الطفل').trim();

    const notifyResult = await notifyFamily({
      childID: newID,
      eventType: 'child_id_revoked',
      eventData: {
        oldChildID: oldID,
        newChildID: newID,
        newQRUrl: newQRUrl,
        reasonLabel: reasonLabel,
        childName: childName
      }
    });

    if (notifyResult && notifyResult.success) {
      notifiedVia = notifyResult.channel || 'email';
    }
  } catch (e) {
    console.error('[revokeChildId] notifyFamily:', e.message);
  }

  // ═══════════════════════════════════════════
  //  10. تحديث notified_via
  // ═══════════════════════════════════════════
  try {
    await supabaseAdmin
      .from(TABLES.REVOKED_CHILD_IDS)
      .update({
        notified_via: notifiedVia,
        family_notified_at: notifiedVia !== 'لا' ? nowEgypt() : null
      })
      .eq('old_child_id', oldID);
  } catch (e) {}

  // ═══════════════════════════════════════════
  //  11. Audit Log
  // ═══════════════════════════════════════════
  await writeAuditLog({
    username: adminUsername,
    action: 'revoke_child_id',
    target_table: TABLES.CHILDREN,
    target_id: oldID,
    changes: {
      old_child_id: oldID,
      new_child_id: newID,
      reason: reason,
      reason_label: reasonLabel,
      notes: notes,
      notified_via: notifiedVia,
      update_results: updateResults
    },
    ip_address: getClientIP(req),
    user_agent: req ? String(req.headers['user-agent'] || '').substring(0, 300) : null
  });

  console.log('[revokeChildId] DONE ' + oldID + ' → ' + newID + ' (' + (Date.now() - t0) + 'ms)');

  // ═══════════════════════════════════════════
  //  12. النجاح
  // ═══════════════════════════════════════════
  return {
    success: true,
    oldChildID: oldID,
    newChildID: newID,
    newChildLink: newLink,
    newQRUrl: newQRUrl,
    notifiedVia: notifiedVia,
    message: notifiedVia !== 'لا'
      ? 'تم تغيير الكود بنجاح، وتم إشعار الأسرة عبر ' + (notifiedVia === 'telegram' ? 'تليجرام' : 'البريد الإلكتروني') + '.'
      : 'تم تغيير الكود بنجاح، لكن تعذر إشعار الأسرة. يرجى التواصل معهم مباشرةً.'
  };
}

// ============================================================
//  🔍 checkRevoked — فحص لو الكود ملغى
// ============================================================
export async function checkRevoked(childID) {
  const cleanID = String(childID || '').trim().toUpperCase();
  if (!cleanID) return { revoked: false };

  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.REVOKED_CHILD_IDS)
      .select('old_child_id,new_child_id,revoked_at,reason')
      .eq('old_child_id', cleanID)
      .maybeSingle();

    if (error || !data) return { revoked: false };

    return {
      revoked: true,
      newChildID: String(data.new_child_id || '').trim(),
      revokedAt: data.revoked_at,
      reason: String(data.reason || '')
    };

  } catch (e) {
    console.error('[checkRevoked]', e.message);
    return { revoked: false };
  }
}

// ============================================================
//  📋 Exports
// ============================================================
export { REASON_LABELS_AR, VALID_REASONS };