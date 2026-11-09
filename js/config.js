// ============================================================
//  الإعدادات العامة للمشروع + تحميل مُبلِّغ الأخطاء
// ============================================================

const CONFIG = {
    API_URL: 'https://script.google.com/macros/s/AKfycbw86pnyJPYu36noh9p3Gwg611FCwMGbsaZ3uGiWXBMRj3mjIErsNyt6yMhvCFXsY_OC7w/exec',
    VERCELL_API_BASE: '/api',
    WHATSAPP_SUPPORT: '201004135973',
    PROJECT_NAME: 'KidCode-eg'
};

if (typeof window !== 'undefined') {
    window.CONFIG = CONFIG;

    // ============================================================
    //  🚨 تحميل مُبلِّغ الأخطاء تلقائيًا (مرة واحدة فقط)
    // ============================================================
    if (!window.__kcErrorReporterLoaded) {
        window.__kcErrorReporterLoaded = true;

        (function loadErrorReporter() {
            function inject() {
                try {
                    const script = document.createElement('script');
                    script.src = '/js/error-reporter.js?v=3';
                    script.async = true;
                    script.onerror = function() {
                        // فشل صامت — لا نعرض للمستخدم شيئًا
                    };
                    document.head.appendChild(script);
                } catch (e) {}
            }

            if (document.head) {
                inject();
            } else {
                document.addEventListener('DOMContentLoaded', inject, { once: true });
            }
        })();
    }
}