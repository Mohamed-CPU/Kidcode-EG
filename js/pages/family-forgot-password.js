// ================================================================
//  family-forgot-password.js
//  - إرسال كود الطفل → إيميل فيه رابط إعادة التعيين
//  🔒 Rate Limiting على الفرونت: 10 محاولات + قفل 60 دقيقة
//  🔒 localStorage + sessionStorage (احتياطي)
// ================================================================

(function() {
    'use strict';

    // ============================================================
    //  Constants
    // ============================================================
    const API_ENDPOINT = '/api?action=family&innerAction=familyForgotPassword';

    // Rate Limiting - Window (10 محاولات / ساعة - مطابق للـ Backend)
    const MAX_ATTEMPTS = 10;
    const LOCK_DURATION_MS = 60 * 60 * 1000; // ساعة

    // ✅ نشيل الـ Total Counter (الباك إند بيتعامل معاه)
    const MAX_TOTAL_ATTEMPTS = 999999;  // عملياً: معطّل

    // Storage Keys
    const ATTEMPTS_KEY = 'family_forgot_attempts_v1';
    const LOCK_UNTIL_KEY = 'family_forgot_lock_until_v1';
    const TOTAL_ATTEMPTS_KEY = 'family_forgot_total_v1';

    // ============================================================
    //  State
    // ============================================================
    const state = {
        isLoading: false,
        countdownTimer: null,
        lockUntil: 0
    };

    // ============================================================
    //  DOM References
    // ============================================================
    const els = {
        // States
        formState: document.getElementById('formState'),
        successState: document.getElementById('successState'),
        lockedState: document.getElementById('lockedState'),

        // Form fields
        forgotChildNumber: document.getElementById('forgotChildNumber'),
        sendResetBtn: document.getElementById('sendResetBtn'),
        resendBtn: document.getElementById('resendBtn'),
        backToFormBtn: document.getElementById('backToFormBtn'),

        // Lock countdown
        lockCountdown: document.getElementById('lockCountdown'),

        // Messages & Loader
        forgotMessage: document.getElementById('forgotMessage'),
        forgotLoader: document.getElementById('forgotLoader')
    };

    // ============================================================
    //  Storage Helpers
    // ============================================================
    function getAttempts() {
        try {
            const s = parseInt(sessionStorage.getItem(ATTEMPTS_KEY) || '0', 10);
            const l = parseInt(localStorage.getItem(ATTEMPTS_KEY) || '0', 10);
            return Math.max(s, l);
        } catch (e) {
            return 0;
        }
    }

    function saveAttempts(count) {
        try {
            sessionStorage.setItem(ATTEMPTS_KEY, String(count));
            localStorage.setItem(ATTEMPTS_KEY, String(count));
        } catch (e) {}
    }

    function getLockUntil() {
        try {
            const s = parseInt(sessionStorage.getItem(LOCK_UNTIL_KEY) || '0', 10);
            const l = parseInt(localStorage.getItem(LOCK_UNTIL_KEY) || '0', 10);
            return Math.max(s, l);
        } catch (e) {
            return 0;
        }
    }

    function saveLockUntil(timestamp) {
        try {
            sessionStorage.setItem(LOCK_UNTIL_KEY, String(timestamp));
            localStorage.setItem(LOCK_UNTIL_KEY, String(timestamp));
        } catch (e) {}
    }

    function clearAttempts() {
        try {
            sessionStorage.removeItem(ATTEMPTS_KEY);
            localStorage.removeItem(ATTEMPTS_KEY);
            sessionStorage.removeItem(LOCK_UNTIL_KEY);
            localStorage.removeItem(LOCK_UNTIL_KEY);
        } catch (e) {}
    }

        // ✅ Total Counter (لا يreset مع window reset)
    function getTotalAttempts() {
        try {
            return parseInt(localStorage.getItem(TOTAL_ATTEMPTS_KEY) || '0', 10);
        } catch (e) {
            return 0;
        }
    }

    function incrementTotalAttempts() {
        try {
            const current = getTotalAttempts();
            localStorage.setItem(TOTAL_ATTEMPTS_KEY, String(current + 1));
        } catch (e) {}
    }

    // ============================================================
    //  Lock Check
    // ============================================================
    function checkLockStatus() {
        const attempts = getAttempts();
        const lockUntil = getLockUntil();
        const total = getTotalAttempts();
        const now = Date.now();

        // ✅ 1. أولاً: فحص الـ Total Limit (الأصعب)
        if (total >= MAX_TOTAL_ATTEMPTS) {
            return {
                locked: true,
                lockUntil: 0,
                reason: 'total_limit',
                message: 'تجاوزت الحد الأقصى للمحاولات. يرجى التواصل مع الدعم.'
            };
        }

        // ✅ 2. فحص الـ Window Limit (10 / 60 دقيقة)
        if (attempts >= MAX_ATTEMPTS && lockUntil > now) {
            state.lockUntil = lockUntil;
            return { locked: true, lockUntil: lockUntil, reason: 'window_limit' };
        }

        // لو الـ lock انتهى (الوقت خلص) → ننضف
        if (lockUntil > 0 && now >= lockUntil) {
            clearAttempts();
            return { locked: false };
        }

        // عادي
        return { locked: false };
    }

    // ============================================================
    //  Helpers
    // ============================================================
    function showState(stateName) {
        els.formState.style.display = 'none';
        els.successState.style.display = 'none';
        els.lockedState.style.display = 'none';

        if (stateName === 'form') els.formState.style.display = 'block';
        else if (stateName === 'success') els.successState.style.display = 'block';
        else if (stateName === 'locked') els.lockedState.style.display = 'block';

        const card = document.querySelector('.forgot-card');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function showMessage(type, title, text) {
        const iconMap = {
            error: 'fa-circle-exclamation',
            success: 'fa-circle-check',
            warning: 'fa-triangle-exclamation',
            info: 'fa-circle-info'
        };
        const iconClass = iconMap[type] || iconMap.info;

        els.forgotMessage.className = 'forgot-message ' + type;
        els.forgotMessage.querySelector('.msg-icon').className = 'fas ' + iconClass + ' msg-icon';
        els.forgotMessage.querySelector('.msg-title').textContent = title || '';
        els.forgotMessage.querySelector('.msg-text').innerHTML = text || '';
        els.forgotMessage.style.display = 'flex';
    }

    function hideMessage() {
        els.forgotMessage.style.display = 'none';
    }

    function setLoading(isLoading, message) {
        state.isLoading = isLoading;
        els.forgotLoader.style.display = isLoading ? 'flex' : 'none';

        if (message) {
            const textEl = els.forgotLoader.querySelector('span');
            if (textEl) textEl.textContent = message;
        }

        const btns = [els.sendResetBtn, els.resendBtn];
        btns.forEach(function(btn) {
            if (btn) btn.disabled = isLoading;
        });
    }

    function getFullChildID() {
        const num = (els.forgotChildNumber.value || '').trim().replace(/\D/g, '');
        if (!num) return '';
        return 'KC-' + num;
    }

    // ============================================================
    //  Countdown
    // ============================================================
    function startCountdown(lockUntil) {
        stopCountdown();

        function tick() {
            const remaining = lockUntil - Date.now();

            if (remaining <= 0) {
                // الـ lock انتهى
                stopCountdown();
                clearAttempts();
                showState('form');
                showMessage('info', 'تم فتح القفل',
                    'يمكنك الآن إرسال طلب جديد.');
                return;
            }

            const mins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            const formatted = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');

            if (els.lockCountdown) {
                els.lockCountdown.textContent = formatted;
            }
        }

        tick();
        state.countdownTimer = setInterval(tick, 1000);
    }

    function stopCountdown() {
        if (state.countdownTimer) {
            clearInterval(state.countdownTimer);
            state.countdownTimer = null;
        }
    }

    // ============================================================
    //  API Call
    // ============================================================
    async function sendResetRequest(childID) {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ childID: childID })
        });

        return await response.json();
    }

    // ============================================================
    //  Handlers
    // ============================================================
    async function handleSendReset() {
        hideMessage();

        // 0. فحص الـ lock
        const lockStatus = checkLockStatus();
        if (lockStatus.locked) {

            // ✅ لو السبب Total Limit → مايبعتش للباك إند خالص
            if (lockStatus.reason === 'total_limit') {
                showState('locked');

                // نعرض رسالة مخصصة
                const lockSubtitle = document.querySelector('#lockedState .lock-subtitle');
                if (lockSubtitle) {
                    lockSubtitle.innerHTML =
                        'لقد تجاوزت الحد الأقصى للمحاولات (<strong>' + MAX_TOTAL_ATTEMPTS + '</strong>).' +
                        '<br>يرجى التواصل مع الدعم للمساعدة.';
                }

                // نخفي الـ countdown لأنه مش هيترجع
                const countdownBox = document.querySelector('.countdown-box');
                if (countdownBox) countdownBox.style.display = 'none';

                return;
            }

            // Window limit → نعرض العداد العادي
            state.lockUntil = lockStatus.lockUntil;
            showState('locked');
            startCountdown(lockStatus.lockUntil);
            return;
        }

        // 1. Validation
        const childID = getFullChildID();
        if (!childID || childID === 'KC-') {
            showMessage('error', 'كود الطفل مطلوب', 'أدخل 5 أرقام لكود الطفل (مثال: 12345)');
            els.forgotChildNumber.focus();
            return;
        }

        const numPart = childID.replace('KC-', '');
        if (numPart.length !== 5) {
            showMessage('error', 'كود غير صحيح', 'يجب أن يتكون كود الطفل من 5 أرقام');
            els.forgotChildNumber.focus();
            return;
        }

        // 2. Send API
        setLoading(true, 'جاري الإرسال...');

        try {
            const result = await sendResetRequest(childID);
            console.log('📩 familyForgotPassword:', result);

            // 3. زيادة العدّادات (بغض النظر عن النتيجة)
            const currentAttempts = getAttempts();
            const newAttempts = currentAttempts + 1;
            saveAttempts(newAttempts);

            // ✅ زيادة الـ Total Counter (مش بيreset)
            incrementTotalAttempts();

            // 4. لو وصلنا للحد → lock
            if (newAttempts >= MAX_ATTEMPTS) {
                const lockUntil = Date.now() + LOCK_DURATION_MS;
                saveLockUntil(lockUntil);
                state.lockUntil = lockUntil;

                setLoading(false);
                showState('locked');
                startCountdown(lockUntil);
                return;
            }

            // 5. عرض النجاح (نفس الرد دايماً)
            if (result.success) {
                showState('success');
                showMessage('success', 'تم الإرسال بنجاح',
                    'يرجى مراجعة بريدك الإلكتروني (وتحقق من مجلد البريد العشوائي أيضاً).');
                setLoading(false);
                return;
            }

            // 6. خطأ عام
            showMessage('error', 'فشل الإرسال',
                result.error || 'حدث خطأ. حاول مرة أخرى.');
            setLoading(false);

        } catch (err) {
            console.error('❌ handleSendReset error:', err);
            showMessage('error', 'خطأ في الاتصال',
                'تعذر الاتصال بالخادم. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.');
            setLoading(false);
        }
    }

    function handleResend() {
        hideMessage();
        showState('form');
        showMessage('info', 'إعادة الإرسال',
            'اضغط على "إرسال رابط إعادة التعيين" مرة أخرى.');
    }

    function handleBackToForm() {
        hideMessage();
        showState('form');
    }

    // ============================================================
    //  Event Binding
    // ============================================================
    function bindEvents() {
    if (els.sendResetBtn) {
        els.sendResetBtn.addEventListener('click', handleSendReset);
    }
    if (els.resendBtn) {
        els.resendBtn.addEventListener('click', handleResend);
    }
    if (els.backToFormBtn) {
        els.backToFormBtn.addEventListener('click', handleBackToForm);
    }

    // ===== Forgot Child Number =====
    if (els.forgotChildNumber) {
        els.forgotChildNumber.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') handleSendReset();
        });

        els.forgotChildNumber.addEventListener('input', function(e) {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
        });
    }

    // ===== Support Email - Add child ID to subject dynamically =====
    const supportEmailBtn = document.getElementById('supportEmailBtn');
    if (supportEmailBtn) {
        supportEmailBtn.addEventListener('click', function(e) {
            const numPart = (els.forgotChildNumber && els.forgotChildNumber.value || '')
                .trim()
                .replace(/\D/g, '');
            const childID = numPart ? 'KC-' + numPart : '';

            let subject = 'استفسار - نسيت كلمة سر حساب طفلي';
            if (childID) {
                subject = 'استفسار - نسيت كلمة سر حساب الطفل ' + childID;
            }

            this.href = 'mailto:support@kidcode-eg.com?subject=' + encodeURIComponent(subject);
        });
    }
}

    // ============================================================
    //  Init
    // ============================================================
    function init() {
        try {
            const oldTotal = parseInt(localStorage.getItem(TOTAL_ATTEMPTS_KEY) || '0', 10);
            if (oldTotal > 0 && oldTotal < 50) {
                // ده lock قديم من النسخة القديمة → ننضّفه
                localStorage.removeItem(TOTAL_ATTEMPTS_KEY);
                localStorage.removeItem(ATTEMPTS_KEY);
                localStorage.removeItem(LOCK_UNTIL_KEY);
                sessionStorage.removeItem(ATTEMPTS_KEY);
                sessionStorage.removeItem(LOCK_UNTIL_KEY);
                console.log('🧹 [Init] تم مسح Lock قديم');
            }
        } catch (e) {}

        bindEvents();
        console.log('✅ family-forgot-password.js initialized');

        // فحص الـ lock عند فتح الصفحة
        const lockStatus = checkLockStatus();
        if (lockStatus.locked) {
            state.lockUntil = lockStatus.lockUntil;
            showState('locked');
            startCountdown(lockStatus.lockUntil);
        } else {
            showState('form');
            setTimeout(function() {
                if (els.forgotChildNumber) els.forgotChildNumber.focus();
            }, 300);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ✅ Cleanup عند إغلاق الصفحة
    window.addEventListener('beforeunload', function() {
        stopCountdown();
    });

})();