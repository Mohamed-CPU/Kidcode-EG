// ================================================================
//  unsubscribe.js - إلغاء الاشتراك من النشرة
//  تم التعديل ليتوافق مع الهيدر الموحد
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('📌 unsubscribe.js تم تحميله');

    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    const icon = document.getElementById('statusIcon');
    const title = document.getElementById('statusTitle');
    const message = document.getElementById('statusMessage');
    const actionBtn = document.getElementById('actionButton');

    // عرض حالة التحميل
    icon.className = 'status-icon loading';
    icon.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    title.textContent = 'جاري المعالجة';
    message.textContent = 'جارٍ التحقق من طلبك...';

    if (!token) {
        icon.className = 'status-icon error';
        icon.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
        title.textContent = 'رابط غير صحيح';
        title.className = 'error';
        message.innerHTML = 'لم يتم العثور على رمز إلغاء الاشتراك. يرجى التأكد من الرابط المستخدم.';
        actionBtn.innerHTML = '<a href="/" class="btn btn-primary">العودة للرئيسية</a>';
        return;
    }

    // إرسال طلب إلغاء الاشتراك إلى Vercel
    fetch(`/api?action=unsubscribe&token=${encodeURIComponent(token)}`, { cache: 'no-store' })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                icon.className = 'status-icon success';
                icon.innerHTML = '<i class="fas fa-check-circle"></i>';
                title.textContent = 'تم إلغاء الاشتراك';
                title.className = 'success';
                message.innerHTML = result.message || 'تم إلغاء اشتراكك من النشرة بنجاح. لن تصلك أي رسائل تنبيه مستقبلاً.';
                actionBtn.innerHTML = '<a href="/" class="btn btn-secondary">العودة للرئيسية</a>';
            } else {
                icon.className = 'status-icon error';
                icon.innerHTML = '<i class="fas fa-exclamation-circle"></i>';
                title.textContent = 'حدث خطأ';
                title.className = 'error';
                message.innerHTML = result.error || 'تعذر إلغاء الاشتراك. يرجى المحاولة مرة أخرى أو التواصل مع الدعم.';
                actionBtn.innerHTML = `
                    <div style="display:flex; flex-wrap:wrap; gap:10px; justify-content:center;">
                        <a href="/" class="btn btn-primary">العودة للرئيسية</a>
                        <a href="https://wa.me/201004135973" target="_blank" class="btn btn-secondary">
                            <i class="fab fa-whatsapp"></i> تواصل مع الدعم
                        </a>
                    </div>
                `;
            }
        })
        .catch(err => {
            console.error('❌ خطأ في إلغاء الاشتراك:', err);
            icon.className = 'status-icon error';
            icon.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
            title.textContent = 'خطأ في الاتصال';
            title.className = 'error';
            message.innerHTML = 'حدث خطأ في الاتصال بالخادم. يرجى المحاولة مرة أخرى لاحقاً.';
            actionBtn.innerHTML = `
                <div style="display:flex; flex-wrap:wrap; gap:10px; justify-content:center;">
                    <a href="/" class="btn btn-primary">العودة للرئيسية</a>
                    <a href="https://wa.me/201004135973" target="_blank" class="btn btn-secondary">
                        <i class="fab fa-whatsapp"></i> تواصل مع الدعم
                    </a>
                </div>
            `;
        });
});