// ================================================================
//  admin/js/admins.js — منطق إدارة المسؤولين
// ================================================================

(function() {
  'use strict';

  const state = {
    isInitialized: false,
    isLoading: false,
    list: [],
    currentUser: null,
    editTarget: null,
    isSaving: false,
    isCreating: false
  };

  // ============================================================
  //  📋 تعريف الأقسام والصلاحيات
  // ============================================================
  const SECTIONS = [
    { key: 'dashboard',  label: 'لوحة المعلومات', icon: 'fa-chart-pie',         actions: ['view'] },
    { key: 'children',   label: 'الأطفال',         icon: 'fa-child',            actions: ['view', 'edit', 'delete', 'export'] },
    { key: 'payments',   label: 'المدفوعات',       icon: 'fa-receipt',          actions: ['view', 'refund'] },
    { key: 'marketers',  label: 'المسوقون',        icon: 'fa-user-tie',         actions: ['view', 'edit', 'delete', 'export'] },
    { key: 'newsletter', label: 'المشتركون',       icon: 'fa-bell',             actions: ['view', 'edit', 'delete', 'export'] },
    { key: 'reports',    label: 'البلاغات',        icon: 'fa-exclamation-triangle', actions: ['view', 'edit', 'close'] },
    { key: 'scan_logs',  label: 'سجل المسحات',     icon: 'fa-qrcode',           actions: ['view', 'export', 'delete'] },
    { key: 'emails',     label: 'مركز البريد',     icon: 'fa-envelope',         actions: ['send_individual', 'send_bulk', 'manage_campaigns'] },
    { key: 'admins',     label: 'المسؤولون',       icon: 'fa-user-shield',      actions: ['view', 'create', 'edit', 'delete'] },
    { key: 'config',     label: 'الإعدادات',       icon: 'fa-cog',              actions: ['view', 'edit'] },
    { key: 'audit_log',  label: 'سجل العمليات',    icon: 'fa-clipboard-list',   actions: ['view'] }
  ];

  const ACTION_LABELS = {
    view: 'عرض',
    edit: 'تعديل',
    delete: 'حذف',
    export: 'تصدير',
    create: 'إنشاء',
    close: 'إغلاق',
    send_individual: 'إرسال فردي',
    send_bulk: 'إرسال جماعي',
    manage_campaigns: 'إدارة الحملات',
    refund: 'استرداد'
  };

  // ============================================================
  //  🚀 init
  // ============================================================
  function init() {
    if (state.isInitialized) return;
    state.isInitialized = true;

    state.currentUser = window.Core.getUser();

    // ✅ إخفاء قسم ربط تليجرام لغير super_admin
    const isSuper = !!(state.currentUser && state.currentUser.isSuperAdmin);
    if (!isSuper) {
      const ctg = document.getElementById('createTelegramGroup');
      if (ctg) ctg.style.display = 'none';
      const etg = document.getElementById('editTelegramGroup');
      if (etg) etg.style.display = 'none';
    }

    bindEvents();
    buildPermissionsGrids();
    loadList();
  }

  function reload() { loadList(); }

  // ============================================================
  //  🎯 ربط الأحداث
  // ============================================================
  function bindEvents() {
    // Create
    const createBtn = document.getElementById('createAdminBtn');
    if (createBtn) createBtn.addEventListener('click', openCreateModal);

    const closeCreateBtn = document.getElementById('closeCreateModalBtn');
    if (closeCreateBtn) closeCreateBtn.addEventListener('click', closeCreateModal);

    const cancelCreateBtn = document.getElementById('cancelCreateBtn');
    if (cancelCreateBtn) cancelCreateBtn.addEventListener('click', closeCreateModal);

    const doCreateBtn = document.getElementById('createBtn');
    if (doCreateBtn) doCreateBtn.addEventListener('click', createAdmin);

    // Edit
    const closeEditBtn = document.getElementById('closeEditModalBtn');
    if (closeEditBtn) closeEditBtn.addEventListener('click', closeEditModal);

    const cancelEditBtn = document.getElementById('cancelEditBtn');
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', closeEditModal);

    const saveEditBtn = document.getElementById('saveEditBtn');
    if (saveEditBtn) saveEditBtn.addEventListener('click', saveEdit);

    // Reset Password Modal
    const closeResetBtn1 = document.getElementById('closeResetPwdBtn');
    const closeResetBtn2 = document.getElementById('closeResetPwdBtn2');
    if (closeResetBtn1) closeResetBtn1.addEventListener('click', closeResetPwdModal);
    if (closeResetBtn2) closeResetBtn2.addEventListener('click', closeResetPwdModal);

    const copyResetBtn = document.getElementById('copyResetPwdBtn');
    if (copyResetBtn) {
      copyResetBtn.addEventListener('click', function() {
        copyToClipboard(document.getElementById('resetPwdValue').textContent);
      });
    }

    // Grant All / Revoke All
    const createGrantAll = document.getElementById('createGrantAll');
    if (createGrantAll) createGrantAll.addEventListener('click', function() { toggleAllPermissions('create', true); });

    const createRevokeAll = document.getElementById('createRevokeAll');
    if (createRevokeAll) createRevokeAll.addEventListener('click', function() { toggleAllPermissions('create', false); });

    const editGrantAll = document.getElementById('editGrantAll');
    if (editGrantAll) editGrantAll.addEventListener('click', function() { toggleAllPermissions('edit', true); });

    const editRevokeAll = document.getElementById('editRevokeAll');
    if (editRevokeAll) editRevokeAll.addEventListener('click', function() { toggleAllPermissions('edit', false); });

    // Copy buttons في نتيجة الإنشاء
    document.querySelectorAll('.copy-btn[data-copy-target]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const targetId = this.getAttribute('data-copy-target');
        const el = document.getElementById(targetId);
        if (el) copyToClipboard(el.textContent);
      });
    });
  }

  // ============================================================
  //  📊 loadList
  // ============================================================
  async function loadList() {
    if (state.isLoading) return;
    state.isLoading = true;
    showLoading();

    try {
      const result = await window.Core.api('getAdminsList', {}, 'GET');

      if (!result.success) {
        window.UI.toast.error(result.error || 'فشل تحميل القائمة');
        showEmpty('فشل التحميل');
        return;
      }

      state.list = result.list || [];
      renderList();
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الاتصال بالخادم');
      showEmpty('فشل التحميل');
    } finally {
      state.isLoading = false;
    }
  }

  // ============================================================
  //  🎨 Render
  // ============================================================
  function renderList() {
    const container = document.getElementById('adminsList');
    if (!container) return;

    if (state.list.length === 0) {
      showEmpty('لا يوجد مسؤولون');
      return;
    }

    // رتّب: super_admin أولًا، ثم النشطون، ثم الغير نشطين
    const sorted = state.list.slice().sort(function(a, b) {
      if (a.isSuperAdmin) return -1;
      if (b.isSuperAdmin) return 1;
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.username.localeCompare(b.username);
    });

    let html = '';
    sorted.forEach(function(admin) {
      html += renderAdminCard(admin);
    });

    container.innerHTML = html;

    // ربط الأزرار
    container.querySelectorAll('[data-action]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const action = this.getAttribute('data-action');
        const username = this.getAttribute('data-username');
        if (action === 'edit') openEditModal(username);
        else if (action === 'toggle') toggleActive(username);
        else if (action === 'reset') resetPassword(username);
        else if (action === 'delete') hardDelete(username);
      });
    });
  }

  function renderAdminCard(admin) {
    const isSelf = state.currentUser && admin.username === state.currentUser.username;
    const isSuper = admin.isSuperAdmin;
    const initials = getInitials(admin.fullName || admin.username);

    let cardClass = 'admin-card';
    if (isSuper) cardClass += ' super';
    if (!admin.isActive) cardClass += ' inactive';

    // Badges
    let badges = '';
    if (isSuper) badges += '<span class="admin-badge super"><i class="fas fa-crown"></i> المدير العام</span>';
    if (admin.isActive) {
      badges += '<span class="admin-badge active"><i class="fas fa-circle-check"></i> نشط</span>';
    } else {
      badges += '<span class="admin-badge inactive"><i class="fas fa-circle-xmark"></i> معطَّل</span>';
    }
    if (admin.mustChangePassword) {
      badges += '<span class="admin-badge must-change"><i class="fas fa-key"></i> ينتظر تغيير كلمة السر</span>';
    }

    // 🆕 badge حالة تليجرام
    if (!isSuper) {
      if (admin.isTelegramLinked) {
        badges += '<span class="admin-badge" style="background:rgba(0,136,204,0.15); color:#0088CC;"><i class="fab fa-telegram"></i> مربوط بتليجرام</span>';
      } else {
        badges += '<span class="admin-badge" style="background:rgba(148,163,184,0.15); color:#64748B;"><i class="fab fa-telegram"></i> غير مربوط</span>';
      }
    }

    if (isSelf) {
      badges += '<span class="admin-badge" style="background:rgba(99,102,241,0.15); color:var(--accent);"><i class="fas fa-user"></i> أنت</span>';
    }

    // Permissions summary
    let permPills = '';
    if (isSuper) {
      permPills = '<span class="perm-pill" style="background:rgba(245,158,11,0.15); color:#92400E;">كل الصلاحيات</span>';
    } else {
      const grantedSections = SECTIONS.filter(function(s) {
        const sectionPerms = admin.permissions[s.key];
        return sectionPerms && Object.keys(sectionPerms).some(function(a) { return sectionPerms[a] === true; });
      });
      if (grantedSections.length === 0) {
        permPills = '<span class="perm-pill none"><i class="fas fa-ban"></i> لا صلاحيات</span>';
      } else {
        grantedSections.forEach(function(s) {
          permPills += '<span class="perm-pill">' + escapeHtml(s.label) + '</span>';
        });
      }
    }

    // Actions
    let actions = '';
    if (isSuper) {
      actions = '<div class="admin-locked-note"><i class="fas fa-lock"></i> الحساب الأساسي — لا يمكن تعديله</div>';
    } else if (isSelf) {
      actions = '<div class="admin-locked-note"><i class="fas fa-user-shield"></i> حسابك — لا يمكنك تعديله من هنا</div>';
    } else {
      const canEdit = state.currentUser && (state.currentUser.isSuperAdmin || (state.currentUser.permissions && state.currentUser.permissions.admins && state.currentUser.permissions.admins.edit));
      const canDelete = state.currentUser && state.currentUser.isSuperAdmin;

      if (canEdit) {
        actions += '<button class="btn btn-secondary" data-action="edit" data-username="' + escapeAttr(admin.username) + '"><i class="fas fa-edit"></i> تعديل</button>';
        actions += '<button class="btn btn-warning" data-action="toggle" data-username="' + escapeAttr(admin.username) + '"><i class="fas fa-power-off"></i> ' + (admin.isActive ? 'تعطيل' : 'تفعيل') + '</button>';
        actions += '<button class="btn btn-info" data-action="reset" data-username="' + escapeAttr(admin.username) + '"><i class="fas fa-key"></i> كلمة السر</button>';
      }
      if (canDelete) {
        actions += '<button class="btn btn-danger" data-action="delete" data-username="' + escapeAttr(admin.username) + '"><i class="fas fa-trash-alt"></i> حذف</button>';
      }
    }

    return '<div class="' + cardClass + '">' +
      '<div class="admin-card-header">' +
        '<div class="admin-avatar">' + escapeHtml(initials) + '</div>' +
        '<div class="admin-info">' +
          '<div class="admin-name">' + escapeHtml(admin.fullName || 'بدون اسم') + '</div>' +
          '<div class="admin-username">@' + escapeHtml(admin.username) + '</div>' +
          (admin.email ? '<div class="admin-email">' + escapeHtml(admin.email) + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="admin-badges">' + badges + '</div>' +
      '<div class="permissions-summary">' + permPills + '</div>' +
      '<div class="admin-meta">' +
        '<div class="admin-meta-row"><span class="label">أنشأه:</span><span class="value">' + escapeHtml(admin.createdBy || '—') + '</span></div>' +
        '<div class="admin-meta-row"><span class="label">آخر دخول:</span><span class="value">' + (admin.lastLoginAt ? escapeHtml(formatDateTime(admin.lastLoginAt)) : 'لم يدخل بعد') + '</span></div>' +
      '</div>' +
      '<div class="admin-actions">' + actions + '</div>' +
    '</div>';
  }

  function showLoading() {
    const container = document.getElementById('adminsList');
    if (container) {
      container.innerHTML = '<div class="admins-loading"><i class="fas fa-spinner fa-spin"></i><p>جاري التحميل...</p></div>';
    }
  }

  function showEmpty(msg) {
    const container = document.getElementById('adminsList');
    if (container) {
      container.innerHTML = '<div class="admins-loading"><i class="fas fa-user-slash"></i><p>' + escapeHtml(msg) + '</p></div>';
    }
  }

  // ============================================================
  //  🎯 Permissions Grid Builder
  // ============================================================
  function buildPermissionsGrids() {
    buildGrid('create_permissionsGrid', 'create');
    buildGrid('edit_permissionsGrid', 'edit');
  }

  function buildGrid(containerId, prefix) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let html = '';
    SECTIONS.forEach(function(section) {
      let actionsHtml = '';
      section.actions.forEach(function(action) {
        const cbId = prefix + '_perm_' + section.key + '_' + action;
        actionsHtml +=
          '<label class="perm-checkbox" data-for="' + cbId + '">' +
            '<input type="checkbox" id="' + cbId + '" data-section="' + section.key + '" data-action="' + action + '">' +
            '<span>' + escapeHtml(ACTION_LABELS[action] || action) + '</span>' +
          '</label>';
      });

      html +=
        '<div class="perm-section" data-section="' + section.key + '">' +
          '<div class="perm-section-title">' +
            '<i class="fas ' + section.icon + '"></i>' +
            escapeHtml(section.label) +
          '</div>' +
          '<div class="perm-actions">' + actionsHtml + '</div>' +
        '</div>';
    });

    container.innerHTML = html;

    // ربط التحديث البصري
    container.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        const label = this.closest('.perm-checkbox');
        if (label) label.classList.toggle('checked', this.checked);
        updateSectionVisual(container, this.getAttribute('data-section'));
      });
    });
  }

  function updateSectionVisual(container, sectionKey) {
    const sectionEl = container.querySelector('.perm-section[data-section="' + sectionKey + '"]');
    if (!sectionEl) return;
    const anyChecked = sectionEl.querySelectorAll('input[type="checkbox"]:checked').length > 0;
    sectionEl.classList.toggle('has-access', anyChecked);
  }

  function toggleAllPermissions(prefix, checked) {
    const container = document.getElementById(prefix + '_permissionsGrid');
    if (!container) return;
    container.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
      cb.checked = checked;
      const label = cb.closest('.perm-checkbox');
      if (label) label.classList.toggle('checked', checked);
    });
    container.querySelectorAll('.perm-section').forEach(function(sec) {
      sec.classList.toggle('has-access', checked);
    });
  }

  // ============================================================
  //  📥 استخراج الصلاحيات من الـ Grid
  // ============================================================
  function extractPermissions(prefix) {
    const container = document.getElementById(prefix + '_permissionsGrid');
    if (!container) return {};

    const perms = {};
    SECTIONS.forEach(function(section) {
      const sectionPerms = {};
      let hasAny = false;
      section.actions.forEach(function(action) {
        const cb = document.getElementById(prefix + '_perm_' + section.key + '_' + action);
        if (cb && cb.checked) {
          sectionPerms[action] = true;
          hasAny = true;
        }
      });
      if (hasAny) perms[section.key] = sectionPerms;
    });
    return perms;
  }

  // ============================================================
  //  📥 تعبئة Grid من Permissions
  // ============================================================
  function fillPermissions(prefix, perms) {
    perms = perms || {};
    const container = document.getElementById(prefix + '_permissionsGrid');
    if (!container) return;

    container.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
      const section = cb.getAttribute('data-section');
      const action = cb.getAttribute('data-action');
      const sectionPerms = perms[section] || {};
      const checked = sectionPerms[action] === true;
      cb.checked = checked;
      const label = cb.closest('.perm-checkbox');
      if (label) label.classList.toggle('checked', checked);
    });

    container.querySelectorAll('.perm-section').forEach(function(sec) {
      const sectionKey = sec.getAttribute('data-section');
      const sectionPerms = perms[sectionKey] || {};
      const hasAny = Object.keys(sectionPerms).some(function(a) { return sectionPerms[a] === true; });
      sec.classList.toggle('has-access', hasAny);
    });
  }

  // ============================================================
  //  ➕ Create Admin
  // ============================================================
  function openCreateModal() {
    window.UI.modal.open('createAdminModal');

    document.getElementById('create_fullName').value = '';
    document.getElementById('create_username').value = '';
    document.getElementById('create_email').value = '';
    document.getElementById('createResultBox').style.display = 'none';
    toggleAllPermissions('create', false);

    // 🆕 reset checkbox ربط تليجرام
    const tgCheck = document.getElementById('create_sendTelegramLink');
    if (tgCheck) tgCheck.checked = false;

    setTimeout(function() {
      document.getElementById('create_fullName').focus();
    }, 200);
  }

  function closeCreateModal() {
    window.UI.modal.close('createAdminModal');
  }

  async function createAdmin() {
    if (state.isCreating) return;

    const fullName = document.getElementById('create_fullName').value.trim();
    const username = document.getElementById('create_username').value.trim().toLowerCase();
    const email = document.getElementById('create_email').value.trim();
    const permissions = extractPermissions('create');

    // 🆕 read telegram checkbox (فقط لـ super_admin)
    const tgCheck = document.getElementById('create_sendTelegramLink');
    const isSuper = !!(state.currentUser && state.currentUser.isSuperAdmin);
    const sendTelegramLink = isSuper && tgCheck && tgCheck.checked;

    if (!fullName) {
      window.UI.toast.error('الاسم الكامل مطلوب');
      document.getElementById('create_fullName').focus();
      return;
    }
    if (!username) {
      window.UI.toast.error('اسم المستخدم مطلوب');
      document.getElementById('create_username').focus();
      return;
    }
    if (!/^[a-z0-9_]{3,30}$/.test(username)) {
      window.UI.toast.error('اسم المستخدم يجب أن يكون 3-30 حرفًا إنجليزيًا صغيرًا أو أرقامًا أو _');
      document.getElementById('create_username').focus();
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      window.UI.toast.error('البريد الإلكتروني غير صحيح');
      document.getElementById('create_email').focus();
      return;
    }

    state.isCreating = true;
    const btn = document.getElementById('createBtn');
    window.UI.setLoading(btn, true, 'جاري الإنشاء...');

    try {
      const result = await window.Core.api('createAdmin', {
        fullName: fullName,
        username: username,
        email: email,
        permissions: permissions,
        sendTelegramLink: sendTelegramLink
      }, 'POST');

      if (result.success) {
        // عرض النتيجة
        document.getElementById('createResultUsername').textContent = result.username;
        document.getElementById('createResultPassword').textContent = result.tempPassword;
        document.getElementById('createResultBox').style.display = 'block';

        let successMsg = 'تم إنشاء المسؤول بنجاح';
        if (result.telegramLinkSent) {
          successMsg += ' · ✅ تم إرسال كود الربط بتليجرام';
        }
        window.UI.toast.success(successMsg);

        // أعد تحميل القائمة
        loadList();

        // فعّل زر الإغلاق فقط
        document.getElementById('createBtn').style.display = 'none';
        document.getElementById('cancelCreateBtn').textContent = 'إغلاق';
      } else {
        window.UI.toast.error(result.message || result.error || 'فشل الإنشاء');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الإنشاء');
    } finally {
      state.isCreating = false;
      window.UI.setLoading(btn, false);
      document.getElementById('createBtn').style.display = 'inline-flex';
    }
  }

  // ============================================================
  //  ✏️ Edit Admin
  // ============================================================
  async function openEditModal(username) {
    window.UI.modal.open('editAdminModal');
    document.getElementById('editModalTitle').textContent = 'جاري التحميل...';
    document.getElementById('saveEditBtn').disabled = true;

    try {
      const result = await window.Core.api('getAdminDetails', { username: username }, 'GET');
      if (!result.success) {
        window.UI.toast.error(result.message || 'فشل التحميل');
        closeEditModal();
        return;
      }

      const admin = result.admin;
      state.editTarget = admin;

      document.getElementById('editModalTitle').textContent = 'تعديل: ' + (admin.fullName || admin.username);
      document.getElementById('edit_username').value = admin.username;
      document.getElementById('edit_fullName').value = admin.fullName || '';
      document.getElementById('edit_email').value = admin.email || '';

      fillPermissions('edit', admin.permissions || {});

      // إذا كان super_admin، أخفِ الصلاحيات
      const permGroup = document.getElementById('editPermissionsGroup');
      if (admin.isSuperAdmin) {
        permGroup.style.display = 'none';
      } else {
        permGroup.style.display = 'block';
      }

      // 🆕 عرض حالة ربط تليجرام
      renderTelegramStatus(admin);

      document.getElementById('saveEditBtn').disabled = false;
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر التحميل');
      closeEditModal();
    }
  }

  function closeEditModal() {
    window.UI.modal.close('editAdminModal');
    state.editTarget = null;
  }

  async function saveEdit() {
    if (state.isSaving) return;
    if (!state.editTarget) return;

    const updates = {};

    const fullName = document.getElementById('edit_fullName').value.trim();
    if (fullName !== (state.editTarget.fullName || '')) updates.fullName = fullName;

    const email = document.getElementById('edit_email').value.trim();
    if (email !== (state.editTarget.email || '')) updates.email = email;

    // الصلاحيات فقط إذا لم يكن super_admin
    if (!state.editTarget.isSuperAdmin) {
      const newPerms = extractPermissions('edit');
      const oldPermsStr = JSON.stringify(state.editTarget.permissions || {});
      const newPermsStr = JSON.stringify(newPerms);
      if (oldPermsStr !== newPermsStr) {
        updates.permissions = newPerms;
      }
    }

    if (Object.keys(updates).length === 0) {
      window.UI.toast.info('لا توجد تغييرات');
      return;
    }

    state.isSaving = true;
    const btn = document.getElementById('saveEditBtn');
    window.UI.setLoading(btn, true, 'جاري الحفظ...');

    try {
      const result = await window.Core.api('updateAdmin', {
        username: state.editTarget.username,
        updates: updates
      }, 'POST');

      if (result.success) {
        window.UI.toast.success('تم حفظ التغييرات');
        closeEditModal();
        loadList();
      } else {
        window.UI.toast.error(result.message || result.error || 'فشل الحفظ');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الحفظ');
    } finally {
      state.isSaving = false;
      window.UI.setLoading(btn, false);
    }
  }

  // ============================================================
  //  🔄 Toggle Active
  // ============================================================
  async function toggleActive(username) {
    const admin = state.list.find(a => a.username === username);
    if (!admin) return;

    const action = admin.isActive ? 'تعطيل' : 'تفعيل';

    const confirmed = await window.UI.confirm({
      title: action + ' المسؤول',
      message: admin.isActive
        ? 'سيتم تعطيل "' + admin.fullName + '" وإنهاء كل جلساته فورًا. متابعة؟'
        : 'سيتم تفعيل "' + admin.fullName + '". متابعة؟',
      confirmText: action,
      type: admin.isActive ? 'danger' : 'info'
    });
    if (!confirmed) return;

    try {
      const result = await window.Core.api('toggleAdminActive', { username: username }, 'POST');
      if (result.success) {
        window.UI.toast.success(result.message);
        loadList();
      } else {
        window.UI.toast.error(result.message || 'فشل التحديث');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر التحديث');
    }
  }

  // ============================================================
  //  🔐 Reset Password
  // ============================================================
  async function resetPassword(username) {
    const admin = state.list.find(a => a.username === username);
    if (!admin) return;

    const confirmed = await window.UI.confirm({
      title: 'إعادة تعيين كلمة السر',
      message: 'سيتم توليد كلمة مرور مؤقتة جديدة وإنهاء كل جلسات "' + admin.fullName + '". متابعة؟',
      confirmText: 'إعادة التعيين',
      type: 'warning'
    });
    if (!confirmed) return;

    try {
      const result = await window.Core.api('resetAdminPassword', { username: username }, 'POST');
      if (result.success) {
        document.getElementById('resetPwdValue').textContent = result.tempPassword;
        window.UI.modal.open('resetPwdModal');
        loadList();
      } else {
        window.UI.toast.error(result.message || 'فشل');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الاتصال');
    }
  }

  function closeResetPwdModal() {
    window.UI.modal.close('resetPwdModal');
    document.getElementById('resetPwdValue').textContent = '—';
  }

  // ============================================================
  //  🗑️ Hard Delete
  // ============================================================
  async function hardDelete(username) {
    const admin = state.list.find(a => a.username === username);
    if (!admin) return;

    const ok1 = await window.UI.confirm({
      title: '⚠️ حذف نهائي',
      message: 'سيتم حذف "' + admin.fullName + '" (' + admin.username + ') نهائيًا. لا يمكن التراجع.',
      confirmText: 'متابعة',
      type: 'danger'
    });
    if (!ok1) return;

    const typed = window.prompt('للتأكيد النهائي، اكتب اسم المستخدم:\n' + admin.username);
    if (!typed || typed.trim().toLowerCase() !== admin.username.toLowerCase()) {
      window.UI.toast.error('لم يتم التأكيد — أُلغي الحذف');
      return;
    }

    try {
      const result = await window.Core.api('hardDeleteAdmin', { username: username }, 'POST');
      if (result.success) {
        window.UI.toast.success('تم الحذف نهائيًا');
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

  // ============================================================
  //  🔗 renderTelegramStatus — عرض حالة الربط بتليجرام
  // ============================================================
  function renderTelegramStatus(admin) {
    const container = document.getElementById('editTelegramStatus');
    if (!container) return;

    // لو مش super_admin — ما نعرضش حاجة
    const isSuper = !!(state.currentUser && state.currentUser.isSuperAdmin);
    if (!isSuper) {
      container.innerHTML = '';
      return;
    }

    // لو الهدف super_admin — ما نعرضش خيارات
    if (admin.isSuperAdmin) {
      container.innerHTML =
        '<div style="padding:12px 14px; background:rgba(148,163,184,0.08); border-radius:10px; color:#64748B; font-size:0.85rem; line-height:1.7;">' +
          '<i class="fas fa-info-circle"></i> ' +
          'super_admin يتم ربطه من خلال <code style="background:#F1F5F9; padding:2px 6px; border-radius:4px;">initSuperAdmin</code> فقط.' +
        '</div>';
      return;
    }

    if (admin.isTelegramLinked) {
      // ✅ مربوط
      container.innerHTML =
        '<div style="padding:14px 16px; background:rgba(0,136,204,0.06); border:1px solid rgba(0,136,204,0.3); border-radius:10px;">' +
          '<div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">' +
            '<i class="fab fa-telegram" style="color:#0088CC; font-size:1.4rem;"></i>' +
            '<div>' +
              '<div style="font-weight:800; color:#0088CC;">✅ مربوط بتليجرام</div>' +
              (admin.telegramLinkedAt
                ? '<div style="font-size:0.78rem; color:#64748B;">منذ: ' + escapeHtml(formatDateTime(admin.telegramLinkedAt)) + '</div>'
                : '') +
            '</div>' +
          '</div>' +
          '<button type="button" class="btn btn-secondary" id="resendTelegramLinkBtn" style="width:100%;">' +
            '<i class="fas fa-paper-plane"></i> إعادة إرسال كود الربط' +
          '</button>' +
        '</div>';
    } else if (admin.email) {
      // ⏳ غير مربوط + عنده إيميل
      container.innerHTML =
        '<div style="padding:14px 16px; background:rgba(245,158,11,0.06); border:1px solid rgba(245,158,11,0.3); border-radius:10px;">' +
          '<div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">' +
            '<i class="fab fa-telegram" style="color:#94A3B8; font-size:1.4rem;"></i>' +
            '<div>' +
              '<div style="font-weight:800; color:#92400E;">⏳ غير مربوط بتليجرام</div>' +
              '<div style="font-size:0.78rem; color:#64748B;">سيصل الرابط على: ' + escapeHtml(admin.email) + '</div>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="btn btn-primary" id="sendTelegramLinkBtn" style="width:100%; background:#0088CC; border-color:#0088CC;">' +
            '<i class="fas fa-paper-plane"></i> 📧 إرسال كود الربط عبر الإيميل' +
          '</button>' +
        '</div>';
    } else {
      // ⚠️ غير مربوط + مفيش إيميل
      container.innerHTML =
        '<div style="padding:14px 16px; background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.3); border-radius:10px;">' +
          '<div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">' +
            '<i class="fas fa-exclamation-triangle" style="color:#DC2626; font-size:1.4rem;"></i>' +
            '<div>' +
              '<div style="font-weight:800; color:#991B1B;">⚠️ غير مربوط بتليجرام</div>' +
              '<div style="font-size:0.78rem; color:#64748B;">أضف البريد الإلكتروني أولاً</div>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="btn btn-secondary" disabled style="width:100%; opacity:0.6; cursor:not-allowed;">' +
            '<i class="fas fa-ban"></i> إضافة الإيميل مطلوبة أولاً' +
          '</button>' +
        '</div>';
    }

    // ربط الأزرار
    const sendBtn = document.getElementById('sendTelegramLinkBtn');
    if (sendBtn) sendBtn.addEventListener('click', function() { sendAdminTelegramLink(admin.username, sendBtn); });

    const resendBtn = document.getElementById('resendTelegramLinkBtn');
    if (resendBtn) resendBtn.addEventListener('click', function() { sendAdminTelegramLink(admin.username, resendBtn); });
  }

  // ============================================================
  //  📤 sendAdminTelegramLink — إرسال كود الربط
  // ============================================================
  async function sendAdminTelegramLink(username, btn) {
    if (!username) return;

    const confirmed = await window.UI.confirm({
      title: 'إرسال كود الربط',
      message: 'سيتم توليد كود ربط جديد وإرساله على البريد الإلكتروني للمسؤول.\n\nأي كود قديم غير مستخدم سيتم إلغاؤه.',
      confirmText: 'إرسال',
      type: 'info'
    });
    if (!confirmed) return;

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';
    }

    try {
      const result = await window.Core.api('generateAdminLinkCode', { username: username }, 'POST');

      if (result.success) {
        if (result.emailSent) {
          window.UI.toast.success(result.message || '✅ تم إرسال الكود بنجاح');
        } else {
          window.UI.toast.warning(result.message || '⚠️ فشل الإرسال');
        }

        // أعد تحميل تفاصيل المسؤول لتحديث العرض
        const details = await window.Core.api('getAdminDetails', { username: username }, 'GET');
        if (details && details.success) {
          state.editTarget = details.admin;
          renderTelegramStatus(details.admin);
        }
        loadList();
      } else {
        window.UI.toast.error(result.message || result.error || 'فشل الإرسال');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الاتصال');
    } finally {
      if (btn && document.body.contains(btn)) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> إعادة المحاولة';
      }
    }
  }

  function getInitials(name) {
    const parts = String(name || '?').trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function formatDateTime(value) {
    return window.AdminUtils.formatDateTime(value);
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
  //  🌐 التصدير
  // ============================================================
  window.AdminsPage = {
    init: init,
    reload: reload
  };

})();