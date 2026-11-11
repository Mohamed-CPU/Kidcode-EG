// ================================================================
//  admin/js/account.js — منطق صفحة "حسابي"
// ================================================================

(function() {
  'use strict';

  const state = {
    isInitialized: false,
    isSavingProfile: false,
    isChangingPassword: false
  };

  // ============================================================
  //  🚀 init
  // ============================================================
  function init() {
    if (state.isInitialized) return;
    state.isInitialized = true;

    renderUserInfo();
    bindEvents();
    loadSessions();
    loadAuditLog();
  }

  // ============================================================
  //  👤 عرض بيانات المستخدم
  // ============================================================
  function renderUserInfo() {
    const user = window.Core.getUser();
    if (!user) return;

    const usernameEl = document.getElementById('accountUsername');
    const fullNameEl = document.getElementById('accountFullName');

    if (usernameEl) usernameEl.value = user.username || '';
    if (fullNameEl) fullNameEl.value = user.fullName || '';
  }

  // ============================================================
  //  🎯 ربط الأحداث
  // ============================================================
  function bindEvents() {
    // زر حفظ الاسم
    const saveProfileBtn = document.getElementById('saveProfileBtn');
    if (saveProfileBtn) saveProfileBtn.addEventListener('click', saveProfile);

    // زر تغيير كلمة السر
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    if (changePasswordBtn) changePasswordBtn.addEventListener('click', changePassword);

    // أزرار إظهار كلمة السر
    document.querySelectorAll('.password-toggle').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const targetId = this.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (!input) return;

        const currentType = input.getAttribute('type');
        const nextType = currentType === 'password' ? 'text' : 'password';
        input.setAttribute('type', nextType);

        const icon = this.querySelector('i');
        if (icon) {
          icon.className = nextType === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
        }
      });
    });

    // زر تحديث الجلسات
    const refreshSessionsBtn = document.getElementById('refreshSessionsBtn');
    if (refreshSessionsBtn) refreshSessionsBtn.addEventListener('click', loadSessions);

    // زر تحديث السجل
    const refreshAuditBtn = document.getElementById('refreshAuditBtn');
    if (refreshAuditBtn) refreshAuditBtn.addEventListener('click', loadAuditLog);
  }

  // ============================================================
  //  👤 حفظ الاسم
  // ============================================================
  async function saveProfile() {
    if (state.isSavingProfile) return;

    const fullNameEl = document.getElementById('accountFullName');
    const btn = document.getElementById('saveProfileBtn');
    const fullName = (fullNameEl.value || '').trim();

    if (!fullName) {
      window.UI.toast.error('الاسم مطلوب');
      fullNameEl.focus();
      return;
    }

    state.isSavingProfile = true;
    window.UI.setLoading(btn, true, 'جاري الحفظ...');

    try {
      const result = await window.Core.api('updateMyProfile', { fullName }, 'POST');

      if (result.success) {
        // حدّث بيانات المستخدم في Core
        const user = window.Core.getUser();
        if (user) {
          user.fullName = result.fullName;
          // إعادة حفظها في localStorage
          window.Core.saveSession({
            sessionToken: window.Core.getState().sessionToken,
            csrfToken: window.Core.getState().csrfToken,
            user: user
          });
        }

        // حدّث السايدبار
        if (window.Navbar) window.Navbar.load('navbarPlaceholder');
        // (سيُعيد رسم اسم المستخدم)

        window.UI.toast.success(result.message || 'تم تحديث الاسم');
      } else {
        window.UI.toast.error(result.message || 'فشل التحديث');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الاتصال بالخادم');
    } finally {
      state.isSavingProfile = false;
      window.UI.setLoading(btn, false);
    }
  }

  // ============================================================
  //  🔐 تغيير كلمة السر
  // ============================================================
  async function changePassword() {
    if (state.isChangingPassword) return;

    const currentEl = document.getElementById('currentPassword');
    const newEl = document.getElementById('newPassword');
    const confirmEl = document.getElementById('confirmPassword');
    const btn = document.getElementById('changePasswordBtn');

    const currentPassword = (currentEl.value || '').trim();
    const newPassword = (newEl.value || '').trim();
    const confirmPassword = (confirmEl.value || '').trim();

    // فحوصات سريعة
    if (!currentPassword) { window.UI.toast.error('كلمة السر الحالية مطلوبة'); currentEl.focus(); return; }
    if (!newPassword) { window.UI.toast.error('كلمة السر الجديدة مطلوبة'); newEl.focus(); return; }
    if (newPassword.length < 10) { window.UI.toast.error('كلمة السر الجديدة يجب أن تكون 10 أحرف على الأقل'); newEl.focus(); return; }
    if (newPassword !== confirmPassword) { window.UI.toast.error('تأكيد كلمة السر غير متطابق'); confirmEl.focus(); return; }

    const confirmed = await window.UI.confirm({
      title: 'تغيير كلمة السر',
      message: 'سيتم إنهاء كل الجلسات الأخرى، وستبقى جلستك الحالية فقط نشطة.',
      confirmText: 'تغيير',
      type: 'warning'
    });
    if (!confirmed) return;

    state.isChangingPassword = true;
    window.UI.setLoading(btn, true, 'جاري التغيير...');

    try {
      const result = await window.Core.api('changeMyPassword', {
        currentPassword: currentPassword,
        newPassword: newPassword
      }, 'POST');

      if (result.success) {
        window.UI.toast.success(result.message || 'تم تغيير كلمة السر');
        currentEl.value = '';
        newEl.value = '';
        confirmEl.value = '';
        // أعد تحميل الجلسات (ستتقلص القائمة)
        loadSessions();
      } else {
        window.UI.toast.error(result.message || 'فشل التغيير');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الاتصال بالخادم');
    } finally {
      state.isChangingPassword = false;
      window.UI.setLoading(btn, false);
    }
  }

  // ============================================================
  //  📊 تحميل الجلسات
  // ============================================================
  async function loadSessions() {
    const container = document.getElementById('sessionsContainer');
    if (!container) return;

    container.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i><p>جاري التحميل...</p></div>';

    try {
      const result = await window.Core.api('getMySessions', {}, 'GET');

      if (!result.success) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>' + window.UI.escapeHtml(result.error || 'فشل التحميل') + '</p></div>';
        return;
      }

      const sessions = result.sessions || [];

      if (sessions.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>لا توجد جلسات نشطة</p></div>';
        return;
      }

      let html = '';
      sessions.forEach(function(s) {
        const device = parseUserAgent(s.user_agent);
        const iconClass = device.isMobile ? 'fa-mobile-alt' : 'fa-desktop';
        // ✅ آخر نشاط بصيغة عربية (كان ISO خام)
        const lastActivityStr = formatDateTimeFull(s.last_activity_at);

        html += '<div class="session-item' + (s.isCurrent ? ' current' : '') + '">' +
          '<div class="session-icon"><i class="fas ' + iconClass + '"></i></div>' +
          '<div class="session-info">' +
            '<div class="session-title">' +
              window.UI.escapeHtml(device.browser || 'متصفح غير معروف') +
              ' على ' + window.UI.escapeHtml(device.os || 'جهاز غير معروف') +
              (s.isCurrent ? ' <span class="badge badge-success">الجلسة الحالية</span>' : '') +
              (s.status === 'frozen' ? ' <span class="badge badge-warning">مجمّدة</span>' : '') +
            '</div>' +
            '<div class="session-meta">' +
              'IP: ' + window.UI.escapeHtml(s.ip_address) +
              ' · آخر نشاط: ' + window.UI.escapeHtml(lastActivityStr) +
            '</div>' +
          '</div>' +
          (s.isCurrent ? '' :
            '<button class="btn btn-sm btn-danger" data-ip="' + window.UI.escapeHtml(s.ip_address) + '" data-ua="' + window.UI.escapeHtml(s.user_agent) + '">' +
              '<i class="fas fa-sign-out-alt"></i> إنهاء' +
            '</button>'
          ) +
        '</div>';
      });

      container.innerHTML = html;

      // ربط أزرار الإنهاء
      container.querySelectorAll('button[data-ip]').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          const ip = btn.getAttribute('data-ip');
          const ua = btn.getAttribute('data-ua');
          await terminateSession(ip, ua);
        });
      });

    } catch (e) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>تعذر تحميل الجلسات</p></div>';
    }
  }

  // ============================================================
  //  🚪 إنهاء جلسة
  // ============================================================
  async function terminateSession(ip, ua) {
    const confirmed = await window.UI.confirm({
      title: 'إنهاء الجلسة',
      message: 'سيتم تسجيل الخروج من هذا الجهاز الآخر. هل أنت متأكد؟',
      confirmText: 'إنهاء',
      type: 'danger'
    });
    if (!confirmed) return;

    try {
      const result = await window.Core.api('terminateSession', {
        targetIp: ip,
        targetUA: ua
      }, 'POST');

      if (result.success) {
        window.UI.toast.success('تم إنهاء الجلسة');
        loadSessions();
      } else {
        window.UI.toast.error(result.message || 'فشل الإنهاء');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الاتصال بالخادم');
    }
  }

  // ============================================================
  //  📋 تحميل سجل العمليات
  // ============================================================
  async function loadAuditLog() {
    const container = document.getElementById('auditContainer');
    if (!container) return;

    container.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i><p>جاري التحميل...</p></div>';

    try {
      const result = await window.Core.api('getMyAuditLog', { limit: 20 }, 'GET');

      if (!result.success) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>' + window.UI.escapeHtml(result.error || 'فشل التحميل') + '</p></div>';
        return;
      }

      const logs = result.logs || [];

      if (logs.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>لا توجد عمليات مسجّلة</p></div>';
        return;
      }

      let html = '';
      logs.forEach(function(log) {
        const icon = getActionIcon(log.action);
        // ✅ تاريخ العملية بصيغة عربية (كان ISO خام)
        const createdStr = formatDateTimeFull(log.created_at);

        html += '<div class="audit-item">' +
          '<div class="audit-icon"><i class="fas ' + icon + '"></i></div>' +
          '<div class="audit-info">' +
            '<div class="audit-action">' + window.UI.escapeHtml(getActionLabel(log.action)) + '</div>' +
            '<div class="audit-time">' + window.UI.escapeHtml(createdStr) + ' · ' + window.UI.escapeHtml(log.ip_address || '—') + '</div>' +
          '</div>' +
        '</div>';
      });

      container.innerHTML = html;

    } catch (e) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>تعذر تحميل السجل</p></div>';
    }
  }

  // ============================================================
  //  🛠️ Helpers
  // ============================================================

  // ✅ الصيغة العربية الكاملة: "الأربعاء، 11 نوفمبر 2026 - 02:00 مساءً"
  function formatDateTimeFull(value) {
    if (!value) return '—';
    try {
      if (window.AdminUtils && typeof window.AdminUtils.formatDateTime === 'function') {
        return window.AdminUtils.formatDateTime(value) || '—';
      }
      return '—';
    } catch (e) {
      return '—';
    }
  }

  function parseUserAgent(ua) {
    if (!ua) return { browser: '', os: '', isMobile: false };
    ua = String(ua);
    let browser = '', os = '', isMobile = false;

    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser = 'Chrome';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';

    if (/Windows/.test(ua)) os = 'Windows';
    else if (/Mac OS/.test(ua)) os = 'macOS';
    else if (/Android/.test(ua)) { os = 'Android'; isMobile = true; }
    else if (/iPhone|iPad/.test(ua)) { os = 'iOS'; isMobile = true; }
    else if (/Linux/.test(ua)) os = 'Linux';

    return { browser, os, isMobile };
  }

  function getActionIcon(action) {
    const map = {
      'login_success': 'fa-sign-in-alt',
      'login_failed_wrong_password': 'fa-times-circle',
      'login_failed_unknown_user': 'fa-user-slash',
      'login_blocked_rate_limit': 'fa-ban',
      'login_success_conflict': 'fa-exclamation-triangle',
      'logout': 'fa-sign-out-alt',
      'session_conflict_detected': 'fa-exclamation-triangle',
      'password_changed': 'fa-key',
      'password_changed_via_token': 'fa-key',
      'password_change_requested_from_frozen': 'fa-envelope',
      'profile_updated': 'fa-user-edit',
      'session_terminated': 'fa-user-times',
      'i_didnt_request_triggered': 'fa-shield-alt',
      'account_disabled_frozen_timeout': 'fa-lock',
      'super_admin_created': 'fa-user-plus',
      'update_child': 'fa-child',
      'delete_child': 'fa-trash',
      'update_marketer': 'fa-users',
      'send_email': 'fa-envelope'
    };
    return map[action] || 'fa-circle';
  }

  function getActionLabel(action) {
    const map = {
      'login_success': 'تسجيل دخول ناجح',
      'login_failed_wrong_password': 'فشل دخول (كلمة مرور خاطئة)',
      'login_failed_unknown_user': 'فشل دخول (مستخدم غير موجود)',
      'login_blocked_rate_limit': 'محظور (محاولات كثيرة)',
      'login_success_conflict': 'دخول مع تعارض في الجلسات',
      'logout': 'تسجيل خروج',
      'session_conflict_detected': 'اكتشاف تعارض في الجلسات',
      'password_changed': 'تغيير كلمة السر',
      'password_changed_via_token': 'تغيير كلمة السر عبر البريد',
      'password_change_requested_from_frozen': 'طلب رابط تغيير كلمة السر',
      'profile_updated': 'تحديث الاسم',
      'session_terminated': 'إنهاء جلسة أخرى',
      'i_didnt_request_triggered': 'إبلاغ أمني ("لم أطلب هذا")',
      'account_disabled_frozen_timeout': 'تعطيل تلقائي بعد انتهاء مهلة التجميد',
      'super_admin_created': 'إنشاء super_admin',
      'update_child': 'تعديل بيانات طفل',
      'delete_child': 'حذف طفل',
      'update_marketer': 'تعديل مسوق',
      'send_email': 'إرسال بريد'
    };
    return map[action] || action;
  }

  // ============================================================
  //  🌐 التصدير
  // ============================================================
  window.AccountPage = {
    init: init,
    reload: function() {
      loadSessions();
      loadAuditLog();
    }
  };

})();