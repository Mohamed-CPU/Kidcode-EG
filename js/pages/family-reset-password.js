// ================================================================
//  family-reset-password.js - منطق صفحة إعادة تعيين كلمة السر
//  - يقرأ التوكن من URL
//  - يتحقق من صلاحيته
//  - تعيين كلمة السر الجديد
//  - يعمل Redirect للـ login
// ================================================================

(function() {
    'use strict';

    // ============================================================
    //  Constants
    // ============================================================
    const API_ENDPOINT = '/api?action=family&innerAction=familyResetPassword';
    const REDIRECT_DELAY_MS = 2500;

    // ============================================================
    //  State
    // ============================================================
    const state = {
        token: '',
        isLoading: false,
        redirectTimer: null
    };

    // ============================================================
    //  DOM References
    // ============================================================
    const els = {
        // States
        formState: document.getElementById('formState'),
        successState: document.getElementById('successState'),
        invalidTokenState: document.getElementById('invalidTokenState'),
        loadingState: document.getElementById('loadingState'),

        // Form fields
        newPassword: document.getElementById('newPassword'),
        confirmPassword: document.getElementById('confirmPassword'),
        confirmError: document.getElementById('confirmError'),
        resetBtn: document.getElementById('resetBtn'),

        // Child Info
        childInfoBox: document.getElementById('childInfoBox'),
        displayChildID: document.getElementById('displayChildID'),

        // Password Rules
        rulesList: document.querySelectorAll('.password-rules-box .rules-list li'),

        // Invalid token
        invalidReason: document.getElementById('invalidReason'),

        // Loader
        resetLoader: document.getElementById('resetLoader')
    };

    // ============================================================
    //  Token Extraction
    // ============================================================
    function getTokenFromURL() {
        try {
            const params = new URLSearchParams(window.location.search);
            return (params.get('token') || '').trim();
        } catch (e) {
            return '';
        }
    }

    // ============================================================
    //  Helpers
    // ============================================================
    function showState(stateName) {
        els.formState.style.display = 'none';
        els.successState.style.display = 'none';
        els.invalidTokenState.style.display = 'none';
        els.loadingState.style.display = 'none';

        if (stateName === 'form') els.formState.style.display = 'block';
        else if (stateName === 'success') els.successState.style.display = 'block';
        else if (stateName === 'invalid') els.invalidTokenState.style.display = 'block';
        else if (stateName === 'loading') els.loadingState.style.display = 'block';

        const card = document.querySelector('.reset-card');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function setLoading(isLoading) {
        state.isLoading = isLoading;
        els.resetLoader.style.display = isLoading ? 'flex' : 'none';

        if (els.resetBtn) els.resetBtn.disabled = isLoading;
    }

    function togglePasswordVisibility(btn) {
        const targetId = btn.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (!input) return;

        const icon = btn.querySelector('i');
        if (input.type === 'password') {
            input.type = 'text';
            if (icon) icon.className = 'fas fa-eye-slash';
        } else {
            input.type = 'password';
            if (icon) icon.className = 'fas fa-eye';
        }
    }

    function showConfirmError(message) {
        if (els.confirmError) {
            els.confirmError.textContent = message;
            els.confirmError.classList.add('show');
        }
    }

    function hideConfirmError() {
        if (els.confirmError) {
            els.confirmError.classList.remove('show');
        }
    }

    // ============================================================
    //  Password Rules - Live Validation
    // ============================================================
    function validatePasswordRules(password) {
        return {
            length: password.length >= 8,
            letter: /[A-Za-z]/.test(password),
            number: /[0-9]/.test(password),
            symbol: /[^A-Za-z0-9]/.test(password)
        };
    }

    function updateRulesUI(password) {
        const rules = validatePasswordRules(password);
        const hasInput = password.length > 0;

        els.rulesList.forEach(function(li) {
            const ruleName = li.getAttribute('data-rule');
            const isValid = rules[ruleName];

            li.classList.remove('valid', 'invalid');

            if (hasInput) {
                if (isValid) {
                    li.classList.add('valid');
                    const icon = li.querySelector('i');
                    if (icon) icon.className = 'fas fa-check';
                } else {
                    li.classList.add('invalid');
                    const icon = li.querySelector('i');
                    if (icon) icon.className = 'fas fa-times';
                }
            } else {
                // مفيش إدخال → الحالة الافتراضية
                const icon = li.querySelector('i');
                if (icon) icon.className = 'fas fa-circle';
            }
        });
    }

    function isPasswordValid(password) {
        const rules = validatePasswordRules(password);
        return rules.length && rules.letter && rules.number && rules.symbol;
    }

    // ============================================================
    //  API Call
    // ============================================================
    async function callResetAPI(token, newPassword) {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: token,
                newPassword: newPassword
            })
        });

        return await response.json();
    }

    // ============================================================
    //  Handlers
    // ============================================================
    async function handleReset() {
        hideConfirmError();

        const newPwd = (els.newPassword.value || '').trim();
        const confirmPwd = (els.confirmPassword.value || '').trim();

        // 1. التحقق من شروط كلمة السر
        if (!isPasswordValid(newPwd)) {
            showConfirmError('كلمة السر لا تحقق الشروط المطلوبة');
            els.newPassword.focus();
            return;
        }

        // 2. التحقق من التطابق
        if (newPwd !== confirmPwd) {
            showConfirmError('كلمة السر غير متطابقة');
            els.confirmPassword.focus();
            return;
        }

        // 3. الإرسال
        setLoading(true);

        try {
            const result = await callResetAPI(state.token, newPwd);
            console.log('📩 familyResetPassword:', result);

            setLoading(false);

            // ============================================================
            //  تحليل النتيجة
            // ============================================================

            // 1️⃣ نجاح
            if (result.success) {
                showState('success');
                // ✅ توجيه تلقائي بعد 2.5 ثانية
                state.redirectTimer = setTimeout(function() {
                    window.location.href = '/family-login';
                }, REDIRECT_DELAY_MS);
                return;
            }

            // 2️⃣ توكن غير صالح
            if (result.error && (
                result.error.indexOf('التوكن') !== -1 ||
                result.error.indexOf('صلاحية') !== -1
            )) {
                if (els.invalidReason) {
                    els.invalidReason.innerHTML =
                        result.error +
                        '<br>الرابط صالح لمدة <strong>5 دقائق</strong> فقط.';
                }
                showState('invalid');
                return;
            }

            // 3️⃣ أخطاء شروط كلمة السر
            if (result.error && (
                result.error.indexOf('كلمة السر') !== -1 ||
                result.error.indexOf('حروف') !== -1 ||
                result.error.indexOf('رقم') !== -1 ||
                result.error.indexOf('رمز') !== -1
            )) {
                showConfirmError(result.error);
                return;
            }

            // 4️⃣ خطأ عام
            showConfirmError(result.error || 'حدث خطأ. حاول مرة أخرى.');

        } catch (err) {
            console.error('❌ handleReset error:', err);
            setLoading(false);
            showConfirmError('تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.');
        }
    }

    // ============================================================
    //  Event Binding
    // ============================================================
    function bindEvents() {
        // Submit
        if (els.resetBtn) {
            els.resetBtn.addEventListener('click', handleReset);
        }

        // Enter to submit
        if (els.confirmPassword) {
            els.confirmPassword.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') handleReset();
            });
        }
        if (els.newPassword) {
            els.newPassword.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') els.confirmPassword.focus();
            });
        }

        // Live validation for rules
        if (els.newPassword) {
            els.newPassword.addEventListener('input', function(e) {
                updateRulesUI(e.target.value);
                hideConfirmError();
            });
        }

        // Confirm password - hide error on input
        if (els.confirmPassword) {
            els.confirmPassword.addEventListener('input', function() {
                hideConfirmError();
            });
        }

        // Toggle password visibility
        document.querySelectorAll('.toggle-password').forEach(function(btn) {
            btn.addEventListener('click', function() {
                togglePasswordVisibility(btn);
            });
        });
    }

    // ============================================================
    //  Init
    // ============================================================
    function init() {
        bindEvents();
        console.log('✅ family-reset-password.js initialized');

        // 1. استخراج التوكن
        state.token = getTokenFromURL();
        console.log('🔑 Token:', state.token ? state.token.substring(0, 12) + '...' : '(empty)');

        // 2. لو مفيش توكن → invalid state مباشرة
        if (!state.token) {
            if (els.invalidReason) {
                els.invalidReason.innerHTML =
                    'لم يتم العثور على رمز إعادة التعيين في الرابط.' +
                    '<br>الرابط صالح لمدة <strong>5 دقائق</strong> فقط.';
            }
            showState('invalid');
            return;
        }

        // 3. توكن موجود → نعرض الفورم
        // (التحقق الفعلي من التوكن بيحصل وقت الإرسال عبر API)
        showState('form');

        setTimeout(function() {
            if (els.newPassword) els.newPassword.focus();
        }, 300);
    }

    // ============================================================
    //  Cleanup
    // ============================================================
    window.addEventListener('beforeunload', function() {
        if (state.redirectTimer) {
            clearTimeout(state.redirectTimer);
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();