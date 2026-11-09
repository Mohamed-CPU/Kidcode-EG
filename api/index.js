// ================================================================
//  api/index.js — الراوتر الموحد لكل APIs المشروع
//  يجمع: token, location, child, telegram في دالة واحدة
//  لتوفير حد Vercel Hobby (12 serverless function)
// ================================================================

// ============================================================
//  🕐 توقيت مصر
// ============================================================
function nowEgypt12() {
  const d = new Date();
  const datePart = d.toLocaleDateString('sv-SE', { timeZone: 'Africa/Cairo' });
  const timePart = d.toLocaleTimeString('en-US', {
    timeZone: 'Africa/Cairo', hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  return datePart + ' ' + timePart;
}

// ================================================================
//  🧰 Helper: تصنيف الأخطاء وإرجاع رسالة مناسبة للمستخدم
//  - النوع: شبكة / خادم / قاعدة بيانات / مهلة / غير معروف
//  - لا يكشف أي تفاصيل تقنية
// ================================================================
function classifyError(error) {
  if (!error) {
    return {
      status: 500,
      code: 'unknown_error',
      userMessage: 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.'
    };
  }

  const name = String(error.name || '');
  const message = String(error.message || '').toLowerCase();

  // 1. انتهت المهلة أو أُلغي الطلب
  if (name === 'AbortError' || message.includes('timeout') || message.includes('timed out') || message.includes('aborted')) {
    return {
      status: 504,
      code: 'timeout',
      userMessage: 'استغرق الطلب وقتًا أطول من المتوقع. يرجى المحاولة مرة أخرى.'
    };
  }

  // 2. مشكلة شبكة
  if (name === 'TypeError' && (
        message.includes('fetch') ||
        message.includes('network') ||
        message.includes('failed') ||
        message.includes('enotfound') ||
        message.includes('econnrefused') ||
        message.includes('econnreset')
      )) {
    return {
      status: 503,
      code: 'network_error',
      userMessage: 'تعذر الاتصال بالخادم. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.'
    };
  }

  // 3. خطأ في قاعدة البيانات
  if (
    message.includes('supabase') ||
    message.includes('postgres') ||
    message.includes('relation') ||
    message.includes('column') ||
    message.includes('duplicate key') ||
    message.includes('foreign key') ||
    message.includes('does not exist')
  ) {
    return {
      status: 500,
      code: 'database_error',
      userMessage: 'حدث خطأ في النظام. يرجى المحاولة لاحقًا.'
    };
  }

  // 4. خطأ في مزود البريد أو تليجرام
  //    (نستثني أخطاء الاستيراد — لأنها لا علاقة لها بالإشعارات)
  if (
    !message.includes('does not provide an export') &&
    !message.includes('cannot find module') &&
    !message.includes('syntaxerror') &&
    (
      message.includes('brevo') ||
      message.includes('telegram') ||
      message.includes('smtp') ||
      message.includes('mail')
    )
  ) {
    return {
      status: 500,
      code: 'notification_error',
      userMessage: 'تعذر إرسال الإشعار حاليًا. يرجى المحاولة لاحقًا.'
    };
  }

  // 5. غير معروف
  return {
    status: 500,
    code: 'internal_error',
    userMessage: 'حدث خطأ غير متوقع. تم إخطار فريق الدعم وسنتواصل معك إن لزم الأمر.'
  };
}

// ================================================================
//  🧰 Helper: استجابة خطأ آمنة موحّدة
//  - يفحص نوع الخطأ
//  - يرسل التفاصيل التقنية إلى تليجرام الأدمن
//  - يرد على المستخدم برسالة عربية مناسبة + رقم مرجعي (عند اللزوم)
// ================================================================
async function safeErrorResponse(res, error, source, context) {
  // 1. تصنيف الخطأ
  const info = classifyError(error);

  // 2. إرسال التفاصيل إلى تليجرام (fire-and-forget)
  let refId = '';
  try {
    const { reportServerError } = await import('../lib/error-logger.js');
    refId = await reportServerError({
      source: source || 'unknown',
      error: error,
      context: context || {}
    });
  } catch (e) {
    // فشل صامت
  }

  // 3. الرد على المستخدم
  try {
    const payload = {
      success: false,
      error: info.code,
      message: info.userMessage
    };

    // إضافة الرقم المرجعي فقط في الأخطاء غير المتوقعة
    if (info.code === 'internal_error' && refId) {
      payload.refId = refId;
    }

    return res.status(info.status).json(payload);
  } catch (e) {
    try { return res.status(500).end(); } catch (e2) {}
  }
}

// ================================================================
//  الـ Handler الرئيسي — يقرأ action ويوجّه
// ================================================================
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // استخراج action من الـ query أو الـ body
  const action = (req.query && req.query.action) || (req.body && req.body.action);

  switch (action) {
    case 'token':
      return handleToken(req, res);
    case 'location':
      return handleLocation(req, res);
    case 'child':
      return handleChild(req, res);
    case 'telegram':
      return handleTelegram(req, res);
    case 'contact':
      return handleContact(req, res);
    case 'notify':
      return handleNotify(req, res);
    case 'notifyMarketer':
      return handleNotifyMarketer(req, res);
    case 'register':
      return handleRegister(req, res);
    case 'family':
      return handleFamily(req, res);
    case 'registerMarketer':
      return handleMarketerWrite(req, res);
    case 'forgotPassword':
      return handleMarketerWrite(req, res);
    case 'resetPassword':
      return handleMarketerWrite(req, res);
    case 'marketerDeleteAccount':
      return handleMarketerWrite(req, res);
    case 'marketer':
      return handleMarketer(req, res);
    case 'health':
      return handleHealth(req, res);
    case 'config':
      return handleConfig(req, res);
    case 'marketerReminder':
      return handleMarketerReminder(req, res);
    case 'demoRegister':
      return handleDemoRegister(req, res);
    case 'emailQueue':
      return handleEmailQueue(req, res);
    case 'familyWeeklyReport':
      return handleFamilyWeeklyReport(req, res);
    case 'marketerWeeklyReport':
      return handleMarketerWeeklyReport(req, res);
    case 'checkMarketerCommissions':
      return handleCheckMarketerCommissions(req, res);
    case 'cleanup':
      return handleCleanup(req, res);
    case 'unsubscribe':
      return handleUnsubscribe(req, res);
    case 'subscribeNewsletter':
      return handleSubscribeNewsletter(req, res);
    case 'volunteerFound':
      return handleVolunteerFound(req, res);
    case 'confirmReceived':
      return handleConfirmReceived(req, res);
    case 'getReportDetails':
      return handleGetReportDetails(req, res);
    case 'reportMissing':
      return handleReportMissing(req, res);
    case 'escalateMissingReport':
      return handleEscalateMissingReport(req, res);
    case 'reportError':
      return handleReportError(req, res);
    case 'testTelegram':
      return handleTestTelegram(req, res);
    case 'admin':
      return handleAdminRoute(req, res);
    case 'checkRevoked':
      return handleCheckRevoked(req, res);
    case 'createPaymobIntention':
      return handleCreatePaymobIntention(req, res);
    case 'paymobWebhook':
      return handlePaymobWebhook(req, res);
    case 'getPaymentStatus':
      return handleGetPaymentStatus(req, res);
    case 'paymobDiagnostics':
      return handlePaymobDiagnostics(req, res);
    default:
      return res.status(400).json({ success: false, error: 'invalid_action' });
  }
}

// ================================================================
//  🎫 Handler: Token (createToken)
//  GET  /api?action=token&id=...
//  POST /api?action=token  { id, faceImage }
// ================================================================
async function handleToken(req, res) {
  // GET
  if (req.method === 'GET') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ success: false, error: 'missing_id' });

    try {
      const { createOneTimeToken } = await import('../lib/db/tokens.js');
      const result = await createOneTimeToken({ childID: id, faceImage: null });

      if (result.success) {
        return res.status(200).json({
          success: true,
          tempToken: result.token,
          faceVerification: result.faceVerification || null
        });
      }

      return res.status(200).json({
        success: false,
        code: result.code || 'token_failed',
        message: result.message || '',
        childID: result.childID || '',
        childName: result.childName || '',
        tempToken: null
      });

    } catch (error) {
      return await safeErrorResponse(res, error, 'handleToken:GET', { id });
    }
  }

  // POST
  if (req.method === 'POST') {
    try {
      const { id, faceImage } = req.body;
      if (!id) return res.status(400).json({ success: false, error: 'missing_id' });

      const { createOneTimeToken } = await import('../lib/db/tokens.js');
      const result = await createOneTimeToken({ childID: id, faceImage: faceImage || null });

      if (result.success) {
        return res.status(200).json({
          success: true,
          tempToken: result.token,
          faceVerification: result.faceVerification || null
        });
      }

      return res.status(200).json({
        success: false,
        code: result.code || 'token_failed',
        message: result.message || '',
        childID: result.childID || '',
        childName: result.childName || '',
        tempToken: null
      });

    } catch (error) {
      return await safeErrorResponse(res, error, 'handleToken:POST', { id: req.body && req.body.id });
    }
  }

  return res.status(405).json({ success: false, error: 'method_not_allowed' });
}

// ================================================================
//  📍 Handler: Location (recordLocation)
//  POST /api?action=location  { childID, token, lat, lng, ... }
// ================================================================
async function handleLocation(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const body = req.body || {};

  try {
    const { recordLocation } = await import('../lib/db/locations.js');
    const result = await recordLocation({
      childID: body.childID,
      token: body.token,
      lat: body.lat,
      lng: body.lng,
      source: body.source || 'unknown',
      accuracy: body.accuracy || null,
      userAgent: body.userAgent || 'unknown',
      clientIP: body.clientIP || 'UNKNOWN',
      demoToken: body.demoToken || ''
    });

    return res.status(200).json(result);

  } catch (error) {
    return await safeErrorResponse(res, error, 'handleLocation', { childID: body.childID });
  }
}

// ================================================================
//  👶 Handler: Child Data — Supabase-First
//  GET /api?action=child&id=...&tempToken=...&demo=...
// ================================================================
async function handleChild(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const { id, tempToken, demo } = req.query;
  if (!id) return res.status(400).json({ success: false, error: 'missing_id' });

  try {
    const { getChildData } = await import('../lib/db/children.js');
    const result = await getChildData({ id, tempToken, demo });
    return res.status(200).json(result);

  } catch (error) {
    return await safeErrorResponse(res, error, 'handleChild', { id });
  }
}

// ================================================================
//  📱 Handler: Telegram (Webhook + Frontend requests)
// ================================================================
async function handleTelegram(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const body = req.body || {};

  // ============================================================
  //  الحالة 1: Telegram Webhook
  // ============================================================
  if (body.update_id) {
    try {
      let handled = false;
      let handleResult = null;

      try {
        const { handleTelegramWebhook } = await import('../lib/telegram-webhook.js');
        handleResult = await handleTelegramWebhook(body);
        handled = handleResult && handleResult.handled === true;
      } catch (vercelError) {
        // فشل معالج Vercel — نكمل لـ GAS
      }

      if (handled) {
        return res.status(200).json({ ok: true });
      }

      console.warn('[handleTelegram] Webhook not handled by Vercel, ignoring.');
      return res.status(200).json({ ok: true });

    } catch (error) {
      // دائماً نرجع 200 لتليجرام
      return res.status(200).json({ ok: true });
    }
  }

  // ============================================================
  //  الحالة 2: طلبات من الواجهة الأمامية
  // ============================================================
  const innerAction = body.innerAction || body.telegramAction;
  const allowedActions = [
    'generateLinkToken',
    'unlinkTelegram',
    'requestUnlinkOTP',
    'setNotificationMethod',
    'getTelegramStatus',
    'generateMarketerLinkToken',
    'unlinkMarketerTelegram',
    'setMarketerNotificationMethod',
    'getMarketerTelegramStatus'
  ];

  if (!innerAction || !allowedActions.includes(innerAction)) {
    return res.status(400).json({ success: false, error: 'invalid_telegram_action' });
  }

  try {
    const SUPABASE_FAMILY_ACTIONS = [
      'generateLinkToken',
      'unlinkTelegram',
      'requestUnlinkOTP',
      'setNotificationMethod',
      'getTelegramStatus'
    ];

    if (SUPABASE_FAMILY_ACTIONS.includes(innerAction)) {
      try {
        const { handleSupabaseRead } = await import('../lib/db/family-read.js');
        let result = await handleSupabaseRead(innerAction, body);

        if (result === null || result === undefined) {
          const { handleSupabaseWrite } = await import('../lib/db/family-write.js');
          result = await handleSupabaseWrite(innerAction, body);
        }

        if (result !== null && result !== undefined) {
          return res.status(200).json(result);
        }
      } catch (e) {
        // نكمل لـ GAS
      }
    }

    const SUPABASE_MARKETER_ACTIONS = [
      'generateMarketerLinkToken',
      'unlinkMarketerTelegram',
      'setMarketerNotificationMethod',
      'getMarketerTelegramStatus'
    ];

    if (SUPABASE_MARKETER_ACTIONS.includes(innerAction)) {
      try {
        const { handleSupabaseMarketerWrite } = await import('../lib/db/marketer-write.js');
        const result = await handleSupabaseMarketerWrite(innerAction, body);

        if (result !== null && result !== undefined) {
          return res.status(200).json(result);
        }
      } catch (e) {
        // نكمل لـ GAS
      }
    }

    // لا يوجد Fallback لـ GAS
    return res.status(400).json({ success: false, error: 'unsupported_telegram_action', message: 'هذا الإجراء غير مدعوم حالياً' });

  } catch (error) {
    return await safeErrorResponse(res, error, 'handleTelegram', { innerAction });
  }
}

// ================================================================
//  ✉️ Handler: Contact Form
// ================================================================
async function handleContact(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'method_not_allowed' });

  const body = req.body || {};
  if (!body.name || !body.email || !body.subject || !body.message) {
    return res.status(400).json({ success: false, error: 'missing_required_fields' });
  }

  try {
    const { sendContactFormEmail } = await import('../lib/db/contact.js');
    const result = await sendContactFormEmail(body);
    return res.status(200).json(result);
  } catch (error) {
    return await safeErrorResponse(res, error, 'handleContact', { email: body.email });
  }
}

// ================================================================
//  👨‍👩‍👧 Handler: Family
// ================================================================
async function handleFamily(req, res) {
  const query = req.query || {};
  const body = req.body || {};

  const innerAction = query.innerAction || body.innerAction || '';

  try {
    const ALLOWED_FAMILY_ACTIONS = [
      'familyLogin',
      'familyLogout',
      'verifyFamilySession',
      'completeFamilyMigration',
      'familyForgotPassword',
      'familyResetPassword',
      'changeFamilyPassword',
      'setFamilyPassword',
      'hasFamilyPassword',
      'deleteChildAccount',
      'disableChildAccount',
      'enableChildAccount',
      'getFamilyReports',
      'getScanReport',
      'getChildDataForFamily',
      'updateChildData',
      'getFaceStatus',
      'saveFaceFeatures',
      'saveFaceFeaturesFromFamily',
      'deleteFaceFeatures',
      'generateLinkToken',
      'unlinkTelegram',
      'requestUnlinkOTP',
      'setNotificationMethod',
      'refreshFamilySession',
      'getTelegramStatus'
    ];

    if (!innerAction || !ALLOWED_FAMILY_ACTIONS.includes(innerAction)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_family_action',
        message: 'الإجراء المطلوب غير صالح'
      });
    }

    const GET_ACTIONS = [
      'verifyFamilySession',
      'hasFamilyPassword',
      'getFamilyReports',
      'getScanReport',
      'getChildDataForFamily',
      'getFaceStatus',
      'getTelegramStatus'
    ];

    const params = { ...query, ...body };
    delete params.action;
    delete params.innerAction;
    params.action = innerAction;

    const SUPABASE_FAMILY_ACTIONS = [
      'getChildDataForFamily',
      'getFaceStatus',
      'getTelegramStatus',
      'hasFamilyPassword',
      'getFamilyReports',
      'getScanReport',
      'verifyFamilySession',
      'familyLogin',
      'familyLogout',
      'completeFamilyMigration',
      'setFamilyPassword',
      'changeFamilyPassword',
      'familyForgotPassword',
      'familyResetPassword',
      'deleteFaceFeatures',
      'saveFaceFeatures',
      'saveFaceFeaturesFromFamily',
      'setNotificationMethod',
      'generateLinkToken',
      'unlinkTelegram',
      'requestUnlinkOTP',
      'updateChildData',
      'deleteChildAccount',
      'disableChildAccount',
      'enableChildAccount'
    ];

    if (SUPABASE_FAMILY_ACTIONS.includes(innerAction)) {
      try {
        const { handleSupabaseRead } = await import('../lib/db/family-read.js');
        let result = await handleSupabaseRead(innerAction, params);

        if (result === null || result === undefined) {
          const { handleSupabaseWrite } = await import('../lib/db/family-write.js');
          result = await handleSupabaseWrite(innerAction, params);
        }

        if (result !== null && result !== undefined) {
          return res.status(200).json(result);
        }

        // ✅ Action مدعومة في القائمة لكن مفيش handler → خطأ صريح
        console.warn('[handleFamily] No handler for:', innerAction);
        return res.status(500).json({
          success: false,
          error: 'handler_not_implemented',
          message: 'هذا الإجراء غير مُنفَّذ بعد'
        });

      } catch (supabaseError) {
        // ✅ للـ actions المهمة: منرجّعش لـ GAS، نرجّع خطأ JSON واضح
        console.error('[handleFamily] Supabase error:', {
          action: innerAction,
          message: supabaseError.message,
          stack: supabaseError.stack
        });
        return res.status(500).json({
          success: false,
          error: 'supabase_error',
          message: supabaseError.message || 'خطأ في قاعدة البيانات'
        });
      }
    }

    // لا يوجد Fallback لـ GAS
    return res.status(400).json({ success: false, error: 'unsupported_family_action', message: 'هذا الإجراء غير مدعوم حالياً' });

  } catch (error) {
    return await safeErrorResponse(res, error, 'handleFamily', { innerAction });
  }
}

// ================================================================
//  🏥 Handler: Health Check — أداة تشخيصية (تتجاوز المُبلِّغ)
// ================================================================
async function handleHealth(req, res) {
  try {
    const { supabaseAdmin } = await import('../lib/supabase.js');
    const { TABLES, COLS_CHILDREN } = await import('../lib/db/tables.js');

    const checks = {};

    try {
      const { data, error, count } = await supabaseAdmin
        .from(TABLES.CHILDREN)
        .select(`${COLS_CHILDREN.child_id},${COLS_CHILDREN.child_name}`, { count: 'exact' })
        .limit(3);
      if (error) throw error;
      checks.children = { status: '✅', count: count, sample: data.map(r => r.child_id) };
    } catch (e) {
      checks.children = { status: '❌', error: e.message };
    }

    try {
      const { data, error, count } = await supabaseAdmin
        .from(TABLES.MARKETERS)
        .select('code,name', { count: 'exact' })
        .limit(3);
      if (error) throw error;
      checks.marketers = { status: '✅', count: count, sample: data.map(r => r.code) };
    } catch (e) {
      checks.marketers = { status: '❌', error: e.message };
    }

    try {
      const { data, error, count } = await supabaseAdmin
        .from(TABLES.FACE_FEATURES)
        .select('child_id', { count: 'exact' })
        .limit(3);
      if (error) throw error;
      checks.faceFeatures = { status: '✅', count: count };
    } catch (e) {
      checks.faceFeatures = { status: '❌', error: e.message };
    }

    try {
      const { data, error, count } = await supabaseAdmin
        .from(TABLES.FAMILY_SESSIONS)
        .select('session_token', { count: 'exact' })
        .limit(3);
      if (error) throw error;
      checks.familySessions = { status: '✅', count: count };
    } catch (e) {
      checks.familySessions = { status: '❌', error: e.message };
    }

    try {
      const { data, error, count } = await supabaseAdmin
        .from(TABLES.SCAN_LOGS)
        .select('child_id', { count: 'exact' })
        .limit(3);
      if (error) throw error;
      checks.scanLogs = { status: '✅', count: count };
    } catch (e) {
      checks.scanLogs = { status: '❌', error: e.message };
    }

    const allOk = Object.values(checks).every(c => c.status === '✅');

    return res.status(allOk ? 200 : 500).json({
      success: allOk,
      timestamp: new Date().toISOString(),
      checks,
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      hint: 'تأكد من إضافة Environment Variables على Vercel',
    });
  }
}

// ================================================================
//  🧑‍💼 Handler: Marketer
// ================================================================
async function handleMarketer(req, res) {
  const query = req.query || {};
  const body = req.body || {};

  const innerAction = query.innerAction || body.innerAction || '';
  if (!innerAction) {
    return res.status(400).json({
      success: false,
      error: 'invalid_marketer_action',
      message: 'الإجراء المطلوب غير صالح'
    });
  }

  const params = { ...query, ...body };
  delete params.action;
  delete params.innerAction;
  params.action = innerAction;

  try {
    const SUPABASE_READ_ACTIONS = [
      'getMarketerStats',
      'validateMarketerCode',
      'marketerLogin'
    ];

    if (SUPABASE_READ_ACTIONS.includes(innerAction)) {
      try {
        const { handleSupabaseMarketerRead } = await import('../lib/db/marketer-read.js');
        const result = await handleSupabaseMarketerRead(innerAction, params);

        if (result !== null && result !== undefined) {
          return res.status(200).json(result);
        }
      } catch (supabaseError) {
        // نكمل لـ GAS
      }
    }

    // لا يوجد Fallback لـ GAS
    return res.status(400).json({ success: false, error: 'unsupported_marketer_action', message: 'هذا الإجراء غير مدعوم حالياً' });

  } catch (error) {
    return await safeErrorResponse(res, error, 'handleMarketer', { innerAction });
  }
}

// ================================================================
//  📢 Handler: Notify
// ================================================================
async function handleNotify(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const body = req.body || {};
  const childID = body.childID;
  const eventType = body.eventType;
  const eventData = body.eventData || {};

  if (!childID || !eventType) {
    return res.status(400).json({ success: false, error: 'missing_params' });
  }

  try {
    const { notifyFamily } = await import('../lib/notify.js');
    const result = await notifyFamily({ childID, eventType, eventData });
    return res.status(200).json(result);

  } catch (error) {
    return await safeErrorResponse(res, error, 'handleNotify', { childID, eventType });
  }
}

// ================================================================
//  🧑‍💼 Handler: Notify Marketer
// ================================================================
async function handleNotifyMarketer(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const body = req.body || {};
  const marketerCode = body.marketerCode;
  const eventType = body.eventType;
  const eventData = body.eventData || {};

  if (!marketerCode || !eventType) {
    return res.status(400).json({ success: false, error: 'missing_params' });
  }

  try {
    const { notifyMarketer } = await import('../lib/marketer-notify.js');
    const result = await notifyMarketer({ marketerCode, eventType, eventData });
    return res.status(200).json(result);

  } catch (error) {
    return await safeErrorResponse(res, error, 'handleNotifyMarketer', { marketerCode, eventType });
  }
}

// ================================================================
//  🧑‍💼 Handler: Marketer Write
// ================================================================
async function handleMarketerWrite(req, res) {
  const query = req.query || {};
  const body = req.body || {};

  const action = query.action || body.action || '';
  const params = { ...query, ...body };
  delete params.action;

  try {
    const SUPABASE_WRITE_ACTIONS = ['registerMarketer', 'forgotPassword', 'resetPassword', 'marketerDeleteAccount'];

    if (SUPABASE_WRITE_ACTIONS.includes(action)) {
      try {
        const { handleSupabaseMarketerWrite } = await import('../lib/db/marketer-write.js');
        const result = await handleSupabaseMarketerWrite(action, params);

        if (result !== null && result !== undefined) {
          return res.status(200).json(result);
        }
      } catch (supabaseError) {
        // نكمل لـ GAS
      }
    }

    // لا يوجد Fallback لـ GAS
    return res.status(400).json({ success: false, error: 'unsupported_marketer_write_action', message: 'هذا الإجراء غير مدعوم حالياً' });

  } catch (error) {
    return await safeErrorResponse(res, error, 'handleMarketerWrite', { action });
  }
}

// ================================================================
//  👶 Handler: Register
// ================================================================
async function handleRegister(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const body = req.body || {};

  try {
    const { handleRegistration } = await import('../lib/db/registration.js');
    const result = await handleRegistration(body);
    return res.status(200).json(result);

  } catch (error) {
    return await safeErrorResponse(res, error, 'handleRegister', {
      plan: body.plan,
      emailCode: body.emailCode
    });
  }
}

// ================================================================
//  ⚙️ Handler: Config
// ================================================================
async function handleConfig(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  try {
    const { getAppConfig } = await import('../lib/db/app-config.js');
    const result = await getAppConfig(['remaining_offers', 'wallet_number']);

    if (!result.success) {
      return await safeErrorResponse(res, new Error('app_config_read_failed'), 'handleConfig', {});
    }

    const remainingOffers = parseInt(result.config.remaining_offers || '0', 10);
    const walletNumber = result.config.wallet_number || '';

    return res.status(200).json({
      success: true,
      remainingOffers: isNaN(remainingOffers) ? 0 : remainingOffers,
      walletNumber
    });

  } catch (error) {
    return await safeErrorResponse(res, error, 'handleConfig', {});
  }
}

// ================================================================
//  ⏰ Handler: Marketer Reminder
// ================================================================
async function handleMarketerReminder(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const secret = req.headers['x-cron-secret'] || '';
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return res.status(500).json({ success: false, error: 'server_misconfigured' });
  }

  if (secret !== expected) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  try {
    const DAILY_CAP = 30;

    const { getMarketersNeedingReminder } = await import('../lib/db/marketer-read.js');
    const { markTelegramReminderSent } = await import('../lib/db/marketer-write.js');
    const { sendTelegramReminderEmail } = await import('../lib/email/brevo.js');

    const listResult = await getMarketersNeedingReminder(DAILY_CAP);
    if (!listResult.success) {
      return await safeErrorResponse(res, new Error('list_marketers_failed'), 'handleMarketerReminder:list', {});
    }

    const marketers = listResult.marketers;

    if (marketers.length === 0) {
      return res.status(200).json({
        success: true,
        processed: 0,
        sent: 0,
        failed: 0,
        dailyCap: DAILY_CAP,
        message: 'لا يوجد مسوقون مؤهلون للتذكير حالياً'
      });
    }

    let sent = 0;
    let failed = 0;

    for (const m of marketers) {
      try {
        const emailResult = await sendTelegramReminderEmail(
          m.email,
          m.name,
          m.code,
          m.reminderCount + 1
        );

        if (emailResult && emailResult.success) {
          await markTelegramReminderSent(m.code);
          sent++;
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
      }

      await new Promise(function(r) { setTimeout(r, 200); });
    }

    return res.status(200).json({
      success: true,
      processed: marketers.length,
      sent: sent,
      failed: failed,
      dailyCap: DAILY_CAP
    });

  } catch (error) {
    return await safeErrorResponse(res, error, 'handleMarketerReminder', {});
  }
}

// ================================================================
//  🚀 Handler: Demo Register
// ================================================================
async function handleDemoRegister(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const body = req.body || {};

  try {
    const { registerDemoSession } = await import('../lib/db/demo.js');
    const result = await registerDemoSession(body);
    return res.status(200).json(result);

  } catch (error) {
    return await safeErrorResponse(res, error, 'handleDemoRegister', { email: body.email });
  }
}

// ================================================================
//  📬 Handler: Email Queue
// ================================================================
async function handleEmailQueue(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const secret = req.headers['x-cron-secret'] || '';
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return res.status(500).json({ success: false, error: 'server_misconfigured' });
  }
  if (secret !== expected) {
    console.warn('🚫 [EmailQueue] Secret غير صحيح');
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  try {
    const { processEmailQueue, processBulkEmailQueue } = await import('../lib/db/email-queue.js');

    // ✅ معالجة الاثنين معًا
    const registrationResult = await processEmailQueue();
    const bulkResult = await processBulkEmailQueue();

    return res.status(200).json({
      success: true,
      registration: registrationResult,
      bulk: bulkResult
    });
  } catch (error) {
    return await safeErrorResponse(res, error, 'handleEmailQueue', {});
  }
}

// ================================================================
//  📊 Handler: Family Weekly Report
// ================================================================
async function handleFamilyWeeklyReport(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const secret = req.headers['x-cron-secret'] || '';
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  try {
    const { sendWeeklyFamilyReports } = await import('../lib/db/weekly-reports.js');
    const result = await sendWeeklyFamilyReports();
    return res.status(200).json(result);
  } catch (error) {
    return await safeErrorResponse(res, error, 'handleFamilyWeeklyReport', {});
  }
}

// ================================================================
//  📊 Handler: Marketer Weekly Report
// ================================================================
async function handleMarketerWeeklyReport(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const secret = req.headers['x-cron-secret'] || '';
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  try {
    const { supabaseAdmin } = await import('../lib/supabase.js');
    const { TABLES, COLS_MARKETERS } = await import('../lib/db/tables.js');
    const { notifyMarketer, calculateMarketerTotals } = await import('../lib/marketer-notify.js');

    const { data: marketers, error } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .select('code,name,email,telegram_chat_id,notification_method')
      .eq(COLS_MARKETERS.is_active, 'نشط');

    if (error) {
      return await safeErrorResponse(res, new Error('marketers_read_failed'), 'handleMarketerWeeklyReport:read', {});
    }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fmt = (d) => d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', timeZone: 'Africa/Cairo' });
    const periodText = `من ${fmt(weekAgo)} إلى ${fmt(now)}`;

    let sentCount = 0;
    let skippedCount = 0;

    for (const m of (marketers || [])) {
      const code = String(m.code || '').trim().toUpperCase();
      const email = String(m.email || '').trim();
      const chatId = String(m.telegram_chat_id || '').trim();

      if (!email && !chatId) {
        skippedCount++;
        continue;
      }

      const totals = await calculateMarketerTotals(code);
      if (totals.childrenCount === 0) {
        skippedCount++;
        continue;
      }

      let newClientsThisWeek = 0;
      let commissionsThisWeek = 0;

      for (const child of totals.children) {
        if (new Date(child.regDate) >= weekAgo) {
          newClientsThisWeek++;
          commissionsThisWeek += child.commission;
        }
      }
      commissionsThisWeek = Math.round(commissionsThisWeek);

      const needsTelegramLink = String(m.notification_method || '').toLowerCase() === 'telegram' && !chatId;

      try {
        const notifyResult = await notifyMarketer({
          marketerCode: code,
          eventType: 'weekly_report',
          eventData: {
            newClientsThisWeek,
            commissionsThisWeek,
            totalEarned: totals.earned,
            totalPending: totals.pending,
            totalChildren: totals.childrenCount,
            totalCommissionAllTime: totals.total,
            periodText,
            needsTelegramLink
          }
        });

        if (notifyResult.success) sentCount++;
        else skippedCount++;

        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        skippedCount++;
      }
    }

    return res.status(200).json({ success: true, sent: sentCount, skipped: skippedCount });

  } catch (error) {
    return await safeErrorResponse(res, error, 'handleMarketerWeeklyReport', {});
  }
}

// ================================================================
//  🧹 Handler: Cleanup
// ================================================================
async function handleCleanup(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const secret = req.headers['x-cron-secret'] || '';
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return res.status(500).json({ success: false, error: 'server_misconfigured' });
  }
  if (secret !== expected) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  try {
    const task = (req.body && req.body.task) || 'all';
    const cleanup = await import('../lib/db/cleanup.js');

    let result;
    switch (task) {
      case 'tokens':
        result = await cleanup.cleanupExpiredTokens();
        break;
      case 'sessions':
        result = await cleanup.cleanupExpiredSessions();
        break;
      case 'loginAttempts':
        result = await cleanup.cleanupLoginAttempts();
        break;
      case 'markUsed':
        result = await cleanup.markExpiredTokensAsUsed();
        break;
      case 'all':
      default:
        result = await cleanup.runAllCleanups();
        break;
    }

    return res.status(200).json(result);

  } catch (error) {
    return await safeErrorResponse(res, error, 'handleCleanup', { task: req.body && req.body.task });
  }
}

// ================================================================
//  📧 Handler: Unsubscribe
// ================================================================
async function handleUnsubscribe(req, res) {
  try {
    const token = (req.query && req.query.token) || (req.body && req.body.token) || '';
    const { unsubscribeSubscriber } = await import('../lib/db/newsletter.js');
    const result = await unsubscribeSubscriber({ token });
    return res.status(200).json(result);
  } catch (error) {
    return await safeErrorResponse(res, error, 'handleUnsubscribe', {});
  }
}

// ================================================================
//  📧 Handler: Subscribe Newsletter
// ================================================================
async function handleSubscribeNewsletter(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'method_not_allowed' });
  try {
    const { subscribeNewsletter } = await import('../lib/db/newsletter.js');
    const result = await subscribeNewsletter(req.body || {});
    return res.status(200).json(result);
  } catch (error) {
    return await safeErrorResponse(res, error, 'handleSubscribeNewsletter', {});
  }
}

// ================================================================
//  🙏 Handler: Volunteer Found
// ================================================================
async function handleVolunteerFound(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'method_not_allowed' });
  try {
    const { volunteerFound } = await import('../lib/db/missing-reports.js');
    const result = await volunteerFound(req.body || {});
    return res.status(200).json(result);
  } catch (error) {
    return await safeErrorResponse(res, error, 'handleVolunteerFound', {});
  }
}

// ================================================================
//  ✅ Handler: Confirm Received
// ================================================================
async function handleConfirmReceived(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'method_not_allowed' });
  try {
    const { confirmReceived } = await import('../lib/db/missing-reports.js');
    const result = await confirmReceived(req.body || {});
    return res.status(200).json(result);
  } catch (error) {
    return await safeErrorResponse(res, error, 'handleConfirmReceived', {});
  }
}

// ================================================================
//  📋 Handler: Get Report Details
// ================================================================
async function handleGetReportDetails(req, res) {
  try {
    const reportId = (req.query && req.query.reportId) || '';
    const { getReportDetails } = await import('../lib/db/missing-reports.js');
    const result = await getReportDetails({ reportId });
    return res.status(200).json(result);
  } catch (error) {
    return await safeErrorResponse(res, error, 'handleGetReportDetails', {});
  }
}

// ================================================================
//  🚨 Handler: Report Missing
// ================================================================
async function handleReportMissing(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'method_not_allowed' });
  try {
    const { reportMissing } = await import('../lib/db/missing-reports.js');
    const result = await reportMissing(req.body || {});
    return res.status(200).json(result);
  } catch (error) {
    return await safeErrorResponse(res, error, 'handleReportMissing', {});
  }
}

// ================================================================
//  🚨 Handler: Report Error — استقبال أخطاء الواجهة الأمامية
//  POST /api?action=reportError
// ================================================================
async function handleReportError(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  try {
    let body = req.body;

    // معالجة احتياطية: لو Vercel رجّع الـ body كـ string
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    if (!body || typeof body !== 'object') body = {};

    // تسجيل تشخيصي (يظهر في Vercel Logs فقط)
    console.log('[reportError] received:', JSON.stringify({
      source: body.source,
      messageLength: (body.message || '').length
    }));

    const { reportClientError } = await import('../lib/error-logger.js');

    // ✅ الانتظار حتى يتم الإرسال فعليًا قبل الرد
    await reportClientError({
      source: String(body.source || 'unknown').substring(0, 60),
      message: String(body.message || '').substring(0, 500),
      stack: String(body.stack || '').substring(0, 1500),
      url: String(body.url || '').substring(0, 300),
      userAgent: String(body.userAgent || '').substring(0, 200),
      context: body.context || {}
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.log('[reportError] exception:', e.message);
    return res.status(200).json({ ok: true });
  }
}

// ================================================================
//  🧪 Handler: Test Telegram — أداة تشخيصية (للأدمن فقط)
//  GET /api?action=testTelegram&secret=<CRON_SECRET>
//  - تتحقق من ADMIN_TELEGRAM_CHAT_ID
//  - ترسل رسالة تجريبية
//  - ترجع نتيجة الإرسال بالكامل
// ================================================================
async function handleTestTelegram(req, res) {
  // حماية بـ CRON_SECRET
  const secret = (req.query && req.query.secret) || '';
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  const result = {
    success: true,
    checks: {}
  };

  // 1. فحص ADMIN_TELEGRAM_CHAT_ID
  const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID || '';
  if (!chatId) {
    result.checks.adminChatId = {
      status: '❌',
      message: 'المتغير غير مضبوط على Vercel'
    };
  } else {
    const masked = chatId.length > 6
      ? chatId.substring(0, 3) + '***' + chatId.substring(chatId.length - 3)
      : '***';
    result.checks.adminChatId = {
      status: '✅',
      length: chatId.length,
      masked: masked,
      isNumeric: /^-?\d+$/.test(chatId)
    };
  }

  // 2. فحص BOT_TOKEN
  const botToken = process.env.BOT_TOKEN || '';
  if (!botToken) {
    result.checks.botToken = { status: '❌', message: 'غير مضبوط' };
  } else {
    result.checks.botToken = {
      status: '✅',
      length: botToken.length,
      hasColon: botToken.indexOf(':') !== -1
    };
  }

  // 3. محاولة إرسال رسالة تجريبية
  if (chatId && botToken) {
    try {
      const { sendViaTelegram } = await import('../lib/telegram.js');
      const sendResult = await sendViaTelegram(
        chatId,
        '🧪 <b>رسالة اختبار</b>\n\n' +
        'هذه رسالة تشخيصية من لوحة تحكم KidCode-EG.\n' +
        'إذا وصلت، فهذا يعني أن الإعدادات سليمة.\n\n' +
        '🕐 ' + nowEgypt12()
      );
      result.checks.sendTest = sendResult;
    } catch (err) {
      result.checks.sendTest = {
        status: '❌',
        error: err.message
      };
    }
  } else {
    result.checks.sendTest = {
      status: '⏭️',
      message: 'تم تخطي الإرسال — بيانات ناقصة'
    };
  }

  result.success =
    result.checks.adminChatId.status === '✅' &&
    result.checks.botToken.status === '✅' &&
    (result.checks.sendTest.success === true || result.checks.sendTest.status === '⏭️');

  return res.status(200).json(result);
}

// ================================================================
//  🛡️ Handler: Admin — لوحة تحكم الأدمن
//  POST/GET /api?action=admin&innerAction=...
// ================================================================
async function handleAdminRoute(req, res) {
  try {
    const { handleAdmin } = await import('../lib/admin/router.js');
    return await handleAdmin(req, res);
  } catch (error) {
    return await safeErrorResponse(res, error, 'handleAdminRoute', {
      innerAction: (req.query && req.query.innerAction) || (req.body && req.body.innerAction)
    });
  }
}

// ================================================================
//  ⏰ Handler: Escalate Missing Report
// ================================================================
async function handleEscalateMissingReport(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'method_not_allowed' });

  const secret = req.headers['x-cron-secret'] || '';
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  try {
    const { escalateMissingReport } = await import('../lib/db/missing-reports.js');
    const result = await escalateMissingReport();
    return res.status(200).json(result);
  } catch (error) {
    return await safeErrorResponse(res, error, 'handleEscalateMissingReport', {});
  }
}

// ================================================================
//  💰 Handler: Check Marketer Commissions (Cron Daily 9AM)
//  - يُستدعى من GAS Trigger يومي
//  - يدور على العمولات المؤهلة (≥ 14 يوم + commission_notified != 'نعم')
//  - يبعت إشعار لكل مسوق
//  - يعلّمها كـ 'commission_notified = نعم'
// ================================================================
async function handleCheckMarketerCommissions(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  // حماية بـ CRON_SECRET
  const secret = req.headers['x-cron-secret'] || '';
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return res.status(500).json({ success: false, error: 'server_misconfigured' });
  }
  if (secret !== expected) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  try {
    const { supabaseAdmin } = await import('../lib/supabase.js');
    const { TABLES, COLS_CHILDREN } = await import('../lib/db/tables.js');
    const { notifyMarketer, calculateMarketerTotals } = await import('../lib/marketer-notify.js');

    const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // 1. جيب كل الأطفال اللي عندهم marketer_id + commission_notified != 'نعم'
    const { data: children, error } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select('*')
      .not(COLS_CHILDREN.marketer_id, 'is', null)
      .neq(COLS_CHILDREN.commission_notified, 'نعم');

    if (error) {
      console.error('[checkMarketerCommissions] fetch error:', error.message);
      return await safeErrorResponse(
        res,
        new Error('commissions_fetch_failed'),
        'handleCheckMarketerCommissions:fetch',
        {}
      );
    }

    // 2. تجميع المؤهلين حسب المسوق
    //    { marketerCode: [ { childID, childName, commission } ] }
    const eligibleByMarketer = {};

    for (const child of (children || [])) {
      // 2.1 المسوق موجود؟
      const marketerId = String(child[COLS_CHILDREN.marketer_id] || '').trim().toUpperCase();
      if (!marketerId) continue;

      // 2.2 الحالة مش deleted؟
      const status = String(child[COLS_CHILDREN.status] || '').trim().toLowerCase();
      if (status === 'deleted') continue;

      // 2.3 العمولة > 0؟
      const originalPrice = parseFloat(child[COLS_CHILDREN.original_price]) || 0;
      const finalPrice = parseFloat(child[COLS_CHILDREN.plan_price]) || 0;
      const commission = Math.max(0, originalPrice - finalPrice);
      if (commission === 0) continue;

      // 2.4 مر 14 يوم من التسجيل؟
      const regRaw = child[COLS_CHILDREN.registration_date] || child[COLS_CHILDREN.timestamp];
      if (!regRaw) continue;

      const regMs = new Date(regRaw).getTime();
      if (isNaN(regMs)) continue;
      if ((now - regMs) < FOURTEEN_DAYS_MS) continue;

      // ✅ مؤهل
      if (!eligibleByMarketer[marketerId]) eligibleByMarketer[marketerId] = [];
      eligibleByMarketer[marketerId].push({
        childID: String(child[COLS_CHILDREN.child_id] || '').trim(),
        childName: String(child[COLS_CHILDREN.child_name] || '').trim(),
        commission: commission
      });
    }

    const marketerCodes = Object.keys(eligibleByMarketer);
    if (marketerCodes.length === 0) {
      console.log('ℹ️ [checkMarketerCommissions] لا توجد عمولات مؤهلة جديدة');
      return res.status(200).json({
        success: true,
        processed: 0,
        sent: 0,
        failed: 0,
        message: 'لا توجد عمولات مستحقة حالياً'
      });
    }

    console.log(`📊 [checkMarketerCommissions] ${marketerCodes.length} مسوق لديهم عمولات مؤهلة`);

    // 3. لكل مسوق: احسب الإجماليات + ابعت الإشعارات + علّم
    let sent = 0;
    let failed = 0;

    for (const marketerCode of marketerCodes) {
      const eligibleChildren = eligibleByMarketer[marketerCode];

      // احسب الإجماليات مرة واحدة لكل مسوق (للعرض في الإشعار)
      const totals = await calculateMarketerTotals(marketerCode);

      for (const child of eligibleChildren) {
        try {
          const notifyResult = await notifyMarketer({
            marketerCode: marketerCode,
            eventType: 'commission_earned',
            eventData: {
              childName: child.childName,
              childID: child.childID,
              commission: child.commission,
              totalEarned: totals.earned,
              totalPending: totals.pending
            }
          });

          if (notifyResult.success) {
            // علّم كـ "تم الإشعار"
            await supabaseAdmin
              .from(TABLES.CHILDREN)
              .update({ [COLS_CHILDREN.commission_notified]: 'نعم' })
              .eq(COLS_CHILDREN.child_id, child.childID);

            sent++;
            console.log(`✅ [checkMarketerCommissions] ${marketerCode} | ${child.childID} | ${notifyResult.channel}`);
          } else {
            failed++;
            console.log(`⚠️ [checkMarketerCommissions] فشل ${marketerCode} | ${child.childID} — سيُعاد غداً`);
          }

          // تأخير بسيط بين الإشعارات (Telegram rate limits)
          await new Promise(r => setTimeout(r, 500));

        } catch (childErr) {
          failed++;
          console.error(`❌ [checkMarketerCommissions] ${marketerCode} | ${child.childID}: ${childErr.message}`);
        }
      }
    }

    console.log(`✅ [checkMarketerCommissions] اكتمل. نجح: ${sent} | فشل: ${failed}`);

    return res.status(200).json({
      success: true,
      processed: marketerCodes.length,
      totalChildren: sent + failed,
      sent: sent,
      failed: failed
    });

  } catch (error) {
    return await safeErrorResponse(res, error, 'handleCheckMarketerCommissions', {});
  }
}

// ============================================================
//  🔍 Handler: Check Revoked — فحص لو الكود ملغى (public)
// ============================================================
async function handleCheckRevoked(req, res) {
  try {
    const id = (req.query && req.query.id) || (req.body && req.body.id);
    if (!id) return res.status(200).json({ revoked: false });

    const { checkRevoked } = await import('../lib/admin/revoke-id.js');
    const result = await checkRevoked(id);
    return res.status(200).json(result);

  } catch (error) {
    // Fail-safe: نرجّع {revoked: false} عشان الفلو يكمل عادي
    return res.status(200).json({ revoked: false });
  }
}

// ============================================================
//  💳 Handler: Create Paymob Intention
// ============================================================
async function handleCreatePaymobIntention(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const body = req.body || {};
  const childID = String(body.childID || '').trim().toUpperCase();
  const plan = String(body.plan || '').trim();

  if (!childID || !plan) {
    return res.status(400).json({ success: false, error: 'missing_params', message: 'بيانات ناقصة' });
  }

  try {
    const { supabaseAdmin } = await import('../lib/supabase.js');
    const { TABLES, COLS_CHILDREN } = await import('../lib/db/tables.js');
    const { PLAN_PRICES, createPayment, getPendingPayment, countPaidPayments } = await import('../lib/db/payments.js');
    const { createPaymobIntention } = await import('../lib/paymob.js');

    const basePrice = PLAN_PRICES[plan];
    if (!basePrice) {
      return res.status(400).json({ success: false, error: 'invalid_plan', message: 'الباقة غير صالحة' });
    }

    // Anti double-click
    const pending = await getPendingPayment(childID, 2);
    if (pending) {
      // ✅ Math.max(0, ...) + cap في [1, 2]
      const createdUTC = new Date(pending.created_at).getTime();
      const ageSeconds = Math.max(0, Math.floor((Date.now() - createdUTC) / 1000));
      const MAX_WAIT_SECONDS = 120;  // 2 دقائق
      const remainingSeconds = Math.max(0, MAX_WAIT_SECONDS - ageSeconds);
      const retryAfterMinutes = Math.max(1, Math.min(2, Math.ceil(remainingSeconds / 60)));

      // ⚠️ حساب نص وقت الانتظار (قبل الـ return — هذا هو مكانه الصحيح)
      const retryText = retryAfterMinutes === 1 ? 'دقيقة واحدة'
                      : retryAfterMinutes === 2 ? 'دقيقتين'
                      : retryAfterMinutes + ' دقائق';

      return res.status(429).json({
        success: false,
        error: 'payment_in_progress',
        message: 'لديك عملية دفع قيد المعالجة. يرجى المحاولة بعد ' + retryText + '.',
        pendingPaymentId: pending.id,
        pendingCreatedAt: pending.created_at,
        pendingAgeSeconds: ageSeconds,
        retryAfterMinutes: retryAfterMinutes
      });
    }

    // Get child
    const { data: child } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select('*')
      .eq(COLS_CHILDREN.child_id, childID)
      .maybeSingle();

    if (!child) {
      return res.status(404).json({ success: false, error: 'child_not_found', message: 'الطفل غير موجود' });
    }

    const status = String(child[COLS_CHILDREN.status] || '').toLowerCase();
    if (status === 'deleted') {
      return res.status(400).json({ success: false, error: 'child_deleted', message: 'لا يمكن الدفع لطفل محذوف' });
    }

    // Marketer discount
    let finalPrice = basePrice;
    let discountPercent = 0;
    const marketerID = String(child[COLS_CHILDREN.marketer_id] || '').trim();
    if (marketerID) {
      const { data: marketer } = await supabaseAdmin
        .from(TABLES.MARKETERS)
        .select('discount_percent,is_active')
        .eq('code', marketerID)
        .maybeSingle();

      if (marketer && String(marketer.is_active || '').trim() === 'نشط') {
        discountPercent = parseFloat(marketer.discount_percent) || 0;
        finalPrice = Math.round(basePrice * (1 - discountPercent / 100));
      }
    }

    // Type: initial / renewal
    const paidCount = await countPaidPayments(childID);
    const type = paidCount > 0 ? 'renewal' : 'initial';

    // Create intention
    const intention = await createPaymobIntention({
      amountEGP: finalPrice,
      planName: plan,
      childId: childID
    });

    if (!intention.success) {
      console.error('[handleCreatePaymobIntention] Paymob failed:', {
        error: intention.error,
        detail: intention.detail,
        status: intention.status,
        raw: intention.raw
      });

      return res.status(500).json({
        success: false,
        error: intention.error || 'intention_failed',
        message: 'تعذر إنشاء عملية الدفع. يرجى المحاولة مرة أخرى.',
        detail: intention.detail || null,
        paymobStatus: intention.status || null,
        paymobRaw: intention.raw || null
      });
    }

    // ✅ 1. عدّ محاولات الدفع السابقة للطفل
    const { count: totalAttempts } = await supabaseAdmin
      .from(TABLES.PAYMENTS)
      .select('id', { count: 'exact', head: true })
      .eq('child_id', childID);

    const attemptNumber = (totalAttempts || 0) + 1;

    // ✅ 2. تحديد طريقة الدفع المبدئية
    // - لو فيه طريقة واحدة مفعّلة → نعرفها
    // - لو أكتر من طريقة → 'unknown' (الـ Webhook هيحددها بعد الدفع)
    const cardIdCheck = parseInt(process.env.PAYMOB_INTEGRATION_ID, 10);
    const walletIdCheck = parseInt(process.env.PAYMOB_WALLET_INTEGRATION_ID, 10);
    const applePayIdCheck = parseInt(process.env.PAYMOB_APPLEPAY_INTEGRATION_ID, 10);

    const enabledMethods = [];
    if (!isNaN(cardIdCheck)) enabledMethods.push('card');
    if (!isNaN(walletIdCheck)) enabledMethods.push('wallet');
    if (!isNaN(applePayIdCheck)) enabledMethods.push('apple_pay');

    const initialPaymentMethod = enabledMethods.length === 1 ? enabledMethods[0] : 'unknown';

    // Store pending
    const paymentResult = await createPayment({
      childID,
      amountCents: Math.round(finalPrice * 100),
      plan,
      type,
      intentionId: intention.intentionId,
      integrationId: intention.integrationId,
      paymobOrderId: intention.orderId || null,
      attemptNumber: attemptNumber,          // ✅ NEW
      paymentMethod: initialPaymentMethod    // ✅ NEW
    });

    if (!paymentResult.success) {
      return res.status(500).json({ success: false, error: 'db_error', message: 'فشل حفظ بيانات الدفع' });
    }

    return res.status(200).json({
      success: true,
      checkoutUrl: intention.checkoutUrl,
      intentionId: intention.intentionId,
      paymentId: paymentResult.id,
      amount: finalPrice,
      basePrice,
      discountPercent,
      plan,
      type,
      attemptNumber: attemptNumber,          // ✅ NEW
      paymentMethod: initialPaymentMethod    // ✅ NEW
    });

  } catch (error) {
    return await safeErrorResponse(res, error, 'handleCreatePaymobIntention', { childID, plan });
  }
}

// ============================================================
//  🔔 Handler: Paymob Webhook
// ============================================================
async function handlePaymobWebhook(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false });
  }

  try {
    const hmac = (req.query && req.query.hmac) || (req.body && req.body.hmac) || '';
    const body = req.body || {};
    const obj = body.obj;

    if (!obj) {
      console.warn('[paymobWebhook] missing obj');
      return res.status(200).json({ ok: true });
    }

    const { verifyPaymobHmac } = await import('../lib/paymob.js');
    const isValid = verifyPaymobHmac(obj, hmac);

    if (!isValid) {
      console.error('[paymobWebhook] INVALID HMAC — تم رفض الطلب');
      return res.status(401).json({ ok: false, error: 'invalid_hmac' });
    }

    const paymobOrderId = obj.order && obj.order.id;
    const specialRef = obj.order && obj.order.merchant_order_id;
    const success = obj.success === true;
    const transactionId = obj.id;

    if (!paymobOrderId) {
      console.warn('[paymobWebhook] missing order id');
      return res.status(200).json({ ok: true });
    }

    // ✅ FIX: نحاول نجيب الـ payment عن طريق order_id أولاً (الأكثر موثوقية)
    const { getPaymentByOrderId } = await import('../lib/db/payments.js');
    let payment = await getPaymentByOrderId(paymobOrderId);

    let childId = payment ? payment.child_id : null;

    // Fallback: نستخرج child_id من special_reference (نشيل _timestamp)
    if (!childId && specialRef) {
      childId = String(specialRef).replace(/_[a-z0-9]+$/i, '');
    }

    if (!childId) {
      console.warn('[paymobWebhook] cannot determine child_id', { paymobOrderId, specialRef });
      return res.status(200).json({ ok: true });
    }

    console.log(`🔔 [paymobWebhook] order=${paymobOrderId} | child=${childId} | success=${success} | ref=${specialRef}`);

    const { processPaymentWebhook, activateChildSubscription } = await import('../lib/db/payments.js');

    const result = await processPaymentWebhook({
      childId,
      paymobOrderId,
      success,
      metadata: {
        transactionId,
        amount_cents: obj.amount_cents,
        integrationId: obj.integration_id
      }
    });

    if (!result.success) {
      console.error('[paymobWebhook] process failed:', result.error);
      return res.status(200).json({ ok: true });
    }

    if (result.alreadyPaid) {
      return res.status(200).json({ ok: true, already_paid: true });
    }

    // Activate on success
    if (success && result.payment) {
      const activation = await activateChildSubscription({
        childId,
        plan: result.payment.plan,
        paymentType: result.payment.type
      });

      if (activation.success) {
        console.log(`✅ [paymobWebhook] تم تفعيل ${childId} حتى ${activation.newExpiry}`);

        // 🆕 إرسال بريد "دفعة ناجحة" + QR
        try {
          const { supabaseAdmin } = await import('../lib/supabase.js');
          const { TABLES, COLS_CHILDREN } = await import('../lib/db/tables.js');
          const { sendClientEmail } = await import('../lib/email/brevo.js');

          const { data: child } = await supabaseAdmin
            .from(TABLES.CHILDREN)
            .select('*')
            .eq(COLS_CHILDREN.child_id, childId)
            .maybeSingle();

          if (child) {
            const email = String(child[COLS_CHILDREN.email_code] || '').trim();
            if (email) {
              const qrUrl = String(child[COLS_CHILDREN.qr_code_pics] || '').trim();
              const childLink = String(child[COLS_CHILDREN.child_link] || '').trim();

              const emailResult = await sendClientEmail(
                email,
                childId,
                childLink,
                qrUrl,
                'active',
                'confirmed'
              );

              console.log(`📧 [paymobWebhook] payment success email: ${emailResult.success}`);

              if (emailResult.success) {
                await supabaseAdmin
                  .from(TABLES.CHILDREN)
                  .update({ [COLS_CHILDREN.email_sent]: 'تم' })
                  .eq(COLS_CHILDREN.child_id, childId);
              }
            }
          }
        } catch (emailErr) {
          console.error('[paymobWebhook] email error:', emailErr.message);
        }

        // إشعار تليجرام للأسرة (best-effort)
        try {
          const { notifyFamily } = await import('../lib/notify.js');
          await notifyFamily({
            childID: childId,
            eventType: 'child_update',
            eventData: { changedFields: ['تم تجديد الاشتراك بنجاح'] }
          });
        } catch (e) {}
      } else {
        console.error('[paymobWebhook] activate failed:', activation.error);
      }
    }

    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('[paymobWebhook] exception:', error.message);
    return res.status(200).json({ ok: true });
  }
}

// ============================================================
//  📊 Handler: Get Payment Status (public, للـ payment-success)
// ============================================================
async function handleGetPaymentStatus(req, res) {
  try {
    const orderIdRaw = (req.query && req.query.orderId) || (req.body && req.body.orderId);
    const orderId = parseInt(orderIdRaw, 10);

    if (!orderId || isNaN(orderId)) {
      return res.status(400).json({ success: false, error: 'missing_order_id' });
    }

    const { getPaymentByOrderId } = await import('../lib/db/payments.js');
    const payment = await getPaymentByOrderId(orderId);

    if (!payment) {
      return res.status(200).json({ success: true, status: 'unknown' });
    }

    return res.status(200).json({
      success: true,
      status: payment.status,
      paidAt: payment.paid_at,
      plan: payment.plan,
      type: payment.type
    });
  } catch (error) {
    return res.status(200).json({ success: true, status: 'unknown' });
  }
}

// ============================================================
//  🔍 Handler: Paymob Diagnostics (تشخيص الإعدادات)
//  يرجع معلومات عن المتغيرات بدون كشف القيم الحقيقية
// ============================================================
async function handlePaymobDiagnostics(req, res) {
  try {
    const secretKeyRaw = process.env.PAYMOB_SECRET_KEY;
    const publicKeyRaw = process.env.PAYMOB_PUBLIC_KEY;
    const integrationIdRaw = process.env.PAYMOB_INTEGRATION_ID;
    const hmacSecretRaw = process.env.PAYMOB_HMAC_SECRET;

    const secretKey = String(secretKeyRaw || '').trim();
    const publicKey = String(publicKeyRaw || '').trim();
    const integrationIdStr = String(integrationIdRaw || '').trim();
    const integrationId = parseInt(integrationIdStr, 10);
    const hmacSecret = String(hmacSecretRaw || '').trim();

    const diag = {
      secretKey: {
        exists: !!secretKeyRaw,
        length: secretKey.length,
        prefix: secretKey.substring(0, 12),
        suffix: secretKey.length > 12 ? '...' + secretKey.substring(secretKey.length - 4) : '',
        startsWith_sk_test: secretKey.startsWith('sk_test_'),
        startsWith_egy_sk: secretKey.startsWith('egy_sk_'),
        looksLikeApiKey: secretKey.startsWith('ZXlK'),
        looksLikePublicKey: secretKey.startsWith('pk_') || secretKey.startsWith('egy_pk_'),
        hasWhitespace: secretKeyRaw !== secretKey
      },
      publicKey: {
        exists: !!publicKeyRaw,
        length: publicKey.length,
        prefix: publicKey.substring(0, 12),
        startsWith_pk_test: publicKey.startsWith('pk_test_'),
        startsWith_egy_pk: publicKey.startsWith('egy_pk_')
      },
      integrationId: {
        exists: !!integrationIdRaw,
        raw: integrationIdStr,
        parsed: integrationId,
        isNumber: !isNaN(integrationId) && integrationId > 0
      },
      hmacSecret: {
        exists: !!hmacSecretRaw,
        length: hmacSecret.length
      }
    };

    // فحص المشاكل
    const issues = [];
    const recommendations = [];

    // 1. Secret Key
    if (!diag.secretKey.exists) {
      issues.push('PAYMOB_SECRET_KEY غير موجود أصلاً على Vercel');
      recommendations.push('Vercel → Settings → Environment Variables → أضف PAYMOB_SECRET_KEY');
    } else if (diag.secretKey.looksLikeApiKey) {
      issues.push('PAYMOB_SECRET_KEY يحتوي على API Key (يبدأ بـ ZXlK)');
      recommendations.push('استخدم Secret Key اللي يبدأ بـ sk_test_ أو egy_sk_test_ مش API Key');
    } else if (diag.secretKey.looksLikePublicKey) {
      issues.push('PAYMOB_SECRET_KEY يحتوي على Public Key (يبدأ بـ pk_)');
      recommendations.push('استخدم Secret Key مش Public Key');
    } else if (!diag.secretKey.startsWith_sk_test && !diag.secretKey.startsWith_egy_sk) {
      issues.push('PAYMOB_SECRET_KEY لا يبدأ بـ sk_test_ أو egy_sk_test_');
      recommendations.push('راجع Paymob Dashboard → Settings → Account Info → Secret Key (Test)');
    } else if (diag.secretKey.hasWhitespace) {
      issues.push('PAYMOB_SECRET_KEY يحتوي على مسافات أو أسطر جديدة في بدايته أو نهايته');
      recommendations.push('افتح Vercel → احذف القيمة والصقها من جديد بدون أي مسافات');
    } else if (diag.secretKey.length < 30) {
      issues.push('PAYMOB_SECRET_KEY قصير جداً (المتوقع 40+ حرف)');
      recommendations.push('تأكد إنك نسخت القيمة كاملة');
    }

    // 2. Public Key
    if (!diag.publicKey.exists) {
      issues.push('PAYMOB_PUBLIC_KEY غير موجود');
      recommendations.push('أضف PAYMOB_PUBLIC_KEY (pk_test_...)');
    } else if (!diag.publicKey.startsWith_pk_test && !diag.publicKey.startsWith_egy_pk) {
      issues.push('PAYMOB_PUBLIC_KEY لا يبدأ بـ pk_test_ أو egy_pk_');
      recommendations.push('راجع Public Key في Paymob Dashboard');
    }

    // 3. Integration ID
    if (!diag.integrationId.exists) {
      issues.push('PAYMOB_INTEGRATION_ID غير موجود');
      recommendations.push('أضف PAYMOB_INTEGRATION_ID (رقم Card Integration ID)');
    } else if (!diag.integrationId.isNumber) {
      issues.push('PAYMOB_INTEGRATION_ID ليس رقماً صحيحاً: "' + integrationIdStr + '"');
      recommendations.push('أدخل رقم صحيح فقط (بدون مسافات أو حروف)');
    }

    // 4. HMAC
    if (!diag.hmacSecret.exists) {
      issues.push('PAYMOB_HMAC_SECRET غير موجود');
      recommendations.push('أضف PAYMOB_HMAC_SECRET (للتحقق من الـ webhooks)');
    } else if (diag.hmacSecret.length < 20) {
      issues.push('PAYMOB_HMAC_SECRET قصير جداً');
    }

    // 5. اختبار فعلي مع Paymob
    let liveTest = null;
    if (issues.length === 0) {
      try {
        const testResponse = await fetch('https://accept.paymob.com/v1/intention/', {
          method: 'POST',
          headers: {
            'Authorization': 'Token ' + secretKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            amount: 10000,
            currency: 'EGP',
            payment_methods: [integrationId],
            items: [{ name: 'diagnostic', amount: 10000, quantity: 1 }],
            billing_data: {
              first_name: 'Test', last_name: 'Test',
              email: 'test@test.com', phone_number: '+201000000000',
              street: 'NA', building: 'NA', floor: 'NA', apartment: 'NA',
              city: 'Cairo', state: 'Cairo', country: 'EG', postal_code: 'NA'
            }
          })
        });

        const testData = await testResponse.json();

        liveTest = {
          httpStatus: testResponse.status,
          success: testResponse.ok,
          response: testData,
          error: !testResponse.ok ? (testData.detail || testData.message || 'سبب غير معروف') : null
        };

        if (!testResponse.ok) {
          issues.push('Paymob API رفض المفاتيح: ' + (testData.detail || 'سبب غير معروف'));
          recommendations.push('راجع Paymob Dashboard — قد تحتاج تفعيل الـ Intention API من الدعم');
        }
      } catch (e) {
        liveTest = { error: e.message, exception: true };
        issues.push('فشل الاتصال بـ Paymob API: ' + e.message);
      }
    }

    // ⚠️ حساب نص عدد المشاكل (قبل الـ return — هذا هو مكانه الصحيح)
    const issuesCountText = issues.length === 1 ? 'مشكلة واحدة'
                          : issues.length === 2 ? 'مشكلتان'
                          : (issues.length >= 3 && issues.length <= 10) ? issues.length + ' مشاكل'
                          : issues.length + ' مشكلة';

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      env: diag,
      liveTest: liveTest,
      issuesCount: issues.length,
      issues: issues,
      recommendations: recommendations,
      verdict: issues.length === 0
        ? '✅ جميع الإعدادات صحيحة، و Paymob يقبل المفاتيح — المشكلة في مكان آخر'
        : '❌ ' + issuesCountText + ' — يرجى مراجعة القائمة أعلاه'
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: e.message,
      stack: e.stack
    });
  }
}