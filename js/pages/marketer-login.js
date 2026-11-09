// ================================================================
//  marketer-login.js - تسجيل دخول المسوقين (إصدار نهائي)
// ================================================================

const Utils = window.Utils || {};

// دوال احتياطية في حالة عدم تحميل utils.js
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

document.addEventListener('DOMContentLoaded', function() {
    console.log('✅ marketer-login.js تم تحميله');

    // التحقق من وجود جلسة مسبقة
    if (localStorage.getItem('marketerCode')) {
        console.log('ℹ️ جلسة موجودة، توجيه إلى لوحة التحكم');
        window.location.href = '/marketer-dashboard.html';
        return;
    }

    const form = document.getElementById('loginForm');
    const codeInput = document.getElementById('loginCode');
    const passField = document.getElementById('loginPassword');
    const loginBtn = document.getElementById('loginBtn');
    const messageDiv = document.getElementById('loginMessage');

    // التحقق من وجود العناصر
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

    // تقييد الكود وتحويله إلى أحرف كبيرة (باستخدام الدالة من Utils)
    codeInput.addEventListener('input', function(e) {
        if (typeof Utils.restrictMarketerId === 'function') {
            Utils.restrictMarketerId(e);
        } else {
            // دوال احتياطية مباشرة
            const input = e.target;
            let value = input.value;
            let newValue = value.replace(/[^MA0-9]/gi, '').toUpperCase();
            if (newValue !== value) {
                input.value = newValue;
                input.selectionStart = input.selectionEnd = newValue.length;
            }
        }
    });

    // إرسال النموذج
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        messageDiv.className = 'message-box';
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
                localStorage.setItem('marketerCode', result.code);
                localStorage.setItem('marketerName', result.name);
                
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