// ================================================================
//  lib/admin/admins.js — إدارة المسؤولين
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { TABLES } from '../db/tables.js';
import { hashPassword, getClientIP } from './auth.js';
import { writeAuditLog } from './audit.js';
import { sendViaTelegram } from '../telegram.js';
import { sendAdminWelcomeEmail, sendAdminTelegramLinkEmail } from '../email/brevo.js';
import { generateLinkCode } from './link-codes.js';

const SUPER_ADMIN_CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID || '';

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
//  🔑 توليد كلمة مرور مؤقتة قوية (16 حرف)
// ============================================================
function generateTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*';
  const all = upper + lower + digits + symbols;

  // نضمن حرفًا من كل نوع
  let pass = '';
  pass += upper[crypto.randomInt(0, upper.length)];
  pass += lower[crypto.randomInt(0, lower.length)];
  pass += digits[crypto.randomInt(0, digits.length)];
  pass += symbols[crypto.randomInt(0, symbols.length)];

  // 12 حرفًا عشوائيًا من المجموعة الكاملة
  for (let i = 0; i < 12; i++) {
    pass += all[crypto.randomInt(0, all.length)];
  }

  // خلط عشوائي
  return pass.split('').sort(() => crypto.randomInt(0, 3) - 1).join('');
}

// ============================================================
//  📋 getAdminsList
// ============================================================
export async function getAdminsList() {
  const { data, error } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .select('username, full_name, email, permissions, is_active, created_by, created_at, last_login_at, theme_preference, must_change_password, telegram_chat_id, telegram_linked_at')
    .order('created_at', { ascending: true });

  if (error) return { success: false, error: error.message };

  const list = (data || []).map(function(row) {
    const perms = row.permissions || {};
    const isSuper = row.username === 'super_admin';
    const tgChatId = String(row.telegram_chat_id || '').trim();
    return {
      username: row.username,
      fullName: row.full_name || '',
      email: row.email || '',
      permissions: perms,
      isActive: String(row.is_active || '').trim() === 'نشط',
      isSuperAdmin: isSuper,
      createdBy: row.created_by || '',
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      mustChangePassword: String(row.must_change_password || '').trim() === 'نعم',
      // 🆕 حالة الربط بتليجرام
      isTelegramLinked: !!tgChatId,
      telegramLinkedAt: tgChatId ? (row.telegram_linked_at || null) : null
    };
  });

  return { success: true, list: list };
}

// ============================================================
//  🔍 getAdminDetails
// ============================================================
export async function getAdminDetails(username) {
  const clean = String(username || '').trim();
  if (!clean) return { success: false, error: 'missing_username' };

  const { data, error } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .select('username, full_name, email, permissions, is_active, created_by, created_at, last_login_at, theme_preference, must_change_password, telegram_chat_id, telegram_linked_at')
    .eq('username', clean)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: 'not_found', message: 'المسؤول غير موجود' };

  const tgChatId = String(data.telegram_chat_id || '').trim();

  return {
    success: true,
    admin: {
      username: data.username,
      fullName: data.full_name || '',
      email: data.email || '',
      permissions: data.permissions || {},
      isActive: String(data.is_active || '').trim() === 'نشط',
      isSuperAdmin: data.username === 'super_admin',
      createdBy: data.created_by || '',
      createdAt: data.created_at,
      lastLoginAt: data.last_login_at,
      mustChangePassword: String(data.must_change_password || '').trim() === 'نعم',
      // 🆕 حالة الربط بتليجرام
      isTelegramLinked: !!tgChatId,
      telegramLinkedAt: tgChatId ? (data.telegram_linked_at || null) : null
    }
  };
}

// ============================================================
//  🆕 createAdmin
// ============================================================
export async function createAdmin(params) {
  const adminUsername = params.adminUsername;
  const fullName = String(params.fullName || '').trim();
  const username = String(params.username || '').trim().toLowerCase();
  const email = String(params.email || '').trim().toLowerCase();
  const permissions = params.permissions || {};
  const sendTelegramLink = params.sendTelegramLink === true;
  const req = params.req;

  if (!fullName) return { success: false, error: 'missing_fullname', message: 'الاسم مطلوب' };
  if (!username) return { success: false, error: 'missing_username', message: 'اسم المستخدم مطلوب' };
  if (!/^[a-z0-9_]{3,30}$/.test(username)) {
    return { success: false, error: 'invalid_username', message: 'اسم المستخدم يجب أن يكون 3-30 حرفًا إنجليزيًا أو أرقامًا أو _' };
  }
  if (username === 'super_admin') {
    return { success: false, error: 'reserved', message: 'هذا الاسم محجوز' };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: 'invalid_email', message: 'البريد غير صحيح' };
  }
  if (!permissions || typeof permissions !== 'object') permissions = {};

  // فحص عدم التكرار
  const { data: existing } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .select('username')
    .eq('username', username)
    .maybeSingle();

  if (existing) {
    return { success: false, error: 'username_exists', message: 'اسم المستخدم موجود بالفعل' };
  }

  // توليد كلمة مرور مؤقتة
  const tempPassword = generateTempPassword();
  const hash = hashPassword(tempPassword);

  const { error } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .insert({
      username: username,
      password_hash: hash,
      full_name: fullName,
      email: email || null,
      permissions: permissions,
      created_by: adminUsername,
      created_at: nowEgypt(),
      is_active: 'نشط',
      theme_preference: 'light',
      must_change_password: 'نعم'
    });

  if (error) return { success: false, error: error.message };

  // إشعار superAdmin على تليجرام
  if (SUPER_ADMIN_CHAT_ID) {
    try {
      await sendViaTelegram(
        SUPER_ADMIN_CHAT_ID,
        '🆕 <b>تم إنشاء مسؤول جديد</b>\n\n' +
        '👤 الاسم: ' + escapeHtml(fullName) + '\n' +
        '🔑 المستخدم: <code>' + escapeHtml(username) + '</code>\n' +
        (email ? '📧 البريد: ' + escapeHtml(email) + '\n' : '') +
        '👨‍💼 أنشأه: <code>' + escapeHtml(adminUsername) + '</code>\n' +
        '🕐 ' + nowEgypt()
      );
    } catch (e) {}
  }

  // إرسال بريد ترحيب
  if (email) {
    try {
      await sendAdminWelcomeEmail(email, fullName, username, tempPassword);
    } catch (e) {}
  }

  // 🆕 إرسال كود الربط بتليجرام (اختياري)
  let telegramLinkSent = false;
  if (sendTelegramLink && email && adminUsername === 'super_admin') {
    try {
      const codeResult = await generateLinkCode(username, adminUsername);
      if (codeResult.success) {
        const emailResult = await sendAdminTelegramLinkEmail(
          email,
          fullName,
          codeResult.telegramURL,
          7
        );
        telegramLinkSent = !!(emailResult && emailResult.success);
      }
    } catch (e) {
      console.error('❌ [createAdmin] telegram link failed:', e.message);
    }
  }

  await writeAuditLog({
    username: adminUsername,
    action: 'create_admin',
    target_table: TABLES.ADMINS,
    target_id: username,
    changes: { full_name: fullName, email: email, permissions: permissions, telegram_link_sent: telegramLinkSent },
    ip_address: getClientIP(req),
    user_agent: req ? String(req.headers['user-agent'] || '').substring(0, 300) : null
  });

  return {
    success: true,
    username: username,
    tempPassword: tempPassword,
    emailSent: !!email,
    telegramLinkSent: telegramLinkSent,
    message: 'تم إنشاء المسؤول. يرجى نسخ كلمة السر المؤقتة وإرسالها إليه.'
  };
}

// ============================================================
//  ✏️ updateAdmin
// ============================================================
export async function updateAdmin(params) {
  const adminUsername = params.adminUsername;
  const username = String(params.username || '').trim().toLowerCase();
  const updates = params.updates || {};
  const req = params.req;

  if (!username) return { success: false, error: 'missing_username' };
  if (!updates || typeof updates !== 'object') return { success: false, error: 'missing_updates' };

  const { data: existing } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .select('*')
    .eq('username', username)
    .maybeSingle();

  if (!existing) return { success: false, error: 'not_found' };

  const isSelf = username === adminUsername;
  const isSuperTarget = username === 'super_admin';

  const finalUpdates = {};
  const changesLog = {};

  // full_name
  if (updates.fullName !== undefined) {
    const newName = String(updates.fullName || '').trim();
    if (newName && newName !== String(existing.full_name || '').trim()) {
      finalUpdates.full_name = newName;
      changesLog.full_name = { before: existing.full_name, after: newName };
    }
  }

  // email
  if (updates.email !== undefined) {
    const newEmail = String(updates.email || '').trim().toLowerCase();
    if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return { success: false, error: 'invalid_email', message: 'البريد غير صحيح' };
    }
    if (newEmail !== String(existing.email || '').toLowerCase()) {
      finalUpdates.email = newEmail || null;
      changesLog.email = { before: existing.email, after: newEmail };
    }
  }

  // permissions — ممنوع على self أو super_admin
  if (updates.permissions !== undefined) {
    if (isSelf) return { success: false, error: 'cannot_edit_self_permissions', message: 'لا يمكنك تعديل صلاحياتك' };
    if (isSuperTarget) return { success: false, error: 'cannot_edit_super', message: 'لا يمكن تعديل صلاحيات super_admin' };

    const newPerms = updates.permissions;
    if (newPerms && typeof newPerms === 'object') {
      const oldStr = JSON.stringify(existing.permissions || {});
      const newStr = JSON.stringify(newPerms);
      if (oldStr !== newStr) {
        finalUpdates.permissions = newPerms;
        changesLog.permissions = { changed: true };
      }
    }
  }

  if (Object.keys(finalUpdates).length === 0) {
    return { success: true, message: 'لا توجد تغييرات' };
  }

  const { error } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .update(finalUpdates)
    .eq('username', username);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'update_admin',
    target_table: TABLES.ADMINS,
    target_id: username,
    changes: changesLog,
    ip_address: getClientIP(req),
    user_agent: req ? String(req.headers['user-agent'] || '').substring(0, 300) : null
  });

  return { success: true, message: 'تم التحديث بنجاح' };
}

// ============================================================
//  🔄 toggleAdminActive
// ============================================================
export async function toggleAdminActive(params) {
  const adminUsername = params.adminUsername;
  const username = String(params.username || '').trim().toLowerCase();
  const req = params.req;

  if (!username) return { success: false, error: 'missing_username' };
  if (username === adminUsername) {
    return { success: false, error: 'cannot_disable_self', message: 'لا يمكنك تعطيل حسابك' };
  }
  if (username === 'super_admin') {
    return { success: false, error: 'cannot_disable_super', message: 'لا يمكن تعطيل super_admin' };
  }

  const { data: existing } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .select('is_active')
    .eq('username', username)
    .maybeSingle();

  if (!existing) return { success: false, error: 'not_found' };

  const current = String(existing.is_active || '').trim();
  const newStatus = current === 'نشط' ? 'غير نشط' : 'نشط';

  const { error } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .update({ is_active: newStatus })
    .eq('username', username);

  if (error) return { success: false, error: error.message };

  // إنهاء كل جلساته فورًا
  if (newStatus === 'غير نشط') {
    await supabaseAdmin
      .from(TABLES.ADMIN_SESSIONS)
      .update({ status: 'logged_out' })
      .eq('username', username)
      .in('status', ['active', 'frozen']);
  }

  await writeAuditLog({
    username: adminUsername,
    action: newStatus === 'نشط' ? 'enable_admin' : 'disable_admin',
    target_table: TABLES.ADMINS,
    target_id: username,
    changes: { is_active: { before: current, after: newStatus } },
    ip_address: getClientIP(req)
  });

  return {
    success: true,
    isActive: newStatus === 'نشط',
    message: 'تم التحديث إلى: ' + newStatus
  };
}

// ============================================================
//  🔐 resetAdminPassword
// ============================================================
export async function resetAdminPassword(params) {
  const adminUsername = params.adminUsername;
  const username = String(params.username || '').trim().toLowerCase();
  const req = params.req;

  if (!username) return { success: false, error: 'missing_username' };
  if (username === 'super_admin' && adminUsername !== 'super_admin') {
    return { success: false, error: 'forbidden', message: 'لا يمكنك تعديل super_admin' };
  }

  const { data: existing } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .select('username, full_name, email')
    .eq('username', username)
    .maybeSingle();

  if (!existing) return { success: false, error: 'not_found' };

  // كلمة مرور مؤقتة جديدة + فرض التغيير
  const tempPassword = generateTempPassword();
  const hash = hashPassword(tempPassword);

  const { error } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .update({
      password_hash: hash,
      must_change_password: 'نعم'
    })
    .eq('username', username);

  if (error) return { success: false, error: error.message };

  // إنهاء كل جلساته
  await supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .update({ status: 'logged_out' })
    .eq('username', username)
    .in('status', ['active', 'frozen']);

  // إرسال بريد
  let emailSent = false;
  if (existing.email) {
    try {
      await sendAdminWelcomeEmail(existing.email, existing.full_name || username, username, tempPassword);
      emailSent = true;
    } catch (e) {}
  }

  await writeAuditLog({
    username: adminUsername,
    action: 'reset_admin_password',
    target_table: TABLES.ADMINS,
    target_id: username,
    ip_address: getClientIP(req)
  });

  return {
    success: true,
    tempPassword: tempPassword,
    emailSent: emailSent,
    message: 'تم توليد كلمة مرور مؤقتة جديدة'
  };
}

// ============================================================
//  🗑️ hardDeleteAdmin — superAdmin فقط
// ============================================================
export async function hardDeleteAdmin(params) {
  const adminUsername = params.adminUsername;
  const username = String(params.username || '').trim().toLowerCase();
  const req = params.req;

  if (!username) return { success: false, error: 'missing_username' };
  if (adminUsername !== 'super_admin') {
    return { success: false, error: 'forbidden', message: 'الحذف النهائي للمسؤولين متاح لـ superAdmin فقط' };
  }
  if (username === 'super_admin') {
    return { success: false, error: 'cannot_delete_self', message: 'لا يمكن حذف super_admin' };
  }

  const { data: existing } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .select('username, full_name')
    .eq('username', username)
    .maybeSingle();

  if (!existing) return { success: false, error: 'not_found' };

  // حذف الجلسات أولًا
  await supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .delete()
    .eq('username', username);

  // حذف الحساب
  const { error } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .delete()
    .eq('username', username);

  if (error) return { success: false, error: error.message };

  await writeAuditLog({
    username: adminUsername,
    action: 'hard_delete_admin',
    target_table: TABLES.ADMINS,
    target_id: username,
    changes: { full_name: existing.full_name },
    ip_address: getClientIP(req)
  });

  return { success: true, message: 'تم حذف المسؤول نهائيًا' };
}

// ============================================================
//  🔗 generateAdminLinkCode — super_admin يولّد كود + يبعته بالإيميل
//  - الكود لا يظهر لـ super_admin
//  - يُلغي أي كود قديم غير مستخدم
//  - يُرسل على بريد المسؤول
// ============================================================
export async function generateAdminLinkCode(params) {
  const adminUsername = params.adminUsername;
  const username = String(params.username || '').trim().toLowerCase();
  const req = params.req;

  // 1. تحقق من الصلاحية — super_admin فقط
  if (adminUsername !== 'super_admin') {
    return {
      success: false,
      error: 'forbidden',
      message: 'هذا الإجراء متاح لـ superAdmin فقط'
    };
  }

  if (!username) {
    return { success: false, error: 'missing_username' };
  }

  if (username === 'super_admin') {
    return {
      success: false,
      error: 'cannot_link_super',
      message: 'super_admin مربوط من خلال initSuperAdmin'
    };
  }

  // 2. جيب بيانات المسؤول
  const { data: existing } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .select('username, full_name, email, is_active, telegram_chat_id')
    .eq('username', username)
    .maybeSingle();

  if (!existing) {
    return { success: false, error: 'not_found', message: 'المسؤول غير موجود' };
  }

  // 3. تحقق من الإيميل
  if (!existing.email) {
    return {
      success: false,
      error: 'no_email',
      message: 'أضف البريد الإلكتروني للمسؤول أولاً'
    };
  }

  // 4. توليد الكود (يُلغي القديم تلقائيًا)
  const codeResult = await generateLinkCode(username, adminUsername);
  if (!codeResult.success) {
    return {
      success: false,
      error: codeResult.error || 'code_generation_failed',
      message: codeResult.message || 'تعذر توليد كود الربط'
    };
  }

  // 5. إرسال البريد
  const emailResult = await sendAdminTelegramLinkEmail(
    existing.email,
    existing.full_name || username,
    codeResult.telegramURL,
    7
  );

  const emailSent = !!(emailResult && emailResult.success);

  // 6. Audit Log
  await writeAuditLog({
    username: adminUsername,
    action: 'admin_telegram_link_sent',
    target_table: TABLES.ADMINS,
    target_id: username,
    changes: {
      email_sent: emailSent,
      was_linked: !!String(existing.telegram_chat_id || '').trim()
    },
    ip_address: getClientIP(req),
    user_agent: req ? String(req.headers['user-agent'] || '').substring(0, 300) : null
  });

  // 7. رد
  return {
    success: true,
    emailSent: emailSent,
    message: emailSent
      ? '✅ تم إرسال كود الربط إلى ' + existing.email
      : '⚠️ تم توليد الكود لكن فشل إرسال البريد. حاول مرة أخرى.'
  };
}

// ============================================================
//  🛠️ Helpers
// ============================================================
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}