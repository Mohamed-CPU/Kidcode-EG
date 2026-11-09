// ================================================================
//  marketer.js - لوحة تحكم المسوقين (تسجيل الدخول والعرض)
//  الخطوة 12
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('📌 marketer.js تم تحميله');

    const form = document.getElementById('marketerLoginForm');
    const codeInput = document.getElementById('marketerCodeInput');
    const loginBtn = document.getElementById('loginBtn');
    const messageDiv = document.getElementById('loginMessage');

    // تقييد الإدخال إلى MA + أرقام (وتحويل إلى كبير)
    codeInput.addEventListener('input', function(e) {
        this.value = this.value.replace(/[^MA0-9]/gi, '').toUpperCase();
    });

    // التحقق من وجود توكن في localStorage (جلسة سابقة)
    const savedCode = localStorage.getItem('marketerCode');
    if (savedCode) {
        // التحقق من صلاحية التوكن (نذهب مباشرة للوحة التحكم)
        window.location.href = '/marketer-dashboard.html?code=' + encodeURIComponent(savedCode);
    }

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const code = codeInput.value.trim().toUpperCase();
        const password = document.getElementById('marketerPassword').value.trim();

        // أضف التحقق من كلمة السر
        if (!password) {
            messageDiv.className = 'message error';
            messageDiv.textContent = '⚠️ يرجى إدخال كلمة السر.';
            messageDiv.style.display = 'block';
            return;
        }

        // ... في الـ payload
        const response = await fetch(`${GAS_URL}?action=marketerLogin&code=${encodeURIComponent(code)}&password=${encodeURIComponent(password)}`);
        
        if (!code) {
            messageDiv.className = 'message error';
            messageDiv.textContent = '⚠️ يرجى إدخال كود المسوق.';
            messageDiv.style.display = 'block';
            return;
        }

        loginBtn.disabled = true;
        loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التحقق...';
        messageDiv.className = 'message';
        messageDiv.style.display = 'none';

        try {
            const GAS_URL = CONFIG.API_URL;
            const response = await fetch(`${GAS_URL}?action=marketerLogin&code=${encodeURIComponent(code)}`);
            const result = await response.json();

            if (result.success) {
                // حفظ الكود في localStorage
                localStorage.setItem('marketerCode', code);
                localStorage.setItem('marketerName', result.name);
                
                messageDiv.className = 'message success';
                messageDiv.textContent = '✅ تم التحقق بنجاح! جاري التوجيه...';
                messageDiv.style.display = 'block';

                setTimeout(() => {
                    window.location.href = '/marketer-dashboard.html?code=' + encodeURIComponent(code);
                }, 1000);
            } else {
                messageDiv.className = 'message error';
                messageDiv.textContent = '❌ ' + (result.error || 'الكود غير صحيح أو غير نشط.');
                messageDiv.style.display = 'block';
                loginBtn.disabled = false;
                loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> تسجيل الدخول';
            }

        } catch (err) {
            console.error('❌ خطأ في تسجيل الدخول:', err);
            messageDiv.className = 'message error';
            messageDiv.textContent = '⚠️ حدث خطأ في الاتصال. يرجى المحاولة مرة أخرى.';
            messageDiv.style.display = 'block';
            loginBtn.disabled = false;
            loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> تسجيل الدخول';
        }
    });
});