// ================================================================
//  marketer-login.js - تسجيل دخول المسوقين (مع Session Timeout 60 دقيقة)
// ================================================================

const Utils = window.Utils || {};

const SESSION_EXPIRY_KEY = 'marketer_session_expiry';
const SESSION_DURATION_MS = 60 * 60 * 1000; // ✅ ساعة واحدة

if (!window.Utils) {
    console.warn('⚠️ utils.js لم يتم تحميله، استخدام دوال احتياطية');
    window.Utils = {
        restrictMarketerId: function(e) {
            const input = e.target;
            let value = input.value;
            let newValue = value.replace(/[^MA0-9]/gi, '').toUpperCase();
            if (newValue !== value) {
                input.value = newValue;
                input.selectionStart = input.selectionEnd = newValue.length;
            }
        }
    };
}

// ============================================================
//  Helpers — Session Storage
// ============================================================
function getExistingExpiry() {
    try {
        const s = sessionStorage.getItem(SESSION_EXPIRY_KEY)
                || localStorage.getItem(SESSION_EXPIRY_KEY);
        if (!s) return null;
        const t = new Date(s).getTime();
        return isNaN(t) ? null : t;
    } catch (e) {
        return null;
    }
}

function clearAllMarketerStorage() {
    try {
        localStorage.removeItem('marketerCode');
        localStorage.removeItem('marketerName');
        localStorage.removeItem(SESSION_EXPIRY_KEY);
        sessionStorage.removeItem(SESSION_EXPIRY_KEY);
    } catch (e) {}
}

function saveMarketerSession(code, name) {
    const expiryIso = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
    try {
        localStorage.setItem('marketerCode', code);
        localStorage.setItem('marketerName', name);
        localStorage.setItem(SESSION_EXPIRY_KEY, expiryIso);
        sessionStorage.setItem(SESSION_EXPIRY_KEY, expiryIso);
    } catch (e) {
        console.warn('⚠️ فشل حفظ بيانات الجلسة:', e);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    console.log('✅ marketer-login.js تم تحميله');

    // ============================================================
    //  1. فحص الجلسة السابقة (مع expiry)
    // ============================================================
    const existingCode = localStorage.getItem('marketerCode');
    if (existingCode) {
        const existingExpiry = getExistingExpiry();
        if (existingExpiry && Date.now() < existingExpiry) {
            console.log('ℹ️ جلسة صالحة موجودة، توجيه إلى لوحة التحكم');
            window.location.href = '/marketer-dashboard.html';
            return;
        }
        console.log('⚠️ جلسة منتهية أو بدون expiry — تنظيف');
        clearAllMarketerStorage();
    }

    // ============================================================
    //  2. بانر "انتهت الجلسة" (لو ?reason=session_expired)
    // ============================================================
    const urlParams = new URLSearchParams(window.location.search);
    const messageDivInit = document.getElementById('loginMessage');
    if (urlParams.get('reason') === 'session_expired' && messageDivInit) {
        messageDivInit.className = 'message-box';
        messageDivInit.style.cssText =
            'display:block; padding:14px 20px; border-radius:12px; ' +
            'text-align:center; font-weight:600; background:#FEF3C7; ' +
            'color:#92400E; border-right:4px solid #F59E0B; margin-bottom:16px;';
        messageDivInit.textContent = '⏰ انتهت مدة الجلسة (60 دقيقة). يرجى تسجيل الدخول من جديد.';
    }

    // ============================================================
    //  3. عناصر الفورم
    // ============================================================
    const form = document.getElementById('loginForm');
    const codeInput = document.getElementById('loginCode');
    const passField = document.getElementById('loginPassword');
    const loginBtn = document.getElementById('loginBtn');
    const messageDiv = document.getElementById('loginMessage');

    if (!form || !codeInput || !passField || !loginBtn) {
        console.error('❌ بعض العناصر غير موجودة في الصفحة!');
        return;
    }

    // إظهار/إخفاء كلمة السر
    const toggleBtn = document.getElementById('togglePassword');
    if (toggleBtn && passField) {
        toggleBtn.addEventListener('click', function() {
            const type = passField.getAttribute('type') === 'password' ? 'text' : 'password';
            passField.setAttribute('type', type);
            this.innerHTML = type === 'password' ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
        });
    }

    // تقييد الكود وتحويله إلى أحرف كبيرة
    codeInput.addEventListener('input', function(e) {
        if (typeof Utils.restrictMarketerId === 'function') {
            Utils.restrictMarketerId(e);
        } else {
            const input = e.target;
            let value = input.value;
            let newValue = value.replace(/[^MA0-9]/gi, '').toUpperCase();
            if (newValue !== value) {
                input.value = newValue;
                input.selectionStart = input.selectionEnd = newValue.length;
            }
        }
    });

    // ============================================================
    //  4. إرسال النموذج
    // ============================================================
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        messageDiv.className = 'message-box';
        messageDiv.style.cssText = ''; // reset banner styles
        messageDiv.style.display = 'none';
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التحقق...';

        const code = codeInput.value.trim().toUpperCase();
        const password = passField.value.trim();

        if (!code || !password) {
            messageDiv.className = 'message-box error';
            messageDiv.textContent = '⚠️ يرجى إدخال الكود وكلمة السر.';
            messageDiv.style.display = 'block';
            loginBtn.disabled = false;
            loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> تسجيل الدخول';
            return;
        }

        try {
            const response = await fetch('/api?action=marketer&innerAction=marketerLogin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: code, password: password })
            });

            const result = await response.json();

            if (result.success) {
                // ✅ حفظ الجلسة + expiry (ساعة)
                saveMarketerSession(result.code, result.name || '');

                messageDiv.className = 'message-box success';
                messageDiv.textContent = '✅ تم تسجيل الدخول بنجاح! جاري التوجيه...';
                messageDiv.style.display = 'block';

                setTimeout(() => {
                    window.location.href = '/marketer-dashboard.html';
                }, 1000);
            } else {
                messageDiv.className = 'message-box error';
                messageDiv.textContent = '❌ ' + (result.error || 'بيانات الدخول غير صحيحة.');
                messageDiv.style.display = 'block';
                loginBtn.disabled = false;
                loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> تسجيل الدخول';
            }
        } catch (err) {
            console.error('❌ خطأ في الاتصال:', err);
            messageDiv.className = 'message-box error';
            messageDiv.textContent = '⚠️ حدث خطأ في الاتصال. حاول مرة أخرى.';
            messageDiv.style.display = 'block';
            loginBtn.disabled = false;
            loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> تسجيل الدخول';
        }
    });
});