// ================================================================
//  demoRegister.js - صفحة تسجيل التجربة (للطفل KC-01007)
//  تم التعديل: استخدام fetch بدلاً من google.script.run
//  - جعل الاسم إجبارياً
//  - تقييد رقم الهاتف بـ 11 رقماً فقط
//  - فلترة الأحرف غير الرقمية من حقل الهاتف
// ================================================================

(function() {
    const nameInput = document.getElementById('fullName');
    const emailInput = document.getElementById('demoEmail');
    const phoneInput = document.getElementById('demoPhone');
    const agreeCheck = document.getElementById('agreeCheck');
    const startBtn = document.getElementById('startBtn');
    const statusDiv = document.getElementById('statusMsg');

    // منع إدخال غير الأرقام في حقل الهاتف
    phoneInput.addEventListener('input', function() {
        this.value = this.value.replace(/[^0-9]/g, '');
    });

    function toggleButton() {
        startBtn.disabled = !agreeCheck.checked;
    }
    agreeCheck.addEventListener('change', toggleButton);
    toggleButton();

    startBtn.addEventListener('click', function() {
        statusDiv.innerHTML = '';
        
        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        const phone = phoneInput.value.trim();

        // التحقق من الاسم (إجباري)
        if (!name) {
            statusDiv.innerHTML = '<span style="color:#e53e3e;">⚠️ الرجاء إدخال الاسم كاملاً.</span>';
            nameInput.focus();
            return;
        }

        // التحقق من البريد الإلكتروني
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            statusDiv.innerHTML = '<span style="color:#e53e3e;">⚠️ الرجاء إدخال بريد إلكتروني صحيح.</span>';
            emailInput.focus();
            return;
        }

        // تنظيف رقم الهاتف والتحقق من الطول (11 رقماً بالضبط)
        const cleanPhone = phone.replace(/\D/g, '');
        if (!cleanPhone || cleanPhone.length !== 11) {
            statusDiv.innerHTML = '<span style="color:#e53e3e;">⚠️ الرجاء إدخال رقم هاتف صحيح (11 رقم، مثال: 01012345678).</span>';
            phoneInput.focus();
            return;
        }

        if (!agreeCheck.checked) {
            statusDiv.innerHTML = '<span style="color:#e53e3e;">⚠️ يجب الموافقة على الشروط أولاً.</span>';
            return;
        }

        startBtn.disabled = true;
        startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري إنشاء الجلسة...';
        statusDiv.innerHTML = '<span style="color:#2b4e8a;">⏳ جاري التحقق...</span>';

        const payload = {
            name: name,
            email: email,
            phone: cleanPhone
        };

        fetch('/api?action=demoRegister', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(response => response.json())
        .then(response => {
            if (response.success && response.redirectUrl) {
                statusDiv.innerHTML = '<span style="color:#22c55e;">✅ تم إنشاء الجلسة! جاري التوجيه...</span>';
                setTimeout(function() {
                    // ✅ replace بدل href — عشان زر الـ Back ميلاقيش صفحة التسجيل
                    window.location.replace(response.redirectUrl);
                }, 500);
            } else {
                statusDiv.innerHTML = '<span style="color:#e53e3e;">❌ ' + (response.error || 'حدث خطأ غير معروف') + '</span>';
                startBtn.disabled = false;
                startBtn.innerHTML = '<i class="fas fa-rocket"></i> ابدأ التجربة';
            }
        })
        .catch(function(error) {
            statusDiv.innerHTML = '<span style="color:#e53e3e;">❌ فشل الاتصال بالخادم: ' + error.message + '</span>';
            startBtn.disabled = false;
            startBtn.innerHTML = '<i class="fas fa-rocket"></i> ابدأ التجربة';
        });
    });
})();