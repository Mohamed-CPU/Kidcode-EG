// ================================================================
//  admin/js/marketers.js — منطق صفحة إدارة المسوقين
// ================================================================

(function() {
  'use strict';

  const state = {
    isInitialized: false,
    isLoading: false,
    page: 1,
    pageSize: 50,
    search: '',
    status: '',
    sortBy: 'created_at',
    sortDir: 'desc',
    list: [],
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
    selectedCodes: new Set(),
    currentMarketer: null,
    currentStats: null,
    currentClients: [],
    originalValues: {},
    isSaving: false
  };

  // ============================================================
  //  🚀 init
  // ============================================================
  function init() {
    if (state.isInitialized) return;
    state.isInitialized = true;

    bindEvents();
    loadList();
  }

  function reload() { loadList(); }

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

    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter) {
      statusFilter.addEventListener('change', function() {
        state.status = statusFilter.value;
        state.page = 1;
        loadList();
      });
    }

    const clearBtn = document.getElementById('clearFiltersBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        document.getElementById('searchInput').value = '';
        document.getElementById('statusFilter').value = '';
        state.search = ''; state.status = ''; state.page = 1;
        loadList();
      });
    }

    const selectAll = document.getElementById('selectAllCheckbox');
    if (selectAll) {
      selectAll.addEventListener('change', function() {
        if (this.checked) {
          state.list.forEach(function(m) { state.selectedCodes.add(m.code); });
        } else {
          state.selectedCodes.clear();
        }
        renderList();
        updateBulkBar();
      });
    }

    const bulkApplyBtn = document.getElementById('bulkApplyBtn');
    if (bulkApplyBtn) bulkApplyBtn.addEventListener('click', applyBulkStatus);

    const bulkClearBtn = document.getElementById('bulkClearBtn');
    if (bulkClearBtn) {
      bulkClearBtn.addEventListener('click', function() {
        state.selectedCodes.clear();
        renderList();
        updateBulkBar();
      });
    }

    const closeEditBtn = document.getElementById('closeEditModalBtn');
    if (closeEditBtn) closeEditBtn.addEventListener('click', closeEditModal);

    const cancelEditBtn = document.getElementById('cancelEditBtn');
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', closeEditModal);

    const saveBtn = document.getElementById('saveChangesBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveChanges);

    document.querySelectorAll('.tab-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        switchTab(this.getAttribute('data-tab'));
      });
    });

    const resetPwdBtn = document.getElementById('resetPasswordBtn');
    if (resetPwdBtn) resetPwdBtn.addEventListener('click', resetMarketerPassword);

    const hardDeleteBtn = document.getElementById('hardDeleteMarketerBtn');
    if (hardDeleteBtn) hardDeleteBtn.addEventListener('click', hardDeleteMarketer);
  }

  // ============================================================
  //  📊 loadList
  // ============================================================
  async function loadList() {
    if (state.isLoading) return;
    state.isLoading = true;
    showTableLoading();

    try {
      const result = await window.Core.api('getMarketersList', {
        page: state.page,
        pageSize: state.pageSize,
        search: state.search,
        status: state.status,
        sortBy: state.sortBy,
        sortDir: state.sortDir
      }, 'GET');

      if (!result.success) {
        window.UI.toast.error(result.error || 'فشل تحميل القائمة');
        showEmptyTable('فشل التحميل');
        return;
      }

      state.list = result.list || [];
      state.pagination = result.pagination || { page: 1, pageSize: 50, total: 0, totalPages: 0 };
      state.selectedCodes.clear();

      renderList();
      renderPagination();
      updateBulkBar();
      updateInfo();

    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الاتصال بالخادم');
      showEmptyTable('فشل التحميل');
    } finally {
      state.isLoading = false;
    }
  }

  // ============================================================
  //  🎨 Render List
  // ============================================================
  function renderList() {
    const body = document.getElementById('marketersTableBody');
    if (!body) return;

    if (state.list.length === 0) {
      showEmptyTable('لا توجد نتائج');
      return;
    }

    let html = '';
    state.list.forEach(function(m) {
      const isSelected = state.selectedCodes.has(m.code);
      const statusCls = m.isActive === 'نشط' ? 'badge-success' : 'badge-muted';
      // ✅ تاريخ الإنشاء بصيغة سطرين عربي
      const createdCell = buildTwoLineDateCell(m.createdAt);

      html += '<tr class="marketer-row" data-code="' + escapeAttr(m.code) + '">' +
        '<td class="cell-checkbox" onclick="event.stopPropagation();">' +
          '<input type="checkbox" class="row-checkbox" data-code="' + escapeAttr(m.code) + '"' + (isSelected ? ' checked' : '') + '>' +
        '</td>' +
        '<td class="cell-code">' + window.UI.escapeHtml(m.code || '—') + '</td>' +
        '<td>' + window.UI.escapeHtml(m.name || '—') + '</td>' +
        '<td class="cell-phone col-phone">' + window.UI.escapeHtml(m.phone || '—') + '</td>' +
        '<td class="cell-email col-email" title="' + escapeAttr(m.email) + '">' + window.UI.escapeHtml(m.email || '—') + '</td>' +
        '<td class="col-governorate">' + window.UI.escapeHtml(m.governorate || '—') + '</td>' +
        '<td class="cell-discount">' + (m.discountPercent || 10) + '%</td>' +
        '<td><span class="badge ' + statusCls + '">' + window.UI.escapeHtml(m.isActive || '—') + '</span></td>' +
        '<td class="col-created">' + createdCell + '</td>' +
        '<td class="cell-actions" onclick="event.stopPropagation();">' +
          '<button class="btn btn-sm btn-secondary edit-row-btn" data-code="' + escapeAttr(m.code) + '" title="تعديل">' +
            '<i class="fas fa-edit"></i>' +
          '</button>' +
        '</td>' +
      '</tr>';
    });

    body.innerHTML = html;

    body.querySelectorAll('.row-checkbox').forEach(function(cb) {
      cb.addEventListener('change', function() {
        const code = this.getAttribute('data-code');
        if (this.checked) state.selectedCodes.add(code);
        else state.selectedCodes.delete(code);
        updateBulkBar();
        updateSelectAllCheckbox();
      });
    });

    body.querySelectorAll('.edit-row-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        openEditModal(this.getAttribute('data-code'));
      });
    });

    body.querySelectorAll('.marketer-row').forEach(function(row) {
      row.addEventListener('click', function() {
        openEditModal(this.getAttribute('data-code'));
      });
    });

    updateSelectAllCheckbox();
  }

  function showTableLoading() {
    const body = document.getElementById('marketersTableBody');
    if (body) {
      body.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:40px;">' +
        '<i class="fas fa-spinner fa-spin" style="font-size:1.5rem; color:var(--accent);"></i></td></tr>';
    }
  }

  function showEmptyTable(msg) {
    const body = document.getElementById('marketersTableBody');
    if (body) {
      body.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:40px; color:var(--text-muted);">' +
        window.UI.escapeHtml(msg) + '</td></tr>';
    }
  }

  function updateSelectAllCheckbox() {
    const cb = document.getElementById('selectAllCheckbox');
    if (!cb) return;
    if (state.list.length === 0) {
      cb.checked = false;
      cb.indeterminate = false;
      return;
    }
    const selected = state.list.filter(function(m) { return state.selectedCodes.has(m.code); }).length;
    cb.checked = selected === state.list.length;
    cb.indeterminate = selected > 0 && selected < state.list.length;
  }

  function updateInfo() {
    const el = document.getElementById('listInfo');
    if (!el) return;
    el.textContent = 'إجمالي: ' + (state.pagination.total || 0) + ' مسوق';
  }

  function updateBulkBar() {
    const bar = document.getElementById('bulkBar');
    const count = document.getElementById('bulkCount');
    if (!bar) return;
    if (state.selectedCodes.size > 0) {
      bar.classList.add('show');
      if (count) count.textContent = state.selectedCodes.size;
    } else {
      bar.classList.remove('show');
    }
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
  //  ✏️ فتح مودال التعديل
  // ============================================================
  async function openEditModal(marketerCode) {
    if (!marketerCode) return;

    window.UI.modal.open('editMarketerModal');
    document.getElementById('editModalTitle').textContent = 'جاري التحميل...';
    document.getElementById('saveChangesBtn').disabled = true;

    // امسح تبويب الإحصائيات مؤقتًا
    document.getElementById('statsGrid').innerHTML =
      '<div class="loading-state" style="grid-column:1/-1;"><i class="fas fa-spinner fa-spin"></i><p>جاري التحميل...</p></div>';
    document.getElementById('clientsList').innerHTML =
      '<li style="justify-content:center; color:var(--text-muted);">جاري التحميل...</li>';

    try {
      const result = await window.Core.api('getMarketerDetails', { code: marketerCode }, 'GET');
      if (!result.success) {
        window.UI.toast.error(result.message || 'فشل تحميل البيانات');
        closeEditModal();
        return;
      }
      state.currentMarketer = result.marketer;
      state.currentStats = result.stats;
      state.currentClients = result.clients || [];
      populateModal(result.marketer, result.stats, result.clients);
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر تحميل البيانات');
      closeEditModal();
    }
  }

  function closeEditModal() {
    window.UI.modal.close('editMarketerModal');
    state.currentMarketer = null;
    state.currentStats = null;
    state.currentClients = [];
  }

  // ============================================================
  //  📝 تعبئة المودال
  // ============================================================
  function populateModal(m, stats, clients) {
    document.getElementById('editModalTitle').textContent = 'تعديل بيانات ' + (m.name || m.code);

    setValue('edit_code', m.code || '');
    setValue('edit_name', m.name || '');
    setValue('edit_phone', m.phone || '');
    setValue('edit_email', m.email || '');
    setValue('edit_governorate', m.governorate || '');
    setSelectValue('edit_isActive', m.is_active || 'نشط');
    setValue('edit_discountPercent', parseInt(m.discount_percent || 10));
    setSelectValue('edit_notificationMethod', m.notification_method || 'email');
    // ✅ تاريخ الإنشاء بصيغة عربية كاملة (تفاصيل modal)
    setValue('edit_createdAt', formatDateTimeFull(m.created_at) || '—');

    // Telegram status
    const tgLinked = !!String(m.telegram_chat_id || '').trim();
    const tgTitle = document.getElementById('tgStatusTitle');
    const tgChat = document.getElementById('tgStatusChat');
    if (tgTitle) {
      tgTitle.textContent = tgLinked ? '✅ تليجرام مربوط' : '❌ تليجرام غير مربوط';
    }
    if (tgChat) {
      if (tgLinked) {
        const chat = String(m.telegram_chat_id);
        const masked = chat.length > 4 ? '****' + chat.slice(-4) : '****';
        // ✅ تاريخ الربط بصيغة عربية (كان ISO خام!)
        const linkedAtStr = formatDateTimeFull(m.telegram_linked_at);
        const datePart = linkedAtStr ? ' · ' + linkedAtStr : '';
        tgChat.textContent = 'Chat ID: ' + masked + datePart;
      } else {
        tgChat.textContent = 'لم يتم الربط بعد';
      }
    }

    // Stats
    renderStats(stats || {});
    renderClients(clients || []);

    // Original values
    state.originalValues = {
      name: m.name || '',
      phone: m.phone || '',
      email: m.email || '',
      governorate: m.governorate || '',
      discount_percent: parseInt(m.discount_percent || 10),
      is_active: m.is_active || 'نشط',
      notification_method: m.notification_method || 'email'
    };

    document.getElementById('saveChangesBtn').disabled = false;
    switchTab('basic');
  }

  function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val === null || val === undefined ? '' : val;
  }

  function setSelectValue(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    let exists = false;
    for (let i = 0; i < el.options.length; i++) {
      if (el.options[i].value === val) { exists = true; break; }
    }
    if (!exists && val) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val;
      el.appendChild(opt);
    }
    el.value = val || '';
  }

  // ============================================================
  //  📊 Render Stats
  // ============================================================
  function renderStats(stats) {
    const grid = document.getElementById('statsGrid');
    if (!grid) return;

    grid.innerHTML =
      '<div class="marketer-stat info">' +
        '<div class="stat-value">' + (stats.totalClients || 0) + '</div>' +
        '<div class="stat-label">إجمالي العملاء</div>' +
      '</div>' +
      '<div class="marketer-stat success">' +
        '<div class="stat-value">' + (stats.activeClients || 0) + '</div>' +
        '<div class="stat-label">عملاء نشطون</div>' +
      '</div>' +
      '<div class="marketer-stat">' +
        '<div class="stat-value">' + (stats.newThisWeek || 0) + '</div>' +
        '<div class="stat-label">هذا الأسبوع</div>' +
      '</div>' +
      '<div class="marketer-stat">' +
        '<div class="stat-value">' + (stats.totalCommission || 0) + '</div>' +
        '<div class="stat-label">إجمالي العمولات</div>' +
      '</div>' +
      '<div class="marketer-stat success">' +
        '<div class="stat-value">' + (stats.earnedCommission || 0) + '</div>' +
        '<div class="stat-label">مستحقة الصرف</div>' +
      '</div>' +
      '<div class="marketer-stat warning">' +
        '<div class="stat-value">' + (stats.pendingCommission || 0) + '</div>' +
        '<div class="stat-label">معلقة</div>' +
      '</div>';
  }

  // ============================================================
  //  👥 Render Clients
  // ============================================================
  function renderClients(clients) {
    const list = document.getElementById('clientsList');
    if (!list) return;

    if (!clients || clients.length === 0) {
      list.innerHTML = '<li style="justify-content:center; color:var(--text-muted);">لا يوجد عملاء بعد</li>';
      return;
    }

    let html = '';
    clients.forEach(function(c) {
      const isEarned = c.isEarned;
      const cls = isEarned ? '' : 'pending';
      const commissionText = c.commission > 0 ? c.commission + ' ج.م' : '—';

      html += '<li>' +
        '<div style="flex:1; min-width:0;">' +
          '<div class="client-name">' + window.UI.escapeHtml(c.childName || '—') + '</div>' +
          '<div class="client-meta">' + window.UI.escapeHtml(c.childID || '') + '</div>' +
        '</div>' +
        '<span class="client-commission ' + cls + '">' + commissionText + '</span>' +
      '</li>';
    });

    list.innerHTML = html;
  }

  // ============================================================
  //  🗂️ التبويبات
  // ============================================================
  function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });
    document.querySelectorAll('.tab-panel').forEach(function(panel) {
      panel.classList.toggle('active', panel.getAttribute('data-panel') === tabName);
    });
  }

  // ============================================================
  //  💾 حفظ التغييرات
  // ============================================================
  async function saveChanges() {
    if (state.isSaving) return;
    if (!state.currentMarketer) return;

    const code = state.currentMarketer.code;
    const updates = {};

    const name = document.getElementById('edit_name').value.trim();
    if (name !== (state.originalValues.name || '')) updates.name = name;

    const phone = document.getElementById('edit_phone').value.trim();
    if (phone !== (state.originalValues.phone || '')) updates.phone = phone;

    const email = document.getElementById('edit_email').value.trim();
    if (email !== (state.originalValues.email || '')) updates.email = email;

    const governorate = document.getElementById('edit_governorate').value.trim();
    if (governorate !== (state.originalValues.governorate || '')) updates.governorate = governorate;

    const discountPercent = parseInt(document.getElementById('edit_discountPercent').value) || 10;
    if (discountPercent !== (state.originalValues.discount_percent || 10)) updates.discount_percent = discountPercent;

    const isActive = document.getElementById('edit_isActive').value;
    if (isActive !== (state.originalValues.is_active || '')) updates.is_active = isActive;

    const notifMethod = document.getElementById('edit_notificationMethod').value;
    if (notifMethod !== (state.originalValues.notification_method || '')) updates.notification_method = notifMethod;

    if (Object.keys(updates).length === 0) {
      window.UI.toast.info('لا توجد تغييرات');
      return;
    }

    state.isSaving = true;
    const saveBtn = document.getElementById('saveChangesBtn');
    window.UI.setLoading(saveBtn, true, 'جاري الحفظ...');

    try {
      const result = await window.Core.api('updateMarketer', {
        marketerCode: code,
        updates: updates
      }, 'POST');

      if (!result.success) {
        window.UI.toast.error(result.message || 'فشل الحفظ');
        return;
      }

      window.UI.toast.success('تم حفظ التغييرات');
      closeEditModal();
      loadList();

    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الحفظ');
    } finally {
      state.isSaving = false;
      window.UI.setLoading(saveBtn, false);
    }
  }

  // ============================================================
  //  🔐 إعادة تعيين كلمة السر
  // ============================================================
  async function resetMarketerPassword() {
    if (!state.currentMarketer) return;
    const code = state.currentMarketer.code;
    const name = state.currentMarketer.name || code;

    const ok = await window.UI.confirm({
      title: 'إعادة تعيين كلمة السر',
      message: 'سيتم توليد كلمة مرور مؤقتة جديدة للمسوق "' + name + '". هل تريد المتابعة؟',
      confirmText: 'إعادة التعيين',
      type: 'warning'
    });
    if (!ok) return;

    const btn = document.getElementById('resetPasswordBtn');
    window.UI.setLoading(btn, true, 'جاري...');

    try {
      const result = await window.Core.api('resetMarketerPassword', { marketerCode: code }, 'POST');
      if (result.success) {
        // اظهر كلمة السر المؤقتة في نافذة منبثقة
        window.UI.toast.success('تم توليد كلمة مرور مؤقتة. تظهر في نافذة منبثقة.', { duration: 6000 });
        setTimeout(function() {
          window.prompt('انسخ كلمة السر المؤقتة وأبلغها للمسوق:\n\n' + result.tempPassword + '\n\n(اضغط Ctrl+C للنسخ، ثم Enter)');
        }, 300);
      } else {
        window.UI.toast.error(result.message || 'فشل إعادة التعيين');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الاتصال');
    } finally {
      window.UI.setLoading(btn, false);
    }
  }

  // ============================================================
  //  🗑️ الحذف النهائي
  // ============================================================
  async function hardDeleteMarketer() {
    if (!state.currentMarketer) return;
    const code = state.currentMarketer.code;
    const name = state.currentMarketer.name || code;

    const ok1 = await window.UI.confirm({
      title: '⚠️ حذف نهائي',
      message: 'سيتم حذف "' + name + '" نهائيًا. جميع الأطفال المسجلين بكوده سيُفصلون عنه (يبقون في النظام بدون مسوق). لا يمكن التراجع.',
      confirmText: 'متابعة',
      type: 'danger'
    });
    if (!ok1) return;

    const typed = window.prompt('للتأكيد النهائي، اكتب كود المسوق: ' + code);
    if (!typed || typed.trim().toUpperCase() !== code.toUpperCase()) {
      window.UI.toast.error('لم يتم التأكيد — أُلغي الحذف');
      return;
    }

    const btn = document.getElementById('hardDeleteMarketerBtn');
    window.UI.setLoading(btn, true, 'جاري الحذف...');

    try {
      const result = await window.Core.api('hardDeleteMarketer', { marketerCode: code }, 'POST');
      if (result.success) {
        window.UI.toast.success(result.message || 'تم الحذف نهائيًا');
        closeEditModal();
        loadList();
      } else {
        window.UI.toast.error(result.message || 'فشل الحذف');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الحذف');
    } finally {
      window.UI.setLoading(btn, false);
    }
  }

  // ============================================================
  //  🔄 تطبيق الحالة الجماعية
  // ============================================================
  async function applyBulkStatus() {
    const newStatus = document.getElementById('bulkStatusSelect').value;
    if (!newStatus) {
      window.UI.toast.warning('اختر الحالة أولاً');
      return;
    }
    const codes = Array.from(state.selectedCodes);
    if (codes.length === 0) return;

    const ok = await window.UI.confirm({
      title: 'تحديث الحالة',
      message: 'سيتم تحديث ' + codes.length + ' مسوق إلى حالة "' + newStatus + '". متابعة؟',
      confirmText: 'تطبيق',
      type: 'warning'
    });
    if (!ok) return;

    const btn = document.getElementById('bulkApplyBtn');
    window.UI.setLoading(btn, true, 'جاري...');

    try {
      const result = await window.Core.api('bulkUpdateMarketers', {
        codes: codes,
        status: newStatus
      }, 'POST');

      if (result.success) {
        window.UI.toast.success(result.message || 'تم التحديث');
        state.selectedCodes.clear();
        document.getElementById('bulkStatusSelect').value = '';
        loadList();
      } else {
        window.UI.toast.error(result.message || 'فشل التحديث');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر التحديث');
    } finally {
      window.UI.setLoading(btn, false);
    }
  }

  // ============================================================
  //  🛠️ Helpers
  // ============================================================

  // ✅ الصيغة النهارية
  function formatDate(value) {
    return window.AdminUtils.formatDate(value);
  }

  // ✅ الصيغة الكاملة (لحقول modal): "الأربعاء، 11 نوفمبر 2026 - 02:00 مساءً"
  function formatDateTimeFull(value) {
    if (!value) return '';
    try {
      if (window.AdminUtils && typeof window.AdminUtils.formatDateTime === 'function') {
        return window.AdminUtils.formatDateTime(value) || '';
      }
      return formatDate(value);
    } catch (e) {
      return formatDate(value) || '';
    }
  }

  // ✅ Helper: خلية تاريخ بصيغة سطرين (date عربي + time تحت)
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

  function escapeAttr(str) {
    return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // ============================================================
  //  🌐 التصدير
  // ============================================================
  window.MarketersPage = {
    init: init,
    reload: reload
  };

})();