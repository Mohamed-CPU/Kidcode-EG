// ================================================================
//  lib/admin/telegram-admin-commands.js
//  معالجة أوامر الأدمن على بوت تليجرام
//  - /link CODE     → ربط الحساب
//  - /open          → فتح اللوحة (super_admin فقط)
//  - /close         → قفل اللوحة (super_admin فقط)
//  - /login         → طلب رابط دخول
//  - /status        → عرض الحالة
//  - /revoke        → إنهاء الجلسات
//  - /help-admin    → قائمة الأوامر
// ================================================================

import { supabaseAdmin } from '../supabase.js';
import { TABLES } from '../db/tables.js';
import { writeAuditLog } from './audit.js';
import { sendViaTelegram, answerCallbackQuery } from '../telegram.js';
import { consumeLinkCode, getAdminByChatId } from './link-codes.js';
import { openPanel, closePanel, getPanelStatus } from './panel-gate.js';
import { createLoginLink } from './login-links.js';
import { generateRecoveryCodes, countUnusedCodes } from './recovery.js';

// ================================================================
//  🔧 الثوابت
// ================================================================
const SUPER_ADMIN_USERNAME = 'super_admin';

// ================================================================
//  🛠️ Helpers
// ================================================================
function isSuperAdmin(admin) {
  if (!admin) return false;
  return String(admin.username || '').trim() === SUPER_ADMIN_USERNAME;
}

function isActive(admin) {
  if (!admin) return false;
  return String(admin.is_active || '').trim() === 'نشط';
}

function nowEgyptStr() {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).replace('T', ' ');
}

async function reply(chatId, text) {
  try {
    const result = await sendViaTelegram(String(chatId), text);
    // ✅ نسجّل النتيجة — لو Telegram رفض الرسالة، نشوف السبب
    if (result && result.success === false) {
      console.error('[telegram-admin reply] FAILED:', JSON.stringify({
        chatId: String(chatId),
        message: result.error || result.message || 'unknown',
        description: result.description || null
      }));
    }
    return result;
  } catch (e) {
    console.error('[telegram-admin reply] EXCEPTION:', e.message);
    return { success: false, error: e.message };
  }
}

// ================================================================
//  🎨 Keyboard Builders — أزرار Inline
// ================================================================

/**
 * أزرار القائمة الرئيسية — تُعرض مع /help-admin
 * @param {boolean} isSuper — لو super_admin، نضيف أزرار إضافية
 */
function getMainMenuKeyboard(isSuper) {
  const rows = [];

  if (isSuper) {
    rows.push([
      { text: '🔓 فتح اللوحة', callback_data: 'adm:open' },
      { text: '🔒 قفل اللوحة', callback_data: 'adm:close' }
    ]);
  }

  rows.push([
    { text: '🔑 طلب رابط دخول', callback_data: 'adm:login' },
    { text: '📊 حالة حسابي', callback_data: 'adm:status' }
  ]);

  rows.push([
    { text: '🚪 إنهاء الجلسات', callback_data: 'adm:revoke' }
  ]);

  if (isSuper) {
    rows.push([
      { text: '🆘 توليد أكواد الطوارئ', callback_data: 'adm:recovery' }
    ]);
  }

  rows.push([
    { text: '🔄 تحديث القائمة', callback_data: 'adm:help' }
  ]);

  return rows;
}

/**
 * أزرار التأكيد للأوامر الخطيرة
 * @param {string} action — 'close' | 'revoke' | 'recovery'
 */
function getConfirmKeyboard(action) {
  return [[
    { text: '✅ نعم، تأكيد', callback_data: 'adm:' + action + ':yes' },
    { text: '❌ إلغاء', callback_data: 'adm:' + action + ':no' }
  ]];
}

/**
 * أزرار ما بعد النجاح (رجوع للقائمة الرئيسية)
 */
function getAfterActionKeyboard() {
  return [[
    { text: '🔙 القائمة الرئيسية', callback_data: 'adm:help' }
  ]];
}

// ================================================================
//  🚀 handleAdminCommand — نقطة الدخول الموحدة
//  يُرجِع { handled: true } إذا كان أمرًا إداريًا
//  يُرجِع { handled: false } إذا لم يكن كذلك (يُترك للـ Webhook العادي)
// ================================================================
export async function handleAdminCommand(message) {
  if (!message || !message.text) return { handled: false };

  const chatId = message.chat && message.chat.id ? String(message.chat.id) : '';
  if (!chatId) return { handled: false };
  const rawText = String(message.text).trim();
  const stripped = rawText.replace(/^\/+/, '').replace(/\/+$/, '').trim();
  const text = '/' + stripped;
  const lower = text.toLowerCase();

  // ─── 1. /start link_XXX (deeplink) ───
  if (lower.startsWith('/start ')) {
    const payload = text.substring(7).trim();
    if (payload.startsWith('link_') || payload.startsWith('link-')) {
      const code = payload.substring(5).trim();
      const upper = code.toUpperCase();
      if (upper.startsWith('LINK-') || upper.startsWith('BOOT-')) {
        await handleLinkCommand(chatId, code);
        return { handled: true };
      }
    }
    return { handled: false };
  }

  // ─── 2. /link CODE ───
  if (lower === '/link' || lower.startsWith('/link ')) {
    const parts = text.split(/\s+/);
    const code = parts[1] || '';
    if (!code) {
      await reply(chatId,
        '⚠️ <b>صيغة خاطئة</b>\n\n' +
        'الاستخدام: <code>/link CODE</code>\n' +
        'مثال: <code>/link LINK-A7K9-2M4X</code>'
      );
      return { handled: true };
    }
    await handleLinkCommand(chatId, code);
    return { handled: true };
  }

  // ─── 3. باقي الأوامر ───
  if (lower === '/open')       { await handleOpenCommand(chatId);     return { handled: true }; }
  if (lower === '/close')      { await handleCloseCommand(chatId);    return { handled: true }; }
  if (lower === '/login')      { await handleLoginCommand(chatId);    return { handled: true }; }
  if (lower === '/revoke')     { await handleRevokeCommand(chatId);   return { handled: true }; }
  if (lower === '/recovery')   { await handleRecoveryCommand(chatId); return { handled: true }; }

  // ✅ /help و /help-admin (alias للتوافق مع الاثنين)
  if (lower === '/help' || lower === '/help-admin' || lower === '/help_admin') {
    await handleHelpCommand(chatId);
    return { handled: true };
  }

  // ⚠️ /status خاص — يشتغل للأدمن فقط، وإلا يمر للمسوق/الوالد
  if (lower === '/status') {
    const handled = await handleStatusCommand(chatId);
    return { handled: handled };
  }

  return { handled: false };
}

// ================================================================
//  🔗 /link CODE
// ================================================================
async function handleLinkCommand(chatId, code) {
  const result = await consumeLinkCode(code, chatId);

  if (!result.success) {
    const msgs = {
      invalid_code:  '❌ الكود غير صحيح',
      used_code:     '⚠️ هذا الكود مُستخدم بالفعل',
      expired_code:  '⏰ انتهت صلاحية الكود',
      missing_code:  '⚠️ لم يتم إرسال كود',
      link_failed:   '❌ فشل الربط، يرجى المحاولة مرة أخرى',
      link_exception:'❌ فشل الربط، يرجى المحاولة مرة أخرى'
    };
    const msg = msgs[result.error] || ('❌ ' + (result.message || 'فشل الربط'));
    await reply(chatId, msg);
    return;
  }

  const isSuper = String(result.username).trim() === SUPER_ADMIN_USERNAME;
  const emoji = isSuper ? '👑' : '✅';
  const title = isSuper ? 'تم ربط <b>super_admin</b>' : 'تم ربط حسابك';

  // ✅ رسالة موحدة للجميع — الأوامر العامة أولاً
  let msg = '';
  msg += emoji + ' <b>' + title + '</b>\n\n';
  msg += 'الحساب: <code>' + result.username + '</code>\n';
  msg += 'معرّف المحادثة: <code>' + result.chatId + '</code>\n\n';

  // ─── أوامر super_admin (تظهر لـ super_admin فقط) ───
  if (isSuper) {
    msg += '<b>👑 أوامر super_admin:</b>\n';
    msg += '<code>/open</code> — فتح اللوحة للجميع\n';
    msg += '<code>/close</code> — قفل اللوحة\n';
    msg += '<code>/recovery</code> — توليد أكواد الطوارئ\n\n';
  }

  msg += 'اضغط على أحد الأزرار في الأسفل 👇';

  await sendViaTelegram(chatId, msg, {
    inlineKeyboard: getMainMenuKeyboard(isSuper)
  });
}

// ================================================================
//  🔓 /open — فتح البوابة (super_admin فقط)
// ================================================================
async function handleOpenCommand(chatId) {
  const admin = await getAdminByChatId(chatId);
  if (!admin) {
    await reply(chatId, '⚠️ يجب ربط حسابك أولاً');
    return;
  }
  if (!isActive(admin)) {
    await reply(chatId, '🚫 حسابك معطَّل');
    return;
  }
  if (!isSuperAdmin(admin)) {
    await reply(chatId, '🚫 هذا الأمر متاح لـ super_admin فقط');
    return;
  }
  await executeOpenFlow(chatId, admin);
}

// ================================================================
//  🔒 /close — قفل البوابة (super_admin فقط)
// ================================================================
async function handleCloseCommand(chatId) {
  const admin = await getAdminByChatId(chatId);
  if (!admin) {
    await reply(chatId, '⚠️ يجب ربط حسابك أولاً');
    return;
  }
  if (!isActive(admin)) {
    await reply(chatId, '🚫 حسابك معطَّل');
    return;
  }
  if (!isSuperAdmin(admin)) {
    await reply(chatId, '🚫 هذا الأمر متاح لـ super_admin فقط');
    return;
  }
  // عند الأوامر النصية: نطلب تأكيد بالأزرار
  await sendViaTelegram(chatId,
    '⚠️ <b>تأكيد قفل اللوحة</b>\n\n' +
    'سيتم منع المسؤولين من طلب روابط دخول جديدة.\n' +
    'الجلسات النشطة ستبقى حتى انتهاء صلاحيتها.\n\n' +
    'هل أنت متأكد؟',
    { inlineKeyboard: getConfirmKeyboard('close') }
  );
}

// ================================================================
//  🔑 /login — طلب رابط دخول
// ================================================================
async function handleLoginCommand(chatId) {
  const admin = await getAdminByChatId(chatId);
  if (!admin) {
    await reply(chatId, '⚠️ يجب ربط حسابك أولاً\nاستخدم <code>/link CODE</code>');
    return;
  }
  if (!isActive(admin)) {
    await reply(chatId, '🚫 حسابك معطَّل');
    return;
  }
  await executeLoginFlow(chatId, admin);
}

// ================================================================
//  📊 /status — عرض حالة اللوحة والمسؤول
// ================================================================
async function handleStatusCommand(chatId) {
  const admin = await getAdminByChatId(chatId);

  // ✅ ليس أدمن → لا نرسل شيئًا، نترك الأمر يمر للويب هوك العادي
  if (!admin) {
    return false;
  }

  const panel = await getPanelStatus();
  const panelEmoji = panel.isOpen ? '🟢' : '🔴';
  const panelLabel = panel.isOpen ? 'مفتوحة' : 'مقفولة';

  const isSuper = isSuperAdmin(admin);
  const role = isSuper ? '👑 super_admin' : '👤 مسؤول';

  // عدد الجلسات النشطة
  let sessionsCount = 0;
  try {
    const { data } = await supabaseAdmin
      .from(TABLES.ADMIN_SESSIONS)
      .select('session_token')
      .eq('username', admin.username)
      .eq('status', 'active');
    sessionsCount = (data || []).length;
  } catch (e) {}

  // ✅ استخدام executeStatusFlow الموحدة
  await executeStatusFlow(chatId, admin);
  return true;
}

// ================================================================
//  🚪 /revoke — إنهاء كل جلسات المسؤول + إلغاء روابط الدخول
// ================================================================
async function handleRevokeCommand(chatId) {
  const admin = await getAdminByChatId(chatId);
  if (!admin) {
    await reply(chatId, '⚠️ يجب ربط حسابك أولاً');
    return;
  }
  if (!isActive(admin)) {
    await reply(chatId, '🚫 حسابك معطَّل');
    return;
  }
  await sendViaTelegram(chatId,
    '⚠️ <b>تأكيد إنهاء الجلسات</b>\n\n' +
    'سيتم تسجيل خروجك من <b>جميع الأجهزة</b>، وإلغاء روابط الدخول المعلقة.\n\n' +
    'هل أنت متأكد؟',
    { inlineKeyboard: getConfirmKeyboard('revoke') }
  );
}

// ================================================================
//  🆘 /recovery — توليد/عرض حالة أكواد الطوارئ (super_admin فقط)
// ================================================================
async function handleRecoveryCommand(chatId) {
  const admin = await getAdminByChatId(chatId);
  if (!admin) {
    await reply(chatId, '⚠️ يجب ربط حسابك أولاً');
    return;
  }
  if (!isActive(admin)) {
    await reply(chatId, '🚫 حسابك معطَّل');
    return;
  }
  if (!isSuperAdmin(admin)) {
    await reply(chatId, '🚫 هذا الأمر متاح لـ super_admin فقط');
    return;
  }
  await sendViaTelegram(chatId,
    '⚠️ <b>تأكيد توليد أكواد الطوارئ</b>\n\n' +
    'سيتم حذف الأكواد القديمة غير المستخدمة، وتوليد 10 أكواد جديدة.\n\n' +
    'هل أنت متأكد؟',
    { inlineKeyboard: getConfirmKeyboard('recovery') }
  );
}

// ================================================================
//  ❓ /help-admin — قائمة الأوامر
// ================================================================
async function handleHelpCommand(chatId) {
  const admin = await getAdminByChatId(chatId);
  const isSuper = isSuperAdmin(admin);
  await sendHelpMenuWithButtons(chatId, admin, isSuper);
}

// ================================================================
//  🔘 handleAdminCallbackQuery — معالج ضغطة زر Inline
//  يُرجِع { handled: true/false }
// ================================================================
export async function handleAdminCallbackQuery(callbackQuery) {
  if (!callbackQuery || !callbackQuery.data) return { handled: false };

  const chatId = callbackQuery.message
    && callbackQuery.message.chat
    && callbackQuery.message.chat.id
    ? String(callbackQuery.message.chat.id)
    : '';

  const callbackId = callbackQuery.id || '';
  const data = String(callbackQuery.data).trim();

  if (!chatId) return { handled: false };

  // ─── فحص إن المُستخدم أدمن ───
  const admin = await getAdminByChatId(chatId);
  if (!admin) {
    await answerCallbackQuery(callbackId, '⚠️ حسابك غير مربوط كأدمن', { showAlert: true });
    return { handled: true };
  }
  if (!isActive(admin)) {
    await answerCallbackQuery(callbackId, '🚫 حسابك معطَّل', { showAlert: true });
    return { handled: true };
  }

  const isSuper = isSuperAdmin(admin);

  try {
    // ═══════════════════════════════════════════════════════════
    //  📖 adm:help — عرض القائمة الرئيسية
    // ═══════════════════════════════════════════════════════════
    if (data === 'adm:help') {
      await answerCallbackQuery(callbackId);
      await sendHelpMenuWithButtons(chatId, admin, isSuper);
      return { handled: true };
    }

    // ═══════════════════════════════════════════════════════════
    //  🔑 adm:login — طلب رابط دخول
    // ═══════════════════════════════════════════════════════════
    if (data === 'adm:login') {
      await answerCallbackQuery(callbackId, '⏳ جاري توليد الرابط...');
      await executeLoginFlow(chatId, admin);
      return { handled: true };
    }

    // ═══════════════════════════════════════════════════════════
    //  📊 adm:status — عرض الحالة
    // ═══════════════════════════════════════════════════════════
    if (data === 'adm:status') {
      await answerCallbackQuery(callbackId, '⏳ جاري التحميل...');
      await executeStatusFlow(chatId, admin);
      return { handled: true };
    }

    // ═══════════════════════════════════════════════════════════
    //  🔓 adm:open — فتح اللوحة (super فقط)
    // ═══════════════════════════════════════════════════════════
    if (data === 'adm:open') {
      if (!isSuper) {
        await answerCallbackQuery(callbackId, '🚫 متاح لـ super_admin فقط', { showAlert: true });
        return { handled: true };
      }
      await answerCallbackQuery(callbackId, '⏳ جاري الفتح...');
      await executeOpenFlow(chatId, admin);
      return { handled: true };
    }

    // ═══════════════════════════════════════════════════════════
    //  🔒 adm:close — قفل اللوحة (مع تأكيد)
    // ═══════════════════════════════════════════════════════════
    if (data === 'adm:close') {
      if (!isSuper) {
        await answerCallbackQuery(callbackId, '🚫 متاح لـ super_admin فقط', { showAlert: true });
        return { handled: true };
      }
      await answerCallbackQuery(callbackId);
      await sendViaTelegram(chatId,
        '⚠️ <b>تأكيد قفل اللوحة</b>\n\n' +
        'سيتم منع المسؤولين من طلب روابط دخول جديدة.\n' +
        'الجلسات النشطة ستبقى حتى انتهاء صلاحيتها.\n\n' +
        'هل أنت متأكد؟',
        { inlineKeyboard: getConfirmKeyboard('close') }
      );
      return { handled: true };
    }

    if (data === 'adm:close:yes') {
      await answerCallbackQuery(callbackId, '⏳ جاري القفل...');
      await executeCloseFlow(chatId, admin);
      return { handled: true };
    }

    if (data === 'adm:close:no') {
      await answerCallbackQuery(callbackId, '✅ تم الإلغاء');
      await reply(chatId, '✅ تم إلغاء قفل اللوحة.');
      return { handled: true };
    }

    // ═══════════════════════════════════════════════════════════
    //  🚪 adm:revoke — إنهاء الجلسات (مع تأكيد)
    // ═══════════════════════════════════════════════════════════
    if (data === 'adm:revoke') {
      await answerCallbackQuery(callbackId);
      await sendViaTelegram(chatId,
        '⚠️ <b>تأكيد إنهاء الجلسات</b>\n\n' +
        'سيتم تسجيل خروجك من <b>جميع الأجهزة</b>، وإلغاء روابط الدخول المعلقة.\n\n' +
        'هل أنت متأكد؟',
        { inlineKeyboard: getConfirmKeyboard('revoke') }
      );
      return { handled: true };
    }

    if (data === 'adm:revoke:yes') {
      await answerCallbackQuery(callbackId, '⏳ جاري الإنهاء...');
      await executeRevokeFlow(chatId, admin);
      return { handled: true };
    }

    if (data === 'adm:revoke:no') {
      await answerCallbackQuery(callbackId, '✅ تم الإلغاء');
      await reply(chatId, '✅ تم إلغاء العملية.');
      return { handled: true };
    }

    // ═══════════════════════════════════════════════════════════
    //  🆘 adm:recovery — توليد أكواد الطوارئ (super فقط + تأكيد)
    // ═══════════════════════════════════════════════════════════
    if (data === 'adm:recovery') {
      if (!isSuper) {
        await answerCallbackQuery(callbackId, '🚫 متاح لـ super_admin فقط', { showAlert: true });
        return { handled: true };
      }
      await answerCallbackQuery(callbackId);
      await sendViaTelegram(chatId,
        '⚠️ <b>تأكيد توليد أكواد الطوارئ</b>\n\n' +
        'سيتم حذف الأكواد القديمة <b>غير المستخدمة</b>، وتوليد 10 أكواد جديدة.\n\n' +
        'هل أنت متأكد؟',
        { inlineKeyboard: getConfirmKeyboard('recovery') }
      );
      return { handled: true };
    }

    if (data === 'adm:recovery:yes') {
      await answerCallbackQuery(callbackId, '⏳ جاري التوليد...');
      await executeRecoveryFlow(chatId, admin);
      return { handled: true };
    }

    if (data === 'adm:recovery:no') {
      await answerCallbackQuery(callbackId, '✅ تم الإلغاء');
      await reply(chatId, '✅ تم إلغاء توليد الأكواد.');
      return { handled: true };
    }

    // ─── افتراضي ───
    await answerCallbackQuery(callbackId, '⚠️ إجراء غير معروف', { showAlert: true });
    return { handled: true };

  } catch (err) {
    console.error('❌ [handleAdminCallbackQuery]', err.message);
    try {
      await answerCallbackQuery(callbackId, '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى', { showAlert: true });
    } catch (e) {}
    return { handled: true, error: err.message };
  }
}

// ================================================================
//  🛠️ execute* — منطق قابل لإعادة الاستخدام
//  (يُستدعى من الأوامر النصية + ضغطات الأزرار)
// ================================================================

async function executeLoginFlow(chatId, admin) {
  const panel = await getPanelStatus();
  if (!panel.isOpen) {
    await sendViaTelegram(chatId,
      '🔒 <b>اللوحة مقفولة حاليًا</b>\n\n' +
        'يرجى التواصل مع super_admin لفتحها.',
      { inlineKeyboard: getAfterActionKeyboard() }
    );
    return;
  }

  const result = await createLoginLink(admin.username, null, 'telegram_link');
  if (!result.success) {
    await sendViaTelegram(chatId,
      '❌ <b>فشل توليد الرابط</b>\n\n' +
      'السبب: <code>' + (result.error || 'unknown') + '</code>\n' +
      (result.message || ''),
      { inlineKeyboard: getAfterActionKeyboard() }
    );
    return;
  }

  // ✅ أزرار: زر URL "افتح الرابط" + زر رجوع للقائمة
  const keyboard = [
    [{ text: '📱 افتح رابط الدخول', url: result.url }],
    [{ text: '🔙 القائمة الرئيسية', callback_data: 'adm:help' }]
  ];

  const sendResult = await sendViaTelegram(chatId,
    '🔑 <b>رابط الدخول جاهز</b>\n\n' +
    '⏰ صالح لمدة <b>' + result.ttlMinutes + ' دقائق</b>\n' +
    '⚠️ يُستخدم <b>مرة واحدة فقط</b>\n\n' +
    'اضغط الزر في الأسفل للدخول.',
    { inlineKeyboard: keyboard }
  );

  // لو الـ HTML فشل، جرّب plain
  if (!sendResult || sendResult.success === false) {
    await sendViaTelegram(chatId,
      'رابط الدخول:\n' + result.url + '\n\n' +
      'صالح لمدة ' + result.ttlMinutes + ' دقائق.'
    );
  }
}

async function executeStatusFlow(chatId, admin) {
  const panel = await getPanelStatus();
  const panelEmoji = panel.isOpen ? '🟢' : '🔴';
  const panelLabel = panel.isOpen ? 'مفتوحة' : 'مقفولة';

  const isSuper = isSuperAdmin(admin);
  const role = isSuper ? '👑 super_admin' : '👤 مسؤول';

  let sessionsCount = 0;
  try {
    const { data } = await supabaseAdmin
      .from(TABLES.ADMIN_SESSIONS)
      .select('session_token')
      .eq('username', admin.username)
      .eq('status', 'active');
    sessionsCount = (data || []).length;
  } catch (e) {}

  let msg = '';
  msg += '📊 <b>حالة حسابك واللوحة</b>\n\n';
  msg += '<b>الحساب:</b> <code>' + admin.username + '</code>\n';
  msg += '<b>الدور:</b> ' + role + '\n';
  msg += '<b>الحالة:</b> ' + (isActive(admin) ? '✅ نشط' : '🚫 معطَّل') + '\n\n';
  msg += panelEmoji + ' <b>اللوحة: ' + panelLabel + '</b>\n';
  if (panel.updatedBy) msg += 'آخر تغيير بواسطة: <code>' + panel.updatedBy + '</code>\n';
  if (panel.updatedAt) msg += '⏰ ' + panel.updatedAt + '\n';
  msg += '\n<b>جلساتك النشطة:</b> ' + sessionsCount;

  // ✅ زر تحديث + رجوع للقائمة
  const keyboard = [
    [{ text: '🔄 تحديث', callback_data: 'adm:status' }],
    [{ text: '🔙 القائمة الرئيسية', callback_data: 'adm:help' }]
  ];

  await sendViaTelegram(chatId, msg, { inlineKeyboard: keyboard });
}

async function executeOpenFlow(chatId, admin) {
  const result = await openPanel(admin.username, null);
  if (!result.success) {
    await sendViaTelegram(chatId,
      '❌ ' + (result.message || 'فشل فتح اللوحة'),
      { inlineKeyboard: getAfterActionKeyboard() }
    );
    return;
  }

  await sendViaTelegram(chatId,
    '🔓 <b>تم فتح اللوحة</b>\n\n' +
    'المسؤولون يمكنهم الآن طلب روابط الدخول عبر زر "طلب رابط دخول".\n' +
    '⏰ ' + nowEgyptStr(),
    {
      inlineKeyboard: [
        [{ text: '🔒 قفل اللوحة', callback_data: 'adm:close' }],
        [{ text: '🔙 القائمة الرئيسية', callback_data: 'adm:help' }]
      ]
    }
  );
}

async function executeCloseFlow(chatId, admin) {
  const result = await closePanel(admin.username, null);
  if (!result.success) {
    await sendViaTelegram(chatId,
      '❌ ' + (result.message || 'فشل قفل اللوحة'),
      { inlineKeyboard: getAfterActionKeyboard() }
    );
    return;
  }

  await sendViaTelegram(chatId,
    '🔒 <b>تم قفل اللوحة</b>\n\n' +
    'المسؤولون لن يستطيعوا طلب روابط دخول جديدة.\n' +
    'ملاحظة: الجلسات النشطة مستمرة حتى انتهاء صلاحيتها.\n' +
    '⏰ ' + nowEgyptStr(),
    {
      inlineKeyboard: [
        [{ text: '🔓 فتح اللوحة', callback_data: 'adm:open' }],
        [{ text: '🔙 القائمة الرئيسية', callback_data: 'adm:help' }]
      ]
    }
  );
}

async function executeRevokeFlow(chatId, admin) {
  try {
    await supabaseAdmin
      .from(TABLES.ADMIN_SESSIONS)
      .update({ status: 'logged_out' })
      .eq('username', admin.username)
      .in('status', ['active', 'frozen']);

    await supabaseAdmin
      .from(TABLES.ADMIN_LOGIN_LINKS)
      .update({ used: 'نعم' })
      .eq('username', admin.username)
      .eq('used', 'لا');
  } catch (e) {}

  await writeAuditLog({
    username: admin.username,
    action: 'sessions_revoked_via_telegram',
    target_table: TABLES.ADMINS,
    target_id: admin.username
  });

  await sendViaTelegram(chatId,
    '🚪 <b>تم إنهاء جميع جلساتك النشطة</b>\n\n' +
    'كما تم إلغاء روابط الدخول المعلقة.\n' +
    'يمكنك طلب رابط جديد من القائمة.',
    { inlineKeyboard: getAfterActionKeyboard() }
  );
}

async function executeRecoveryFlow(chatId, admin) {
  const result = await generateRecoveryCodes(admin.username, admin.username);
  if (!result.success) {
    await sendViaTelegram(chatId,
      '❌ فشل توليد الأكواد: ' + (result.error || 'unknown'),
      { inlineKeyboard: getAfterActionKeyboard() }
    );
    return;
  }

  const codesText = result.codes.map(c => '<code>' + c + '</code>').join('\n');

  await sendViaTelegram(chatId,
    '🆘 <b>أكواد الطوارئ الجديدة</b>\n\n' +
    '⚠️ <b>هذه الأكواد تظهر مرة واحدة فقط</b>\n' +
    'احفظها في مكان آمن (Password Manager أو ورقة في مكان سري).\n\n' +
    'كل كود يُستخدم <b>مرة واحدة فقط</b> للدخول في حالة الطوارئ.\n\n' +
    '━━━━━━━━━━━━━━━━━━━\n\n' +
    codesText +
    '\n\n━━━━━━━━━━━━━━━━━━━\n\n' +
    '📌 <b>طريقة الاستخدام:</b>\n' +
    'افتح: kidcode-eg.com/admin/emergency-unlock.html\n' +
    'وأدخل أحد الأكواد.',
    { inlineKeyboard: getAfterActionKeyboard() }
  );
}

// ================================================================
//  📖 sendHelpMenuWithButtons — رسالة المساعدة الرئيسية بأزرار
// ================================================================
async function sendHelpMenuWithButtons(chatId, admin, isSuper) {
  const role = isSuper ? '👑 super_admin' : '👤 مسؤول';
  const username = admin && admin.username ? admin.username : '—';

  let msg = '';
  msg += '📖 <b>قائمة التحكم</b>\n\n';
  msg += 'الحساب: <code>' + username + '</code>\n';
  msg += 'الدور: ' + role + '\n\n';
  msg += 'اختر من الأزرار في الأسفل 👇';

  await sendViaTelegram(chatId, msg, {
    inlineKeyboard: getMainMenuKeyboard(isSuper)
  });
}