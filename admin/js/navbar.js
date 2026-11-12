// ================================================================
//  admin/js/navbar.js — منطق تحميل وتفعيل السايدبار
// ================================================================

(function() {
  'use strict';

  let navbarLoaded = false;

  // ============================================================
  //  📥 تحميل السايدبار
  // ============================================================
  async function loadNavbar(placeholderId) {
    if (navbarLoaded) return;
    placeholderId = placeholderId || 'navbarPlaceholder';

    const placeholder = document.getElementById(placeholderId);
    if (!placeholder) return;

    try {
      const response = await fetch('/admin/navbar.html', { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const html = await response.text();
      placeholder.innerHTML = html;
      navbarLoaded = true;

      initNavbar();
    } catch (e) {
      if (window.kcReportError) {
        window.kcReportError('loadNavbar failed: ' + e.message, { placeholderId: placeholderId });
      }
      // فشل صامت — السايدبار لن يظهر
    }
  }

  // ============================================================
  //  ⚙️ تهيئة السايدبار
  // ============================================================
  function initNavbar() {
    highlightActivePage();
    renderUserInfo();
    filterByPermissions();
    bindLogout();
    bindMobileToggle();
    updateThemeButtonIcon();
    bindBfcacheHandler();
  }

  // ============================================================
  //  🎯 تفعيل الصفحة الحالية
  // ============================================================
  function highlightActivePage() {
    const path = window.location.pathname;
    document.querySelectorAll('.sidebar-nav-item').forEach(function(item) {
      const href = item.getAttribute('href');
      if (href && path.endsWith(href.split('/').pop())) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  // ============================================================
  //  👤 عرض معلومات المستخدم
  // ============================================================
  function renderUserInfo() {
    const user = window.Core ? window.Core.getUser() : null;
    if (!user) return;

    const nameEl = document.getElementById('sidebarUserName');
    const roleEl = document.getElementById('sidebarUserRole');
    const avatarEl = document.getElementById('sidebarUserAvatar');

    if (nameEl) nameEl.textContent = user.fullName || user.username || '—';
    if (roleEl) roleEl.textContent = user.isSuperAdmin ? 'مدير عام' : 'مسؤول';
    if (avatarEl) {
      const initials = getInitials(user.fullName || user.username || '?');
      avatarEl.textContent = initials;
    }
  }

  function getInitials(name) {
    const parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  // ============================================================
  //  🛡️ إخفاء العناصر حسب الصلاحيات
  // ============================================================
  function filterByPermissions() {
    if (!window.Core) return;

    document.querySelectorAll('.sidebar-nav-item[data-perm]').forEach(function(item) {
      const perm = item.getAttribute('data-perm');
      const parts = perm.split('.');
      const section = parts[0];
      const action = parts[1] || 'view';

      if (!window.Core.hasPermission(section, action)) {
        item.classList.add('hidden');
      } else {
        item.classList.remove('hidden');
      }
    });
  }

  // ============================================================
  //  🚪 زر الخروج
  // ============================================================
  function bindLogout() {
    const btn = document.getElementById('sidebarLogoutBtn');
    if (!btn) return;

    btn.addEventListener('click', async function() {
      const confirmed = await window.UI.confirm({
        title: 'تسجيل الخروج',
        message: 'هل أنت متأكد من تسجيل الخروج من لوحة الأدمن؟',
        confirmText: 'تسجيل الخروج',
        type: 'warning'
      });

      if (confirmed) {
        await window.Core.logout();
      }
    });
  }

  // ============================================================
  //  📱 زر الموبايل
  // ============================================================
  function bindMobileToggle() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('adminSidebar');
    const overlay = document.getElementById('sidebarOverlay');

    if (!toggle || !sidebar) return;

    if (toggle.dataset.toggleBound !== 'true') {
      toggle.dataset.toggleBound = 'true';
      toggle.addEventListener('click', function() {
        const isOpen = sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('show', isOpen);
        // ✅ إيقاف تمرير الصفحة عند الفتح
        document.body.classList.toggle('sidebar-open', isOpen);
      });
    }

    if (overlay && overlay.dataset.toggleBound !== 'true') {
      overlay.dataset.toggleBound = 'true';
      overlay.addEventListener('click', closeSidebar);
    }

    if (!sidebar.dataset.navBound) {
      sidebar.dataset.navBound = 'true';
      sidebar.querySelectorAll('.sidebar-nav-item').forEach(function(link) {
        link.addEventListener('click', function() {
          closeSidebar();
        });
      });
    }
  }

  // ============================================================
  //  🔒 closeSidebar
  // ============================================================
  function closeSidebar() {
    const sidebar = document.getElementById('adminSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    document.body.classList.remove('sidebar-open');
  }

  // ============================================================
  //  🎨 تحديث أيقونة زر الثيم
  // ============================================================
  function updateThemeButtonIcon() {
    const btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    const icon = btn.querySelector('i');
    if (icon) {
      icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
  }

  // ============================================================
  //  🔄 bindBfcacheHandler — إغلاق السايدبار عند الرجوع/التقدم
  //  المتصفح يستعيد الحالة السابقة من bfcache، فنُغلق السايدبار
  // ============================================================
  function bindBfcacheHandler() {
    if (window.__bfcacheBound) return;
    window.__bfcacheBound = true;

    window.addEventListener('pageshow', function(event) {
      if (event.persisted) {
        closeSidebar();
      }
    });

    window.addEventListener('beforeunload', function() {
      closeSidebar();
    });
  }

  // ============================================================
  //  🌐 التصدير
  // ============================================================
  window.Navbar = {
    load: loadNavbar,
    highlight: highlightActivePage
  };

})();

// ================================================================
//  🆕 Withdrawals Badge — عرض عدد الطلبات المعلقة في السايدبار
//  - يقرأ getWithdrawalsStats (Phase 3)
//  - يعرض العدد في #withdrawalsBadge
//  - Polling كل 3 دقائق + عند رجوع التاب/الـ focus
//  - لا يعدّل أي كود موجود في الملف
// ================================================================
(function() {
  'use strict';

  const REFRESH_INTERVAL_MS = 3 * 60 * 1000; // 3 دقائق
  const INITIAL_DELAY_MS = 1500;

  let refreshIntervalId = null;
  let isFetching = false;
  let lastKnownCount = 0;

  // ============================================================
  //  Helpers
  // ============================================================
  function getBadgeEl() {
    return document.getElementById('withdrawalsBadge');
  }

  function setBadge(count) {
    const el = getBadgeEl();
    if (!el) return;

    const num = parseInt(count, 10) || 0;
    lastKnownCount = num;

    el.textContent = num > 99 ? '99+' : String(num);

    if (num > 0) {
      el.classList.remove('hidden');
      // ✅ نبض خفيف لو العدد كبر (اختياري)
      if (num > 5) {
        el.classList.add('badge-urgent');
      } else {
        el.classList.remove('badge-urgent');
      }
    } else {
      el.classList.add('hidden');
      el.classList.remove('badge-urgent');
    }
  }

  // ============================================================
  //  Fetch pending count
  // ============================================================
  async function fetchAndUpdateBadge() {
    if (isFetching) return;

    // تأكد من وجود الـ element — لو مش موجود، مفيش داعي لطلب API
    const el = getBadgeEl();
    if (!el) return;

    // تأكد من توفر Core.api
    if (!window.Core || typeof window.Core.api !== 'function') {
      return;
    }

    isFetching = true;

    try {
      const result = await window.Core.api('getWithdrawalsStats', {}, 'GET');

      if (result && result.success && result.stats) {
        // ✅ الطلبات المعلقة = submitted + under_review + sending
        const pending =
          (result.stats.submitted    || 0) +
          (result.stats.under_review || 0) +
          (result.stats.sending      || 0);

        setBadge(pending);
      }
    } catch (e) {
      // فشل صامت — نحتفظ بآخر قيمة معروفة
      console.warn('⚠️ [withdrawalsBadge] fetch failed:', e.message);
    } finally {
      isFetching = false;
    }
  }

  // ============================================================
  //  Polling setup
  // ============================================================
  function startPolling() {
    if (refreshIntervalId) return;

    // 1. تحديث أولي (بعد تحميل النافبار)
    setTimeout(fetchAndUpdateBadge, INITIAL_DELAY_MS);

    // 2. تحديث دوري
    refreshIntervalId = setInterval(fetchAndUpdateBadge, REFRESH_INTERVAL_MS);

    // 3. تحديث عند رجوع التاب
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) fetchAndUpdateBadge();
    });

    // 4. تحديث عند focus النافذة
    window.addEventListener('focus', function() {
      fetchAndUpdateBadge();
    });
  }

  // ============================================================
  //  Init
  // ============================================================
  function boot() {
    // انتظر شوية عشان الـ Navbar.load() يخلص
    setTimeout(function() {
      // تأكد أن عنصر الـ badge موجود قبل بدء الـ polling
      if (!getBadgeEl()) {
        // لو لسه مش موجود، حاول تاني بعد ثانية (edge case)
        setTimeout(function() {
          if (getBadgeEl()) startPolling();
        }, 1000);
        return;
      }
      startPolling();
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // ============================================================
  //  ✅ واجهة برمجية يدوية (اختياري — للتحديث الفوري)
  // ============================================================
  window.WithdrawalsBadge = {
    refresh: fetchAndUpdateBadge,
    getLastCount: function() { return lastKnownCount; }
  };

})();