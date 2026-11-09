// ================================================================
//  admin/js/login.js — منطق صفحة تسجيل الدخول
// ================================================================

(function() {
  'use strict';

  // ============================================================
  //  ⚙️ المراجع
  // ============================================================
  const form = document.getElementById('loginForm');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const loginBtn = document.getElementById('loginBtn');
  const errorBox = document.getElementById('loginError');

  // ============================================================
  //  🎯 إذا كانت هناك جلسة صالحة → توجيه مباشر
  // ============================================================
  (async function checkExistingSession() {
    try {
      const params = new URLSearchParams(window.location.search);
      const reason = params.get('reason');

      // إذا كان السبب "session_expired" → نظف الجلسة القديمة
      if (reason === 'session_expired') {
        try {
          localStorage.removeItem('adminSessionToken');
          localStorage.removeItem('adminUser');
        } catch (e) {}
      } else {
        // تحقق من وجود جلسة صالحة
        window.Core.loadSession();
        if (window.Core.hasSession()) {
          const verify = await window.Core.verifySession();
          if (verify.valid) {
            window.location.href = '/admin/dashboard.html';
            return;
          } else {
            window.Core.clearSession();
          }
        }
      }
    } catch (e) {
      // فشل صامت
    }
  })();

  // ============================================================
  //  ❌ إظهار الخطأ
  // ============================================================
  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.add('show');
  }

  function hideError() {
    if (!errorBox) return;
    errorBox.classList.remove('show');
    errorBox.textContent = '';
  }

  // ============================================================
  //  🚀 تسجيل الدخول
  // ============================================================
  async function handleLogin(e) {
    e.preventDefault();

    const username = (usernameInput.value || '').trim();
    const password = (passwordInput.value || '').trim();

    hideError();

    if (!username) {
      showError('⚠️ يرجى إدخال اسم المستخدم');
      usernameInput.focus();
      return;
    }

    if (!password) {
      showError('⚠️ يرجى إدخال كلمة السر');
      passwordInput.focus();
      return;
    }

    // تعطيل الزر
    window.UI.setLoading(loginBtn, true, 'جاري التحقق...');

    try {
      const result = await window.Core.login(username, password);

      if (result.success) {
        // ✅ إذا كان يجب تغيير كلمة السر → صفحة مخصصة
        if (result.user && result.user.mustChangePassword) {
          window.location.href = '/admin/change-password-required.html';
          return;
        }
        // إذا كان هناك تعارض — نوجّه للوحة المعلومات (سيظهر الـ freeze overlay)
        window.location.href = '/admin/dashboard.html';
        return;
      }
    } catch (err) {
      showError('❌ ' + (err.userMessage || 'تعذر تسجيل الدخول'));
      passwordInput.value = '';
      passwordInput.focus();
    } finally {
      window.UI.setLoading(loginBtn, false);
    }
  }

    // ============================================================
  //  👁️ إظهار/إخفاء كلمة السر
  // ============================================================
  const passwordToggle = document.getElementById('passwordToggle');
  if (passwordToggle && passwordInput) {
    passwordToggle.addEventListener('click', function() {
      const currentType = passwordInput.getAttribute('type');
      const nextType = currentType === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', nextType);

      const icon = this.querySelector('i');
      if (icon) {
        icon.className = nextType === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
      }

      passwordInput.focus();
    });
  }

  // ============================================================
  //  ⚠️ معالجة reason=disabled من الـ redirect
  // ============================================================
  (function handleRedirectReason() {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get('reason');

    if (reason === 'disabled') {
      showError('🔒 الحساب معطَّل. يرجى التواصل مع superAdmin لإعادة التفعيل.');
      // نظّف الـ URL من reason
      try {
        history.replaceState(null, '', window.location.pathname);
      } catch (e) {}
    }
  })();

  // ============================================================
  //  🎯 ربط الأحداث
  // ============================================================
  if (form) {
    form.addEventListener('submit', handleLogin);
  }

  // إخفاء الخطأ عند الكتابة
  [usernameInput, passwordInput].forEach(function(input) {
    if (!input) return;
    input.addEventListener('input', hideError);
  });

  // التركيز على حقل اسم المستخدم
  if (usernameInput) {
    setTimeout(() => usernameInput.focus(), 200);
  }

})();