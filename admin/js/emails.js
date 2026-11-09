// ================================================================
//  admin/js/emails.js — منطق مركز البريد (Quill + Templates + Attachments)
// ================================================================

(function() {
  'use strict';

  const state = {
    isInitialized: false,
    activeTab: 'individual',
    isSending: false,
    templates: [],
    editingTemplateId: null,
    editorsReady: false
  };

  // ============================================================
  //  🚀 init
  // ============================================================
  function init() {
    if (state.isInitialized) return;
    state.isInitialized = true;

    // 1. Quill يجب أن يكون محمّلًا قبل إنشاء المحررات
    if (!window.Quill || !window.EmailEditor) {
      console.error('[EmailsPage] Quill أو EmailEditor غير محمّل');
      window.UI.toast.error('تعذر تحميل المحرر. حدّث الصفحة.');
      return;
    }

    initEditors();

    bindTabs();
    bindSingle();
    bindBulk();
    bindCustom();
    bindAttachments();
    bindTemplates();
    bindQueueReload();

    onBulkTypeChange();

    // تحميل القوالب مبدئيًا
    loadTemplatesDropdown();
  }

  function reload() {
    if (state.activeTab === 'campaigns') loadCampaigns();
    if (state.activeTab === 'queue') loadQueueStats();
    if (state.activeTab === 'templates') loadTemplatesList();
  }

  // ============================================================
  //  🎨 initEditors — إنشاء محررات Quill
  // ============================================================
  function initEditors() {
    if (state.editorsReady) return;

    try {
      window.EmailEditor.create('single_editor', { placeholder: 'اكتب رسالة إلى جهة واحدة...' });
      window.EmailEditor.create('bulk_editor', { placeholder: 'اكتب رسالة جماعية...' });
      window.EmailEditor.create('custom_editor', { placeholder: 'اكتب رسالة للقائمة المخصصة...' });
      window.EmailEditor.create('tpl_editor', { placeholder: 'اكتب محتوى القالب...' });

      state.editorsReady = true;
      console.log('✅ [EmailsPage] المحررات جاهزة');
    } catch (e) {
      console.error('[EmailsPage] initEditors:', e);
    }
  }

  // ============================================================
  //  🎯 Tabs
  // ============================================================
  function bindTabs() {
    document.querySelectorAll('.email-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        switchTab(this.getAttribute('data-tab'));
      });
    });

    // أزرار "إدارة القوالب" داخل كل تبويب
    document.querySelectorAll('.switch-to-templates-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        switchTab('templates');
      });
    });
  }

  function switchTab(tab) {
    state.activeTab = tab;

    document.querySelectorAll('.email-tab').forEach(function(b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    document.querySelectorAll('.tab-content').forEach(function(c) {
      c.classList.toggle('active', c.getAttribute('data-tab-content') === tab);
    });

    if (tab === 'campaigns') loadCampaigns();
    if (tab === 'queue') loadQueueStats();
    if (tab === 'templates') loadTemplatesList();
  }

  // ============================================================
  //  📎 Attachments Binding
  // ============================================================
  function bindAttachments() {
    // أزرار الإرفاق
    document.querySelectorAll('.attach-file-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const key = this.getAttribute('data-key');
        const input = document.querySelector('.attach-file-input[data-key="' + key + '"]');
        if (input) input.click();
      });
    });

    // Inputs
    document.querySelectorAll('.attach-file-input').forEach(function(input) {
      input.addEventListener('change', async function() {
        const key = this.getAttribute('data-key');
        await handleAttachFiles(key, this.files);
        this.value = '';
      });
    });
  }

  async function handleAttachFiles(key, fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const MAX_PER_FILE = 4 * 1024 * 1024;      // 4MB (Vercel body limit)
    const MAX_TOTAL = 8 * 1024 * 1024;         // 8MB
    const MAX_COUNT = 5;

    const currentCount = window.EmailEditor.getAttachmentsCount(key);
    const currentBytes = window.EmailEditor.getAttachmentsTotalBytes(key);

    if (currentCount >= MAX_COUNT) {
      window.UI.toast.error('الحد الأقصى ' + MAX_COUNT + ' مرفقات');
      return;
    }

    const allowedTypes = /\.(pdf|doc|docx|xls|xlsx|png|jpe?g|gif|webp|zip)$/i;

    let addedCount = 0;
    let totalBytes = currentBytes;

    for (const file of files) {
      if (currentCount + addedCount >= MAX_COUNT) {
        window.UI.toast.warning('وصلت للحد الأقصى — لم يتم إضافة الباقي');
        break;
      }

      // فحص النوع
      if (!allowedTypes.test(file.name) && !file.type.startsWith('image/')) {
        window.UI.toast.error('نوع ملف غير مدعوم: ' + file.name);
        continue;
      }

      // فحص الحجم
      if (file.size > MAX_PER_FILE) {
        window.UI.toast.error('ملف كبير: ' + file.name + ' (الحد 4MB)');
        continue;
      }

      if (totalBytes + file.size > MAX_TOTAL) {
        window.UI.toast.error('الحجم الإجمالي للمرفقات يتجاوز 8MB');
        break;
      }

      // رفع
      try {
        window.UI.toast.info('جاري رفع: ' + file.name);
        const result = await window.EmailEditor.uploadFile(file);

        if (!result.success) {
          window.UI.toast.error('فشل رفع ' + file.name + ': ' + (result.message || result.error));
          continue;
        }

        window.EmailEditor.addAttachment(key, {
          url: result.url,
          name: file.name,
          size: result.bytes || file.size,
          type: file.type || '',
          publicId: result.publicId || ''
        });

        addedCount++;
        totalBytes += file.size;
      } catch (e) {
        console.error('[attach] upload error:', e);
        window.UI.toast.error('تعذر رفع: ' + file.name);
      }
    }

    if (addedCount > 0) {
      window.UI.toast.success('تم إرفاق ' + addedCount + ' ملف');
      renderAttachments(key);
    }
  }

  function renderAttachments(key) {
    const container = document.getElementById(key + '_attachments_list');
    if (!container) return;

    const items = window.EmailEditor.getAttachments(key);

    if (!items || items.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = items.map(function(item, i) {
      const sizeKB = Math.round((item.size || 0) / 1024);
      const icon = getFileIcon(item.name);
      return '<div class="attachment-chip" data-index="' + i + '">' +
        '<span class="chip-icon">' + icon + '</span>' +
        '<span class="chip-info">' +
          '<span class="chip-name">' + escapeHtml(item.name) + '</span>' +
          '<span class="chip-size">' + sizeKB + ' KB</span>' +
        '</span>' +
        '<button class="chip-remove" data-key="' + key + '" data-index="' + i + '" title="حذف">' +
          '<i class="fas fa-times"></i>' +
        '</button>' +
      '</div>';
    }).join('');

    // ربط أزرار الحذف
    container.querySelectorAll('.chip-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const k = this.getAttribute('data-key');
        const idx = parseInt(this.getAttribute('data-index'), 10);
        window.EmailEditor.removeAttachment(k, idx);
        renderAttachments(k);
      });
    });
  }

  function getFileIcon(name) {
    const n = String(name || '').toLowerCase();
    if (/\.pdf$/.test(n)) return '📄';
    if (/\.(doc|docx)$/.test(n)) return '📝';
    if (/\.(xls|xlsx)$/.test(n)) return '📊';
    if (/\.(png|jpe?g|gif|webp)$/.test(n)) return '🖼️';
    if (/\.zip$/.test(n)) return '📦';
    return '📎';
  }

  // ============================================================
  //  🎯 Single Email
  // ============================================================
  function bindSingle() {
    const typeSelect = document.getElementById('single_type');
    if (typeSelect) {
      typeSelect.addEventListener('change', function() {
        updateSingleIdentifierLabel(this.value);
      });
      updateSingleIdentifierLabel(typeSelect.value);
    }

    const sendBtn = document.getElementById('send_single_btn');
    if (sendBtn) sendBtn.addEventListener('click', sendSingle);
  }

  function updateSingleIdentifierLabel(type) {
    const label = document.getElementById('single_identifier_label');
    const input = document.getElementById('single_identifier');
    const hint = document.getElementById('single_identifier_hint');

    if (type === 'child') {
      label.textContent = 'كود الطفل';
      input.placeholder = 'KC-01001';
      hint.textContent = 'أدخل كود الطفل (مثال: KC-01001)';
    } else if (type === 'marketer') {
      label.textContent = 'كود المسوق';
      input.placeholder = 'MA0001';
      hint.textContent = 'أدخل كود المسوق';
    } else {
      label.textContent = 'البريد الإلكتروني';
      input.placeholder = 'user@example.com';
      hint.textContent = 'أدخل البريد الإلكتروني للمشترك';
    }
  }

  async function sendSingle() {
    if (state.isSending) return;

    const type = document.getElementById('single_type').value;
    const identifier = document.getElementById('single_identifier').value.trim();
    const subject = document.getElementById('single_subject').value.trim();
    const bodyHtml = window.EmailEditor.getHtml('single_editor');
    const attachments = window.EmailEditor.getAttachments('single');
    const msgEl = document.getElementById('single_message');

    if (!identifier) return showMsg(msgEl, 'error', 'المعرّف مطلوب');
    if (!subject) return showMsg(msgEl, 'error', 'الموضوع مطلوب');
    if (!bodyHtml) return showMsg(msgEl, 'error', 'المحتوى مطلوب');

    const confirmed = await window.UI.confirm({
      title: 'تأكيد الإرسال',
      message: 'إرسال رسالة إلى: ' + identifier + (attachments.length > 0 ? '\n+' + attachments.length + ' مرفق' : ''),
      confirmText: 'إرسال',
      type: 'warning'
    });
    if (!confirmed) return;

    state.isSending = true;
    const btn = document.getElementById('send_single_btn');
    window.UI.setLoading(btn, true, 'جاري الإرسال...');
    hideMsg(msgEl);

    try {
      const result = await window.Core.api('sendSingleEmail', {
        type: type,
        identifier: identifier,
        subject: subject,
        bodyHtml: bodyHtml,
        attachments: attachments
      }, 'POST');

      if (result.success) {
        showMsg(msgEl, 'success', result.message + ' → ' + result.email);
        document.getElementById('single_identifier').value = '';
        document.getElementById('single_subject').value = '';
        window.EmailEditor.clear('single_editor');
        window.EmailEditor.clearAttachments('single');
        renderAttachments('single');
      } else {
        showMsg(msgEl, 'error', result.message || result.error || 'فشل الإرسال');
      }
    } catch (e) {
      showMsg(msgEl, 'error', e.userMessage || 'تعذر الإرسال');
    } finally {
      state.isSending = false;
      window.UI.setLoading(btn, false);
    }
  }

  // ============================================================
  //  🎯 Bulk Email
  // ============================================================
  function bindBulk() {
    const typeSelect = document.getElementById('bulk_type');
    if (typeSelect) typeSelect.addEventListener('change', onBulkTypeChange);

    const countBtn = document.getElementById('count_recipients_btn');
    if (countBtn) countBtn.addEventListener('click', countRecipients);

    const sendBtn = document.getElementById('send_bulk_btn');
    if (sendBtn) sendBtn.addEventListener('click', sendBulk);
  }

  function onBulkTypeChange() {
    const type = document.getElementById('bulk_type').value;
    document.getElementById('filter_children').style.display = (type === 'children') ? 'grid' : 'none';
    document.getElementById('filter_marketers').style.display = (type === 'marketers') ? 'grid' : 'none';
    document.getElementById('filter_newsletter').style.display = (type === 'newsletter') ? 'grid' : 'none';
    document.getElementById('recipients_counter').style.display = 'none';
  }

  function getBulkFilter() {
    const type = document.getElementById('bulk_type').value;

    if (type === 'children') {
      return {
        status: document.getElementById('child_filter_status').value || undefined,
        plan: document.getElementById('child_filter_plan').value || undefined,
        hasMarketer: (function() {
          const v = document.getElementById('child_filter_has_marketer').value;
          if (v === '') return undefined;
          return v === 'true';
        })()
      };
    }
    if (type === 'marketers') {
      return {
        isActive: document.getElementById('marketer_filter_status').value || undefined,
        governorate: document.getElementById('marketer_filter_governorate').value.trim() || undefined,
        hasTelegram: (function() {
          const v = document.getElementById('marketer_filter_has_telegram').value;
          if (v === '') return undefined;
          return v === 'true';
        })()
      };
    }
    if (type === 'newsletter') {
      return { isActive: document.getElementById('subscriber_filter_status').value || undefined };
    }
    return {};
  }

  async function countRecipients() {
    const type = document.getElementById('bulk_type').value;
    const filter = getBulkFilter();
    const btn = document.getElementById('count_recipients_btn');
    window.UI.setLoading(btn, true, 'جاري الحساب...');

    try {
      const result = await window.Core.api('getRecipientsCount', { type: type, filter: filter }, 'POST');
      if (result.success) {
        document.getElementById('recipients_counter').style.display = 'flex';
        document.getElementById('counter_total').textContent = formatNumber(result.count);
        document.getElementById('counter_immediate').textContent = formatNumber(result.immediate);
        document.getElementById('counter_queued').textContent = formatNumber(result.queued);
      } else {
        window.UI.toast.error(result.message || 'فشل الحساب');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الاتصال');
    } finally {
      window.UI.setLoading(btn, false);
    }
  }

  async function sendBulk() {
    if (state.isSending) return;

    const type = document.getElementById('bulk_type').value;
    const filter = getBulkFilter();
    const subject = document.getElementById('bulk_subject').value.trim();
    const bodyHtml = window.EmailEditor.getHtml('bulk_editor');
    const attachments = window.EmailEditor.getAttachments('bulk');
    const msgEl = document.getElementById('bulk_message');

    if (!subject) return showMsg(msgEl, 'error', 'الموضوع مطلوب');
    if (!bodyHtml) return showMsg(msgEl, 'error', 'المحتوى مطلوب');

    const counterEl = document.getElementById('recipients_counter');
    if (counterEl.style.display === 'none') await countRecipients();

    const totalText = document.getElementById('counter_total').textContent;
    const queuedText = document.getElementById('counter_queued').textContent;

    const confirmed = await window.UI.confirm({
      title: 'تأكيد الإرسال الجماعي',
      message: 'إجمالي المستلمين: ' + totalText + '\nمؤجل: ' + queuedText +
               (attachments.length > 0 ? '\n+' + attachments.length + ' مرفق' : '') + '\n\nمتابعة؟',
      confirmText: 'إرسال',
      type: 'warning'
    });
    if (!confirmed) return;

    state.isSending = true;
    const btn = document.getElementById('send_bulk_btn');
    window.UI.setLoading(btn, true, 'جاري الإرسال...');
    hideMsg(msgEl);

    try {
      const result = await window.Core.api('sendBulkEmail', {
        type: type,
        filter: filter,
        subject: subject,
        bodyHtml: bodyHtml,
        attachments: attachments
      }, 'POST');

      if (result.success) {
        showMsg(msgEl, 'success', result.message);
        document.getElementById('bulk_subject').value = '';
        window.EmailEditor.clear('bulk_editor');
        window.EmailEditor.clearAttachments('bulk');
        renderAttachments('bulk');
      } else {
        showMsg(msgEl, 'error', result.message || result.error || 'فشل الإرسال');
      }
    } catch (e) {
      showMsg(msgEl, 'error', e.userMessage || 'تعذر الإرسال');
    } finally {
      state.isSending = false;
      window.UI.setLoading(btn, false);
    }
  }

  // ============================================================
  //  🎯 Custom Emails
  // ============================================================
  function bindCustom() {
    const sendBtn = document.getElementById('send_custom_btn');
    if (sendBtn) sendBtn.addEventListener('click', sendCustom);
  }

  async function sendCustom() {
    if (state.isSending) return;

    const emailsRaw = document.getElementById('custom_emails').value;
    const subject = document.getElementById('custom_subject').value.trim();
    const bodyHtml = window.EmailEditor.getHtml('custom_editor');
    const attachments = window.EmailEditor.getAttachments('custom');
    const msgEl = document.getElementById('custom_message');

    const emails = emailsRaw.split(/[\s,;\n]+/)
      .map(e => e.trim())
      .filter(e => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

    if (emails.length === 0) return showMsg(msgEl, 'error', 'لا توجد بريدات صالحة');
    if (!subject) return showMsg(msgEl, 'error', 'الموضوع مطلوب');
    if (!bodyHtml) return showMsg(msgEl, 'error', 'المحتوى مطلوب');

    const confirmed = await window.UI.confirm({
      title: 'تأكيد الإرسال',
      message: 'إرسال إلى ' + emails.length + ' بريد؟' +
               (attachments.length > 0 ? '\n+' + attachments.length + ' مرفق' : '') +
               '\n(الحد الأقصى 200 فورًا)',
      confirmText: 'إرسال',
      type: 'warning'
    });
    if (!confirmed) return;

    state.isSending = true;
    const btn = document.getElementById('send_custom_btn');
    window.UI.setLoading(btn, true, 'جاري الإرسال...');
    hideMsg(msgEl);

    try {
      const result = await window.Core.api('sendCustomEmail', {
        emails: emails,
        subject: subject,
        bodyHtml: bodyHtml,
        attachments: attachments
      }, 'POST');

      if (result.success) {
        showMsg(msgEl, 'success', result.message);
        document.getElementById('custom_emails').value = '';
        document.getElementById('custom_subject').value = '';
        window.EmailEditor.clear('custom_editor');
        window.EmailEditor.clearAttachments('custom');
        renderAttachments('custom');
      } else {
        showMsg(msgEl, 'error', result.message || result.error || 'فشل الإرسال');
      }
    } catch (e) {
      showMsg(msgEl, 'error', e.userMessage || 'تعذر الإرسال');
    } finally {
      state.isSending = false;
      window.UI.setLoading(btn, false);
    }
  }

  // ============================================================
  //  📄 Templates
  // ============================================================
  function bindTemplates() {
    // Template selectors
    document.querySelectorAll('.template-selector').forEach(function(sel) {
      sel.addEventListener('change', function() {
        handleTemplateSelect(this.value, this.getAttribute('data-target'), this.getAttribute('data-subject'));
      });
    });

    // Create button
    const createBtn = document.getElementById('create_template_btn');
    if (createBtn) createBtn.addEventListener('click', function() { openTemplateModal(null); });

    // Modal buttons
    const closeBtn = document.getElementById('closeTemplateModalBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeTemplateModal);

    const cancelBtn = document.getElementById('cancelTemplateBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeTemplateModal);

    const saveBtn = document.getElementById('saveTemplateBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveTemplate);

    // ✅ ربط Modal زر CTA
    bindEmailButtonModal();
  }

  // ============================================================
  //  🔗 Email Button Modal
  // ============================================================
  let currentButtonEditorId = null;

  function bindEmailButtonModal() {
    const closeBtn = document.getElementById('closeEmailButtonModalBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeEmailButtonModal);

    const cancelBtn = document.getElementById('cancelEmailButtonBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeEmailButtonModal);

    const insertBtn = document.getElementById('insertEmailButtonBtn');
    if (insertBtn) insertBtn.addEventListener('click', insertEmailButton);

    // Enter على حقل الاسم
    const textInput = document.getElementById('btn_text');
    if (textInput) {
      textInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          document.getElementById('btn_url').focus();
        }
      });
    }

    // Enter على حقل الرابط
    const urlInput = document.getElementById('btn_url');
    if (urlInput) {
      urlInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          insertEmailButton();
        }
      });
    }
  }

  function openButtonModal(containerId) {
    currentButtonEditorId = containerId;

    document.getElementById('btn_text').value = '';
    document.getElementById('btn_url').value = '';
    document.querySelector('input[name="btn_color"][value="primary"]').checked = true;
    document.getElementById('btn_modal_error').style.display = 'none';

    window.UI.modal.open('emailButtonModal');
    setTimeout(function() {
      document.getElementById('btn_text').focus();
    }, 200);
  }

  function closeEmailButtonModal() {
    window.UI.modal.close('emailButtonModal');
    currentButtonEditorId = null;
  }

  function insertEmailButton() {
    const text = document.getElementById('btn_text').value.trim();
    const url = document.getElementById('btn_url').value.trim();
    const color = document.querySelector('input[name="btn_color"]:checked').value;
    const errorEl = document.getElementById('btn_modal_error');

    if (!text) return showButtonError('اسم الزر مطلوب');
    if (text.length > 80) return showButtonError('اسم الزر طويل جدًا');
    if (!url) return showButtonError('الرابط مطلوب');
    if (!/^https?:\/\/.+/i.test(url)) return showButtonError('الرابط يجب أن يبدأ بـ http:// أو https://');

    if (!currentButtonEditorId) {
      return showButtonError('حدث خطأ — أعد المحاولة');
    }

    const ok = window.EmailEditor.insertEmailButton(currentButtonEditorId, {
      text: text,
      url: url,
      color: color
    });

    if (!ok) {
      return showButtonError('تعذر إدراج الزر — حاول مرة أخرى');
    }

    if (errorEl) errorEl.style.display = 'none';
    window.UI.toast.success('تم إدراج الزر');
    closeEmailButtonModal();
  }

  function showButtonError(msg) {
    const el = document.getElementById('btn_modal_error');
    if (!el) return;
    el.textContent = '⚠️ ' + msg;
    el.style.display = 'block';
  }

  async function loadTemplatesDropdown() {
    try {
      const result = await window.Core.api('getEmailTemplatesList', { activeOnly: true }, 'POST');
      if (!result.success) {
        console.warn('[templates] load failed:', result.error);
        return;
      }
      state.templates = result.list || [];
      renderTemplateDropdowns();
    } catch (e) {
      console.warn('[templates] load exception:', e);
    }
  }

  function renderTemplateDropdowns() {
    document.querySelectorAll('.template-selector').forEach(function(sel) {
      const current = sel.value;
      let opts = '<option value="">— بدون قالب —</option>';
      state.templates.forEach(function(t) {
        opts += '<option value="' + t.id + '">' + escapeHtml(t.name) + '</option>';
      });
      sel.innerHTML = opts;
      sel.value = current;
    });
  }

  async function handleTemplateSelect(templateId, editorId, subjectInputId) {
    if (!templateId) return;

    try {
      const result = await window.Core.api('getEmailTemplate', { id: templateId }, 'POST');
      if (!result.success || !result.template) {
        window.UI.toast.error(result.message || 'فشل تحميل القالب');
        return;
      }

      const tpl = result.template;
      window.EmailEditor.setHtml(editorId, tpl.body_html || '');

      const subjInput = document.getElementById(subjectInputId);
      if (subjInput && tpl.subject) subjInput.value = tpl.subject;

      window.UI.toast.success('تم تحميل القالب: ' + tpl.name);
    } catch (e) {
      window.UI.toast.error('تعذر تحميل القالب');
    }
  }

  async function loadTemplatesList() {
    const container = document.getElementById('templates_container');
    if (!container) return;

    container.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i><p>جاري التحميل...</p></div>';

    try {
      const result = await window.Core.api('getEmailTemplatesList', {}, 'POST');
      if (!result.success || !result.list || result.list.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-file-alt"></i><p>لا توجد قوالب — اضغط "قالب جديد"</p></div>';
        return;
      }

      state.templates = result.list;
      renderTemplateDropdowns();

      const categories = {
        general: 'عام',
        welcome: 'ترحيب',
        promotion: 'عرض',
        announcement: 'إعلان',
        expiry_reminder: 'تنبيه',
        security_alert: 'أمني',
        report: 'تقرير'
      };

      let html = '<div class="templates-grid">';
      result.list.forEach(function(t) {
        const catLabel = categories[t.category] || t.category;
        html += '<div class="template-card">' +
          '<div class="template-card-header">' +
            '<span class="template-card-name">' + escapeHtml(t.name) + '</span>' +
            '<span class="template-card-cat">' + escapeHtml(catLabel) + '</span>' +
          '</div>' +
          (t.subject ? '<div class="template-card-subject">' + escapeHtml(t.subject) + '</div>' : '') +
          '<div class="template-card-actions">' +
            '<button class="btn btn-secondary btn-xs tpl-edit" data-id="' + t.id + '"><i class="fas fa-edit"></i> تعديل</button>' +
            '<button class="btn btn-danger btn-xs tpl-delete" data-id="' + t.id + '"><i class="fas fa-trash"></i> حذف</button>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';
      container.innerHTML = html;

      container.querySelectorAll('.tpl-edit').forEach(function(btn) {
        btn.addEventListener('click', function() {
          openTemplateModal(parseInt(this.getAttribute('data-id'), 10));
        });
      });
      container.querySelectorAll('.tpl-delete').forEach(function(btn) {
        btn.addEventListener('click', function() {
          deleteTemplate(parseInt(this.getAttribute('data-id'), 10));
        });
      });

    } catch (e) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>تعذر التحميل</p></div>';
    }
  }

  async function openTemplateModal(templateId) {
    state.editingTemplateId = templateId || null;

    // Reset
    document.getElementById('templateModalTitle').textContent = templateId ? 'تعديل القالب' : 'قالب جديد';
    document.getElementById('tpl_name').value = '';
    document.getElementById('tpl_category').value = 'general';
    document.getElementById('tpl_subject').value = '';
    window.EmailEditor.clear('tpl_editor');

    window.UI.modal.open('templateModal');

    if (templateId) {
      try {
        const result = await window.Core.api('getEmailTemplate', { id: templateId }, 'POST');
        if (result.success && result.template) {
          const t = result.template;
          document.getElementById('tpl_name').value = t.name || '';
          document.getElementById('tpl_category').value = t.category || 'general';
          document.getElementById('tpl_subject').value = t.subject || '';
          window.EmailEditor.setHtml('tpl_editor', t.body_html || '');
        }
      } catch (e) {
        window.UI.toast.error('تعذر تحميل القالب');
      }
    }
  }

  function closeTemplateModal() {
    window.UI.modal.close('templateModal');
    state.editingTemplateId = null;
  }

  async function saveTemplate() {
    const name = document.getElementById('tpl_name').value.trim();
    const category = document.getElementById('tpl_category').value;
    const subject = document.getElementById('tpl_subject').value.trim();
    const bodyHtml = window.EmailEditor.getHtml('tpl_editor');

    if (!name) return window.UI.toast.error('اسم القالب مطلوب');
    if (!bodyHtml) return window.UI.toast.error('محتوى القالب مطلوب');

    const btn = document.getElementById('saveTemplateBtn');
    window.UI.setLoading(btn, true, 'جاري الحفظ...');

    try {
      let result;
      if (state.editingTemplateId) {
        result = await window.Core.api('updateEmailTemplate', {
          id: state.editingTemplateId,
          updates: { name, category, subject, bodyHtml }
        }, 'POST');
      } else {
        result = await window.Core.api('createEmailTemplate', {
          name, category, subject, bodyHtml
        }, 'POST');
      }

      if (result.success) {
        window.UI.toast.success(result.message || 'تم الحفظ');
        closeTemplateModal();
        await loadTemplatesList();
        await loadTemplatesDropdown();
      } else {
        window.UI.toast.error(result.message || result.error || 'فشل الحفظ');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الحفظ');
    } finally {
      window.UI.setLoading(btn, false);
    }
  }

  async function deleteTemplate(id) {
    const ok = await window.UI.confirm({
      title: 'حذف القالب',
      message: 'هل تريد حذف هذا القالب نهائيًا؟',
      confirmText: 'حذف',
      type: 'danger'
    });
    if (!ok) return;

    try {
      const result = await window.Core.api('deleteEmailTemplate', { id: id }, 'POST');
      if (result.success) {
        window.UI.toast.success('تم الحذف');
        await loadTemplatesList();
        await loadTemplatesDropdown();
      } else {
        window.UI.toast.error(result.message || result.error || 'فشل الحذف');
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر الحذف');
    }
  }

  // ============================================================
  //  📊 Campaigns
  // ============================================================
  async function loadCampaigns() {
    const container = document.getElementById('campaigns_container');
    if (!container) return;

    container.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i><p>جاري التحميل...</p></div>';

    try {
      const result = await window.Core.api('getCampaignsList', { page: 1, pageSize: 50 }, 'GET');
      if (!result.success || !result.list || result.list.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>لا توجد حملات بعد</p></div>';
        return;
      }

      const typeLabels = { children: 'الأطفال', marketers: 'المسوقون', newsletter: 'المشتركون', custom: 'قائمة مخصصة' };
      const statusLabels = {
        pending: 'قيد الإرسال', sending: 'جاري الإرسال',
        partially_sent: 'أُرسل جزئيًا', sent: 'تم الإرسال', cancelled: 'ملغى'
      };

      let html = '<div class="campaigns-table-wrapper"><table class="campaigns-table"><thead><tr>' +
        '<th>#</th><th>الموضوع</th><th>النوع</th><th>الإجمالي</th>' +
        '<th>فوري</th><th>مؤجل</th><th>الحالة</th><th>التاريخ</th>' +
        '</tr></thead><tbody>';

      result.list.forEach(function(c, i) {
        const typeLabel = typeLabels[c.recipient_type] || c.recipient_type;
        const statusLabel = statusLabels[c.status] || c.status;
        const statusCls = c.status === 'sent' ? 'badge-success'
                        : c.status === 'partially_sent' ? 'badge-warning'
                        : c.status === 'cancelled' ? 'badge-muted' : 'badge-info';

        html += '<tr>' +
          '<td class="cell-num">' + (i + 1) + '</td>' +
          '<td class="cell-subject" title="' + escapeAttr(c.subject) + '">' + window.UI.escapeHtml(c.subject || '—') + '</td>' +
          '<td>' + window.UI.escapeHtml(typeLabel) + '</td>' +
          '<td class="cell-num">' + (c.recipient_count || 0) + '</td>' +
          '<td class="cell-num">' + (c.immediate_count || 0) + '</td>' +
          '<td class="cell-num">' + (c.queued_count || 0) + '</td>' +
          '<td><span class="badge ' + statusCls + '">' + statusLabel + '</span></td>' +
          '<td class="cell-date">' + formatDateTime(c.created_at) + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
      container.innerHTML = html;
    } catch (e) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>تعذر التحميل</p></div>';
    }
  }

  // ============================================================
  //  🕐 Queue
  // ============================================================
  function bindQueueReload() {
    const btn = document.getElementById('reload_queue_btn');
    if (btn) btn.addEventListener('click', loadQueueStats);
  }

  async function loadQueueStats() {
    try {
      const result = await window.Core.api('getQueueStats', {}, 'GET');
      if (!result.success) return;

      document.getElementById('queue_pending').textContent = formatNumber(result.pending);
      document.getElementById('queue_sent').textContent = formatNumber(result.sent);
      document.getElementById('queue_failed').textContent = formatNumber(result.failed);

      const nextEl = document.getElementById('queue_next');
      if (result.nextScheduled) {
        nextEl.textContent = 'القادم: ' + formatDateTime(result.nextScheduled);
      } else {
        nextEl.textContent = '';
      }
    } catch (e) {
      window.UI.toast.error(e.userMessage || 'تعذر التحميل');
    }
  }

  // ============================================================
  //  🛠️ Helpers
  // ============================================================
  function showMsg(el, type, text) {
    if (!el) return;
    el.className = 'fd-message ' + type + ' show';
    const iconClass = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';
    el.innerHTML = '<i class="fas ' + iconClass + '"></i><span>' + window.UI.escapeHtml(text) + '</span>';
  }

  function hideMsg(el) {
    if (el) el.classList.remove('show');
  }

  function formatNumber(n) {
    if (typeof n !== 'number') return '—';
    return n.toLocaleString('ar-EG');
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
  window.EmailsPage = {
    init: init,
    reload: reload,
    openButtonModal: openButtonModal
  };

})();