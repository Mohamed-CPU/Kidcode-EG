// ================================================================
//  admin/js/withdrawals.js — إدارة طلبات السحب من لوحة الأدمن
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
    fromDate: '',
    toDate: '',
    list: [],
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
    currentRequest: null,
    currentMarketer: null,
    isSaving: false,
    newStatus: null,
    uploadedScreenshotUrl: null,
    isUploading: false
  };

  const STATUS_LABELS = {
    submitted:    { label: 'تم إرسال طلب', emoji: '📤' },
    under_review: { label: 'قيد المراجعة', emoji: '🔍' },
    sending:      { label: 'قيد الإرسال', emoji: '💸' },
    sent:         { label: 'تم الإرسال', emoji: '✅' },
    rejected:     { label: 'مرفوض', emoji: '❌' },
    cancelled:    { label: 'ملغى', emoji: '⚪' },
    failed:       { label: 'فشل التحويل', emoji: '⚠️' },
    expired:      { label: 'منتهي الصلاحية', emoji: '⏰' }
  };

  const ALLOWED_TRANSITIONS = {
    submitted:    ['under_review', 'sending', 'sent', 'rejected', 'failed', 'cancelled'],
    under_review: ['sending', 'sent', 'rejected', 'failed', 'cancelled'],
    sending:      ['sent', 'failed', 'cancelled'],
    sent:         [],
    rejected:     [],
    cancelled:    [],
    failed:       [],
    expired:      []
  };

  // ============================================================
  //  🚀 init / reload
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

    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter) {
      statusFilter.addEventListener('change', function() {
        state.status = statusFilter.value;
        state.page = 1;
        loadList();
      });
    }

    const fromDateFilter = document.getElementById('fromDateFilter');
    if (fromDateFilter) {
      fromDateFilter.addEventListener('change', function() {
        state.fromDate = fromDateFilter.value;
        state.page = 1;
        loadList();
      });
    }

    const toDateFilter = document.getElementById('toDateFilter');
    if (toDateFilter) {
      toDateFilter.addEventListener('change', function() {
        state.toDate = toDateFilter.value;
        state.page = 1;
        loadList();
      });
    }

    const clearBtn = document.getElementById('clearFiltersBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        document.getElementById('searchInput').value = '';
        document.getElementById('statusFilter').value = '';
        document.getElementById('fromDateFilter').value = '';
        document.getElementById('toDateFilter').value = '';
        state.search = ''; state.status = ''; state.fromDate = ''; state.toDate = ''; state.page = 1;
        loadList();
      });
    }

    const closeBtn = document.getElementById('wdCloseModalBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    const cancelBtn = document.getElementById('wdCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    const saveBtn = document.getElementById('wdSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveStatusChange);

    // Upload area events
    const uploadArea = document.getElementById('wdUploadArea');
    const fileInput = document.getElementById('wdScreenshotFileInput');
    if (uploadArea && fileInput) {
      uploadArea.addEventListener('click', function(e) {
        if (e.target.closest('.wd-upload-remove')) return;
        if (state.isUploading) return;
        fileInput.click();
      });

      fileInput.addEventListener('change', function(e) {
        if (e.target.files[0]) handleFileSelect(e.target.files[0]);
        e.target.value = '';
      });
    }

    const removeBtn = document.getElementById('wdUploadRemoveBtn');
    if (removeBtn) {
      removeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        resetUploadState();
      });
    }

    // Screenshot thumb click (preview in new tab)
    const thumb = document.getElementById('wdExistingScreenshotThumb');
    if (thumb) {
      thumb.addEventListener('click', function() {
        const img = document.getElementById('wdExistingScreenshotImg');
        if (img && img.src) window.open(img.src, '_blank');
      });
    }
  }

  // ============================================================
  //  📊 loadStats
  // ============================================================
  async function loadStats() {
    try {
      const result = await window.Core.api('getWithdrawalsStats', {}, 'GET');
      if (!result.success) return;

      const s = result.stats;
      setText('statTotal', s.total);
      setText('statPending', (s.submitted || 0) + (s.under_review || 0) + (s.sending || 0));
      setText('statSent', s.sent || 0);
      setText('statRejected', (s.rejected || 0) + (s.failed || 0));
      setText('statCancelled', s.cancelled || 0);
      setText('statTotalAmount', s.totalAmount.toLocaleString('ar-EG') + ' ج.م');
      setText('statPendingAmount', s.pendingAmount.toLocaleString('ar-EG') + ' ج.م');
    } catch (e) {
      console.warn('loadStats error:', e);
    }
  }

  // ============================================================
  //  📋 loadList
  // ============================================================
  async function loadList() {
    if (state.isLoading) return;
    state.isLoading = true;
    showTableLoading();

    try {
      const params = {
        page: state.page,
        pageSize: state.pageSize
      };
      if (state.search) params.search = state.search;
      if (state.status) params.status = state.status;
      if (state.fromDate) params.fromDate = state.fromDate;
      if (state.toDate) params.toDate = state.toDate;

      const result = await window.Core.api('getWithdrawalsList', params, 'GET');

      if (!result.success) {
        window.UI.toast.error(result.error || 'فشل تحميل القائمة');
        showEmptyTable('فشل التحميل');
        return;
      }

      state.list = result.list || [];
      state.pagination = result.pagination || { page: 1, pageSize: 50, total: 0, totalPages: 0 };

      renderList();
      renderPagination();
      updateInfo();

    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الاتصال بالخادم');
      showEmptyTable('فشل التحميل');
    } finally {
      state.isLoading = false;
    }
  }

  // ============================================================
  //  🎨 renderList
  // ============================================================
  function renderList() {
    const body = document.getElementById('wdTableBody');
    if (!body) return;

    if (state.list.length === 0) {
      showEmptyTable('لا توجد طلبات');
      return;
    }

    let html = '';
    state.list.forEach(function(r) {
      const st = STATUS_LABELS[r.status] || { label: r.status, emoji: '' };
      const dateCell = buildTwoLineDateCell(r.createdAt);
      const methodLabel = r.method === 'instapay' ? 'انستاباي' : 'محفظة';

      html += '<tr class="wd-row" data-request-id="' + escapeAttr(r.requestId) + '">' +
        '<td><span class="wd-request-id">' + window.UI.escapeHtml(r.requestId) + '</span></td>' +
        '<td class="wd-marketer-cell">' +
          '<div>' + window.UI.escapeHtml(r.marketerName || '—') + '</div>' +
          '<div class="code">' + window.UI.escapeHtml(r.marketerCode || '') + '</div>' +
        '</td>' +
        '<td><span class="wd-amount">' + r.amount + ' ج.م</span></td>' +
        '<td>' + window.UI.escapeHtml(methodLabel) + '</td>' +
        '<td class="mono" style="direction:ltr; text-align:right; font-size:0.82rem;">' + window.UI.escapeHtml(r.transferNumber || '—') + '</td>' +
        '<td><span class="wd-status-badge ' + r.status + '">' + st.emoji + ' ' + st.label + '</span></td>' +
        '<td>' + dateCell + '</td>' +
        '<td class="cell-actions" onclick="event.stopPropagation();">' +
          '<button class="btn btn-sm btn-secondary edit-row-btn" data-request-id="' + escapeAttr(r.requestId) + '" title="فتح">' +
            '<i class="fas fa-arrow-left"></i>' +
          '</button>' +
        '</td>' +
      '</tr>';
    });

    body.innerHTML = html;

    body.querySelectorAll('.wd-row').forEach(function(row) {
      row.addEventListener('click', function() {
        openModal(this.getAttribute('data-request-id'));
      });
    });

    body.querySelectorAll('.edit-row-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        openModal(this.getAttribute('data-request-id'));
      });
    });
  }

  function showTableLoading() {
    const body = document.getElementById('wdTableBody');
    if (body) {
      body.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:40px;">' +
        '<i class="fas fa-spinner fa-spin" style="font-size:1.5rem; color:var(--accent);"></i></td></tr>';
    }
  }

  function showEmptyTable(msg) {
    const body = document.getElementById('wdTableBody');
    if (body) {
      body.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:40px; color:var(--text-muted);">' +
        window.UI.escapeHtml(msg) + '</td></tr>';
    }
  }

  function updateInfo() {
    const el = document.getElementById('listInfo');
    if (!el) return;
    el.textContent = 'إجمالي: ' + (state.pagination.total || 0) + ' طلب';
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
  //  🔓 فتح Modal
  // ============================================================
  async function openModal(requestId) {
    if (!requestId) return;

    window.UI.modal.open('wdDetailsModal');
    document.getElementById('wdModalRequestId').textContent = requestId;
    document.getElementById('wdSaveBtn').disabled = true;

    // reset
    state.currentRequest = null;
    state.currentMarketer = null;
    state.newStatus = null;
    state.uploadedScreenshotUrl = null;
    resetUploadState();
    clearAllErrors();

    try {
      const result = await window.Core.api('getWithdrawalDetails', { requestId: requestId }, 'GET');
      if (!result.success) {
        window.UI.toast.error(result.message || 'فشل تحميل البيانات');
        closeModal();
        return;
      }

      state.currentRequest = result.request;
      state.currentMarketer = result.marketer;
      populateModal(result.request, result.marketer);

    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر تحميل البيانات');
      closeModal();
    }
  }

  function closeModal() {
    window.UI.modal.close('wdDetailsModal');
    state.currentRequest = null;
    state.currentMarketer = null;
    state.newStatus = null;
    state.uploadedScreenshotUrl = null;
    resetUploadState();
  }

  // ============================================================
  //  📝 تعبئة Modal
  // ============================================================
  function populateModal(req, marketer) {
    // Header ID
    document.getElementById('wdModalRequestId').textContent = req.requestId;

    // Info grid
    setText('wdMarketerCode', req.marketerCode || '—');
    setText('wdMarketerName', req.marketerName || '—');
    setText('wdMarketerEmail', req.marketerEmail || '—');
    setText('wdAmount', req.amount + ' ج.م');
    setText('wdMethod', req.method === 'instapay' ? 'انستاباي' : 'محفظة إلكترونية');
    setText('wdTransferNumber', req.transferNumber || '—');
    setText('wdCreatedAt', formatDateTimeFull(req.createdAt));
    setText('wdUpdatedAt', formatDateTimeFull(req.updatedAt));

    // Current status badge
    const badge = document.getElementById('wdCurrentStatusBadge');
    const st = STATUS_LABELS[req.status] || { label: req.status, emoji: '' };
    if (badge) {
      badge.className = 'wd-status-badge ' + req.status;
      badge.textContent = st.emoji + ' ' + st.label;
    }

    // Existing reason
    const existingReasonBlock = document.getElementById('wdExistingReasonBlock');
    const existingReasonLabel = document.getElementById('wdExistingReasonLabel');
    const existingReasonText = document.getElementById('wdExistingReasonText');

    if (req.status === 'rejected' && req.rejectionReason) {
      existingReasonBlock.style.display = 'block';
      existingReasonLabel.textContent = 'سبب الرفض:';
      existingReasonText.textContent = req.rejectionReason;
    } else if (req.status === 'cancelled' && req.cancellationReason) {
      existingReasonBlock.style.display = 'block';
      existingReasonLabel.textContent = 'سبب الإلغاء:';
      existingReasonText.textContent = req.cancellationReason;
    } else if (req.status === 'failed' && req.rejectionReason) {
      existingReasonBlock.style.display = 'block';
      existingReasonLabel.textContent = 'سبب الفشل:';
      existingReasonText.textContent = req.rejectionReason;
    } else {
      existingReasonBlock.style.display = 'none';
    }

    // Existing screenshot
    const existingScreenshotBlock = document.getElementById('wdExistingScreenshotBlock');
    const existingScreenshotImg = document.getElementById('wdExistingScreenshotImg');
    if (req.screenshotUrl) {
      existingScreenshotBlock.style.display = 'block';
      existingScreenshotImg.src = req.screenshotUrl;
    } else {
      existingScreenshotBlock.style.display = 'none';
      existingScreenshotImg.src = '';
    }

    // Existing notes
    const existingNotesBlock = document.getElementById('wdExistingNotesBlock');
    // 🆕 Children List
    const childrenBlock = document.getElementById('wdChildrenBlock');
    const childrenList = document.getElementById('wdChildrenList');
    if (req.children && req.children.length > 0) {
      childrenList.innerHTML = req.children.map(c => 
        `<li style="margin-bottom: 6px; font-size: 0.9rem; color: #1E3A8A; display: flex; justify-content: space-between;">
           <span>👶 ${c.childName} (${c.childID})</span>
           <strong style="color: #22559F;">${c.commission} ج.م</strong>
         </li>`
      ).join('');
      childrenBlock.style.display = 'block';
    } else {
      childrenBlock.style.display = 'none';
    }
    const existingNotesText = document.getElementById('wdExistingNotesText');
    if (req.adminNotes) {
      existingNotesBlock.style.display = 'block';
      existingNotesText.textContent = req.adminNotes;
    } else {
      existingNotesBlock.style.display = 'none';
    }

    // Status change section
    renderStatusOptions(req.status);

    // Admin notes (prefill)
    const adminNotesInput = document.getElementById('wdAdminNotes');
    if (adminNotesInput) adminNotesInput.value = req.adminNotes || '';

    // Save button
    const allowed = ALLOWED_TRANSITIONS[req.status] || [];
    const changeSection = document.getElementById('wdStatusChangeSection');
    const saveBtn = document.getElementById('wdSaveBtn');

    if (allowed.length === 0) {
      if (changeSection) changeSection.style.display = 'none';
      if (saveBtn) saveBtn.disabled = true;
    } else {
      if (changeSection) changeSection.style.display = 'block';
      if (saveBtn) saveBtn.disabled = true; // يفعّل عند اختيار حالة
    }
  }

  // ============================================================
  //  🔄 renderStatusOptions
  // ============================================================
  function renderStatusOptions(currentStatus) {
    const container = document.getElementById('wdStatusOptions');
    if (!container) return;

    const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
    if (allowed.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">لا يمكن تغيير الحالة من الحالة الحالية.</p>';
      return;
    }

    let html = '';
    allowed.forEach(function(status) {
      const st = STATUS_LABELS[status] || { label: status, emoji: '' };
      html += '<label class="wd-status-radio">' +
        '<input type="radio" name="wdNewStatus" value="' + status + '">' +
        '<span>' + st.emoji + ' ' + st.label + '</span>' +
      '</label>';
    });
    container.innerHTML = html;

    // Bind change
    container.querySelectorAll('input[name="wdNewStatus"]').forEach(function(radio) {
      radio.addEventListener('change', function() {
        handleStatusChange(this.value);
      });
    });
  }

  // ============================================================
  //  🎯 handleStatusChange
  // ============================================================
  function handleStatusChange(newStatus) {
    state.newStatus = newStatus;

    const rejectionBox = document.getElementById('wdRejectionReasonBox');
    const cancellationBox = document.getElementById('wdCancellationReasonBox');
    const screenshotBox = document.getElementById('wdScreenshotUploadBox');

    // Reset
    rejectionBox.style.display = 'none';
    cancellationBox.style.display = 'none';
    screenshotBox.style.display = 'none';
    clearAllErrors();

    if (newStatus === 'rejected' || newStatus === 'failed') {
      rejectionBox.style.display = 'block';
    }
    if (newStatus === 'cancelled') {
      cancellationBox.style.display = 'block';
    }
    if (newStatus === 'sent') {
      screenshotBox.style.display = 'block';
      // لو الصورة اترفعت قبل كده في نفس الجلسة، اعرضها
      if (state.uploadedScreenshotUrl) {
        showUploadPreview(state.uploadedScreenshotUrl);
      }
    }

    validateSaveBtn();
  }

  function validateSaveBtn() {
    const saveBtn = document.getElementById('wdSaveBtn');
    if (!saveBtn) return;

    if (!state.newStatus) {
      saveBtn.disabled = true;
      return;
    }

    let valid = true;

    if (state.newStatus === 'rejected' || state.newStatus === 'failed') {
      const reason = (document.getElementById('wdRejectionReason').value || '').trim();
      if (reason.length < 5) valid = false;
    }

    if (state.newStatus === 'cancelled') {
      const reason = (document.getElementById('wdCancellationReason').value || '').trim();
      if (reason.length < 5) valid = false;
    }

    if (state.newStatus === 'sent') {
      if (!state.uploadedScreenshotUrl) valid = false;
    }

    saveBtn.disabled = !valid;
  }

  // ============================================================
  //  📸 Upload handling
  // ============================================================
  function handleFileSelect(file) {
    if (!file) return;

    // Validation
    const allowedMimes = ['image/png', 'image/jpeg', 'image/jpg'];
    if (!allowedMimes.includes(file.type)) {
      window.UI.toast.error('يُسمح فقط بـ PNG أو JPG');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      window.UI.toast.error('حجم الصورة يتجاوز 5 ميجابايت');
      return;
    }

    // Convert to base64
    const reader = new FileReader();
    reader.onload = function(e) {
      const dataUrl = e.target.result;
      const base64 = dataUrl.split(',')[1];

      // Preview
      showUploadPreview(dataUrl);

      // Upload
      uploadToCloudinary(base64, file.name, file.type);
    };
    reader.onerror = function() {
      window.UI.toast.error('تعذر قراءة الملف');
    };
    reader.readAsDataURL(file);
  }

  async function uploadToCloudinary(base64, fileName, mimeType) {
    if (state.isUploading) return;
    state.isUploading = true;

    const placeholder = document.getElementById('wdUploadPlaceholder');
    const preview = document.getElementById('wdUploadPreview');
    const loader = document.getElementById('wdUploadLoader');

    if (placeholder) placeholder.style.display = 'none';
    if (preview) preview.style.display = 'none';
    if (loader) loader.style.display = 'block';

    try {
      const result = await window.Core.api('uploadWithdrawalScreenshot', {
        requestId: state.currentRequest.requestId,
        base64: base64,
        fileName: fileName,
        mimeType: mimeType
      }, 'POST');

      if (result.success) {
        state.uploadedScreenshotUrl = result.url;
        showUploadPreview(result.url);
        window.UI.toast.success('تم رفع الصورة بنجاح');
      } else {
        window.UI.toast.error(result.message || 'فشل رفع الصورة');
        resetUploadState();
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر رفع الصورة');
      resetUploadState();
    } finally {
      state.isUploading = false;
      if (loader) loader.style.display = 'none';
      validateSaveBtn();
    }
  }

  function showUploadPreview(url) {
    const placeholder = document.getElementById('wdUploadPlaceholder');
    const preview = document.getElementById('wdUploadPreview');
    const img = document.getElementById('wdUploadPreviewImg');
    if (placeholder) placeholder.style.display = 'none';
    if (preview) preview.style.display = 'block';
    if (img) img.src = url;
  }

  function resetUploadState() {
    state.uploadedScreenshotUrl = null;
    const placeholder = document.getElementById('wdUploadPlaceholder');
    const preview = document.getElementById('wdUploadPreview');
    const img = document.getElementById('wdUploadPreviewImg');
    if (placeholder) placeholder.style.display = 'block';
    if (preview) preview.style.display = 'none';
    if (img) img.src = '';
    validateSaveBtn();
  }

  // ============================================================
  //  💾 حفظ التغيير
  // ============================================================
  async function saveStatusChange() {
    if (state.isSaving) return;
    if (!state.currentRequest || !state.newStatus) return;

    // Validation
    clearAllErrors();
    let valid = true;

    if (state.newStatus === 'rejected' || state.newStatus === 'failed') {
      const reason = (document.getElementById('wdRejectionReason').value || '').trim();
      if (reason.length < 5) {
        showError('wdRejectionReasonError', 'السبب مطلوب (5 أحرف على الأقل)');
        valid = false;
      }
    }
    if (state.newStatus === 'cancelled') {
      const reason = (document.getElementById('wdCancellationReason').value || '').trim();
      if (reason.length < 5) {
        showError('wdCancellationReasonError', 'السبب مطلوب (5 أحرف على الأقل)');
        valid = false;
      }
    }
    if (state.newStatus === 'sent' && !state.uploadedScreenshotUrl) {
      showError('wdScreenshotError', 'سكرين شوت التحويل مطلوب');
      valid = false;
    }
    if (!valid) return;

    // Confirm if terminal status
    const terminal = ['rejected', 'cancelled', 'sent'];
    if (terminal.includes(state.newStatus)) {
      const ok = await window.UI.confirm({
        title: 'تأكيد التغيير',
        message: 'سيتم تحويل الطلب إلى "' + STATUS_LABELS[state.newStatus].label + '". هل أنت متأكد؟',
        confirmText: 'تأكيد',
        type: state.newStatus === 'sent' ? 'success' : 'warning'
      });
      if (!ok) return;
    }

    state.isSaving = true;
    const btn = document.getElementById('wdSaveBtn');
    window.UI.setLoading(btn, true, 'جاري الحفظ...');

    try {
      const payload = {
        requestId: state.currentRequest.requestId,
        newStatus: state.newStatus,
        adminNotes: (document.getElementById('wdAdminNotes').value || '').trim() || undefined
      };

      if (state.newStatus === 'rejected' || state.newStatus === 'failed') {
        payload.rejectionReason = (document.getElementById('wdRejectionReason').value || '').trim();
      }
      if (state.newStatus === 'cancelled') {
        payload.cancellationReason = (document.getElementById('wdCancellationReason').value || '').trim();
      }
      if (state.newStatus === 'sent') {
        payload.screenshotUrl = state.uploadedScreenshotUrl;
      }

      const result = await window.Core.api('updateWithdrawalStatus', payload, 'POST');

      if (result.success) {
        let msg = '✅ ' + (result.message || 'تم التحديث');
        if (result.notified && result.notified.success) {
          msg += ' — تم إشعار المسوق عبر ' + (result.notified.channel === 'telegram' ? 'تليجرام' : 'البريد');
        }
        window.UI.toast.success(msg, { duration: 5000 });

        closeModal();
        loadList();
        loadStats();

        // 🆕 تحديث الـ badge في السايدبار فوراً
        if (window.WithdrawalsBadge && typeof window.WithdrawalsBadge.refresh === 'function') {
          window.WithdrawalsBadge.refresh();
        }
      } else {
        window.UI.toast.error(result.message || result.error || 'فشل التحديث');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الحفظ');
    } finally {
      state.isSaving = false;
      window.UI.setLoading(btn, false);
    }
  }

  // ============================================================
  //  🛠️ Helpers
  // ============================================================
  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function escapeAttr(str) {
    return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function formatDateTimeFull(value) {
    if (!value) return '—';
    try {
      if (window.AdminUtils && typeof window.AdminUtils.formatDateTime === 'function') {
        return window.AdminUtils.formatDateTime(value) || '—';
      }
      if (window.AdminUtils && typeof window.AdminUtils.formatDate === 'function') {
        return window.AdminUtils.formatDate(value) || '—';
      }
      return String(value);
    } catch (e) {
      return '—';
    }
  }

  function buildTwoLineDateCell(value) {
    if (!value) return '—';
    try {
      const dateStr = window.AdminUtils.formatDate(value) || '—';
      const timeStr = window.AdminUtils.formatCairoTime(value) || '';
      if (!timeStr || dateStr === '—') {
        return '<span style="font-size:0.82rem;">' + window.UI.escapeHtml(dateStr) + '</span>';
      }
      return '<div style="font-size:0.8rem; font-weight:600; color:var(--text-primary);">' +
               window.UI.escapeHtml(dateStr) +
             '</div>' +
             '<div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">' +
               window.UI.escapeHtml(timeStr) +
             '</div>';
    } catch (e) {
      return '—';
    }
  }

  function showError(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.classList.add('show'); }
  }

  function clearAllErrors() {
    ['wdRejectionReasonError', 'wdCancellationReasonError', 'wdScreenshotError'].forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.classList.remove('show');
    });
  }

  // ============================================================
  //  🌐 التصدير
  // ============================================================
  window.WithdrawalsPage = {
    init: init,
    reload: reload
  };

})();