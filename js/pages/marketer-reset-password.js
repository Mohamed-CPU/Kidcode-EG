// ================================================================
//  marketer-reset-password.js - تنفيذ إعادة تعيين كلمة السر
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    const form = document.getElementById('resetForm');
    const newPass = document.getElementById('newPassword');
    const confirmPass = document.getElementById('confirmNewPassword');
    const btn = document.getElementById('resetBtn');
    const messageDiv = document.getElementById('resetMessage');

    if (!token) {
        messageDiv.className = 'message error';
        messageDiv.textContent = '⚠️ رابط إعادة التعيين غير صالح. يرجى طلب رابط جديد.';
        messageDiv.style.display = 'block';
        btn.disabled = true;
        return;
    }

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        messageDiv.className = 'message';
        messageDiv.style.display = 'none';
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التحديث...';

        const password = newPass.value.trim();
        const confirm = confirmPass.value.trim();

        if (password.length < 8) {
            messageDiv.className = 'message error';
            messageDiv.textContent = '⚠️ كلمة السر يجب أن تكون 8 أحرف على الأقل.';
            messageDiv.style.display = 'block';
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> تعيين كلمة السر الجديدة';
            return;
        }
        if (password !== confirm) {
            messageDiv.className = 'message error';
            messageDiv.textContent = '⚠️ كلمة السر غير متطابقة مع تأكيدها.';
            messageDiv.style.display = 'block';
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> تعيين كلمة السر الجديدة';
            return;
        }

        try {
            const response = await fetch('/api', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'resetPassword',
                    token: token,
                    newPassword: password,
                    confirmPassword: confirm
                })
            });

            const result = await response.json();

            if (result.success) {
                messageDiv.className = 'message success';
                messageDiv.innerHTML = '✅ ' + result.message;
                messageDiv.style.display = 'block';
                btn.innerHTML = '✅ تم التحديث';
                btn.disabled = true;
                form.reset();
                setTimeout(() => {
                    window.location.href = '/marketer-login.html';
                }, 3000);
            } else {
                messageDiv.className = 'message error';
                messageDiv.textContent = '❌ ' + (result.error || 'حدث خطأ.');
                messageDiv.style.display = 'block';
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-save"></i> تعيين كلمة السر الجديدة';
            }
        } catch (err) {
            console.error(err);
            messageDiv.className = 'message error';
            messageDiv.textContent = '⚠️ حدث خطأ في الاتصال. حاول مرة أخرى.';
            messageDiv.style.display = 'block';
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> تعيين كلمة السر الجديدة';
        }
    });
});