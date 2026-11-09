// ================================================================
//  admin/js/email-editor.js — Quill Wrapper + Upload + CTA Buttons
//  - محررات Quill RTL
//  - صور داخلية + مرفقات
//  - أزرار CTA (links → buttons)
//  - Tooltips على كل أدوات Quill
// ================================================================

(function() {
  'use strict';

  const editors = {};
  const attachments = {};

  // ============================================================
  //  🛠️ TOOLBAR_OPTIONS
  // ============================================================
  const TOOLBAR_OPTIONS = [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ color: [] }, { background: [] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    [{ align: [] }],
    ['blockquote'],
    ['link', 'image'],
    ['clean']
  ];

  // ============================================================
  //  🏷️ TOOLBAR_TITLES — خريطة العناوين
  // ============================================================
  const TOOLBAR_TITLES = {
    'ql-bold': 'عريض (Bold) — Ctrl+B',
    'ql-italic': 'مائل (Italic) — Ctrl+I',
    'ql-underline': 'تسطير (Underline) — Ctrl+U',
    'ql-strike': 'يتوسطه خط (Strikethrough)',
    'ql-blockquote': 'اقتباس (Blockquote)',
    'ql-link': 'إدراج رابط (Link)',
    'ql-image': 'إدراج صورة (Insert Image)',
    'ql-clean': 'إزالة التنسيق (Clear Formatting)',
    'ql-list': 'قائمة (List)',
    'ql-header': 'عنوان (Header)',
    'ql-align': 'محاذاة (Alignment)',
    'ql-color': 'لون النص (Text Color)',
    'ql-background': 'لون الخلفية (Background Color)',
    'ql-size': 'حجم الخط (Font Size)',
    'ql-script': 'نص علوي/سفلي (Script)',
    'ql-indent': 'إزاحة (Indent)',
    'ql-direction': 'اتجاه النص (Direction)',
    'ql-font': 'نوع الخط (Font)'
  };

  // عناوين القيم المتعددة
  const VALUE_LABELS = {
    '1': '1', '2': '2', '3': '3', 'false': 'عادي',
    'ordered': 'مرقمة', 'bullet': 'نقطية',
    '': 'افتراضي',
    'center': 'وسط', 'right': 'يسار', 'justify': 'ضبط',
    'true': 'علوي', 'false': 'سفلي',
    '+1': 'زيادة', '-1': 'تقليل',
    'rtl': 'RTL', 'ltr': 'LTR'
  };

  // ============================================================
  //  🎯 registerEmailButtonBlot — تسجيل Custom Blot للزر
  // ============================================================
  let blotRegistered = false;

  function registerEmailButtonBlot() {
    if (blotRegistered) return;
    if (!window.Quill) return;

    try {
      const BlockEmbed = Quill.import('blots/block/embed');

      class EmailButtonBlot extends BlockEmbed {
        static create(value) {
          const node = super.create();
          node.setAttribute('data-email-button', '1');

          const wrapper = document.createElement('div');
          wrapper.style.textAlign = 'center';
          wrapper.style.margin = '12px 0';

          const a = document.createElement('a');
          a.className = 'email-cta email-cta-' + (value.color || 'primary');
          a.href = value.url || '#';
          a.textContent = value.text || 'زر';
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener');
          a.setAttribute('contenteditable', 'false');

          wrapper.appendChild(a);
          node.appendChild(wrapper);
          return node;
        }

        static value(node) {
          const a = node.querySelector('a');
          if (!a) return { url: '#', text: 'زر', color: 'primary' };
          const cls = a.className || '';
          let color = 'primary';
          if (cls.includes('email-cta-success')) color = 'success';
          else if (cls.includes('email-cta-warning')) color = 'warning';
          else if (cls.includes('email-cta-danger')) color = 'danger';
          return {
            url: a.getAttribute('href') || '#',
            text: a.textContent || '',
            color: color
          };
        }
      }

      EmailButtonBlot.blotName = 'emailButton';
      EmailButtonBlot.tagName = 'div';
      EmailButtonBlot.className = 'ql-email-button';

      Quill.register(EmailButtonBlot);
      blotRegistered = true;
      console.log('✅ [EmailEditor] EmailButtonBlot مسجل');
    } catch (e) {
      console.warn('[EmailEditor] registerEmailButtonBlot:', e.message);
    }
  }

  // ============================================================
  //  🎨 create — إنشاء محرر Quill
  // ============================================================
  function create(containerId, options) {
    options = options || {};
    const container = document.getElementById(containerId);
    if (!container) {
      console.warn('[EmailEditor] container not found:', containerId);
      return null;
    }

    if (editors[containerId]) return editors[containerId];

    registerEmailButtonBlot();

    const quill = new Quill(container, {
      theme: 'snow',
      placeholder: options.placeholder || 'اكتب محتوى الرسالة هنا...',
      modules: {
        toolbar: options.toolbar || TOOLBAR_OPTIONS
      }
    });

    // RTL
    quill.root.setAttribute('dir', 'rtl');
    quill.root.style.textAlign = 'right';
    quill.root.style.fontFamily = 'IBM Plex Sans Arabic, Segoe UI, Arial, sans-serif';
    quill.root.style.fontSize = '14px';
    quill.root.style.minHeight = '160px';

    editors[containerId] = quill;

    // Custom image handler
    const toolbar = quill.getModule('toolbar');
    if (toolbar) {
      toolbar.addHandler('image', function() {
        openImagePicker(containerId);
      });

      // ✅ إضافة زر CTA مخصص في الـ toolbar
      injectCtaButton(toolbar, containerId);

      // ✅ إضافة tooltips
      setTimeout(function() {
        applyToolbarTitles(quill);
      }, 50);
    }

    return quill;
  }

  // ============================================================
  //  🔗 injectCtaButton — زر "إدراج زر" في الـ toolbar
  // ============================================================
  function injectCtaButton(toolbar, containerId) {
    try {
      const tbEl = toolbar.container;
      if (!tbEl) return;
      if (tbEl.querySelector('.ql-cta-trigger')) return;

      // مجموعة جديدة
      const formats = document.createElement('span');
      formats.className = 'ql-formats';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ql-cta-trigger';
      btn.title = 'إدراج زر برابط مخصص (CTA)';
      btn.innerHTML = '<svg viewBox="0 0 18 18" width="18" height="18" style="fill:none;stroke:currentColor;stroke-width:2;"><rect x="2" y="6" width="14" height="7" rx="2"/><line x1="6" y1="9.5" x2="12" y2="9.5"/></svg>';

      btn.addEventListener('click', function(e) {
        e.preventDefault();
        if (window.EmailsPage && typeof window.EmailsPage.openButtonModal === 'function') {
          window.EmailsPage.openButtonModal(containerId);
        } else {
          console.warn('[EmailEditor] EmailsPage.openButtonModal غير متوفر');
        }
      });

      formats.appendChild(btn);
      tbEl.appendChild(formats);
    } catch (e) {
      console.warn('[EmailEditor] injectCtaButton:', e.message);
    }
  }

  // ============================================================
  //  🏷️ applyToolbarTitles — إضافة title لكل أزرار Quill
  // ============================================================
  function applyToolbarTitles(quill) {
    try {
      const toolbar = quill.getModule('toolbar');
      if (!toolbar || !toolbar.container) return;

      const tbEl = toolbar.container;

      // 1. أزرار فردية (button)
      tbEl.querySelectorAll('button').forEach(function(el) {
        if (el.title) return; // موجود بالفعل

        // حاول من aria-label
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) {
          el.title = ariaLabel;
          return;
        }

        // fallback من class
        const cls = Array.from(el.classList).find(c => TOOLBAR_TITLES[c]);
        if (cls) {
          let label = TOOLBAR_TITLES[cls];
          const value = el.getAttribute('value');
          if (value !== null && VALUE_LABELS[value] !== undefined) {
            label += ' — ' + VALUE_LABELS[value];
          }
          el.title = label;
        }
      });

      // 2. Pickers (dropdowns) — header, align, color, background
      tbEl.querySelectorAll('.ql-picker').forEach(function(el) {
        const cls = Array.from(el.classList).find(c => TOOLBAR_TITLES[c]);
        if (!cls) return;

        const label = TOOLBAR_TITLES[cls];
        el.title = label;

        const pickerLabel = el.querySelector('.ql-picker-label');
        if (pickerLabel && !pickerLabel.title) pickerLabel.title = label;
      });

      // 3. عناصر select (احتياطي)
      tbEl.querySelectorAll('select').forEach(function(el) {
        const cls = Array.from(el.classList).find(c => TOOLBAR_TITLES[c]);
        if (cls && !el.title) el.title = TOOLBAR_TITLES[cls];
      });

    } catch (e) {
      console.warn('[EmailEditor] applyToolbarTitles:', e.message);
    }
  }

  // ============================================================
  //  🖼️ openImagePicker
  // ============================================================
  function openImagePicker(containerId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';

    input.onchange = async function(e) {
      const file = e.target.files[0];
      if (!file) return;

      if (file.size > 4 * 1024 * 1024) {
        if (window.UI) window.UI.toast.error('حجم الصورة يتجاوز 4 ميجابايت');
        return;
      }

      if (window.UI) window.UI.toast.info('جاري رفع الصورة...');

      try {
        const result = await uploadFile(file);
        if (!result.success) {
          if (window.UI) window.UI.toast.error(result.message || 'فشل رفع الصورة');
          return;
        }

        const quill = editors[containerId];
        if (!quill) return;

        const range = quill.getSelection(true) || { index: quill.getLength() };
        quill.insertEmbed(range.index, 'image', result.url, 'user');
        quill.setSelection(range.index + 1, 0);

        if (window.UI) window.UI.toast.success('تم إدراج الصورة');
      } catch (e) {
        console.error('[EmailEditor] image upload:', e);
        if (window.UI) window.UI.toast.error('تعذر رفع الصورة');
      }
    };

    input.click();
  }

  // ============================================================
  //  📤 uploadFile
  // ============================================================
  async function uploadFile(file) {
    return new Promise(function(resolve, reject) {
      const reader = new FileReader();
      reader.onload = async function(ev) {
        try {
          const result = await window.Core.api('uploadEmailAsset', {
            base64: ev.target.result,
            fileName: file.name,
            mimeType: file.type
          }, 'POST');
          resolve(result);
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = function() { reject(new Error('read_error')); };
      reader.readAsDataURL(file);
    });
  }

  // ============================================================
  //  📄 getHtml — يحوّل emailButton blots لـ inline HTML
  // ============================================================
  function getHtml(containerId) {
    const q = editors[containerId];
    if (!q) return '';

    let html = q.root.innerHTML || '';
    if (html === '<p><br></p>' || html === '<p></p>') return '';

    // تحويل blots لأزرار email-friendly
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    const buttonBlocks = tempDiv.querySelectorAll('.ql-email-button');
    buttonBlocks.forEach(function(block) {
      const a = block.querySelector('a');
      if (!a) { block.remove(); return; }

      const url = a.getAttribute('href') || '#';
      const text = a.textContent || 'زر';
      const cls = a.className || '';
      let color = '#22559F';
      if (cls.includes('email-cta-success')) color = '#10B981';
      else if (cls.includes('email-cta-warning')) color = '#F59E0B';
      else if (cls.includes('email-cta-danger')) color = '#DC2626';

      const inlineHtml = '<div style="text-align:center;margin:16px 0;"><a href="' + escapeAttr(url) + '" target="_blank" rel="noopener" style="display:inline-block;padding:12px 28px;background:' + color + ';color:#FFFFFF;text-decoration:none;border-radius:30px;font-weight:900;font-size:14px;text-align:center;">' + escapeHtml(text) + '</a></div>';

      const wrapper = document.createElement('div');
      wrapper.innerHTML = inlineHtml;
      block.replaceWith(wrapper.firstChild);
    });

    return tempDiv.innerHTML;
  }

  // ============================================================
  //  📥 setHtml — يحلّل HTML ويحوّل أزرار CTA لـ blots
  //  الخطوات:
  //    1. استخراج الأزرار من HTML → markers [[CTA:base64]]
  //    2. dangerouslyPasteHTML (يحفظ الـ markers كنص عادي)
  //    3. تحويل markers لـ emailButton blots
  // ============================================================
  function setHtml(containerId, html) {
    const q = editors[containerId];
    if (!q) return;

    if (!html) {
      q.root.innerHTML = '';
      return;
    }

    // 1. حلّل HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // 2. استخرج أزرار CTA
    const ctaElements = [];
    tempDiv.querySelectorAll('div').forEach(function(div) {
      const divStyle = div.getAttribute('style') || '';
      const isCenter = /text-align\s*:\s*center/.test(divStyle);
      if (!isCenter) return;

      const a = div.querySelector('a');
      if (!a) return;

      const aStyle = a.getAttribute('style') || '';
      const isButton =
        /border-radius\s*:\s*\d+px/.test(aStyle) &&
        /display\s*:\s*inline-block/.test(aStyle);
      if (!isButton) return;

      let color = 'primary';
      if (/#10B981/i.test(aStyle)) color = 'success';
      else if (/#F59E0B/i.test(aStyle)) color = 'warning';
      else if (/#DC2626/i.test(aStyle)) color = 'danger';

      ctaElements.push({
        div: div,
        value: {
          text: a.textContent || 'زر',
          url: a.getAttribute('href') || '#',
          color: color
        }
      });
    });

    // 3. استبدل بـ markers
    ctaElements.forEach(function(cta) {
      const encoded = btoa(encodeURIComponent(JSON.stringify(cta.value)));
      const p = document.createElement('p');
      p.textContent = '[[CTA:' + encoded + ']]';
      cta.div.replaceWith(p);
    });

    // 4. Paste — dangerouslyPasteHTML بيحفظ الـ markers كنص
    try {
      q.clipboard.dangerouslyPasteHTML(tempDiv.innerHTML);
    } catch (e) {
      console.warn('[setHtml] dangerouslyPasteHTML failed:', e);
      q.root.innerHTML = tempDiv.innerHTML;
    }

    // 5. Force sync
    try { q.update('user'); } catch (e) {}

    // 6. حوّل markers لـ emailButton blots
    setTimeout(function() {
      const ps = Array.from(q.root.querySelectorAll('p'));

      ps.forEach(function(p) {
        const text = p.textContent.trim();
        if (!text.startsWith('[[CTA:')) return;
        if (!text.endsWith(']]')) return;

        const inner = text.substring(6, text.length - 2);

        try {
          const decoded = decodeURIComponent(atob(inner));
          const value = JSON.parse(decoded);

          const blot = Quill.find(p);
          if (!blot) return;

          const index = q.getIndex(blot);
          if (index < 0) return;

          const length = p.textContent.length;
          q.deleteText(index, length, 'user');
          q.insertEmbed(index, 'emailButton', value, 'user');
        } catch (e) {
          console.warn('[setHtml] marker convert failed:', e);
        }
      });
    }, 80);
  }

  function clear(containerId) {
    setHtml(containerId, '');
  }

  // ============================================================
  //  🔗 insertEmailButton — تُستدعى من emails.js
  // ============================================================
  function insertEmailButton(containerId, value) {
    const quill = editors[containerId];
    if (!quill) return false;
    if (!blotRegistered) registerEmailButtonBlot();

    try {
      const range = quill.getSelection(true) || { index: quill.getLength() };
      quill.insertEmbed(range.index, 'emailButton', {
        text: value.text,
        url: value.url,
        color: value.color
      }, 'user');
      quill.setSelection(range.index + 1, 0);
      return true;
    } catch (e) {
      console.error('[EmailEditor] insertEmailButton:', e.message);
      return false;
    }
  }

  // ============================================================
  //  📎 إدارة المرفقات
  // ============================================================
  function getAttachments(key) {
    return Array.isArray(attachments[key]) ? attachments[key].slice() : [];
  }
  function addAttachment(key, item) {
    if (!attachments[key]) attachments[key] = [];
    attachments[key].push(item);
    return attachments[key];
  }
  function removeAttachment(key, index) {
    if (!attachments[key]) return [];
    attachments[key].splice(index, 1);
    return attachments[key];
  }
  function clearAttachments(key) {
    attachments[key] = [];
  }
  function getAttachmentsCount(key) {
    return attachments[key] ? attachments[key].length : 0;
  }
  function getAttachmentsTotalBytes(key) {
    if (!attachments[key]) return 0;
    return attachments[key].reduce(function(sum, a) {
      return sum + (parseInt(a.size, 10) || 0);
    }, 0);
  }

  // ============================================================
  //  🛠️ Helpers
  // ============================================================
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
  //  🌐 Export
  // ============================================================
  window.EmailEditor = {
    create: create,
    getHtml: getHtml,
    setHtml: setHtml,
    clear: clear,
    insertEmailButton: insertEmailButton,
    getAttachments: getAttachments,
    addAttachment: addAttachment,
    removeAttachment: removeAttachment,
    clearAttachments: clearAttachments,
    getAttachmentsCount: getAttachmentsCount,
    getAttachmentsTotalBytes: getAttachmentsTotalBytes,
    uploadFile: uploadFile
  };

  console.log('✅ [EmailEditor] جاهز');
})();