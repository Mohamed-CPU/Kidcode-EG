// ================================================================
//  utils.js - الدوال المساعدة المشتركة بين كل الصفحات
//  - النسخة الموحّدة بعد Migration: كل التواريخ UTC في DB
//  - دوال العرض الجديدة: Cairo display بالعربي
// ================================================================

// ============================================================
//  1. دوال معالجة الأرقام
// ============================================================

/**
 * تحويل رقم هاتف مصري إلى صيغة دولية ومحلية
 * @param {string} raw - رقم الهاتف الخام
 * @returns {object|null} { local: string, international: string } أو null
 */
function normalizeEgyptPhone(raw) {
    if (!raw) return null;
    let digits = raw.replace(/\D/g, '');
    if (digits.startsWith('20') && digits.length === 12) digits = '0' + digits.substring(2);
    else if (digits.startsWith('0020')) digits = '0' + digits.substring(4);
    else if (digits.startsWith('2') && digits.length === 12) digits = '0' + digits.substring(1);
    const egyptianRegex = /^01[0-9]{9}$/;
    if (!egyptianRegex.test(digits)) return null;
    const allowedPrefixes = ['010', '011', '012', '015'];
    if (!allowedPrefixes.includes(digits.substring(0, 3))) return null;
    return { local: digits, international: '20' + digits.substring(1) };
}

/**
 * تحويل رقم هاتف دولي إلى محلي
 * @param {string} phone - رقم الهاتف
 * @returns {string} الرقم بصيغة محلية
 */
function internationalToLocal(phone) {
    if (!phone) return '';
    let digits = phone.toString().replace(/\D/g, '');
    if (digits.startsWith('20') && digits.length === 12) return '0' + digits.substring(2);
    if (digits.startsWith('20') && digits.length === 11) return '0' + digits.substring(2);
    if (digits.length === 11 && digits.startsWith('01')) return digits;
    return digits;
}

/**
 * تحويل رقم هاتف إلى صيغة محلية (اسم بديل للتعبئة)
 */
function formatPhoneLocal(phone) {
    return internationalToLocal(phone);
}

/**
 * تحويل رقم هاتف إلى صيغة دولية
 */
function formatPhoneInternational(phone) {
    if (!phone) return '';
    let digits = String(phone).replace(/\D/g, '');
    if (digits.startsWith('20') && digits.length === 12) return digits;
    if (digits.startsWith('0') && digits.length === 11) return '20' + digits.substring(1);
    if (digits.length === 10 || digits.length === 11) return '20' + digits;
    return digits;
}

// ============================================================
//  2. دوال معالجة الاسم
// ============================================================

/**
 * دمج "عبد" مع الكلمة التالية (عبد الله → عبدالله)
 */
function processAbdName(name) {
    if (!name) return [];
    let cleaned = name.trim().replace(/\s+/g, ' ');
    let parts = cleaned.split(' ');
    let merged = [];
    for (let i = 0; i < parts.length; i++) {
        if (parts[i] === 'عبد' && parts[i + 1]) {
            merged.push(parts[i] + parts[i + 1]);
            i++;
        } else merged.push(parts[i]);
    }
    return merged;
}

/**
 * دمج "عبد" مع الكلمة التالية (إصدار نصي)
 */
function normalizeAbdName(name) {
    if (!name) return '';
    return processAbdName(name).join(' ');
}

/**
 * التحقق من أن الاسم رباعي (4 أجزاء على الأقل)
 */
function validateFullName(name) {
    if (!name) return false;
    let processed = name.trim().replace(/عبد\s+/g, 'عبد');
    let parts = processed.split(/\s+/);
    let merged = [];
    for (let i = 0; i < parts.length; i++) {
        if (parts[i] === 'عبد' && parts[i+1]) {
            merged.push(parts[i] + parts[i+1]);
            i++;
        } else {
            merged.push(parts[i]);
        }
    }
    if (merged.length < 4) return false;
    return merged.every(p => /^[\u0600-\u06FF]+$/.test(p));
}

/**
 * منع الأحرف غير العربية في حقول الاسم
 */
function preventNonArabic(e) {
    let input = e.target;
    let oldValue = input.value;
    let newValue = oldValue.replace(/[^\u0600-\u06FF\s]/g, '');
    newValue = newValue.replace(/عبد\s+/g, 'عبد');
    if (newValue !== oldValue) {
        input.value = newValue;
        input.selectionStart = input.selectionEnd = newValue.length;
    }
}

/**
 * منع وجود مسافة بعد "عبد" (للدمج التلقائي)
 */
function preventSpaceAfterAbd(e) {
    let input = e.target;
    let value = input.value;
    if (value.includes('عبد ')) {
        input.value = value.replace(/عبد\s+/g, 'عبد');
        input.selectionStart = input.selectionEnd = input.value.length;
    }
}

/**
 * دمج "عبد" تلقائياً أثناء الكتابة
 */
function autoMergeAbd(e) {
    const input = e.target;
    const cursorPos = input.selectionStart;
    const oldValue = input.value;
    const newValue = oldValue.replace(/عبد\s+(?=[\u0600-\u06FF])/g, 'عبد');
    if (newValue !== oldValue) {
        input.value = newValue;
        input.selectionStart = input.selectionEnd = cursorPos - (oldValue.length - newValue.length);
    }
}

/**
 * التحقق من أن النص عربي فقط
 */
function isArabicOnly(text) {
    return /^[\u0600-\u06FF\s]+$/.test(text);
}

// ============================================================
//  3. دوال الصور
// ============================================================

/**
 * تحويل ملف إلى Base64
 */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * ضغط الصورة قبل التخزين
 */
function compressImage(file, maxWidth = 250, maxHeight = 250, quality = 0.3) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('فشل ضغط الصورة'));
                }, 'image/jpeg', quality);
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
}

// ============================================================
//  4. دوال التحقق من الروابط
// ============================================================

/**
 * التحقق من صحة رابط Google Maps
 */
function validateGoogleMaps(url) {
    if (!url.trim()) return true;
    return /^https:\/\/maps\.app\.goo\.gl\/[A-Za-z0-9_-]+$/.test(url.trim());
}

// ============================================================
//  5. دوال واجهة المستخدم (UI Helpers)
// ============================================================

/**
 * إظهار خطأ في حقل معين
 */
function showFieldError(fieldId, message) {
    const el = document.getElementById(fieldId + 'Error');
    if (el) {
        el.textContent = message;
        el.classList.add('show');
    }
}

/**
 * إخفاء الخطأ من حقل معين
 */
function hideFieldError(fieldId) {
    const el = document.getElementById(fieldId + 'Error');
    if (el) el.classList.remove('show');
}

// ============================================================
//  6. دوال كود المسوق
// ============================================================

/**
 * تقييد إدخال كود المسوق (MA + أرقام فقط)
 */
function restrictMarketerId(e) {
    const input = e.target;
    let value = input.value;
    let newValue = value.replace(/[^MA0-9]/gi, '');
    newValue = newValue.toUpperCase();
    if (newValue !== value) {
        input.value = newValue;
        input.selectionStart = input.selectionEnd = newValue.length;
    }
}

/**
 * نفس الدالة (اسم بديل للتعبئة)
 */
function restrictMarketerInput(e) {
    restrictMarketerId(e);
}

// ============================================================
//  7. دوال إضافية للـ childView
// ============================================================

/**
 * تحويل الأرقام إلى صيغة دولية (نسخة بديلة)
 */
function formatInternational(digits) {
    if (!digits) return '';
    if (digits.startsWith('20') && digits.length === 12) return digits;
    if (digits.startsWith('0') && digits.length === 11) return '20' + digits.substring(1);
    if (digits.length === 10 || digits.length === 11) return '20' + digits;
    return digits;
}

/**
 * تحويل الأرقام إلى صيغة محلية (نسخة بديلة)
 */
function formatLocal(digits) {
    if (!digits) return '';
    if (digits.startsWith('20') && digits.length === 12) return '0' + digits.substring(2);
    if (digits.startsWith('0')) return digits;
    if (digits.length === 10) return '0' + digits;
    return digits;
}

// ============================================================
//  8. دوال حساب العمر والمدة
// ============================================================

/**
 * حساب العمر من تاريخ الميلاد
 * ✅ Cairo "today" via Intl (DST-aware) — بدل Local TZ
 */
function calculateAgeFromBirthDate(birthDateStr) {
    if (!birthDateStr) return 'غير محدد';
    let normalized = birthDateStr;
    if (typeof birthDateStr === 'string' && birthDateStr.includes('-')) {
        let parts = birthDateStr.split('-');
        if (parts.length === 3 && parts[0].length === 4) normalized = parts.join('-');
    }
    let d = new Date(normalized);
    if (isNaN(d.getTime())) return 'غير محدد';

    // ✅ Cairo "today" — يحسب DST تلقائياً
    const todayParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Cairo',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const getP = (t) => parseInt(todayParts.find(p => p.type === t).value, 10);
    const todayYear = getP('year');
    const todayMonth = getP('month') - 1;
    const todayDay = getP('day');

    let years = todayYear - d.getUTCFullYear();
    let months = todayMonth - d.getUTCMonth();
    if (todayDay < d.getUTCDate()) months--;
    if (months < 0) { years--; months += 12; }
    if (years <= 0 && months === 0) return 'أقل من شهر';

    if (years === 0) {
        return formatArabicCount(months, {
            singular: 'شهر',
            dual: 'شهران',
            plural: 'أشهر'
        });
    }

    if (months === 0) {
        return formatArabicCount(years, {
            singular: 'سنة',
            dual: 'سنتان',
            plural: 'سنوات'
        });
    }

    const yearsText = formatArabicCount(years, {
        singular: 'سنة',
        dual: 'سنتان',
        plural: 'سنوات'
    });
    const monthsText = formatArabicCount(months, {
        singular: 'شهر',
        dual: 'شهران',
        plural: 'أشهر'
    });

    return yearsText + ' و ' + monthsText;
}

/**
 * صياغة عدد مع وحدة زمنية وفق قواعد العدد في اللغة العربية
 */
function formatArabicCount(count, forms) {
    if (count === 1) return forms.singular;
    if (count === 2) return forms.dual;
    if (count >= 3 && count <= 10) return count + ' ' + forms.plural;
    return count + ' ' + forms.singular;
}

/**
 * تنسيق المدة المتبقية بالأيام
 */
function formatDuration(days) {
    if (days === null || days === undefined || days === '') return 'غير متاح';
    if (typeof days === 'string') days = parseInt(days, 10);
    if (isNaN(days) || days <= 0) return '⛔ منتهي';

    const years = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    const remainingDays = days % 30;

    const parts = [];

    if (years > 0) {
        parts.push(formatArabicCount(years, {
            singular: 'سنة',
            dual: 'سنتان',
            plural: 'سنوات'
        }));
    }

    if (months > 0) {
        parts.push(formatArabicCount(months, {
            singular: 'شهر',
            dual: 'شهران',
            plural: 'شهور'
        }));
    }

    if (remainingDays > 0) {
        parts.push(formatArabicCount(remainingDays, {
            singular: 'يوم',
            dual: 'يومان',
            plural: 'أيام'
        }));
    }

    if (parts.length === 0) return 'أقل من يوم';
    return parts.join(' و ');
}

// ============================================================
//  9. دوال التسجيل (للـ reg.js)
// ============================================================

/**
 * الحصول على رسالة خطأ آمنة (مع دعم ProgressEvent)
 */
function getSafeErrorMessage(err) {
    if (err === null || err === undefined) {
        return 'حدث خطأ غير معروف. يرجى المحاولة مرة أخرى.';
    }
    if (typeof err === 'string') {
        return err;
    }
    if (err instanceof Error) {
        return err.message || 'خطأ غير معروف';
    }
    if (err.message && typeof err.message === 'string') {
        return err.message;
    }
    var ctorName = (err.constructor && err.constructor.name) ? err.constructor.name : '';
    if (err.type || err.target || ctorName === 'ProgressEvent') {
        return '⚠️ حدث خطأ في الاتصال بالشبكة. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.';
    }
    try {
        const str = String(err);
        if (str && str !== '[object Object]' && str !== '[object Event]' && str !== '[object ProgressEvent]') {
            return str;
        }
    } catch {}
    return 'حدث خطأ غير معروف. يرجى المحاولة مرة أخرى.';
}

// ============================================================
//  10. دوال الـ Confirm Found
// ============================================================

/**
 * معاينة الصورة قبل الرفع
 */
function handleFilePreview(input, previewImg, placeholder) {
    const file = input.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            previewImg.src = e.target.result;
            previewImg.style.display = 'block';
            placeholder.style.display = 'none';
        };
        reader.readAsDataURL(file);
    } else {
        previewImg.style.display = 'none';
        placeholder.style.display = 'block';
    }
}

// ============================================================
//  11. دوال المسوقين (للـ marketer-dashboard)
// ============================================================

/**
 * التحقق من وجود جلسة مسوق + صلاحيتها (60 دقيقة)
 */
function checkMarketerSession() {
    const code = localStorage.getItem('marketerCode');
    if (!code) {
        window.location.href = '/marketer-login.html';
        return null;
    }

    // ✅ فحص expiry — ساعة واحدة
    let expiryTime = null;
    try {
        const stored = sessionStorage.getItem('marketer_session_expiry')
                     || localStorage.getItem('marketer_session_expiry');
        if (stored) {
            const t = new Date(stored).getTime();
            if (!isNaN(t)) expiryTime = t;
        }
    } catch (e) {}

    if (!expiryTime || Date.now() >= expiryTime) {
        // ❌ جلسة منتهية أو بدون expiry — نظّف وredirect
        try {
            localStorage.removeItem('marketerCode');
            localStorage.removeItem('marketerName');
            localStorage.removeItem('marketer_session_expiry');
            sessionStorage.removeItem('marketer_session_expiry');
        } catch (e) {}
        window.location.href = '/marketer-login.html?reason=session_expired';
        return null;
    }

    return code;
}

/**
 * تحديث اسم المستخدم في الواجهة
 */
function updateMarketerName() {
    const name = localStorage.getItem('marketerName');
    const nameEl = document.getElementById('marketerName');
    if (nameEl) {
        const code = localStorage.getItem('marketerCode') || '';
        nameEl.textContent = name ? 'مرحباً، ' + name : 'مرحباً، مسوق ' + code;
    }
}

// ============================================================
//  12. دوال تسجيل الموقع
// ============================================================

/**
 * تسجيل الموقع في الخادم
 */
function sendLocationToServer(childInfo, lat, lng, source, clientIP, apiUrl) {
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
        userAgent: navigator.userAgent || 'unknown',
        clientIP: clientIP || 'UNKNOWN'
    };
    if (childInfo.demoToken) {
        payload.demoToken = childInfo.demoToken;
    }

    fetch(apiUrl || '/api/location', {
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

// ============================================================
//  13. دوال التواريخ (التوقيت الموحد - Cairo display)
//  ⚠️ بعد Migration: Supabase بيرجع ISO UTC (مع Z)
//  → parseToDate بتفهمها مباشرة، ثم Intl يعرض Cairo
// ============================================================

// ─────────────────────────────────────────────────────────────
//  القوائم المرجعية (شهور وأيام بالعربي بدون همزات)
// ─────────────────────────────────────────────────────────────
var CAIRO_MONTHS_AR = [
    'يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو',
    'يوليو', 'اغسطس', 'سبتمبر', 'اكتوبر', 'نوفمبر', 'ديسمبر'
];

var CAIRO_DAYS_AR = [
    'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'
];

/**
 * parseToDate — تحويل أي قيمة إلى Date
 * بعد Migration، Supabase بيرجع ISO UTC (مع Z)
 * → new Date() كافي. مُبقاة للتوافق مع القيم القديمة.
 */
function parseToDate(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
        var dn = new Date(value);
        return isNaN(dn.getTime()) ? null : dn;
    }

    var str = String(value).trim();
    if (!str) return null;

    // ISO كامل (مع Z أو offset) — الحالة الطبيعية بعد Migration
    if (/[Zz]$/.test(str) || /[+-]\d{2}:?\d{2}$/.test(str)) {
        var d = new Date(str);
        return isNaN(d.getTime()) ? null : d;
    }

    // "YYYY-MM-DD HH:MM:SS[.ms]" — backward compat للقيم القديمة
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(str)) {
        var d2 = new Date(str.replace(' ', 'T') + 'Z');
        return isNaN(d2.getTime()) ? null : d2;
    }

    // "YYYY-MM-DD" — بداية اليوم UTC
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        var d3 = new Date(str + 'T00:00:00Z');
        return isNaN(d3.getTime()) ? null : d3;
    }

    // Fallback
    var d4 = new Date(str);
    return isNaN(d4.getTime()) ? null : d4;
}

/**
 * getCairoTimeParts — استخراج أجزاء الوقت (Cairo) من قيمة
 * يُرجِع { year, month, day, hour, minute, second, dayOfWeek }
 * ملاحظة: month/day/hour/minute/second كلها strings ("01" لـ "12")
 * dayOfWeek رقم (0 = الأحد، 6 = السبت)
 */
function getCairoTimeParts(value) {
    var d = parseToDate(value);
    if (!d) return null;

    var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Cairo',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        weekday: 'short',
        hour12: false
    }).formatToParts(d);

    var get = function(type) {
        var p = parts.find(function(x) { return x.type === type; });
        return p ? p.value : '';
    };

    var hh = get('hour');
    if (hh === '24') hh = '00';

    var weekdayShort = get('weekday');
    var DOW_MAP = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
    var dow = DOW_MAP[weekdayShort];
    if (dow === undefined) dow = 0;

    return {
        year: get('year'),
        month: get('month'),
        day: get('day'),
        hour: hh,
        minute: get('minute'),
        second: get('second'),
        dayOfWeek: dow
    };
}

/**
 * formatTime12Arabic — تحويل الساعة والدقيقة لصيغة 12 ساعة عربية
 * - 00:00 → "12:00 منتصف الليل"
 * - 12:00 → "12:00 ظهراً"
 * - 00:01–11:59 → "HH:MM صباحاً"
 * - 12:01–23:59 → "HH:MM مساءً"
 */
function formatTime12Arabic(hour24, minute) {
    var h = parseInt(hour24, 10);
    var m = String(minute).padStart(2, '0');

    // الحالة الخاصة: منتصف الليل (00:00)
    if (h === 0 && m === '00') {
        return '12:00 منتصف الليل';
    }
    // الحالة الخاصة: ظهراً (12:00)
    if (h === 12 && m === '00') {
        return '12:00 ظهراً';
    }

    var hour12;
    var period;

    if (h === 0) {
        hour12 = 12;
        period = 'صباحاً';
    } else if (h < 12) {
        hour12 = h;
        period = 'صباحاً';
    } else if (h === 12) {
        hour12 = 12;
        period = 'مساءً';
    } else {
        hour12 = h - 12;
        period = 'مساءً';
    }

    var hh = String(hour12).padStart(2, '0');
    return hh + ':' + m + ' ' + period;
}

/**
 * formatCairoTime — "02:00 مساءً" (بدون ثواني)
 * @example formatCairoTime('2026-11-12T14:00:00Z') → "04:00 مساءً"
 * @example formatCairoTime('2026-11-12T00:00:00Z') → "02:00 صباحاً" (لأنها Cairo 02:00)
 */
function formatCairoTime(value) {
    if (!value) return '';
    var parts = getCairoTimeParts(value);
    if (!parts) return String(value);
    return formatTime12Arabic(parts.hour, parts.minute);
}

/**
 * formatCairoTimeLong — "02:00:35 مساءً" (مع ثواني)
 */
function formatCairoTimeLong(value) {
    if (!value) return '';
    var parts = getCairoTimeParts(value);
    if (!parts) return String(value);

    var h = parseInt(parts.hour, 10);
    var m = parts.minute;
    var s = parts.second;

    // نفس الحالات الخاصة (بناءً على الساعة والدقيقة)
    if (h === 0 && m === '00') {
        return '12:00:' + s + ' منتصف الليل';
    }
    if (h === 12 && m === '00') {
        return '12:00:' + s + ' ظهراً';
    }

    var hour12;
    var period;

    if (h === 0) {
        hour12 = 12;
        period = 'صباحاً';
    } else if (h < 12) {
        hour12 = h;
        period = 'صباحاً';
    } else if (h === 12) {
        hour12 = 12;
        period = 'مساءً';
    } else {
        hour12 = h - 12;
        period = 'مساءً';
    }

    var hh = String(hour12).padStart(2, '0');
    return hh + ':' + m + ':' + s + ' ' + period;
}

/**
 * formatCairoDate — "الأربعاء، 11 نوفمبر 2026"
 */
function formatCairoDate(value) {
    if (!value) return '';
    var parts = getCairoTimeParts(value);
    if (!parts) return String(value);

    var dayName = CAIRO_DAYS_AR[parts.dayOfWeek] || 'الأحد';
    var monthName = CAIRO_MONTHS_AR[parseInt(parts.month, 10) - 1] || 'يناير';
    var dayNum = parseInt(parts.day, 10);

    return dayName + '، ' + dayNum + ' ' + monthName + ' ' + parts.year;
}

/**
 * formatCairoDateTime — "الأربعاء، 11 نوفمبر 2026 - 02:00 مساءً"
 * (بدون ثواني — للعرض العادي)
 */
function formatCairoDateTime(value) {
    if (!value) return '';
    var dateStr = formatCairoDate(value);
    var timeStr = formatCairoTime(value);
    if (!dateStr) return String(value);
    return dateStr + ' - ' + timeStr;
}

/**
 * formatCairoDateTimeLong — "الأربعاء، 11 نوفمبر 2026 - 02:00:35 مساءً"
 * (مع ثواني — للأدمن وaudit log)
 */
function formatCairoDateTimeLong(value) {
    if (!value) return '';
    var dateStr = formatCairoDate(value);
    var timeStr = formatCairoTimeLong(value);
    if (!dateStr) return String(value);
    return dateStr + ' - ' + timeStr;
}

// ─────────────────────────────────────────────────────────────
//  Backward Compatibility — الدوال القديمة (نفس السلوك)
//  تُستخدم في بعض الصفحات القديمة — نبقيها لتفادي breaking
// ─────────────────────────────────────────────────────────────

/**
 * formatDateTime — "YYYY-MM-DD HH:mm:ss" بتوقيت القاهرة (24 ساعة)
 * @deprecated استخدم formatCairoDateTime بدلاً من هذه الدالة
 */
function formatDateTime(value) {
    if (!value) return '';
    var parts = getCairoTimeParts(value);
    if (!parts) return String(value);
    return parts.year + '-' + parts.month + '-' + parts.day +
           ' ' + parts.hour + ':' + parts.minute + ':' + parts.second;
}

/**
 * formatDateOnly — "YYYY-MM-DD" بتوقيت القاهرة
 * @deprecated استخدم formatCairoDate بدلاً من هذه الدالة
 */
function formatDateOnly(value) {
    if (!value) return '';
    var parts = getCairoTimeParts(value);
    if (!parts) return String(value);
    return parts.year + '-' + parts.month + '-' + parts.day;
}

// ============================================================
//  14. تصدير الدوال للاستخدام في باقي الملفات
// ============================================================
if (typeof window !== 'undefined') {
    window.Utils = {
        // أرقام
        normalizeEgyptPhone,
        internationalToLocal,
        formatPhoneLocal,
        formatPhoneInternational,
        formatInternational,
        formatLocal,

        // أسماء
        processAbdName,
        normalizeAbdName,
        validateFullName,
        preventNonArabic,
        preventSpaceAfterAbd,
        autoMergeAbd,
        isArabicOnly,

        // صور
        fileToBase64,
        compressImage,

        // روابط
        validateGoogleMaps,

        // UI
        showFieldError,
        hideFieldError,
        handleFilePreview,

        // كود المسوق
        restrictMarketerId,
        restrictMarketerInput,

        // حساب العمر والمدة
        calculateAgeFromBirthDate,
        formatDuration,
        formatArabicCount,

        // أخطاء
        getSafeErrorMessage,

        // جلسة مسوق
        checkMarketerSession,
        updateMarketerName,
        sendLocationToServer,

        // ═══════════════════════════════════════════════════════
        //  دوال التواريخ (Cairo display)
        // ═══════════════════════════════════════════════════════
        parseToDate,
        getCairoTimeParts,
        formatTime12Arabic,

        // ✅ دوال Cairo display الجديدة (اللي بنستخدمها في كل الصفحات)
        formatCairoTime,
        formatCairoTimeLong,
        formatCairoDate,
        formatCairoDateTime,
        formatCairoDateTimeLong,

        // ⚠️ backward compat (قديمة — للصفحات اللي لسه ما اتحدثتش)
        formatDateTime,
        formatDateOnly,

        // قوائم مرجعية (لو محتاجينها)
        CAIRO_MONTHS_AR,
        CAIRO_DAYS_AR
    };

    console.log('✅ utils.js: window.Utils تم تعريفها بنجاح');
}