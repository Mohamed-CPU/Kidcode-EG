// ================================================================
//  admin/js/dashboard.js — منطق لوحة المعلومات
// ================================================================

(function() {
  'use strict';

  const state = {
    isInitialized: false,
    isLoading: false,
    chart: null
  };

  // ============================================================
  //  🚀 init
  // ============================================================
  function init() {
    if (state.isInitialized) return;
    state.isInitialized = true;

    loadStats();
  }

  // ============================================================
  //  🔄 reload
  // ============================================================
  function reload() {
    if (state.isLoading) return;
    loadStats();
  }

  // ============================================================
  //  📊 loadStats
  // ============================================================
  async function loadStats() {
    state.isLoading = true;

    showSkeletons();

    try {
      const result = await window.Core.api('getDashboardStats', {}, 'GET');

      if (!result.success) {
        window.UI.toast.error(result.error || 'فشل تحميل الإحصائيات');
        return;
      }

      renderStats(result.stats);
      renderChart(result.registrationsChart);
      renderStatusList(result.stats.childrenByStatus, result.stats.children);
      renderRecentRegistrations(result.recentRegistrations);
      renderRecentActivity(result.recentActivity);

    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الاتصال بالخادم');
    } finally {
      state.isLoading = false;
    }
  }

  // ============================================================
  //  💀 Skeletons
  // ============================================================
  function showSkeletons() {
    ['statChildren', 'statMarketers', 'statNewsletter', 'statReports', 'statAdmins'].forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });

    const list = document.getElementById('statusList');
    if (list) list.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i></div>';

    const body = document.getElementById('recentRegistrationsBody');
    if (body) body.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px;"><i class="fas fa-spinner fa-spin"></i></td></tr>';

    const activity = document.getElementById('recentActivityList');
    if (activity) activity.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i></div>';
  }

  // ============================================================
  //  📊 renderStats
  // ============================================================
  function renderStats(stats) {
    const set = function(id, val) {
      const el = document.getElementById(id);
      if (el) el.textContent = formatNumber(val);
    };

    set('statChildren', stats.children);
    set('statMarketers', stats.marketers);
    set('statNewsletter', stats.newsletter);
    set('statReports', stats.reports);
    set('statAdmins', stats.admins);
  }

  // ============================================================
  //  📈 renderChart
  // ============================================================
  function renderChart(data) {
    const canvas = document.getElementById('registrationsChart');
    if (!canvas) return;

    const labels = (data || []).map(function(d) {
      // عرض مختصر: DD/MM
      const parts = d.date.split('-');
      return parts[2] + '/' + parts[1];
    });

    const values = (data || []).map(function(d) { return d.count; });

    // إتلاف الرسم القديم
    if (state.chart) {
      try { state.chart.destroy(); } catch (e) {}
      state.chart = null;
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(100, 116, 139, 0.12)';
    const textColor = isDark ? '#94A3B8' : '#64748B';
    const accentColor = isDark ? '#818CF8' : '#6366F1';

    state.chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'التسجيلات',
          data: values,
          borderColor: accentColor,
          backgroundColor: accentColor + '20',
          borderWidth: 2,
          pointBackgroundColor: accentColor,
          pointBorderColor: '#FFFFFF',
          pointBorderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 6,
          tension: 0.35,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            rtl: true,
            textDirection: 'rtl',
            backgroundColor: isDark ? '#1E293B' : '#0F172A',
            titleFont: { family: 'IBM Plex Sans Arabic', size: 13 },
            bodyFont: { family: 'IBM Plex Sans Arabic', size: 13 },
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              title: function(items) {
                return 'التاريخ: ' + items[0].label;
              },
              label: function(item) {
                return 'التسجيلات: ' + item.parsed.y;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: textColor,
              font: { family: 'IBM Plex Sans Arabic', size: 11 },
              maxRotation: 0,
              autoSkipPadding: 15
            }
          },
          y: {
            beginAtZero: true,
            grid: { color: gridColor, drawBorder: false },
            ticks: {
              color: textColor,
              font: { family: 'IBM Plex Sans Arabic', size: 11 },
              precision: 0
            }
          }
        }
      }
    });
  }

  // ============================================================
  //  📋 renderStatusList
  // ============================================================
  function renderStatusList(byStatus, total) {
    const container = document.getElementById('statusList');
    if (!container) return;

    const labels = {
      active: 'نشط',
      pending: 'قيد التفعيل',
      disabled: 'معطَّل',
      suspended: 'موقوف',
      expired: 'منتهي',
      deleted: 'محذوف',
      other: 'أخرى'
    };

    let html = '';
    ['active', 'pending', 'disabled', 'suspended', 'expired', 'deleted', 'other'].forEach(function(key) {
      const count = byStatus[key] || 0;
      if (key === 'other' && count === 0) return;
      html += '<div class="status-item">' +
        '<div class="status-item-left">' +
          '<span class="status-dot ' + key + '"></span>' +
          '<span class="status-label">' + labels[key] + '</span>' +
        '</div>' +
        '<span class="status-value">' + formatNumber(count) + '</span>' +
      '</div>';
    });

    container.innerHTML = html;
  }

  // ============================================================
  //  👶 renderRecentRegistrations
  // ============================================================
  function renderRecentRegistrations(list) {
    const body = document.getElementById('recentRegistrationsBody');
    if (!body) return;

    if (!list || list.length === 0) {
      body.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">لا توجد تسجيلات بعد</td></tr>';
      return;
    }

    const statusMap = {
      'active':   { label: 'نشط', cls: 'badge-success' },
      'pending':  { label: 'قيد التفعيل', cls: 'badge-warning' },
      'disabled': { label: 'معطَّل', cls: 'badge-muted' },
      'suspended':{ label: 'موقوف', cls: 'badge-danger' },
      'expired':  { label: 'منتهي', cls: 'badge-danger' },
      'deleted':  { label: 'محذوف', cls: 'badge-muted' }
    };

    let html = '';
    list.forEach(function(r) {
      const s = String(r.status || '').toLowerCase();
      const info = statusMap[s] || { label: r.status || '—', cls: 'badge-muted' };
      // ✅ تاريخ التسجيل بصيغة سطرين (عربي كامل)
      const dateCell = buildTwoLineDateCell(r.registrationDate);
      html += '<tr>' +
        '<td class="cell-id">' + window.UI.escapeHtml(r.childID || '—') + '</td>' +
        '<td>' + window.UI.escapeHtml(r.childName || '—') + '</td>' +
        '<td><span class="badge ' + info.cls + '">' + window.UI.escapeHtml(info.label) + '</span></td>' +
        '<td>' + window.UI.escapeHtml(r.plan || '—') + '</td>' +
        '<td>' + dateCell + '</td>' +
      '</tr>';
    });

    body.innerHTML = html;
  }

  // ============================================================
  //  📋 renderRecentActivity
  // ============================================================
  function renderRecentActivity(list) {
    const container = document.getElementById('recentActivityList');
    if (!container) return;

    if (!list || list.length === 0) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>لا توجد عمليات</p></div>';
      return;
    }

    let html = '';
    list.forEach(function(a) {
      // ✅ التاريخ بصيغة عربية (كان ISO خام)
      const dateStr = window.AdminUtils.formatDateTime(a.created_at) || '—';
      html += '<div class="activity-item">' +
        '<div class="activity-icon"><i class="fas ' + getActionIcon(a.action) + '"></i></div>' +
        '<div class="activity-info">' +
          '<div class="activity-action">' + window.UI.escapeHtml(getActionLabel(a.action)) + '</div>' +
          '<div class="activity-meta">' + window.UI.escapeHtml(a.username || '—') + ' · ' + window.UI.escapeHtml(dateStr) + '</div>' +
        '</div>' +
      '</div>';
    });

    container.innerHTML = html;
  }

  // ============================================================
  //  🛠️ Helpers
  // ============================================================
  function formatNumber(n) {
    if (typeof n !== 'number') return '—';
    return n.toLocaleString('ar-EG');
  }

  // ✅ Helper: بناء خلية تاريخ بصيغة سطرين (date عربي + time صغير)
  function buildTwoLineDateCell(value) {
    if (!value) return '—';
    try {
      const dateStr = window.AdminUtils.formatDate(value) || '—';
      const timeStr = window.AdminUtils.formatCairoTime(value) || '';
      if (!timeStr || dateStr === '—') {
        return window.UI.escapeHtml(dateStr);
      }
      return '<div style="font-size:0.82rem; font-weight:600; color:var(--text-primary);">' +
               window.UI.escapeHtml(dateStr) +
             '</div>' +
             '<div style="font-size:0.72rem; color:var(--text-muted); margin-top:2px;">' +
               window.UI.escapeHtml(timeStr) +
             '</div>';
    } catch (e) {
      return '—';
    }
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
      'super_admin_created': 'fa-user-plus'
    };
    return map[action] || 'fa-circle';
  }

  function getActionLabel(action) {
    const map = {
      'login_success': 'تسجيل دخول ناجح',
      'login_failed_wrong_password': 'فشل دخول (كلمة مرور خاطئة)',
      'login_failed_unknown_user': 'فشل دخول (مستخدم غير موجود)',
      'login_blocked_rate_limit': 'محظور (محاولات كثيرة)',
      'login_success_conflict': 'دخول مع تعارض',
      'logout': 'تسجيل خروج',
      'session_conflict_detected': 'اكتشاف تعارض',
      'password_changed': 'تغيير كلمة السر',
      'password_changed_via_token': 'تغيير كلمة السر (بريد)',
      'password_change_requested_from_frozen': 'طلب رابط تغيير كلمة السر',
      'profile_updated': 'تحديث الاسم',
      'session_terminated': 'إنهاء جلسة',
      'i_didnt_request_triggered': 'إبلاغ أمني',
      'account_disabled_frozen_timeout': 'تعطيل تلقائي',
      'super_admin_created': 'إنشاء super_admin'
    };
    return map[action] || action;
  }

  // ============================================================
  //  🌐 التصدير
  // ============================================================
  window.DashboardPage = {
    init: init,
    reload: reload
  };

})();