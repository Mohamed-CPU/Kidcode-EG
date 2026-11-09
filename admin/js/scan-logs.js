// ================================================================
//  admin/js/scan-logs.js — منطق صفحة سجل المسحات
// ================================================================

(function() {
  'use strict';

  const state = {
    isInitialized: false,
    page: 1,
    pageSize: 50,
    search: '',
    childID: '',
    source: '',
    fromDate: '',
    toDate: '',
    sortDir: 'desc',
    list: [],
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 }
  };

  // ✅ لمنع Race Condition — يتم توليد معرف لكل طلب
  let currentRequestId = 0;

  // ============================================================
  //  🚀 init
  // ============================================================
  function init() {
    if (state.isInitialized) return;
    state.isInitialized = true;

    bindEvents();
    loadStats();
    loadList();
  }

  function reload() {
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

    const sourceFilter = document.getElementById('sourceFilter');
    if (sourceFilter) {
      sourceFilter.addEventListener('change', function() {
        state.source = sourceFilter.value;
        state.page = 1;
        loadList();
      });
    }

    const clearBtn = document.getElementById('clearFiltersBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        document.getElementById('searchInput').value = '';
        document.getElementById('fromDate').value = '';
        document.getElementById('toDate').value = '';
        document.getElementById('sourceFilter').value = '';
        state.search = ''; state.source = '';
        state.fromDate = ''; state.toDate = ''; state.page = 1;
        loadList();
      });
    }

    const cleanupBtn = document.getElementById('cleanupBtn');
    if (cleanupBtn) cleanupBtn.addEventListener('click', openCleanupModal);
  }

  // ============================================================
  //  📊 loadStats
  // ============================================================
  async function loadStats() {
    try {
      const result = await window.Core.api('getScanLogsStats', {}, 'GET');
      if (!result.success) return;

      setStat('statTotal', result.total);
      setStat('stat24h', result.last24h);
      setStat('stat7d', result.last7d);
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
    // ✅ ولّد معرفًا فريدًا لكل طلب
    const myRequestId = ++currentRequestId;
    console.log('[loadList] طلب رقم:', myRequestId, '| search:', JSON.stringify(state.search));

    showTableLoading();

    try {
      const result = await window.Core.api('getScanLogsList', {
        page: state.page,
        pageSize: state.pageSize,
        search: state.search,
        source: state.source,
        fromDate: state.fromDate,
        toDate: state.toDate,
        sortDir: state.sortDir
      }, 'GET');

      // ✅ تجاهل الطلبات القديمة التي اكتملت بعد طلب أحدث
      if (myRequestId !== currentRequestId) {
        console.log('[loadList] تجاهل نتيجة قديمة (طلب', myRequestId, '/ الحالي', currentRequestId, ')');
        return;
      }

      if (!result.success) {
        window.UI.toast.error(result.error || 'فشل تحميل القائمة');
        showEmptyTable('فشل التحميل');
        return;
      }

      state.list = result.list || [];
      state.pagination = result.pagination || { page: 1, pageSize: 50, total: 0, totalPages: 0 };

      console.log('[loadList] عرض', state.list.length, 'نتيجة | Total:', state.pagination.total);

      renderList();
      renderPagination();
      updateInfo();
    } catch (e) {
      if (myRequestId !== currentRequestId) return;
      window.UI.toast.error(e.userMessage || 'تعذر الاتصال بالخادم');
      showEmptyTable('فشل التحميل');
    }
  }

  // ============================================================
  //  🎨 Render List
  // ============================================================
  function renderList() {
    const body = document.getElementById('scanLogsTableBody');
    if (!body) return;

    if (state.list.length === 0) {
      showEmptyTable('لا توجد نتائج');
      return;
    }

    const startIndex = (state.pagination.page - 1) * state.pagination.pageSize;

    let html = '';
    state.list.forEach(function(log, i) {
      const sourceCls = getSourceClass(log.source);
      const sourceLabel = getSourceLabel(log.source);
      const mapsBtn = log.hasCoords
        ? '<a href="' + escapeAttr(log.mapsLink) + '" target="_blank" rel="noopener" class="btn btn-sm btn-secondary" title="فتح الخريطة"><i class="fas fa-map"></i></a>'
        : '<span style="color:var(--text-muted); font-size:0.7rem;">—</span>';

      html += '<tr>' +
        '<td class="cell-num">' + (startIndex + i + 1) + '</td>' +
        '<td class="cell-time">' + window.UI.escapeHtml(formatDateTime(log.timestamp)) + '</td>' +
        '<td class="cell-id">' + window.UI.escapeHtml(log.childID || '—') + '</td>' +
        '<td class="cell-name col-name">' + window.UI.escapeHtml(log.childName || '—') + '</td>' +
        '<td class="col-source"><span class="cell-source ' + sourceCls + '">' + window.UI.escapeHtml(sourceLabel) + '</span></td>' +
        '<td class="cell-address col-address" title="' + escapeAttr(log.address) + '">' + window.UI.escapeHtml(log.address || '—') + '</td>' +
        '<td class="cell-ip col-ip">' + window.UI.escapeHtml(log.ip || '—') + '</td>' +
        '<td>' + mapsBtn + '</td>' +
        '<td class="cell-actions">' +
          '<button class="btn btn-sm btn-danger delete-log-btn" data-id="' + log.id + '" title="حذف"><i class="fas fa-trash-alt"></i></button>' +
        '</td>' +
      '</tr>';
    });

    body.innerHTML = html;

    body.querySelectorAll('.delete-log-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        deleteLog(parseInt(this.getAttribute('data-id')));
      });
    });
  }

  function showTableLoading() {
    const body = document.getElementById('scanLogsTableBody');
    if (body) {
      body.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:40px;">' +
        '<i class="fas fa-spinner fa-spin" style="font-size:1.5rem; color:var(--accent);"></i></td></tr>';
    }
  }

  function showEmptyTable(msg) {
    const body = document.getElementById('scanLogsTableBody');
    if (body) {
      body.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:40px; color:var(--text-muted);">' +
        window.UI.escapeHtml(msg) + '</td></tr>';
    }
  }

  function updateInfo() {
    const el = document.getElementById('listInfo');
    if (!el) return;
    el.textContent = 'إجمالي: ' + formatNumber(state.pagination.total || 0) + ' سجل';
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
  //  🗑️ deleteLog
  // ============================================================
  async function deleteLog(id) {
    if (!id) return;

    const ok = await window.UI.confirm({
      title: 'حذف سجل',
      message: 'سيتم حذف هذا السجل نهائيًا. هل أنت متأكد؟',
      confirmText: 'حذف',
      type: 'danger'
    });
    if (!ok) return;

    try {
      const result = await window.Core.api('deleteScanLog', { id: id }, 'POST');
      if (result.success) {
        window.UI.toast.success('تم حذف السجل');
        loadStats();
        loadList();
      } else {
        window.UI.toast.error(result.message || 'فشل الحذف');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الحذف');
    }
  }

  // ============================================================
  //  🧹 Cleanup Modal (سنستخدم prompt بسيط)
  // ============================================================
  async function openCleanupModal() {
    const ok = await window.UI.confirm({
      title: '🧹 تنظيف السجلات القديمة',
      message: 'سيتم حذف كل السجلات الأقدم من 12 شهرًا. سياسة الاحتفاظ الافتراضية هي 12 شهرًا. متابعة؟',
      confirmText: 'تنظيف',
      type: 'warning'
    });
    if (!ok) return;

    const monthsStr = window.prompt('أدخل عدد الأشهر للاحتفاظ (الافتراضي: 12):', '12');
    if (monthsStr === null) return;

    const months = parseInt(monthsStr) || 12;

    try {
      const result = await window.Core.api('cleanupOldScanLogs', { months: months }, 'POST');
      if (result.success) {
        window.UI.toast.success(result.message || 'تم التنظيف');
        loadStats();
        loadList();
      } else {
        window.UI.toast.error(result.message || 'فشل التنظيف');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر التنظيف');
    }
  }

  // ============================================================
  //  🛠️ Helpers
  // ============================================================
  function getSourceClass(source) {
    const s = String(source || '').toLowerCase();
    if (s.startsWith('auto')) return 'src-auto';
    if (s.startsWith('periodic')) return 'src-periodic';
    if (s.startsWith('gps') || s.startsWith('manual')) {
      if (s.includes('refused') || s.includes('failed')) return 'src-refused';
      return 'src-manual';
    }
    if (s.includes('page_open')) return 'src-periodic';
    return '';
  }

  function getSourceLabel(source) {
    const s = String(source || '').trim();
    const map = {
      'page_open': 'فتح الصفحة',
      'auto_on_page_load': 'تلقائي عند الفتح',
      'periodic_tick': 'تتبع دوري',
      'gps_manual': 'GPS مباشر',
      'manual_refused': 'رفض من المستخدم',
      'manual_failed': 'فشل من المستخدم',
      'auto_refused': 'رفض تلقائي',
      'auto_failed': 'فشل تلقائي',
      'auto_browser_not_support': 'متصفح غير مدعوم',
      'unknown': 'غير معروف'
    };
    return map[s] || s || '—';
  }

  function formatDateTime(value) {
    return window.AdminUtils.formatDateTime(value);
  }

  function formatNumber(n) {
    if (typeof n !== 'number') return '—';
    return n.toLocaleString('ar-EG');
  }

  function escapeAttr(str) {
    return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // ============================================================
  //  🌐 التصدير
  // ============================================================
  window.ScanLogsPage = {
    init: init,
    reload: reload
  };

})();