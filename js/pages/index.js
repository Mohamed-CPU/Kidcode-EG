// ================================================================
//  index.js - الصفحة الرئيسية (نشرة المتطوعين)
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('📌 index.js تم تحميله');

    const form = document.getElementById('newsletterForm');
    const nameInput = document.getElementById('volunteerName');
    const emailInput = document.getElementById('volunteerEmail');
    const phoneInput = document.getElementById('volunteerPhone');
    const messageDiv = document.getElementById('newsletterMessage');
    const submitBtn = document.getElementById('subscribeBtn');

    if (!form) return;

    // منع إدخال غير الأرقام في حقل الهاتف
    if (phoneInput) {
        phoneInput.addEventListener('input', function(e) {
            this.value = this.value.replace(/[^0-9+]/g, '');
        });
    }

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        // تنظيف الرسالة السابقة
        messageDiv.className = 'newsletter-message';
        messageDiv.textContent = '';

        // التحقق من صحة البيانات
        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        const phone = phoneInput.value.trim();

        if (!name) {
            messageDiv.className = 'newsletter-message error';
            messageDiv.textContent = '⚠️ الاسم كاملاً مطلوب.';
            nameInput.focus();
            return;
        }

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            messageDiv.className = 'newsletter-message error';
            messageDiv.textContent = '⚠️ بريد إلكتروني غير صحيح.';
            emailInput.focus();
            return;
        }

        const cleanPhone = phone.replace(/\D/g, '');
        if (!phone || cleanPhone.length < 10) {
            messageDiv.className = 'newsletter-message error';
            messageDiv.textContent = '⚠️ رقم هاتف غير صحيح (10 أرقام على الأقل).';
            phoneInput.focus();
            return;
        }

        // تعطيل الزر أثناء الإرسال
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التسجيل...';

        try {
            const payload = new URLSearchParams();
            payload.append('action', 'subscribeNewsletter');
            payload.append('name', name);
            payload.append('email', email);
            payload.append('phone', cleanPhone);

            // إرسال مباشر إلى GAS (تجاوز Vercel لتجنب أي تأخير)
            const GAS_URL = CONFIG.API_URL;
            const response = await fetch(GAS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: payload.toString()
            });

            const result = await response.json();

            if (result.success) {
                messageDiv.className = 'newsletter-message success';
                messageDiv.innerHTML = `✅ ${result.message || 'تم التسجيل بنجاح! سيصلك بريد تأكيد قريباً.'}`;
                form.reset();
            } else {
                messageDiv.className = 'newsletter-message error';
                messageDiv.textContent = '❌ ' + (result.error || 'حدث خطأ، يرجى المحاولة مرة أخرى.');
            }

        } catch (err) {
            console.error('❌ خطأ في تسجيل النشرة:', err);
            messageDiv.className = 'newsletter-message error';
            messageDiv.textContent = '⚠️ حدث خطأ في الاتصال. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.';
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-bell"></i> اشترك في النشرة';
        }
    });
});