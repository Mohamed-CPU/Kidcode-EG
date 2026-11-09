// ================================================================
//  family-login.js - منطق تسجيل دخول لوحة الأسرة
//  يدعم: Login عادي + Migration Mode + Rate Limiting
// ================================================================

(function() {
    'use strict';

    // ============================================================
    //  Constants
    // ============================================================
    const API_ENDPOINT = '/api?action=family';
    const SESSION_KEY = 'family_session';
    const SESSION_CHILD_KEY = 'family_child_id';
    const SESSION_EXPIRY_KEY = 'family_session_expiry';
    const REDIRECT_URL = '/family-dashboard.html#data';

    // ============================================================
    //  ✅ فحص لو فيه session شغالة (مع expiry check)
    // ============================================================
    function hasActiveSession() {
        try {
            const token = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
            const childID = sessionStorage.getItem(SESSION_CHILD_KEY) || localStorage.getItem(SESSION_CHILD_KEY);
            // ✅ نقرأ expiry من الاتنين
            const expiry = sessionStorage.getItem(SESSION_EXPIRY_KEY)
                        || localStorage.getItem(SESSION_EXPIRY_KEY);

            if (!token || !childID) return false;

            // ✅ لو فيه expiry وخلص → امسح كل حاجة وارجع false
            if (expiry) {
                // ✅ Utils.parseToDate يفترض UTC لو مفيش Z
                const parsed = (window.Utils && typeof Utils.parseToDate === 'function')
                    ? Utils.parseToDate(expiry)
                    : new Date(expiry);
                const expiryTime = parsed ? parsed.getTime() : NaN;
                if (!isNaN(expiryTime) && Date.now() >= expiryTime) {
                    try {
                        sessionStorage.removeItem(SESSION_KEY);
                        sessionStorage.removeItem(SESSION_CHILD_KEY);
                        sessionStorage.removeItem(SESSION_EXPIRY_KEY);
                        localStorage.removeItem(SESSION_KEY);
                        localStorage.removeItem(SESSION_CHILD_KEY);
                        localStorage.removeItem(SESSION_EXPIRY_KEY);
                    } catch (e) {}
                    return false;
                }
            }

            return true;
        } catch (e) {
            return false;
        }
    }

    // ============================================================
    //  State
    // ============================================================
    const state = {
        childID: '',        // KC-XXXXX (كامل)
        email: '',          // للإيميل في migration
        isLoading: false,
    };

    // ============================================================
    //  DOM References
    // ============================================================
    const els = {
        // States
        loginState: document.getElementById('loginState'),
        migrationEmailState: document.getElementById('migrationEmailState'),
        migrationPasswordState: document.getElementById('migrationPasswordState'),

        // Login state fields
        loginChildNumber: document.getElementById('loginChildNumber'),
        loginPassword: document.getElementById('loginPassword'),
        loginBtn: document.getElementById('loginBtn'),

        // Migration email state fields
        migrationChildNumber: document.getElementById('migrationChildNumber'),
        migrationEmail: document.getElementById('migrationEmail'),
        migrationEmailBtn: document.getElementById('migrationEmailBtn'),
        backToLoginBtn: document.getElementById('backToLoginBtn'),

        // Migration password state fields
        migrationNewPassword: document.getElementById('migrationNewPassword'),
        migrationConfirmPassword: document.getElementById('migrationConfirmPassword'),
        migrationConfirmError: document.getElementById('migrationConfirmError'),
        migrationPasswordBtn: document.getElementById('migrationPasswordBtn'),
        backToEmailBtn: document.getElementById('backToEmailBtn'),

        // Message & Loader
        loginMessage: document.getElementById('loginMessage'),
        loginLoader: document.getElementById('loginLoader'),
    };

    // ============================================================
    //  Helpers
    // ============================================================
    function showState(stateName) {
        els.loginState.style.display = 'none';
        els.migrationEmailState.style.display = 'none';
        els.migrationPasswordState.style.display = 'none';

        if (stateName === 'login') els.loginState.style.display = 'block';
        else if (stateName === 'migrationEmail') els.migrationEmailState.style.display = 'block';
        else if (stateName === 'migrationPassword') els.migrationPasswordState.style.display = 'block';

        // scroll to top of card
        const card = document.querySelector('.login-card');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function showMessage(type, title, text) {
        // type: 'error' | 'success' | 'warning' | 'info'
        const iconMap = {
            error: 'fa-circle-exclamation',
            success: 'fa-circle-check',
            warning: 'fa-triangle-exclamation',
            info: 'fa-circle-info'
        };
        const iconClass = iconMap[type] || iconMap.info;

        els.loginMessage.className = 'login-message ' + type;
        els.loginMessage.querySelector('.msg-icon').className = 'fas ' + iconClass + ' msg-icon';
        els.loginMessage.querySelector('.msg-title').textContent = title || '';
        els.loginMessage.querySelector('.msg-text').innerHTML = text || '';
        els.loginMessage.style.display = 'flex';
    }

    function hideMessage() {
        els.loginMessage.style.display = 'none';
    }

    function setLoading(isLoading) {
        state.isLoading = isLoading;
        els.loginLoader.style.display = isLoading ? 'flex' : 'none';

        // Disable buttons
        const btns = [
            els.loginBtn,
            els.migrationEmailBtn,
            els.migrationPasswordBtn,
            els.backToLoginBtn,
            els.backToEmailBtn
        ];
        btns.forEach(function(btn) {
            if (btn) btn.disabled = isLoading;
        });
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

    function getFullChildID(prefixInput) {
        const num = (prefixInput.value || '').trim().replace(/\D/g, '');
        if (!num) return '';
        return 'KC-' + num;
    }

    // ============================================================
    //  API Calls
    // ============================================================
    async function callAPI(innerAction, payload, method) {
        method = method || 'POST';
        const url = API_ENDPOINT + '&innerAction=' + encodeURIComponent(innerAction);

        const options = {
            method: method,
            headers: { 'Content-Type': 'application/json' }
        };

        if (method === 'POST') {
            options.body = JSON.stringify(payload || {});
        } else {
            // GET: append to URL
            const params = new URLSearchParams(payload || {});
            return fetch(url + '&' + params.toString()).then(function(r) { return r.json(); });
        }

        const response = await fetch(url, options);
        return await response.json();
    }

    // ============================================================
    //  Handlers - Login
    // ============================================================
    async function handleLogin() {
        hideMessage();

        const childID = getFullChildID(els.loginChildNumber);
        const password = (els.loginPassword.value || '').trim();

        // Validation
        if (!childID || childID === 'KC-') {
            showMessage('error', 'كود الطفل مطلوب', 'أدخل 5 أرقام لكود الطفل (مثال: 12345)');
            els.loginChildNumber.focus();
            return;
        }
        const numPart = childID.replace('KC-', '');
        if (numPart.length !== 5) {
            showMessage('error', 'كود غير صحيح', 'يجب أن يتكون كود الطفل من 5 أرقام');
            els.loginChildNumber.focus();
            return;
        }
        if (!password) {
            showMessage('error', 'كلمة السر مطلوبة', 'أدخل كلمة السر الخاصة بحسابك');
            els.loginPassword.focus();
            return;
        }

        setLoading(true);

        try {
            const result = await callAPI('familyLogin', {
                childID: childID,
                password: password
            });

            console.log('📩 familyLogin:', result);

            // ============================================================
            //  تحليل النتيجة
            // ============================================================

            // 1️⃣ نجاح الدخول
            if (result.success && result.mode === 'login' && result.session_token) {
                saveSession(result);
                showMessage('success', 'تم الدخول بنجاح', 'جاري تحويلك إلى لوحة التحكم...');
                setTimeout(function() {
                    window.location.replace(REDIRECT_URL);   // ← ✅ replace بدل href
                }, 600);
                return;
            }

            // 2️⃣ Migration Mode - يحتاج إيميل
            if (result.mode === 'migration' && result.requires_password_setup) {
                // حفظ الإيميل لو كان مبعوت
                if (result.child_id) {
                    state.childID = result.child_id;
                    state.email = '';

                    // نعرض المرحلة 2: إدخال الإيميل
                    const numPart = result.child_id.replace('KC-', '');
                    els.migrationChildNumber.value = numPart;
                    showState('migrationEmail');
                    showMessage('info', 'تفعيل كلمة السر',
                        'لم يتم إنشاء كلمة سر لحسابك بعد. أدخل البريد الإلكتروني المسجل لإنشاء كلمة سر جديدة.');
                    return;
                }

                // لو الـ response رجع migration بدون child_id، نستخدم اللي دخلناه
                state.childID = childID;
                const num = childID.replace('KC-', '');
                els.migrationChildNumber.value = num;
                showState('migrationEmail');
                showMessage('info', 'تفعيل كلمة السر',
                    result.error || 'لم يتم إنشاء كلمة سر لحسابك بعد. أدخل البريد الإلكتروني المسجل لإنشاء كلمة سر جديدة.');
                return;
            }

            // 3️⃣ حساب محذوف
            if (result.deleted) {
                showMessage('error', 'الحساب محذوف',
                    'هذا الحساب تم حذفه. للاستفسار تواصل مع الدعم: <a href="mailto:support@kidcode-eg.com">support@kidcode-eg.com</a>');
                return;
            }

            // 4️⃣ Rate Limiting - مقفول
            if (result.locked) {
                showMessage('warning', 'تم قفل الحساب مؤقتاً',
                    result.error || 'حاول مرة أخرى بعد قليل، أو تواصل مع الدعم: <a href="mailto:support@kidcode-eg.com">support@kidcode-eg.com</a>');
                return;
            }

            // 5️⃣ خطأ عام
            showMessage('error', 'فشل الدخول', result.error || 'حدث خطأ غير متوقع. حاول مرة أخرى.');

        } catch (err) {
            console.error('❌ handleLogin error:', err);
            showMessage('error', 'خطأ في الاتصال',
                'تعذر الاتصال بالخادم. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.');
        } finally {
            setLoading(false);
        }
    }

    // ============================================================
    //  Handlers - Migration Email
    // ============================================================
    async function handleMigrationEmail() {
        hideMessage();

        const email = (els.migrationEmail.value || '').trim().toLowerCase();

        if (!email) {
            showMessage('error', 'البريد الإلكتروني مطلوب', 'أدخل البريد الإلكتروني المسجل لحساب الطفل');
            els.migrationEmail.focus();
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showMessage('error', 'البريد الإلكتروني غير صحيح', 'أدخل بريد إلكتروني بصيغة صحيحة');
            els.migrationEmail.focus();
            return;
        }

        setLoading(true);

        try {
            const result = await callAPI('familyLogin', {
                childID: state.childID,
                email: email
            });

            console.log('📩 migration email:', result);

            // نجاح التحقق
            if (result.success && result.mode === 'migration') {
                state.email = email;
                showState('migrationPassword');
                showMessage('success', 'تم التحقق', 'البريد الإلكتروني صحيح. عيّن كلمة سر قوية للحساب.');
                return;
            }

            // فشل
            if (result.locked) {
                showMessage('warning', 'الحساب مقفول مؤقتاً',
                    result.error || 'حاول بعد قليل، أو تواصل مع الدعم.');
                return;
            }

            showMessage('error', 'فشل التحقق', result.error || 'البريد الإلكتروني غير مطابق. تأكد من البريد الإلكتروني المسجل.');

        } catch (err) {
            console.error('❌ handleMigrationEmail error:', err);
            showMessage('error', 'خطأ في الاتصال', 'تعذر الاتصال بالخادم. حاول مرة أخرى.');
        } finally {
            setLoading(false);
        }
    }

    // ============================================================
    //  Handlers - Migration Password
    // ============================================================
    function validatePasswordStrength(password) {
        const errors = [];
        if (!password || password.length < 8) errors.push('يجب أن يحتوي على 8 حروف على الأقل');
        if (!/[A-Za-z]/.test(password)) errors.push('يجب أن يحتوي على حرف');
        if (!/[0-9]/.test(password)) errors.push('يجب أن يحتوي على رقم');
        if (!/[^A-Za-z0-9]/.test(password)) errors.push('يجب أن يحتوي على رمز خاص');
        return errors;
    }

    async function handleMigrationPassword() {
        hideMessage();
        els.migrationConfirmError.classList.remove('show');

        const newPwd = (els.migrationNewPassword.value || '').trim();
        const confirmPwd = (els.migrationConfirmPassword.value || '').trim();

        // Validation
        const pwdErrors = validatePasswordStrength(newPwd);
        if (pwdErrors.length > 0) {
            showMessage('error', 'كلمة السر ضعيفة', pwdErrors.join(' • '));
            els.migrationNewPassword.focus();
            return;
        }
        if (newPwd !== confirmPwd) {
            els.migrationConfirmError.classList.add('show');
            showMessage('error', 'كلمة السر غير متطابقة', 'كلمة السر غير متطابقة');
            els.migrationConfirmPassword.focus();
            return;
        }

        setLoading(true);

        try {
            const result = await callAPI('completeFamilyMigration', {
                childID: state.childID,
                email: state.email,
                password: newPwd
            });

            console.log('📩 completeFamilyMigration:', result);

            if (result.success && result.session_token) {
                saveSession(result);
                showMessage('success', 'تم تعيين كلمة السر بنجاح', 'جاري تحويلك إلى لوحة التحكم...');
                setTimeout(function() {
                    window.location.replace(REDIRECT_URL);   // ← ✅ replace بدل href
                }, 600);
                return;
            }

            showMessage('error', 'فشل التعيين', result.error || 'حدث خطأ. حاول مرة أخرى.');

        } catch (err) {
            console.error('❌ handleMigrationPassword error:', err);
            showMessage('error', 'خطأ في الاتصال', 'تعذر الاتصال بالخادم. حاول مرة أخرى.');
        } finally {
            setLoading(false);
        }
    }

        // ============================================================
    //  🚀 Session + Prefetch
    // ============================================================
    function saveSession(result) {
        try {
            const token = result.session_token || result.session;
            const childID = result.child_id || state.childID;
            const expiresAt = result.expires_at || '';

            // ✅ sessionStorage
            if (token) sessionStorage.setItem(SESSION_KEY, token);
            if (childID) sessionStorage.setItem(SESSION_CHILD_KEY, childID);
            if (expiresAt) sessionStorage.setItem(SESSION_EXPIRY_KEY, expiresAt);

            // ✅ localStorage كاحتياطي (مهم للـ expiry)
            if (token) localStorage.setItem(SESSION_KEY, token);
            if (childID) localStorage.setItem(SESSION_CHILD_KEY, childID);
            if (expiresAt) localStorage.setItem(SESSION_EXPIRY_KEY, expiresAt);

            console.log('✅ تم حفظ الجلسة بنجاح:', childID, '| expires:', expiresAt);
        } catch (e) {
            console.warn('⚠️ فشل حفظ الجلسة:', e);
        }
    }

    // ============================================================
    //  Handlers - Back buttons
    // ============================================================
    function handleBackToLogin() {
        hideMessage();
        showState('login');
        els.migrationEmail.value = '';
    }

    function handleBackToEmail() {
        hideMessage();
        els.migrationConfirmError.classList.remove('show');
        els.migrationNewPassword.value = '';
        els.migrationConfirmPassword.value = '';
        showState('migrationEmail');
    }

    // ============================================================
    //  Event Binding
    // ============================================================
    function bindEvents() {
        // Login
        if (els.loginBtn) els.loginBtn.addEventListener('click', handleLogin);

        // Enter to submit in login state
        if (els.loginChildNumber) {
            els.loginChildNumber.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') els.loginPassword.focus();
            });
            // Only numbers
            els.loginChildNumber.addEventListener('input', function(e) {
                e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
            });
        }
        if (els.loginPassword) {
            els.loginPassword.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') handleLogin();
            });
        }

        // Migration Email
        if (els.migrationEmailBtn) els.migrationEmailBtn.addEventListener('click', handleMigrationEmail);
        if (els.migrationEmail) {
            els.migrationEmail.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') handleMigrationEmail();
            });
        }
        if (els.backToLoginBtn) els.backToLoginBtn.addEventListener('click', handleBackToLogin);

        // Migration Password
        if (els.migrationPasswordBtn) els.migrationPasswordBtn.addEventListener('click', handleMigrationPassword);
        if (els.migrationConfirmPassword) {
            els.migrationConfirmPassword.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') handleMigrationPassword();
            });
        }
        if (els.backToEmailBtn) els.backToEmailBtn.addEventListener('click', handleBackToEmail);

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
        // ✅ Auth Guard — لو فيه session شغالة → redirect فوراً
        if (hasActiveSession()) {
            console.log('✅ [family-login] Session موجود — redirect للوحة');
            window.location.replace(REDIRECT_URL);
            return;
        }

        bindEvents();
        console.log('✅ family-login.js initialized');

        // Focus on first field
        setTimeout(function() {
            if (els.loginChildNumber) els.loginChildNumber.focus();
        }, 300);
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();