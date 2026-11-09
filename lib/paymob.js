// ================================================================
//  lib/paymob.js — تكامل مع Paymob (Intention API + HMAC)
// ================================================================

import crypto from 'crypto';

const PAYMOB_API = 'https://accept.paymob.com';
const PAYMOB_CHECKOUT = 'https://eg.checkout.paymob.com';

// ============================================================
//  1️⃣ createPaymobIntention — إنشاء نية دفع
// ============================================================
export async function createPaymobIntention({ amountEGP, planName, childId }) {
  try {
    const secretKey = String(process.env.PAYMOB_SECRET_KEY || '').trim();
    const publicKey = String(process.env.PAYMOB_PUBLIC_KEY || '').trim();
    const cardIntegrationId = parseInt(process.env.PAYMOB_INTEGRATION_ID, 10);
    const walletIntegrationId = parseInt(process.env.PAYMOB_WALLET_INTEGRATION_ID, 10);
    const applePayIntegrationId = parseInt(process.env.PAYMOB_APPLEPAY_INTEGRATION_ID, 10);

    // التأكد من وجود البيانات الأساسية (الفيزا إجبارية كخط أساس)
    if (!secretKey || !publicKey || !cardIntegrationId) {
      console.error('[paymob] متغيرات البيئة الأساسية ناقصة (Secret, Public, Card ID)');
      return { success: false, error: 'paymob_config_missing' };
    }

    // بناء مصفوفة طرق الدفع
    const paymentMethods = [cardIntegrationId];
    
    // لو الـ ID بتاع المحفظة موجود وصحيح، نضيفه للمصفوفة
    if (walletIntegrationId && !isNaN(walletIntegrationId)) {
      paymentMethods.push(walletIntegrationId);
    }

    // ✅ لو الـ ID بتاع Apple Pay موجود وصحيح، نضيفه للمصفوفة
    if (applePayIntegrationId && !isNaN(applePayIntegrationId)) {
      paymentMethods.push(applePayIntegrationId);
    }

    const amountCents = Math.round(amountEGP * 100);

    const itemNameEn = planName === '6 أشهر' ? 'KidCode 6 Months'
                     : planName === 'عام واحد' ? 'KidCode 1 Year'
                     : 'KidCode Subscription';

    // ✅ FIX: special_reference فريد لكل محاولة (timestamp)
    //    عشان Paymob متعتبرهوش duplicate من محاولة سابقة
    const cleanChildId = String(childId || '').replace(/[^A-Za-z0-9]/g, '');
    const uniqueSuffix = Date.now().toString(36); // e.g., "m1x2y3"
    const cleanSpecialRef = cleanChildId + '_' + uniqueSuffix;

    const payload = {
      amount: amountCents,
      currency: 'EGP',
      payment_methods: paymentMethods,
      items: [{
        name: itemNameEn,
        amount: amountCents,
        quantity: 1
      }],
      billing_data: {
        first_name: 'KidCode',
        last_name: 'User',
        email: 'info@kidcode-eg.com',
        phone_number: '+201004135973',
        street: 'NA',
        building: 'NA',
        floor: 'NA',
        apartment: 'NA',
        city: 'Cairo',
        state: 'Cairo',
        country: 'EG',
        postal_code: 'NA'
      },
      special_reference: cleanSpecialRef,
      // ✅ نمرر childID في الـ redirect عشان payment-success تعرف تعمل polling
      redirection_url: 'https://www.kidcode-eg.com/payment-success.html?childID=' + encodeURIComponent(childId)
    };

    console.log('[paymob] sending intention:', JSON.stringify({
      amount: amountCents,
      plan: planName,
      childId: cleanChildId,
      specialRef: cleanSpecialRef,
      orderId: null
    }));

    const response = await fetch(PAYMOB_API + '/v1/intention/', {
      method: 'POST',
      headers: {
        'Authorization': 'Token ' + secretKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    let data = {};
    const text = await response.text();
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { __rawText: text.substring(0, 1000) };
    }

    if (!response.ok) {
      // ✅ FIX: parser شامل يمسك أي شكل من الرد
      console.error('[paymob] intention failed — full raw:', {
        status: response.status,
        data: data
      });

      let errorDetail = '';

      // 1. Paymob عادةً بترجع `detail` (string أو object)
      if (typeof data.detail === 'string' && data.detail.length > 0) {
        errorDetail = data.detail;
      }
      // 2. أو `message` (string)
      else if (typeof data.message === 'string' && data.message.length > 0) {
        errorDetail = data.message;
      }
      // 3. أو `detail` object
      else if (data.detail && typeof data.detail === 'object') {
        errorDetail = JSON.stringify(data.detail);
      }
      // 4. أو حقول validation (Django-style) زي {"special_reference": ["..."]}
      else if (Object.keys(data).length > 0) {
        const parts = [];
        for (const key of Object.keys(data)) {
          if (key === '__rawText') continue;
          const val = data[key];
          if (Array.isArray(val) && val.length > 0) {
            parts.push(key + ': ' + val.join(', '));
          } else if (typeof val === 'string') {
            parts.push(key + ': ' + val);
          } else if (val && typeof val === 'object') {
            parts.push(key + ': ' + JSON.stringify(val));
          }
        }
        errorDetail = parts.length > 0 ? parts.join(' | ') : JSON.stringify(data).substring(0, 300);
      }
      // 5. أو نص خام
      else if (data.__rawText) {
        errorDetail = data.__rawText;
      }
      // 6. Fallback
      else {
        errorDetail = 'Paymob returned HTTP ' + response.status + ' with empty body';
      }

      // ✅ كشف خاص لرسالة "special_reference already exists"
      if (errorDetail.toLowerCase().includes('special_reference') ||
          errorDetail.toLowerCase().includes('duplicate') ||
          errorDetail.toLowerCase().includes('already exist')) {
        errorDetail = 'توجد عملية دفع سابقة نشطة. يرجى الانتظار 5 دقائق أو استخدام خطة مختلفة. (التفاصيل: ' + errorDetail + ')';
      }

      return {
        success: false,
        error: 'intention_failed',
        detail: errorDetail,
        status: response.status,
        raw: data
      };
    }

    const clientSecret = data.client_secret;
    const intentionId = data.id;
    const orderId = data.intention_order_id; // ← FIX: order_id اللي هيجي في الـ webhook
    const checkoutUrl = `${PAYMOB_CHECKOUT}/?publicKey=${publicKey}&clientSecret=${clientSecret}`;

    console.log(`✅ [paymob] intention created: ${intentionId} | order: ${orderId} | child: ${childId} | amount: ${amountEGP} EGP`);

    return {
      success: true,
      intentionId,
      clientSecret,
      checkoutUrl,
      integrationId: cardIntegrationId,
      orderId,
      specialRef: cleanSpecialRef
    };
  } catch (e) {
    console.error('[paymob] exception:', e.message, e.stack);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  2️⃣ verifyPaymobHmac — التحقق من توقيع الـ webhook
// ============================================================
export function verifyPaymobHmac(obj, receivedHmac) {
  try {
    const hmacSecret = process.env.PAYMOB_HMAC_SECRET;
    if (!hmacSecret) {
      console.error('[paymob] PAYMOB_HMAC_SECRET غير مضبوط');
      return false;
    }
    if (!obj || !receivedHmac) return false;

    // الحقول بالترتيب الإلزامي من Paymob
    const FIELDS = [
      'amount_cents',
      'created_at',
      'currency',
      'error_occured',
      'has_parent_transaction',
      'id',
      'integration_id',
      'is_3d_secure',
      'is_auth',
      'is_capture',
      'is_refunded',
      'is_standalone_payment',
      'is_voided',
      'order.id',
      'owner',
      'pending',
      'source_data.pan',
      'source_data.sub_type',
      'source_data.type',
      'success'
    ];

    const get = (path) => {
      const parts = path.split('.');
      let v = obj;
      for (const p of parts) {
        if (v === null || v === undefined) return '';
        v = v[p];
      }
      if (v === null || v === undefined) return '';
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      return String(v);
    };

    const concatenated = FIELDS.map(get).join('');

    const computed = crypto
      .createHmac('sha512', hmacSecret)
      .update(concatenated)
      .digest('hex');

    if (typeof receivedHmac !== 'string' || receivedHmac.length !== computed.length) {
      return false;
    }

    // Timing-safe compare
    try {
      return crypto.timingSafeEqual(
        Buffer.from(computed, 'hex'),
        Buffer.from(receivedHmac, 'hex')
      );
    } catch (e) {
      return false;
    }
  } catch (e) {
    console.error('[paymob] hmac verify exception:', e.message);
    return false;
  }
}

// ============================================================
//  3️⃣ refundPaymobTransaction — استرداد مبلغ عبر Paymob Refund API
//  POST https://accept.paymob.com/api/acceptance/void_refund/refund
// ============================================================
export async function refundPaymobTransaction({ transactionId, amountCents }) {
  try {
    const secretKey = String(process.env.PAYMOB_SECRET_KEY || '').trim();
    if (!secretKey) {
      console.error('[paymob] refund: PAYMOB_SECRET_KEY غير مضبوط');
      return { success: false, error: 'paymob_config_missing' };
    }

    if (!transactionId) {
      return { success: false, error: 'missing_transaction_id' };
    }

    const amt = parseInt(amountCents, 10);
    if (!amt || amt <= 0) {
      return { success: false, error: 'invalid_amount' };
    }

    const payload = {
      transaction_id: String(transactionId),
      amount_cents: amt
    };

    console.log('[paymob] refund request:', payload);

    const response = await fetch(PAYMOB_API + '/api/acceptance/void_refund/refund', {
      method: 'POST',
      headers: {
        'Authorization': 'Token ' + secretKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    // قراءة الرد بأمان (JSON أو نص)
    let data = {};
    const text = await response.text();
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { __rawText: text.substring(0, 500) };
    }

    if (!response.ok || data.success === false) {
      console.error('[paymob] refund failed — full raw:', {
        status: response.status,
        data: data
      });

      const errorDetail =
        (typeof data.message === 'string' && data.message) ||
        (typeof data.detail === 'string' && data.detail) ||
        (data.detail && typeof data.detail === 'object' && JSON.stringify(data.detail)) ||
        data.__rawText ||
        ('Paymob returned HTTP ' + response.status);

      return {
        success: false,
        error: 'refund_failed',
        detail: errorDetail,
        status: response.status,
        raw: data
      };
    }

    console.log(`✅ [paymob] refunded: tx=${transactionId} amount=${amt} refundId=${data.id}`);

    return {
      success: true,
      refundId: data.id,
      refundedAmountCents: data.amount_cents || amt,
      createdAt: data.created_at || new Date().toISOString(),
      raw: data
    };

  } catch (e) {
    console.error('[paymob] refund exception:', e.message, e.stack);
    return { success: false, error: e.message };
  }
}