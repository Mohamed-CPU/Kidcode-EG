// ================================================================
//  index.js - الصفحة الرئيسية (نشرة المتطوعين + العروض)
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('📌 index.js تم تحميله');

    // ============================================================
    //  🎁 التحقق من نفاذ عروض الإطلاق وإخفاء الكارت
    // ============================================================
    async function checkLaunchOfferAvailability() {
        try {
            const response = await fetch('/api?action=config', { cache: 'no-store' });
            const config = await response.json();

            // لو العروض المتبقية صفر أو أقل
            if (config.success && config.remainingOffers <= 0) {
                console.log('⚠️ عروض الإطلاق نفذت، جاري إخفاء الكارت والعمود...');

                // 1. إخفاء الكارت من قسم الأسعار
                const launchCard = document.querySelector('.product-launch');
                if (launchCard) launchCard.style.display = 'none';

                // 2. إخفاء عمود "الإطلاق" من جدول المقارنة
                const launchHeaders = document.querySelectorAll('.launch-col');
                launchHeaders.forEach(th => th.style.display = 'none');

                // إخفاء خلايا العمود الثاني في كل صفوف الجدول (ما عدا صفوف العناوين)
                const tableRows = document.querySelectorAll('.comparison-table tbody tr:not(.category-row)');
                tableRows.forEach(row => {
                    const launchCell = row.querySelector('td:nth-child(2)');
                    if (launchCell) launchCell.style.display = 'none';
                });

                // 3. تعديل شكل الشبكة (Grid) عشان تبقى كارتين بس في النص
                const productsGrid = document.querySelector('.products-grid');
                if (productsGrid) {
                    productsGrid.classList.add('grid-2-cols');
                }
            }
        } catch (error) {
            console.warn('⚠️ فشل التحقق من حالة العروض:', error);
        }
    }

    // تشغيل الدالة فور تحميل الصفحة
    checkLaunchOfferAvailability();

    // ============================================================
    //  باقي الكود الخاص بنشرة المتطوعين (زي ما هو)
    // ============================================================
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
