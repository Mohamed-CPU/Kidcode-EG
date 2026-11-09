// ================================================================
//  admin/js/ui.js — مكونات الواجهة
//  Toast, Modal, Confirm, Table Helpers
// ================================================================

(function() {
  'use strict';

  // ============================================================
  //  🍞 TOAST — التنبيهات المنبثقة
  // ============================================================
  let toastContainer = null;

  function ensureToastContainer() {
    if (toastContainer && document.body.contains(toastContainer)) return toastContainer;
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.id = 'toastContainer';
    document.body.appendChild(toastContainer);
    return toastContainer;
  }

  const TOAST_ICONS = {
    success: 'fa-circle-check',
    error: 'fa-circle-exclamation',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };

  const TOAST_TITLES = {
    success: 'تم بنجاح',
    error: 'خطأ',
    warning: 'تنبيه',
    info: 'معلومة'
  };

  function showToast(message, type, options) {
    type = type || 'info';
    options = options || {};
    const duration = options.duration !== undefined ? options.duration : (type === 'error' ? 0 : 4000);
    const title = options.title || TOAST_TITLES[type];

    const container = ensureToastContainer();

    const toast = document.createElement('div');
    toast.className = 'toast ' + type;

    const iconClass = TOAST_ICONS[type] || TOAST_ICONS.info;

    toast.innerHTML =
      '<i class="fas ' + iconClass + ' toast-icon"></i>' +
      '<div class="toast-content">' +
        (title ? '<div class="toast-title">' + escapeHtml(title) + '</div>' : '') +
        '<div class="toast-message">' + escapeHtml(String(message)) + '</div>' +
      '</div>' +
      '<button class="toast-close" aria-label="إغلاق"><i class="fas fa-times"></i></button>';

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => removeToast(toast));

    container.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => removeToast(toast), duration);
    }

    return toast;
  }

  function removeToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add('removing');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }

  // ============================================================
  //  💬 MODAL — المودالات
  // ============================================================
  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) {
      console.warn('Modal not found:', modalId);
      return;
    }
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-overlay.show').forEach(m => {
      m.classList.remove('show');
    });
    document.body.style.overflow = '';
  }

  // إغلاق عند النقر على الـ overlay (باستثناء المودالات المعلَّمة كـ static)
  document.addEventListener('click', function(e) {
    if (e.target.classList && e.target.classList.contains('modal-overlay')) {
      // تجاهل المودالات التي لا يجب أن تُغلق من الخلفية
      if (e.target.hasAttribute('data-static')) return;
      e.target.classList.remove('show');
      document.body.style.overflow = '';
    }
  });

  // إغلاق عند ESC (باستثناء المودالات المعلَّمة كـ static)
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal-overlay.show').forEach(function(m) {
      if (m.hasAttribute('data-static')) return;
      m.classList.remove('show');
    });
    // إذا لم يعد هناك أي مودال مفتوح غير static، أعِد التمرير
    const stillOpen = document.querySelector('.modal-overlay.show:not([data-static])');
    if (!stillOpen) {
      document.body.style.overflow = '';
    }
  });

  // ============================================================
  //  ✅ CONFIRM — نافذة تأكيد
  // ============================================================
  function showConfirm(options) {
    return new Promise(function(resolve) {
      options = options || {};
      const title = options.title || 'تأكيد';
      const message = options.message || 'هل أنت متأكد؟';
      const confirmText = options.confirmText || 'تأكيد';
      const cancelText = options.cancelText || 'إلغاء';
      const type = options.type || 'warning'; // warning | danger | info
      const confirmClass = type === 'danger' ? 'btn-danger' : (type === 'info' ? 'btn-primary' : 'btn-warning');

      const modalId = 'confirmModal_' + Date.now();

      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.id = modalId;
      modal.innerHTML =
        '<div class="modal modal-sm">' +
          '<div class="modal-header">' +
            '<h3 class="modal-title">' + escapeHtml(title) + '</h3>' +
          '</div>' +
          '<div class="modal-body">' +
            '<p style="color: var(--text-secondary); line-height: 1.7;">' + escapeHtml(message) + '</p>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" data-action="cancel">' + escapeHtml(cancelText) + '</button>' +
            '<button class="btn ' + confirmClass + '" data-action="confirm">' + escapeHtml(confirmText) + '</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(modal);
      modal.classList.add('show');

      function cleanup(result) {
        modal.classList.remove('show');
        setTimeout(() => {
          if (modal.parentNode) modal.parentNode.removeChild(modal);
        }, 250);
        resolve(result);
      }

      modal.querySelector('[data-action="cancel"]').addEventListener('click', () => cleanup(false));
      modal.querySelector('[data-action="confirm"]').addEventListener('click', () => cleanup(true));
      modal.addEventListener('click', function(e) {
        if (e.target === modal) cleanup(false);
      });

      document.addEventListener('keydown', function onEsc(e) {
        if (e.key === 'Escape') {
          document.removeEventListener('keydown', onEsc);
          cleanup(false);
        }
      });
    });
  }

  // ============================================================
  //  🛠️ Helpers
  // ============================================================
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDate(value) {
    if (!value) return '—';
    try {
      const d = new Date(value);
      if (isNaN(d.getTime())) return String(value);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return yyyy + '-' + mm + '-' + dd;
    } catch (e) { return String(value); }
  }

  function formatDateTime(value) {
    if (!value) return '—';
    try {
      const d = new Date(value);
      if (isNaN(d.getTime())) return String(value);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      let h = d.getHours();
      const mi = String(d.getMinutes()).padStart(2, '0');
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return yyyy + '-' + mm + '-' + dd + ' ' + h + ':' + mi + ' ' + ampm;
    } catch (e) { return String(value); }
  }

  function setLoading(el, isLoading, loadingText) {
    if (!el) return;
    if (isLoading) {
      el.disabled = true;
      el.dataset.originalHtml = el.innerHTML;
      el.innerHTML = '<span class="loading-spinner"></span> ' + escapeHtml(loadingText || 'جاري...');
    } else {
      el.disabled = false;
      if (el.dataset.originalHtml) {
        el.innerHTML = el.dataset.originalHtml;
        delete el.dataset.originalHtml;
      }
    }
  }

  // ============================================================
  //  🌐 التصدير
  // ============================================================
  window.UI = {
    toast: {
      show: showToast,
      success: (msg, opts) => showToast(msg, 'success', opts),
      error: (msg, opts) => showToast(msg, 'error', opts),
      warning: (msg, opts) => showToast(msg, 'warning', opts),
      info: (msg, opts) => showToast(msg, 'info', opts)
    },
    modal: {
      open: openModal,
      close: closeModal,
      closeAll: closeAllModals
    },
    confirm: showConfirm,
    escapeHtml: escapeHtml,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    setLoading: setLoading
  };

})();