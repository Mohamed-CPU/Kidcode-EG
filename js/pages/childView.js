// ================================================================
//  childView.js - صفحة عرض بيانات الطفل (إصدار DRY النظيف)
// ================================================================

if (!window.Utils) {
    console.error('❌ utils.js لم يتم تحميله!');
    window.Utils = {
        formatInternational: function(digits) {
            if (!digits) return '';
            if (digits.startsWith('20') && digits.length === 12) return digits;
            if (digits.startsWith('0') && digits.length === 11) return '20' + digits.substring(1);
            if (digits.length === 10 || digits.length === 11) return '20' + digits;
            return digits;
        },
        formatLocal: function(digits) {
            if (!digits) return '';
            if (digits.startsWith('20') && digits.length === 12) return '0' + digits.substring(2);
            if (digits.startsWith('0')) return digits;
            if (digits.length === 10) return '0' + digits;
            return digits;
        }
    };
}

// ============================================================
//  المتغيرات العامة
// ============================================================
var childInfo = {
    name: "",
    fatherIntl: "",
    motherIntl: "",
    id: "",
    token: "",
    demoToken: ""
};
var currentLocationLink = '';
var mainBtn = null;
var msgEl = null;
var tokenExpiryTime = null;
var activeReportData = null;

// ============================================================
//  ✅ دوال إدارة حالة التتبع الدوري (localStorage)
// ============================================================

function getTickState(childID) {
    try {
        const key = 'kc_tick_state_' + childID;
        const stored = localStorage.getItem(key);
        if (!stored) return null;
        const parsed = JSON.parse(stored);
        if (!parsed || typeof parsed !== 'object') return null;
        if (typeof parsed.token !== 'string' || typeof parsed.lastTickAt !== 'number') return null;
        return parsed;
    } catch (e) {
        return null;
    }
}

function setTickState(childID, token, lastTickAt) {
    try {
        const key = 'kc_tick_state_' + childID;
        localStorage.setItem(key, JSON.stringify({ token: token, lastTickAt: lastTickAt }));
    } catch (e) {
        console.warn('⚠️ [TickState] فشل الحفظ:', e);
    }
}

function clearTickState(childID) {
    try {
        const key = 'kc_tick_state_' + childID;
        localStorage.removeItem(key);
    } catch (e) {}
}

// ============================================================
//  دوال مساعدة
// ============================================================
function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        id: params.get('id') || '',
        tempToken: params.get('tempToken') || ''
    };
}

// ============================================================
//  جلب البيانات وعرضها
// ============================================================
async function fetchTokenAndData() {
    const { id, tempToken } = getUrlParams();
    const urlParams = new URLSearchParams(window.location.search);
    const demoToke = urlParams.get('demo') || '';

    try {
        const expiredToken = sessionStorage.getItem('kc_session_expired_token');
        const expiredAtStr = sessionStorage.getItem('kc_session_expired_at');
        // ✅ للجلسات التجريبية: نستخدم demoToke الفريد بدل 'demo' الثابت
        const urlToken = tempToken || demoToke || 'demo';

        if (expiredToken && expiredToken === urlToken) {
            // ✅ حماية إضافية: لو العلم قديم (> 60 ثانية) اعتبره stale
            let ageMs = Infinity;
            if (expiredAtStr) {
                const t = new Date(expiredAtStr).getTime();
                if (!isNaN(t)) ageMs = Date.now() - t;
            }
            const STALE_THRESHOLD_MS = 60 * 1000;

            if (ageMs > STALE_THRESHOLD_MS) {
                console.log('🧹 علم منتهي قديم — امسح وكمّل');
                sessionStorage.removeItem('kc_session_expired_token');
                sessionStorage.removeItem('kc_session_expired_at');
                // نكمل عادي (هنحاول نجيب البيانات)
            } else {
                console.log('🚫 الجلسة منتهية (نفس التوكن حديث)');
                showTimeoutModal();
                return;
            }
        } else if (expiredToken && expiredToken !== urlToken) {
            // ✅ توكن جديد — امسح الـ flag
            console.log('🆕 توكن جديد — مسح الـ expiry flag');
            sessionStorage.removeItem('kc_session_expired_token');
            sessionStorage.removeItem('kc_session_expired_at');
        }
    } catch (e) {}

    if (id === 'KC-01007') {
        if (!demoToke) {
            window.location.href = '/demoRegister.html';
            return;
        }
    }

    if (!id) {
        showError('❌ الرابط غير صحيح، يرجى مسح رمز QR مرة أخرى.');
        return;
    }

    if (!tempToken && id !== 'KC-01007') {
        showError(`
            ⚠️ الرابط غير صالح أو منتهي الصلاحية.<br>
            <span style="font-size: 0.9rem; font-weight: 400; display: block; margin-top: 8px;">
                يرجى <strong>إعادة مسح رمز QR</strong> للحصول على رابط جديد.
            </span>
            <br>
            <a href="/" style="color: var(--primary-color); font-weight: 700; text-decoration: underline;">العودة للرئيسية</a>
        `);
        return;
    }

    const loadingSpinner = document.getElementById('loadingSpinner');
    const errorSection = document.getElementById('errorSection');
    const mainContent = document.getElementById('mainContent');

    // التحقق من وجود mainContent
    if (!mainContent) {
        console.error('❌ mainContent غير موجود في DOM');
        return;
    }

    loadingSpinner.classList.remove('hidden');
    errorSection.classList.add('hidden');
    mainContent.classList.add('hidden');

    try {
        let finalToken = tempToken;
        const finalId = id;

        // ✅ Vercel مباشر (بدون GAS)
        let url = '/api?action=child&id=' + encodeURIComponent(finalId);
        if (finalToken) {
            url += '&tempToken=' + encodeURIComponent(finalToken);
        }
        if (demoToke) {
            url += '&demo=' + encodeURIComponent(demoToke);
        }

        console.log('📤 جلب البيانات من:', url);
        const dataRes = await fetch(url, { cache: 'no-store' });
        const data = await dataRes.json();

        console.log('📩 استجابة الخادم:', data);

        if (data.success && data.child) {
            const fatherPhoneRaw = data.child.fatherPhone || '';
            const motherPhoneRaw = data.child.motherPhone || '';

            const fatherDigits = String(fatherPhoneRaw).replace(/\D/g, '');
            const motherDigits = String(motherPhoneRaw).replace(/\D/g, '');

            let fatherIntl = window.Utils.formatInternational(fatherDigits);
            let motherIntl = window.Utils.formatInternational(motherDigits);

            childInfo.id = data.child.id;
            childInfo.name = data.child.name || 'غير معروف';
            childInfo.fatherIntl = fatherIntl;
            childInfo.motherIntl = motherIntl;
            childInfo.token = finalToken || 'demo';
            childInfo.demoToken = demoToke;

            activeReportData = data.child.activeReport || null;

            renderChildData(data.child);
            renderAlertBar(data.child);

            // ✅ استخدام expiresAt من الخادم بدل حساب محلي
            if (data.expiresAt) {
                // ✅ تفسير آمن للتاريخ (يفترض UTC لو مفيش إشارة)
                tokenExpiryTime = (window.Utils && typeof window.Utils.parseToDate === 'function')
                    ? window.Utils.parseToDate(data.expiresAt)
                    : new Date(data.expiresAt);

                // 🔧 حماية: لو الناتج غير صالح → fallback 5 دقائق
                if (!tokenExpiryTime || isNaN(tokenExpiryTime.getTime())) {
                    console.warn('⚠️ [Timer] expiresAt غير صالح، fallback 5 دقائق:', data.expiresAt);
                    tokenExpiryTime = new Date(Date.now() + 5 * 60 * 1000);
                }
            } else {
                // Fallback لو الخادم ما بعتش (نسخة قديمة)
                tokenExpiryTime = new Date(Date.now() + 5 * 60 * 1000);
            }

            // ✅ مسح أي interval قديم قبل بدء واحد جديد
            if (window.__tokenTimerInterval) {
                clearInterval(window.__tokenTimerInterval);
                window.__tokenTimerInterval = null;
            }

            startTokenTimer();

            // ✅ فحص فوري — لو الوقت انتهى بالفعل
            if (tokenExpiryTime && Date.now() >= tokenExpiryTime.getTime()) {
                console.log('⏰ [Initial] الوقت انتهى بالفعل — عرض المودال');
                showTimeoutModal();
                return;
            }

            // ✅ إزالة الكلاس hidden وتعيين display: block بشكل صريح
            loadingSpinner.classList.add('hidden');
            mainContent.classList.remove('hidden');
            mainContent.style.display = 'block';

            // تأكيد في Console
            console.log('✅ mainContent تم إظهاره، display:', mainContent.style.display);
            console.log('✅ mainContent classes:', mainContent.className);

            mainBtn = document.getElementById('mainFoundBtn');
            msgEl = document.getElementById('foundMsg');

            autoRecordLocation();

        } else {
            // ✅ القراءة من data.code (الجديد) أو data.error (القديم) — أول حاجة
            const errorCode = data.code || data.error || 'unknown';
            const errorMsg = data.message || 'حدث خطأ غير معروف';
            let userFriendlyMsg = '';

            // ✅ لو الخطأ يخص انتهاء الصلاحية، احفظها للـ persistence
            if (errorCode === 'invalid_token' || errorCode === 'invalid_or_expired_token') {
                try {
                    sessionStorage.setItem('kc_session_expired_token', tempToken || 'demo');
                    sessionStorage.setItem('kc_session_expired_at', new Date().toISOString());
                } catch (e) {}
            }

            if (errorCode === 'account_pending' || errorCode === 'pending') {
                userFriendlyMsg = `
                    ⏳ <strong>الحساب قيد التفعيل</strong><br>
                    <span style="font-size:0.9rem; display:block; margin-top:8px;">
                        جاري مراجعة طلب التسجيل. سيتم التفعيل خلال <strong>24 ساعة</strong>.
                    </span>
                `;
            } else if (errorCode === 'account_expired' || errorCode === 'expired') {
                userFriendlyMsg = `
                    ⏰ <strong>انتهى اشتراك هذا الحساب</strong><br>
                    <span style="font-size:0.9rem; display:block; margin-top:8px;">
                        لتجديد الاشتراك يرجى التواصل مع <strong>فريق المبيعات</strong>:
                    </span>
                    <div style="margin-top:16px; display:flex; flex-direction:column; gap:10px; max-width:300px; margin-left:auto; margin-right:auto;">
                        <a href="https://wa.me/201004135973?text=${encodeURIComponent('السلام عليكم، أود تجديد اشتراك الطفل ' + (data.childID || id || ''))}"
                        target="_blank"
                        style="display:inline-block; background:#25D366; color:white; padding:12px 24px; text-decoration:none; border-radius:30px; font-weight:bold;">
                        💬 تواصل عبر واتساب
                        </a>
                        <a href="mailto:sales@kidcode-eg.com?subject=${encodeURIComponent('تجديد اشتراك منتهي - ' + (data.childID || id || ''))}&body=${encodeURIComponent('السلام عليكم،\n\nأود تجديد اشتراك الطفل ' + (data.childID || id || '') + '.\n\nشكراً لكم.')}"
                        style="display:inline-block; background:#22559f; color:white; padding:12px 24px; text-decoration:none; border-radius:30px; font-weight:bold;">
                        ✉️ راسل المبيعات
                        </a>
                    </div>
                `;
            } else if (errorCode === 'account_suspended' || errorCode === 'suspended') {
                userFriendlyMsg = '🚫 <strong>هذا الحساب موقوف مؤقتاً.</strong><br>يرجى التواصل مع الدعم لمعرفة السبب.';
            } else if (errorCode === 'account_inactive' || errorCode === 'inactive') {
                userFriendlyMsg = '⛔ <strong>هذا الحساب غير نشط حالياً.</strong><br>يرجى التواصل مع الدعم لمعرفة السبب.';
            } else if (errorCode === 'demo_session_expired') {
                userFriendlyMsg = '⏰ انتهت صلاحية جلسة التجربة (5 دقائق).<br><a href="/demoRegister.html" style="color:#22559f; font-weight:bold; text-decoration:underline;">سجل تجربة جديدة</a>';
            } else if (errorCode === 'invalid_token' || errorCode === 'invalid_or_expired_token') {
                userFriendlyMsg = `
                    ⚠️ <strong>هذا الرابط غير صالح أو منتهي الصلاحية</strong><br>
                    <span style="font-size: 0.9rem; font-weight: 400; display: block; margin-top: 8px;">
                        تم إنشاء هذا الرابط لفترة محدودة (5 دقائق) لأغراض الأمان.
                    </span>
                    <br>
                    <a href="/" style="color: var(--primary-color); font-weight: 700; text-decoration: underline;">العودة للرئيسية</a>
                `;
            } else if (errorCode === 'child_not_found') {
                userFriendlyMsg = '❓ لا يوجد طفل مسجل بهذا المعرف.<br>تأكد من صحة رمز QR.';
            } else {
                userFriendlyMsg = errorMsg;
            }

            showError(userFriendlyMsg);
        }
    } catch (err) {
        console.error('❌ خطأ في fetchTokenAndData:', err);
        if (id === 'KC-01007') {
            showError('❌ خطأ في الإتصال بالخادم: ' + err.message + ' <br><a href="/demoRegister.html" style="color:#22559f; font-weight:bold; text-decoration:underline;">العودة للتسجيل التجريبي</a>');
            return;
        }
        showError('❌ خطأ في الإتصال بالخادم: ' + err.message);
    }
}

// ============================================================
//  عرض بيانات الطفل
// ============================================================
function renderChildData(child) {
    document.getElementById('childNameDisplay').textContent = child.name || 'غير معروف';
    document.getElementById('childAgeDisplay').textContent = child.age || 'غير محدد';
    document.getElementById('childAddressDisplay').textContent = child.detailedAddress || 'غير محدد';
    document.getElementById('childIdDisplay').textContent = child.id || '---';

    const mapsRow = document.getElementById('googleMapsRow');
    const mapsLink = document.getElementById('googleMapsLink');
    if (child.googleMaps && child.googleMaps.trim() !== '') {
        mapsLink.href = child.googleMaps;
        mapsLink.textContent = 'عرض الموقع';
        mapsRow.classList.remove('hidden');
    } else {
        mapsRow.classList.add('hidden');
    }

    // ✅ child.imageUrl جاي جاهز من backend بعد التعديل، مش محتاج تعديل هنا
    const img = document.getElementById('childImageMain');
    const placeholder = document.getElementById('noImagePlaceholder');
    if (child.imageUrl && child.imageUrl.trim() !== '') {
        img.src = child.imageUrl;
        img.classList.remove('hidden');
        placeholder.classList.add('hidden');
        img.onclick = function() { openImageModal(this.src); };
    } else {
        img.classList.add('hidden');
        placeholder.classList.remove('hidden');
    }

    const notesContainer = document.getElementById('notesContainer');
    if (child.notes && Array.isArray(child.notes) && child.notes.length > 0) {
        let html = '';
        child.notes.forEach(note => {
            html += `<p>• ${note}</p>`;
        });
        notesContainer.innerHTML = html;
    } else {
        notesContainer.innerHTML = 'لا توجد ملاحظات';
    }

    renderContactButtons(child);
}

function renderAlertBar(child) {
    const alertBar = document.getElementById('alertBar');
    const alertText = document.getElementById('alertText');
    const mainContent = document.getElementById('mainContent');

    if (!alertBar) return;

    const hasActiveReport = child.hasActiveReport === true;
    const report = child.activeReport || null;

    if (mainContent) {
        if (hasActiveReport && report) {
            mainContent.classList.remove('no-alert');
        } else {
            mainContent.classList.add('no-alert');
        }
    }

    if (hasActiveReport && report) {
        alertBar.style.display = 'flex';

        let details = [];
        if (report.clothes) details.push(`الملابس: ${report.clothes}`);
        if (report.governorate) details.push(`المحافظة: ${report.governorate}`);
        if (report.district) details.push(`الحي: ${report.district}`);
        if (report.landmark) details.push(`العلامة المميزة: ${report.landmark}`);

        const detailsText = details.length > 0 ? ` - ${details.join(' | ')}` : '';

        if (report.status === 'awaiting_confirmation') {
            alertText.textContent = `⚠️ تم الإبلاغ عن العثور على الطفل، في انتظار تأكيد الأسرة${detailsText}`;
        } else {
            alertText.textContent = `🚨 تنبيه: طفل مفقود${detailsText}`;
        }

        const emergencyBtns = document.querySelector('.emergency-buttons');
        if (emergencyBtns) emergencyBtns.style.display = 'flex';
        const contactBtns = document.querySelector('.contact-buttons');
        if (contactBtns) contactBtns.style.display = 'flex';
    } else {
        alertBar.style.display = 'none';
    }
}

// ============================================================
//  📱 بناء رسالة "العثور على الطفل" (للواتساب)
//  - بتحتوي على اسم الطفل + الموقع (لو متوفر)
// ============================================================
function buildWhatsAppFoundMessage() {
    const childName = childInfo.name || 'الطفل';
    const childID = childInfo.id || '';
    const isDemo = (childID === 'KC-01007');

    const lines = [];

    // Header
    if (isDemo) {
        lines.push('📢 تنبيه تجريبي');
    } else {
        lines.push('🚨 تنبيه هام');
    }
    lines.push('');

    // Child info
    let header = 'تم العثور على الطفل ' + childName;
    if (childID) header += ' (' + childID + ')';
    lines.push(header);

    // ✅ الموقع (لو متوفر فقط)
    if (currentLocationLink) {
        lines.push('');
        lines.push('📍 الموقع الحالي:');
        lines.push(currentLocationLink);
    }

    // Footer
    lines.push('');
    lines.push('يرجى التواصل فوراً.');

    return lines.join('\n');
}

// ============================================================
//  📱 فتح واتساب الأب / الأم مع الرسالة الجاهزة
// ============================================================
function openWhatsAppForParent(parentType) {
    const phone = parentType === 'father'
        ? childInfo.fatherIntl
        : childInfo.motherIntl;

    if (!phone) {
        console.warn('⚠️ [openWhatsAppForParent] رقم مفقود:', parentType);
        return;
    }

    const message = buildWhatsAppFoundMessage();
    const waLink = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(message);

    console.log('📱 فتح واتساب', parentType, '| الموقع متوفر:', !!currentLocationLink);

    window.open(waLink, '_blank');
}

function renderContactButtons(child) {
    const container = document.getElementById('contactButtons');
    let html = '';

    const fatherRaw = child.fatherPhone || '';
    const motherRaw = child.motherPhone || '';

    const fatherDigits = String(fatherRaw).replace(/\D/g, '');
    const motherDigits = String(motherRaw).replace(/\D/g, '');

    const fatherLocal = window.Utils.formatLocal(fatherDigits);
    const motherLocal = window.Utils.formatLocal(motherDigits);
    const fatherIntl = window.Utils.formatInternational(fatherDigits);
    const motherIntl = window.Utils.formatInternational(motherDigits);

    childInfo.fatherIntl = fatherIntl;
    childInfo.motherIntl = motherIntl;

    if (fatherLocal) {
        html += `<a href="tel:${fatherLocal}" class="btn-call">
                    <i class="fas fa-phone-alt"></i> اتصل بالأب
                </a>`;
    }
    if (motherLocal) {
        html += `<a href="tel:${motherLocal}" class="btn-call">
                    <i class="fas fa-phone-alt"></i> اتصل بالأم
                </a>`;
    }
    if (fatherIntl) {
        html += `<a href="#" data-wa-parent="father" class="btn-wa">
                    <i class="fab fa-whatsapp"></i> واتساب الأب
                </a>`;
    }
    if (motherIntl) {
        html += `<a href="#" data-wa-parent="mother" class="btn-wa">
                    <i class="fab fa-whatsapp"></i> واتساب الأم
                </a>`;
    }

    if (html === '') {
        html = '<p class="no-contacts">لا توجد أرقام تواصل مسجلة</p>';
    }

    container.innerHTML = html;

    // ✅ ربط أزرار الواتساب بـ Click Handler
    // (يضمن إن الموقع يُقرأ في لحظة الضغط — لو اتوفر بعد ما الصفحة فتحت)
    container.querySelectorAll('[data-wa-parent]').forEach(function(link) {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            openWhatsAppForParent(link.getAttribute('data-wa-parent'));
        });
    });
}

function showTimeoutModal() {
    const modal = document.getElementById('timeoutModal');
    if (modal) {
        modal.classList.add('show');
        modal.style.display = 'flex';
    }
    const mainContent = document.getElementById('mainContent');
    if (mainContent) mainContent.style.display = 'none';
    const loading = document.getElementById('loadingSpinner');
    if (loading) loading.style.display = 'none';
    const error = document.getElementById('errorSection');
    if (error) error.style.display = 'none';
}

// ============================================================
//  دوال الأخطاء
// ============================================================
function showError(message) {
    document.getElementById('loadingSpinner').classList.add('hidden');
    document.getElementById('mainContent').classList.add('hidden');
    const errorSection = document.getElementById('errorSection');
    errorSection.classList.remove('hidden');
    document.getElementById('errorMessage').innerHTML = message;
}

function startTokenTimer() {
    // 🔧 حماية: لو tokenExpiryTime غير صالح → fallback 5 دقائق
    if (!tokenExpiryTime || isNaN(tokenExpiryTime.getTime())) {
        console.warn('⚠️ [Timer] tokenExpiryTime غير صالح — fallback 5 دقائق');
        tokenExpiryTime = new Date(Date.now() + 5 * 60 * 1000);
    }

    // ✅ مسح أي interval قديم قبل بدء واحد جديد
    if (window.__tokenTimerInterval) {
        clearInterval(window.__tokenTimerInterval);
        window.__tokenTimerInterval = null;
    }

    // ✅ اربط visibility check + pageshow (مرة واحدة)
    bindVisibilityCheckForToken();

    window.__tokenTimerInterval = setInterval(function() {
        const now = new Date().getTime();
        const remaining = tokenExpiryTime.getTime() - now;

        if (remaining <= 0) {
            // ✅ إيقاف الـ timer
            clearInterval(window.__tokenTimerInterval);
            window.__tokenTimerInterval = null;

            // ✅ إيقاف التتبع الدوري للموقع (المهم!)
            if (window.__locationTrackingInterval) {
                clearTimeout(window.__locationTrackingInterval);
                window.__locationTrackingInterval = null;
                console.log('⏹️ [Tracking] توقف مع انتهاء الجلسة');
            }

                        // ✅ حفظ حالة الانتهاء للـ persistence
            try {
                // للجلسات التجريبية: نستخدم demoToke الفريد
                const tokenToStore = childInfo.demoToken 
                                  || childInfo.token 
                                  || 'demo';
                sessionStorage.setItem('kc_session_expired_token', tokenToStore);
                sessionStorage.setItem('kc_session_expired_at', new Date().toISOString());
            } catch (e) {}

            // ✅ إظهار المودال وإخفاء المحتوى
            showTimeoutModal();
        }
    }, 1000);
}

// ============================================================
//  👁️ فحص فوري عند رجوع التاب (للموبايل + bfcache + سيرفر)
//  - فحص محلي فوري (tokenExpiryTime)
//  - + فحص سيرفر (الحكم النهائي — يحمي من ساعة الجهاز الغلط)
//  - + pageshow لمعالجة استرجاع bfcache
// ============================================================
function bindVisibilityCheckForToken() {
    if (window.__tokenVisibilityBound) return;
    window.__tokenVisibilityBound = true;

    function showExpiredOnce() {
        if (window.__timeoutModalShown) return;
        window.__timeoutModalShown = true;

        if (window.__tokenTimerInterval) {
            clearInterval(window.__tokenTimerInterval);
            window.__tokenTimerInterval = null;
        }
        if (window.__locationTrackingInterval) {
            clearTimeout(window.__locationTrackingInterval);
            window.__locationTrackingInterval = null;
        }
        try {
            const tokenToStore = childInfo.demoToken || childInfo.token || 'demo';
            sessionStorage.setItem('kc_session_expired_token', tokenToStore);
            sessionStorage.setItem('kc_session_expired_at', new Date().toISOString());
        } catch (e) {}
        showTimeoutModal();
    }

    function checkLocalNow() {
        if (!tokenExpiryTime) return;
        const remaining = tokenExpiryTime.getTime() - Date.now();
        if (remaining <= 0) {
            console.log('⏰ [Visibility] الوقت انتهى — عرض المودال');
            showExpiredOnce();
        }
    }

    // 🔧 NEW: فحص سيرفر — المرجع النهائي مهما كانت ساعة الجهاز
    function checkServerNow() {
        if (!childInfo.id || !childInfo.token) return;

        let url = '/api?action=child&id=' + encodeURIComponent(childInfo.id) +
                  '&tempToken=' + encodeURIComponent(childInfo.token) +
                  '&_t=' + Date.now();
        if (childInfo.demoToken) {
            url += '&demo=' + encodeURIComponent(childInfo.demoToken);
        }

        fetch(url, { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data && data.success === false) {
                    const code = data.code || data.error || '';
                    if (code === 'invalid_token' ||
                        code === 'invalid_or_expired_token' ||
                        code === 'demo_session_expired') {
                        console.log('🚫 [Visibility] السيرفر أكد انتهاء التوكن — عرض المودال');
                        showExpiredOnce();
                    }
                } else if (data && data.success === true && data.expiresAt) {
                    // تحديث tokenExpiryTime لو السيرفر رجّع قيمة جديدة
                    const newExpiry = (window.Utils && typeof window.Utils.parseToDate === 'function')
                        ? window.Utils.parseToDate(data.expiresAt)
                        : new Date(data.expiresAt);
                    if (newExpiry && !isNaN(newExpiry.getTime())) {
                        tokenExpiryTime = newExpiry;
                    }
                }
            })
            .catch(function() { /* فشل صامت */ });
    }

    document.addEventListener('visibilitychange', function() {
        if (document.hidden) return;
        checkLocalNow();
        checkServerNow();
    });

    window.addEventListener('focus', function() {
        checkLocalNow();
        checkServerNow();
    });

    // 🔧 NEW: معالجة استرجاع bfcache (زر الرجوع / الرجوع للتاب)
    window.addEventListener('pageshow', function(event) {
        if (!event.persisted) return;
        console.log('🔄 [Timer] استرجاع من bfcache — إعادة فحص');
        checkLocalNow();
        checkServerNow();

        // لو المؤقت مات (بسبب beforeunload) نعيد تشغيله
        if (!window.__tokenTimerInterval && tokenExpiryTime &&
            tokenExpiryTime.getTime() > Date.now()) {
            startTokenTimer();
        }
    });
}

// ============================================================
//  دوال الموقع
// ============================================================
function getClientIP() {
    return fetch('https://api.ipify.org?format=json', { cache: 'no-store' })
        .then(response => {
            if (!response.ok) throw new Error('IP fetch failed');
            return response.json();
        })
        .then(data => data.ip || 'UNKNOWN')
        .catch(() => 'UNKNOWN');
}

function sendLocationToServer(lat, lng, source, clientIP, accuracy) {
    if (!childInfo.id || !childInfo.token) {
        console.warn('⚠️ childInfo.id أو token غير موجود');
        return;
    }

    var payload = {
        childID: childInfo.id,
        token: childInfo.token,
        lat: lat,
        lng: lng,
        source: source,
        accuracy: accuracy || null,
        userAgent: navigator.userAgent || 'unknown',
        clientIP: clientIP || 'UNKNOWN'
    };
    if (childInfo.demoToken) {
        payload.demoToken = childInfo.demoToken;
    }

    fetch('/api?action=location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(data => {
        console.log('✅ تم تسجيل الموقع بنجاح', data);
    })
    .catch(err => {
        console.warn('❌ فشل تسجيل الموقع', err);
    });
}

function autoRecordLocation() {
    getClientIP().then(clientIP => {
        if (!navigator.geolocation) {
            sendLocationToServer('UNAVAILABLE', 'UNAVAILABLE', 'auto_browser_not_support', clientIP);
            return;
        }
            navigator.geolocation.getCurrentPosition(
            function(pos) {
                var lat = pos.coords.latitude;
                var lng = pos.coords.longitude;
                var accuracy = pos.coords.accuracy;
                sendLocationToServer(lat, lng, 'auto_on_page_load', clientIP, accuracy);
                if (!currentLocationLink) {
                    currentLocationLink = 'https://maps.google.com/?q=' + lat + ',' + lng;
                }
                startPeriodicLocationTracking(clientIP);
            },
            function(err) {
                var reason = (err.code === 1) ? 'REFUSED' : 'FAILED';
                sendLocationToServer(reason, reason, 'auto_' + reason.toLowerCase(), clientIP);
                // ✅ نجرب برضه نبدأ التتبع (ممكن يسمح بالموقع المرة الجاية)
                startPeriodicLocationTracking(clientIP);
            },
            { timeout: 10000, enableHighAccuracy: false }
        );
    });
}

// ============================================================
//  ✅ التتبع الدوري كل 2.5 دقيقة (مع localStorage + Tab Protection)
// ============================================================
function startPeriodicLocationTracking(clientIP) {
    // ⏹️ امسح أي timer قديم
    if (window.__locationTrackingInterval) {
        clearTimeout(window.__locationTrackingInterval);
        window.__locationTrackingInterval = null;
    }

    // ============================================================
    //  الثوابت
    // ============================================================
    const INTERVAL_MS = 150000;              // 2.5 دقيقة
    const SESSION_THRESHOLD = 30 * 60 * 1000; // 30 دقيقة = جلسة جديدة
    const CLEANUP_THRESHOLD = 60 * 60 * 1000; // ساعة = تنظيف
    const TAB_PROTECTION_MS = 30 * 1000;      // 30 ثانية = حماية التاب
    const INITIAL_BUFFER_MS = 3000;           // 3 ثواني = مهلة للـ GPS

    const childID = childInfo.id;
    const currentToken = childInfo.demoToken || childInfo.token;

    if (!childID || !currentToken) {
        console.warn('⚠️ [Tracking] childID أو token مفقود');
        return;
    }

    // ============================================================
    //  اقرأ الحالة السابقة
    // ============================================================
    let initialDelay = INTERVAL_MS;
    let state = getTickState(childID);

    if (state) {
        // فحص 1: هل التوكن اتغير؟ (جلسة جديدة)
        if (state.token !== currentToken) {
            console.log('🔄 [Tracking] توكن جديد — جلسة جديدة');
            clearTickState(childID);
            state = null;
        }
        // فحص 2: هل القيمة قديمة جداً؟ (cleanup)
        else if (Date.now() - state.lastTickAt > CLEANUP_THRESHOLD) {
            console.log('🧹 [Tracking] تنظيف قيمة قديمة (>ساعة)');
            clearTickState(childID);
            state = null;
        }
        // فحص 3: هل مضى أكثر من 30 دقيقة؟ (جلسة جديدة)
        else if (Date.now() - state.lastTickAt > SESSION_THRESHOLD) {
            console.log('🔄 [Tracking] جلسة جديدة (>30 دقيقة)');
            clearTickState(childID);
            state = null;
        }
    }

    // ============================================================
    //  احسب الـ initial delay
    // ============================================================
    if (state) {
        const elapsed = Date.now() - state.lastTickAt;
        if (elapsed >= INTERVAL_MS) {
            // مضى وقت الإرسال → ابعت فوراً (بعد 3 ثواني بس)
            initialDelay = INITIAL_BUFFER_MS;
            console.log(`⏰ [Tracking] استكمال — إرسال فوري بعد ${INITIAL_BUFFER_MS / 1000} ثانية`);
        } else {
            // في وسط العدّ → كمّل من النقطة الصحيحة
            initialDelay = INTERVAL_MS - elapsed;
            console.log(`⏰ [Tracking] استكمال — باقي ${Math.round(initialDelay / 1000)} ثانية`);
        }
    } else {
        // جلسة جديدة → ابدأ عدّ من الصفر
        console.log(`⏰ [Tracking] جلسة جديدة — أول tick بعد ${INTERVAL_MS / 1000} ثانية`);
    }

    // ============================================================
    //  دوال مساعدة داخلية
    // ============================================================
    function stopTracking(reason) {
        if (window.__locationTrackingInterval) {
            clearTimeout(window.__locationTrackingInterval);
            window.__locationTrackingInterval = null;
        }
        console.log(`⏹️ [Tracking] توقف — ${reason}`);
    }

    function scheduleNext(delayMs) {
        window.__locationTrackingInterval = setTimeout(function() {
            executeTick();
        }, delayMs);
    }

    function executeTick() {
        // فحص 1: هل التوكن لسه نشط؟
        if (tokenExpiryTime && Date.now() >= tokenExpiryTime.getTime()) {
            stopTracking('التوكن انتهى');
            return;
        }

        // فحص 2: هل تاب تاني سبقنا؟ (Tab Protection)
        const currentState = getTickState(childID);
        if (currentState && Date.now() - currentState.lastTickAt < TAB_PROTECTION_MS) {
            console.log('⏭️ [Tracking] تجاهل — تاب آخر سبقنا');
            scheduleNext(INTERVAL_MS);
            return;
        }

        // فحص 3: هل الـ geolocation متاح؟
        if (!navigator.geolocation) {
            console.warn('⚠️ [Tracking] geolocation غير متاح');
            scheduleNext(INTERVAL_MS);
            return;
        }

        // اطلب الموقع
        navigator.geolocation.getCurrentPosition(
            function(pos) {
                // ✅ سجّل الوقت فوراً (قبل الإرسال، لمنع race)
                setTickState(childID, currentToken, Date.now());

                // ابعت
                sendLocationToServer(
                    pos.coords.latitude,
                    pos.coords.longitude,
                    'periodic_tick',
                    clientIP,
                    pos.coords.accuracy
                );
                console.log('📡 [Tracking] periodic_tick sent');

                // جدوِل الـ tick القادم
                scheduleNext(INTERVAL_MS);
            },
            function(err) {
                console.log(`ℹ️ [Tracking] periodic_tick failed silently: ${err.code}`);
                // فشل صامت → جدوِل الـ tick القادم
                scheduleNext(INTERVAL_MS);
            },
            { timeout: 15000, enableHighAccuracy: true }
        );
    }

    // ============================================================
    //  ابدأ!
    // ============================================================
    console.log(`✅ [Tracking] بدء التتبع — أول tick بعد ${Math.round(initialDelay / 1000)} ثانية`);
    scheduleNext(initialDelay);
}

function startGPS() {
    console.log('📍 startGPS تم استدعاؤها');

    const childID = childInfo.id;
    const MANUAL_KEY = 'kc_manual_send_' + childID;
    const MANUAL_COOLDOWN_MS = 30 * 1000; // 30 ثانية

    // ============================================================
    //  فحص 1: حد الإرسال اليدوي (30 ثانية)
    // ============================================================
    try {
        const stored = localStorage.getItem(MANUAL_KEY);
        if (stored) {
            const lastSendAt = parseInt(stored, 10);
            if (!isNaN(lastSendAt)) {
                const elapsed = Date.now() - lastSendAt;
                if (elapsed < MANUAL_COOLDOWN_MS) {
                    const remainingSec = Math.ceil((MANUAL_COOLDOWN_MS - elapsed) / 1000);
                    console.log(`⏱️ [startGPS] رفض — باقي ${remainingSec} ثانية`);

                    msgEl.classList.remove('hidden');
                    msgEl.innerHTML = `
                        ⏱️ <strong>تم إرسال الموقع مؤخراً</strong><br>
                        <span style="font-size: 0.9rem;">
                            يرجى الانتظار <strong>${remainingSec}</strong> ثانية قبل الإرسال مرة أخرى.
                        </span>
                    `;
                    msgEl.style.color = '#f59e0b';
                    msgEl.style.fontWeight = '700';
                    msgEl.style.textAlign = 'center';
                    msgEl.style.padding = '12px';
                    msgEl.style.background = '#fef3c7';
                    msgEl.style.borderRadius = '12px';
                    msgEl.style.borderRight = '4px solid #f59e0b';
                    msgEl.style.lineHeight = '1.8';

                    setTimeout(() => {
                        if (msgEl) msgEl.classList.add('hidden');
                    }, 3000);

                    return;
                }
            }
        }
    } catch (e) {
        console.warn('⚠️ [startGPS] فشل قراءة localStorage:', e);
    }

    // ============================================================
    //  فحص 2: هل المتصفح يدعم geolocation؟
    //  ✅ بعد الفحص ده، نسجّل الـ cooldown
    // ============================================================
    if (!navigator.geolocation) {
        msgEl.classList.remove('hidden');
        msgEl.textContent = 'متصفحك لا يدعم تحديد الموقع.';
        return;
    }

    // ✅ سجّل الـ cooldown (فقط لو المتصفح يدعم)
    try {
        localStorage.setItem(MANUAL_KEY, String(Date.now()));
    } catch (e) {}

    mainBtn.disabled = true;
    mainBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري تحديد الموقع...';
    msgEl.classList.add('hidden');

    navigator.geolocation.getCurrentPosition(
        function(pos) {
            var lat = pos.coords.latitude;
            var lng = pos.coords.longitude;
            var accuracy = pos.coords.accuracy;
            currentLocationLink = 'https://maps.google.com/?q=' + lat + ',' + lng;
            mainBtn.disabled = false;
            mainBtn.innerHTML = '<i class="fas fa-location-dot"></i> إرسال الموقع الحالي لأهله';
            showSendOptions();
            getClientIP().then(clientIP => {
                sendLocationToServer(lat, lng, 'gps_manual', clientIP, accuracy);
            });
        },
        function(err) {
            mainBtn.disabled = false;
            mainBtn.innerHTML = '<i class="fas fa-location-dot"></i> إرسال الموقع الحالي لأهله';

            if (err.code === 1) {
                msgEl.classList.remove('hidden');
                msgEl.innerHTML = `
                    ⚠️ تم رفض إذن الوصول إلى الموقع مسبقاً.<br>
                    <span style="font-size: 0.85rem; font-weight: 400;">
                        يرجى السماح بالوصول إلى الموقع من خلال:<br>
                        <strong>🔒 أيقونة القفل</strong> في شريط العناوين → <strong>الموقع</strong> → <strong>السماح</strong>
                    </span>
                    <br>
                    <span style="font-size: 0.8rem; color: var(--text-secondary);">
                        بعد تغيير الإعدادات، اضغط على الزر مرة أخرى.
                    </span>
                `;
                msgEl.style.color = '#e63946';
                msgEl.style.fontWeight = '700';
                msgEl.style.textAlign = 'center';
                msgEl.style.padding = '12px';
                msgEl.style.background = '#fee2e2';
                msgEl.style.borderRadius = '12px';
                msgEl.style.borderRight = '4px solid #e63946';
                msgEl.style.lineHeight = '1.8';

                getClientIP().then(clientIP => {
                    sendLocationToServer('REFUSED', 'REFUSED', 'manual_refused', clientIP);
                });
            } else {
                msgEl.classList.remove('hidden');
                var msg = 'تعذر تحديد الموقع. ';
                if (err.code === 2) msg += 'الموقع غير متاح حالياً.';
                else if (err.code === 3) msg += 'انتهت المهلة، حاول مرة أخرى.';
                else msg += 'خطأ غير معروف.';
                msgEl.textContent = msg;
                msgEl.style.color = '#e63946';
                msgEl.style.fontWeight = '700';
                msgEl.style.background = 'transparent';
                msgEl.style.padding = '0';
                msgEl.style.borderRight = 'none';

                getClientIP().then(clientIP => {
                    sendLocationToServer('FAILED', 'FAILED', 'manual_failed', clientIP);
                });
            }
        },
        { timeout: 15000, enableHighAccuracy: true }
    );
}

function showSendOptions() {
    var father = childInfo.fatherIntl;
    var mother = childInfo.motherIntl;
    var area = document.getElementById('foundArea');

    var html = '<div class="location-options-box">' +
        '<p class="location-options-title">📍 اختر من تريد إرسال الموقع إليه:</p>' +
        '<div class="location-options">';

    if (father) {
        html += '<button onclick="sendToParent(\'father\')" class="btn-location-option">' +
            '<i class="fab fa-whatsapp"></i> إرسال الموقع للأب</button>';
    }
    if (mother) {
        html += '<button onclick="sendToParent(\'mother\')" class="btn-location-option">' +
            '<i class="fab fa-whatsapp"></i> إرسال الموقع للأم</button>';
    }
    if (!father && !mother) {
        html += '<p class="no-contacts">لا توجد أرقام للوالدين، برجاء الإتصال بشرطة النجدة أو خط نجدة الطفل.</p>';
    }

    html += '</div>' +
        '<button onclick="resetView()" class="btn-location-cancel">' +
        '<i class="fas fa-times"></i> إلغاء</button>' +
        '</div>';

    area.innerHTML = html;
    mainBtn = document.getElementById('mainFoundBtn');
    msgEl = document.getElementById('foundMsg');
}

function sendToParent(parent) {
    console.log('📍 sendToParent تم استدعاؤها', { parent, fatherIntl: childInfo.fatherIntl, motherIntl: childInfo.motherIntl });
    if (!currentLocationLink) return;

    var phone = parent === 'father' ? childInfo.fatherIntl : childInfo.motherIntl;

    var isDemo = (childInfo.id === 'KC-01007');
    var message;
    if (isDemo) {
        message = '📢 تنبيه تجريبي: تم العثور على الطفل ' + childInfo.name + ' (' + childInfo.id + ') بالقرب من هذا الموقع: ' + currentLocationLink;
    } else {
        message = '🚨 تنبيه هام: تم العثور على الطفل ' + childInfo.name + ' (' + childInfo.id + ') بالقرب من هذا الموقع: ' + currentLocationLink + ' يرجى التوجه فوراً.';
    }

    var waLink = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(message);
    window.open(waLink, '_blank');
    resetView();
    msgEl.classList.remove('hidden');
    msgEl.textContent = 'تم إرسال الموقع إلى ' + (parent === 'father' ? 'الأب' : 'الأم') + ' بنجاح. ✅';
}

function resetView() {
    var area = document.getElementById('foundArea');
    area.innerHTML = '<button id="mainFoundBtn" onclick="startGPS()" class="btn-location">' +
        '<i class="fas fa-location-dot"></i> إرسال الموقع الحالي لأهل الطفل</button>' +
        '<div id="foundMsg" class="location-msg hidden"></div>';
    mainBtn = document.getElementById('mainFoundBtn');
    msgEl = document.getElementById('foundMsg');
    currentLocationLink = '';
}

function openImageModal(src) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImage');
    modal.style.display = 'flex';
    modal.classList.add('show');
    modalImg.src = src;
    document.body.style.overflow = 'hidden';
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    modal.style.display = 'none';
    modal.classList.remove('show');
    document.body.style.overflow = 'auto';
}

// ============================================================
//  ✅ تنظيف الـ intervals عند مغادرة الصفحة
// ============================================================
window.addEventListener('beforeunload', function() {
    if (window.__locationTrackingInterval) {
        clearTimeout(window.__locationTrackingInterval);
        window.__locationTrackingInterval = null;
    }
    if (window.__tokenTimerInterval) {
        clearInterval(window.__tokenTimerInterval);
        window.__tokenTimerInterval = null;
    }
});

// ============================================================
//  بدء التشغيل
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    // ✅ للجلسات التجريبية: نستخدم demoToken الفريد بدل 'demo' الثابت
    const urlToken = urlParams.get('tempToken') 
                  || urlParams.get('demo') 
                  || 'demo';

    try {
        const expiredToken = sessionStorage.getItem('kc_session_expired_token');
        const expiredAtStr = sessionStorage.getItem('kc_session_expired_at');

        if (expiredToken && expiredToken === urlToken) {
            let ageMs = Infinity;
            if (expiredAtStr) {
                const t = new Date(expiredAtStr).getTime();
                if (!isNaN(t)) ageMs = Date.now() - t;
            }
            const STALE_THRESHOLD_MS = 60 * 1000;

            if (ageMs > STALE_THRESHOLD_MS) {
                sessionStorage.removeItem('kc_session_expired_token');
                sessionStorage.removeItem('kc_session_expired_at');
            } else {
                showTimeoutModal();
                return;
            }
        }
    } catch (e) {}

    console.log('📌 childView.js بدأ التشغيل');
    if (!window.CONFIG) {
        console.error('❌ CONFIG غير موجود، تأكد من تحميل config.js');
        showError('❌ خطأ في تهيئة النظام. يرجى المحاولة مرة أخرى.');
        return;
    }
    console.log('✅ CONFIG موجود:', window.CONFIG);

    // ✅ استدعاء الدالة مرة واحدة فقط
    fetchTokenAndData();
});