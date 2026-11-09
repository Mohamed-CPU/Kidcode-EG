// ================================================================
//  family-dashboard-contact.js - تبويب "اتصل بنا"
//  - فورم تواصل (Subject + Message)
//  - إرسال عبر /api?action=contact
//  - Rate limiting (60 ثانية بين كل رسالة)
// ================================================================

(function() {
    'use strict';

    // ============================================================
    //  Constants
    // ============================================================
    const API_ENDPOINT = '/api?action=contact';
    const RATE_LIMIT_KEY = 'family_contact_last_submit';
    const RATE_LIMIT_MS = 60 * 1000; // 60 ثانية
    const MAX_CHARS = 1500;

    // ============================================================
    //  State
    // ============================================================
    const state = {
        isInitialized: false,
        isSending: false
    };

    // ============================================================
    //  DOM References
    // ============================================================
    const els = {
        email: document.getElementById('fdContactEmail'),
        emailHint: document.getElementById('fdContactEmailHint'),
        emailError: document.getElementById('fdContactEmailError'),
        subject: document.getElementById('fdContactSubject'),
        subjectError: document.getElementById('fdContactSubjectError'),
        message: document.getElementById('fdContactMessage'),
        messageError: document.getElementById('fdContactMessageError'),
        charCount: document.getElementById('fdContactCharCount'),
        sendBtn: document.getElementById('sendContactBtn'),
        formMessage: document.getElementById('contactFormMessage')
    };

    // ============================================================
    //  Helpers
    // ============================================================
    function getFD() { return window.FD; }
    function getChildID() {
        return (getFD() && getFD().getChildID && getFD().getChildID()) || '';
    }
    function getSession() {
        return (getFD() && getFD().getSession && getFD().getSession()) || '';
    }
    function showLoader(show) {
        if (getFD() && getFD().showLoader) getFD().showLoader(show);
    }

    function showMessage(el, type, text) {
        if (!el) return;
        const iconClass = {
            success: 'fa-circle-check',
            error: 'fa-circle-exclamation',
            info: 'fa-circle-info',
            warning: 'fa-triangle-exclamation'
        }[type] || 'fa-circle-info';

        el.className = 'fd-message ' + type + ' show';
        el.innerHTML = '<i class="fas ' + iconClass + '"></i><span>' + text + '</span>';
    }

    function hideMessage(el) {
        if (el) el.classList.remove('show');
    }

    function showFieldError(el, message) {
        if (!el) return;
        el.textContent = message;
        el.classList.add('show');
    }

    function hideFieldError(el) {
        if (el) el.classList.remove('show');
    }

    // ============================================================
    //  Populate Email Field (from childData)
    // ============================================================
    function populateEmailField() {
        if (!els.email) return;

        const childData = (getFD().getState && getFD().getState().childData) || {};
        const email = (childData.email || '').trim();

        if (email) {
            els.email.value = email;
            els.email.placeholder = '';
            els.email.parentElement.classList.remove('empty');

            if (els.emailHint) {
                els.emailHint.innerHTML = '📧 البريد المسجل لحسابك. سيتم الرد عليه';
                els.emailHint.style.color = '';
            }
            hideFieldError(els.emailError);
        } else {
            // بريد فاضي → تحذير
            els.email.value = 'لا يوجد بريد مسجل';
            els.email.parentElement.classList.add('empty');

            if (els.emailHint) {
                els.emailHint.innerHTML = '⚠️ تواصل مع الدعم عبر أحد القنوات أعلاه لإضافة بريد إلكتروني.';
                els.emailHint.style.color = '#92400E';
            }
        }

        // تحديث حالة زر الإرسال
        updateSendButtonState();
    }

    // ============================================================
    //  Update Send Button State
    // ============================================================
    function updateSendButtonState() {
        if (!els.sendBtn) return;

        const childData = (getFD().getState && getFD().getState().childData) || {};
        const email = (childData.email || '').trim();

        if (!email) {
            els.sendBtn.disabled = true;
            els.sendBtn.title = 'يجب إضافة بريد لحسابك أولاً';
        } else {
            els.sendBtn.disabled = state.isSending;
            els.sendBtn.title = '';
        }
    }

    // ============================================================
    //  Char Counter
    // ============================================================
    function updateCharCounter() {
        if (!els.charCount || !els.message) return;

        const len = els.message.value.length;
        els.charCount.textContent = len;

        const parent = els.charCount.parentElement;
        parent.classList.remove('warning', 'danger');

        if (len > MAX_CHARS * 0.9) {
            parent.classList.add('danger');
        } else if (len > MAX_CHARS * 0.75) {
            parent.classList.add('warning');
        }
    }

    // ============================================================
    //  Rate Limiting
    // ============================================================
    function checkRateLimit() {
        try {
            const last = parseInt(sessionStorage.getItem(RATE_LIMIT_KEY) || '0', 10);
            const elapsed = Date.now() - last;

            if (elapsed < RATE_LIMIT_MS) {
                const remaining = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000);
                return { blocked: true, remaining: remaining };
            }
        } catch (e) {}
        return { blocked: false, remaining: 0 };
    }

    function markSubmitTime() {
        try {
            sessionStorage.setItem(RATE_LIMIT_KEY, String(Date.now()));
        } catch (e) {}
    }

    // ============================================================
    //  Validation
    // ============================================================
        function validateForm() {
        hideFieldError(els.emailError);
        hideFieldError(els.subjectError);
        hideFieldError(els.messageError);

        let valid = true;

        // Email check
        const childData = (getFD().getState && getFD().getState().childData) || {};
        const email = (childData.email || '').trim();
        if (!email) {
            showFieldError(els.emailError, '⚠️ لا يوجد بريد مسجل. تواصل مع الدعم.');
            valid = false;
        }

        const subject = (els.subject.value || '').trim();
        const message = (els.message.value || '').trim();

        if (!subject) {
            showFieldError(els.subjectError, '📋 يرجى اختيار الموضوع');
            valid = false;
        }

        if (!message) {
            showFieldError(els.messageError, '✉️ تفاصيل الرسالة مطلوبة');
            valid = false;
        } else if (message.length < 10) {
            showFieldError(els.messageError, '📝 الرسالة قصيرة جداً (10 أحرف على الأقل)');
            valid = false;
        } else if (message.length > MAX_CHARS) {
            showFieldError(els.messageError, '📝 الرسالة طويلة جداً (الحد الأقصى ' + MAX_CHARS + ' حرف)');
            valid = false;
        }

        return valid;
    }

    // ============================================================
    //  Send Message
    // ============================================================
    async function handleSendMessage() {
        if (state.isSending) return;

        hideMessage(els.formMessage);

        // Rate limit
        const rl = checkRateLimit();
        if (rl.blocked) {
            showMessage(els.formMessage, 'warning',
                '⏱️ يرجى الانتظار ' + rl.remaining + ' ثانية قبل إرسال رسالة أخرى.');
            return;
        }

        // Validation
        if (!validateForm()) {
            showMessage(els.formMessage, 'error', '❌ يرجى مراجعة الأخطاء أعلاه');
            return;
        }

        state.isSending = true;
        els.sendBtn.disabled = true;
        showLoader(true);

        try {
            // Build payload
            const childData = (getFD().getState && getFD().getState().childData) || {};
            const childID = getChildID();

            const parentLabel = 'ولي أمر الطفل ' + childID +
                                (childData.childName ? ' (' + childData.childName + ')' : '');

            const payload = {
                name: parentLabel,
                email: childData.email || '',
                phone: '',
                subject: els.subject.value.trim(),
                message: els.message.value.trim() +
                         '\n\n---\nكود الطفل: ' + childID
            };

            const response = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            console.log('📩 contact:', result);

            if (result.success) {
                markSubmitTime();

                showMessage(els.formMessage, 'success',
                    '✅ تم إرسال رسالتك بنجاح. سنتواصل معك قريباً.');

                // Reset form
                els.subject.value = '';
                els.message.value = '';
                updateCharCounter();
                hideFieldError(els.subjectError);
                hideFieldError(els.messageError);

                // Auto-hide success after 8 seconds
                setTimeout(function() {
                    hideMessage(els.formMessage);
                }, 8000);
            } else {
                // Handle specific errors
                const err = (result.error || '').toLowerCase();

                if (err.indexOf('انتظار') !== -1) {
                    showMessage(els.formMessage, 'warning', '⏱️ ' + result.error);
                } else {
                    showMessage(els.formMessage, 'error',
                        '❌ ' + (result.error || 'فشل إرسال الرسالة'));
                }
            }

        } catch (err) {
            console.error('❌ handleSendMessage error:', err);
            showMessage(els.formMessage, 'error', 'تعذر الاتصال بالخادم. حاول مرة أخرى.');
        } finally {
            state.isSending = false;
            els.sendBtn.disabled = false;
            showLoader(false);
        }
    }

    // ============================================================
    //  Event Binding
    // ============================================================
    function bindEvents() {
        // Subject change
        if (els.subject) {
            els.subject.addEventListener('change', function() {
                hideFieldError(els.subjectError);
            });
        }

        // Message input (char counter + clear error)
        if (els.message) {
            els.message.addEventListener('input', function() {
                updateCharCounter();
                hideFieldError(els.messageError);
            });

            // Enter (Ctrl+Enter) to submit
            els.message.addEventListener('keydown', function(e) {
                if (e.ctrlKey && e.key === 'Enter') {
                    e.preventDefault();
                    handleSendMessage();
                }
            });
        }

        // Send button
        if (els.sendBtn) {
            els.sendBtn.addEventListener('click', handleSendMessage);
        }
    }

    // ============================================================
    //  Tab Activation
    // ============================================================
    const originalOnTabActivate = window.onTabActivate;

    window.onTabActivate = function(tabName, data) {
        if (typeof originalOnTabActivate === 'function') {
            originalOnTabActivate(tabName, data);
        }

        if (tabName !== 'contact') return;

        if (!state.isInitialized) {
            state.isInitialized = true;
            bindEvents();
            updateCharCounter();
        }

        // ✅ تعبئة البريد من البيانات + تحديث حالة الزر
        populateEmailField();

        // Clear form messages on each activation
        hideMessage(els.formMessage);
    };

    console.log('✅ family-dashboard-contact.js loaded');

})();