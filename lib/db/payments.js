// ================================================================
//  lib/db/payments.js — إدارة عمليات الدفع (Paymob)
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { TABLES, COLS_CHILDREN } from './tables.js';

// ============================================================
//  🕐 توقيت UTC
// ============================================================
function nowUTC() {
  return new Date().toISOString();
}

// ============================================================
//  💰 amounts/plans
// ============================================================
const PLAN_PRICES = {
  '6 أشهر': 250,
  'عام واحد': 500
};

const PLAN_DAYS = {
  '6 أشهر': 180,
  'عام واحد': 365
};

// ============================================================
//  1️⃣ createPayment — إنشاء سجل دفع جديد (pending)
// ============================================================
export async function createPayment({ childID, amountCents, plan, type, intentionId, integrationId, paymobOrderId, metadata, attemptNumber, paymentMethod }) {
  try {
    const id = crypto.randomUUID();

    const row = {
      id,
      child_id: childID,
      paymob_intention_id: intentionId || null,
      paymob_order_id: paymobOrderId || null,
      amount_cents: amountCents,
      currency: 'EGP',
      status: 'pending',
      type: type || 'initial',
      plan: plan || null,
      integration_id: integrationId || null,
      metadata: metadata || null,
      attempt_number: attemptNumber || 1,
      payment_method: paymentMethod || 'unknown'
    };

    const { error } = await supabaseAdmin.from(TABLES.PAYMENTS).insert(row);
    if (error) return { success: false, error: error.message };

    return { success: true, id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  2️⃣ getLastPayment — آخر عملية دفع لطفل
// ============================================================
export async function getLastPayment(childID) {
  try {
    const { data } = await supabaseAdmin
      .from(TABLES.PAYMENTS)
      .select('*')
      .eq('child_id', childID)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data || null;
  } catch (e) {
    return null;
  }
}

// ============================================================
//  3️⃣ getPendingPayment — عملية دفع معلقة (آخر N دقايق)
// ============================================================
export async function getPendingPayment(childID, maxAgeMinutes) {
  const minutes = maxAgeMinutes || 2;  // ✅ 2 دقائق بدل 10
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();

  try {
    const { data } = await supabaseAdmin
      .from(TABLES.PAYMENTS)
      .select('*')
      .eq('child_id', childID)
      .eq('status', 'pending')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      // ✅ Math.max(0, ...) يحمي من negative age (TZ bug أو clock skew)
      const createdUTC = new Date(data.created_at).getTime();
      const ageSeconds = Math.max(0, Math.floor((Date.now() - createdUTC) / 1000));
      const ageMinutes = ageSeconds / 60;

      if (ageMinutes > 2) {
        await supabaseAdmin
          .from(TABLES.PAYMENTS)
          .update({ status: 'failed' })
          .eq('id', data.id);
        return null;
      }
    }

    return data || null;
  } catch (e) {
    return null;
  }
}

// ============================================================
//  4️⃣ countPaidPayments
// ============================================================
export async function countPaidPayments(childID) {
  try {
    const { count } = await supabaseAdmin
      .from(TABLES.PAYMENTS)
      .select('id', { count: 'exact', head: true })
      .eq('child_id', childID)
      .eq('status', 'paid');
    return count || 0;
  } catch (e) {
    return 0;
  }
}

// ============================================================
//  5️⃣ getPaymentByOrderId
// ============================================================
export async function getPaymentByOrderId(orderId) {
  try {
    const { data } = await supabaseAdmin
      .from(TABLES.PAYMENTS)
      .select('*')
      .eq('paymob_order_id', orderId)
      .maybeSingle();
    return data || null;
  } catch (e) {
    return null;
  }
}

// ============================================================
//  6️⃣ processPaymentWebhook — معالجة webhook من Paymob
// ============================================================
export async function processPaymentWebhook({ childId, paymobOrderId, success, metadata }) {
  try {
    // 1. Idempotency: لو الدفعة دي اتعملت paid خلاص، منعملش حاجة تاني
    const existing = await getPaymentByOrderId(paymobOrderId);
    if (existing && existing.status === 'paid') {
      return { success: true, alreadyPaid: true, payment: existing };
    }

    // 2. البحث عن الدفعة المستهدفة
    // - لو لقيناها بالـ orderId (ممكن تكون failed من محاولة سابقة) نستخدمها
    // - لو ملقيناهاش، بندور على آخر دفعة pending أو failed للطفل ده
    let targetPayment = existing;
    
    if (!targetPayment) {
      const { data } = await supabaseAdmin
        .from(TABLES.PAYMENTS)
        .select('*')
        .eq('child_id', childId)
        .in('status', ['pending', 'failed']) // ✅ التعديل هنا: بنقبل الـ failed عشان الـ Retry
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      targetPayment = data;
    }

    if (!targetPayment) {
      console.warn(`[processPaymentWebhook] لا يوجد payment صالح للتحديث للطفل ${childId} | order: ${paymobOrderId}`);
      return { success: false, error: 'no_payment_found' };
    }

    // 3. تحديث الدفعة
    const newStatus = success ? 'paid' : 'failed';
    
    // ✅ تحديد طريقة الدفع بناءً على الـ Integration ID اللي جاي في الـ Webhook
    let paymentMethod = 'unknown';
    const receivedIntegrationId = metadata && metadata.integrationId ? parseInt(metadata.integrationId, 10) : null;
    const cardId = parseInt(process.env.PAYMOB_INTEGRATION_ID, 10);
    const walletId = parseInt(process.env.PAYMOB_WALLET_INTEGRATION_ID, 10);
    const applePayId = parseInt(process.env.PAYMOB_APPLEPAY_INTEGRATION_ID, 10);

    if (receivedIntegrationId === cardId) paymentMethod = 'card';
    else if (receivedIntegrationId === walletId) paymentMethod = 'wallet';
    else if (receivedIntegrationId === applePayId) paymentMethod = 'apple_pay';

    const updates = {
      status: newStatus,
      paymob_order_id: paymobOrderId,
      metadata: metadata || null,
      payment_method: paymentMethod // ✅ حفظ طريقة الدفع
    };
    
    if (success) {
      updates.paid_at = nowUTC();
      if (metadata && metadata.transactionId) {
        updates.paymob_transaction_id = String(metadata.transactionId);
      }
    }

    const { error } = await supabaseAdmin
      .from(TABLES.PAYMENTS)
      .update(updates)
      .eq('id', targetPayment.id);

    if (error) return { success: false, error: error.message };

    return { success: true, payment: { ...targetPayment, status: newStatus } };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  7️⃣ activateChildSubscription — تفعيل/تمديد الاشتراك
// ============================================================
export async function activateChildSubscription({ childId, plan, paymentType }) {
  try {
    const days = PLAN_DAYS[plan];
    if (!days) return { success: false, error: 'invalid_plan' };

    // جيب الطفل
    const { data: child } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select('*')
      .eq(COLS_CHILDREN.child_id, childId)
      .maybeSingle();

    if (!child) return { success: false, error: 'child_not_found' };

    // احسب تاريخ البداية
    let baseDate;
    if (paymentType === 'renewal' && child[COLS_CHILDREN.expiry_date]) {
      const currentExpiry = new Date(child[COLS_CHILDREN.expiry_date]);
      const today = new Date();
      baseDate = (currentExpiry > today) ? currentExpiry : today;
    } else {
      baseDate = new Date();
    }

    // احسب تاريخ الانتهاء الجديد
    const newExpiry = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);

    // ✅ UTC ISO — منتصف ليل UTC (same behavior, ISO-compliant)
    const yyyy = newExpiry.getUTCFullYear();
    const mm = String(newExpiry.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(newExpiry.getUTCDate()).padStart(2, '0');
    const expiryStr = `${yyyy}-${mm}-${dd}T00:00:00.000Z`;

    const updates = {
      [COLS_CHILDREN.plan]: plan,
      [COLS_CHILDREN.status]: 'active',
      [COLS_CHILDREN.expiry_date]: expiryStr,
      [COLS_CHILDREN.payment_status]: 'confirmed'
    };

    const { error } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .update(updates)
      .eq(COLS_CHILDREN.child_id, childId);

    if (error) return { success: false, error: error.message };

    console.log(`✅ [activateChildSubscription] ${childId} → ${plan} (${paymentType}) | new expiry: ${expiryStr}`);

    return { success: true, newExpiry: expiryStr };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  8️⃣ hasScanLogs — فحص وجود أي مسح QR لطفل (أي وقت)
// ============================================================
export async function hasScanLogs(childID) {
  try {
    const { count, error } = await supabaseAdmin
      .from(TABLES.SCAN_LOGS)
      .select('child_id', { count: 'exact', head: true })
      .eq('child_id', childID);
    if (error) return false;
    return (count || 0) > 0;
  } catch (e) {
    return false;
  }
}

// ============================================================
//  9️⃣ getChildPaymentsWithEligibility — مدفوعات الطفل + الأهلية
//  تُستخدم في لوحة الأدمن لعرض المدفوعات + زر الاسترداد
// ============================================================
export async function getChildPaymentsWithEligibility(childID) {
  try {
    if (!childID) return { success: false, error: 'missing_child_id' };

    // جلب بيانات الطفل لمعرفة scan_count
    const { data: child } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select('scan_count')
      .eq(COLS_CHILDREN.child_id, childID)
      .maybeSingle();

    const scanCount = child ? (parseInt(child.scan_count || 0, 10)) : 0;

    const { data: payments, error } = await supabaseAdmin
      .from(TABLES.PAYMENTS)
      .select('*')
      .eq('child_id', childID)
      .order('created_at', { ascending: false });

    if (error) return { success: false, error: error.message };

    const enriched = (payments || []).map(function (p) {
      const paidAt = p.paid_at || p.created_at;
      const days = paidAt
        ? Math.floor((Date.now() - new Date(paidAt).getTime()) / 86400000)
        : null;

      let eligible = false;
      let reason = '';

      if (p.status === 'refunded') {
        reason = 'already_refunded';
      } else if (p.status === 'refunding') {
        reason = 'refund_in_progress';
      } else if (p.status !== 'paid') {
        reason = 'not_paid';
      } else if (scanCount > 10) {
        reason = 'service_used';
      } else if (days !== null && days < 14) {
        reason = 'before_14_days'; // لم تمر 14 يوم كاملة
      } else {
        eligible = true;
      }

      return {
        id: p.id,
        child_id: p.child_id,
        amount_cents: p.amount_cents,
        amount_egp: (p.amount_cents || 0) / 100,
        currency: p.currency || 'EGP',
        status: p.status,
        type: p.type,
        plan: p.plan,
        created_at: p.created_at,
        paid_at: p.paid_at,
        refunded_at: p.refunded_at,
        refund_reason: p.refund_reason,
        refund_admin: p.refund_admin,
        daysSincePaid: days,
        eligible: eligible,
        ineligibleReason: reason
      };
    });

    return {
      success: true,
      scanCount: scanCount,
      payments: enriched
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  🔟 refundPayment — تأكيد الاسترداد (تحديث DB + إشعارات)
//  خطوات:
//    1. فحص الأهلية (paid + <=14 يوم + scan_count <= 10)
//    2. تحديث حالة الدفع إلى refunded
//    3. تحديث حالة الطفل إلى refunded
// ============================================================
export async function refundPayment({ childID, paymentId, reason, adminUsername, skipScanCheck }) {
  try {
    // 0. تحقق من المدخلات
    if (!childID || !paymentId) {
      return { success: false, error: 'missing_params' };
    }
    const cleanReason = String(reason || '').trim();
    if (cleanReason.length < 10) {
      return {
        success: false,
        error: 'reason_too_short',
        message: 'السبب يجب أن يكون 10 أحرف على الأقل'
      };
    }

    // 1. جيب الـ payment
    const { data: payment, error: fetchErr } = await supabaseAdmin
      .from(TABLES.PAYMENTS)
      .select('*')
      .eq('id', paymentId)
      .eq('child_id', childID)
      .maybeSingle();

    if (fetchErr) return { success: false, error: 'db_error', detail: fetchErr.message };
    if (!payment) return { success: false, error: 'payment_not_found' };

    if (payment.status === 'refunded') {
      return { success: false, error: 'already_refunded' };
    }
    if (payment.status !== 'paid' && payment.status !== 'refunding') {
      return { success: false, error: 'not_paid', currentStatus: payment.status };
    }

    // 2. فحص 14 يوم
    const paidAt = payment.paid_at || payment.created_at;
    const daysSincePaid = paidAt
      ? Math.floor((Date.now() - new Date(paidAt).getTime()) / 86400000)
      : 999;
    if (daysSincePaid < 14) {
      return { success: false, error: 'before_14_days', daysSincePaid: daysSincePaid };
    }

    // 3. فحص ScanCount (إلا لو super_admin فعّل override)
    if (!skipScanCheck) {
      const { data: child } = await supabaseAdmin
        .from(TABLES.CHILDREN)
        .select('scan_count')
        .eq(COLS_CHILDREN.child_id, childID)
        .maybeSingle();
        
      const scanCount = child ? (parseInt(child.scan_count || 0, 10)) : 0;

      if (scanCount > 10) {
        return {
          success: false,
          error: 'service_used',
          message: 'تم تجاوز الحد الأقصى للمسحات (10) — غير مؤهل للاسترداد'
        };
      }
    } else {
      console.log(`⚠️ [refundPayment] SCAN CHECK SKIPPED (override) — ${childID} | admin: ${adminUsername}`);
    }

    // 4. حدّث الـ payment كـ refunded
    await supabaseAdmin
      .from(TABLES.PAYMENTS)
      .update({
        status: 'refunded',
        refunded_at: nowUTC(),
        refund_reason: cleanReason,
        refund_admin: adminUsername || null
      })
      .eq('id', paymentId);

    // 5. ألغي اشتراك الطفل (حذف منطقي)
    await supabaseAdmin
      .from(TABLES.CHILDREN)
      .update({
        [COLS_CHILDREN.status]: 'refunded',
        [COLS_CHILDREN.expiry_date]: null,
        [COLS_CHILDREN.payment_status]: 'refunded'
      })
      .eq(COLS_CHILDREN.child_id, childID);

    console.log(`✅ [refundPayment] ${childID} | Status: refunded | admin=${adminUsername}`);

    // 6. إشعار الأسرة (best-effort)
    try {
      const { notifyFamily } = await import('../notify.js');
      await notifyFamily({
        childID: childID,
        eventType: 'refund_completed',
        eventData: {
          amount: (payment.amount_cents || 0) / 100,
          currency: payment.currency || 'EGP',
          plan: payment.plan,
          reason: cleanReason
        }
      });
    } catch (e) {
      console.warn('[refundPayment] notifyFamily failed:', e.message);
    }

    return {
      success: true,
      amountEGP: (payment.amount_cents || 0) / 100,
      refundedAt: nowUTC(),
      childID: childID,
      newChildStatus: 'refunded'
    };

  } catch (e) {
    console.error('[refundPayment] exception:', e.message, e.stack);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  Exports
// ============================================================
export { PLAN_PRICES, PLAN_DAYS };