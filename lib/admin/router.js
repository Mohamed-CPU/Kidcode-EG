// ================================================================
//  lib/admin/router.js — الراوتر الرئيسي للوحة الأدمن
//  المرحلة 1: المصادقة، الجلسات، التعارض، تغيير كلمة السر
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { TABLES } from '../db/tables.js';
import {
  login as authLogin,
  logout as authLogout,
  hashPassword,
  verifyPassword,
  getClientIP
} from './auth.js';
import {
  verifySession,
  getSessionStatus,
  createSession,
  freezeAllActiveSessions
} from './sessions.js';
import { writeAuditLog } from './audit.js';
import { consumeLoginLink } from './login-links.js';
import {
  verifyEmergencySecret,
  consumeRecoveryCode,
  generateRecoveryCodes
} from './recovery.js';
import { getPanelStatus } from './panel-gate.js';
import {
  getMySessions,
  terminateSession,
  changeMyPassword,
  updateMyProfile,
  getMyAuditLog
} from './account.js';
import { getDashboardStats } from './dashboard.js';
import {
  getChildrenList,
  getChildDetails,
  updateChild,
  deleteChild,
  extendSubscription,
  resetChildPassword,
  bulkUpdateStatus,
  hardDeleteChild,
  uploadChildImage
} from './children.js';
import {
  getMarketersList,
  getMarketerDetails,
  updateMarketer,
  toggleMarketerActive,
  resetMarketerPassword,
  hardDeleteMarketer,
  bulkUpdateMarketers
} from './marketers.js';
// 🆕 إدارة طلبات السحب
import {
  getWithdrawalsList,
  getWithdrawalsStats,
  getWithdrawalDetails,
  updateWithdrawalStatus,
  uploadWithdrawalScreenshot
} from './withdrawals.js';
import {
  getNewsletterList,
  getSubscriberDetails,
  updateSubscriber,
  deleteSubscriber,
  bulkUpdateNewsletter,
  bulkDeleteNewsletter
} from './newsletter.js';
import {
  getScanLogsList,
  getScanLogsStats,
  deleteScanLog,
  cleanupOldScanLogs
} from './scan-logs.js';
import {
  getRecipientsCount,
  sendBulkEmail,
  sendCustomEmail,
  sendSingleEmail,
  getCampaignsList,
  getQueueStats,
  cancelCampaign,
  // ✅ جديد
  uploadEmailAsset,
  getEmailTemplatesList,
  getEmailTemplate,
  createEmailTemplateAction,
  updateEmailTemplateAction,
  deleteEmailTemplateAction
} from './emails.js';
import {
  getReportsList,
  getReportsStats,
  getReportDetails,
  updateReport,
  closeReport,
  deleteReport
} from './reports.js';
import {
  getAdminsList,
  getAdminDetails,
  createAdmin,
  updateAdmin,
  toggleAdminActive,
  resetAdminPassword,
  hardDeleteAdmin,
  generateAdminLinkCode
} from './admins.js';
import {
  getAuditLogList,
  getAuditLogStats,
  getAuditLogFilters,
  exportAuditLog
} from './audit-log.js';
import {
  generateBootstrapCode,
  buildTelegramLinkURL
} from './link-codes.js';
import { revokeChildId } from './revoke-id.js';
import { sendAdminPasswordResetEmail } from '../email/brevo.js';
import { sendViaTelegram } from '../telegram.js';
// ✅ جديد: دوال استرداد المدفوعات
import {
  refundPayment,
  getChildPaymentsWithEligibility
} from '../db/payments.js';

const SUPER_ADMIN_CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID || '';

// ============================================================
//  🕐 التوقيتات
//  ⚠️ قاعدة صارمة:
//     - أي قيمة تُخزَّن في DB (expires_at, created_at) → UTC ISO
//     - أي قيمة للعرض في تليجرام → توقيت مصر (للقراءة البشرية)
// ============================================================

// ✅ للتخزين في Supabase (timestamp with time zone)
function nowUTC() {
  return new Date().toISOString();
}

function futureUTC(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

// ✅ للعرض فقط — رسائل تليجرام
function nowEgypt() {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Africa/Cairo',
    hour12: false
  }).replace('T', ' ');
}

// ============================================================
//  🚀 handleAdmin — نقطة الدخول الموحدة
// ============================================================
export async function handleAdmin(req, res) {
  const innerAction = (req.query && req.query.innerAction)
                   || (req.body && req.body.innerAction)
                   || '';

  if (!innerAction) {
    return res.status(400).json({ success: false, error: 'missing_inner_action' });
  }

  try {
    switch (innerAction) {
      case 'login':                 return await handleLogin(req, res);
      case 'logout':                return await handleLogout(req, res);
      case 'verify':                return await handleVerify(req, res);
      case 'checkStatus':           return await handleCheckStatus(req, res);
      case 'updateTheme':           return await handleUpdateTheme(req, res);
      case 'requestPasswordChange': return await handleRequestPasswordChange(req, res);
      case 'changePasswordWithToken': return await handleChangePasswordWithToken(req, res);
      case 'iDidntRequest':         return await handleIDidntRequest(req, res);
      case 'initSuperAdmin':        return await handleInitSuperAdmin(req, res);
      case 'consumeLoginLink':      return await handleConsumeLoginLink(req, res);
      case 'emergencyUnlock':       return await handleEmergencyUnlock(req, res);
      case 'generateRecoveryCodes': return await handleGenerateRecoveryCodes(req, res);
      case 'getPanelStatus':        return await handleGetPanelStatus(req, res);

      // ✅ جديد — إدارة الحساب الشخصي
      case 'getMySessions':         return await handleGetMySessions(req, res);
      case 'terminateSession':      return await handleTerminateSession(req, res);
      case 'changeMyPassword':      return await handleChangeMyPassword(req, res);
      case 'updateMyProfile':       return await handleUpdateMyProfile(req, res);
      case 'getMyAuditLog':         return await handleGetMyAuditLog(req, res);
      case 'getDashboardStats':     return await handleGetDashboardStats(req, res);

      case 'getChildrenList':       return await handleGetChildrenList(req, res);
      case 'getChildDetails':       return await handleGetChildDetails(req, res);
      case 'updateChild':           return await handleUpdateChild(req, res);
      case 'deleteChild':           return await handleDeleteChild(req, res);
      case 'extendSubscription':    return await handleExtendSubscription(req, res);
      case 'resetChildPassword':    return await handleResetChildPassword(req, res);
      case 'bulkUpdateStatus':      return await handleBulkUpdateStatus(req, res);
      case 'hardDeleteChild':       return await handleHardDeleteChild(req, res);
      case 'uploadChildImage':      return await handleUploadChildImage(req, res);

      case 'revokeChildId':         return await handleRevokeChildId(req, res);
      case 'getChildPayments':      return await handleGetChildPayments(req, res);
      case 'refundChildPayment':    return await handleRefundChildPayment(req, res);
      case 'getMarketersList':      return await handleGetMarketersList(req, res);
      case 'getMarketerDetails':    return await handleGetMarketerDetails(req, res);
      case 'updateMarketer':        return await handleUpdateMarketer(req, res);
      case 'toggleMarketerActive':  return await handleToggleMarketerActive(req, res);
      case 'resetMarketerPassword': return await handleResetMarketerPassword(req, res);
      case 'hardDeleteMarketer':    return await handleHardDeleteMarketer(req, res);
      case 'bulkUpdateMarketers':   return await handleBulkUpdateMarketers(req, res);

      // 🆕 طلبات السحب
      case 'getWithdrawalsList':         return await handleGetWithdrawalsList(req, res);
      case 'getWithdrawalsStats':        return await handleGetWithdrawalsStats(req, res);
      case 'getWithdrawalDetails':       return await handleGetWithdrawalDetails(req, res);
      case 'updateWithdrawalStatus':     return await handleUpdateWithdrawalStatus(req, res);
      case 'uploadWithdrawalScreenshot': return await handleUploadWithdrawalScreenshot(req, res);

      case 'getNewsletterList':      return await handleGetNewsletterList(req, res);
      case 'getSubscriberDetails':   return await handleGetSubscriberDetails(req, res);
      case 'updateSubscriber':       return await handleUpdateSubscriber(req, res);
      case 'deleteSubscriber':       return await handleDeleteSubscriber(req, res);
      case 'bulkUpdateNewsletter':   return await handleBulkUpdateNewsletter(req, res);
      case 'bulkDeleteNewsletter':   return await handleBulkDeleteNewsletter(req, res);

      case 'getScanLogsList':        return await handleGetScanLogsList(req, res);
      case 'getScanLogsStats':       return await handleGetScanLogsStats(req, res);
      case 'deleteScanLog':          return await handleDeleteScanLog(req, res);
      case 'cleanupOldScanLogs':     return await handleCleanupOldScanLogs(req, res);

      case 'getRecipientsCount':     return await handleGetRecipientsCount(req, res);
      case 'sendBulkEmail':          return await handleSendBulkEmail(req, res);
      case 'sendCustomEmail':        return await handleSendCustomEmail(req, res);
      case 'sendSingleEmail':        return await handleSendSingleEmail(req, res);
      case 'getCampaignsList':       return await handleGetCampaignsList(req, res);
      case 'getQueueStats':          return await handleGetQueueStats(req, res);
      case 'cancelCampaign':         return await handleCancelCampaign(req, res);

      // ✅ جديد: المرفقات + القوالب
      case 'uploadEmailAsset':       return await handleUploadEmailAsset(req, res);
      case 'getEmailTemplatesList':  return await handleGetEmailTemplatesList(req, res);
      case 'getEmailTemplate':       return await handleGetEmailTemplate(req, res);
      case 'createEmailTemplate':    return await handleCreateEmailTemplate(req, res);
      case 'updateEmailTemplate':    return await handleUpdateEmailTemplate(req, res);
      case 'deleteEmailTemplate':    return await handleDeleteEmailTemplate(req, res);

      case 'getReportsList':         return await handleGetReportsList(req, res);
      case 'getReportsStats':        return await handleGetReportsStats(req, res);
      case 'getReportDetails':       return await handleGetReportDetails(req, res);
      case 'updateReport':           return await handleUpdateReport(req, res);
      case 'closeReport':            return await handleCloseReport(req, res);
      case 'deleteReport':           return await handleDeleteReport(req, res);

      case 'getAdminsList':          return await handleGetAdminsList(req, res);
      case 'getAdminDetails':        return await handleGetAdminDetails(req, res);
      case 'createAdmin':            return await handleCreateAdmin(req, res);
      case 'updateAdmin':            return await handleUpdateAdmin(req, res);
      case 'toggleAdminActive':      return await handleToggleAdminActive(req, res);
      case 'resetAdminPassword':     return await handleResetAdminPassword(req, res);
      case 'hardDeleteAdmin':       return await handleHardDeleteAdmin(req, res);
      case 'generateAdminLinkCode': return await handleGenerateAdminLinkCode(req, res);
      case 'completeFirstLoginPasswordChange': return await handleCompleteFirstLogin(req, res);

      case 'getAuditLogList':       return await handleGetAuditLogList(req, res);
      case 'getAuditLogStats':      return await handleGetAuditLogStats(req, res);
      case 'getAuditLogFilters':    return await handleGetAuditLogFilters(req, res);
      case 'exportAuditLog':        return await handleExportAuditLog(req, res);

      default:
        return res.status(400).json({
          success: false,
          error: 'unknown_inner_action',
          message: 'إجراء غير معروف'
        });
    }
  } catch (e) {
    console.error('[admin router] exception:', e.message);
    return res.status(500).json({
      success: false,
      error: 'admin_router_error',
      message: 'حدث خطأ غير متوقع'
    });
  }
}

// ============================================================
//  🔑 استخراج sessionToken من الطلب
// ============================================================
function extractSessionToken(req) {
  // 1. من الـ Header
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  // 2. من الـ body
  if (req.body && req.body.sessionToken) {
    return String(req.body.sessionToken).trim();
  }
  // 3. من الـ query
  if (req.query && req.query.sessionToken) {
    return String(req.query.sessionToken).trim();
  }
  return '';
}

// ============================================================
//  📌 login
// ============================================================
async function handleLogin(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const body = req.body || {};
  const result = await authLogin({
    username: body.username,
    password: body.password
  }, req);

  if (result.success) {
    return res.status(200).json(result);
  }

  // إرجاع 401 للحالات التي هي "بيانات خاطئة"
  const status = result.error === 'invalid_credentials' ? 401 : 400;
  return res.status(status).json(result);
}

// ============================================================
//  🚪 logout
// ============================================================
async function handleLogout(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const sessionToken = extractSessionToken(req);
  if (!sessionToken) {
    return res.status(400).json({ success: false, error: 'missing_session' });
  }

  const verified = await verifySession(sessionToken);
  const username = verified.session?.username || '';

  const result = await authLogout(sessionToken, username, req);
  return res.status(200).json(result);
}

// ============================================================
//  ✅ verify — التحقق من الجلسة
// ============================================================
async function handleVerify(req, res) {
  const sessionToken = extractSessionToken(req);
  if (!sessionToken) {
    return res.status(401).json({ valid: false, error: 'missing_session' });
  }

  const result = await verifySession(sessionToken);
  return res.status(200).json(result);
}

// ============================================================
//  🔄 checkStatus — فحص الحالة فقط (للـ Polling كل 5 ثوان)
// ============================================================
async function handleCheckStatus(req, res) {
  const sessionToken = extractSessionToken(req);
  if (!sessionToken) {
    return res.status(200).json({ status: 'invalid' });
  }

  const result = await getSessionStatus(sessionToken);
  return res.status(200).json(result);
}

// ============================================================
//  🔑 requestPasswordChange — طلب تغيير كلمة السر من حالة التجميد
// ============================================================
async function handleRequestPasswordChange(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const sessionToken = extractSessionToken(req);
  if (!sessionToken) {
    return res.status(400).json({ success: false, error: 'missing_session' });
  }

  // 1. تحقق من الجلسة
  const verified = await verifySession(sessionToken);
  if (!verified.valid) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const username = verified.session.username;
  const ipAddress = getClientIP(req);

  // 2. جيب بيانات الأدمن (للبريد)
  const { data: admin } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .select('username, full_name, email')
    .eq('username', username)
    .maybeSingle();

  // ملاحظة: نحتاج جدول AdminAccounts فيه عمود email
  // إذا لم يكن موجودًا، سنستخدم بريد الأدمن العام (config)

  const adminEmail = admin?.email || process.env.ADMIN_EMAIL || 'info@kidcode-eg.com';

  // 3. ولّد reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = futureUTC(15);

  await supabaseAdmin
    .from(TABLES.ADMIN_PASSWORD_RESETS)
    .insert({
      token: resetToken,
      username: username,
      session_token: sessionToken,
      created_at: nowUTC(),
      expires_at: expiresAt,
      used: 'لا',
      ip_address: ipAddress
    });

  // 4. ابعت البريد
  const resetLink = 'https://www.kidcode-eg.com/admin/reset-password.html?token=' + resetToken;

  try {
    await sendAdminPasswordResetEmail(adminEmail, admin?.full_name || username, resetLink);
  } catch (e) {
    // نسجّل الخطأ لكن لا نوقف
  }

  await writeAuditLog({
    username: username,
    action: 'password_change_requested_from_frozen',
    ip_address: ipAddress,
    user_agent: String(req.headers['user-agent'] || '').substring(0, 300)
  });

  return res.status(200).json({
    success: true,
    message: 'تم إرسال رابط تغيير كلمة السر إلى بريدك الإلكتروني. الرابط صالح 15 دقيقة.'
  });
}

// ============================================================
//  🔐 changePasswordWithToken — تغيير كلمة السر بالتوكن
// ============================================================
async function handleChangePasswordWithToken(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const body = req.body || {};
  const token = String(body.token || '').trim();
  const newPassword = String(body.newPassword || '').trim();

  if (!token || !newPassword) {
    return res.status(400).json({ success: false, error: 'missing_params' });
  }

  // فحص قوة كلمة السر
  const strength = validateAdminPassword(newPassword);
  if (!strength.valid) {
    return res.status(400).json({
      success: false,
      error: 'weak_password',
      message: strength.errors.join(' | ')
    });
  }

  // 1. اقرأ التوكن
  const { data: reset } = await supabaseAdmin
    .from(TABLES.ADMIN_PASSWORD_RESETS)
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (!reset) {
    return res.status(400).json({ success: false, error: 'invalid_token', message: 'الرابط غير صحيح' });
  }

  if (String(reset.used || '') === 'نعم') {
    return res.status(400).json({ success: false, error: 'used_token', message: 'الرابط مستخدم بالفعل' });
  }

  // 2. فحص الانتهاء
  const expiresMs = new Date(reset.expires_at).getTime();
  if (isNaN(expiresMs) || Date.now() >= expiresMs) {
    return res.status(400).json({ success: false, error: 'expired_token', message: 'انتهت صلاحية الرابط' });
  }

  // 3. حدّث كلمة السر
  const newHash = hashPassword(newPassword);
  await supabaseAdmin
    .from(TABLES.ADMINS)
    .update({ password_hash: newHash })
    .eq('username', reset.username);

  // 4. علّم التوكن كمستخدم
  await supabaseAdmin
    .from(TABLES.ADMIN_PASSWORD_RESETS)
    .update({ used: 'نعم' })
    .eq('token', token);

  // 5. أنهِ كل الجلسات
  await supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .update({ status: 'logged_out' })
    .eq('username', reset.username)
    .in('status', ['active', 'frozen']);

  // 6. Audit log
  await writeAuditLog({
    username: reset.username,
    action: 'password_changed_via_token',
    ip_address: getClientIP(req)
  });

  // 7. إشعار superAdmin
  await notifySuperAdmin(
    `🔑 <b>تغيير كلمة السر</b>\n\n` +
    `الحساب: <code>${reset.username}</code>\n` +
    `الطريقة: رابط بريد إلكتروني\n` +
    `الوقت: ${nowEgypt()}`
  );

  return res.status(200).json({
    success: true,
    message: 'تم تغيير كلمة السر بنجاح. يمكنك تسجيل الدخول الآن.'
  });
}

// ============================================================
//  🚫 iDidntRequest — لم أطلب هذا
// ============================================================
async function handleIDidntRequest(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const body = req.body || {};
  const token = String(body.token || '').trim();

  if (!token) {
    return res.status(400).json({ success: false, error: 'missing_token' });
  }

  // 1. اقرأ التوكن
  const { data: reset } = await supabaseAdmin
    .from(TABLES.ADMIN_PASSWORD_RESETS)
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (!reset) {
    return res.status(400).json({ success: false, error: 'invalid_token' });
  }

  const username = reset.username;

  // 2. عطّل الحساب
  await supabaseAdmin
    .from(TABLES.ADMINS)
    .update({ is_active: 'غير نشط' })
    .eq('username', username);

  // 3. أنهِ كل الجلسات
  await supabaseAdmin
    .from(TABLES.ADMIN_SESSIONS)
    .update({ status: 'logged_out' })
    .eq('username', username)
    .in('status', ['active', 'frozen']);

  // 4. علّم التوكن
  await supabaseAdmin
    .from(TABLES.ADMIN_PASSWORD_RESETS)
    .update({ used: 'نعم' })
    .eq('token', token);

  // 5. Audit
  await writeAuditLog({
    username: username,
    action: 'i_didnt_request_triggered',
    ip_address: getClientIP(req)
  });

  // 6. إشعار superAdmin
  await notifySuperAdmin(
    `🚨 <b>تنبيه أمني عاجل</b>\n\n` +
    `الحساب: <code>${username}</code>\n` +
    `اضغط "لم أطلب هذا" → تم تعطيل الحساب فورًا\n` +
    `الوقت: ${nowEgypt()}`
  );

  return res.status(200).json({
    success: true,
    message: 'تم تعطيل الحساب. تواصل مع superAdmin.'
  });
}

// ============================================================
//  🆕 initSuperAdmin — إنشاء super_admin (مرة واحدة فقط)
// ============================================================
async function handleInitSuperAdmin(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  // 1. تحقق أن الجدول فارغ
  const { data: existing } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .select('username')
    .limit(1);

  if (existing && existing.length > 0) {
    return res.status(403).json({
      success: false,
      error: 'already_initialized',
      message: 'النظام مُهيَّأ مسبقًا'
    });
  }

  // 2. تحقق من CRON_SECRET
  const body = req.body || {};
  const secret = String(body.secret || '').trim();
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  // 3. أنشئ super_admin
  const username = 'super_admin';
  const password = String(body.password || '').trim();

  const strength = validateAdminPassword(password);
  if (!strength.valid) {
    return res.status(400).json({
      success: false,
      error: 'weak_password',
      message: strength.errors.join(' | ')
    });
  }

  const hash = hashPassword(password);

  await supabaseAdmin
    .from(TABLES.ADMINS)
    .insert({
      username: username,
      password_hash: hash,
      full_name: 'المدير العام',
      permissions: {},
      theme_preference: 'light',
      created_by: 'system',
      created_at: nowUTC(),
      is_active: 'نشط'
    });

  // 🆘 توليد Bootstrap Code للربط الأول بتليجرام
  const bootstrap = await generateBootstrapCode();

  await writeAuditLog({
    username: 'system',
    action: 'super_admin_created',
    ip_address: getClientIP(req)
  });

  if (bootstrap && bootstrap.success) {
    await writeAuditLog({
      username: 'system',
      action: 'bootstrap_code_generated',
      target_table: TABLES.ADMINS,
      target_id: username
    });
  }

  return res.status(200).json({
    success: true,
    message: 'تم إنشاء super_admin بنجاح',
    bootstrapCode: bootstrap && bootstrap.success ? bootstrap.code : null,
    bootstrapExpiresAt: bootstrap && bootstrap.success ? bootstrap.expiresAt : null,
    botLink: bootstrap && bootstrap.success
      ? buildTelegramLinkURL(bootstrap.code)
      : null,
    warning: '⚠️ احفظ Bootstrap Code الآن — لن يظهر مرة أخرى.'
  });
}

// ============================================================
//  🔐 validateAdminPassword — قوة كلمة السر
// ============================================================
function validateAdminPassword(password) {
  const errors = [];
  if (!password || password.length < 10) errors.push('10 أحرف على الأقل');
  if (!/[A-Z]/.test(password)) errors.push('حرف كبير واحد على الأقل');
  if (!/[a-z]/.test(password)) errors.push('حرف صغير واحد على الأقل');
  if (!/[0-9]/.test(password)) errors.push('رقم واحد على الأقل');
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) errors.push('رمز خاص واحد');
  if (/[\u0600-\u06FF]/.test(password)) errors.push('بدون حروف عربية');
  return { valid: errors.length === 0, errors };
}

// ============================================================
//  📢 notifySuperAdmin — إشعار على تليجرام
// ============================================================
async function notifySuperAdmin(text) {
  if (!SUPER_ADMIN_CHAT_ID) return;
  try {
    await sendViaTelegram(SUPER_ADMIN_CHAT_ID, text);
  } catch (e) {}
}

// ============================================================
//  🎨 handleUpdateTheme — حفظ تفضيل الثيم
// ============================================================
async function handleUpdateTheme(req, res) {
  const sessionToken = extractSessionToken(req);
  const verified = await verifySession(sessionToken);
  if (!verified.valid) return res.status(401).json({ success: false, error: 'invalid_session' });

  const theme = String((req.body && req.body.theme) || 'light').trim();
  if (theme !== 'light' && theme !== 'dark') {
    return res.status(400).json({ success: false, error: 'invalid_theme' });
  }

  await supabaseAdmin
    .from(TABLES.ADMINS)
    .update({ theme_preference: theme })
    .eq('username', verified.session.username);

  return res.status(200).json({ success: true, theme: theme });
}

// ============================================================
//  📊 getMySessions
// ============================================================
async function handleGetMySessions(req, res) {
  const sessionToken = extractSessionToken(req);
  const verified = await verifySession(sessionToken);
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const result = await getMySessions(verified.session.username, sessionToken);
  return res.status(200).json(result);
}

// ============================================================
//  🚪 terminateSession
// ============================================================
async function handleTerminateSession(req, res) {
  const sessionToken = extractSessionToken(req);
  const verified = await verifySession(sessionToken);
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const body = req.body || {};
  const result = await terminateSession(
    verified.session.username,
    body.targetIp,
    body.targetUA,
    sessionToken
  );

  if (result.success) {
    await writeAuditLog({
      username: verified.session.username,
      action: 'session_terminated',
      changes: { target_ip: body.targetIp, target_ua: body.targetUA },
      ip_address: getClientIP(req),
      user_agent: String(req.headers['user-agent'] || '').substring(0, 300)
    });
  }

  return res.status(200).json(result);
}

// ============================================================
//  🔐 changeMyPassword
// ============================================================
async function handleChangeMyPassword(req, res) {
  const sessionToken = extractSessionToken(req);
  const verified = await verifySession(sessionToken);
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const body = req.body || {};
  const result = await changeMyPassword({
    username: verified.session.username,
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
    currentSessionToken: sessionToken,
    req
  });

  return res.status(200).json(result);
}

// ============================================================
//  👤 updateMyProfile
// ============================================================
async function handleUpdateMyProfile(req, res) {
  const sessionToken = extractSessionToken(req);
  const verified = await verifySession(sessionToken);
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const body = req.body || {};
  const result = await updateMyProfile({
    username: verified.session.username,
    fullName: body.fullName,
    req
  });

  return res.status(200).json(result);
}

// ============================================================
//  📋 getMyAuditLog
// ============================================================
async function handleGetMyAuditLog(req, res) {
  const sessionToken = extractSessionToken(req);
  const verified = await verifySession(sessionToken);
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const limit = (req.query && req.query.limit) || 20;
  const result = await getMyAuditLog(verified.session.username, limit);
  return res.status(200).json(result);
}

// ============================================================
//  📊 getDashboardStats
// ============================================================
async function handleGetDashboardStats(req, res) {
  const sessionToken = extractSessionToken(req);
  const verified = await verifySession(sessionToken);

  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const result = await getDashboardStats();
  return res.status(200).json(result);
}

// ============================================================
//  📋 getChildrenList
// ============================================================
async function handleGetChildrenList(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  // الصلاحية
  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.children && perms.children.view)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const q = req.query || {};
  const result = await getChildrenList({
    page: q.page,
    pageSize: q.pageSize,
    search: q.search,
    status: q.status,
    plan: q.plan,
    sortBy: q.sortBy,
    sortDir: q.sortDir
  });

  return res.status(200).json(result);
}

// ============================================================
//  👶 getChildDetails
// ============================================================
async function handleGetChildDetails(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const childID = (req.query && req.query.childID) || (req.body && req.body.childID);
  const result = await getChildDetails(childID);
  return res.status(200).json(result);
}

// ============================================================
//  ✏️ updateChild
// ============================================================
async function handleUpdateChild(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.children && perms.children.edit)) {
    return res.status(403).json({ success: false, error: 'forbidden', message: 'لا تملك صلاحية التعديل' });
  }

  const body = req.body || {};
  const result = await updateChild({
    childID: body.childID,
    updates: body.updates,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  🗑️ deleteChild
// ============================================================
async function handleDeleteChild(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.children && perms.children.delete)) {
    return res.status(403).json({ success: false, error: 'forbidden', message: 'لا تملك صلاحية الحذف' });
  }

  const body = req.body || {};
  const result = await deleteChild({
    childID: body.childID,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  📅 extendSubscription
// ============================================================
async function handleExtendSubscription(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.children && perms.children.edit)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await extendSubscription({
    childID: body.childID,
    months: body.months,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  🔐 resetChildPassword
// ============================================================
async function handleResetChildPassword(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.children && perms.children.edit)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await resetChildPassword({
    childID: body.childID,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  🔄 bulkUpdateStatus
// ============================================================
async function handleBulkUpdateStatus(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.children && perms.children.edit)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await bulkUpdateStatus({
    childIDs: body.childIDs,
    status: body.status,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  🔥 hardDeleteChild
// ============================================================
async function handleHardDeleteChild(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.children && perms.children.delete)) {
    return res.status(403).json({ success: false, error: 'forbidden', message: 'لا تملك صلاحية الحذف' });
  }

  const body = req.body || {};
  const result = await hardDeleteChild({
    childID: body.childID,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  🖼️ uploadChildImage
// ============================================================
async function handleUploadChildImage(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.children && perms.children.edit)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await uploadChildImage({
    childID: body.childID,
    imageBase64: body.imageBase64,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  📋 getMarketersList
// ============================================================
async function handleGetMarketersList(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.marketers && perms.marketers.view)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const q = req.query || {};
  const result = await getMarketersList({
    page: q.page,
    pageSize: q.pageSize,
    search: q.search,
    status: q.status,
    sortBy: q.sortBy,
    sortDir: q.sortDir
  });

  return res.status(200).json(result);
}

// ============================================================
//  🧑‍💼 getMarketerDetails
// ============================================================
async function handleGetMarketerDetails(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const code = (req.query && req.query.code) || (req.body && req.body.code);
  const result = await getMarketerDetails(code);
  return res.status(200).json(result);
}

// ============================================================
//  ✏️ updateMarketer
// ============================================================
async function handleUpdateMarketer(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.marketers && perms.marketers.edit)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await updateMarketer({
    marketerCode: body.marketerCode,
    updates: body.updates,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  🔄 toggleMarketerActive
// ============================================================
async function handleToggleMarketerActive(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.marketers && perms.marketers.edit)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await toggleMarketerActive({
    marketerCode: body.marketerCode,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  🔐 resetMarketerPassword
// ============================================================
async function handleResetMarketerPassword(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.marketers && perms.marketers.edit)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await resetMarketerPassword({
    marketerCode: body.marketerCode,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  🗑️ hardDeleteMarketer
// ============================================================
async function handleHardDeleteMarketer(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.marketers && perms.marketers.delete)) {
    return res.status(403).json({ success: false, error: 'forbidden', message: 'لا تملك صلاحية الحذف' });
  }

  const body = req.body || {};
  const result = await hardDeleteMarketer({
    marketerCode: body.marketerCode,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  🔄 bulkUpdateMarketers
// ============================================================
async function handleBulkUpdateMarketers(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.marketers && perms.marketers.edit)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await bulkUpdateMarketers({
    codes: body.codes,
    status: body.status,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  📋 getNewsletterList
// ============================================================
async function handleGetNewsletterList(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.newsletter && perms.newsletter.view)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const q = req.query || {};
  const result = await getNewsletterList({
    page: q.page,
    pageSize: q.pageSize,
    search: q.search,
    status: q.status,
    sortBy: q.sortBy,
    sortDir: q.sortDir
  });

  return res.status(200).json(result);
}

// ============================================================
//  👤 getSubscriberDetails
// ============================================================
async function handleGetSubscriberDetails(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const id = (req.query && req.query.id) || (req.body && req.body.id);
  const result = await getSubscriberDetails(id);
  return res.status(200).json(result);
}

// ============================================================
//  ✏️ updateSubscriber
// ============================================================
async function handleUpdateSubscriber(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.newsletter && perms.newsletter.edit)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await updateSubscriber({
    id: body.id,
    updates: body.updates,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  🗑️ deleteSubscriber
// ============================================================
async function handleDeleteSubscriber(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.newsletter && perms.newsletter.delete)) {
    return res.status(403).json({ success: false, error: 'forbidden', message: 'لا تملك صلاحية الحذف' });
  }

  const body = req.body || {};
  const result = await deleteSubscriber({
    id: body.id,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  🔄 bulkUpdateNewsletter
// ============================================================
async function handleBulkUpdateNewsletter(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.newsletter && perms.newsletter.edit)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await bulkUpdateNewsletter({
    ids: body.ids,
    status: body.status,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  🗑️ bulkDeleteNewsletter
// ============================================================
async function handleBulkDeleteNewsletter(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.newsletter && perms.newsletter.delete)) {
    return res.status(403).json({ success: false, error: 'forbidden', message: 'لا تملك صلاحية الحذف' });
  }

  const body = req.body || {};
  const result = await bulkDeleteNewsletter({
    ids: body.ids,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  📋 getScanLogsList
// ============================================================
async function handleGetScanLogsList(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.scan_logs && perms.scan_logs.view)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const q = req.query || {};
  const result = await getScanLogsList({
    page: q.page,
    pageSize: q.pageSize,
    search: q.search,
    childID: q.childID,
    source: q.source,
    fromDate: q.fromDate,
    toDate: q.toDate,
    sortDir: q.sortDir
  });

  return res.status(200).json(result);
}

// ============================================================
//  📊 getScanLogsStats
// ============================================================
async function handleGetScanLogsStats(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const result = await getScanLogsStats();
  return res.status(200).json(result);
}

// ============================================================
//  🗑️ deleteScanLog
// ============================================================
async function handleDeleteScanLog(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.scan_logs && perms.scan_logs.delete)) {
    return res.status(403).json({ success: false, error: 'forbidden', message: 'لا تملك صلاحية الحذف' });
  }

  const body = req.body || {};
  const result = await deleteScanLog({
    id: body.id,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  🧹 cleanupOldScanLogs
// ============================================================
async function handleCleanupOldScanLogs(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.scan_logs && perms.scan_logs.delete)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await cleanupOldScanLogs({
    months: body.months,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  📊 getRecipientsCount
// ============================================================
async function handleGetRecipientsCount(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const body = req.body || {};
  const result = await getRecipientsCount({
    type: body.type,
    filter: body.filter
  });
  return res.status(200).json(result);
}

// ============================================================
//  📤 sendBulkEmail
// ============================================================
async function handleSendBulkEmail(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.emails && perms.emails.send_bulk)) {
    return res.status(403).json({ success: false, error: 'forbidden', message: 'لا تملك صلاحية الإرسال الجماعي' });
  }

  const body = req.body || {};
  const result = await sendBulkEmail({
    type: body.type,
    filter: body.filter,
    subject: body.subject,
    bodyHtml: body.bodyHtml,
    adminUsername: verified.session.username,
    req: req
  });
  return res.status(200).json(result);
}

// ============================================================
//  📧 sendCustomEmail
// ============================================================
async function handleSendCustomEmail(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.emails && perms.emails.send_bulk)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await sendCustomEmail({
    emails: body.emails,
    subject: body.subject,
    bodyHtml: body.bodyHtml,
    adminUsername: verified.session.username,
    req: req
  });
  return res.status(200).json(result);
}

// ============================================================
//  🎯 sendSingleEmail
// ============================================================
async function handleSendSingleEmail(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.emails && perms.emails.send_individual)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await sendSingleEmail({
    type: body.type,
    identifier: body.identifier,
    subject: body.subject,
    bodyHtml: body.bodyHtml,
    adminUsername: verified.session.username,
    req: req
  });
  return res.status(200).json(result);
}

// ============================================================
//  📋 getCampaignsList
// ============================================================
async function handleGetCampaignsList(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const q = req.query || {};
  const result = await getCampaignsList({
    page: q.page,
    pageSize: q.pageSize
  });
  return res.status(200).json(result);
}

// ============================================================
//  📊 getQueueStats
// ============================================================
async function handleGetQueueStats(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const result = await getQueueStats();
  return res.status(200).json(result);
}

// ============================================================
//  🚫 cancelCampaign
// ============================================================
async function handleCancelCampaign(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const body = req.body || {};
  const result = await cancelCampaign({
    id: body.id,
    adminUsername: verified.session.username,
    req: req
  });
  return res.status(200).json(result);
}

// ============================================================
//  📋 getReportsList
// ============================================================
async function handleGetReportsList(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.reports && perms.reports.view)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const q = req.query || {};
  const result = await getReportsList({
    page: q.page,
    pageSize: q.pageSize,
    search: q.search,
    status: q.status,
    sortDir: q.sortDir
  });

  return res.status(200).json(result);
}

// ============================================================
//  📊 getReportsStats
// ============================================================
async function handleGetReportsStats(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const result = await getReportsStats();
  return res.status(200).json(result);
}

// ============================================================
//  🔍 getReportDetails
// ============================================================
async function handleGetReportDetails(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const reportID = (req.query && req.query.reportID) || (req.body && req.body.reportID);
  const result = await getReportDetails(reportID);
  return res.status(200).json(result);
}

// ============================================================
//  ✏️ updateReport
// ============================================================
async function handleUpdateReport(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.reports && perms.reports.edit)) {
    return res.status(403).json({ success: false, error: 'forbidden', message: 'لا تملك صلاحية التعديل' });
  }

  const body = req.body || {};
  const result = await updateReport({
    reportID: body.reportID,
    updates: body.updates,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  ✅ closeReport
// ============================================================
async function handleCloseReport(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.reports && perms.reports.close)) {
    return res.status(403).json({ success: false, error: 'forbidden', message: 'لا تملك صلاحية الإغلاق' });
  }

  const body = req.body || {};
  const result = await closeReport({
    reportID: body.reportID,
    note: body.note,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  🗑️ deleteReport
// ============================================================
async function handleDeleteReport(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.reports && perms.reports.close)) {
    return res.status(403).json({ success: false, error: 'forbidden', message: 'لا تملك صلاحية الحذف' });
  }

  const body = req.body || {};
  const result = await deleteReport({
    reportID: body.reportID,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  📋 getAdminsList
// ============================================================
async function handleGetAdminsList(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.admins && perms.admins.view)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const result = await getAdminsList();
  return res.status(200).json(result);
}

// ============================================================
//  🔍 getAdminDetails
// ============================================================
async function handleGetAdminDetails(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const username = (req.query && req.query.username) || (req.body && req.body.username);
  const result = await getAdminDetails(username);
  return res.status(200).json(result);
}

// ============================================================
//  🆕 createAdmin
// ============================================================
async function handleCreateAdmin(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.admins && perms.admins.create)) {
    return res.status(403).json({ success: false, error: 'forbidden', message: 'لا تملك صلاحية الإنشاء' });
  }

  const body = req.body || {};
  const result = await createAdmin({
    adminUsername: verified.session.username,
    fullName: body.fullName,
    username: body.username,
    email: body.email,
    permissions: body.permissions,
    req: req
  });
  return res.status(200).json(result);
}

// ============================================================
//  ✏️ updateAdmin
// ============================================================
async function handleUpdateAdmin(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.admins && perms.admins.edit)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await updateAdmin({
    adminUsername: verified.session.username,
    username: body.username,
    updates: body.updates,
    req: req
  });
  return res.status(200).json(result);
}

// ============================================================
//  🔄 toggleAdminActive
// ============================================================
async function handleToggleAdminActive(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.admins && perms.admins.edit)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await toggleAdminActive({
    adminUsername: verified.session.username,
    username: body.username,
    req: req
  });
  return res.status(200).json(result);
}

// ============================================================
//  🔐 resetAdminPassword
// ============================================================
async function handleResetAdminPassword(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.admins && perms.admins.edit)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await resetAdminPassword({
    adminUsername: verified.session.username,
    username: body.username,
    req: req
  });
  return res.status(200).json(result);
}

// ============================================================
//  🗑️ hardDeleteAdmin
// ============================================================
async function handleHardDeleteAdmin(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  if (!verified.user || !verified.user.isSuperAdmin) {
    return res.status(403).json({ success: false, error: 'forbidden', message: 'superAdmin فقط' });
  }

  const body = req.body || {};
  const result = await hardDeleteAdmin({
    adminUsername: verified.session.username,
    username: body.username,
    req: req
  });
  return res.status(200).json(result);
}

// ============================================================
//  🔐 completeFirstLoginPasswordChange
// ============================================================
async function handleCompleteFirstLogin(req, res) {
  const sessionToken = extractSessionToken(req);
  const verified = await verifySession(sessionToken);
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const body = req.body || {};
  const newPassword = String(body.newPassword || '').trim();

  // فحص قوة كلمة السر
  const strength = validateAdminPassword(newPassword);
  if (!strength.valid) {
    return res.status(400).json({
      success: false,
      error: 'weak_password',
      message: strength.errors.join(' | ')
    });
  }

  // فحص أن المستخدم في حالة must_change_password
  const { data: admin } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .select('must_change_password')
    .eq('username', verified.session.username)
    .maybeSingle();

  if (!admin) {
    return res.status(404).json({ success: false, error: 'not_found' });
  }

  if (String(admin.must_change_password || '').trim() !== 'نعم') {
    return res.status(400).json({
      success: false,
      error: 'not_required',
      message: 'لا حاجة لتغيير كلمة السر'
    });
  }

  const { hashPassword } = await import('./auth.js');
  const newHash = hashPassword(newPassword);

  const { error } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .update({
      password_hash: newHash,
      must_change_password: 'لا'
    })
    .eq('username', verified.session.username);

  if (error) return res.status(500).json({ success: false, error: error.message });

  await writeAuditLog({
    username: verified.session.username,
    action: 'first_login_password_changed',
    target_table: TABLES.ADMINS,
    target_id: verified.session.username,
    ip_address: getClientIP(req)
  });

  return res.status(200).json({
    success: true,
    message: 'تم تعيين كلمة السر الجديدة بنجاح'
  });
}

// ============================================================
//  📋 getAuditLogList
// ============================================================
async function handleGetAuditLogList(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }
  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.audit_log && perms.audit_log.view)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }
  const q = req.query || {};
  const result = await getAuditLogList({
    page: q.page,
    pageSize: q.pageSize,
    search: q.search,
    username: q.username,
    action: q.actionFilter,
    targetTable: q.targetTable,
    fromDate: q.fromDate,
    toDate: q.toDate,
    sortDir: q.sortDir
  });
  return res.status(200).json(result);
}

// ============================================================
//  📊 getAuditLogStats
// ============================================================
async function handleGetAuditLogStats(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const result = await getAuditLogStats();
  return res.status(200).json(result);
}

// ============================================================
//  🎯 getAuditLogFilters
// ============================================================
async function handleGetAuditLogFilters(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const result = await getAuditLogFilters();
  return res.status(200).json(result);
}

// ============================================================
//  📤 exportAuditLog
// ============================================================
async function handleExportAuditLog(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.audit_log && perms.audit_log.view)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await exportAuditLog({
    search: body.search,
    username: body.username,
    action: body.actionFilter,
    targetTable: body.targetTable,
    fromDate: body.fromDate,
    toDate: body.toDate
  });

  return res.status(200).json(result);
}

// ============================================================
//  🔗 generateAdminLinkCode — super_admin يولّد كود ربط بتليجرام
// ============================================================
async function handleGenerateAdminLinkCode(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  if (!verified.user || !verified.user.isSuperAdmin) {
    return res.status(403).json({ success: false, error: 'forbidden', message: 'superAdmin فقط' });
  }

  const body = req.body || {};
  const result = await generateAdminLinkCode({
    adminUsername: verified.session.username,
    username: body.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  🔐 revokeChildId — تغيير كود الطفل
// ============================================================
async function handleRevokeChildId(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.children && perms.children.edit)) {
    return res.status(403).json({
      success: false,
      error: 'forbidden',
      message: 'لا تملك صلاحية تغيير كود الطفل'
    });
  }

  const body = req.body || {};
  const result = await revokeChildId({
    childID: body.childID,
    reason: body.reason,
    notes: body.notes,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(200).json(result);
}

// ============================================================
//  🔑 consumeLoginLink — استهلاك رابط دخول + إنشاء جلسة
//  - تحقق من التوكن
//  - استهلاكه (ذرّي)
//  - إنشاء جلسة جديدة
//  - إرجاع بيانات الجلسة
// ============================================================
async function handleConsumeLoginLink(req, res) {
  const token = String(
    (req.query && req.query.token) ||
    (req.body && req.body.token) ||
    ''
  ).trim();

  if (!token) {
    return res.status(400).json({
      success: false,
      error: 'missing_token',
      message: 'الرابط غير صحيح — لا يحتوي على توكن.'
    });
  }

  // 1. استهلاك التوكن (تحقق + تعليمه كمستخدم — ذرّي)
  const consumed = await consumeLoginLink(token);
  if (!consumed.success) {
    const errMap = {
      invalid_token: 'الرابط غير صحيح.',
      used_token:    'تم استخدام هذا الرابط من قبل.',
      expired_token: 'انتهت صلاحية الرابط. يرجى طلب رابط جديد من البوت.',
      race_lost:     'تم استخدام الرابط للتو من جهاز آخر.',
      missing_token: 'الرابط غير صحيح.'
    };
    return res.status(400).json({
      success: false,
      error: consumed.error || 'invalid_token',
      message: errMap[consumed.error] || 'تعذر استخدام الرابط.'
    });
  }

  const username = consumed.username;

  // 2. جيب بيانات الأدمن
  const { data: admin, error: adminErr } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .select('*')
    .eq('username', username)
    .maybeSingle();

  if (adminErr || !admin) {
    return res.status(404).json({
      success: false,
      error: 'admin_not_found',
      message: 'الحساب غير موجود.'
    });
  }

  // 3. فحص حالة الحساب
  const isActive = String(admin.is_active || '').trim();
  if (isActive !== 'نشط') {
    return res.status(403).json({
      success: false,
      error: 'account_inactive',
      message: 'الحساب معطَّل. يرجى التواصل مع superAdmin.'
    });
  }

  // 4. أنشئ جلسة
  const ipAddress = getClientIP(req);
  const userAgent = String(req.headers['user-agent'] || '').substring(0, 300);

  const sessionResult = await createSession({
    username: username,
    ipAddress: ipAddress,
    userAgent: userAgent
  });

  if (!sessionResult.success) {
    return res.status(500).json({
      success: false,
      error: 'session_creation_failed',
      message: 'خطأ في إنشاء الجلسة. حاول مرة أخرى.'
    });
  }

  // 5. علّم مصدر الجلسة (telegram_link)
  try {
    await supabaseAdmin
      .from(TABLES.ADMIN_SESSIONS)
      .update({ source: 'telegram_link' })
      .eq('session_token', sessionResult.sessionToken);
  } catch (e) {}

  // 6. فحص التعارض (نفس منطق login)
  let conflict = false;
  let conflictInfo = null;
  if (sessionResult.conflict) {
    conflict = true;
    conflictInfo = sessionResult.conflictInfo;
    try {
      await freezeAllActiveSessions(username, 'conflict');
      await writeAuditLog({
        username: username,
        action: 'session_conflict_detected',
        changes: { other_session: conflictInfo, source: 'telegram_link' },
        ip_address: ipAddress,
        user_agent: userAgent
      });
    } catch (e) {}
  }

  // 7. تحديث آخر تسجيل دخول
  try {
    await supabaseAdmin
      .from(TABLES.ADMINS)
      .update({ last_login_at: nowUTC() })
      .eq('username', username);
  } catch (e) {}

  // 8. Audit Log
  try {
    await writeAuditLog({
      username: username,
      action: conflict ? 'login_success_conflict' : 'login_via_telegram_link',
      ip_address: ipAddress,
      user_agent: userAgent
    });
  } catch (e) {}

  // 9. هل يجب تغيير الباسورد؟
  const mustChangePassword = String(admin.must_change_password || '').trim() === 'نعم';

  return res.status(200).json({
    success: true,
    sessionToken: sessionResult.sessionToken,
    csrfToken: sessionResult.csrfToken,
    expiresAt: sessionResult.expiresAt,
    user: {
      username: admin.username,
      fullName: admin.full_name,
      permissions: admin.permissions || {},
      isSuperAdmin: admin.username === 'super_admin',
      themePreference: admin.theme_preference || 'light',
      mustChangePassword: mustChangePassword
    },
    conflict: conflict,
    frozen: conflict,
    conflictInfo: conflictInfo
  });
}

// ============================================================
//  🚨 emergencyUnlock — دخول طوارئ (Secret أو Recovery Code)
// ============================================================
async function handleEmergencyUnlock(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const body = req.body || {};
  const code = String(body.code || '').trim();

  if (!code) {
    return res.status(400).json({ success: false, error: 'missing_code', message: 'الرمز مطلوب' });
  }

  const ipAddress = getClientIP(req);
  const userAgent = String(req.headers['user-agent'] || '').substring(0, 300);

  let username = null;
  let source = null;

  // 1. جرّب Secret
  if (verifyEmergencySecret(code)) {
    username = 'super_admin';
    source = 'emergency_secret';
  } else {
    // 2. جرّب Recovery Code
    const recovery = await consumeRecoveryCode(code, ipAddress);
    if (recovery.success) {
      username = recovery.username;
      source = 'recovery_code';
    } else {
      await writeAuditLog({
        username: 'unknown',
        action: 'emergency_unlock_failed',
        ip_address: ipAddress,
        user_agent: userAgent
      });
      return res.status(401).json({
        success: false,
        error: 'invalid_credentials',
        message: 'الرمز غير صحيح أو مستخدم مسبقًا.'
      });
    }
  }

  // 3. جيب الأدمن
  const { data: admin, error: adminErr } = await supabaseAdmin
    .from(TABLES.ADMINS)
    .select('*')
    .eq('username', username)
    .maybeSingle();

  if (adminErr || !admin) {
    return res.status(404).json({ success: false, error: 'admin_not_found' });
  }

  if (String(admin.is_active || '').trim() !== 'نشط') {
    return res.status(403).json({ success: false, error: 'account_inactive', message: 'الحساب معطَّل' });
  }

  // 4. أنشئ جلسة
  const sessionResult = await createSession({
    username: username,
    ipAddress: ipAddress,
    userAgent: userAgent
  });

  if (!sessionResult.success) {
    return res.status(500).json({ success: false, error: 'session_creation_failed' });
  }

  // 5. علّم مصدر الجلسة
  try {
    await supabaseAdmin
      .from(TABLES.ADMIN_SESSIONS)
      .update({ source: source })
      .eq('session_token', sessionResult.sessionToken);
  } catch (e) {}

  // 6. Audit
  await writeAuditLog({
    username: username,
    action: 'emergency_unlock_success',
    changes: { source: source },
    ip_address: ipAddress,
    user_agent: userAgent
  });

  // 7. إشعار superAdmin
  await notifySuperAdmin(
    '🚨 <b>دخول طوارئ ناجح</b>\n\n' +
    'الحساب: <code>' + username + '</code>\n' +
    'المصدر: <b>' + source + '</b>\n' +
    'IP: <code>' + ipAddress + '</code>\n' +
    '⏰ ' + nowEgypt()
  );

  const mustChangePassword = String(admin.must_change_password || '').trim() === 'نعم';

  return res.status(200).json({
    success: true,
    sessionToken: sessionResult.sessionToken,
    csrfToken: sessionResult.csrfToken,
    expiresAt: sessionResult.expiresAt,
    user: {
      username: admin.username,
      fullName: admin.full_name,
      permissions: admin.permissions || {},
      isSuperAdmin: admin.username === 'super_admin',
      themePreference: admin.theme_preference || 'light',
      mustChangePassword: mustChangePassword
    }
  });
}

// ============================================================
//  🔑 generateRecoveryCodes — توليد 10 أكواد (superAdmin فقط)
// ============================================================
async function handleGenerateRecoveryCodes(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  if (!verified.user || !verified.user.isSuperAdmin) {
    return res.status(403).json({ success: false, error: 'forbidden', message: 'superAdmin فقط' });
  }

  const result = await generateRecoveryCodes(verified.session.username, verified.session.username);
  return res.status(200).json(result);
}

// ============================================================
//  📊 getPanelStatus — حالة البوابة (فتح/قفل)
// ============================================================
async function handleGetPanelStatus(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const result = await getPanelStatus();
  return res.status(200).json(result);
}

// ============================================================
//  📤 uploadEmailAsset — رفع صورة/ملف
//  صلاحية: emails.send_individual أو emails.send_bulk
// ============================================================
async function handleUploadEmailAsset(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  const canSend = isSuper ||
    (perms.emails && (perms.emails.send_individual || perms.emails.send_bulk));
  if (!canSend) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await uploadEmailAsset({
    base64: body.base64,
    fileName: body.fileName,
    mimeType: body.mimeType
  });

  return res.status(result.success ? 200 : 400).json(result);
}

// ============================================================
//  📋 getEmailTemplatesList
// ============================================================
async function handleGetEmailTemplatesList(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.emails && perms.emails.send_individual)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const params = {
    category: (req.query && req.query.category) || (req.body && req.body.category),
    activeOnly: (req.query && req.query.activeOnly === 'true') || (req.body && req.body.activeOnly === true)
  };

  const result = await getEmailTemplatesList(params);
  return res.status(200).json(result);
}

// ============================================================
//  🔍 getEmailTemplate
// ============================================================
async function handleGetEmailTemplate(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const id = (req.query && req.query.id) || (req.body && req.body.id);
  const result = await getEmailTemplate({ id });
  return res.status(200).json(result);
}

// ============================================================
//  ➕ createEmailTemplate — يتطلب manage_campaigns
// ============================================================
async function handleCreateEmailTemplate(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.emails && perms.emails.manage_campaigns)) {
    return res.status(403).json({ success: false, error: 'forbidden', message: 'لا تملك صلاحية إدارة القوالب' });
  }

  const body = req.body || {};
  const result = await createEmailTemplateAction({
    name: body.name,
    category: body.category,
    subject: body.subject,
    bodyHtml: body.bodyHtml,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(result.success ? 200 : 400).json(result);
}

// ============================================================
//  ✏️ updateEmailTemplate
// ============================================================
async function handleUpdateEmailTemplate(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.emails && perms.emails.manage_campaigns)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await updateEmailTemplateAction({
    id: body.id,
    updates: body.updates || {},
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(result.success ? 200 : 400).json(result);
}

// ============================================================
//  🗑️ deleteEmailTemplate
// ============================================================
async function handleDeleteEmailTemplate(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.emails && perms.emails.manage_campaigns)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await deleteEmailTemplateAction({
    id: body.id,
    adminUsername: verified.session.username,
    req: req
  });

  return res.status(result.success ? 200 : 400).json(result);
}

// ============================================================
//  💳 getChildPayments — جلب مدفوعات الطفل + الأهلية
//  يسمح بها لـ أي أدمن لديه children.view (بيانات قراءة فقط)
// ============================================================
async function handleGetChildPayments(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  // صلاحية العرض: children.view (نفس ما يسمح بعرض تفاصيل الطفل)
  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.children && perms.children.view)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const childID = String(
    (req.query && req.query.childID) ||
    (req.body && req.body.childID) ||
    ''
  ).trim().toUpperCase();

  if (!childID) {
    return res.status(400).json({ success: false, error: 'missing_child_id' });
  }

  const result = await getChildPaymentsWithEligibility(childID);
  return res.status(200).json(result);
}

// ============================================================
//  💸 refundChildPayment — استرداد مبلغ دفع
//  يتطلب payments.refund أو super_admin
//  خطوات:
//    1. فحص الصلاحية
//    2. استدعاء refundPayment() (تتحقق من الأهلية + Paymob + DB)
//    3. تسجيل في Audit Log
//    4. إشعار superAdmin
// ============================================================
async function handleRefundChildPayment(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  // صلاحية الاسترداد: payments.refund أو super_admin
  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.payments && perms.payments.refund)) {
    return res.status(403).json({
      success: false,
      error: 'forbidden',
      message: 'لا تملك صلاحية استرداد المدفوعات'
    });
  }

  const body = req.body || {};
  const childID = String(body.childID || '').trim().toUpperCase();
  const paymentId = String(body.paymentId || '').trim();
  const reason = String(body.reason || '').trim();

  if (!childID || !paymentId || !reason) {
    return res.status(400).json({ success: false, error: 'missing_params' });
  }

  if (reason.length < 10) {
    return res.status(400).json({
      success: false,
      error: 'reason_too_short',
      message: 'سبب الاسترداد يجب أن يكون 10 أحرف على الأقل'
    });
  }

  const adminUsername = verified.session.username;
  const ipAddress = getClientIP(req);
  const userAgent = String(req.headers['user-agent'] || '').substring(0, 300);

  // ✅ Override للمسحات — super_admin فقط
  const requestedSkip = body.skipScanCheck === true;
  const skipScanCheck = requestedSkip && isSuper;

  if (requestedSkip && !isSuper) {
    return res.status(403).json({
      success: false,
      error: 'forbidden_override',
      message: 'تخطي فحص المسحات متاح لـ super_admin فقط'
    });
  }

  // 1. تنفيذ الاسترداد
  const result = await refundPayment({
    childID,
    paymentId,
    reason,
    adminUsername,
    skipScanCheck
  });

  // 2. تسجيل في Audit Log (دائمًا — نجح أو فشل)
  try {
    if (result.success) {
      await writeAuditLog({
        username: adminUsername,
        action: skipScanCheck ? 'payment_refunded_with_scan_override' : 'payment_refunded',
        target_table: TABLES.PAYMENTS,
        target_id: paymentId,
        changes: {
          child_id: childID,
          amount_egp: result.amountEGP,
          refund_id: result.refundId,
          reason: reason,
          skip_scan_check: skipScanCheck
        },
        ip_address: ipAddress,
        user_agent: userAgent
      });
    } else {
      await writeAuditLog({
        username: adminUsername,
        action: 'payment_refund_failed',
        target_table: TABLES.PAYMENTS,
        target_id: paymentId,
        changes: {
          child_id: childID,
          error: result.error,
          detail: result.detail || null,
          reason: reason
        },
        ip_address: ipAddress,
        user_agent: userAgent
      });
    }
  } catch (e) {
    // فشل صامت
  }

  // 3. إشعار superAdmin (نجح فقط)
  if (result.success) {
    try {
      await notifySuperAdmin(
        '💸 <b>تم استرداد مبلغ</b>\n\n' +
        '👶 الطفل: <code>' + childID + '</code>\n' +
        '💰 المبلغ: <b>' + result.amountEGP + ' EGP</b>\n' +
        '🆔 Refund ID: <code>' + (result.refundId || '—') + '</code>\n' +
        '👤 بواسطة: <code>' + adminUsername + '</code>\n' +
        '🕐 ' + nowEgypt()
      );
    } catch (e) {}
  }

  // 4. تحديد HTTP status حسب نوع الخطأ
  if (result.success) {
    return res.status(200).json(result);
  }

  // أخطاء الأعمال (400) → قابل للتصحيح من المستخدم
  const businessErrors = [
    'payment_not_found',
    'already_refunded',
    'refund_in_progress',
    'not_paid',
    'beyond_14_days',
    'service_used',
    'missing_transaction_id',
    'reason_too_short',
    'missing_params'
  ];

  const status = businessErrors.includes(result.error) ? 400 : 500;
  return res.status(status).json(result);
}

// ============================================================
//  🆕 Handler: getWithdrawalsList
// ============================================================
async function handleGetWithdrawalsList(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.marketers && perms.marketers.view)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const q = req.query || {};
  const result = await getWithdrawalsList({
    page: q.page,
    pageSize: q.pageSize,
    search: q.search,
    status: q.status,
    marketerCode: q.marketerCode,
    fromDate: q.fromDate,
    toDate: q.toDate
  });
  return res.status(200).json(result);
}

// ============================================================
//  🆕 Handler: getWithdrawalsStats
// ============================================================
async function handleGetWithdrawalsStats(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const result = await getWithdrawalsStats();
  return res.status(200).json(result);
}

// ============================================================
//  🆕 Handler: getWithdrawalDetails
// ============================================================
async function handleGetWithdrawalDetails(req, res) {
  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.marketers && perms.marketers.view)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const requestId = (req.query && req.query.requestId) || (req.body && req.body.requestId);
  const result = await getWithdrawalDetails(requestId);
  return res.status(200).json(result);
}

// ============================================================
//  🆕 Handler: updateWithdrawalStatus
// ============================================================
async function handleUpdateWithdrawalStatus(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.marketers && perms.marketers.edit)) {
    return res.status(403).json({ success: false, error: 'forbidden', message: 'لا تملك صلاحية التعديل' });
  }

  const body = req.body || {};
  const result = await updateWithdrawalStatus({
    requestId: body.requestId,
    newStatus: body.newStatus,
    rejectionReason: body.rejectionReason,
    cancellationReason: body.cancellationReason,
    screenshotUrl: body.screenshotUrl,
    adminNotes: body.adminNotes,
    adminUsername: verified.session.username,
    req: req
  });

  // 400 لأخطاء التحقق، 200 للنجاح
  const successCodes = result.success;
  const validationErrors = ['missing_request_id', 'invalid_status', 'invalid_transition', 'reason_required', 'screenshot_required', 'invalid_screenshot_url'];
  const status = successCodes ? 200 : (validationErrors.includes(result.error) ? 400 : 500);
  return res.status(status).json(result);
}

// ============================================================
//  🆕 Handler: uploadWithdrawalScreenshot
// ============================================================
async function handleUploadWithdrawalScreenshot(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const verified = await verifySession(extractSessionToken(req));
  if (!verified.valid || !verified.session) {
    return res.status(401).json({ success: false, error: 'invalid_session' });
  }

  const isSuper = verified.user && verified.user.isSuperAdmin;
  const perms = (verified.user && verified.user.permissions) || {};
  if (!isSuper && !(perms.marketers && perms.marketers.edit)) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const body = req.body || {};
  const result = await uploadWithdrawalScreenshot({
    requestId: body.requestId,
    base64: body.base64,
    fileName: body.fileName,
    mimeType: body.mimeType
  });

  const status = result.success ? 200 : 400;
  return res.status(status).json(result);
}