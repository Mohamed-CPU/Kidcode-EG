// ================================================================
//  lib/telegram.js — أدوات تليجرام (Node.js)
//  - sendViaTelegram: إرسال رسائل للبوت
//  - generateShortCode: توليد كود قصير عشوائي
//  - getBotToken: قراءة التوكن من Env
// ================================================================

import crypto from 'crypto';

// ============================================================
//  🔑 قراءة BOT_TOKEN
// ============================================================
function getBotToken() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error('❌ [Telegram] BOT_TOKEN غير موجود في Environment Variables');
    return null;
  }
  return token;
}

// ============================================================
//  📤 sendViaTelegram — إرسال رسالة عبر Telegram Bot API
//  يدعم HTML + inlineKeyboard
// ============================================================
export async function sendViaTelegram(chatId, text, options = {}) {
  try {
    const token = getBotToken();
    if (!token) {
      return { success: false, error: 'bot_token_missing' };
    }

    if (!chatId) {
      return { success: false, error: 'chat_id_missing' };
    }

    if (!text) {
      return { success: false, error: 'message_empty' };
    }

    // ✅ قص الرسائل الطويلة
    const MAX_LENGTH = 4096;
    let finalMessage = String(text);
    if (finalMessage.length > MAX_LENGTH) {
      finalMessage = finalMessage.substring(0, MAX_LENGTH - 3) + '...';
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    const payload = {
      chat_id: String(chatId),
      text: finalMessage,
      parse_mode: options.parseMode || 'HTML',
      disable_web_page_preview: options.disablePreview !== false,
      disable_notification: options.silent === true
    };

    // ✅ أزرار Inline (اختياري)
    if (options.inlineKeyboard && Array.isArray(options.inlineKeyboard)) {
      payload.reply_markup = {
        inline_keyboard: options.inlineKeyboard
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!data.ok) {
      const errorDesc = data.description || 'unknown_error';
      console.error(`❌ [Telegram] فشل إلى ${chatId} | ${errorDesc}`);
      return {
        success: false,
        error: errorDesc,
        errorCode: data.error_code || null,
        retryAfter: (data.parameters && data.parameters.retry_after) || null
      };
    }

    console.log(`✅ [Telegram] أُرسلت إلى ${chatId} | messageId: ${data.result && data.result.message_id}`);
    return {
      success: true,
      messageId: (data.result && data.result.message_id) || null
    };

  } catch (err) {
    console.error(`❌ [Telegram] استثناء: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  🔘 answerCallbackQuery — الرد على ضغطة زر Inline
//  - إلغاء الـ spinner فوق الزر
//  - إظهار نص قصير للمستخدم (Toast افتراضي، أو Alert)
// ============================================================
export async function answerCallbackQuery(callbackQueryId, text, options = {}) {
  try {
    const token = getBotToken();
    if (!token) return { success: false, error: 'bot_token_missing' };

    const cid = String(callbackQueryId || '').trim();
    if (!cid) return { success: false, error: 'callback_id_missing' };

    const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;

    const payload = { callback_query_id: cid };

    if (text) {
      payload.text = String(text).substring(0, 200);
      // showAlert: true → Alert مع زر "حسنًا"
      // showAlert: false → Toast خفيف أعلى الشاشة (افتراضي)
      payload.show_alert = options.showAlert === true;
    }

    if (options.url && /^https?:\/\//.test(options.url)) {
      payload.url = options.url;
    }

    if (Number.isInteger(options.cacheTime) && options.cacheTime >= 0) {
      payload.cache_time = options.cacheTime;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!data.ok) {
      const errorDesc = data.description || 'unknown_error';
      console.error(`❌ [answerCallbackQuery] فشل | ${errorDesc}`);
      return { success: false, error: errorDesc };
    }

    return { success: true };

  } catch (err) {
    console.error(`❌ [answerCallbackQuery] استثناء: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  🔢 generateShortCode — توليد كود قصير (A-Z + 0-9)
// ============================================================
export function generateShortCode(length) {
  length = length || 6;
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بدون 0/O/I/1 عشان الالتباس
  let result = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}