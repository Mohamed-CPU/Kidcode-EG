// ================================================================
//  marketer-forgot-password.js - طلب إعادة تعيين كلمة السر
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('forgotForm');
    const codeInput = document.getElementById('forgotCode');
    const btn = document.getElementById('forgotBtn');
    const messageDiv = document.getElementById('forgotMessage');

    codeInput.addEventListener('input', function() {
        this.value = this.value.replace(/[^MA0-9]/gi, '').toUpperCase();
    });

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        messageDiv.className = 'message';
        messageDiv.style.display = 'none';
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';

        const code = codeInput.value.trim().toUpperCase();
        if (!code) {
            messageDiv.className = 'message error';
            messageDiv.textContent = '⚠️ يرجى إدخال كود المسوق.';
            messageDiv.style.display = 'block';
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i> إرسال رابط إعادة التعيين';
            return;
        }

        try {
            const response = await fetch(`/api?action=forgotPassword&code=${encodeURIComponent(code)}`);
            const result = await response.json();

            if (result.success) {
                messageDiv.className = 'message success';
                messageDiv.innerHTML = '✅ ' + result.message;
                messageDiv.style.display = 'block';
                btn.innerHTML = '✅ تم الإرسال';
                btn.disabled = true;
            } else {
                messageDiv.className = 'message error';
                messageDiv.textContent = '❌ ' + (result.error || 'حدث خطأ.');
                messageDiv.style.display = 'block';
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-paper-plane"></i> إرسال رابط إعادة التعيين';
            }
        } catch (err) {
            console.error(err);
            messageDiv.className = 'message error';
            messageDiv.textContent = '⚠️ حدث خطأ في الاتصال. حاول مرة أخرى.';
            messageDiv.style.display = 'block';
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i> إرسال رابط إعادة التعيين';
        }
    });
});