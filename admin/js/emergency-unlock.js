// ================================================================
//  admin/js/emergency-unlock.js — دخول الطوارئ
// ================================================================

(function() {
  'use strict';

  const API = '/api?action=admin';
  const TOKEN_KEY = 'adminSessionToken';
  const CSRF_KEY  = 'adminCsrfToken';
  const USER_KEY  = 'adminUser';
  const THEME_KEY = 'admin_theme';

  // ثيم فوري
  try {
    const saved = localStorage.getItem(THEME_KEY) || 'light';
    document.documentElement.setAttribute('data-theme', saved === 'dark' ? 'dark' : 'light');
  } catch (e) {}

  function el(id) { return document.getElementById(id); }

  function setLoading(on) {
    const btn = el('submitBtn');
    if (btn) btn.disabled = !!on;
  }

  function showError(msg) {
    const e = el('errorText');
    if (e) { e.textContent = msg; e.style.display = 'block'; }
  }

  function hideError() {
    const e = el('errorText');
    if (e) e.style.display = 'none';
  }

  function showStatus(text) {
    const form = el('formBox');
    const status = el('statusBox');
    const st = el('statusText');
    if (form) form.style.display = 'none';
    if (status) status.style.display = 'flex';
    if (st) st.textContent = text || 'جاري التحقق...';
  }

  function saveSession(data) {
    try {
      if (data.sessionToken) {
        localStorage.setItem(TOKEN_KEY, data.sessionToken);
        const maxAge = 21600;
        document.cookie =
          'admin_session=' + encodeURIComponent(data.sessionToken) +
          '; Path=/; Max-Age=' + maxAge + '; SameSite=Lax; Secure';
      }
      if (data.csrfToken) localStorage.setItem(CSRF_KEY, data.csrfToken);
      if (data.user)      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    } catch (e) {}
  }

  async function submit() {
    hideError();

    const input = el('codeInput');
    const code = String((input && input.value) || '').trim();

    if (!code) {
      showError('الرجاء إدخال الرمز.');
      return;
    }

    setLoading(true);
    showStatus('جاري التحقق...');

    let response;
    try {
      response = await fetch(API + '&innerAction=emergencyUnlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code })
      });
    } catch (e) {
      setLoading(false);
      el('statusBox').style.display = 'none';
      el('formBox').style.display = 'flex';
      showError('تعذر الاتصال بالخادم.');
      return;
    }

    let data;
    try { data = await response.json(); }
    catch (e) {
      setLoading(false);
      el('statusBox').style.display = 'none';
      el('formBox').style.display = 'flex';
      showError('استجابة غير صالحة من الخادم.');
      return;
    }

    if (!response.ok || !data || !data.success) {
      setLoading(false);
      el('statusBox').style.display = 'none';
      el('formBox').style.display = 'flex';
      showError((data && data.message) || 'الرمز غير صحيح.');
      if (input) input.value = '';
      return;
    }

    showStatus('تم الدخول — جاري التوجيه...');
    saveSession(data);

    if (data.user && data.user.mustChangePassword) {
      window.location.href = '/admin/change-password-required.html';
      return;
    }
    window.location.href = '/admin/dashboard.html';
  }

  function init() {
    const btn = el('submitBtn');
    const input = el('codeInput');
    if (btn) btn.addEventListener('click', submit);
    if (input) {
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
      input.addEventListener('input', function() {
        this.value = this.value.toUpperCase();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();