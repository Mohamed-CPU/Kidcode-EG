// ================================================================
//  contact.js - منطق نموذج التواصل
//  - Validation على الـ client
//  - إرسال عبر Vercel proxy → GAS
//  - Rate limiting بسيط
// ================================================================

(function() {
    'use strict';

    // ============================================================
    //  Constants
    // ============================================================
    const FORM_ID = 'contactFormEl';
    const SUBMIT_BTN_ID = 'submitContactBtn';
    const SUCCESS_MSG_ID = 'contactSuccessMsg';
    const ERROR_MSG_ID = 'contactErrorMsg';
    const API_ENDPOINT = '/api?action=contact';

    // Rate limiting: محاولة واحدة كل 60 ثانية
    const RATE_LIMIT_MS = 60 * 1000;
    const LAST_SUBMIT_KEY = 'kc_contact_last_submit';

    // ============================================================
    //  Validation Rules
    // ============================================================
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    const PHONE_REGEX = /^[\d\s+\-()]{7,20}$/;
    const ARABIC_OR_LATIN_NAME = /^[\u0600-\u06FFa-zA-Z\s]{2,60}$/;

    // ============================================================
    //  DOM References
    // ============================================================
    const form = document.getElementById(FORM_ID);
    if (!form) {
        console.warn('⚠️ [contact.js] form not found');
        return;
    }

    const submitBtn = document.getElementById(SUBMIT_BTN_ID);
    const successMsg = document.getElementById(SUCCESS_MSG_ID);
    const errorMsg = document.getElementById(ERROR_MSG_ID);

    const fields = {
        name: document.getElementById('contactName'),
        email: document.getElementById('contactEmail'),
        phone: document.getElementById('contactPhone'),
        subject: document.getElementById('contactSubject'),
        message: document.getElementById('contactMessage'),
        agree: document.getElementById('contactAgree')
    };

    // ============================================================
    //  Error Helpers
    // ============================================================
    function showFieldError(fieldName, errorText) {
        const errorEl = document.getElementById('contact' + capitalize(fieldName) + 'Error');
        if (!errorEl) return;

        errorEl.textContent = errorText;
        errorEl.classList.add('show');

        // إضافة كلاس error على الحقل نفسه
        if (fields[fieldName] && fields[fieldName].tagName !== 'INPUT' || fieldName !== 'agree') {
            if (fields[fieldName]) fields[fieldName].classList.add('error');
        }
    }

    function hideFieldError(fieldName) {
        const errorEl = document.getElementById('contact' + capitalize(fieldName) + 'Error');
        if (errorEl) {
            errorEl.textContent = '';
            errorEl.classList.remove('show');
        }
        if (fields[fieldName]) fields[fieldName].classList.remove('error');
    }

    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function hideAllErrors() {
        ['name', 'email', 'phone', 'subject', 'message', 'agree'].forEach(hideFieldError);
    }

    // ============================================================
    //  Validators
    // ============================================================
    function validateName() {
        const value = (fields.name.value || '').trim();
        if (!value) return 'الاسم مطلوب';
        if (value.length < 2) return 'الاسم قصير جداً';
        if (value.length > 60) return 'الاسم طويل جداً';
        return null;
    }

    function validateEmail() {
        const value = (fields.email.value || '').trim();
        if (!value) return 'البريد الإلكتروني مطلوب';
        if (!EMAIL_REGEX.test(value)) return 'صيغة البريد الإلكتروني غير صحيحة';
        if (value.length > 100) return 'البريد الإلكتروني طويل جداً';
        return null;
    }

    function validatePhone() {
        const value = (fields.phone.value || '').trim();
        if (!value) return null; // اختياري
        if (!PHONE_REGEX.test(value)) return 'صيغة رقم الهاتف غير صحيحة';
        return null;
    }

    function validateSubject() {
        const value = (fields.subject.value || '').trim();
        if (!value) return 'يرجى اختيار الموضوع';
        return null;
    }

    function validateMessage() {
        const value = (fields.message.value || '').trim();
        if (!value) return 'تفاصيل الرسالة مطلوبة';
        if (value.length < 10) return 'الرسالة قصيرة جداً (10 أحرف على الأقل)';
        if (value.length > 1500) return 'الرسالة طويلة جداً (1500 حرف كحد أقصى)';
        return null;
    }

    function validateAgree() {
        if (!fields.agree.checked) return 'يجب الموافقة على السياسة والشروط';
        return null;
    }

    // ============================================================
    //  Full Form Validation
    // ============================================================
    function validateForm() {
        hideAllErrors();
        let isValid = true;

        const checks = [
            { field: 'name', error: validateName() },
            { field: 'email', error: validateEmail() },
            { field: 'phone', error: validatePhone() },
            { field: 'subject', error: validateSubject() },
            { field: 'message', error: validateMessage() },
            { field: 'agree', error: validateAgree() }
        ];

        let firstErrorField = null;

        checks.forEach(check => {
            if (check.error) {
                showFieldError(check.field, check.error);
                isValid = false;
                if (!firstErrorField) firstErrorField = check.field;
            }
        });

        // Scroll to first error
        if (firstErrorField && fields[firstErrorField]) {
            fields[firstErrorField].scrollIntoView({ behavior: 'smooth', block: 'center' });
            try { fields[firstErrorField].focus({ preventScroll: true }); } catch (e) {}
        }

        return isValid;
    }

    // ============================================================
    //  Live Validation (on input/blur)
    // ============================================================
    function attachLiveValidation() {
        // Name
        fields.name.addEventListener('blur', () => {
            const err = validateName();
            if (err) showFieldError('name', err); else hideFieldError('name');
        });
        fields.name.addEventListener('input', () => {
            if (fields.name.classList.contains('error')) {
                const err = validateName();
                if (!err) hideFieldError('name');
            }
        });

        // Email
        fields.email.addEventListener('blur', () => {
            const err = validateEmail();
            if (err) showFieldError('email', err); else hideFieldError('email');
        });
        fields.email.addEventListener('input', () => {
            if (fields.email.classList.contains('error')) {
                const err = validateEmail();
                if (!err) hideFieldError('email');
            }
        });

        // Phone (optional)
        fields.phone.addEventListener('blur', () => {
            const err = validatePhone();
            if (err) showFieldError('phone', err); else hideFieldError('phone');
        });
        fields.phone.addEventListener('input', () => {
            if (fields.phone.classList.contains('error')) {
                const err = validatePhone();
                if (!err) hideFieldError('phone');
            }
        });

        // Subject
        fields.subject.addEventListener('change', () => {
            const err = validateSubject();
            if (err) showFieldError('subject', err); else hideFieldError('subject');
        });

        // Message + char counter
        fields.message.addEventListener('input', () => {
            updateCharCounter();
            if (fields.message.classList.contains('error')) {
                const err = validateMessage();
                if (!err) hideFieldError('message');
            }
        });
        fields.message.addEventListener('blur', () => {
            const err = validateMessage();
            if (err) showFieldError('message', err); else hideFieldError('message');
        });

        // Agree
        fields.agree.addEventListener('change', () => {
            if (fields.agree.checked) hideFieldError('agree');
        });
    }

    // ============================================================
    //  Char Counter
    // ============================================================
    const charCountEl = document.getElementById('charCount');
    const MAX_CHARS = 1500;

    function updateCharCounter() {
        if (!charCountEl) return;
        const len = fields.message.value.length;
        charCountEl.textContent = len;

        const parent = charCountEl.parentElement;
        parent.classList.remove('warning', 'danger');
        if (len > MAX_CHARS * 0.9) parent.classList.add('danger');
        else if (len > MAX_CHARS * 0.75) parent.classList.add('warning');
    }

    // ============================================================
    //  Rate Limiting
    // ============================================================
    function checkRateLimit() {
        try {
            const last = parseInt(localStorage.getItem(LAST_SUBMIT_KEY) || '0', 10);
            const elapsed = Date.now() - last;
            if (elapsed < RATE_LIMIT_MS) {
                const remaining = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000);
                return { blocked: true, remaining };
            }
        } catch (e) {}
        return { blocked: false, remaining: 0 };
    }

    function markSubmitTime() {
        try { localStorage.setItem(LAST_SUBMIT_KEY, String(Date.now())); } catch (e) {}
    }

    // ============================================================
    //  Submit Handler
    // ============================================================
    async function handleSubmit(e) {
        e.preventDefault();

        // Rate limit check
        const rl = checkRateLimit();
        if (rl.blocked) {
            showError(`⏱️ يرجى الانتظار ${rl.remaining} ثانية قبل إرسال رسالة أخرى.`);
            return;
        }

        // Validation
        if (!validateForm()) {
            return;
        }

        // Disable button
        const originalHTML = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>جاري الإرسال...</span>';

        // Hide messages
        successMsg.style.display = 'none';
        errorMsg.style.display = 'none';

        // Prepare payload
        const payload = {
            name: fields.name.value.trim(),
            email: fields.email.value.trim().toLowerCase(),
            phone: fields.phone.value.trim(),
            subject: fields.subject.value.trim(),
            message: fields.message.value.trim()
        };

        try {
            const response = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            console.log('📩 [contact] response:', result);

            if (result.success) {
                // Success
                markSubmitTime();
                form.reset();
                updateCharCounter();
                hideAllErrors();

                successMsg.style.display = 'flex';
                successMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // Hide success after 8 seconds
                setTimeout(() => {
                    successMsg.style.display = 'none';
                }, 8000);
            } else {
                showError(result.error || 'حدث خطأ غير متوقع');
            }
        } catch (err) {
            console.error('❌ [contact] fetch error:', err);
            showError('فشل الاتصال بالخادم. يرجى المحاولة مرة أخرى.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalHTML;
        }
    }

    function showError(message) {
        errorMsg.style.display = 'flex';
        const textEl = errorMsg.querySelector('p');
        if (textEl) textEl.textContent = message;
        errorMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });

        setTimeout(() => {
            errorMsg.style.display = 'none';
        }, 8000);
    }

    // ============================================================
    //  Init
    // ============================================================
    function init() {
        attachLiveValidation();
        updateCharCounter();
        form.addEventListener('submit', handleSubmit);
        console.log('✅ [contact.js] initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();