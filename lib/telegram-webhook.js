// ================================================================
//  lib/telegram-webhook.js — معالجة Webhook تليجرام في Vercel
//  - /start + parent token → ربط والد
//  - /start + M_ token → ربط مسوق
//  - /mycode, /mystats, /share → أوامر المسوقين
//  - /status → حالة الأطفال + المسوق
//  - الباقي → forward لـ GAS
// ================================================================

import { supabaseAdmin } from './supabase.js';
import { TABLES, COLS_CHILDREN, COLS_MARKETERS } from './db/tables.js';
import { sendViaTelegram } from './telegram.js';
import { getMarketerStats } from './db/marketer-read.js';
import {
  handleAdminCommand,
  handleAdminCallbackQuery
} from './admin/telegram-admin-commands.js';

// ============================================================
//  🕐 توقيت UTC (للحفظ في DB — timestamptz)
// ============================================================
function nowUTC() {
  return new Date().toISOString();
}

// ============================================================
//  🔍 findPendingLinkByToken — يدوّر على التوكن في Supabase
// ============================================================
async function findPendingLinkByToken(token) {
  if (!token) return null;

  try {
    const { data, error } = await supabaseAdmin
      .from(TABLES.PENDING_LINKS)
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .maybeSingle();

    if (error || !data) return null;

    // ✅ فحص الـ expiry — timestamptz من Supabase بيرجع ISO UTC مع Z
    // لا حاجة لأي fallback يدوي — new Date() بتفهم ISO مباشرة
    const expiresAtRaw = data.expires_at;
    if (expiresAtRaw) {
      const expiresMs = new Date(expiresAtRaw).getTime();

      if (!isNaN(expiresMs) && Date.now() > expiresMs) {
        await supabaseAdmin
          .from(TABLES.PENDING_LINKS)
          .update({ status: 'expired' })
          .eq('token', token);

        console.log(`⏰ [findPendingLinkByToken] TOKEN EXPIRED: ${token.substring(0, 8)}... | expires: ${expiresAtRaw}`);
        return null;
      }
    }

    return {
      token: data.token,
      childID: String(data.child_id || '').trim(),
      parentType: String(data.parent_type || 'father').trim().toLowerCase(),
      userType: String(data.user_type || 'parent').trim(),
      expiresAt: expiresAtRaw
    };

  } catch (err) {
    console.error('❌ [findPendingLinkByToken]', err.message);
    return null;
  }
}

// ============================================================
//  👨‍👩‍👧 linkTelegramToChild — ربط chat_id بالطفل
// ============================================================
async function linkTelegramToChild(chatId, childID, firstName, username, parentType) {
  try {
    const cleanParent = (parentType || 'father').toLowerCase();

    const { data: child, error } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select('*')
      .eq(COLS_CHILDREN.child_id, childID)
      .maybeSingle();

    if (error || !child) {
      console.error(`❌ [linkTelegramToChild] child not found: ${childID}`);
      return { success: false, error: 'child_not_found' };
    }

    const now = nowUTC();

    const chatField = cleanParent === 'father'
      ? COLS_CHILDREN.telegram_chat_id_father
      : COLS_CHILDREN.telegram_chat_id_mother;
    const linkedAtField = cleanParent === 'father'
      ? COLS_CHILDREN.telegram_linked_at_father
      : COLS_CHILDREN.telegram_linked_at_mother;

    const updates = {};
    updates[chatField] = String(chatId);
    updates[linkedAtField] = now;

    // legacy (لأول parent يربط بس)
    const legacyChat = String(child[COLS_CHILDREN.telegram_chat_id] || '').trim();
    if (!legacyChat) {
      updates[COLS_CHILDREN.telegram_chat_id] = String(chatId);
      updates[COLS_CHILDREN.telegram_linked_at] = now;
    }

    updates[COLS_CHILDREN.notification_method] = 'telegram';

    const { error: updateError } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .update(updates)
      .eq(COLS_CHILDREN.child_id, childID);

    if (updateError) {
      console.error(`❌ [linkTelegramToChild] update error: ${updateError.message}`);
      return { success: false, error: updateError.message };
    }

    // حدّث PendingLink
    await supabaseAdmin
      .from(TABLES.PENDING_LINKS)
      .update({ status: 'linked' })
      .eq('child_id', childID)
      .eq('parent_type', cleanParent)
      .eq('status', 'pending');

    console.log(`✅ [linkTelegramToChild] ${childID} | ${cleanParent} ← chat ${chatId}`);
    return { success: true, chatId: String(chatId), childID, parentType: cleanParent };

  } catch (err) {
    console.error('❌ [linkTelegramToChild]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  👨‍👩‍👧 findAllChildrenByChatId — كل الأطفال المربوطين بـ chat_id
// ============================================================
async function findAllChildrenByChatId(chatId) {
  try {
    const cleanChat = String(chatId).trim();

    const { data, error } = await supabaseAdmin
      .from(TABLES.CHILDREN)
      .select('child_id,child_name,plan,status')
      .or(`telegram_chat_id_father.eq.${cleanChat},telegram_chat_id_mother.eq.${cleanChat},telegram_chat_id.eq.${cleanChat}`);

    if (error || !data) return [];

    return data.map(c => ({
      id: c.child_id,
      name: c.child_name,
      plan: c.plan,
      status: c.status
    }));

  } catch (err) {
    console.error('❌ [findAllChildrenByChatId]', err.message);
    return [];
  }
}

// ============================================================
//  👨‍👩‍👧 handleParentStart — ربط الوالد
// ============================================================
async function handleParentStart(chatId, payload, firstName, username) {
  try {
    const pendingLink = await findPendingLinkByToken(payload);

    if (!pendingLink) {
      await sendViaTelegram(chatId,
        `⚠️ <b>الرابط غير صالح أو منتهي</b>\n\n` +
        `يرجى طلب رابط جديد من لوحة التحكم.`
      );
      return { success: false, error: 'invalid_token' };
    }

    const parentType = pendingLink.parentType || 'father';
    const parentLabel = parentType === 'father' ? 'الأب' : 'الأم';

    const linkResult = await linkTelegramToChild(
      chatId,
      pendingLink.childID,
      firstName,
      username,
      parentType
    );

    if (linkResult.success) {
      const { data: child } = await supabaseAdmin
        .from(TABLES.CHILDREN)
        .select('child_name')
        .eq(COLS_CHILDREN.child_id, pendingLink.childID)
        .maybeSingle();

      const childName = child ? child.child_name : 'غير معروف';

      const linkedChildren = await findAllChildrenByChatId(chatId);
      const childIDsList = linkedChildren.map(c => c.id).join(', ');

      await sendViaTelegram(chatId,
        `✅ <b>تم ربط حسابك بنجاح!</b>\n\n` +
        `👤 الصفة: <b>${parentLabel}</b>\n` +
        `👶 الطفل: <b>${childName || 'غير معروف'}</b>\n` +
        `🆔 المعرف: <code>${pendingLink.childID}</code>\n\n` +
        `ستصلك هنا:\n` +
        `• 🔔 تنبيهات فورية عند مسح رمز QR\n` +
        `• 📍 موقع الطفل لحظة بلحظة\n` +
        `• 📊 تقارير دورية\n\n` +
        (linkedChildren.length > 1
          ? `💡 <b>أنت تتابع الآن ${linkedChildren.length === 2 ? 'طفلين' : linkedChildren.length <= 10 ? linkedChildren.length + ' أطفال' : linkedChildren.length + ' طفلاً'}:</b>\n<code>${childIDsList}</code>\n\n`
          : `💡 <i>لربط طفل آخر، اذهب إلى لوحة تحكمه واضغط "ربط تليجرام".</i>\n\n`) +
        `📢 <b>للدعم:</b> <a href="https://t.me/Kidcode_EG">@Kidcode_EG</a>`
      );

      return { success: true, action: 'linked_parent', childID: pendingLink.childID, parentType };
    } else {
      await sendViaTelegram(chatId, `❌ <b>فشل الربط</b>\n\nيرجى المحاولة مرة أخرى أو التواصل مع الدعم.`);
      return { success: false, error: linkResult.error };
    }

  } catch (err) {
    console.error('❌ [handleParentStart]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  🧑‍💼 findMarketerByChatId
// ============================================================
async function findMarketerByChatId(chatId) {
  try {
    const cleanChat = String(chatId).trim();

    const { data, error } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .select('*')
      .eq(COLS_MARKETERS.telegram_chat_id, cleanChat)
      .maybeSingle();

    if (error || !data) return null;

    return {
      code: String(data[COLS_MARKETERS.code] || '').trim(),
      name: String(data[COLS_MARKETERS.name] || '').trim(),
      phone: String(data[COLS_MARKETERS.phone] || '').trim(),
      email: String(data[COLS_MARKETERS.email] || '').trim(),
      discount: parseFloat(data[COLS_MARKETERS.discount_percent]) || 10,
      isActive: String(data[COLS_MARKETERS.is_active] || '').trim()
    };

  } catch (err) {
    console.error('❌ [findMarketerByChatId]', err.message);
    return null;
  }
}

// ============================================================
//  🧑‍💼 linkTelegramToMarketer
// ============================================================
async function linkTelegramToMarketer(chatId, marketerCode, firstName, username) {
  try {
    const cleanCode = String(marketerCode || '').trim().toUpperCase();

    const { data: marketer, error } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .select('code,name')
      .eq(COLS_MARKETERS.code, cleanCode)
      .maybeSingle();

    if (error || !marketer) return { success: false, error: 'marketer_not_found' };

    const now = nowUTC();

    const { error: updateError } = await supabaseAdmin
      .from(TABLES.MARKETERS)
      .update({
        [COLS_MARKETERS.telegram_chat_id]: String(chatId),
        [COLS_MARKETERS.telegram_linked_at]: now,
        [COLS_MARKETERS.notification_method]: 'telegram'
      })
      .eq(COLS_MARKETERS.code, cleanCode);

    if (updateError) return { success: false, error: updateError.message };

    // حدّث PendingLink
    await supabaseAdmin
      .from(TABLES.PENDING_LINKS)
      .update({ status: 'linked' })
      .eq('child_id', cleanCode)
      .eq('user_type', 'marketer')
      .eq('status', 'pending');

    console.log(`✅ [linkTelegramToMarketer] ${cleanCode} ← chat ${chatId}`);
    return { success: true, chatId: String(chatId), marketerCode: cleanCode };

  } catch (err) {
    console.error('❌ [linkTelegramToMarketer]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  🧑‍💼 handleMarketerStart
// ============================================================
async function handleMarketerStart(chatId, payload, firstName, username) {
  try {
    const pendingLink = await findPendingLinkByToken(payload);

    if (!pendingLink) {
      await sendViaTelegram(chatId,
        `⚠️ <b>الرابط غير صالح أو منتهي</b>\n\n` +
        `يرجى طلب رابط جديد من <a href="https://www.kidcode-eg.com/marketer-dashboard">لوحة تحكم المسوقين</a>.`
      );
      return { success: false, error: 'invalid_token' };
    }

    if (pendingLink.userType !== 'marketer') {
      await sendViaTelegram(chatId,
        `⚠️ <b>هذا الرابط غير صالح لربط المسوقين</b>\n\n` +
        `يرجى استخدام الرابط المخصص من لوحة تحكم المسوقين.`
      );
      return { success: false, error: 'wrong_user_type' };
    }

    const marketerCode = pendingLink.childID;

    const linkResult = await linkTelegramToMarketer(chatId, marketerCode, firstName, username);

    if (linkResult.success) {
      // جيب اسم المسوق
      const { data: marketer } = await supabaseAdmin
        .from(TABLES.MARKETERS)
        .select('name')
        .eq(COLS_MARKETERS.code, marketerCode)
        .maybeSingle();

      const marketerName = marketer ? marketer.name : 'مُسوّق';

      await sendViaTelegram(chatId,
        `✅ <b>تم ربط حسابك كمُسوّق بنجاح!</b>\n\n` +
        `👤 <b>الاسم:</b> ${marketerName}\n` +
        `🎫 <b>كودك:</b> <code>${marketerCode}</code>\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n` +
        `ستصلك هنا:\n` +
        `• 🎉 إشعار عند تسجيل عميل جديد بكودك\n` +
        `• 💰 تنبيه بالعمولات المستحقة\n` +
        `• 📊 تقرير أسبوعي بأدائك\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n` +
        `📋 <b>الأوامر المتاحة:</b>\n` +
        `/mycode — عرض كودك\n` +
        `/mystats — إحصائيات العمولات\n` +
        `/share — رابط المشاركة\n` +
        `/help — المساعدة\n\n` +
        `📢 <b>للدعم:</b> <a href="https://t.me/Kidcode_EG">@Kidcode_EG</a>`
      );

      return { success: true, action: 'linked_marketer', marketerCode };
    } else {
      await sendViaTelegram(chatId, `❌ <b>فشل الربط</b>\n\nيرجى المحاولة مرة أخرى أو التواصل مع الدعم.`);
      return { success: false, error: linkResult.error };
    }

  } catch (err) {
    console.error('❌ [handleMarketerStart]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  🎫 /mycode — عرض كود المسوق
// ============================================================
async function handleMyCodeCommand(chatId) {
  try {
    const marketer = await findMarketerByChatId(chatId);
    if (!marketer) {
      await sendViaTelegram(chatId,
        `⚠️ <b>حسابك غير مربوط كمسوق</b>\n\n` +
        `افتح <a href="https://www.kidcode-eg.com/marketer-dashboard">لوحة تحكم المسوقين</a> واضغط "ربط تليجرام".`
      );
      return { success: false, error: 'not_linked' };
    }

    await sendViaTelegram(chatId,
      `🎫 <b>كودك الخاص</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n\n` +
      `<code>${marketer.code}</code>\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n\n` +
      `👤 <b>الاسم:</b> ${marketer.name}\n` +
      `💰 <b>الخصم للعميل:</b> ${marketer.discount}%\n\n` +
      `📢 للاستفسار: <a href="https://t.me/Kidcode_EG">@Kidcode_EG</a>`
    );

    return { success: true };

  } catch (err) {
    console.error('❌ [handleMyCodeCommand]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  📊 /mystats — إحصائيات المسوق
// ============================================================
async function handleMyStatsCommand(chatId) {
  try {
    const marketer = await findMarketerByChatId(chatId);
    if (!marketer) {
      await sendViaTelegram(chatId,
        `⚠️ <b>حسابك غير مربوط كمسوق</b>\n\n` +
        `افتح <a href="https://www.kidcode-eg.com/marketer-dashboard">لوحة تحكم المسوقين</a> واضغط "ربط تليجرام".`
      );
      return { success: false, error: 'not_linked' };
    }

    const statsResult = await getMarketerStats({ code: marketer.code });
    if (!statsResult.success) {
      await sendViaTelegram(chatId, `❌ فشل تحميل الإحصائيات. يرجى المحاولة لاحقاً.`);
      return { success: false, error: statsResult.error };
    }

    const s = statsResult.stats;
    const totalEarned = s.totalEarnedCommission || 0;
    const totalPending = s.totalPendingCommission || 0;
    const totalChildren = s.totalChildren || 0;
    const totalCommission = totalEarned + totalPending;
    const divider = '━━━━━━━━━━━━━━━━━━━';

    await sendViaTelegram(chatId,
      `📊 <b>إحصائياتك</b>\n` +
      `\n` +
      `${divider}\n` +
      `\n` +
      `👶 <b>إجمالي الأطفال:</b> <b>${totalChildren}</b>\n` +
      `💰 <b>إجمالي العمولات:</b> <b>${totalCommission} ج.م</b>\n` +
      `\n` +
      `✅ <b>مستحقة الصرف:</b> <b>${totalEarned} ج.م</b>\n` +
      `⏳ <b>معلقة (أقل من 14 يوم):</b> ${totalPending} ج.م\n` +
      `\n` +
      `${divider}\n` +
      `\n` +
      `🎫 <b>كودك:</b> <code>${marketer.code}</code>`
    );

    return { success: true };

  } catch (err) {
    console.error('❌ [handleMyStatsCommand]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  📤 /share — رابط المشاركة
// ============================================================
async function handleShareCommand(chatId) {
  try {
    const marketer = await findMarketerByChatId(chatId);
    if (!marketer) {
      await sendViaTelegram(chatId, `⚠️ <b>حسابك غير مربوط كمسوق</b>`);
      return { success: false, error: 'not_linked' };
    }

    const code = marketer.code;
    const discount = marketer.discount;
    const divider = '━━━━━━━━━━━━━━━━━━━';

    const shareMessage =
      `🎉 <b>شارك كودك الآن!</b>\n` +
      `\n` +
      `${divider}\n` +
      `\n` +
      `🎫 <b>كودك:</b>\n` +
      `<code>${code}</code>\n\n` +
      `💵 <b>الخصم للعميل:</b> ${discount}%\n\n` +
      `${divider}\n` +
      `\n` +
      `📱 <b>رسالة جاهزة للمشاركة:</b>\n` +
      `\n` +
      `<blockquote>احمِ طفلك مع KidCode-EG 🛡️\n\n` +
      `استخدم كودي <b>${code}</b> واحصل على خصم <b>${discount}%</b>!\n\n` +
      `🔗 kidcode-eg.com/reg</blockquote>`;

    await sendViaTelegram(chatId, shareMessage);
    return { success: true };

  } catch (err) {
    console.error('❌ [handleShareCommand]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  📋 /status — حالة الأطفال + المسوق
// ============================================================
async function handleStatusCommand(chatId) {
  try {
    const children = await findAllChildrenByChatId(chatId);
    const marketer = await findMarketerByChatId(chatId);

    if (children.length === 0 && !marketer) {
      await sendViaTelegram(chatId,
        `⚠️ <b>حسابك غير مربوط بأي خدمة</b>\n\n` +
        `• <a href="https://www.kidcode-eg.com/dashboard">لوحة الأسرة</a>\n` +
        `• <a href="https://www.kidcode-eg.com/marketer-dashboard">لوحة المسوقين</a>`
      );
      return { success: true };
    }

    let response = `📊 <b>حالة حسابك</b>\n\n`;
    response += `━━━━━━━━━━━━━━━━━━━\n\n`;

    if (children.length > 0) {
      response += `👶 <b>الأبناء المربوطون (${children.length}):</b>\n\n`;
      children.forEach((c, idx) => {
        response += `<b>${idx + 1}. ${c.name}</b>\n`;
        response += `   🆔 <code>${c.id}</code>\n`;
        response += `   📋 ${c.plan || 'غير محددة'}\n`;
        response += `   ${c.status === 'active' ? '✅ نشط' : '⚠️ ' + c.status}\n\n`;
      });
    }

    if (marketer) {
      response += `🧑‍💼 <b>حساب المسوق:</b>\n\n`;
      response += `🎫 <b>الكود:</b> <code>${marketer.code}</code>\n`;
      response += `💰 <b>الخصم:</b> ${marketer.discount}%\n`;
      response += `📊 استخدم /mystats لعرض الإحصائيات\n`;
    }

    await sendViaTelegram(chatId, response);
    return { success: true };

  } catch (err) {
    console.error('❌ [handleStatusCommand]', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  🚀 handleTelegramWebhook — الراوتر الرئيسي
//  بترجع: { handled: true/false, reason, ... }
// ============================================================
export async function handleTelegramWebhook(update) {
  try {
    if (!update || typeof update !== 'object') {
      return { handled: false, reason: 'no_update' };
    }

    // ============================================================
    //  🔘 callback_query — ضغطة زر Inline (أولوية قصوى)
    // ============================================================
    if (update.callback_query) {
      try {
        console.log(`🔘 [Telegram Webhook] callback_query from ${update.callback_query.from && update.callback_query.from.id} | data: ${update.callback_query.data}`);
        const result = await handleAdminCallbackQuery(update.callback_query);
        return { handled: true, action: 'callback_query', result };
      } catch (err) {
        console.error('❌ [handleTelegramWebhook] callback_query error:', err.message);
        return { handled: true, action: 'callback_query_error', error: err.message };
      }
    }

    if (!update.message) {
      return { handled: false, reason: 'no_message' };
    }

    const message = update.message;
    const chatId = message.chat && message.chat.id;
    const text = (message.text || '').toString().trim();
    const firstName = (message.from && message.from.first_name) || 'User';
    const username = (message.from && message.from.username) || '';

    if (!chatId) return { handled: false, reason: 'no_chat_id' };

    console.log(`📨 [Telegram Webhook] من ${chatId} (${firstName}): ${text.substring(0, 60)}`);

    // ============================================================
    //  🛡️ أوامر الأدمن أولاً (أولوية قصوى)
    //  - /start link_XXX (deeplink)
    //  - /link CODE
    //  - /open, /close (super_admin)
    //  - /login, /status, /revoke, /help-admin
    //  ملاحظة: /status هنا للأدمن فقط — لو مش أدمن، يمر للأسفل
    // ============================================================
    const adminResult = await handleAdminCommand(message);
    if (adminResult && adminResult.handled) {
      console.log(`🛡️ [Telegram Webhook] admin command handled`);
      return { handled: true, action: 'admin_command' };
    }

    // ============================================================
    //  /start — Parent أو Marketer
    // ============================================================
    if (text.startsWith('/start')) {
      const parts = text.split(/\s+/);
      const payload = parts.length > 1 ? parts[1].trim() : '';

      // ✅ /start بدون payload → رد ترحيبي مباشر من Vercel
      if (!payload) {
        console.log(`👋 [Telegram] /start بدون كود → رد ترحيبي`);
        await sendViaTelegram(chatId,
          `👋 <b>مرحباً بك في KidCode-EG</b>\n\n` +
          `هذا البوت مخصص لإشعارات أولياء الأمور والمسوقين.\n\n` +
          `🔗 <b>للربط:</b>\n` +
          `افتح لوحة تحكم الأسرة أو المسوقين، واضغط "ربط تليجرام".\n\n` +
          `📢 <b>للدعم:</b> <a href="https://t.me/Kidcode_EG">@Kidcode_EG</a>`
        );
        return { handled: true, action: 'welcome' };
      }

      // M_ → مسوق
      if (payload.startsWith('M_')) {
        console.log(`🚀 [Telegram] marketer token → Vercel handles`);
        const result = await handleMarketerStart(chatId, payload, firstName, username);
        return { handled: true, action: 'marketer_link', result };
      }

      // عادي → والد
      console.log(`🚀 [Telegram] parent token → Vercel handles`);
      const result = await handleParentStart(chatId, payload, firstName, username);
      return { handled: true, action: 'parent_link', result };
    }

    // ============================================================
    //  🧑‍💼 أوامر المسوقين
    // ============================================================
    if (text === '/mycode') {
      const result = await handleMyCodeCommand(chatId);
      return { handled: true, action: 'mycode', result };
    }

    if (text === '/mystats') {
      const result = await handleMyStatsCommand(chatId);
      return { handled: true, action: 'mystats', result };
    }

    if (text === '/share') {
      const result = await handleShareCommand(chatId);
      return { handled: true, action: 'share', result };
    }

    if (text === '/status') {
      const result = await handleStatusCommand(chatId);
      return { handled: true, action: 'status', result };
    }

    // ============================================================
    //  أي حاجة تانية → GAS
    //  (/help, /start بدون payload, رسائل عامة)
    // ============================================================
    return { handled: false, reason: 'not_handled' };

  } catch (err) {
    console.error('❌ [handleTelegramWebhook]', err.message);
    return { handled: false, reason: 'error', error: err.message };
  }
}