// ================================================================
//  confirm-received.js - تأكيد استلام الطفل (ولي الأمر)
//  الخطوة رقم 6 - مع إصلاح تعطيل الزر حتى تحميل البيانات
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('📌 confirm-received.js تم تحميله');

    // ===== استخراج reportId من الرابط =====
    const urlParams = new URLSearchParams(window.location.search);
    const reportId = urlParams.get('report');

    // ===== عناصر الصفحة =====
    const form = document.getElementById('confirmReceivedForm');
    const feedbackInput = document.getElementById('parentFeedback');
    const submitBtn = document.getElementById('confirmReceivedBtn');
    const messageDiv = document.getElementById('confirmMessage');
    const reportIdDisplay = document.getElementById('reportIdDisplay');
    const childNameDisplay = document.getElementById('childNameDisplay');
    const childIdDisplay = document.getElementById('childIdDisplay');
    const volunteerNameDisplay = document.getElementById('volunteerNameDisplay');
    const volunteerPhoneDisplay = document.getElementById('volunteerPhoneDisplay');
    const expiredWarning = document.getElementById('expiredWarning');

    // ===== تعطيل الزر في البداية حتى تحميل البيانات =====
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري تحميل البيانات...';

    // ===== عرض رقم البلاغ =====
    if (!reportId) {
        reportIdDisplay.textContent = 'غير معروف';
        messageDiv.className = 'message-box error';
        messageDiv.textContent = '⚠️ رقم البلاغ غير موجود. يرجى التأكد من الرابط المستخدم.';
        messageDiv.style.display = 'block';
        submitBtn.disabled = true;
        submitBtn.innerHTML = 'رابط غير صحيح';
        return;
    }

    reportIdDisplay.textContent = reportId;

    // ===== جلب بيانات البلاغ =====
    async function loadReportData() {
        try {
            const response = await fetch(`/api?action=getReportDetails&reportId=${encodeURIComponent(reportId)}`, { cache: 'no-store' });
            const result = await response.json();

            if (result.success) {
                const data = result.data;

                childNameDisplay.textContent = data.childName || 'غير معروف';
                childIdDisplay.textContent = data.childID || 'غير معروف';
                volunteerNameDisplay.textContent = data.volunteerName || 'غير متوفر';
                volunteerPhoneDisplay.textContent = data.volunteerPhone || 'غير متوفر';

                // التحقق من حالة البلاغ
                if (data.isResolved === 'نعم') {
                    expiredWarning.style.display = 'block';
                    expiredWarning.textContent = 'هذا البلاغ تم حله بالفعل.';
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = 'تم إغلاق البلاغ مسبقاً';
                } else if (data.isResolved === 'awaiting_confirmation') {
                    expiredWarning.style.display = 'none';
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fas fa-check"></i> تأكيد استلام الطفل وإغلاق البلاغ';
                } else {
                    expiredWarning.style.display = 'block';
                    expiredWarning.textContent = 'هذا البلاغ غير صالح للتأكيد.';
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = 'البلاغ غير صالح';
                }
            } else {
                messageDiv.className = 'message-box error';
                messageDiv.textContent = '❌ ' + (result.error || 'حدث خطأ أثناء تحميل البيانات.');
                messageDiv.style.display = 'block';
                submitBtn.disabled = true;
                submitBtn.innerHTML = 'خطأ في التحميل';
            }

        } catch (err) {
            console.error('❌ خطأ في loadReportData:', err);
            messageDiv.className = 'message-box error';
            messageDiv.textContent = '⚠️ حدث خطأ في الاتصال. يرجى المحاولة مرة أخرى.';
            messageDiv.style.display = 'block';
            submitBtn.disabled = true;
            submitBtn.innerHTML = 'خطأ في الاتصال';
        }
    }

    loadReportData();

    // ===== إرسال نموذج التأكيد =====
    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        messageDiv.className = 'message-box';
        messageDiv.textContent = '';
        messageDiv.style.display = 'none';

        if (submitBtn.disabled) return;

        const feedback = feedbackInput.value.trim();

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التأكيد...';

        try {
            const payload = {
                reportId: reportId,
                feedback: feedback
            };

            const response = await fetch('/api?action=confirmReceived', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (result.success) {
                messageDiv.className = 'message-box success';
                messageDiv.innerHTML = '✅ ' + (result.message || 'تم تأكيد استلام الطفل بنجاح! تم إغلاق البلاغ وشكراً لك على استخدام KidCode-eg.');
                messageDiv.style.display = 'block';
                submitBtn.innerHTML = '<i class="fas fa-check-circle"></i> تم التأكيد بنجاح';
                submitBtn.disabled = true;
                form.reset();
            } else {
                messageDiv.className = 'message-box error';
                messageDiv.textContent = '❌ ' + (result.error || 'حدث خطأ أثناء تأكيد الاستلام.');
                messageDiv.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-check"></i> تأكيد استلام الطفل وإغلاق البلاغ';
            }

        } catch (err) {
            console.error('❌ خطأ في confirm-received:', err);
            messageDiv.className = 'message-box error';
            messageDiv.textContent = '⚠️ حدث خطأ في الاتصال. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.';
            messageDiv.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-check"></i> تأكيد استلام الطفل وإغلاق البلاغ';
        }
    });
});