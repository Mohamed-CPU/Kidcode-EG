// ================================================================
//  admin-utils.js - الدوال المشتركة للوحة الأدمن
//  يستخدم في جميع صفحات الأدمن
// ================================================================

(function() {
  'use strict';

  // ============================================================
  //  الثوابت والعناوين
  // ============================================================
  const GAS_URL = window.CONFIG?.API_URL || 'https://script.google.com/macros/s/AKfycbw86pnyJPYu36noh9p3Gwg611FCwMGbsaZ3uGiWXBMRj3mjIErsNyt6yMhvCFXsY_OC7w/exec';
  const VERCEL_URL = window.location.origin;

  console.log('✅ admin-utils.js تم تحميله بنجاح');

  // ============================================================
  //  دوال API
  // ============================================================

  window.callGAS = async function(action, params = {}, method = 'POST') {
    try {
      const url = method === 'GET' ? GAS_URL + '?' + new URLSearchParams({ action, ...params }) : GAS_URL;
      const options = {
        method: method,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      };
      if (method === 'POST') {
        options.body = new URLSearchParams({ action, ...params });
      }
      const response = await fetch(url, options);
      return await response.json();
    } catch (err) {
      console.error('❌ callGAS error:', err);
      return { success: false, error: err.message };
    }
  };

  window.callVercel = async function(endpoint, data = {}) {
    try {
      const url = `${VERCEL_URL}/api/admin/${endpoint}`;
      const token = localStorage.getItem('adminSessionToken') || '';
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(data)
      };
      const response = await fetch(url, options);
      if (response.status === 401) {
        localStorage.removeItem('adminSessionToken');
        localStorage.removeItem('adminUser');
        window.location.href = '/admin/';
        throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى.');
      }
      return await response.json();
    } catch (err) {
      console.error('❌ callVercel error:', err);
      return { success: false, error: err.message };
    }
  };

  window.apiRequest = async function(endpoint, data = {}, useVercel = true) {
    try {
      // معالجة خاصة للمصادقة
      if (endpoint === 'auth') {
        return await window.callGAS('adminAuthenticate', { username: data.username, password: data.password });
      }

      // معالجة خاصة لـ adminAddToEmailQueue (يجب أن تذهب مباشرة إلى GAS)
      if (data.action === 'adminAddToEmailQueue') {
        const gasParams = { ...data };
        if (data.recipientsArray) {
          gasParams.recipientsArray = JSON.stringify(data.recipientsArray);
        }
        return await window.callGAS('adminAddToEmailQueue', gasParams, 'POST');
      }

      // معالجة خاصة لـ createAdminAccount (يجب أن تذهب مباشرة إلى GAS)
      if (data.action === 'createAdminAccount') {
        return await window.callGAS('createAdminAccount', data, 'POST');
      }

      // محاولة عبر Vercel أولاً
      if (useVercel && localStorage.getItem('adminSessionToken')) {
        return await window.callVercel(endpoint, data);
      } else {
        // التحويل إلى GAS مباشرة
        const gasParams = { ...data };
        if (data.action === 'updateRow' && data.valuesArray) {
          gasParams.valuesArray = JSON.stringify(data.valuesArray);
        }
        if (data.action === 'getAll' && data.limit) {
          gasParams.limit = data.limit;
        }
        const gasActionMap = {
          'getAll': 'adminGetAllRows',
          'getRow': 'adminGetRow',
          'updateRow': 'adminUpdateRow'
        };
        const gasAction = gasActionMap[data.action] || data.action;
        return await window.callGAS(gasAction, gasParams, 'POST');
      }
    } catch (err) {
      console.warn('⚠️ apiRequest error, fallback to GAS:', err);
      const gasParams = { ...data };
      if (data.action === 'updateRow' && data.valuesArray) {
        gasParams.valuesArray = JSON.stringify(data.valuesArray);
      }
      const gasActionMap = {
        'getAll': 'adminGetAllRows',
        'getRow': 'adminGetRow',
        'updateRow': 'adminUpdateRow'
      };
      const gasAction = gasActionMap[data.action] || data.action;
      return await window.callGAS(gasAction, gasParams, 'POST');
    }
  };

  // ============================================================
  //  دوال التحقق من الجلسة
  // ============================================================

  window.checkAdminSession = function() {
    const token = localStorage.getItem('adminSessionToken');
    const user = localStorage.getItem('adminUser');
    if (!token || !user) {
      console.warn('⚠️ لا توجد جلسة، إعادة التوجيه إلى تسجيل الدخول');
      window.location.href = '/admin/';
      return false;
    }
    return true;
  };

  window.adminLogout = function() {
    localStorage.removeItem('adminSessionToken');
    localStorage.removeItem('adminUser');
    window.location.href = '/admin/';
  };

  // ============================================================
  //  دوال تحميل وعرض البيانات (الجداول)
  // ============================================================

  window.loadTableData = async function(sheetName, containerId, sectionName) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error('❌ container not found:', containerId);
      return;
    }

    try {
      container.innerHTML = '<div style="text-align:center; padding:40px;"><i class="fas fa-spinner fa-spin"></i> جاري تحميل البيانات...</div>';

      const result = await window.apiRequest('data', {
        action: 'getAll',
        sheetName: sheetName,
        limit: 100
      });

      if (!result.success) {
        container.innerHTML = `<div style="color:var(--admin-danger);">❌ ${result.error || 'فشل تحميل البيانات'}</div>`;
        return;
      }

      const data = result.data || [];
      const headers = result.headers || [];
      const total = result.total || 0;

      window._adminData = {
        currentSheet: sheetName,
        currentData: data,
        currentHeaders: headers,
        currentSection: sectionName
      };

      if (data.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-light);">📭 لا توجد بيانات في هذه الورقة</div>`;
        return;
      }

      let tableHtml = `<div style="margin-bottom:12px; font-weight:700; color:var(--text-secondary);">إجمالي: ${total} سجل</div>`;
      tableHtml += `<div class="table-wrapper"><table><thead><tr>`;

      const displayCols = headers.slice(0, 10);
      displayCols.forEach(col => {
        tableHtml += `<th>${col}</th>`;
      });
      tableHtml += `<th>الإجراءات</th></tr></thead><tbody>`;

      data.forEach((row, index) => {
        tableHtml += `<tr>`;
        displayCols.forEach(col => {
          const val = row[col] || '';
          const displayVal = val.length > 50 ? val.substring(0, 50) + '...' : val;
          tableHtml += `<td>${displayVal}</td>`;
        });
        const rowIndex = row._rowIndex || (index + 2);
        tableHtml += `
          <td>
            <button class="btn-action edit" data-index="${index}" data-rowindex="${rowIndex}">
              <i class="fas fa-edit"></i> تعديل
            </button>
          </td>
        </tr>`;
      });

      tableHtml += `</tbody></table></div>`;
      container.innerHTML = tableHtml;

      container.querySelectorAll('.btn-action.edit').forEach(btn => {
        btn.addEventListener('click', function() {
          const index = parseInt(this.dataset.index);
          const rowIndex = parseInt(this.dataset.rowindex);
          window.openEditModal(index, rowIndex);
        });
      });

    } catch (err) {
      container.innerHTML = `<div style="color:var(--admin-danger);">❌ خطأ: ${err.message}</div>`;
    }
  };

  // ============================================================
  //  مودال التعديل
  // ============================================================

  window.openEditModal = function(dataIndex, rowIndex) {
    const data = window._adminData?.currentData || [];
    const headers = window._adminData?.currentHeaders || [];
    const row = data[dataIndex];
    if (!row) {
      alert('❌ لم يتم العثور على الصف');
      return;
    }

    window._editState = {
      dataIndex: dataIndex,
      rowIndex: rowIndex,
      data: row,
      headers: headers,
      sheetName: window._adminData?.currentSheet || ''
    };

    const modal = document.getElementById('editModal');
    const body = document.getElementById('editModalBody');
    const title = document.getElementById('editModalTitle');
    const message = document.getElementById('editModalMessage');

    if (!modal || !body) {
      console.error('❌ editModal elements not found');
      return;
    }

    title.textContent = `✏️ تعديل بيانات (الصف ${rowIndex})`;
    message.style.display = 'none';

    let bodyHtml = '';
    const excludeCols = ['_rowIndex', 'TIMESTAMP', 'PASSWORD_HASH', 'RESET_TOKEN', 'RESET_TOKEN_EXPIRY'];

    headers.forEach((col, idx) => {
      if (excludeCols.includes(col)) return;
      const value = row[col] || '';
      const isLong = value.length > 100 || col.includes('NOTES') || col.includes('BODY') || col.includes('PERMISSIONS');
      bodyHtml += `
        <div class="form-group">
          <label for="edit_${idx}">${col}</label>
          ${isLong ? `<textarea id="edit_${idx}" rows="3">${value}</textarea>` : `<input type="text" id="edit_${idx}" value="${value}" />`}
        </div>
      `;
    });

    body.innerHTML = bodyHtml;

    const saveBtn = document.getElementById('editSaveBtn');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-save"></i> حفظ التغييرات';
      saveBtn.dataset.rowindex = rowIndex;
    }

    modal.classList.add('active');
  };

  window.saveEdit = async function() {
    const saveBtn = document.getElementById('editSaveBtn');
    const message = document.getElementById('editModalMessage');
    const state = window._editState;

    if (!state) {
      alert('❌ لا توجد بيانات للتعديل');
      return;
    }

    const headers = state.headers;
    const rowIndex = state.rowIndex;
    const sheetName = state.sheetName;

    const values = [];
    const excludeCols = ['_rowIndex', 'TIMESTAMP', 'PASSWORD_HASH', 'RESET_TOKEN', 'RESET_TOKEN_EXPIRY'];

    headers.forEach((col, idx) => {
      if (excludeCols.includes(col)) {
        values.push(state.data[col] || '');
        return;
      }
      const input = document.getElementById(`edit_${idx}`);
      values.push(input ? input.value : '');
    });

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحفظ...';
    message.style.display = 'block';
    message.innerHTML = '⏳ جاري حفظ البيانات...';
    message.style.color = 'var(--text-secondary)';

    try {
      const result = await window.apiRequest('data', {
        action: 'updateRow',
        sheetName: sheetName,
        rowIndex: rowIndex,
        valuesArray: values
      });

      if (result.success) {
        message.innerHTML = '✅ ' + (result.message || 'تم الحفظ بنجاح!');
        message.style.color = 'var(--admin-success)';
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-save"></i> حفظ التغييرات';

        setTimeout(() => {
          document.getElementById('editModal').classList.remove('active');
          const section = window._adminData?.currentSection || 'dashboard';
          const sheet = window._adminData?.currentSheet || '';
          if (sheet) {
            window.loadTableData(sheet, 'tableWrapper', section);
          }
        }, 1000);
      } else {
        message.innerHTML = '❌ ' + (result.error || 'فشل الحفظ');
        message.style.color = 'var(--admin-danger)';
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-save"></i> حفظ التغييرات';
      }
    } catch (err) {
      message.innerHTML = '❌ خطأ: ' + err.message;
      message.style.color = 'var(--admin-danger)';
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-save"></i> حفظ التغييرات';
    }
  };

  // ============================================================
  //  دوال البريد الإلكتروني
  // ============================================================

  window.sendEmail = async function(type, idField, subjectField, bodyField, statusField) {
    const id = document.getElementById(idField)?.value.trim() || '';
    const subject = document.getElementById(subjectField)?.value.trim();
    const body = document.getElementById(bodyField)?.value.trim();
    const statusEl = document.getElementById(statusField);

    if (!subject || !body) {
      if (statusEl) {
        statusEl.className = 'status-msg error';
        statusEl.textContent = '⚠️ الموضوع والمحتوى مطلوبان';
      }
      return;
    }

    const btn = statusEl?.closest('.email-card')?.querySelector('.btn-send');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';
    }

    if (statusEl) {
      statusEl.className = 'status-msg';
      statusEl.textContent = '';
    }

    try {
      let recipients = [];
      let sheetName = '';
      let searchCol = '';
      let searchVal = '';

      switch (type) {
        case 'children':
          sheetName = 'KidCode-eg';
          searchCol = '1';
          searchVal = id;
          break;
        case 'marketers':
          sheetName = 'MarketersAccounts';
          searchCol = '0';
          searchVal = id;
          break;
        case 'newsletter':
          sheetName = 'NewsletterSubscribers';
          searchCol = '2';
          searchVal = id;
          break;
        default:
          throw new Error('نوع غير معروف');
      }

      if (id) {
        const result = await window.apiRequest('data', {
          action: 'getRow',
          sheetName: sheetName,
          searchCol: searchCol,
          searchValue: searchVal
        });
        if (result.success && result.data) {
          const emailCol = type === 'children' ? 'EMAIL_CODE' :
                           type === 'marketers' ? 'EMAIL' :
                           'EMAIL';
          recipients = [result.data[emailCol] || ''];
        }
      } else {
        const result = await window.apiRequest('data', {
          action: 'getAll',
          sheetName: sheetName,
          limit: 200
        });
        if (result.success && result.data) {
          const emailCol = type === 'children' ? 'EMAIL_CODE' :
                           type === 'marketers' ? 'EMAIL' :
                           'EMAIL';
          recipients = result.data.map(row => row[emailCol] || '').filter(e => e && e.includes('@'));
        }
      }

      if (recipients.length === 0) {
        if (statusEl) {
          statusEl.className = 'status-msg error';
          statusEl.textContent = '⚠️ لا يوجد مستلمين للبريد';
        }
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-paper-plane"></i> إرسال';
        }
        return;
      }

      const result = await window.apiRequest('data', {
        action: 'adminAddToEmailQueue',
        recipientsArray: recipients,
        subject: subject,
        bodyHtml: body,
        senderType: type
      }, false);

      if (result.success) {
        if (statusEl) {
          statusEl.className = 'status-msg success';
          statusEl.textContent = `✅ تم إضافة ${result.addedCount || recipients.length} بريد إلى الطابور. ${result.remaining ? 'متبقي: ' + result.remaining : ''}`;
        }
        document.getElementById(idField).value = '';
        document.getElementById(subjectField).value = '';
        document.getElementById(bodyField).value = '';
      } else {
        if (statusEl) {
          statusEl.className = 'status-msg error';
          statusEl.textContent = '❌ ' + (result.error || 'فشل الإرسال');
        }
      }

    } catch (err) {
      if (statusEl) {
        statusEl.className = 'status-msg error';
        statusEl.textContent = '❌ خطأ: ' + err.message;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> إرسال';
      }
    }
  };

  // ============================================================
  //  إدارة المسؤولين
  // ============================================================

  window.loadAdmins = async function() {
    const container = document.getElementById('adminsList');
    if (!container) return;

    try {
      container.innerHTML = '<div style="text-align:center; padding:20px;"><i class="fas fa-spinner fa-spin"></i> جاري التحميل...</div>';

      const result = await window.apiRequest('data', {
        action: 'getAll',
        sheetName: 'AdminAccounts',
        limit: 50
      });

      if (!result.success) {
        container.innerHTML = `<div style="color:var(--admin-danger);">❌ ${result.error}</div>`;
        return;
      }

      const admins = result.data || [];
      if (admins.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-light);">لا يوجد مسؤولون</div>';
        return;
      }

      let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
        <span style="font-weight:700; color:var(--text-secondary);">إجمالي: ${admins.length}</span>
      </div>`;

      admins.forEach(admin => {
        const perms = admin.PERMISSIONS || '{}';
        let permSummary = '';
        try {
          const p = JSON.parse(perms);
          permSummary = Object.keys(p).filter(k => p[k] && (p[k].read || p[k].manage)).join('، ');
        } catch(e) {}

        const isActive = admin.IS_ACTIVE === 'نشط';
        html += `
          <div class="admin-user-card">
            <div class="user-info">
              <div class="name">${admin.FULL_NAME || 'غير معروف'}</div>
              <div class="username">👤 ${admin.USERNAME || ''}</div>
              <div class="perms">🔑 ${permSummary || 'لا توجد صلاحيات'}</div>
              <div style="font-size:0.7rem; color:var(--text-light); margin-top:4px;">
                ${isActive ? '🟢 نشط' : '🔴 غير نشط'}
              </div>
            </div>
            <div class="user-actions">
              ${admin.USERNAME !== 'super_admin' ? `<button class="btn" style="background:#fee2e2; color:var(--admin-danger);" onclick="window.toggleAdmin('${admin.USERNAME}', '${isActive}')">
                ${isActive ? 'تعطيل' : 'تفعيل'}
              </button>` : '<span style="font-size:0.7rem; color:var(--text-light);">🔒 أساسي</span>'}
            </div>
          </div>
        `;
      });

      container.innerHTML = html;

    } catch (err) {
      container.innerHTML = `<div style="color:var(--admin-danger);">❌ ${err.message}</div>`;
    }
  };

  window.toggleAdmin = async function(username, currentStatus) {
    if (!confirm(`هل أنت متأكد من ${currentStatus ? 'تعطيل' : 'تفعيل'} المسؤول ${username}؟`)) return;

    try {
      const result = await window.apiRequest('data', {
        action: 'getRow',
        sheetName: 'AdminAccounts',
        searchCol: '0',
        searchValue: username
      });

      if (!result.success || !result.data) {
        alert('❌ لم يتم العثور على المسؤول');
        return;
      }

      const row = result.data;
      const rowIndex = row._rowIndex;
      const headers = ['USERNAME', 'PASSWORD_HASH', 'FULL_NAME', 'PERMISSIONS', 'CREATED_BY', 'CREATED_AT', 'IS_ACTIVE'];
      const values = headers.map(h => {
        if (h === 'IS_ACTIVE') return currentStatus ? 'غير نشط' : 'نشط';
        return row[h] || '';
      });

      const updateResult = await window.apiRequest('data', {
        action: 'updateRow',
        sheetName: 'AdminAccounts',
        rowIndex: rowIndex,
        valuesArray: values
      });

      if (updateResult.success) {
        alert('✅ تم التحديث بنجاح');
        window.loadAdmins();
      } else {
        alert('❌ ' + (updateResult.error || 'فشل التحديث'));
      }
    } catch (err) {
      alert('❌ خطأ: ' + err.message);
    }
  };

  window.createNewAdmin = async function() {
    const fullName = document.getElementById('newAdminFullName').value.trim();
    const username = document.getElementById('newAdminUsername').value.trim();
    const password = document.getElementById('newAdminPassword').value.trim();
    const permissionsRaw = document.getElementById('newAdminPermissions').value.trim();
    const messageEl = document.getElementById('createAdminMessage');
    const saveBtn = document.getElementById('createAdminSaveBtn');

    if (!fullName || !username || !password) {
      if (messageEl) {
        messageEl.style.display = 'block';
        messageEl.innerHTML = '⚠️ جميع الحقول مطلوبة';
        messageEl.style.color = 'var(--admin-danger)';
      }
      return;
    }

    let permissions = {};
    try {
      permissions = JSON.parse(permissionsRaw);
    } catch (e) {
      if (messageEl) {
        messageEl.style.display = 'block';
        messageEl.innerHTML = '⚠️ صيغة JSON غير صحيحة في الصلاحيات';
        messageEl.style.color = 'var(--admin-danger)';
      }
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإنشاء...';
    }
    if (messageEl) {
      messageEl.style.display = 'block';
      messageEl.innerHTML = '⏳ جاري إنشاء الحساب...';
      messageEl.style.color = 'var(--text-secondary)';
    }

    try {
      const user = JSON.parse(localStorage.getItem('adminUser') || '{}');
      const result = await window.callGAS('createAdminAccount', {
        fullName: fullName,
        username: username,
        password: password,
        permissions: JSON.stringify(permissions),
        createdBy: user?.username || 'system'
      });

      if (result.success) {
        if (messageEl) {
          messageEl.innerHTML = '✅ ' + (result.message || 'تم إنشاء المسؤول بنجاح!');
          messageEl.style.color = 'var(--admin-success)';
        }
        setTimeout(() => {
          document.getElementById('createAdminModal').classList.remove('active');
          window.loadAdmins();
        }, 1500);
      } else {
        if (messageEl) {
          messageEl.innerHTML = '❌ ' + (result.error || 'فشل الإنشاء');
          messageEl.style.color = 'var(--admin-danger)';
        }
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<i class="fas fa-user-plus"></i> إنشاء الحساب';
        }
      }
    } catch (err) {
      if (messageEl) {
        messageEl.innerHTML = '❌ خطأ: ' + err.message;
        messageEl.style.color = 'var(--admin-danger)';
      }
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-user-plus"></i> إنشاء الحساب';
      }
    }
  };

  // ============================================================
  //  دوال عامة أخرى
  // ============================================================

  window.highlightActiveNav = function() {
    const currentPage = window.location.pathname.split('/').pop();
    document.querySelectorAll('.admin-nav a[href]').forEach(link => {
      const href = link.getAttribute('href');
      if (href === currentPage || (currentPage === '' && href === 'dashboard.html')) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  };

  console.log('✅ admin-utils.js تم تحميله بنجاح');
})();