// ================================================================
//  admin/js/core.js — النواة
//  - API Communication
//  - Session Management
//  - Theme Management
//  - Freeze Detection (Polling)
//  - Permissions
// ================================================================

(function() {
  'use strict';

  // ============================================================
  //  ⚙️ الثوابت
  // ============================================================
  const API_ENDPOINT = '/api?action=admin';
  const TOKEN_KEY = 'adminSessionToken';
  const USER_KEY = 'adminUser';
  const THEME_KEY = 'admin_theme';
  const POLLING_INTERVAL_MS = 5000;

  // ============================================================
  //  📊 الحالة الداخلية
  // ============================================================
  const state = {
    sessionToken: '',
    csrfToken: '',
    user: null,
    pollingTimer: null,
    isFrozen: false,
    freezeInfo: null,
    secondsLeft: 0
  };

  // ============================================================
  //  💾 SESSION — قراءة وكتابة
  // ============================================================
  function loadSessionFromStorage() {
    try {
      state.sessionToken = localStorage.getItem(TOKEN_KEY) || '';
      state.csrfToken = localStorage.getItem('adminCsrfToken') || '';
      const userRaw = localStorage.getItem(USER_KEY);
      state.user = userRaw ? JSON.parse(userRaw) : null;
    } catch (e) {
      state.sessionToken = '';
      state.user = null;
    }

    // ✅ Fallback: لو localStorage فاضي (مثلاً بعد Cache clear أو متصفح جديد)
    //    نستعيد التوكن من الـ Cookie (لو موجود)
    if (!state.sessionToken) {
      try {
        const match = document.cookie.match(/(?:^|;\s*)admin_session=([^;]+)/);
        if (match && match[1]) {
          state.sessionToken = decodeURIComponent(match[1]);
          // نعيد كتابته في localStorage (علشان الطلبات القادمة)
          try { localStorage.setItem(TOKEN_KEY, state.sessionToken); } catch (e) {}
          console.log('✅ [core.js] استُعيدت الجلسة من الـ Cookie');
        }
      } catch (e) {}
    }
  }

  // ============================================================
  //  🍪 Cookie Helpers — للميدل وير
  //  ملاحظة: نفس التوكن بالضبط — لكن متاح للخادم (Middleware)
  // ============================================================
  function setSessionCookie(token, maxAgeSeconds) {
    try {
      const t = String(token || '').trim();
      if (!t) return;
      const maxAge = typeof maxAgeSeconds === 'number' ? maxAgeSeconds : 21600; // 6 ساعات
      const base =
        'admin_session=' + encodeURIComponent(t) +
        '; Path=/' +
        '; Max-Age=' + maxAge;

      // المحاولة الأولى: Strict + Secure
      try {
        document.cookie = base + '; SameSite=Strict; Secure';
      } catch (e) {}

      // fallback
      if (document.cookie.indexOf('admin_session=') === -1) {
        try {
          document.cookie = base + '; SameSite=Lax';
        } catch (e) {}
      }
    } catch (e) {}
  }

  function clearSessionCookie() {
    try {
      document.cookie =
        'admin_session=; Path=/; Max-Age=0; SameSite=Lax; Secure';
    } catch (e) {}
  }

  function saveSession(data) {
    state.sessionToken = data.sessionToken || '';
    state.csrfToken = data.csrfToken || '';
    state.user = data.user || null;

    try {
      if (state.sessionToken) {
        localStorage.setItem(TOKEN_KEY, state.sessionToken);
        // 🍪 Cookie للميدل وير
        setSessionCookie(state.sessionToken, 21600);
      }
      if (state.csrfToken) {
        localStorage.setItem('adminCsrfToken', state.csrfToken);
      }
      if (state.user) {
        localStorage.setItem(USER_KEY, JSON.stringify(state.user));
      }
    } catch (e) {}
  }

  function clearSession() {
    state.sessionToken = '';
    state.csrfToken = '';
    state.user = null;
    state.isFrozen = false;
    state.freezeInfo = null;
    state.secondsLeft = 0;

    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem('adminCsrfToken');
      localStorage.removeItem(USER_KEY);
      // 🍪 امسح الكوكي
      clearSessionCookie();
    } catch (e) {}
  }

  function hasSession() {
    return !!state.sessionToken;
  }

  // ============================================================
  //  🌐 API — طلبات موحدة
  // ============================================================
  async function apiRequest(innerAction, data, method) {
    data = data || {};
    method = method || 'POST';

    const url = API_ENDPOINT + '&innerAction=' + encodeURIComponent(innerAction);

    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    // إضافة التوكن
    if (state.sessionToken) {
      options.headers['Authorization'] = 'Bearer ' + state.sessionToken;
    }

    // إضافة CSRF للطلبات المُعدِّلة
    if (method === 'POST' && state.csrfToken) {
      options.headers['X-CSRF-Token'] = state.csrfToken;
    }

    // إضافة الـ body
    if (method === 'POST') {
      options.body = JSON.stringify(data);
    } else {
      // 🛡️ حماية: منع تعارض أسماء الباراميترات مع الـ Routing
      const RESERVED = ['action', 'innerAction'];
      const safeData = {};
      Object.keys(data || {}).forEach(function(k) {
        if (RESERVED.indexOf(k) !== -1) return; // نتجاهل المحجوزة
        const v = data[k];
        if (v === null || v === undefined || v === '') return; // نتجاهل الفارغة
        safeData[k] = v;
      });
      const params = new URLSearchParams(safeData);
      const qs = params.toString();
      const finalUrl = qs ? (url + '&' + qs) : url;
      return fetchAndParse(finalUrl, options);
    }

    return fetchAndParse(url, options);
  }

  async function fetchAndParse(url, options) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (e) {
      const msg = String(e && e.message || '');

      // ✅ كشف أخطاء الإلغاء (navigation / redirect / logout)
      //    دي مش أخطاء حقيقية — تحصل لما الصفحة تنقّل أو الجلسة تُنهى
      const isAbortError =
        (e && e.name === 'AbortError') ||
        msg.indexOf('NetworkError') !== -1 ||
        msg.indexOf('Failed to fetch') !== -1 ||
        msg.indexOf('Load failed') !== -1 ||
        msg.indexOf('aborted') !== -1 ||
        msg.indexOf('NS_BINDING_ABORTED') !== -1;

      // لو الإلغاء حصل وكان فيه redirect في الطريق (logout / revoke)
      //    أو الجلسة اتمسحت → نتجاهل بدون إبلاغ
      const isSessionEnding =
        !state.sessionToken ||
        document.visibilityState === 'hidden';

      if (isAbortError && isSessionEnding) {
        // خطأ صامت — لا نبلّغ، لا نرمي بضجيج
        const err = new Error('network_error');
        err.userMessage = 'تعذر الاتصال بالخادم.';
        err.silent = true;
        throw err;
      }

      // لو ده إلغاء مشبوه (لكن الجلسة لسه موجودة) → لا نبلّغ
      //    لكن نرمي الخطأ للمستخدم
      if (isAbortError) {
        const err = new Error('network_error');
        err.userMessage = 'تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.';
        err.silent = true;
        throw err;
      }

      // خطأ شبكة حقيقي → نبلّغ
      if (window.kcReportError) {
        window.kcReportError('apiRequest network error: ' + msg, {
          url: url,
          innerAction: options.innerAction
        });
      }
      const err = new Error('network_error');
      err.userMessage = 'تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.';
      throw err;
    }

    // قراءة الرد
    let payload;
    try {
      payload = await response.json();
    } catch (e) {
      if (window.kcReportError) {
        window.kcReportError('apiRequest invalid json (HTTP ' + response.status + ')', {
          url: url
        });
      }
      const err = new Error('invalid_response');
      err.userMessage = 'حدث خطأ غير متوقع. تم إخطار فريق الدعم.';
      throw err;
    }

    // ✅ معالجة 401 — تحقق من verify قبل أي logout
    if (response.status === 401) {
      // ✅ محاولة تأكيد: هل الجلسة فعلاً منتهية؟
      const reallyExpired = await confirmSessionExpired();
      if (reallyExpired) {
        // الجلسة فعلاً منتهية → logout
        clearSession();
        redirectToLogin();
        const err = new Error('unauthorized');
        err.userMessage = 'انتهت الجلسة. يرجى تسجيل الدخول.';
        throw err;
      }
      // الجلسة سارية — الخطأ خاص بالـ endpoint نفسه
      const err = new Error('endpoint_forbidden');
      err.userMessage = payload.message || 'ليس لديك صلاحية للقيام بهذا الإجراء.';
      throw err;
    }

    // ✅ 404 ممكن تكون من middleware (البوابة مقفولة) — لا نعمل logout
    if (response.status === 404) {
      const err = new Error('not_found');
      err.userMessage = payload.message || 'العنصر المطلوب غير موجود.';
      err.status = 404;
      throw err;
    }

    if (response.status === 403) {
      const err = new Error('forbidden');
      err.userMessage = payload.message || 'ليس لديك صلاحية للقيام بهذا الإجراء.';
      throw err;
    }

    if (!response.ok) {
      const err = new Error(payload.error || 'http_error');
      err.userMessage = payload.message || 'حدث خطأ غير متوقع.';
      throw err;
    }

    return payload;
  }

  // ============================================================
  //  🔍 confirmSessionExpired — تحقق فعلي قبل logout
  //  - تستدعي verify بدون استخدام fetchAndParse (لتجنب recursion)
  //  - تُرجِع true فقط لو الجلسة فعلاً منتهية/غير صالحة
  // ============================================================
  async function confirmSessionExpired() {
    if (!state.sessionToken) return true;

    try {
      const verifyUrl = API_ENDPOINT + '&innerAction=verify';
      const res = await fetch(verifyUrl, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + state.sessionToken,
          'Content-Type': 'application/json'
        }
      });

      // 200 + valid:true → الجلسة سارية (الخطأ مش في الجلسة)
      if (res.ok) {
        const data = await res.json();
        if (data && data.valid === true) {
          return false;
        }
      }

      // أي حاجة تانية (401, 404, 500, ...) → نعتبر الجلسة منتهية
      return true;
    } catch (e) {
      // فشل شبكة → لا نعمل logout (ممكن يكون انقطاع مؤقت)
      return false;
    }
  }

  // ============================================================
  //  🚪 التحويل لتسجيل الدخول
  // ============================================================
  function redirectToLogin(reason) {
    stopPolling();
    reason = reason || 'session_expired';
    if (window.location.pathname !== '/admin/' && window.location.pathname !== '/admin/index.html') {
      window.location.href = '/admin/?reason=' + encodeURIComponent(reason);
    }
  }

  // ============================================================
  //  🔐 SESSION — التحقق
  // ============================================================
  async function verifySession() {
    if (!state.sessionToken) return { valid: false, error: 'no_token' };

    try {
      const result = await apiRequest('verify', {}, 'GET');
      return result;
    } catch (e) {
      // ✅ لو الخطأ شبكة (مؤقت) → لا نعتبر الجلسة منتهية
      if (e && (e.message === 'network_error' || e.message === 'invalid_response')) {
        return {
          valid: true,
          _temporaryError: true,
          error: e.message
        };
      }

      // ✅ لو 404 (ممكن من middleware) → لا نعتبر الجلسة منتهية فورًا
      if (e && e.status === 404) {
        return {
          valid: true,
          _temporaryError: true,
          error: 'not_found',
          status: 404
        };
      }

      // خطأ حقيقي من verify → الجلسة منتهية
      return { valid: false, error: e ? e.message : 'unknown' };
    }
  }

  // ============================================================
  //  🚪 LOGIN / LOGOUT
  // ============================================================
  async function login(username, password) {
    const result = await apiRequest('login', { username, password }, 'POST');

    if (result.success) {
      saveSession(result);
      applyThemeFromUser(result.user);
      // ✅ خزّن conflictInfo لو وُجد
      if (result.conflictInfo) {
        window.__lastConflictInfo = result.conflictInfo;
      }
      return result;
    }

    // في حالة الفشل — نرمي خطأ مع الرسالة
    const err = new Error(result.error || 'login_failed');
    err.userMessage = result.message || 'بيانات الدخول غير صحيحة.';
    throw err;
  }

  // ============================================================
  //  🔐 redirectToPasswordChange — إعادة توجيه إلزامية
  // ============================================================
  function redirectToPasswordChange() {
    stopPolling();
    if (!window.location.pathname.endsWith('change-password-required.html')) {
      window.location.href = '/admin/change-password-required.html';
    }
  }

  async function logout() {
    try {
      await apiRequest('logout', {}, 'POST');
    } catch (e) {
      // نتجاهل الخطأ — نكمل محليًا
    }
    clearSession();
    stopPolling();
    window.location.href = '/admin/';
  }

  // ============================================================
  //  🎨 THEME
  // ============================================================
  function applyTheme(theme) {
    const html = document.documentElement;
    html.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
  }

  function applyThemeFromUser(user) {
    // أولوية: localStorage > user.themePreference > 'light'
    const stored = localStorage.getItem(THEME_KEY);
    let theme = 'light';

    if (stored === 'dark' || stored === 'light') {
      theme = stored;
    } else if (user && user.themePreference) {
      theme = user.themePreference;
      localStorage.setItem(THEME_KEY, theme);
    }

    applyTheme(theme);
  }

  async function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';

    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);

    // تحديث الأيقونة في الشريط العلوي إن وُجدت
    updateThemeButtonIcon(next);

    // حفظ في الخادم (best-effort)
    try {
      await apiRequest('updateTheme', { theme: next }, 'POST');
    } catch (e) {
      // نتجاهل — سيبقى محفوظًا في localStorage
    }

    return next;
  }

  function updateThemeButtonIcon(theme) {
    const btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    const icon = btn.querySelector('i');
    if (icon) {
      icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
  }

  // ============================================================
  //  🔄 FREEZE — Polling لفحص الحالة كل 5 ثوان
  // ============================================================
  function startPolling() {
    stopPolling();

    state.pollingTimer = setInterval(async function() {
      if (!state.sessionToken) return;

      try {
        const result = await apiRequest('checkStatus', {}, 'GET');

        if (result.status === 'frozen') {
          if (!state.isFrozen) {
            // أول مرة نكتشف التجميد
            onFreezeDetected(result);
          } else {
            // تحديث المعلومات
            updateFreezeOverlay(result);
          }
        } else if (result.status === 'active') {
          if (state.isFrozen) {
            // تم رفع التجميد
            onUnfreeze();
          }
        } else if (result.status === 'disabled') {
          onDisabled();
        } else if (result.status === 'expired' || result.status === 'logged_out' || result.status === 'invalid') {
          clearSession();
          redirectToLogin();
        }
      } catch (e) {
        // نتجاهل أخطاء الشبكة خلال polling
      }
    }, POLLING_INTERVAL_MS);
  }

  function stopPolling() {
    if (state.pollingTimer) {
      clearInterval(state.pollingTimer);
      state.pollingTimer = null;
    }
  }

  function onFreezeDetected(result) {
    state.isFrozen = true;
    state.freezeInfo = result;

    // إذا لم يكن هناك conflictInfo، حاول جلبه من أول verify
    // (يُخزَّن في window.__lastConflictInfo عند Login)
    if (!result.conflictInfo && window.__lastConflictInfo) {
      result.conflictInfo = window.__lastConflictInfo;
    }

    invokeHandler('onSessionFrozen', result);
  }

  function updateFreezeOverlay(result) {
    state.freezeInfo = result;
    if (typeof window.onFreezeUpdate === 'function') {
      try { window.onFreezeUpdate(result); } catch (e) {}
    }
  }

  function onUnfreeze() {
    state.isFrozen = false;
    state.freezeInfo = null;
    invokeHandler('onSessionUnfrozen');
  }

  function onDisabled() {
    state.isFrozen = true;
    invokeHandler('onAccountDisabled');

    // ✅ امسح الجلسة وأرسل reason=disabled
    //    (بعد فترة قصيرة حتى يرى المستخدم الـ toast)
    setTimeout(function() {
      clearSession();
      redirectToLogin('disabled');
    }, 3500);
  }

  // ============================================================
  //  🔑 PERMISSIONS
  // ============================================================
  function hasPermission(section, action) {
    if (!state.user) return false;
    if (state.user.isSuperAdmin) return true;

    const perms = state.user.permissions || {};
    const sectionPerms = perms[section];
    if (!sectionPerms || typeof sectionPerms !== 'object') return false;
    return sectionPerms[action] === true;
  }

  function isSuperAdmin() {
    return !!(state.user && state.user.isSuperAdmin);
  }

  // ============================================================
  //  🛡️ GUARD — حماية الصفحات
  // ============================================================
  async function guard() {
    loadSessionFromStorage();

    if (!state.sessionToken) {
      redirectToLogin();
      return false;
    }

    // تحقق أولي
    const verify = await verifySession();
    if (!verify.valid) {
      clearSession();
      redirectToLogin();
      return false;
    }

    // تحديث بيانات المستخدم
    if (verify.user) {
      state.user = verify.user;
      try { localStorage.setItem(USER_KEY, JSON.stringify(verify.user)); } catch (e) {}
    }

    // إذا كانت الجلسة مجمّدة عند الفحص الأول
    if (verify.frozen) {
      try {
        const fullStatus = await apiRequest('checkStatus', {}, 'GET');
        if (fullStatus && fullStatus.status === 'frozen') {
          onFreezeDetected(fullStatus);
        } else {
          onFreezeDetected({
            status: 'frozen',
            frozenReason: verify.frozenReason
          });
        }
      } catch (e) {
        onFreezeDetected({
          status: 'frozen',
          frozenReason: verify.frozenReason
        });
      }
    }

    // ✅ فحص must_change_password — إعادة توجيه إلزامية
    if (state.user && state.user.mustChangePassword) {
      redirectToPasswordChange();
      return false;
    }

    // تطبيق الثيم
    applyThemeFromUser(state.user);

    // بدء الـ polling
    startPolling();

    return true;
  }

    // ============================================================
  //  🎯 Default Handlers (احتياطي)
  //  تُستخدم إذا لم تُعرَّف handler مخصصة من الصفحة
  // ============================================================
  const defaultHandlers = {
    onFreeze: function(info) {
      // Fallback: استخدم UI إذا كانت متاحة
      if (window.UI && window.UI.toast) {
        window.UI.toast.warning(
          'الجلسة مجمّدة مؤقتًا — السبب: ' + (info.frozenReason || 'تعارض'),
          { duration: 0, title: 'تحذير أمني' }
        );
      }
    },
    onUnfreeze: function() {
      if (window.UI && window.UI.toast) {
        window.UI.toast.success('تم رفع التجميد. يمكنك الاستمرار.');
      }
    },
    onDisabled: function() {
      if (window.UI && window.UI.toast) {
        window.UI.toast.error('الحساب معطَّل. تواصل مع superAdmin.', { duration: 0 });
      }
    }
  };

  function invokeHandler(name, info) {
    // 1. جرّب handler الصفحة المخصصة
    const custom = window[name];
    if (typeof custom === 'function') {
      try { custom(info); return; } catch (e) {}
    }

    // 2. Fallback للـ default
    if (name === 'onSessionFrozen') defaultHandlers.onFreeze(info);
    else if (name === 'onSessionUnfrozen') defaultHandlers.onUnfreeze();
    else if (name === 'onAccountDisabled') defaultHandlers.onDisabled();
  }

  // ============================================================
  //  🌐 التصدير
  // ============================================================
  window.Core = {
    // Session
    loadSession: loadSessionFromStorage,
    saveSession: saveSession,
    clearSession: clearSession,
    hasSession: hasSession,
    verifySession: verifySession,
    login: login,
    logout: logout,
    guard: guard,

    // API
    api: apiRequest,

    // User / Permissions
    getUser: () => state.user,
    getState: () => state,
    hasPermission: hasPermission,
    isSuperAdmin: isSuperAdmin,

    // Theme
    toggleTheme: toggleTheme,
    applyTheme: applyTheme,

    // Polling
    startPolling: startPolling,
    stopPolling: stopPolling,

    // Utils
    redirectToLogin: redirectToLogin,
    redirectToPasswordChange: redirectToPasswordChange,

    // Constants
    TOKEN_KEY: TOKEN_KEY,
    USER_KEY: USER_KEY,
    THEME_KEY: THEME_KEY
  };

  // تطبيق الثيم فور التحميل (منع الوميض)
const initialTheme = localStorage.getItem(THEME_KEY) || 'light';
  applyTheme(initialTheme);

  // ✅ تحميل الجلسة من localStorage فور التحميل
  //    بدون هذا، أي صفحة تستدعي Core.verifySession مباشرة (قبل Core.guard)
  //    لن تجد التوكن
  loadSessionFromStorage();

})();