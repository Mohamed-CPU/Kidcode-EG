// ================================================================
//  header.js - التحكم في قائمة الهامبورغر
//  يتم تضمينه في كل الصفحات مع الهيدر الموحد
//  تم التعديل لضمان العمل بعد تحميل الهيدر ديناميكياً
//  مع إضافة حد أقصى لإعادة المحاولة ومنع التكرار
// ================================================================

(function() {
    'use strict';

    // متغيرات للتحكم في إعادة المحاولة
    let retryCount = 0;
    const MAX_RETRIES = 15; // حد أقصى 15 محاولة (كل 100 مللي = 1.5 ثانية)
    let isInitialized = false;

    // دالة التهيئة الرئيسية
    function initHeader() {
        // منع التهيئة أكثر من مرة
        if (isInitialized) {
            console.log('ℹ️ الهيدر تم تهيئته مسبقاً، تخطي.');
            return;
        }

        const hamburgerBtn = document.getElementById('hamburgerBtn');
        const navMenu = document.getElementById('navMenu');
        const overlay = document.getElementById('navOverlay');

        // التأكد من وجود جميع العناصر
        if (!hamburgerBtn || !navMenu || !overlay) {
            retryCount++;
            if (retryCount < MAX_RETRIES) {
                console.log(`⏳ في انتظار تحميل عناصر الهيدر... (محاولة ${retryCount}/${MAX_RETRIES})`);
                setTimeout(initHeader, 100);
            } else {
                console.error('❌ فشل تحميل عناصر الهيدر بعد ' + MAX_RETRIES + ' محاولة.');
                // يمكن إضافة رسالة للمستخدم هنا إذا أردت
            }
            return;
        }

        // إذا وصلنا هنا، جميع العناصر موجودة
        isInitialized = true;
        console.log('✅ عناصر الهيدر موجودة، جاري ربط الأحداث...');

        // دالة فتح/إغلاق القائمة
        function toggleMenu() {
            hamburgerBtn.classList.toggle('active');
            navMenu.classList.toggle('open');
            overlay.classList.toggle('show');
            document.body.style.overflow = navMenu.classList.contains('open') ? 'hidden' : '';
        }

        // دالة إغلاق القائمة
        function closeMenu() {
            hamburgerBtn.classList.remove('active');
            navMenu.classList.remove('open');
            overlay.classList.remove('show');
            document.body.style.overflow = '';
        }

        // إضافة مستمع الحدث لزر الهامبورغر
        hamburgerBtn.addEventListener('click', toggleMenu);

        // إغلاق القائمة عند الضغط على الخلفية المظللة
        overlay.addEventListener('click', closeMenu);

        // إغلاق القائمة عند الضغط على أي رابط داخل القائمة
        document.querySelectorAll('.nav-list a').forEach(link => {
            link.addEventListener('click', closeMenu);
        });

        // إغلاق القائمة عند الضغط على زر ESC
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && navMenu.classList.contains('open')) {
                closeMenu();
            }
        });

        // منع تمرير الخلفية عند فتح القائمة على الموبايل
        document.addEventListener('touchmove', function(e) {
            if (navMenu.classList.contains('open') && !e.target.closest('.nav-menu')) {
                e.preventDefault();
            }
        }, { passive: false });

        console.log('✅ الهيدر الموحد تم تهيئته بنجاح');
    }

    // بدء التهيئة بعد تحميل الصفحة بالكامل
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        // إذا كانت الصفحة قد حملت بالفعل، نبدأ فوراً
        console.log('🔄 بدء تهيئة الهيدر (الصفحة جاهزة)...');
        setTimeout(initHeader, 50);
    } else {
        // وإلا ننتظر حدث DOMContentLoaded
        document.addEventListener('DOMContentLoaded', function() {
            console.log('🔄 DOMContentLoaded، بدء تهيئة الهيدر...');
            setTimeout(initHeader, 50);
        });
    }

})();