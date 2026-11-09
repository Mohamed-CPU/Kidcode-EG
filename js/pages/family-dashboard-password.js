// ================================================================
//  family-dashboard-password.js - تغيير كلمة السر
//  - Live password strength validation
//  - Password visibility toggle
//  - Change password + logout all sessions
// ================================================================

(function() {
    'use strict';

    // ============================================================
    //  State
    // ============================================================
    const state = {
        isInitialized: false,
        isSaving: false,
        isRedirecting: false,
    };

    // ============================================================
    //  DOM References
    // ============================================================
    const els = {
        currentPassword: document.getElementById('fdCurrentPassword'),
        currentPasswordError: document.getElementById('fdCurrentPasswordError'),
        newPassword: document.getElementById('fdNewPassword'),
        newPasswordError: document.getElementById('fdNewPasswordError'),
        confirmPassword: document.getElementById('fdConfirmPassword'),
        confirmPasswordError: document.getElementById('fdConfirmPasswordError'),
        changePwdBtn: document.getElementById('changePwdBtn'),
        changePwdMessage: document.getElementById('changePwdMessage'),
        rulesList: document.querySelectorAll('.fd-rules-list li')
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
    function apiCall(innerAction, payload, method) {
        return getFD().apiCall(innerAction, payload, method);
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

    function hideAllFieldErrors() {
        hideFieldError(els.currentPasswordError);
        hideFieldError(els.newPasswordError);
        hideFieldError(els.confirmPasswordError);
    }

    // ============================================================
    //  Password Rules (Live Validation)
    // ============================================================
    // ✅ رموز خاصة محددة (بدل ما نعتبر أي حاجة مش A-Za-z0-9 = رمز خاص)
    const SPECIAL_CHARS = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/;

    function validatePasswordRules(password) {
        return {
            length: password.length >= 8,
            letter: /[A-Za-z]/.test(password),
            number: /[0-9]/.test(password),
            symbol: SPECIAL_CHARS.test(password)
        };
    }

    function isPasswordValid(password) {
        const rules = validatePasswordRules(password);
        if (!(rules.length && rules.letter && rules.number && rules.symbol)) {
            return false;
        }
        // ✅ منع الحروف العربية خالص
        if (/[\u0600-\u06FF]/.test(password)) return false;
        return true;
    }

    function updateRulesUI(password) {
        const rules = validatePasswordRules(password);
        const hasInput = password.length > 0;
        const hasArabic = /[\u0600-\u06FF]/.test(password);

        els.rulesList.forEach(function(li) {
            const ruleName = li.getAttribute('data-rule');
            const isValid = rules[ruleName];

            li.classList.remove('valid', 'invalid');

            if (hasInput) {
                // ✅ لو فيه حروف عربية → كل القواعد invalid
                const effectiveValid = hasArabic ? false : isValid;

                if (effectiveValid) {
                    li.classList.add('valid');
                    const icon = li.querySelector('i');
                    if (icon) icon.className = 'fas fa-check';
                } else {
                    li.classList.add('invalid');
                    const icon = li.querySelector('i');
                    if (icon) icon.className = 'fas fa-times';
                }
            } else {
                const icon = li.querySelector('i');
                if (icon) icon.className = 'fas fa-circle';
            }
        });
    }

    // ============================================================
    //  Validation
    // ============================================================
    function validateForm() {
        hideAllFieldErrors();
        let valid = true;

        const current = (els.currentPassword.value || '').trim();
        const newPwd = (els.newPassword.value || '').trim();
        const confirm = (els.confirmPassword.value || '').trim();

        // Current Password
        if (!current) {
            showFieldError(els.currentPasswordError, 'كلمة السر الحالية مطلوبة');
            valid = false;
        }

        // New Password
        if (!newPwd) {
            showFieldError(els.newPasswordError, 'كلمة السر الجديدة مطلوبة');
            valid = false;
        } else if (/[\u0600-\u06FF]/.test(newPwd)) {
            showFieldError(els.newPasswordError, 'كلمة السر بالإنجليزية فقط');
            valid = false;
        } else if (!isPasswordValid(newPwd)) {
            showFieldError(els.newPasswordError, 'كلمة السر لا تحقق الشروط المطلوبة');
            valid = false;
        } else if (newPwd === current) {
            showFieldError(els.newPasswordError, 'كلمة السر الجديدة يجب أن تكون مختلفة عن الحالية');
            valid = false;
        }

        // Confirm
        if (!confirm) {
            showFieldError(els.confirmPasswordError, 'تأكيد كلمة السر');
            valid = false;
        } else if (confirm !== newPwd) {
            showFieldError(els.confirmPasswordError, 'كلمة السر غير متطابقة');
            valid = false;
        }

        return valid;
    }

    // ============================================================
    //  Change Password
    // ============================================================
    async function handleChangePassword() {
        if (state.isSaving) return;

        hideMessage(els.changePwdMessage);

        if (!validateForm()) {
            showMessage(els.changePwdMessage, 'error', '❌ يرجى مراجعة الأخطاء أعلاه');
            return;
        }

        const current = els.currentPassword.value.trim();
        const newPwd = els.newPassword.value.trim();

        // Final confirmation
        if (!confirm('⚠️ تنبيه أمني:\n\nسيتم تسجيل الخروج من جميع الأجهزة (بما فيها هذا الجهاز) فوراً بعد تغيير كلمة السر.\n\nهل أنت متأكد؟')) {
            return;
        }

        state.isSaving = true;
        els.changePwdBtn.disabled = true;
        showLoader(true);

        try {
    const result = await apiCall('changeFamilyPassword', {
        childID: getChildID(),
        currentPassword: current,
        newPassword: newPwd,
        session: getSession()   // ← بونص: نمرر الجلسة للـ Backend
    }, 'POST');

    console.log('📩 changeFamilyPassword:', result);

            if (result.success) {
                // 1. رسالة نجاح
                showMessage(els.changePwdMessage, 'success',
                    '✅ تم تغيير كلمة السر بنجاح. سيتم تسجيل الخروج من جميع الأجهزة فوراً...');

                // 2. تفريغ الفورم
                els.currentPassword.value = '';
                els.newPassword.value = '';
                els.confirmPassword.value = '';
                updateRulesUI('');
                hideAllFieldErrors();
                resetPasswordVisibility();

                // 3. 📡 بث فوري
                try {
                    if (window.FD && typeof window.FD.broadcastSessionTerminated === 'function') {
                        window.FD.broadcastSessionTerminated();
                    }
                } catch (e) {
                    console.warn('⚠️ Broadcast failed:', e);
                }

                // 4. امسح كل حاجة
                try {
                    sessionStorage.clear();
                    localStorage.clear();
                } catch (e) {}

                // 5. علّم إننا في وضع redirect
                state.isRedirecting = true;

                // 6. Redirect بعد 1.5 ثانية
                setTimeout(function() {
                    window.location.replace('/family-login?reason=password_changed');
                }, 1500);

            } else {
                // Handle errors (زي ما هي)
                const err = (result.error || '').toLowerCase();

                if (err.indexOf('الحالي') !== -1 || err.indexOf('current') !== -1) {
                    showFieldError(els.currentPasswordError, 'كلمة السر الحالية غير صحيحة');
                    showMessage(els.changePwdMessage, 'error', '❌ كلمة السر الحالية غير صحيحة');
                } else if (err.indexOf('حروف') !== -1 || err.indexOf('رقم') !== -1 || err.indexOf('رمز') !== -1) {
                    showFieldError(els.newPasswordError, result.error);
                    showMessage(els.changePwdMessage, 'error', '❌ ' + result.error);
                } else {
                    showMessage(els.changePwdMessage, 'error',
                        '❌ ' + (result.error || 'فشل تغيير كلمة السر'));
                }
            }

        } catch (err) {
            console.error('❌ handleChangePassword error:', err);
            showMessage(els.changePwdMessage, 'error', 'تعذر الاتصال بالخادم. حاول مرة أخرى.');
        } finally {
            // ✅ لو بنعمل redirect، متلمسش الزر/الـ loader
            if (state.isRedirecting) return;

            state.isSaving = false;
            els.changePwdBtn.disabled = false;
            showLoader(false);
        }
    }

    // ============================================================
    //  Password Visibility Toggle
    // ============================================================
    function bindPasswordToggles() {
        document.querySelectorAll('#tab-password .toggle-password').forEach(function(btn) {
            // ✅ منع الربط المزدوج
            if (btn.dataset.toggleBound === 'true') return;
            btn.dataset.toggleBound = 'true';

            btn.addEventListener('click', function(e) {
                e.preventDefault();
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
            });
        });
    }

    function resetPasswordVisibility() {
        // ✅ ابحث عن كل الأزرار في تاب الـ password
        const passwordTab = document.getElementById('tab-password')
                        || document.getElementById('tabPassword')
                        || document.querySelector('[data-tab="password"]');
        const scope = passwordTab || document;
        
        scope.querySelectorAll('.toggle-password, .password-toggle, [data-toggle-password]').forEach(function(btn) {
            const targetId = btn.getAttribute('data-target')
                        || btn.getAttribute('data-for')
                        || btn.getAttribute('data-input');

            let input = null;
            if (targetId) {
                input = document.getElementById(targetId);
            }
            if (!input) {
                const wrapper = btn.closest('.password-input-wrapper, .fd-password-wrap, .input-wrapper, .form-group') 
                            || btn.parentElement;
                if (wrapper) {
                    input = wrapper.querySelector('input[type="password"], input[type="text"]');
                }
            }

            if (input) {
                input.type = 'password';
            }
            const icon = btn.querySelector('i');
            if (icon) icon.className = 'fas fa-eye';
        });
    }

    // ============================================================
    //  Event Binding
    // ============================================================
    function bindEvents() {
        // Live rules update on new password input
        if (els.newPassword) {
            els.newPassword.addEventListener('input', function(e) {
                updateRulesUI(e.target.value);
                hideFieldError(els.newPasswordError);
            });
        }

        // Hide errors on input
        if (els.currentPassword) {
            els.currentPassword.addEventListener('input', function() {
                hideFieldError(els.currentPasswordError);
            });
        }
        if (els.confirmPassword) {
            els.confirmPassword.addEventListener('input', function() {
                hideFieldError(els.confirmPasswordError);
            });
        }

        // Enter to submit
        [els.currentPassword, els.newPassword, els.confirmPassword].forEach(function(input) {
            if (!input) return;
            input.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') handleChangePassword();
            });
        });

        // Submit button
        if (els.changePwdBtn) {
            els.changePwdBtn.addEventListener('click', handleChangePassword);
        }

        // Password visibility toggles
        bindPasswordToggles();
    }

    // ============================================================
    //  Tab Activation
    // ============================================================
    const originalOnTabActivate = window.onTabActivate;

    window.onTabActivate = function(tabName, data) {
        if (typeof originalOnTabActivate === 'function') {
            originalOnTabActivate(tabName, data);
        }

        if (tabName !== 'settings') return;

        if (!state.isInitialized) {
            state.isInitialized = true;
            bindEvents();
        }

        // Reset form on each activation
        if (els.currentPassword) els.currentPassword.value = '';
        if (els.newPassword) els.newPassword.value = '';
        if (els.confirmPassword) els.confirmPassword.value = '';
        updateRulesUI('');
        hideAllFieldErrors();
        hideMessage(els.changePwdMessage);
        resetPasswordVisibility();
    };

    console.log('✅ family-dashboard-password.js loaded');

})();