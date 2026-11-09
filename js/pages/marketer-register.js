// ================================================================
//  marketer-register.js - تسجيل مسوق جديد
//  الإصدار: 2026-09-19
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('registerForm');
    const nameInput = document.getElementById('regName');
    const phoneInput = document.getElementById('regPhone');
    const emailInput = document.getElementById('regEmail');
    const governorateSelect = document.getElementById('regGovernorate');
    const passInput = document.getElementById('regPassword');
    const confirmInput = document.getElementById('regConfirmPassword');
    const submitBtn = document.getElementById('registerBtn');
    const messageDiv = document.getElementById('registerMessage');

    // Success Modal
    const successModal = document.getElementById('successModal');
    const modalMarketerCode = document.getElementById('modalMarketerCode');
    const modalTelegramSection = document.getElementById('modalTelegramSection');
    const modalEmailSection = document.getElementById('modalEmailSection');
    const modalEmailAddress = document.getElementById('modalEmailAddress');
    const modalLinkTelegramBtn = document.getElementById('modalLinkTelegramBtn');
    const modalLoginBtn = document.getElementById('modalLoginBtn');

    // ============================================================
    //  منع غير الأرقام في الهاتف
    // ============================================================
    phoneInput.addEventListener('input', function() {
        this.value = this.value.replace(/[^0-9]/g, '');
    });

    // ============================================================
    //  Helpers
    // ============================================================
    function resetButton() {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-user-check"></i> إنشاء الحساب';
    }

    function showError(text) {
        messageDiv.className = 'message-box error';
        messageDiv.textContent = '⚠️ ' + text;
        messageDiv.style.display = 'block';
    }

    function getSelectedNotificationMethod() {
        const checked = document.querySelector('input[name="notificationMethod"]:checked');
        return checked ? checked.value : 'email';
    }

    // ============================================================
    //  Success Modal Logic
    // ============================================================
    function showSuccessModal(code, notificationMethod, email) {
        // إظهار الـ Modal
        successModal.style.display = 'flex';

        // عرض الكود
        modalMarketerCode.textContent = code;

        // إخفاء القسمين افتراضياً
        modalTelegramSection.style.display = 'none';
        modalEmailSection.style.display = 'none';
        modalLinkTelegramBtn.style.display = 'none';

        if (notificationMethod === 'telegram') {
            // ===== تليجرام: زر ربط =====
            modalTelegramSection.style.display = 'flex';
            modalLinkTelegramBtn.style.display = 'flex';
        } else {
            // ===== إيميل: عرض البريد فقط =====
            modalEmailSection.style.display = 'flex';
            modalEmailAddress.textContent = email || '---';
        }
    }

    // زر "اربط تليجرام الآن" — Deep Link للداشبورد
    if (modalLinkTelegramBtn) {
        modalLinkTelegramBtn.addEventListener('click', function() {
            window.location.href = '/marketer-dashboard?open=notifications';
        });
    }

    // زر "تسجيل الدخول"
    if (modalLoginBtn) {
        modalLoginBtn.addEventListener('click', function() {
            window.location.href = '/marketer-login';
        });
    }

    // ============================================================
    //  Form Submit
    // ============================================================
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        messageDiv.className = 'message-box';
        messageDiv.style.display = 'none';
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التسجيل...';

        const name = nameInput.value.trim();
        const phone = phoneInput.value.trim();
        const email = emailInput.value.trim();
        const governorate = governorateSelect.value;
        const password = passInput.value.trim();
        const confirm = confirmInput.value.trim();
        const notificationMethod = getSelectedNotificationMethod();

        // التحقق المبدئي
        if (!name || !phone || !email || !governorate || !password || !confirm) {
            showError('يرجى ملء جميع الحقول.');
            resetButton();
            return;
        }

        if (password.length < 8) {
            showError('كلمة السر يجب أن تكون 8 أحرف على الأقل.');
            resetButton();
            passInput.focus();
            return;
        }

        if (password !== confirm) {
            showError('كلمة السر غير متطابقة مع تأكيدها.');
            resetButton();
            confirmInput.focus();
            return;
        }

        try {
            const response = await fetch('/api', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'registerMarketer',
                    name: name,
                    phone: phone,
                    email: email,
                    governorate: governorate,
                    password: password,
                    confirmPassword: confirm,
                    notificationMethod: notificationMethod
                })
            });

            const result = await response.json();
            console.log('📩 registerMarketer:', result);

            if (result.success) {
                // ===== نجاح: عرض Modal =====
                const method = result.notificationMethod || notificationMethod;
                showSuccessModal(result.code, method, result.email);
                form.reset();
                resetButton();
            } else {
                messageDiv.className = 'message-box error';
                messageDiv.textContent = '❌ ' + (result.error || 'حدث خطأ غير معروف.');
                messageDiv.style.display = 'block';
                resetButton();
            }
        } catch (err) {
            console.error('❌ فشل الاتصال:', err);
            showError('حدث خطأ في الاتصال. حاول مرة أخرى.');
            resetButton();
        }
    });

    console.log('✅ marketer-register.js جاهز');
});