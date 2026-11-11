// ================================================================
//  admin/js/reports.js — منطق صفحة البلاغات
// ================================================================

(function() {
  'use strict';

  let currentRequestId = 0;

  const state = {
    isInitialized: false,
    page: 1,
    pageSize: 50,
    search: '',
    status: '',
    sortDir: 'desc',
    list: [],
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
    currentReport: null,
    currentChild: null,
    originalStatus: ''
  };

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

    const closeModalBtn = document.getElementById('closeModalBtn');
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);

    const cancelEditBtn = document.getElementById('cancelEditBtn');
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', closeModal);

    const saveBtn = document.getElementById('saveChangesBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveStatusChange);

    const closeImgBtn = document.getElementById('closeImageViewerBtn');
    if (closeImgBtn) closeImgBtn.addEventListener('click', function() {
      window.UI.modal.close('imageViewerModal');
    });
  }

  // ============================================================
  //  📊 loadStats
  // ============================================================
  async function loadStats() {
    try {
      const result = await window.Core.api('getReportsStats', {}, 'GET');
      if (!result.success) return;

      setStat('statTotal', result.total);
      setStat('statOpen', result.open);
      setStat('statAwaiting', result.awaiting);
      setStat('statResolved', result.resolved);
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
      const result = await window.Core.api('getReportsList', {
        page: state.page,
        pageSize: state.pageSize,
        search: state.search,
        status: state.status,
        sortDir: state.sortDir
      }, 'GET');

      if (myRequestId !== currentRequestId) return;

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
      if (myRequestId !== currentRequestId) return;
      window.UI.toast.error(e.userMessage || 'تعذر الاتصال بالخادم');
      showEmptyTable('فشل التحميل');
    }
  }

  // ============================================================
  //  🎨 Render
  // ============================================================
  function renderList() {
    const body = document.getElementById('reportsTableBody');
    if (!body) return;

    if (state.list.length === 0) {
      showEmptyTable('لا توجد بلاغات');
      return;
    }

    let html = '';
    state.list.forEach(function(r) {
      const statusInfo = getStatusInfo(r.isResolved);
      // ✅ وقت البلاغ بصيغة سطرين (compact للجدول)
      const timeCell = buildTwoLineDateCell(r.reportTime);

      html += '<tr class="report-row" data-report-id="' + escapeAttr(r.reportID) + '">' +
        '<td class="cell-report-id">' + window.UI.escapeHtml(r.reportID || '—') + '</td>' +
        '<td class="cell-child-id">' + window.UI.escapeHtml(r.childID || '—') + '</td>' +
        '<td>' + window.UI.escapeHtml(r.childName || '—') + '</td>' +
        '<td><span class="badge ' + statusInfo.cls + '">' + statusInfo.label + '</span></td>' +
        '<td class="cell-date">' + timeCell + '</td>' +
        '<td class="col-governorate">' + window.UI.escapeHtml(r.governorate || '—') + '</td>' +
        '<td class="cell-district col-district" title="' + escapeAttr(r.district) + '">' + window.UI.escapeHtml(r.district || '—') + '</td>' +
        '<td class="col-volunteer">' + window.UI.escapeHtml(r.volunteerName || '—') + '</td>' +
        '<td class="cell-actions" onclick="event.stopPropagation();">' +
          '<button class="btn btn-sm btn-secondary view-row-btn" data-report-id="' + escapeAttr(r.reportID) + '" title="عرض">' +
            '<i class="fas fa-eye"></i>' +
          '</button>' +
        '</td>' +
      '</tr>';
    });

    body.innerHTML = html;

    body.querySelectorAll('.view-row-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        openDetails(this.getAttribute('data-report-id'));
      });
    });

    body.querySelectorAll('.report-row').forEach(function(row) {
      row.addEventListener('click', function() {
        openDetails(this.getAttribute('data-report-id'));
      });
    });
  }

  function showTableLoading() {
    const body = document.getElementById('reportsTableBody');
    if (body) {
      body.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:40px;">' +
        '<i class="fas fa-spinner fa-spin" style="font-size:1.5rem; color:var(--accent);"></i></td></tr>';
    }
  }

  function showEmptyTable(msg) {
    const body = document.getElementById('reportsTableBody');
    if (body) {
      body.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:40px; color:var(--text-muted);">' +
        window.UI.escapeHtml(msg) + '</td></tr>';
    }
  }

  function updateInfo() {
    const el = document.getElementById('listInfo');
    if (!el) return;
    el.textContent = 'إجمالي: ' + formatNumber(state.pagination.total || 0) + ' بلاغ';
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
  //  🔍 فتح التفاصيل
  // ============================================================
  async function openDetails(reportID) {
    if (!reportID) return;

    window.UI.modal.open('reportDetailsModal');
    document.getElementById('reportModalTitle').textContent = 'جاري التحميل...';
    document.getElementById('reportModalBody').innerHTML =
      '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i><p>جاري التحميل...</p></div>';
    document.getElementById('saveChangesBtn').style.display = 'none';

    try {
      const result = await window.Core.api('getReportDetails', { reportID: reportID }, 'GET');
      if (!result.success) {
        window.UI.toast.error(result.message || 'فشل التحميل');
        closeModal();
        return;
      }
      state.currentReport = result.report;
      state.currentChild = result.child;
      state.originalStatus = String(result.report.is_resolved || 'لا').trim();
      renderDetails(result.report, result.child);
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر التحميل');
      closeModal();
    }
  }

  function closeModal() {
    window.UI.modal.close('reportDetailsModal');
    state.currentReport = null;
    state.currentChild = null;
    state.originalStatus = '';
  }

  // ============================================================
  //  🎨 Render Details
  // ============================================================
  function renderDetails(r, child) {
    document.getElementById('reportModalTitle').textContent = 'بلاغ: ' + r.report_id;

    let html = '';

    // --- كارت الطفل ---
    html += '<div class="report-child-card">';
    if (child && child.imageUrl) {
      // ✅ دعم Cloudinary + Drive (backward compat)
      const childImgSrc = buildImageSrc(child.imageUrl, 'small');
      if (childImgSrc) {
        html += '<img src="' + escapeAttr(childImgSrc) + '" alt="' + escapeAttr(child.childName) + '">';
      } else {
        html += '<div class="no-img"><i class="fas fa-child"></i></div>';
      }
    } else {
      html += '<div class="no-img"><i class="fas fa-child"></i></div>';
    }
    html += '<div class="child-info">' +
      '<div class="child-name">' + window.UI.escapeHtml((child && child.childName) || r.child_id || '—') + '</div>' +
      '<div class="child-id">' + window.UI.escapeHtml(r.child_id || '—') + '</div>';
    if (child) {
      const phones = [];
      if (child.fatherPhone) phones.push('أب: ' + child.fatherPhone);
      if (child.motherPhone) phones.push('أم: ' + child.motherPhone);
      if (phones.length > 0) {
        html += '<div class="child-phones">' + window.UI.escapeHtml(phones.join(' · ')) + '</div>';
      }
    }
    html += '</div></div>';

    // --- Meta ---
    html += '<div class="report-meta">' +
      '<div class="meta-row"><span class="meta-label">رقم البلاغ:</span><span class="meta-value" style="font-family:var(--font-mono);">' + window.UI.escapeHtml(r.report_id || '—') + '</span></div>' +
      // ✅ الصيغة العربية الكاملة (في modal تفاصيل)
      '<div class="meta-row"><span class="meta-label">وقت البلاغ:</span><span class="meta-value">' + window.UI.escapeHtml(formatDateTimeFull(r.report_time) || '—') + '</span></div>';
    if (r.resolved_time) {
      html += '<div class="meta-row"><span class="meta-label">وقت الإغلاق:</span><span class="meta-value">' + window.UI.escapeHtml(formatDateTimeFull(r.resolved_time)) + '</span></div>';
    }
    if (r.resolved_by) {
      html += '<div class="meta-row"><span class="meta-label">أغلقه:</span><span class="meta-value">' + window.UI.escapeHtml(r.resolved_by) + '</span></div>';
    }
    if (r.found_confirmed_at) {
      html += '<div class="meta-row"><span class="meta-label">تأكيد العثور:</span><span class="meta-value">' + window.UI.escapeHtml(formatDateTimeFull(r.found_confirmed_at)) + '</span></div>';
    }
    html += '</div>';

    // --- معلومات الاختفاء ---
    html += '<div class="form-group"><label class="form-label">الملابس</label>' +
      '<input type="text" class="form-control" id="edit_clothes" value="' + escapeAttr(r.clothes || '') + '"></div>';
    html += '<div class="form-grid">' +
      '<div class="form-group"><label class="form-label">المحافظة</label>' +
      '<input type="text" class="form-control" id="edit_governorate" value="' + escapeAttr(r.governorate || '') + '"></div>' +
      '<div class="form-group"><label class="form-label">الحي</label>' +
      '<input type="text" class="form-control" id="edit_district" value="' + escapeAttr(r.district || '') + '"></div>' +
      '</div>';
    html += '<div class="form-group"><label class="form-label">العلامة المميزة</label>' +
      '<input type="text" class="form-control" id="edit_landmark" value="' + escapeAttr(r.landmark || '') + '"></div>';

    // --- بيانات المتطوع ---
    html += '<div class="form-grid">' +
      '<div class="form-group"><label class="form-label">اسم المتطوع</label>' +
      '<input type="text" class="form-control" id="edit_volunteer_name" value="' + escapeAttr(r.volunteer_name || '') + '"></div>' +
      '<div class="form-group"><label class="form-label">هاتف المتطوع</label>' +
      '<input type="tel" class="form-control" id="edit_volunteer_phone" dir="ltr" value="' + escapeAttr(r.volunteer_phone || '') + '"></div>' +
      '</div>';

    // --- بطاقة المتطوع (إن وُجدت) ---
    if (r.front_id_file || r.back_id_file) {
      html += '<div class="volunteer-id-grid">';
      if (r.front_id_file) {
        // ✅ دعم Cloudinary + Drive (backward compat)
        const frontSrc = buildImageSrc(r.front_id_file, 'medium');
        if (frontSrc) {
          html += '<div class="volunteer-id-item">' +
            '<img src="' + escapeAttr(frontSrc) + '" ' +
            'data-full="' + escapeAttr(r.front_id_file) + '" ' +
            'class="volunteer-id-img" alt="وجه البطاقة">' +
            '<div class="id-label">وجه البطاقة (اضغط للتكبير)</div></div>';
        }
      }
      if (r.back_id_file) {
        const backSrc = buildImageSrc(r.back_id_file, 'medium');
        if (backSrc) {
          html += '<div class="volunteer-id-item">' +
            '<img src="' + escapeAttr(backSrc) + '" ' +
            'data-full="' + escapeAttr(r.back_id_file) + '" ' +
            'class="volunteer-id-img" alt="ظهر البطاقة">' +
            '<div class="id-label">ظهر البطاقة (اضغط للتكبير)</div></div>';
        }
      }
      html += '</div>';
    }

    // --- تحديد الحالة ---
    html += '<label class="form-label" style="margin-top:16px; display:block;">حالة البلاغ</label>';
    html += '<div class="status-selector" id="statusSelector">' +
      '<div class="status-option open' + (r.is_resolved === 'لا' ? ' active' : '') + '" data-status="لا">' +
        '<i class="fas fa-circle-exclamation icon"></i>' +
        '<div class="label">مفتوح</div>' +
      '</div>' +
      '<div class="status-option awaiting' + (r.is_resolved === 'awaiting_confirmation' ? ' active' : '') + '" data-status="awaiting_confirmation">' +
        '<i class="fas fa-hourglass-half icon"></i>' +
        '<div class="label">بانتظار التأكيد</div>' +
      '</div>' +
      '<div class="status-option resolved' + (r.is_resolved === 'نعم' ? ' active' : '') + '" data-status="نعم">' +
        '<i class="fas fa-circle-check icon"></i>' +
        '<div class="label">مغلق</div>' +
      '</div>' +
    '</div>';

    // --- Danger Zone ---
    html += '<div class="danger-zone">' +
      '<div class="danger-zone-title"><i class="fas fa-exclamation-triangle"></i> منطقة الخطر</div>' +
      '<p class="danger-zone-desc">حذف البلاغ نهائيًا من قاعدة البيانات. لا يمكن التراجع.</p>' +
      '<button class="btn btn-danger btn-block" id="deleteReportBtn">' +
        '<i class="fas fa-trash-alt"></i> حذف نهائي' +
      '</button>' +
      '</div>';

    document.getElementById('reportModalBody').innerHTML = html;
    document.getElementById('saveChangesBtn').style.display = 'inline-flex';

    // ربط أحداث الحالة
    document.querySelectorAll('.status-option').forEach(function(opt) {
      opt.addEventListener('click', function() {
        document.querySelectorAll('.status-option').forEach(o => o.classList.remove('active'));
        this.classList.add('active');
      });
    });

    // ربط أحداث الصور
    document.querySelectorAll('.volunteer-id-img').forEach(function(img) {
      img.addEventListener('click', function() {
        const fileId = this.getAttribute('data-full');
        // ✅ دعم Cloudinary + Drive (نفس منطق buildImageSrc مع حجم large)
        const url = buildImageSrc(fileId, 'large');
        if (!url) {
          window.UI.toast.error('تعذر تحميل الصورة');
          return;
        }
        document.getElementById('imageViewerImg').src = url;
        window.UI.modal.open('imageViewerModal');
      });
    });

    // زر الحذف
    const deleteBtn = document.getElementById('deleteReportBtn');
    if (deleteBtn) deleteBtn.addEventListener('click', deleteReport);
  }

  // ============================================================
  //  💾 حفظ الحالة
  // ============================================================
  async function saveStatusChange() {
    if (!state.currentReport) return;

    const updates = {};

    // الحالة
    const activeOption = document.querySelector('.status-option.active');
    const newStatus = activeOption ? activeOption.getAttribute('data-status') : state.originalStatus;
    if (newStatus !== state.originalStatus) {
      updates.is_resolved = newStatus;
    }

    // الحقول النصية
    const fields = {
      clothes: 'edit_clothes',
      governorate: 'edit_governorate',
      district: 'edit_district',
      landmark: 'edit_landmark',
      volunteer_name: 'edit_volunteer_name',
      volunteer_phone: 'edit_volunteer_phone'
    };

    for (const [key, id] of Object.entries(fields)) {
      const el = document.getElementById(id);
      if (!el) continue;
      const newValue = el.value.trim();
      const oldValue = String(state.currentReport[key] || '').trim();
      if (newValue !== oldValue) {
        updates[key] = newValue;
      }
    }

    if (Object.keys(updates).length === 0) {
      window.UI.toast.info('لا توجد تغييرات');
      return;
    }

    const confirmed = await window.UI.confirm({
      title: 'حفظ التغييرات',
      message: 'سيتم حفظ ' + Object.keys(updates).length + ' تغييرًا.',
      confirmText: 'حفظ',
      type: 'warning'
    });
    if (!confirmed) return;

    const btn = document.getElementById('saveChangesBtn');
    window.UI.setLoading(btn, true, 'جاري الحفظ...');

    try {
      const result = await window.Core.api('updateReport', {
        reportID: state.currentReport.report_id,
        updates: updates
      }, 'POST');

      if (result.success) {
        window.UI.toast.success('تم حفظ التغييرات');
        closeModal();
        loadStats();
        loadList();
      } else {
        window.UI.toast.error(result.message || 'فشل الحفظ');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الحفظ');
    } finally {
      window.UI.setLoading(btn, false);
    }
  }

  // ============================================================
  //  🗑️ حذف
  // ============================================================
  async function deleteReport() {
    if (!state.currentReport) return;
    const reportID = state.currentReport.report_id;

    const ok1 = await window.UI.confirm({
      title: '⚠️ حذف نهائي',
      message: 'سيتم حذف البلاغ ' + reportID + ' نهائيًا. لا يمكن التراجع.',
      confirmText: 'متابعة',
      type: 'danger'
    });
    if (!ok1) return;

    const typed = window.prompt('للتأكيد النهائي، اكتب رقم البلاغ:\n' + reportID);
    if (!typed || typed.trim() !== reportID) {
      window.UI.toast.error('لم يتم التأكيد');
      return;
    }

    try {
      const result = await window.Core.api('deleteReport', { reportID: reportID }, 'POST');
      if (result.success) {
        window.UI.toast.success('تم الحذف');
        closeModal();
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
  //  🛠️ Helpers
  // ============================================================
  function getStatusInfo(status) {
    const s = String(status || 'لا').trim();
    if (s === 'نعم') return { label: 'مغلق', cls: 'badge-report-resolved' };
    if (s === 'awaiting_confirmation') return { label: 'بانتظار التأكيد', cls: 'badge-report-awaiting' };
    return { label: 'مفتوح', cls: 'badge-report-open' };
  }

  function formatNumber(n) {
    if (typeof n !== 'number') return '—';
    return n.toLocaleString('ar-EG');
  }

  // ✅ الصيغة الكاملة (للتفاصيل): "الأربعاء، 11 نوفمبر 2026 - 02:00 مساءً"
  function formatDateTimeFull(value) {
    if (!value) return '—';
    try {
      return window.AdminUtils.formatDateTime(value) || '—';
    } catch (e) {
      return '—';
    }
  }

  // ✅ Helper: خلية تاريخ بصيغة سطرين (للجدول)
  function buildTwoLineDateCell(value) {
    if (!value) return '—';
    try {
      const dateStr = window.AdminUtils.formatDate(value) || '—';
      const timeStr = window.AdminUtils.formatCairoTime(value) || '';
      if (!timeStr || dateStr === '—') {
        return window.UI.escapeHtml(dateStr);
      }
      return '<div style="font-size:0.82rem; font-weight:600; color:var(--text-primary); white-space:nowrap;">' +
               window.UI.escapeHtml(dateStr) +
             '</div>' +
             '<div style="font-size:0.72rem; color:var(--text-muted); margin-top:2px; white-space:nowrap;">' +
               window.UI.escapeHtml(timeStr) +
             '</div>';
    } catch (e) {
      return '—';
    }
  }

  // ============================================================
  //  🖼️ buildImageSrc — تحويل قيمة الحقل إلى URL قابل للعرض
  //  يدعم:
  //    - Cloudinary URL كامل (يبدأ بـ https://) → يُستخدم كما هو
  //    - Drive File ID (legacy) → يبني رابط Drive thumbnail
  //  @param value — القيمة الخام من DB
  //  @param size — 'small' | 'medium' | 'large'
  // ============================================================
  function buildImageSrc(value, size) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    // ✅ Cloudinary (أو أي URL كامل) → استخدمه مباشرة
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return raw;
    }

    // ⚠️ Legacy: Drive File ID → ابنِ رابط Drive thumbnail
    const sizeMap = { small: 's400', medium: 's800', large: 's1600' };
    const sz = sizeMap[size] || 's800';
    return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(raw) + '&sz=' + sz;
  }

  function escapeAttr(str) {
    return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // ============================================================
  //  🌐 التصدير
  // ============================================================
  window.ReportsPage = {
    init: init,
    reload: reload
  };

})();