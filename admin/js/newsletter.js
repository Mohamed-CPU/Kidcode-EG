// ================================================================
//  admin/js/newsletter.js — منطق صفحة إدارة المشتركين (يعتمد على id)
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
    sortBy: 'timestamp',
    sortDir: 'desc',
    list: [],
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
    selectedIds: new Set(),
    currentSubscriber: null,
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
          state.list.forEach(function(s) { state.selectedIds.add(s.id); });
        } else {
          state.selectedIds.clear();
        }
        renderList();
        updateBulkBar();
      });
    }

    const bulkApplyBtn = document.getElementById('bulkApplyBtn');
    if (bulkApplyBtn) bulkApplyBtn.addEventListener('click', applyBulkStatus);

    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    if (bulkDeleteBtn) bulkDeleteBtn.addEventListener('click', bulkDelete);

    const bulkClearBtn = document.getElementById('bulkClearBtn');
    if (bulkClearBtn) {
      bulkClearBtn.addEventListener('click', function() {
        state.selectedIds.clear();
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

    const hardDeleteBtn = document.getElementById('hardDeleteBtn');
    if (hardDeleteBtn) hardDeleteBtn.addEventListener('click', hardDelete);
  }

  // ============================================================
  //  📊 loadList
  // ============================================================
  async function loadList() {
    if (state.isLoading) return;
    state.isLoading = true;
    showTableLoading();

    try {
      const result = await window.Core.api('getNewsletterList', {
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
      state.selectedIds.clear();

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
    const body = document.getElementById('newsletterTableBody');
    if (!body) return;

    if (state.list.length === 0) {
      showEmptyTable('لا توجد نتائج');
      return;
    }

    let html = '';
    state.list.forEach(function(s) {
      const isSelected = state.selectedIds.has(s.id);
      const statusCls = s.isActive ? 'badge-success' : 'badge-muted';
      const statusLabel = s.isActive ? 'نشط' : 'غير نشط';

      html += '<tr class="subscriber-row" data-id="' + s.id + '">' +
        '<td class="cell-checkbox" onclick="event.stopPropagation();">' +
          '<input type="checkbox" class="row-checkbox" data-id="' + s.id + '"' + (isSelected ? ' checked' : '') + '>' +
        '</td>' +
        '<td class="cell-email" title="' + escapeAttr(s.email) + '">' + window.UI.escapeHtml(s.email || '—') + '</td>' +
        '<td>' + window.UI.escapeHtml(s.name || '—') + '</td>' +
        '<td class="cell-phone col-phone">' + window.UI.escapeHtml(s.phone || '—') + '</td>' +
        '<td><span class="badge ' + statusCls + '">' + statusLabel + '</span></td>' +
        '<td class="cell-date col-date">' + window.UI.escapeHtml(formatDate(s.timestamp) || '—') + '</td>' +
        '<td class="cell-actions" onclick="event.stopPropagation();">' +
          '<button class="btn btn-sm btn-secondary edit-row-btn" data-id="' + s.id + '" title="تعديل">' +
            '<i class="fas fa-edit"></i>' +
          '</button>' +
        '</td>' +
      '</tr>';
    });

    body.innerHTML = html;

    body.querySelectorAll('.row-checkbox').forEach(function(cb) {
      cb.addEventListener('change', function() {
        const id = parseInt(this.getAttribute('data-id'));
        if (this.checked) state.selectedIds.add(id);
        else state.selectedIds.delete(id);
        updateBulkBar();
        updateSelectAllCheckbox();
      });
    });

    body.querySelectorAll('.edit-row-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        openEditModal(parseInt(this.getAttribute('data-id')));
      });
    });

    body.querySelectorAll('.subscriber-row').forEach(function(row) {
      row.addEventListener('click', function() {
        openEditModal(parseInt(this.getAttribute('data-id')));
      });
    });

    updateSelectAllCheckbox();
  }

  function showTableLoading() {
    const body = document.getElementById('newsletterTableBody');
    if (body) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px;">' +
        '<i class="fas fa-spinner fa-spin" style="font-size:1.5rem; color:var(--accent);"></i></td></tr>';
    }
  }

  function showEmptyTable(msg) {
    const body = document.getElementById('newsletterTableBody');
    if (body) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-muted);">' +
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
    const selected = state.list.filter(function(s) { return state.selectedIds.has(s.id); }).length;
    cb.checked = selected === state.list.length;
    cb.indeterminate = selected > 0 && selected < state.list.length;
  }

  function updateInfo() {
    const el = document.getElementById('listInfo');
    if (!el) return;
    el.textContent = 'إجمالي: ' + (state.pagination.total || 0) + ' مشترك';
  }

  function updateBulkBar() {
    const bar = document.getElementById('bulkBar');
    const count = document.getElementById('bulkCount');
    if (!bar) return;
    if (state.selectedIds.size > 0) {
      bar.classList.add('show');
      if (count) count.textContent = state.selectedIds.size;
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
  //  ✏️ فتح المودال
  // ============================================================
  async function openEditModal(id) {
    if (!id) return;

    window.UI.modal.open('editSubscriberModal');
    document.getElementById('editModalTitle').textContent = 'جاري التحميل...';
    document.getElementById('saveChangesBtn').disabled = true;

    try {
      const result = await window.Core.api('getSubscriberDetails', { id: id }, 'GET');
      if (!result.success) {
        window.UI.toast.error(result.message || 'فشل تحميل البيانات');
        closeEditModal();
        return;
      }
      state.currentSubscriber = result.subscriber;
      populateModal(result.subscriber);
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر تحميل البيانات');
      closeEditModal();
    }
  }

  function closeEditModal() {
    window.UI.modal.close('editSubscriberModal');
    state.currentSubscriber = null;
  }

  // ============================================================
  //  📝 تعبئة المودال
  // ============================================================
  function populateModal(s) {
    const email = String(s.email || '').trim().toLowerCase();
    const name = String(s.name || '').trim();

    // ✅ العنوان: الاسم إن وُجد، وإلا البريد
    const displayName = name || email;
    document.getElementById('editModalTitle').textContent = 'تعديل: ' + displayName;

    // ✅ Meta — نستخدم setText
    setText('meta_timestamp', formatDateTime(s.timestamp) || '—');
    setText(
      'meta_hasToken',
      s.unsubscribe_token && String(s.unsubscribe_token).trim()
        ? 'متوفر ✓'
        : 'غير موجود'
    );

    // Editable
    setValue('edit_email', email);
    setValue('edit_name', name);
    setValue('edit_phone', s.phone || '');

    // is_active
    const isActive = isSubscriberActive(s.is_active);
    setSelectValue('edit_isActive', isActive ? 'نعم' : 'لا');

    // Original
    state.originalValues = {
      email: email,
      name: name,
      phone: String(s.phone || '').trim(),
      isActive: isActive ? 'نعم' : 'لا'
    };

    document.getElementById('saveChangesBtn').disabled = false;
  }

  function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val === null || val === undefined ? '' : val;
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = (val === null || val === undefined) ? '' : String(val);
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

  function isSubscriberActive(value) {
    const s = String(value || '').trim().toLowerCase();
    return ['نعم', 'نشط', 'yes', 'true', '1', 'active'].includes(s);
  }

  // ============================================================
  //  💾 حفظ التغييرات
  // ============================================================
  async function saveChanges() {
    if (state.isSaving) return;
    if (!state.currentSubscriber) return;

    const id = state.currentSubscriber.id;
    const updates = {};

    const email = document.getElementById('edit_email').value.trim().toLowerCase();
    if (!email) {
      window.UI.toast.error('البريد الإلكتروني مطلوب');
      document.getElementById('edit_email').focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      window.UI.toast.error('صيغة البريد الإلكتروني غير صحيحة');
      document.getElementById('edit_email').focus();
      return;
    }
    if (email !== (state.originalValues.email || '')) updates.email = email;

    const name = document.getElementById('edit_name').value.trim();
    if (name !== (state.originalValues.name || '')) updates.name = name;

    const phone = document.getElementById('edit_phone').value.trim();
    if (phone !== (state.originalValues.phone || '')) updates.phone = phone;

    const isActive = document.getElementById('edit_isActive').value;
    if (isActive !== (state.originalValues.isActive || '')) updates.is_active = isActive;

    if (Object.keys(updates).length === 0) {
      window.UI.toast.info('لا توجد تغييرات');
      return;
    }

    state.isSaving = true;
    const saveBtn = document.getElementById('saveChangesBtn');
    window.UI.setLoading(saveBtn, true, 'جاري الحفظ...');

    try {
      const result = await window.Core.api('updateSubscriber', {
        id: id,
        updates: updates
      }, 'POST');

      if (!result.success) {
        if (result.error === 'email_exists') {
          window.UI.toast.error(result.message || 'هذا البريد مسجَّل لمشترك آخر');
          document.getElementById('edit_email').focus();
        } else if (result.error === 'invalid_email') {
          window.UI.toast.error(result.message || 'صيغة البريد غير صحيحة');
          document.getElementById('edit_email').focus();
        } else {
          window.UI.toast.error(result.message || 'فشل الحفظ');
        }
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
  //  🗑️ حذف نهائي
  // ============================================================
  async function hardDelete() {
    if (!state.currentSubscriber) return;
    const id = state.currentSubscriber.id;
    const email = String(state.currentSubscriber.email || '').trim();

    const ok1 = await window.UI.confirm({
      title: '⚠️ حذف نهائي',
      message: 'سيتم حذف المشترك "' + email + '" نهائيًا من قاعدة البيانات. لا يمكن التراجع.',
      confirmText: 'متابعة',
      type: 'danger'
    });
    if (!ok1) return;

    const typed = window.prompt('للتأكيد النهائي، اكتب البريد الإلكتروني كاملاً:\n' + email);
    if (!typed || typed.trim().toLowerCase() !== email.toLowerCase()) {
      window.UI.toast.error('لم يتم التأكيد — أُلغي الحذف');
      return;
    }

    const btn = document.getElementById('hardDeleteBtn');
    window.UI.setLoading(btn, true, 'جاري الحذف...');

    try {
      const result = await window.Core.api('deleteSubscriber', { id: id }, 'POST');
      if (result.success) {
        window.UI.toast.success('تم الحذف نهائيًا');
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
    const ids = Array.from(state.selectedIds);
    if (ids.length === 0) return;

    const ok = await window.UI.confirm({
      title: 'تحديث الحالة',
      message: 'سيتم تحديث ' + ids.length + ' مشترك إلى "' + newStatus + '". متابعة؟',
      confirmText: 'تطبيق',
      type: 'warning'
    });
    if (!ok) return;

    const btn = document.getElementById('bulkApplyBtn');
    window.UI.setLoading(btn, true, 'جاري...');

    try {
      const result = await window.Core.api('bulkUpdateNewsletter', {
        ids: ids,
        status: newStatus
      }, 'POST');

      if (result.success) {
        window.UI.toast.success(result.message || 'تم التحديث');
        state.selectedIds.clear();
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
  //  🗑️ الحذف الجماعي
  // ============================================================
  async function bulkDelete() {
    const ids = Array.from(state.selectedIds);
    if (ids.length === 0) return;

    const ok1 = await window.UI.confirm({
      title: '⚠️ حذف نهائي جماعي',
      message: 'سيتم حذف ' + ids.length + ' مشترك نهائيًا. لا يمكن التراجع.',
      confirmText: 'متابعة',
      type: 'danger'
    });
    if (!ok1) return;

    const typed = window.prompt('للتأكيد النهائي، اكتب كلمة DELETE');
    if (!typed || typed.trim().toUpperCase() !== 'DELETE') {
      window.UI.toast.error('لم يتم التأكيد — أُلغي الحذف');
      return;
    }

    const btn = document.getElementById('bulkDeleteBtn');
    window.UI.setLoading(btn, true, 'جاري الحذف...');

    try {
      const result = await window.Core.api('bulkDeleteNewsletter', {
        ids: ids
      }, 'POST');

      if (result.success) {
        window.UI.toast.success(result.message || 'تم الحذف');
        state.selectedIds.clear();
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
  //  🛠️ Helpers
  // ============================================================
  function formatDate(value) {
    return window.AdminUtils.formatDate(value);
  }

  function formatDateTime(value) {
    return window.AdminUtils.formatDateTime(value);
  }

  function escapeAttr(str) {
    return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // ============================================================
  //  🌐 التصدير
  // ============================================================
  window.NewsletterPage = {
    init: init,
    reload: reload
  };

})();