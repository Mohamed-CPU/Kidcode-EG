// ================================================================
//  lib/error-logger.js — إرسال الأخطاء الداخلية إلى تليجرام الأدمن
//  - reportServerError: أخطاء الواجهة الخلفية
//  - reportClientError: أخطاء الواجهة الأمامية
//  - غير حاجب (fire-and-forget)، لا يؤثر على زمن الاستجابة
// ================================================================

import { sendViaTelegram } from './telegram.js';

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

const ADMIN_CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID || '';
const MAX_STACK_LINES = 8;

// ============================================================
//  🔖 توليد رقم مرجعي فريد
// ============================================================
function generateRefId() {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).substring(2, 6).toUpperCase();
  return 'ERR-' + t + '-' + r;
}

// ============================================================
//  🧹 تنقية النص لـ HTML
// ============================================================
function sanitize(value, maxLen) {
  if (value === null || value === undefined) return '';
  maxLen = maxLen || 400;
  return String(value)
    .replace(/[&<>]/g, function(c) {
      if (c === '&') return '&amp;';
      if (c === '<') return '&lt;';
      if (c === '>') return '&gt;';
      return c;
    })
    .substring(0, maxLen);
}

// ============================================================
//  📚 استخراج آخر N سطر من الـ stack
// ============================================================
function extractStack(err, maxLines) {
  if (!err || !err.stack) return '';
  maxLines = maxLines || MAX_STACK_LINES;
  const lines = String(err.stack).split('\n').slice(0, maxLines);
  return lines.join('\n');
}

// ============================================================
//  🚀 reportServerError — خطأ في الواجهة الخلفية
//  - يرجّع refId فورًا (بدون انتظار الإرسال)
//  - الإرسال في الخلفية (async)
// ============================================================
export async function reportServerError(params) {
  const refId = generateRefId();

  try {
    if (!ADMIN_CHAT_ID) return refId;

    const source = sanitize(params.source || 'unknown', 60);
    const error = params.error;
    const context = params.context || {};
    const req = params.req;

    const errMessage = (error && error.message) ? error.message : String(error);
    const stack = extractStack(error);

    // معلومات الطلب
    let reqInfo = '';
    if (req && req.method) {
      const method = String(req.method).substring(0, 10);
      const url = String(req.url || '').substring(0, 100);
      reqInfo = '\n🌐 ' + method + ' ' + url;
    }

    // السياق
    let contextStr = '';
    try {
      const keys = Object.keys(context);
      if (keys.length > 0) {
        contextStr = JSON.stringify(context).substring(0, 500);
      }
    } catch (e) {}

    const text =
      '🚨 <b>Server Error</b>\n' +
      '🔖 <code>' + refId + '</code>\n' +
      '📍 Source: <code>' + source + '</code>' + reqInfo + '\n' +
      '❌ Message: ' + sanitize(errMessage, 400) + '\n' +
      '🕐 ' + nowEgypt12() + '\n' +
      (contextStr ? '🔍 Context: <pre>' + sanitize(contextStr, 400) + '</pre>\n' : '') +
      (stack ? '📚 Stack:\n<pre>' + sanitize(stack, 600) + '</pre>' : '');

    await sendViaTelegram(ADMIN_CHAT_ID, text);
  } catch (e) {
    // فشل صامت — لا نريد حلقة لا نهائية
  }

  return refId;
}

// ============================================================
//  🌐 reportClientError — خطأ من المتصفح
//  - يتحقق من معدل الإرسال (throttle بسيط)
// ============================================================
const recentClientErrors = new Map();
const CLIENT_THROTTLE_MS = 5000;

export async function reportClientError(params) {
  const refId = generateRefId();

  try {
    if (!ADMIN_CHAT_ID) return refId;

    const message = sanitize(params.message || 'unknown', 300);
    const source = sanitize(params.source || 'unknown', 60);

    // throttle: نفس الرسالة ما تتبعتش مرتين خلال 5 ثواني
    const key = source + '::' + message;
    const now = Date.now();
    const last = recentClientErrors.get(key);
    if (last && (now - last) < CLIENT_THROTTLE_MS) return refId;
    recentClientErrors.set(key, now);

    // تنظيف بسيط
    if (recentClientErrors.size > 100) {
      const cutoff = now - (CLIENT_THROTTLE_MS * 2);
      recentClientErrors.forEach(function(v, k) {
        if (v < cutoff) recentClientErrors.delete(k);
      });
    }

    const url = sanitize(params.url || '', 150);
    const userAgent = sanitize(params.userAgent || '', 120);
    const stack = sanitize(params.stack || '', 500);

    const text =
      '🌐 <b>Client Error</b>\n' +
      '🔖 <code>' + refId + '</code>\n' +
      '📍 Source: <code>' + source + '</code>\n' +
      '🔗 URL: ' + url + '\n' +
      '🖥️ UA: ' + userAgent + '\n' +
      '❌ Message: ' + message + '\n' +
      '🕐 ' + nowEgypt12() +
      (stack ? '\n📚 Stack:\n<pre>' + stack + '</pre>' : '');

    await sendViaTelegram(ADMIN_CHAT_ID, text);
  } catch (e) {
    // فشل صامت
  }

  return refId;
}

// ============================================================
//  🧰 respondWithError — رد موحّد على الأخطاء الداخلية
//  - يصنّف الخطأ تلقائيًا
//  - يرسل التفاصيل للأدمن على تليجرام
//  - يرد على المستخدم برسالة مناسبة + رقم مرجعي
// ============================================================
export function respondWithError(res, error, source, context) {
  const refId = reportServerError({
    source: source || 'unknown',
    error: error,
    context: context || {}
  });

  const category = classifyError(error);

  let statusCode = 500;
  let userMessage = 'حدث خطأ غير متوقع. تم إخطار فريق الدعم.';

  if (category === 'network') {
    statusCode = 503;
    userMessage = 'تعذر الاتصال بالخدمة. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.';
  } else if (category === 'timeout') {
    statusCode = 504;
    userMessage = 'استغرق الطلب وقتًا أطول من المتوقع. يرجى المحاولة مرة أخرى.';
  } else if (category === 'db_schema') {
    userMessage = 'حدث خطأ في النظام. تم إخطار فريق الدعم.';
  }

  return res.status(statusCode).json({
    success: false,
    error: category,
    message: userMessage,
    refId: refId
  });
}

// ============================================================
//  🔍 classifyError — تصنيف الخطأ من رسالته
// ============================================================
function classifyError(err) {
  if (!err) return 'unknown';

  const msg = String(err.message || err || '').toLowerCase();

  if (msg.includes('fetch failed') ||
      msg.includes('network') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('socket')) {
    return 'network';
  }

  if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('aborted')) {
    return 'timeout';
  }

  if ((msg.includes('relation') && msg.includes('does not exist')) ||
      (msg.includes('column') && msg.includes('does not exist')) ||
      msg.includes('does not exist') ||
      msg.includes('schema cache')) {
    return 'db_schema';
  }

  if (msg.includes('permission denied') || msg.includes('unauthorized')) {
    return 'permission';
  }

  if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
    return 'duplicate';
  }

  return 'internal';
}