// ================================================================
//  confirm-found.js - صفحة تأكيد العثور على الطفل (نسخة الموبايل)
//  استخدام Utils مباشرة + جودة ضغط أقل + مهلة 30 ثانية
// ================================================================

const Utils = window.Utils || {};

if (!window.Utils) {
    console.error('❌ utils.js لم يتم تحميله!');
    window.Utils = {
        fileToBase64: function(file) { return Promise.resolve(''); },
        compressImage: function(file, maxWidth, maxHeight, quality) { return Promise.resolve(file); },
        handleFilePreview: function(input, previewImg, placeholder) {}
    };
    Utils = window.Utils;
}

document.addEventListener('DOMContentLoaded', function() {
    console.log('📌 confirm-found.js تم تحميله (نسخة الموبايل)');

    const urlParams = new URLSearchParams(window.location.search);
    const reportId = urlParams.get('report');

    const form = document.getElementById('confirmFoundForm');
    const nameInput = document.getElementById('volunteerNameConfirm');
    const phoneInput = document.getElementById('volunteerPhoneConfirm');
    const frontInput = document.getElementById('frontIdInput');
    const backInput = document.getElementById('backIdInput');
    const frontPreview = document.getElementById('frontIdPreview');
    const backPreview = document.getElementById('backIdPreview');
    const frontPlaceholder = document.getElementById('frontIdPlaceholder');
    const backPlaceholder = document.getElementById('backIdPlaceholder');
    const submitBtn = document.getElementById('confirmSubmitBtn');
    const messageDiv = document.getElementById('confirmMessage');
    const reportIdDisplay = document.getElementById('reportIdDisplay');

    if (reportId) {
        reportIdDisplay.textContent = reportId;
    } else {
        reportIdDisplay.textContent = 'غير معروف';
        messageDiv.className = 'message-box error';
        messageDiv.textContent = '⚠️ لم يتم العثور على رقم البلاغ.';
        messageDiv.style.display = 'block';
        submitBtn.disabled = true;
    }

    frontInput.addEventListener('change', function() {
        Utils.handleFilePreview(this, frontPreview, frontPlaceholder);
    });

    backInput.addEventListener('change', function() {
        Utils.handleFilePreview(this, backPreview, backPlaceholder);
    });

    phoneInput.addEventListener('input', function(e) {
        this.value = this.value.replace(/[^0-9]/g, '');
    });

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        messageDiv.className = 'message-box';
        messageDiv.textContent = '';
        messageDiv.style.display = 'none';

        if (!reportId) {
            messageDiv.className = 'message-box error';
            messageDiv.textContent = '⚠️ رقم البلاغ غير صالح.';
            messageDiv.style.display = 'block';
            return;
        }

        const name = nameInput.value.trim();
        if (!name) {
            messageDiv.className = 'message-box error';
            messageDiv.textContent = '⚠️ يرجى إدخال اسمك كاملاً.';
            messageDiv.style.display = 'block';
            nameInput.focus();
            return;
        }

        const phone = phoneInput.value.trim();
        const cleanPhone = phone.replace(/\D/g, '');
        if (!phone || cleanPhone.length < 10) {
            messageDiv.className = 'message-box error';
            messageDiv.textContent = '⚠️ يرجى إدخال رقم هاتف صحيح.';
            messageDiv.style.display = 'block';
            phoneInput.focus();
            return;
        }

        const frontFile = frontInput.files[0];
        const backFile = backInput.files[0];
        if (!frontFile || !backFile) {
            messageDiv.className = 'message-box error';
            messageDiv.textContent = '⚠️ يرجى رفع صورتي البطاقة.';
            messageDiv.style.display = 'block';
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';

        try {
            // ✅ ضغط بجودة منخفضة جداً (0.2) وأبعاد 250
            const compressedFront = await Utils.compressImage(frontFile, 250, 250, 0.2);
            const compressedBack = await Utils.compressImage(backFile, 250, 250, 0.2);

            const frontBase64 = await Utils.fileToBase64(compressedFront);
            const backBase64 = await Utils.fileToBase64(compressedBack);

            const payload = {
                reportId: reportId,
                name: name,
                phone: cleanPhone,
                idFront: frontBase64,
                idBack: backBase64
            };

            // ✅ إضافة مهلة 30 ثانية
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            const response = await fetch('/api?action=volunteerFound', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const result = await response.json();
            console.log('📩 استجابة Vercel:', result);

            if (result.success) {
                messageDiv.className = 'message-box success';
                messageDiv.innerHTML = '✅ ' + (result.message || 'تم تأكيد العثور على الطفل بنجاح!');
                messageDiv.style.display = 'block';
                form.reset();
                frontPreview.style.display = 'none';
                frontPlaceholder.style.display = 'block';
                backPreview.style.display = 'none';
                backPlaceholder.style.display = 'block';
                submitBtn.innerHTML = '✅ تم الإرسال بنجاح';
                submitBtn.disabled = true;
            } else {
                messageDiv.className = 'message-box error';
                messageDiv.textContent = '❌ ' + (result.error || 'حدث خطأ، يرجى المحاولة مرة أخرى.');
                messageDiv.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-check-circle"></i> تأكيد العثور على الطفل';
            }

        } catch (err) {
            console.error('❌ خطأ في confirm-found:', err);
            messageDiv.className = 'message-box error';
            messageDiv.textContent = '⚠️ حدث خطأ في الاتصال. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.';
            messageDiv.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-check-circle"></i> تأكيد العثور على الطفل';
        }
    });
});