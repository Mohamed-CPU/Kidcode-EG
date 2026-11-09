// ================================================================
//  admin/js/audit-log.js — منطق سجل العمليات
// ================================================================

(function() {
  'use strict';

  let currentRequestId = 0;

  const state = {
    isInitialized: false,
    page: 1,
    pageSize: 50,
    search: '',
    username: '',
    action: '',
    targetTable: '',
    fromDate: '',
    toDate: '',
    sortDir: 'desc',
    list: [],
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 }
  };

  // ============================================================
  //  📖 قاموس الأكشنات (Label + Icon + Category)
  // ============================================================
  const ACTIONS_MAP = {
    // Auth
    'login_success': { label: 'تسجيل دخول ناجح', icon: 'fa-sign-in-alt', cat: 'auth' },
    'login_success_conflict': { label: 'دخول مع تعارض', icon: 'fa-exclamation-triangle', cat: 'security' },
    'login_failed_wrong_password': { label: 'فشل دخول (باسورد خاطئ)', icon: 'fa-times-circle', cat: 'security' },
    'login_failed_unknown_user': { label: 'فشل دخول (مستخدم غير موجود)', icon: 'fa-user-slash', cat: 'security' },
    'login_blocked_rate_limit': { label: 'محظور (محاولات كثيرة)', icon: 'fa-ban', cat: 'security' },
    'login_failed_inactive': { label: 'فشل دخول (حساب معطَّل)', icon: 'fa-lock', cat: 'security' },
    'logout': { label: 'تسجيل خروج', icon: 'fa-sign-out-alt', cat: 'auth' },
    'session_conflict_detected': { label: 'تعارض جلسات', icon: 'fa-exclamation-triangle', cat: 'security' },
    'session_terminated': { label: 'إنهاء جلسة', icon: 'fa-user-times', cat: 'security' },
    'password_changed': { label: 'تغيير كلمة السر', icon: 'fa-key', cat: 'auth' },
    'password_changed_via_token': { label: 'تغيير كلمة السر (بريد)', icon: 'fa-key', cat: 'auth' },
    'password_change_requested_from_frozen': { label: 'طلب رابط تغيير باسورد', icon: 'fa-envelope', cat: 'security' },
    'i_didnt_request_triggered': { label: 'إبلاغ أمني', icon: 'fa-shield-halved', cat: 'security' },
    'account_disabled_frozen_timeout': { label: 'تعطيل تلقائي', icon: 'fa-lock', cat: 'security' },
    'profile_updated': { label: 'تحديث الملف الشخصي', icon: 'fa-user-edit', cat: 'update' },
    'first_login_password_changed': { label: 'تعيين باسورد أول دخول', icon: 'fa-key', cat: 'auth' },
    'update_theme': { label: 'تغيير الثيم', icon: 'fa-palette', cat: 'update' },

    // Admins
    'super_admin_created': { label: 'إنشاء super_admin', icon: 'fa-user-plus', cat: 'create' },
    'create_admin': { label: 'إنشاء مسؤول', icon: 'fa-user-plus', cat: 'create' },
    'update_admin': { label: 'تعديل مسؤول', icon: 'fa-user-edit', cat: 'update' },
    'enable_admin': { label: 'تفعيل مسؤول', icon: 'fa-user-check', cat: 'update' },
    'disable_admin': { label: 'تعطيل مسؤول', icon: 'fa-user-slash', cat: 'delete' },
    'reset_admin_password': { label: 'إعادة باسورد مسؤول', icon: 'fa-key', cat: 'update' },
    'hard_delete_admin': { label: 'حذف مسؤول نهائي', icon: 'fa-user-times', cat: 'delete' },

    // Children
    'update_child': { label: 'تعديل طفل', icon: 'fa-child', cat: 'update' },
    'delete_child': { label: 'حذف منطقي للطفل', icon: 'fa-trash', cat: 'delete' },
    'hard_delete_child': { label: 'حذف طفل نهائي', icon: 'fa-trash-alt', cat: 'delete' },
    'update_child_image': { label: 'تحديث صورة طفل', icon: 'fa-image', cat: 'update' },
    'extend_subscription': { label: 'تمديد اشتراك', icon: 'fa-calendar-plus', cat: 'update' },
    'reset_child_password': { label: 'إعادة باسورد طفل', icon: 'fa-key', cat: 'update' },
    'bulk_update_status': { label: 'تحديث جماعي (أطفال)', icon: 'fa-users-cog', cat: 'update' },

    // Marketers
    'update_marketer': { label: 'تعديل مسوق', icon: 'fa-user-tie', cat: 'update' },
    'toggle_marketer_active': { label: 'تفعيل/تعطيل مسوق', icon: 'fa-toggle-on', cat: 'update' },
    'reset_marketer_password': { label: 'إعادة باسورد مسوق', icon: 'fa-key', cat: 'update' },
    'hard_delete_marketer': { label: 'حذف مسوق نهائي', icon: 'fa-trash-alt', cat: 'delete' },
    'bulk_update_marketers': { label: 'تحديث جماعي (مسوقين)', icon: 'fa-users-cog', cat: 'update' },

    // Newsletter
    'update_subscriber': { label: 'تعديل مشترك', icon: 'fa-user-edit', cat: 'update' },
    'delete_subscriber': { label: 'حذف مشترك', icon: 'fa-trash', cat: 'delete' },
    'bulk_update_subscribers': { label: 'تحديث جماعي (مشتركين)', icon: 'fa-users-cog', cat: 'update' },
    'bulk_delete_subscribers': { label: 'حذف جماعي (مشتركين)', icon: 'fa-trash-alt', cat: 'delete' },

    // Scan Logs
    'delete_scan_log': { label: 'حذف سجل مسح', icon: 'fa-trash', cat: 'delete' },
    'cleanup_scan_logs': { label: 'تنظيف سجلات المسح', icon: 'fa-broom', cat: 'delete' },

    // Emails
    'send_single_email': { label: 'إرسال فردي', icon: 'fa-paper-plane', cat: 'email' },
    'send_bulk_email': { label: 'إرسال جماعي', icon: 'fa-paper-plane', cat: 'email' },
    'send_custom_email': { label: 'إرسال مخصص', icon: 'fa-paper-plane', cat: 'email' },
    'cancel_campaign': { label: 'إلغاء حملة', icon: 'fa-ban', cat: 'email' },

    // Reports
    'update_report': { label: 'تعديل بلاغ', icon: 'fa-edit', cat: 'update' },
    'close_report': { label: 'إغلاق بلاغ', icon: 'fa-check-circle', cat: 'update' },
    'delete_report': { label: 'حذف بلاغ', icon: 'fa-trash-alt', cat: 'delete' }
  };

  // ============================================================
  //  🚀 init
  // ============================================================
  function init() {
    if (state.isInitialized) return;
    state.isInitialized = true;

    bindEvents();
    loadFilters();
    loadStats();
    loadList();
  }

  function reload() {
    loadFilters();
    loadStats();
    loadList();
  }

  // ============================================================
  //  🎯 ربط الأحداث
  // ============================================================
  function bindEvents() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      let timer = null;
      searchInput.addEventListener('input', function() {
        clearTimeout(timer);
        timer = setTimeout(function() {
          state.search = searchInput.value.trim();
          state.page = 1;
          loadList();
        }, 400);
      });
    }

    ['usernameFilter', 'actionFilter', 'targetTableFilter'].forEach(function(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', function() {
        state.username = document.getElementById('usernameFilter').value;
        state.action = document.getElementById('actionFilter').value;
        state.targetTable = document.getElementById('targetTableFilter').value;
        state.page = 1;
        loadList();
      });
    });

    const fromDate = document.getElementById('fromDate');
    if (fromDate) {
      fromDate.addEventListener('change', function() {
        state.fromDate = fromDate.value;
        state.page = 1;
        loadList();
      });
    }

    const toDate = document.getElementById('toDate');
    if (toDate) {
      toDate.addEventListener('change', function() {
        state.toDate = toDate.value;
        state.page = 1;
        loadList();
      });
    }

    const clearBtn = document.getElementById('clearFiltersBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        document.getElementById('searchInput').value = '';
        document.getElementById('usernameFilter').value = '';
        document.getElementById('actionFilter').value = '';
        document.getElementById('targetTableFilter').value = '';
        document.getElementById('fromDate').value = '';
        document.getElementById('toDate').value = '';
        state.search = ''; state.username = ''; state.action = '';
        state.targetTable = ''; state.fromDate = ''; state.toDate = '';
        state.page = 1;
        loadList();
      });
    }

    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportToCSV);

    const closeDetailsBtn = document.getElementById('closeDetailsBtn');
    const closeDetailsBtn2 = document.getElementById('closeDetailsBtn2');
    if (closeDetailsBtn) closeDetailsBtn.addEventListener('click', function() {
      window.UI.modal.close('detailsModal');
    });
    if (closeDetailsBtn2) closeDetailsBtn2.addEventListener('click', function() {
      window.UI.modal.close('detailsModal');
    });
  }

  // ============================================================
  //  🎯 loadFilters
  // ============================================================
  async function loadFilters() {
    try {
      const result = await window.Core.api('getAuditLogFilters', {}, 'GET');
      if (!result.success) return;

      fillSelect('usernameFilter', result.usernames || [], 'كل المستخدمين');
      fillSelect('targetTableFilter', result.targetTables || [], 'كل الجداول');

      // للأكشنات، نعرض label بدل المفتاح
      const actionSelect = document.getElementById('actionFilter');
      if (actionSelect) {
        actionSelect.innerHTML = '<option value="">كل الإجراءات</option>';
        (result.actions || []).forEach(function(a) {
          const info = ACTIONS_MAP[a];
          const label = info ? info.label : a;
          const opt = document.createElement('option');
          opt.value = a;
          opt.textContent = label;
          actionSelect.appendChild(opt);
        });
      }
    } catch (e) {}
  }

  function fillSelect(id, values, defaultLabel) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">' + defaultLabel + '</option>';
    values.forEach(function(v) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      el.appendChild(opt);
    });
  }

  // ============================================================
  //  📊 loadStats
  // ============================================================
  async function loadStats() {
    try {
      const result = await window.Core.api('getAuditLogStats', {}, 'GET');
      if (!result.success) return;
      setStat('statTotal', result.total);
      setStat('statToday', result.today);
      setStat('statWeek', result.thisWeek);
    } catch (e) {}
  }

  function setStat(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = formatNumber(value);
  }

  // ============================================================
  //  📊 loadList
  // ============================================================
  async function loadList() {
    const myRequestId = ++currentRequestId;
    showTableLoading();

    try {
      const result = await window.Core.api('getAuditLogList', {
        page: state.page,
        pageSize: state.pageSize,
        search: state.search,
        username: state.username,
        actionFilter: state.action,
        targetTable: state.targetTable,
        fromDate: state.fromDate,
        toDate: state.toDate,
        sortDir: state.sortDir
      }, 'GET');

      if (myRequestId !== currentRequestId) return;

      if (!result.success) {
        window.UI.toast.error(result.error || 'فشل التحميل');
        showEmptyTable('فشل التحميل');
        return;
      }

      state.list = result.list || [];
      state.pagination = result.pagination || { page: 1, pageSize: 50, total: 0, totalPages: 0 };

      renderList();
      renderPagination();
      updateInfo();
    } catch (e) {
      if (myRequestId !== currentRequestId) return;
      window.UI.toast.error(e.userMessage || 'تعذر الاتصال');
      showEmptyTable('فشل التحميل');
    }
  }

  // ============================================================
  //  🎨 Render List
  // ============================================================
  function renderList() {
    const body = document.getElementById('auditTableBody');
    if (!body) return;

    if (state.list.length === 0) {
      showEmptyTable('لا توجد عمليات مسجلة');
      return;
    }

    const startIndex = (state.pagination.page - 1) * state.pagination.pageSize;

    let html = '';
    state.list.forEach(function(row, i) {
      const info = getActionInfo(row.action);
      const target = row.targetTable && row.targetID
        ? row.targetTable + ':' + row.targetID
        : (row.targetTable || row.targetID || '—');

      html += '<tr class="audit-row" data-id="' + row.id + '">' +
        '<td class="cell-num">' + (startIndex + i + 1) + '</td>' +
        '<td class="cell-time">' + window.UI.escapeHtml(formatDateTime(row.createdAt)) + '</td>' +
        '<td class="cell-user">' + window.UI.escapeHtml(row.username || '—') + '</td>' +
        '<td class="cell-action">' +
          '<span class="action-badge ' + info.cat + '">' +
            '<i class="fas ' + info.icon + '"></i> ' +
            window.UI.escapeHtml(info.label) +
          '</span>' +
        '</td>' +
        '<td class="cell-target col-target" title="' + escapeAttr(target) + '">' + window.UI.escapeHtml(target) + '</td>' +
        '<td class="cell-ip col-ip">' + window.UI.escapeHtml(row.ipAddress || '—') + '</td>' +
        '<td class="cell-actions">' +
          '<button class="btn btn-sm btn-secondary view-details-btn" data-id="' + row.id + '" title="تفاصيل">' +
            '<i class="fas fa-eye"></i>' +
          '</button>' +
        '</td>' +
      '</tr>';
    });

    body.innerHTML = html;

    body.querySelectorAll('.view-details-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const id = parseInt(this.getAttribute('data-id'));
        openDetails(id);
      });
    });

    body.querySelectorAll('.audit-row').forEach(function(tr) {
      tr.addEventListener('click', function() {
        const id = parseInt(this.getAttribute('data-id'));
        openDetails(id);
      });
    });
  }

  function showTableLoading() {
    const body = document.getElementById('auditTableBody');
    if (body) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px;">' +
        '<i class="fas fa-spinner fa-spin" style="font-size:1.5rem; color:var(--accent);"></i></td></tr>';
    }
  }

  function showEmptyTable(msg) {
    const body = document.getElementById('auditTableBody');
    if (body) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-muted);">' +
        window.UI.escapeHtml(msg) + '</td></tr>';
    }
  }

  function updateInfo() {
    const el = document.getElementById('listInfo');
    if (!el) return;
    el.textContent = 'إجمالي: ' + formatNumber(state.pagination.total || 0) + ' عملية';
  }

  // ============================================================
  //  📄 Pagination
  // ============================================================
  function renderPagination() {
    const bar = document.getElementById('paginationBar');
    if (!bar) return;

    const p = state.pagination;
    if (!p || p.totalPages <= 1) { bar.innerHTML = ''; return; }

    let html = '';
    html += '<button ' + (p.page === 1 ? 'disabled' : '') + ' data-page="' + (p.page - 1) + '"><i class="fas fa-chevron-right"></i></button>';

    const maxVisible = 5;
    let start = Math.max(1, p.page - Math.floor(maxVisible / 2));
    let end = Math.min(p.totalPages, start + maxVisible - 1);
    if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);

    if (start > 1) {
      html += '<button data-page="1">1</button>';
      if (start > 2) html += '<span class="pagination-ellipsis">…</span>';
    }

    for (let i = start; i <= end; i++) {
      html += '<button class="' + (i === p.page ? 'active' : '') + '" data-page="' + i + '">' + i + '</button>';
    }

    if (end < p.totalPages) {
      if (end < p.totalPages - 1) html += '<span class="pagination-ellipsis">…</span>';
      html += '<button data-page="' + p.totalPages + '">' + p.totalPages + '</button>';
    }

    html += '<button ' + (p.page === p.totalPages ? 'disabled' : '') + ' data-page="' + (p.page + 1) + '"><i class="fas fa-chevron-left"></i></button>';

    bar.innerHTML = html;

    bar.querySelectorAll('button[data-page]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const p2 = parseInt(this.getAttribute('data-page'));
        if (!isNaN(p2) && p2 !== state.page && p2 >= 1 && p2 <= p.totalPages) {
          state.page = p2;
          loadList();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  }

  // ============================================================
  //  👁️ Details
  // ============================================================
  function openDetails(id) {
    const row = state.list.find(function(r) { return r.id === id; });
    if (!row) return;

    window.UI.modal.open('detailsModal');

    const info = getActionInfo(row.action);

    let html = '';
    html += '<div class="audit-details">';

    html += detailRow('المعرف', '#' + row.id);
    html += detailRow('التاريخ والوقت', formatDateTime(row.createdAt));
    html += detailRow('المستخدم', row.username || '—');
    html += detailRow('الإجراء', info.label + ' (' + row.action + ')');
    if (row.targetTable) html += detailRow('الجدول', row.targetTable);
    if (row.targetID) html += detailRow('الهدف', row.targetID);
    if (row.ipAddress) html += detailRow('IP', row.ipAddress);
    if (row.userAgent) html += detailRow('User Agent', row.userAgent);

    html += '</div>';

    // التغييرات
    html += '<h4 style="margin:20px 0 10px; font-size:0.9rem; font-weight:800;">التغييرات</h4>';

    if (row.changes && typeof row.changes === 'object' && Object.keys(row.changes).length > 0) {
      html += '<div class="changes-viewer">' + renderChanges(row.changes) + '</div>';
    } else {
      html += '<div class="no-changes"><i class="fas fa-info-circle"></i> لا توجد تفاصيل إضافية</div>';
    }

    document.getElementById('detailsBody').innerHTML = html;
  }

  function detailRow(label, value) {
    return '<div class="audit-detail-row">' +
      '<span class="label">' + escapeHtml(label) + ':</span>' +
      '<span class="value">' + escapeHtml(value || '—') + '</span>' +
      '</div>';
  }

  // ============================================================
  //  🎨 renderChanges — عرض JSON ملون
  // ============================================================
  function renderChanges(changes) {
    try {
      const json = JSON.stringify(changes, null, 2);
      return syntaxHighlight(json);
    } catch (e) {
      return escapeHtml(String(changes));
    }
  }

  function syntaxHighlight(json) {
    // HTML escape أولًا
    let str = String(json)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // ثم تلوين
    return str.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|[{}\[\],:])/g,
      function(match) {
        let cls = 'num';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) cls = 'key';
          else cls = 'str';
        } else if (/true|false/.test(match)) {
          cls = 'bool';
        } else if (/null/.test(match)) {
          cls = 'null';
        } else if (/[{}\[\],:]/.test(match)) {
          cls = 'punct';
        }
        return '<span class="' + cls + '">' + match + '</span>';
      }
    );
  }

  // ============================================================
  //  📤 Export CSV
  // ============================================================
  async function exportToCSV() {
    const confirmed = await window.UI.confirm({
      title: 'تصدير CSV',
      message: 'سيتم تصدير العمليات وفق الفلاتر الحالية (بحد أقصى 5000). متابعة؟',
      confirmText: 'تصدير',
      type: 'info'
    });
    if (!confirmed) return;

    const btn = document.getElementById('exportBtn');
    window.UI.setLoading(btn, true, 'جاري التصدير...');

    try {
      const result = await window.Core.api('exportAuditLog', {
        search: state.search,
        username: state.username,
        actionFilter: state.action,
        targetTable: state.targetTable,
        fromDate: state.fromDate,
        toDate: state.toDate
      }, 'POST');

      if (!result.success || !result.rows) {
        window.UI.toast.error(result.error || 'فشل التصدير');
        return;
      }

      if (result.rows.length === 0) {
        window.UI.toast.warning('لا توجد بيانات للتصدير');
        return;
      }

      // بناء CSV
      const headers = ['ID', 'التاريخ', 'المستخدم', 'الإجراء', 'الجدول', 'الهدف', 'IP', 'User Agent', 'التفاصيل'];
      let csv = '\uFEFF'; // BOM للعربية
      csv += headers.map(csvEscape).join(',') + '\n';

      result.rows.forEach(function(r) {
        const row = [
          r.id,
          r.created_at,
          r.username,
          r.action,
          r.target_table,
          r.target_id,
          r.ip_address,
          r.user_agent,
          r.changes_summary
        ];
        csv += row.map(csvEscape).join(',') + '\n';
      });

      // تنزيل
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'audit-log-' + new Date().toISOString().split('T')[0] + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      window.UI.toast.success('تم التصدير (' + result.rows.length + ' عملية)');
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر التصدير');
    } finally {
      window.UI.setLoading(btn, false);
    }
  }

  function csvEscape(val) {
    const s = String(val === null || val === undefined ? '' : val);
    if (/[",\n\r]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  // ============================================================
  //  🛠️ Helpers
  // ============================================================
  function getActionInfo(action) {
    const key = String(action || '').trim();
    if (ACTIONS_MAP[key]) return ACTIONS_MAP[key];

    // Infer category
    let cat = 'other';
    let icon = 'fa-circle';

    if (key.indexOf('delete') === 0 || key.indexOf('_delete') !== -1) {
      cat = 'delete';
      icon = 'fa-trash';
    } else if (key.indexOf('create') !== -1 || key.indexOf('_created') !== -1 || key.indexOf('send_') !== -1) {
      cat = key.indexOf('send_') !== -1 ? 'email' : 'create';
      icon = key.indexOf('send_') !== -1 ? 'fa-paper-plane' : 'fa-plus';
    } else if (key.indexOf('update') !== -1 || key.indexOf('edit') !== -1 || key.indexOf('toggle') !== -1) {
      cat = 'update';
      icon = 'fa-edit';
    } else if (key.indexOf('login') !== -1 || key.indexOf('logout') !== -1 || key.indexOf('password') !== -1) {
      cat = 'auth';
      icon = 'fa-key';
    } else if (key.indexOf('session') !== -1 || key.indexOf('conflict') !== -1 || key.indexOf('blocked') !== -1) {
      cat = 'security';
      icon = 'fa-shield-halved';
    }

    return { label: key || 'غير معروف', icon: icon, cat: cat };
  }

  function formatNumber(n) {
    if (typeof n !== 'number') return '—';
    return n.toLocaleString('ar-EG');
  }

  // ✅ استخدام الدوال الموحدة من AdminUtils
  function formatDateTime(value) {
    if (!value) return '—';
    return window.AdminUtils.formatDateTime(value) || '—';
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttr(str) {
    return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // ============================================================
  //  🌐 التصدير
  // ============================================================
  window.AuditLogPage = {
    init: init,
    reload: reload
  };

})();