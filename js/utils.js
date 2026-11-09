// ================================================================
//  utils.js - الدوال المساعدة المشتركة بين كل الصفحات
//  تم توحيد جميع الدوال المكررة في ملف واحد (DRY)
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
//  8. دوال التاريخ (للـ dashboard)
// ============================================================

/**
 * حساب العمر من تاريخ الميلاد
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
    const today = new Date();
    let years = today.getFullYear() - d.getFullYear();
    let months = today.getMonth() - d.getMonth();
    if (today.getDate() < d.getDate()) months--;
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
 * تنسيق المدة المتبقية بالأيام
 */
/**
 * صياغة عدد مع وحدة زمنية وفق قواعد العدد في اللغة العربية:
 * - المفرد: "شهر"
 * - المثنى: "شهران"
 * - الجمع (3-10): "3 شهور"
 * - 11 فأكثر: "11 شهر" (المعدود مفرد)
 */
function formatArabicCount(count, forms) {
    if (count === 1) return forms.singular;
    if (count === 2) return forms.dual;
    if (count >= 3 && count <= 10) return count + ' ' + forms.plural;
    return count + ' ' + forms.singular;
}

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
    // ✅ ES5-safe: منع Optional Chaining لدعم المتصفحات القديمة (Dolphin)
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
 * التحقق من وجود جلسة مسوق
 */
function checkMarketerSession() {
    const code = localStorage.getItem('marketerCode');
    if (!code) {
        window.location.href = '/marketer-login.html';
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
//  12. دوال العلامات المميزة (للـ childView)
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

// تصدير الدوال للاستخدام في باقي الملفات
if (typeof window !== 'undefined') {
    window.Utils = {
        normalizeEgyptPhone,
        internationalToLocal,
        formatPhoneLocal,
        formatPhoneInternational,
        processAbdName,
        normalizeAbdName,
        validateFullName,
        preventNonArabic,
        preventSpaceAfterAbd,
        autoMergeAbd,
        isArabicOnly,
        fileToBase64,
        compressImage,
        validateGoogleMaps,
        showFieldError,
        hideFieldError,
        restrictMarketerId,
        restrictMarketerInput,
        formatInternational,
        formatLocal,
        calculateAgeFromBirthDate,
        formatDuration,
        formatArabicCount,
        getSafeErrorMessage,
        handleFilePreview,
        checkMarketerSession,
        updateMarketerName,
        sendLocationToServer,
        parseToDate,
        getCairoTimeParts,
        formatDateTime,
        formatDateOnly
    };

    console.log('✅ utils.js: بدء تعريف window.Utils');
    // ... تعريف window.Utils ...
    console.log('✅ utils.js: تم تعريف window.Utils بنجاح');
}

// ============================================================
//  13. دوال التواريخ (التوقيت الموحد - توقيت القاهرة)
//  ⚠️ أي timestamp من Supabase هو UTC → نحوّله للقاهرة
// ============================================================

/**
 * parseToDate — تحويل أي قيمة إلى Date مع افتراض UTC
 */
function parseToDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);

    const str = String(value).trim();
    if (!str) return null;

    // ISO كامل (فيه T و Z أو offset)
    if (str.includes('T') && (str.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(str))) {
        return new Date(str);
    }

    // "YYYY-MM-DD HH:MM:SS[.ms]" — نعتبرها UTC
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(str)) {
        return new Date(str.replace(' ', 'T') + 'Z');
    }

    // "YYYY-MM-DD" — بداية اليوم UTC
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        return new Date(str + 'T00:00:00Z');
    }

    // Fallback
    return new Date(str);
}

/**
 * getCairoTimeParts — استخراج أجزاء الوقت (Cairo) من قيمة
 * يُرجِع { year, month, day, hour, minute, second } كلها strings
 */
function getCairoTimeParts(value) {
    const d = parseToDate(value);
    if (!d || isNaN(d.getTime())) return null;

    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Cairo',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).formatToParts(d);

    const get = function(type) {
        const p = parts.find(function(x) { return x.type === type; });
        return p ? p.value : '';
    };

    let hh = get('hour');
    if (hh === '24') hh = '00';

    return {
        year: get('year'),
        month: get('month'),
        day: get('day'),
        hour: hh,
        minute: get('minute'),
        second: get('second')
    };
}

/**
 * formatDateTime — "YYYY-MM-DD HH:mm:ss" بتوقيت القاهرة (24 ساعة)
 */
function formatDateTime(value) {
    if (!value) return '';
    const parts = getCairoTimeParts(value);
    if (!parts) return String(value);
    return parts.year + '-' + parts.month + '-' + parts.day +
           ' ' + parts.hour + ':' + parts.minute + ':' + parts.second;
}

/**
 * formatDateOnly — "YYYY-MM-DD" بتوقيت القاهرة
 */
function formatDateOnly(value) {
    if (!value) return '';
    const parts = getCairoTimeParts(value);
    if (!parts) return String(value);
    return parts.year + '-' + parts.month + '-' + parts.day;
}