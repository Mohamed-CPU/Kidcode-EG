// ================================================================
//  lib/admin/audit.js — سجل العمليات
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES } from '../db/tables.js';

// ============================================================
//  🕐 nowUTC — التوقيت الحالي بصيغة UTC ISO
//  ⚠️ أي قيمة تُخزَّن في عمود timestamp with time zone
//     يجب ان تكون UTC ISO (مع 'Z' في الآخر)
// ============================================================
function nowUTC() {
  return new Date().toISOString();
}

// ============================================================
//  📝 writeAuditLog — تسجيل عملية (fire-and-forget)
// ============================================================
export async function writeAuditLog(params) {
  try {
    await supabaseAdmin
      .from(TABLES.ADMIN_AUDIT_LOG)
      .insert({
        username: params.username || null,
        action: params.action || 'unknown',
        target_table: params.target_table || null,
        target_id: params.target_id || null,
        changes: params.changes || null,
        ip_address: params.ip_address || null,
        user_agent: params.user_agent || null,
        created_at: nowUTC()
      });
  } catch (e) {
    // فشل صامت
  }
}

// ============================================================
//  🧹 cleanupOldAuditLogs — حذف السجلات الأقدم من 24 شهرًا
// ============================================================
export async function cleanupOldAuditLogs() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 24);

  // ✅ UTC ISO — متوافق مع عمود timestamptz في Supabase
  const cutoffStr = cutoff.toISOString();

  const { error } = await supabaseAdmin
    .from(TABLES.ADMIN_AUDIT_LOG)
    .delete()
    .lt('created_at', cutoffStr);

  return { success: !error, error: error ? error.message : null };
}