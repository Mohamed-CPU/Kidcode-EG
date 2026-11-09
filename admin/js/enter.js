// ================================================================
//  admin/js/enter.js — استقبال رابط الدخول من تليجرام
//  - يقرأ التوكن من URL
//  - يستدعي API لاستهلاكه
//  - يخزّن الجلسة ويحوّل للوحة
// ================================================================

(function() {
  'use strict';

  // ============================================================
  //  🔧 الثوابت
  // ============================================================
  const API = '/api?action=admin';
  const TOKEN_KEY = 'adminSessionToken';
  const CSRF_KEY  = 'adminCsrfToken';
  const USER_KEY  = 'adminUser';
  const THEME_KEY = 'admin_theme';

  // ============================================================
  //  🎨 تطبيق الثيم فور التحميل (منع الوميض)
  // ============================================================
  try {
    const savedTheme = localStorage.getItem(THEME_KEY) || 'light';
    document.documentElement.setAttribute(
      'data-theme',
      savedTheme === 'dark' ? 'dark' : 'light'
    );
  } catch (e) {}

  // ============================================================
  //  🔗 قراءة التوكن من الـ URL
  // ============================================================
  function getTokenFromURL() {
    try {
      const params = new URLSearchParams(window.location.search);
      return String(params.get('token') || '').trim();
    } catch (e) {
      return '';
    }
  }

  // ============================================================
  //  🎨 Helpers للعرض
  // ============================================================
  function setStatus(text) {
    const el = document.getElementById('statusText');
    if (el) el.textContent = text;
  }

  function showError(message) {
    const statusBox = document.getElementById('statusBox');
    const errorBox = document.getElementById('errorBox');
    const errorText = document.getElementById('errorText');

    if (statusBox) statusBox.style.display = 'none';
    if (errorBox) errorBox.style.display = 'flex';
    if (errorText) errorText.textContent = message || 'حدث خطأ غير متوقع.';

    // 🍪 امسح أي كوكي قديم — لأن الرابط فشل
    try {
      document.cookie = 'admin_session=; Path=/; Max-Age=0; SameSite=Lax; Secure';
    } catch (e) {}
  }

  // ============================================================
  //  💾 حفظ الجلسة والتوجيه
  // ============================================================
  function saveAndRedirect(data) {
    try {
      if (data.sessionToken) {
        localStorage.setItem(TOKEN_KEY, data.sessionToken);
        // 🍪 Cookie للميدل وير — SameSite=Strict + Secure
        //    + نضيف نسخة بدون Secure كـ fallback (لأي مشكلة HTTPS)
        const maxAge = 21600;
        const baseCookie =
          'admin_session=' + encodeURIComponent(data.sessionToken) +
          '; Path=/' +
          '; Max-Age=' + maxAge;

        // المحاولة الأولى: Strict + Secure (الأكثر أمانًا)
        try {
          document.cookie = baseCookie + '; SameSite=Strict; Secure';
        } catch (e) {}

        // ✅ تحقق: هل الكوكي اتحفظت؟
        const saved = document.cookie.indexOf('admin_session=') !== -1;
        if (!saved) {
          // fallback: Lax بدون Secure (لو Secure رفضت لأي سبب)
          try {
            document.cookie = baseCookie + '; SameSite=Lax';
          } catch (e) {}
        }
      }
      if (data.csrfToken)    localStorage.setItem(CSRF_KEY, data.csrfToken);
      if (data.user)         localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    } catch (e) {}

    // لو يجب تغيير كلمة السر أولاً
    if (data.user && data.user.mustChangePassword) {
      window.location.href = '/admin/change-password-required.html';
      return;
    }

    // التوجيه للوحة
    window.location.href = '/admin/dashboard.html';
  }

  // ============================================================
  //  🚀 الدالة الرئيسية
  // ============================================================
  async function run() {
    const token = getTokenFromURL();
    if (!token) {
      showError('الرابط غير صحيح — لا يحتوي على توكن.');
      return;
    }

    setStatus('جاري التحقق من الرابط...');

    // 1. استدعاء الـ API
    let response;
    try {
      response = await fetch(API + '&innerAction=consumeLoginLink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token })
      });
    } catch (e) {
      showError('تعذر الاتصال بالخادم. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.');
      return;
    }

    // 2. تحليل الرد
    let data;
    try {
      data = await response.json();
    } catch (e) {
      showError('استجابة غير صالحة من الخادم.');
      return;
    }

    // 3. فحص النجاح
    if (!response.ok || !data || !data.success) {
      const msg = (data && data.message) || 'تعذر استخدام الرابط.';
      showError(msg);
      return;
    }

    // 4. نجاح — خزّن + حوّل
    setStatus('تم التحقق — جاري الدخول...');
    saveAndRedirect(data);
  }

  // ============================================================
  //  ▶️ التشغيل
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

})();