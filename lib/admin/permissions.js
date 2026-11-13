// ================================================================
//  lib/admin/permissions.js — نظام الصلاحيات
// ================================================================

// ============================================================
//  🎯 البنية الافتراضية للصلاحيات
// ============================================================
export function getDefaultPermissions() {
  return {
    dashboard:   { view: true },
    children:    { view: true, edit: false, delete: false, export: false },
    marketers:   { view: true, edit: false, delete: false, export: false },
    // 🆕 صلاحية إدارة طلبات السحب (منفصلة عن marketers)
    withdrawals: { view: false, edit: false },
    newsletter:  { view: true, edit: false, delete: false, export: false },
    reports:     { view: true, edit: false, close: false },
    scan_logs:   { view: true, export: false, delete: false },
    emails:      { send_individual: true, send_bulk: false, manage_campaigns: false },
    admins:      { view: false, create: false, edit: false, delete: false },
    config:      { view: false, edit: false },
    audit_log:   { view: false },
    payments:    { view: true, refund: false }
  };
}

// ============================================================
//  ✅ hasPermission — هل يملك المستخدم الصلاحية؟
// ============================================================
export function hasPermission(user, section, action) {
  if (!user) return false;

  // superAdmin يملك كل الصلاحيات دائمًا
  if (user.isSuperAdmin) return true;

  const perms = user.permissions || {};
  const sectionPerms = perms[section];

  if (!sectionPerms || typeof sectionPerms !== 'object') return false;

  return sectionPerms[action] === true;
}

// ============================================================
//  🛡️ requirePermission — يرمي خطأ إذا لا يملك الصلاحية
// ============================================================
export function requirePermission(user, section, action) {
  if (!hasPermission(user, section, action)) {
    const err = new Error('Forbidden');
    err.code = 'forbidden';
    err.status = 403;
    err.message_ar = 'ليس لديك صلاحية للقيام بهذا الإجراء';
    throw err;
  }
}