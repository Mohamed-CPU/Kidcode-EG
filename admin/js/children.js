// ================================================================
//  admin/js/children.js — منطق صفحة إدارة الأطفال
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
    plan: '',
    sortBy: 'registration_date',
    sortDir: 'desc',
    list: [],
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
    selectedIDs: new Set(),
    currentChild: null,
    currentNotes: [],
    originalValues: {},
    newImageBase64: '',
    isSaving: false,
    // ✅ جديد: حالة المدفوعات
    paymentsLoaded: false,
    paymentsLoading: false,
    currentPayments: [],
    currentPaymentsHasScans: false,
    currentRefundPayment: null
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
    // البحث (debounce)
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

    // فلاتر
    ['statusFilter', 'planFilter'].forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', function() {
        state.status = document.getElementById('statusFilter').value;
        state.plan = document.getElementById('planFilter').value;
        state.page = 1;
        loadList();
      });
    });

    // مسح
    const clearBtn = document.getElementById('clearFiltersBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        document.getElementById('searchInput').value = '';
        document.getElementById('statusFilter').value = '';
        document.getElementById('planFilter').value = '';
        state.search = ''; state.status = ''; state.plan = ''; state.page = 1;
        loadList();
      });
    }

    // تحديد الكل
    const selectAll = document.getElementById('selectAllCheckbox');
    if (selectAll) {
      selectAll.addEventListener('change', function() {
        if (this.checked) {
          state.list.forEach(function(c) { state.selectedIDs.add(c.childID); });
        } else {
          state.selectedIDs.clear();
        }
        renderList();
        updateBulkBar();
      });
    }

    // Bulk
    const bulkApplyBtn = document.getElementById('bulkApplyBtn');
    if (bulkApplyBtn) bulkApplyBtn.addEventListener('click', applyBulkStatus);

    const bulkClearBtn = document.getElementById('bulkClearBtn');
    if (bulkClearBtn) {
      bulkClearBtn.addEventListener('click', function() {
        state.selectedIDs.clear();
        renderList();
        updateBulkBar();
      });
    }

    // Modal
    const closeEditBtn = document.getElementById('closeEditModalBtn');
    if (closeEditBtn) closeEditBtn.addEventListener('click', closeEditModal);

    const cancelEditBtn = document.getElementById('cancelEditBtn');
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', closeEditModal);

    const saveBtn = document.getElementById('saveChangesBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveChanges);

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        switchTab(this.getAttribute('data-tab'));
      });
    });

    // Notes
    const addNoteBtn = document.getElementById('addNoteBtn');
    if (addNoteBtn) addNoteBtn.addEventListener('click', addNote);

    const newNoteInput = document.getElementById('newNoteInput');
    if (newNoteInput) {
      newNoteInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); addNote(); }
      });
    }

    // Extend
    const extendBtn = document.getElementById('extendSubscriptionBtn');
    if (extendBtn) extendBtn.addEventListener('click', openExtendModal);

    const closeExtendBtn = document.getElementById('closeExtendModalBtn');
    if (closeExtendBtn) closeExtendBtn.addEventListener('click', closeExtendModal);

    const cancelExtendBtn = document.getElementById('cancelExtendBtn');
    if (cancelExtendBtn) cancelExtendBtn.addEventListener('click', closeExtendModal);

    const confirmExtendBtn = document.getElementById('confirmExtendBtn');
    if (confirmExtendBtn) confirmExtendBtn.addEventListener('click', confirmExtend);

    // Reset password
    const resetPwdBtn = document.getElementById('resetChildPasswordBtn');
    if (resetPwdBtn) resetPwdBtn.addEventListener('click', resetChildPassword);

    // Hard delete
    const hardDeleteBtn = document.getElementById('hardDeleteChildBtn');
    if (hardDeleteBtn) hardDeleteBtn.addEventListener('click', hardDeleteChild);

    // Image upload
    const changeImgBtn = document.getElementById('changeChildImageBtn');
    if (changeImgBtn) {
      changeImgBtn.addEventListener('click', function() {
        const inp = document.getElementById('childImageInput');
        if (inp) inp.click();
      });
    }

    const imgInput = document.getElementById('childImageInput');
    if (imgInput) imgInput.addEventListener('change', handleImageSelected);

    // 🔐 Revoke handlers
    const revokeBtn = document.getElementById('revokeChildIdBtn');
    if (revokeBtn) revokeBtn.addEventListener('click', openRevokeModal);

    const closeRevokeModalBtn = document.getElementById('closeRevokeModalBtn');
    if (closeRevokeModalBtn) closeRevokeModalBtn.addEventListener('click', closeRevokeModal);

    const cancelRevokeBtn = document.getElementById('cancelRevokeBtn');
    if (cancelRevokeBtn) cancelRevokeBtn.addEventListener('click', closeRevokeModal);

    const confirmRevokeBtn = document.getElementById('confirmRevokeBtn');
    if (confirmRevokeBtn) confirmRevokeBtn.addEventListener('click', confirmRevoke);

    const revokeReasonEl = document.getElementById('revoke_reason');
    const revokeNotesEl = document.getElementById('revoke_notes');
    const revokeConfirmIDEl = document.getElementById('revoke_confirmID');

    if (revokeReasonEl) revokeReasonEl.addEventListener('change', updateRevokeButtonState);
    if (revokeNotesEl) {
      revokeNotesEl.addEventListener('input', function() {
        const count = document.getElementById('revoke_notes_count');
        if (count) count.textContent = revokeNotesEl.value.length;
        updateRevokeButtonState();
      });
    }
    if (revokeConfirmIDEl) revokeConfirmIDEl.addEventListener('input', updateRevokeButtonState);

    // Success modal handlers
    const closeRevokeSuccessBtn = document.getElementById('closeRevokeSuccessBtn');
    if (closeRevokeSuccessBtn) closeRevokeSuccessBtn.addEventListener('click', closeRevokeSuccessModal);

    const doneRevokeBtn = document.getElementById('doneRevokeBtn');
    if (doneRevokeBtn) doneRevokeBtn.addEventListener('click', closeRevokeSuccessModal);

    const copyNewIDBtn = document.getElementById('copyNewIDBtn');
    if (copyNewIDBtn) {
      copyNewIDBtn.addEventListener('click', function() {
        const el = document.getElementById('revoke_newID');
        if (el) copyToClipboard(el.textContent);
      });
    }

    const copyAllBtn = document.getElementById('copyAllRevokeDataBtn');
    if (copyAllBtn) copyAllBtn.addEventListener('click', copyAllRevokeData);

    const downloadQRBtn = document.getElementById('downloadQRBtn');
    if (downloadQRBtn) downloadQRBtn.addEventListener('click', downloadRevokeQR);

    // ✅ جديد: Refund handlers
    const closeRefundModalBtn = document.getElementById('closeRefundModalBtn');
    if (closeRefundModalBtn) closeRefundModalBtn.addEventListener('click', closeRefundModal);

    const cancelRefundBtn = document.getElementById('cancelRefundBtn');
    if (cancelRefundBtn) cancelRefundBtn.addEventListener('click', closeRefundModal);

    const confirmRefundBtn = document.getElementById('confirmRefundBtn');
    if (confirmRefundBtn) confirmRefundBtn.addEventListener('click', confirmRefund);

    const refundReasonEl = document.getElementById('refund_reason');
    const refundConfirmIDEl = document.getElementById('refund_confirmID');

    if (refundReasonEl) {
      refundReasonEl.addEventListener('input', function() {
        const count = document.getElementById('refund_reason_count');
        if (count) count.textContent = refundReasonEl.value.length;
        updateRefundButtonState();
      });
    }
    if (refundConfirmIDEl) refundConfirmIDEl.addEventListener('input', updateRefundButtonState);

    const closeRefundSuccessBtn = document.getElementById('closeRefundSuccessBtn');
    if (closeRefundSuccessBtn) closeRefundSuccessBtn.addEventListener('click', closeRefundSuccessModal);

    const doneRefundBtn = document.getElementById('doneRefundBtn');
    if (doneRefundBtn) doneRefundBtn.addEventListener('click', closeRefundSuccessModal);
  }

  // ============================================================
  //  📊 loadList
  // ============================================================
  async function loadList() {
    if (state.isLoading) return;
    state.isLoading = true;
    showTableLoading();

    try {
      const result = await window.Core.api('getChildrenList', {
        page: state.page,
        pageSize: state.pageSize,
        search: state.search,
        status: state.status,
        plan: state.plan,
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
      state.selectedIDs.clear();

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
    const body = document.getElementById('childrenTableBody');
    if (!body) return;

    if (state.list.length === 0) {
      showEmptyTable('لا توجد نتائج');
      return;
    }

    let html = '';
    state.list.forEach(function(child) {
      const isSelected = state.selectedIDs.has(child.childID);
      const statusInfo = getStatusInfo(child.status);
      const phone = child.fatherPhone || child.motherPhone || '—';
      // ✅ آخر مسح بصيغة سطرين عربي
      const lastScanCell = buildTwoLineDateCell(child.lastScan);

      html += '<tr class="child-row" data-child-id="' + escapeAttr(child.childID) + '">' +
        '<td class="cell-checkbox" onclick="event.stopPropagation();">' +
          '<input type="checkbox" class="row-checkbox" data-child-id="' + escapeAttr(child.childID) + '"' + (isSelected ? ' checked' : '') + '>' +
        '</td>' +
        '<td class="cell-id">' + window.UI.escapeHtml(child.childID || '—') + '</td>' +
        '<td>' + window.UI.escapeHtml(child.childName || '—') + '</td>' +
        '<td class="col-age">' + window.UI.escapeHtml(child.age || '—') + '</td>' +
        '<td><span class="badge ' + statusInfo.cls + '">' + statusInfo.label + '</span></td>' +
        '<td class="col-plan">' + window.UI.escapeHtml(child.plan || '—') + '</td>' +
        '<td class="cell-phone col-phone">' + window.UI.escapeHtml(phone) + '</td>' +
        '<td class="cell-date col-lastscan">' + lastScanCell + '</td>' +
        '<td class="cell-actions" onclick="event.stopPropagation();">' +
          '<button class="btn btn-sm btn-secondary edit-row-btn" data-child-id="' + escapeAttr(child.childID) + '" title="تعديل">' +
            '<i class="fas fa-edit"></i>' +
          '</button>' +
        '</td>' +
      '</tr>';
    });

    body.innerHTML = html;

    body.querySelectorAll('.row-checkbox').forEach(function(cb) {
      cb.addEventListener('change', function() {
        const id = this.getAttribute('data-child-id');
        if (this.checked) state.selectedIDs.add(id);
        else state.selectedIDs.delete(id);
        updateBulkBar();
        updateSelectAllCheckbox();
      });
    });

    body.querySelectorAll('.edit-row-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        openEditModal(this.getAttribute('data-child-id'));
      });
    });

    body.querySelectorAll('.child-row').forEach(function(row) {
      row.addEventListener('click', function() {
        openEditModal(this.getAttribute('data-child-id'));
      });
    });

    updateSelectAllCheckbox();
  }

  function showTableLoading() {
    const body = document.getElementById('childrenTableBody');
    if (body) {
      body.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:40px;">' +
        '<i class="fas fa-spinner fa-spin" style="font-size:1.5rem; color:var(--accent);"></i></td></tr>';
    }
  }

  function showEmptyTable(msg) {
    const body = document.getElementById('childrenTableBody');
    if (body) {
      body.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:40px; color:var(--text-muted);">' +
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
    const selectedCount = state.list.filter(function(c) { return state.selectedIDs.has(c.childID); }).length;
    cb.checked = selectedCount === state.list.length;
    cb.indeterminate = selectedCount > 0 && selectedCount < state.list.length;
  }

  function updateInfo() {
    const el = document.getElementById('listInfo');
    if (!el) return;
    el.textContent = 'إجمالي: ' + (state.pagination.total || 0) + ' طفل';
  }

  function updateBulkBar() {
    const bar = document.getElementById('bulkBar');
    const count = document.getElementById('bulkCount');
    if (!bar) return;
    if (state.selectedIDs.size > 0) {
      bar.classList.add('show');
      if (count) count.textContent = state.selectedIDs.size;
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
  async function openEditModal(childID) {
    if (!childID) return;

    window.UI.modal.open('editChildModal');
    document.getElementById('editModalTitle').textContent = 'جاري التحميل...';
    document.getElementById('saveChangesBtn').disabled = true;

    try {
      const result = await window.Core.api('getChildDetails', { childID: childID }, 'GET');
      if (!result.success) {
        window.UI.toast.error(result.message || 'فشل تحميل البيانات');
        closeEditModal();
        return;
      }
      state.currentChild = result.child;
      state.newImageBase64 = '';
      populateModal(result.child);
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر تحميل البيانات');
      closeEditModal();
    }
  }

  function closeEditModal() {
    window.UI.modal.close('editChildModal');
    state.currentChild = null;
    state.currentNotes = [];
    state.newImageBase64 = '';
  }

  // ============================================================
  //  📝 تعبئة المودال
  // ============================================================
  function populateModal(child) {
    const id = child.child_id || child.childID || '';
    document.getElementById('editModalTitle').textContent = 'تعديل بيانات ' + (child.child_name || id);

    // Basic
    setValue('edit_childID', id);
    setValue('edit_childName', child.child_name || '');

    // ✅ birth_date: تحويل إلى YYYY-MM-DD لحقل date
    const bd = normalizeDateForInput(child.birth_date);
    setValue('edit_birthDate', bd);
    setValue('edit_age', child.age || '—');
    setValue('edit_googleMaps', child.google_maps || '');
    setValue('edit_detailedAddress', child.detailed_address || '');

    // Image
    const imgEl = document.getElementById('edit_childImage');
    if (imgEl) {
      const imgUrl = String(child.child_image_url || '').trim();
      // ✅ Cloudinary بس
      if (imgUrl.startsWith('http')) {
        imgEl.src = imgUrl;
        imgEl.style.display = 'block';
      } else {
        imgEl.style.display = 'none';
        imgEl.removeAttribute('src');
      }
    }

    // Parents
    setValue('edit_fatherPhone', child.father_phone || '');
    setValue('edit_motherName', child.mother_name || '');
    setValue('edit_motherPhone', child.mother_phone || '');
    setValue('edit_email', child.email_code || '');

    // Subscription
    setSelectValue('edit_status', child.status || 'active');
    setSelectValue('edit_plan', child.plan || '');
    setValue('edit_planPrice', child.plan_price || 0);
    setSelectValue('edit_paymentStatus', child.payment_status || 'pending');
    // ✅ التواريخ بصيغة عربية كاملة (في حقل modal - مساحة كافية)
    setValue('edit_registrationDate', formatDateTimeFull(child.registration_date) || '—');
    setValue('edit_expiryDate', formatDateTimeFull(child.expiry_date) || '—');
    setValue('edit_marketerID', child.marketer_id || '');

    // Notifications
    setSelectValue('edit_notificationMethod', child.notification_method || 'email');
    setValue('edit_telegramFather', child.telegram_chat_id_father || '—');
    setValue('edit_telegramMother', child.telegram_chat_id_mother || '—');

    // Security
    const hasPwd = child.family_password_hash || child.family_password_set_at;
    setValue('edit_hasPassword', hasPwd ? '✅ معيّنة' : '❌ غير معيّنة');
    setSelectValue('edit_courtRequested', child.court_requested || 'لا');

    // Hard delete btn
    const hardDeleteBtn = document.getElementById('hardDeleteChildBtn');
    if (hardDeleteBtn) {
      const isDeleted = String(child.status || '').toLowerCase() === 'deleted';
      hardDeleteBtn.disabled = isDeleted;
      hardDeleteBtn.innerHTML = isDeleted
        ? '<i class="fas fa-check"></i> محذوف بالفعل'
        : '<i class="fas fa-trash-alt"></i> حذف نهائي (HARD)';
    }

    // Notes
    let notes = [];
    try {
      notes = JSON.parse(child.notes || '[]');
      if (!Array.isArray(notes)) notes = [];
    } catch (e) { notes = []; }
    state.currentNotes = notes.slice();
    renderNotes();

    // Original values (للـ diff)
    state.originalValues = {
      child_name: child.child_name || '',
      birth_date: normalizeDateForInput(child.birth_date),
      google_maps: child.google_maps || '',
      detailed_address: child.detailed_address || '',
      father_phone: child.father_phone || '',
      mother_name: child.mother_name || '',
      mother_phone: child.mother_phone || '',
      email_code: child.email_code || '',
      plan: child.plan || '',
      plan_price: parseInt(child.plan_price || 0),
      status: child.status || '',
      payment_status: child.payment_status || '',
      notification_method: child.notification_method || '',
      court_requested: child.court_requested || 'لا',
      marketer_id: (child.marketer_id || '').trim().toUpperCase(),
      notes: JSON.stringify(notes)
    };

    // ✅ إعادة تعيين حالة المدفوعات (تُحمَّل عند فتح التبويب)
    state.paymentsLoaded = false;
    state.currentPayments = [];
    state.currentPaymentsHasScans = false;
    state.currentRefundPayment = null;

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
  //  🗂️ التبويبات
  // ============================================================
  function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });
    document.querySelectorAll('.tab-panel').forEach(function(panel) {
      panel.classList.toggle('active', panel.getAttribute('data-panel') === tabName);
    });

    // ✅ تحميل المدفوعات عند فتح التبويب (مرة واحدة لكل طفل)
    if (tabName === 'payments' && !state.paymentsLoaded && state.currentChild) {
      loadChildPayments();
    }
  }

  // ============================================================
  //  📝 الملاحظات
  // ============================================================
  function renderNotes() {
    const list = document.getElementById('notesList');
    if (!list) return;
    if (state.currentNotes.length === 0) {
      list.innerHTML = '<li style="color:var(--text-muted); justify-content:center;">لا توجد ملاحظات</li>';
      return;
    }
    let html = '';
    state.currentNotes.forEach(function(note, index) {
      html += '<li>' +
        '<span>' + window.UI.escapeHtml(note) + '</span>' +
        '<span class="remove-note" data-index="' + index + '"><i class="fas fa-times"></i></span>' +
      '</li>';
    });
    list.innerHTML = html;

    list.querySelectorAll('.remove-note').forEach(function(el) {
      el.addEventListener('click', function() {
        const idx = parseInt(this.getAttribute('data-index'));
        state.currentNotes.splice(idx, 1);
        renderNotes();
      });
    });
  }

  function addNote() {
    const inp = document.getElementById('newNoteInput');
    if (!inp) return;
    const val = inp.value.trim();
    if (!val) return;
    if (state.currentNotes.length >= 20) {
      window.UI.toast.warning('الحد الأقصى 20 ملاحظة');
      return;
    }
    state.currentNotes.push(val);
    inp.value = '';
    renderNotes();
  }

  // ============================================================
  //  💾 حفظ التغييرات
  // ============================================================
  async function saveChanges() {
    if (state.isSaving) return;
    if (!state.currentChild) return;

    const childID = state.currentChild.child_id || state.currentChild.childID;
    const updates = {};

    // Basic
    const childName = document.getElementById('edit_childName').value.trim();
    if (childName !== (state.originalValues.child_name || '')) updates.child_name = childName;

    const birthDate = document.getElementById('edit_birthDate').value.trim();
    if (birthDate && birthDate !== (state.originalValues.birth_date || '')) {
      updates.birth_date = birthDate;
    }

    const googleMaps = document.getElementById('edit_googleMaps').value.trim();
    if (googleMaps !== (state.originalValues.google_maps || '')) updates.google_maps = googleMaps;

    const detailedAddress = document.getElementById('edit_detailedAddress').value.trim();
    if (detailedAddress !== (state.originalValues.detailed_address || '')) updates.detailed_address = detailedAddress;

    const notesJSON = JSON.stringify(state.currentNotes);
    if (notesJSON !== (state.originalValues.notes || '[]')) updates.notes = notesJSON;

    // Parents
    const fatherPhone = document.getElementById('edit_fatherPhone').value.trim();
    if (fatherPhone !== (state.originalValues.father_phone || '')) updates.father_phone = fatherPhone;

    const motherName = document.getElementById('edit_motherName').value.trim();
    if (motherName !== (state.originalValues.mother_name || '')) updates.mother_name = motherName;

    const motherPhone = document.getElementById('edit_motherPhone').value.trim();
    if (motherPhone !== (state.originalValues.mother_phone || '')) updates.mother_phone = motherPhone;

    const email = document.getElementById('edit_email').value.trim();
    if (email !== (state.originalValues.email_code || '')) updates.email_code = email;

    // Subscription
    const status = document.getElementById('edit_status').value;
    if (status !== (state.originalValues.status || '')) updates.status = status;

    const plan = document.getElementById('edit_plan').value;
    if (plan !== (state.originalValues.plan || '')) updates.plan = plan;

    const planPrice = parseInt(document.getElementById('edit_planPrice').value) || 0;
    if (planPrice !== (state.originalValues.plan_price || 0)) updates.plan_price = planPrice;

    const paymentStatus = document.getElementById('edit_paymentStatus').value;
    if (paymentStatus !== (state.originalValues.payment_status || '')) updates.payment_status = paymentStatus;

    // ✅ كود المسوق
    const marketerID = (document.getElementById('edit_marketerID').value || '').trim().toUpperCase();
    if (marketerID !== (state.originalValues.marketer_id || '')) {
      updates.marketer_id = marketerID;
    }

    // Notifications
    const notificationMethod = document.getElementById('edit_notificationMethod').value;
    if (notificationMethod !== (state.originalValues.notification_method || '')) updates.notification_method = notificationMethod;

    // ✅ الطلب القضائي
    const courtRequested = document.getElementById('edit_courtRequested').value;
    if (courtRequested !== (state.originalValues.court_requested || 'لا')) {
      updates.court_requested = courtRequested;
    }

    const hasFieldChanges = Object.keys(updates).length > 0;
    const hasImageChange = !!state.newImageBase64;

    if (!hasFieldChanges && !hasImageChange) {
      window.UI.toast.info('لا توجد تغييرات');
      return;
    }

    state.isSaving = true;
    const saveBtn = document.getElementById('saveChangesBtn');
    window.UI.setLoading(saveBtn, true, 'جاري الحفظ...');

    try {
      // 1. ارفع الصورة (إن وُجدت)
      if (hasImageChange) {
        const imgResult = await window.Core.api('uploadChildImage', {
          childID: childID,
          imageBase64: state.newImageBase64
        }, 'POST');

        if (!imgResult.success) {
          window.UI.toast.error(imgResult.message || 'فشل رفع الصورة');
          return;
        }
      }

      // 2. حدّث الحقول
      if (hasFieldChanges) {
        const result = await window.Core.api('updateChild', {
          childID: childID,
          updates: updates
        }, 'POST');

        if (!result.success) {
          // معالجة خاصة لأخطاء التحقق
          if (result.error === 'invalid_marketer_code') {
            window.UI.toast.error(result.message || 'كود المسوق غير موجود');
            document.getElementById('edit_marketerID').focus();
            return;
          }
          if (result.error === 'inactive_marketer') {
            window.UI.toast.error(result.message || 'حساب المسوق غير نشط');
            document.getElementById('edit_marketerID').focus();
            return;
          }
          if (result.error === 'invalid_date' || result.error === 'future_date') {
            window.UI.toast.error(result.message || 'تاريخ الميلاد غير صالح');
            document.getElementById('edit_birthDate').focus();
            return;
          }

          window.UI.toast.error(result.message || 'فشل الحفظ');
          return;
        }
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
  //  🖼️ رفع صورة
  // ============================================================
  function handleImageSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      window.UI.toast.error('يرجى اختيار صورة صالحة');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      window.UI.toast.error('حجم الصورة يجب ألا يتجاوز 5 ميجابايت');
      return;
    }

    const reader = new FileReader();
    reader.onload = function(ev) {
      state.newImageBase64 = ev.target.result;
      const imgEl = document.getElementById('edit_childImage');
      if (imgEl) {
        imgEl.src = ev.target.result;
        imgEl.style.display = 'block';
      }
      window.UI.toast.info('سيتم رفع الصورة عند حفظ التغييرات');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  // ============================================================
  //  📅 تمديد الاشتراك
  // ============================================================
  function openExtendModal() { window.UI.modal.open('extendModal'); }
  function closeExtendModal() { window.UI.modal.close('extendModal'); }

  async function confirmExtend() {
    if (!state.currentChild) return;
    const childID = state.currentChild.child_id || state.currentChild.childID;
    const months = parseInt(document.getElementById('extendMonths').value) || 0;

    const btn = document.getElementById('confirmExtendBtn');
    window.UI.setLoading(btn, true, 'جاري التمديد...');

    try {
      const result = await window.Core.api('extendSubscription', {
        childID: childID,
        months: months
      }, 'POST');

      if (result.success) {
        window.UI.toast.success(result.message || 'تم التمديد');
        closeExtendModal();
        const detail = await window.Core.api('getChildDetails', { childID: childID }, 'GET');
        if (detail.success) {
          state.currentChild = detail.child;
          // ✅ تاريخ الانتهاء بصيغة عربية كاملة
          setValue('edit_expiryDate', formatDateTimeFull(detail.child.expiry_date) || '—');
          setSelectValue('edit_status', detail.child.status || 'active');
        }
        loadList();
      } else {
        window.UI.toast.error(result.message || 'فشل التمديد');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر التمديد');
    } finally {
      window.UI.setLoading(btn, false);
    }
  }

  // ============================================================
  //  🔐 إعادة تعيين كلمة السر
  // ============================================================
  async function resetChildPassword() {
    if (!state.currentChild) return;
    const childID = state.currentChild.child_id || state.currentChild.childID;

    const ok = await window.UI.confirm({
      title: 'إعادة تعيين كلمة السر',
      message: 'سيتم حذف كلمة مرور الأسرة الحالية. ستحتاج الأسرة لتعيين كلمة جديدة عند الدخول التالي. متابعة؟',
      confirmText: 'إعادة تعيين',
      type: 'warning'
    });
    if (!ok) return;

    const btn = document.getElementById('resetChildPasswordBtn');
    window.UI.setLoading(btn, true, 'جاري...');

    try {
      const result = await window.Core.api('resetChildPassword', { childID: childID }, 'POST');
      if (result.success) {
        window.UI.toast.success(result.message || 'تم إعادة التعيين');
        setValue('edit_hasPassword', '❌ غير معيّنة');
      } else {
        window.UI.toast.error(result.message || 'فشل');
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
  async function hardDeleteChild() {
    if (!state.currentChild) return;
    const childID = state.currentChild.child_id || state.currentChild.childID;
    const childName = state.currentChild.child_name || childID;

    const ok1 = await window.UI.confirm({
      title: '⚠️ حذف نهائي',
      message: 'سيتم حذف "' + childName + '" نهائيًا من قاعدة البيانات. لا يمكن التراجع عن هذه العملية.',
      confirmText: 'متابعة',
      type: 'danger'
    });
    if (!ok1) return;

    const typed = window.prompt('للتأكيد النهائي، اكتب كود الطفل: ' + childID);
    if (!typed || typed.trim() !== childID) {
      window.UI.toast.error('لم يتم التأكيد — أُلغي الحذف');
      return;
    }

    const btn = document.getElementById('hardDeleteChildBtn');
    window.UI.setLoading(btn, true, 'جاري الحذف...');

    try {
      const result = await window.Core.api('hardDeleteChild', { childID: childID }, 'POST');
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
    const ids = Array.from(state.selectedIDs);
    if (ids.length === 0) return;

    const labels = {
      active: 'نشط', pending: 'قيد التفعيل', disabled: 'معطَّل',
      suspended: 'موقوف', expired: 'منتهي'
    };

    const ok = await window.UI.confirm({
      title: 'تحديث الحالة',
      message: 'سيتم تحديث ' + ids.length + ' عنصر إلى حالة "' + (labels[newStatus] || newStatus) + '". متابعة؟',
      confirmText: 'تطبيق',
      type: 'warning'
    });
    if (!ok) return;

    const btn = document.getElementById('bulkApplyBtn');
    window.UI.setLoading(btn, true, 'جاري...');

    try {
      const result = await window.Core.api('bulkUpdateStatus', {
        childIDs: ids,
        status: newStatus
      }, 'POST');

      if (result.success) {
        window.UI.toast.success(result.message || 'تم التحديث');
        state.selectedIDs.clear();
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
  function getStatusInfo(status) {
    const map = {
      'active':     { label: 'نشط', cls: 'badge-success' },
      'pending':    { label: 'قيد التفعيل', cls: 'badge-warning' },
      'disabled':   { label: 'معطَّل', cls: 'badge-muted' },
      'suspended':  { label: 'موقوف', cls: 'badge-danger' },
      'expired':    { label: 'منتهي', cls: 'badge-danger' },
      'refunding':  { label: 'قيد الاسترداد', cls: 'badge-warning' },
      'refunded':   { label: 'مسترد', cls: 'badge-muted' },
      'deleted':    { label: 'محذوف', cls: 'badge-muted' }
    };
    const s = String(status || '').toLowerCase();
    return map[s] || { label: status || '—', cls: 'badge-muted' };
  }

  // ✅ الصيغة النهارية (للتفاصيل): "الأربعاء، 11 نوفمبر 2026"
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

  // ============================================================
  //  📅 normalizeDateForInput — يحوّل أي صيغة إلى YYYY-MM-DD
  // ============================================================
// ============================================================
//  📅 normalizeDateForInput — يحوّل أي صيغة إلى YYYY-MM-DD
//  ✅ Cairo date (DST-aware) بدل Local TZ
// ============================================================
function normalizeDateForInput(value) {
    if (!value) return '';
    const str = String(value).trim();

    // YYYY-MM-DD أو YYYY-MM-DD HH:mm:ss
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return match[1] + '-' + match[2] + '-' + match[3];

    // DD/MM/YYYY
    const m2 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m2) {
      const dd = String(m2[1]).padStart(2, '0');
      const mm = String(m2[2]).padStart(2, '0');
      return m2[3] + '-' + mm + '-' + dd;
    }

    // ISO مع T — ✅ Cairo date (DST-aware)
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Cairo',
        year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(d);
      const yyyy = parts.find(p => p.type === 'year').value;
      const mm = parts.find(p => p.type === 'month').value;
      const dd = parts.find(p => p.type === 'day').value;
      return yyyy + '-' + mm + '-' + dd;
    }

    return '';
}

    // ============================================================
  //  🔐 Revoke Child ID
  // ============================================================
  function openRevokeModal() {
    if (!state.currentChild) return;

    const childID = state.currentChild.child_id || state.currentChild.childID;
    const status = String(state.currentChild.status || '').toLowerCase();

    if (status === 'deleted') {
      window.UI.toast.error('لا يمكن تغيير كود طفل محذوف');
      return;
    }

    // Reset
    document.getElementById('revoke_currentID').value = childID;
    document.getElementById('revoke_reason').value = '';
    document.getElementById('revoke_notes').value = '';
    document.getElementById('revoke_confirmID').value = '';
    document.getElementById('revoke_notes_count').textContent = '0';

    window.UI.modal.open('revokeChildIdModal');
    updateRevokeButtonState();
  }

  function closeRevokeModal() {
    window.UI.modal.close('revokeChildIdModal');
  }

  function updateRevokeButtonState() {
    const reason = document.getElementById('revoke_reason').value;
    const notes = document.getElementById('revoke_notes').value.trim();
    const confirmID = document.getElementById('revoke_confirmID').value.trim();
    const currentID = state.currentChild
      ? (state.currentChild.child_id || state.currentChild.childID)
      : '';

    const valid = reason && notes.length >= 10 && confirmID === currentID;
    const btn = document.getElementById('confirmRevokeBtn');
    if (btn) btn.disabled = !valid;
  }

  async function confirmRevoke() {
    if (!state.currentChild) return;

    const childID = state.currentChild.child_id || state.currentChild.childID;
    const reason = document.getElementById('revoke_reason').value;
    const notes = document.getElementById('revoke_notes').value.trim();
    const confirmID = document.getElementById('revoke_confirmID').value.trim();

    if (confirmID !== childID) {
      window.UI.toast.error('كود التأكيد غير مطابق');
      return;
    }

    if (notes.length < 10) {
      window.UI.toast.error('الملاحظات إلزامية (10 أحرف على الأقل)');
      return;
    }

    const ok = await window.UI.confirm({
      title: '⚠️ تأكيد نهائي',
      message: 'سيتم تغيير كود الطفل نهائيًا. الكود القديم سيتوقف فورًا. هل أنت متأكد؟',
      confirmText: 'نعم، غيّر الكود',
      type: 'danger'
    });
    if (!ok) return;

    const btn = document.getElementById('confirmRevokeBtn');
    window.UI.setLoading(btn, true, 'جاري التغيير...');

    try {
      const result = await window.Core.api('revokeChildId', {
        childID: childID,
        reason: reason,
        notes: notes
      }, 'POST');

      if (!result.success) {
        window.UI.toast.error(result.message || 'فشل تغيير الكود');
        return;
      }

      closeRevokeModal();
      showRevokeSuccess(result);
      loadList();

    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر تغيير الكود');
    } finally {
      window.UI.setLoading(btn, false);
    }
  }

  function showRevokeSuccess(data) {
    state.revokeData = data;

    document.getElementById('revoke_newID').textContent = data.newChildID;
    document.getElementById('revoke_qrImage').src = data.newQRUrl;

    const notifyBox = document.getElementById('revoke_notifyStatus');
    if (data.notifiedVia === 'لا') {
      notifyBox.innerHTML = '<i class="fas fa-exclamation-triangle"></i> تعذر إشعار الأسرة — تواصل معهم مباشرةً';
      notifyBox.className = 'revoke-status-box warning';
    } else {
      const channel = data.notifiedVia === 'telegram' ? 'تليجرام' : 'البريد الإلكتروني';
      notifyBox.innerHTML = '<i class="fas fa-check-circle"></i> تم إشعار الأسرة عبر ' + channel;
      notifyBox.className = 'revoke-status-box success';
    }

    window.UI.modal.open('revokeSuccessModal');
  }

  function closeRevokeSuccessModal() {
    window.UI.modal.close('revokeSuccessModal');
    closeEditModal();
    loadList();
  }

  function copyAllRevokeData() {
    if (!state.revokeData) return;
    const d = state.revokeData;
    const text =
      'الكود القديم: ' + d.oldChildID + '\n' +
      'الكود الجديد: ' + d.newChildID + '\n' +
      'رابط QR: ' + d.newQRUrl + '\n' +
      'رابط الطفل: ' + d.newChildLink;

    copyToClipboard(text);
  }

  async function downloadRevokeQR() {
    if (!state.revokeData || !state.revokeData.newQRUrl) return;

    try {
      const response = await fetch(state.revokeData.newQRUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = state.revokeData.newChildID + '_qr.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      window.UI.toast.success('تم تحميل QR');
    } catch (e) {
      window.UI.toast.error('تعذر تحميل QR');
    }
  }

  function copyToClipboard(text) {
    if (!text || text === '—') {
      window.UI.toast.warning('لا يوجد نص للنسخ');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function() { window.UI.toast.success('تم النسخ'); })
        .catch(function() { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      window.UI.toast.success('تم النسخ');
    } catch (e) {
      window.UI.toast.error('فشل النسخ');
    }
    document.body.removeChild(ta);
  }

    // ============================================================
  //  💳 المدفوعات — تحميل + عرض
  // ============================================================
  async function loadChildPayments() {
    if (!state.currentChild || state.paymentsLoading) return;

    const childID = state.currentChild.child_id || state.currentChild.childID;
    if (!childID) return;

    state.paymentsLoading = true;

    // عرض loading
    document.getElementById('paymentsLoading').style.display = 'block';
    document.getElementById('paymentsEmpty').style.display = 'none';
    document.getElementById('paymentsContent').style.display = 'none';
    document.getElementById('paymentsAlert').style.display = 'none';

    try {
      const result = await window.Core.api('getChildPayments', { childID: childID }, 'GET');

      if (!result.success) {
        document.getElementById('paymentsLoading').style.display = 'none';
        document.getElementById('paymentsEmpty').style.display = 'block';
        window.UI.toast.error(result.message || result.error || 'فشل تحميل المدفوعات');
        return;
      }

      state.currentPayments = result.payments || [];
      state.currentPaymentsHasScans = !!result.hasScans;
      state.paymentsLoaded = true;

      renderPayments();
    } catch (e) {
      document.getElementById('paymentsLoading').style.display = 'none';
      document.getElementById('paymentsEmpty').style.display = 'block';
      window.UI.toast.error(e.userMessage || 'تعذر تحميل المدفوعات');
    } finally {
      state.paymentsLoading = false;
    }
  }

  function renderPayments() {
    document.getElementById('paymentsLoading').style.display = 'none';

    const payments = state.currentPayments;
    const hasScans = state.currentPaymentsHasScans;

    // تنبيه المسح (لو حصل مسح أكثر من 10 مرات — كل المدفوعات غير قابلة للاسترداد)
    const alertEl = document.getElementById('paymentsAlert');
    if (hasScans) {
      document.getElementById('paymentsAlertText').textContent =
        'تم مسح QR لهذا الطفل أكثر من 10 مرات — غير مؤهل للاسترداد حسب سياسة الاسترداد.';
      alertEl.style.display = 'flex';
    } else {
      alertEl.style.display = 'none';
    }

    if (!payments || payments.length === 0) {
      document.getElementById('paymentsEmpty').style.display = 'block';
      document.getElementById('paymentsContent').style.display = 'none';
      return;
    }

    document.getElementById('paymentsEmpty').style.display = 'none';
    document.getElementById('paymentsContent').style.display = 'block';

    const tbody = document.getElementById('paymentsTableBody');
    if (!tbody) return;

    let html = '';
    payments.forEach(function(p) {
      const statusInfo = getPaymentStatusInfo(p.status);
      const typeLabel = p.type === 'renewal' ? 'تجديد' : 'أولية';
      const paidDate = p.paid_at || p.created_at;
      // ✅ تاريخ الدفع بصيغة سطرين عربي
      const dateCell = buildTwoLineDateCell(paidDate);
      const amountStr = (p.amount_egp || 0) + ' ' + (p.currency || 'EGP');

      let eligibilityBadge;
      if (p.eligible) {
        eligibilityBadge = '<span class="badge badge-success">مؤهل</span>';
      } else {
        eligibilityBadge = '<span class="badge badge-muted" title="' + escapeAttr(getIneligibleReasonLabel(p.ineligibleReason)) + '">غير مؤهل</span>';
      }

      let actionBtn;
      const user = window.Core.getUser ? window.Core.getUser() : null;
      const isSuper = user && user.isSuperAdmin;

      if (p.status === 'refunding') {
        actionBtn = '<button class="btn btn-sm btn-danger refund-payment-btn" data-payment-id="' + escapeAttr(p.id) + '">' +
          '<i class="fas fa-check-circle"></i> تأكيد الاسترداد' +
        '</button>';
      } else if (p.eligible) {
        actionBtn = '<button class="btn btn-sm btn-danger refund-payment-btn" data-payment-id="' + escapeAttr(p.id) + '">' +
          '<i class="fas fa-undo-alt"></i> طلب استرداد' +
        '</button>';
      } else if (p.ineligibleReason === 'service_used' && isSuper && p.status === 'paid') {
        actionBtn = '<button class="btn btn-sm btn-warning refund-override-btn" data-payment-id="' + escapeAttr(p.id) + '" title="تخطي شرط عدد المسحات">' +
          '<i class="fas fa-exclamation-triangle"></i> تخطي شرط عدد المسحات' +
        '</button>';
      } else if (p.status === 'refunded') {
        actionBtn = '<span class="text-muted" style="font-size:0.75rem;">تم الاسترداد</span>';
      } else {
        actionBtn = '<span class="text-muted" style="font-size:0.75rem;">—</span>';
      }

      html += '<tr>' +
        '<td class="cell-date">' + dateCell + '</td>' +
        '<td class="cell-amount">' + window.UI.escapeHtml(amountStr) + '</td>' +
        '<td>' + window.UI.escapeHtml(p.plan || '—') + '</td>' +
        '<td>' + window.UI.escapeHtml(typeLabel) + '</td>' +
        '<td><span class="badge ' + statusInfo.cls + '">' + statusInfo.label + '</span></td>' +
        '<td>' + eligibilityBadge + '</td>' +
        '<td class="cell-actions">' + actionBtn + '</td>' +
      '</tr>';
    });

    tbody.innerHTML = html;

    // ربط أزرار الاسترداد
    tbody.querySelectorAll('.refund-payment-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const paymentId = this.getAttribute('data-payment-id');
        openRefundModal(paymentId);
      });
    });

    // ✅ ربط أزرار Override
    tbody.querySelectorAll('.refund-override-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const paymentId = this.getAttribute('data-payment-id');
        openRefundModalWithOverride(paymentId);
      });
    });
  }

  function getPaymentStatusInfo(status) {
    const map = {
      'pending':    { label: 'قيد الانتظار', cls: 'badge-warning' },
      'paid':       { label: 'مدفوع', cls: 'badge-success' },
      'failed':     { label: 'فشل', cls: 'badge-danger' },
      'refunding':  { label: 'جاري الاسترداد', cls: 'badge-warning' },
      'refunded':   { label: 'مسترد', cls: 'badge-muted' }
    };
    return map[String(status || '').toLowerCase()] || { label: status || '—', cls: 'badge-muted' };
  }

  function getIneligibleReasonLabel(reason) {
    const map = {
      'already_refunded': 'تم الاسترداد مسبقًا',
      'refund_in_progress': 'عملية استرداد جارية',
      'not_paid': 'الدفعة لم تكتمل',
      'service_used': 'تجاوز الحد الأقصى للمسحات (10)',
      'before_14_days': 'لم تمر 14 يومًا كاملة',
      'missing_transaction_id': 'رقم المعاملة مفقود'
    };
    return map[reason] || reason || 'غير مؤهل';
  }

  // ============================================================
  //  💸 الاسترداد — Modal + تأكيد
  // ============================================================
  function openRefundModal(paymentId) {
    const payment = state.currentPayments.find(function(p) { return p.id === paymentId; });
    if (!payment) {
      window.UI.toast.error('الدفعة غير موجودة');
      return;
    }

    // السماح بفتح المودال لو الحالة refunding أو مؤهل
    if (!payment.eligible && payment.status !== 'refunding') {
      window.UI.toast.error(getIneligibleReasonLabel(payment.ineligibleReason));
      return;
    }

    state.currentRefundPayment = payment;

    const childID = state.currentChild.child_id || state.currentChild.childID;

    // تعبئة البيانات
    document.getElementById('refund_childID').textContent = childID;
    document.getElementById('refund_amount').textContent = (payment.amount_egp || 0) + ' ' + (payment.currency || 'EGP');
    document.getElementById('refund_plan').textContent = payment.plan || '—';
    // ✅ تاريخ الدفع بصيغة عربية كاملة (تفاصيل modal - مساحة كافية)
    document.getElementById('refund_paidAt').textContent = formatDateTimeFull(payment.paid_at || payment.created_at) || '—';
    document.getElementById('refund_days').textContent = (payment.daysSincePaid !== null && payment.daysSincePaid !== undefined)
      ? payment.daysSincePaid + ' يوم'
      : '—';

    // Reset form
    document.getElementById('refund_reason').value = '';
    document.getElementById('refund_reason_count').textContent = '0';
    document.getElementById('refund_confirmID').value = '';
    document.getElementById('refund_override_scans').checked = false;

    // ✅ إظهار Override فقط لو super_admin (وفقط لو فيه مسحات)
    const overrideGroup = document.getElementById('refund_override_group');
    if (overrideGroup) {
      const user = window.Core.getUser ? window.Core.getUser() : null;
      const isSuper = user && user.isSuperAdmin;
      overrideGroup.style.display = isSuper ? 'block' : 'none';
    }

    window.UI.modal.open('refundModal');
    updateRefundButtonState();
  }

    // ✅ استرداد بـ Override (super_admin فقط، للدفعات "service_used")
  function openRefundModalWithOverride(paymentId) {
    const payment = state.currentPayments.find(function(p) { return p.id === paymentId; });
    if (!payment) {
      window.UI.toast.error('الدفعة غير موجودة');
      return;
    }

    if (payment.ineligibleReason !== 'service_used') {
      window.UI.toast.error(getIneligibleReasonLabel(payment.ineligibleReason));
      return;
    }

    state.currentRefundPayment = payment;

    const childID = state.currentChild.child_id || state.currentChild.childID;

    document.getElementById('refund_childID').textContent = childID;
    document.getElementById('refund_amount').textContent = (payment.amount_egp || 0) + ' ' + (payment.currency || 'EGP');
    document.getElementById('refund_plan').textContent = payment.plan || '—';
    // ✅ تاريخ الدفع بصيغة عربية كاملة
    document.getElementById('refund_paidAt').textContent = formatDateTimeFull(payment.paid_at || payment.created_at) || '—';
    document.getElementById('refund_days').textContent = (payment.daysSincePaid !== null && payment.daysSincePaid !== undefined)
      ? payment.daysSincePaid + ' يوم'
      : '—';

    // Reset form
    document.getElementById('refund_reason').value = '';
    document.getElementById('refund_reason_count').textContent = '0';
    document.getElementById('refund_confirmID').value = '';

    // ✅ فعّل الـ override افتراضيًا
    document.getElementById('refund_override_scans').checked = true;

    // إظهار الـ override group (لأن super_admin)
    const overrideGroup = document.getElementById('refund_override_group');
    if (overrideGroup) overrideGroup.style.display = 'block';

    window.UI.modal.open('refundModal');
    updateRefundButtonState();
  }

  function closeRefundModal() {
    window.UI.modal.close('refundModal');
    state.currentRefundPayment = null;
  }

  function updateRefundButtonState() {
    if (!state.currentRefundPayment) return;

    const childID = state.currentChild
      ? (state.currentChild.child_id || state.currentChild.childID)
      : '';
    const reason = document.getElementById('refund_reason').value.trim();
    const confirmID = document.getElementById('refund_confirmID').value.trim();

    const valid = reason.length >= 10 && confirmID === childID;

    const btn = document.getElementById('confirmRefundBtn');
    if (btn) btn.disabled = !valid;
  }

  async function confirmRefund() {
    if (!state.currentRefundPayment || !state.currentChild) return;

    const childID = state.currentChild.child_id || state.currentChild.childID;
    const paymentId = state.currentRefundPayment.id;
    const reason = document.getElementById('refund_reason').value.trim();
    const confirmID = document.getElementById('refund_confirmID').value.trim();

    if (confirmID !== childID) {
      window.UI.toast.error('كود التأكيد غير مطابق');
      return;
    }

    if (reason.length < 10) {
      window.UI.toast.error('السبب يجب أن يكون 10 أحرف على الأقل');
      return;
    }

    const ok = await window.UI.confirm({
      title: '⚠️ تأكيد نهائي',
      message: 'سيتم استرداد مبلغ ' + state.currentRefundPayment.amount_egp + ' EGP للعميل عبر Paymob، وإلغاء اشتراك الطفل. هل أنت متأكد؟',
      confirmText: 'نعم، استرداد',
      type: 'danger'
    });
    if (!ok) return;

    const btn = document.getElementById('confirmRefundBtn');
    window.UI.setLoading(btn, true, 'جاري الاسترداد...');

    try {
      const skipScanCheck = document.getElementById('refund_override_scans').checked === true;

      const result = await window.Core.api('refundChildPayment', {
        childID: childID,
        paymentId: paymentId,
        reason: reason,
        skipScanCheck: skipScanCheck
      }, 'POST');

      if (!result.success) {
        const msg = result.message || result.detail || result.error || 'فشل الاسترداد';
        window.UI.toast.error(msg);
        return;
      }

      closeRefundModal();
      showRefundSuccess(result);
      loadChildPayments();  // إعادة تحميل قائمة المدفوعات
      loadList();           // تحديث قائمة الأطفال (الحالة تغيرت)

    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الاتصال بالخادم');
    } finally {
      window.UI.setLoading(btn, false);
    }
  }

  function showRefundSuccess(data) {
    document.getElementById('refundSuccess_message').textContent =
      'تم استرداد ' + (data.amountEGP || 0) + ' EGP للعميل عبر Paymob. سيصل المبلغ خلال 5-7 أيام عمل.';
    document.getElementById('refundSuccess_refundId').textContent =
      'Refund ID: ' + (data.refundId || '—');

    window.UI.modal.open('refundSuccessModal');
  }

  function closeRefundSuccessModal() {
    window.UI.modal.close('refundSuccessModal');
  }

  function escapeAttr(str) {
    return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // ============================================================
  //  🌐 التصدير
  // ============================================================
  window.ChildrenPage = {
    init: init,
    reload: reload
  };

})();