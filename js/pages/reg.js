// ================================================================
//  reg.js - صفحة تسجيل طفل جديد
//  تم التعديل لاستخدام Utils مباشرة (بدون إعادة تعريف الدوال)
//  ✅ تم إضافة دعم صورة الوجه (faceImageBase64)
//  ✅ تم إصلاح مشكلة اختيار صورة جديدة بعد الفشل (تبقى الصورة معروضة)
// ================================================================

let notesArray = [];
let isSubmitting = false;
let marketerValidationTimeout = null;

console.log('✅ reg.js تم تحميل');

// ============================================================
//  👁️ togglePasswordVisibility — إظهار / إخفاء كلمة السر
//  الاستخدام: onclick="togglePasswordVisibility('childPassword', this)"
// ============================================================
function togglePasswordVisibility(fieldId, btn) {
    const input = document.getElementById(fieldId);
    if (!input) return;

    const isCurrentlyPassword = input.type === 'password';

    // تبديل نوع الحقل
    input.type = isCurrentlyPassword ? 'text' : 'password';

    // تحديث أيقونة العين
    if (btn) {
        const icon = btn.querySelector('i');
        if (icon) {
            if (isCurrentlyPassword) {
                // كان مخفي → بقى ظاهر → اعرض أيقونة "إخفاء"
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            } else {
                // كان ظاهر → بقى مخفي → اعرض أيقونة "إظهار"
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            }
        }
        // Accessibility
        btn.setAttribute('aria-label', isCurrentlyPassword ? 'إخفاء كلمة السر' : 'إظهار كلمة السر');
        btn.setAttribute('aria-pressed', String(isCurrentlyPassword));
    }
}

// ============================================================
//  🚫 منع الحروف العربية داخل حقل كلمة السر
//  يسمح فقط بـ: حروف إنجليزية + أرقام + رموز (ASCII)
//  يشتغل مع الكتابة + اللصق + الإدخال الصوتي
// ============================================================
const ARABIC_CHARS_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * يمسح أي حرف عربي من نص مُدخل
 * @param {string} str
 * @returns {string} النص بعد التنظيف
 */
function stripArabicChars(str) {
    if (!str) return '';
    return str.replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g, '');
}

/**
 * يربط الحماية على حقل كلمة السر
 * @param {string} fieldId
 */
function guardPasswordFieldAgainstArabic(fieldId) {
    const input = document.getElementById(fieldId);
    if (!input) return;

    // 1️⃣ beforeinput: منع الإدخال من الأصل (لو الحرف عربي)
    input.addEventListener('beforeinput', function (e) {
        // فقط للأنواع اللي فيها نص
        if (!e.data) return;
        if (ARABIC_CHARS_REGEX.test(e.data)) {
            e.preventDefault();
        }
    });

    // 2️⃣ input: شبكة أمان — تمسح أي عربي دخل باللصق أو غيره
    input.addEventListener('input', function (e) {
        const original = e.target.value;
        const cleaned = stripArabicChars(original);

        if (original !== cleaned) {
            // احتفظ بمكان المؤشر تقريباً بعد التنظيف
            const pos = e.target.selectionStart || cleaned.length;
            const removedCount = original.length - cleaned.length;
            e.target.value = cleaned;

            // أعد ضبط المؤشر
            const newPos = Math.max(0, pos - removedCount);
            try {
                e.target.setSelectionRange(newPos, newPos);
            } catch (_) { /* بعض المتصفحات لا تدعمها على type=password قبل التبديل */ }
        }
    });

    // 3️⃣ paste: تأكيد إضافي (input كافي لكن للاحتياط)
    input.addEventListener('paste', function (e) {
        const pasted = (e.clipboardData || window.clipboardData).getData('text');
        if (ARABIC_CHARS_REGEX.test(pasted)) {
            e.preventDefault();
            const cleaned = stripArabicChars(pasted);
            if (cleaned) {
                // أدخل النص النظيف فقط
                const start = input.selectionStart || 0;
                const end = input.selectionEnd || 0;
                const current = input.value;
                input.value = current.slice(0, start) + cleaned + current.slice(end);
                const newPos = start + cleaned.length;
                try {
                    input.setSelectionRange(newPos, newPos);
                } catch (_) {}
                // أطلق حدث input عشان التحقق يشتغل
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    });
}

// ============================================================
//  📱 حماية حقول الهواتف — أرقام إنجليزية فقط (0-9)
//  يشتغل مع الكتابة + اللصق + احترام maxlength
// ============================================================
const NON_DIGIT_REGEX = /[^0-9]/;

/**
 * يمسح أي حرف مش رقم من نص مُدخل
 * @param {string} str
 * @returns {string}
 */
function stripNonDigits(str) {
    if (!str) return '';
    return str.replace(/[^0-9]/g, '');
}

/**
 * يربط الحماية على حقل هاتف — يسمح بأرقام 0-9 فقط
 * @param {string} fieldId
 */
function guardPhoneFieldDigitsOnly(fieldId) {
    const input = document.getElementById(fieldId);
    if (!input) return;

    const maxLen = parseInt(input.getAttribute('maxlength'), 10) || 999;

    // 1️⃣ beforeinput: منع الإدخال من الأصل
    input.addEventListener('beforeinput', function (e) {
        if (!e.data) return;
        if (NON_DIGIT_REGEX.test(e.data)) {
            e.preventDefault();
        }
    });

    // 2️⃣ input: شبكة أمان (لصق، إدخال صوتي، autofill)
    input.addEventListener('input', function (e) {
        const original = e.target.value;
        let cleaned = original.replace(/[^0-9]/g, '');

        // احترم maxlength
        if (cleaned.length > maxLen) {
            cleaned = cleaned.slice(0, maxLen);
        }

        if (original !== cleaned) {
            const pos = e.target.selectionStart || cleaned.length;
            const removedCount = original.length - cleaned.length;
            e.target.value = cleaned;
            const newPos = Math.max(0, pos - removedCount);
            try {
                e.target.setSelectionRange(newPos, newPos);
            } catch (_) {}
        }
    });

    // 3️⃣ paste: تنظيف النص الملصوق + احترام maxlength
    input.addEventListener('paste', function (e) {
        const pasted = (e.clipboardData || window.clipboardData).getData('text');
        if (NON_DIGIT_REGEX.test(pasted)) {
            e.preventDefault();
            const cleaned = stripNonDigits(pasted);
            if (!cleaned) return;

            const start = input.selectionStart || 0;
            const end = input.selectionEnd || 0;
            const current = input.value;
            let combined = current.slice(0, start) + cleaned + current.slice(end);

            if (combined.length > maxLen) {
                combined = combined.slice(0, maxLen);
            }

            input.value = combined;
            const newPos = Math.min(start + cleaned.length, combined.length);
            try {
                input.setSelectionRange(newPos, newPos);
            } catch (_) {}
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });
}

// ============================================================
//  التحقق من وجود Utils واستخدامه مباشرة
// ============================================================
let Utils = window.Utils || {};

// دوال احتياطية في حالة عدم تحميل utils.js
if (!window.Utils) {
    console.error('❌ utils.js لم يتم تحميله! سيتم استخدام دوال احتياطية.');
    window.Utils = {
        normalizeEgyptPhone: function(raw) { return null; },
        processAbdName: function(name) { return []; },
        validateFullName: function(name) { return false; },
        preventNonArabic: function(e) {},
        preventSpaceAfterAbd: function(e) {},
        autoMergeAbd: function(e) {},
        fileToBase64: function(file) { return Promise.resolve(''); },
        compressImage: function(file) { return Promise.resolve(file); },
        validateGoogleMaps: function(url) { return true; },
        showFieldError: function(id, msg) {},
        hideFieldError: function(id) {},
        restrictMarketerId: function(e) {},
        getSafeErrorMessage: function(err) { return 'حدث خطأ'; }
    };
    Utils = window.Utils;
}

// ============================================================
//  🔐 validateChildPassword — التحقق من قوة كلمة السر
//  (يطابق شروط family-write.js)
// ============================================================
function validateChildPassword(pwd) {
    if (!pwd || typeof pwd !== 'string') return false;
    if (pwd.length < 8) return false;
    if (!/[A-Za-z]/.test(pwd)) return false;
    if (!/[0-9]/.test(pwd)) return false;

    // ✅ رموز خاصة محددة
    const SPECIAL_CHARS = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/;
    if (!SPECIAL_CHARS.test(pwd)) return false;

    // ✅ منع الحروف العربية
    if (/[\u0600-\u06FF]/.test(pwd)) return false;

    return true;
}

// ============================================================
//  تحميل الإعدادات من Supabase (عبر Vercel API)
// ============================================================
async function loadConfig() {
    console.log('🔄 loadConfig بدأت');
    try {
        // 1. fallback سريع من localStorage
        const stored = localStorage.getItem('remainingOffers');
        if (stored) document.getElementById('remainingCount').textContent = stored;

        // 2. fetch من Vercel (Supabase-First)
        const configRes = await fetch('/api?action=config', { cache: 'no-store' });
        const config = await configRes.json();
        console.log('📩 استجابة config:', config);

        if (!config.success) {
            console.warn('⚠️ config API رجع success=false:', config.error);
            return;
        }

        // 3. العروض المتبقية
        const remaining = config.remainingOffers ?? 0;
        document.getElementById('remainingCount').textContent = remaining;
        localStorage.setItem('remainingOffers', remaining);

        const launchOption = document.querySelector('#planSelect option[value="launch"]');
        if (launchOption) {
            if (remaining <= 0) {
                launchOption.style.display = 'none';
                if (document.getElementById('planSelect').value === 'launch') {
                    document.getElementById('planSelect').value = '';
                }
            } else {
                launchOption.style.display = '';
            }
        }

        // 4. رقم المحفظة
        const walletPhone = Utils.normalizeEgyptPhone(config.walletNumber);
        const whatsappLink = document.getElementById('whatsappLink');
        if (whatsappLink && walletPhone) {
            whatsappLink.href = `https://wa.me/${walletPhone.international}`;
        }
        if (config.walletNumber) {
            document.getElementById('merchantWallet').innerText = config.walletNumber;
        }

        console.log('✅ loadConfig اكتملت بنجاح');
    } catch (e) {
        console.warn('⚠️ فشل تحميل الإعدادات:', e);
    }
}

// ============================================================
//  دوال التحقق من الحقول
// ============================================================
function validateField(fieldId) {
    let valid = true;
    switch (fieldId) {
        case 'childImage':
            const file = document.getElementById('childImage').files[0];
            if (!file) {
                Utils.showFieldError('image', '📸 يرجى اختيار صورة الطفل');
                valid = false;
            } else if (file.size > 5 * 1024 * 1024) {
                Utils.showFieldError('image', '⚠️ حجم الصورة كبير جداً. الحد الأقصى المسموح به هو 5 ميجابايت.');
                valid = false;
            } else {
                Utils.hideFieldError('image');
            }
            break;
        case 'childName':
            if (!Utils.validateFullName(document.getElementById('childName').value)) {
                Utils.showFieldError('name', '🔤 يجب أن يكون الاسم رباعياً');
                valid = false;
            } else {
                Utils.hideFieldError('name');
            }
            break;
        case 'birthDate':
            if (!document.getElementById('birthDate').value) {
                Utils.showFieldError('date', '📅 يرجى اختيار تاريخ الميلاد');
                valid = false;
            } else {
                Utils.hideFieldError('date');
            }
            break;
        case 'googleMapsAddress':
            const mapsVal = document.getElementById('googleMapsAddress').value.trim();
            if (mapsVal !== '' && !Utils.validateGoogleMaps(mapsVal)) {
                Utils.showFieldError('maps', '🗺️ رابط غير صحيح (يجب أن يبدأ بـ https://maps.app.goo.gl/)');
                valid = false;
            } else {
                Utils.hideFieldError('maps');
            }
            break;
        case 'detailedAddress':
            if (!document.getElementById('detailedAddress').value.trim()) {
                Utils.showFieldError('detailed', '🏠 يرجى إدخال العنوان التفصيلي');
                valid = false;
            } else {
                Utils.hideFieldError('detailed');
            }
            break;
        case 'fatherPhone':
            let f = document.getElementById('fatherPhone').value.trim();
            if (f && !Utils.normalizeEgyptPhone(f)) {
                Utils.showFieldError('fatherPhone', '📱 رقم غير صحيح');
                valid = false;
            } else {
                Utils.hideFieldError('fatherPhone');
            }
            break;
        case 'motherPhone':
            let m = document.getElementById('motherPhone').value.trim();
            if (m && !Utils.normalizeEgyptPhone(m)) {
                Utils.showFieldError('motherPhone', '📱 رقم غير صحيح');
                valid = false;
            } else {
                Utils.hideFieldError('motherPhone');
            }
            break;
        case 'planSelect':
            if (!document.getElementById('planSelect').value) {
                Utils.showFieldError('plan', '📋 يرجى اختيار خطة الاشتراك');
                valid = false;
            } else {
                Utils.hideFieldError('plan');
            }
            break;
        case 'emailCode':
            let email = document.getElementById('emailCode').value.trim();
            if (!email) {
                Utils.showFieldError('emailCode', '✉️ البريد الإلكتروني مطلوب');
                valid = false;
            } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                Utils.showFieldError('emailCode', '✉️ بريد إلكتروني غير صحيح');
                valid = false;
            } else {
                Utils.hideFieldError('emailCode');
            }
            break;
        case 'notes':
            if (document.getElementById('noteInput').value.trim()) {
                Utils.showFieldError('notes', '📝 لديك ملاحظة غير مضافة! اضغط على زر "إضافة" أولاً.');
                valid = false;
            } else {
                Utils.hideFieldError('notes');
            }
            break;
        case 'childPassword':
            const pwd = document.getElementById('childPassword').value;
            if (!pwd) {
                Utils.showFieldError('childPassword', '🔐 كلمة السر مطلوبة');
                valid = false;
            } else if (!validateChildPassword(pwd)) {
                Utils.showFieldError('childPassword', '🔐 8+ أحرف إنجليزية، حرف، رقم، ورمز خاص (@ # $ !)');
                valid = false;
            } else {
                Utils.hideFieldError('childPassword');
            }
            break;
    }
    updateSubmitState();
    return valid;
}

// ============================================================
//  التحقق العام من صحة النموذج
// ============================================================
function validateForm() {
    try {
        const imageFile = document.getElementById('childImage').files[0];
        const imageValid = imageFile && imageFile.size <= 5 * 1024 * 1024;
        const nameValid = Utils.validateFullName(document.getElementById('childName').value);
        const birthValid = !!document.getElementById('birthDate').value;
        const mapsUrl = document.getElementById('googleMapsAddress').value.trim();
        const mapsValid = mapsUrl === '' || Utils.validateGoogleMaps(mapsUrl);
        const detailedValid = !!document.getElementById('detailedAddress').value.trim();
        const planValid = !!document.getElementById('planSelect').value;
        const agreementsValid = document.getElementById('acknowledgement').checked && document.getElementById('privacyPolicy').checked && document.getElementById('termsConditions').checked;
        const fPhone = document.getElementById('fatherPhone').value.trim();
        const mPhone = document.getElementById('motherPhone').value.trim();
        const fatherValid = fPhone === '' || Utils.normalizeEgyptPhone(fPhone) !== null;
        const motherValid = mPhone === '' || Utils.normalizeEgyptPhone(mPhone) !== null;
        
        let atLeastOnePhone = (fPhone !== '' || mPhone !== '');
        
        const email = document.getElementById('emailCode').value.trim();
        let emailValid = (email !== '' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));

        const pwd = document.getElementById('childPassword').value;
        const passwordValid = validateChildPassword(pwd);

        const notePending = document.getElementById('noteInput').value.trim().length > 0;

        return imageValid && nameValid && birthValid && mapsValid && detailedValid && planValid && agreementsValid && fatherValid && motherValid && atLeastOnePhone && emailValid && passwordValid && !notePending;
    } catch (e) {
        console.error('❌ خطأ في validateForm:', e);
        return false;
    }
}

function updateSubmitState() {
    try {
        const btn = document.getElementById('submitBtn');
        if (btn) btn.disabled = !validateForm();
    } catch (e) {
        console.error('❌ خطأ في updateSubmitState:', e);
    }
}

// ============================================================
//  دوال إدارة الملاحظات
// ============================================================
function renderNotes() {
    const list = document.getElementById('notesList');
    list.innerHTML = '';
    notesArray.forEach((note, i) => {
        list.innerHTML += `<li><span class="note-text">${note}</span><button class="delete-note" onclick="deleteNote(${i})">🗑 حذف</button></li>`;
    });
}

function deleteNote(i) { notesArray.splice(i, 1); renderNotes(); updateSubmitState(); }

// ============================================================
//  دوال التحقق من كود المسوق
// ============================================================
async function validateMarketerCode(code) {
    const priceDisplay = document.getElementById('priceDisplay');
    const marketerField = document.getElementById('marketerIdInput');
    
    if (!code || code.length < 2) {
        const plan = document.getElementById('planSelect').value;
        let price = 0;
        if (plan === '6months') price = 250;
        else if (plan === '1year') price = 500;
        if (price > 0) {
            priceDisplay.textContent = `السعر: ${price} جنيه مصري`;
            priceDisplay.style.display = 'block';
            priceDisplay.style.color = 'var(--text-secondary)';
            if (!marketerField.readOnly) marketerField.style.borderColor = 'var(--border-color)';
        }
        return { status: 'empty' };
    }

    try {
        const response = await fetch(`/api?action=marketer&innerAction=validateMarketerCode&code=${encodeURIComponent(code)}`);
        const result = await response.json();

        const plan = document.getElementById('planSelect').value;
        let originalPrice = 0;
        if (plan === '6months') originalPrice = 250;
        else if (plan === '1year') originalPrice = 500;

        // ✅ حالة 1: كود صحيح + نشط
        if (result.success && result.valid) {
            const discount = result.discount || 10;
            if (originalPrice > 0) {
                const finalPrice = Math.round(originalPrice * (1 - discount / 100));
                priceDisplay.textContent = `السعر: ${finalPrice} جنيه (خصم ${discount}% - كان ${originalPrice} جنيه)`;
                priceDisplay.style.display = 'block';
                priceDisplay.style.color = 'var(--secondary-color)';
                priceDisplay.style.fontWeight = 'bold';
            } else {
                priceDisplay.style.display = 'none';
            }
            marketerField.style.borderColor = 'var(--secondary-color)';
            return { status: 'valid', discount };
        }

        // ✅ حالة 2: كود غير صالح (not_found / inactive)
        if (result.success && !result.valid) {
            const reason = result.reason || 'not_found';
            if (originalPrice > 0) {
                priceDisplay.textContent = `السعر: ${originalPrice} جنيه مصري`;
                priceDisplay.style.display = 'block';
                priceDisplay.style.color = 'var(--text-secondary)';
            }
            marketerField.style.borderColor = 'var(--danger-color)';
            return { status: reason === 'inactive' ? 'inactive' : 'not_found' };
        }

        return { status: 'error' };
    } catch (err) {
        console.warn('⚠️ فشل التحقق من كود المسوق:', err);
        return { status: 'error' };
    }
}

// ============================================================
//  🎁 Ref Link Mode — دعم ?ref=MA0001
// ============================================================
let refModeActive = false;   // true لو المستخدم دخل من رابط مسوق
let refActiveCode = '';      // الكود المُفعّل حاليًا

/**
 * تُستدعى عند DOMContentLoaded — تقرأ ?ref= من URL وتتحقق
 */
async function applyRefCode() {
    const params = new URLSearchParams(window.location.search);
    const refCode = (params.get('ref') || '').trim().toUpperCase();
    if (!refCode) return;

    const marketerField = document.getElementById('marketerIdInput');
    if (!marketerField) return;

    // ضع الكود في الحقل مؤقتًا للتحقق
    marketerField.value = refCode;

    // تحقق
    const result = await validateMarketerCode(refCode);

    if (result.status === 'valid') {
        refModeActive = true;
        refActiveCode = refCode;
        lockMarketerField();
        showRefBadge(refCode, result.discount);
        updateRefBadgeForPlan();

    } else if (result.status === 'inactive') {
        // كود موجود لكن غير نشط → حقل قابل للتعديل + تحذير
        marketerField.value = refCode; // نتركه ليعدله
        showRefWarning('⚠️ كود المسوق غير نشط حاليًا. يمكنك تعديله أو إدخال كود آخر، أو حذفه والمتابعة بدون مسوق.');

    } else if (result.status === 'not_found') {
        // كود غير موجود → modal خطأ
        marketerField.value = ''; // نظّف الحقل
        showInvalidRefModal(refCode);

    } else {
        // خطأ شبكة
        marketerField.value = '';
        showRefWarning('⚠️ تعذر التحقق من كود المسوق. تأكد من اتصالك بالإنترنت.');
    }
}

/**
 * قفل حقل الكود (readOnly — عشان القيمة تتبعت)
 */
function lockMarketerField() {
    const marketerField = document.getElementById('marketerIdInput');
    if (!marketerField) return;
    marketerField.readOnly = true;
    marketerField.classList.add('locked');
    marketerField.style.borderColor = 'var(--secondary-color)';

    // منع السحب/التعديل
    marketerField.addEventListener('keydown', function(e) { e.preventDefault(); });
    marketerField.addEventListener('paste', function(e) { e.preventDefault(); });
}

/**
 * عرض Badge تحت الحقل
 */
function showRefBadge(code, discount) {
    const marketerField = document.getElementById('marketerIdInput');
    if (!marketerField) return;
    const formGroup = marketerField.closest('.form-group');
    if (!formGroup) return;

    const old = document.getElementById('refCodeBadge');
    if (old) old.remove();
    const oldWarning = document.getElementById('refCodeWarning');
    if (oldWarning) oldWarning.remove();

    const badge = document.createElement('div');
    badge.id = 'refCodeBadge';
    badge.className = 'ref-code-badge';
    badge.setAttribute('data-discount', String(discount || 10)); // ✅ حفظ النسبة
    badge.innerHTML =
        '<span class="ref-code-icon">🎁</span>' +
        '<span class="ref-code-text">كود المسوق مُفعّل: <strong>' + code + '</strong></span>' +
        '<span class="ref-code-lock" title="مقفل">🔒</span>';

    formGroup.appendChild(badge);
}

/**
 * تحديث Badge حسب الخطة المختارة
 * (لإظهار/إخفاء نسبة الخصم)
 */
function updateRefBadgeForPlan() {
    if (!refModeActive) return;
    const badge = document.getElementById('refCodeBadge');
    if (!badge) return;

    const plan = document.getElementById('planSelect').value;
    const isPaid = (plan === '6months' || plan === '1year');

    let discountPill = badge.querySelector('.ref-code-discount');
    if (isPaid) {
        // اجلب نسبة الخصم من validateMarketerCode (شفناها قبل)
        const discount = parseInt(badge.getAttribute('data-discount') || '10', 10);
        if (!discountPill) {
            discountPill = document.createElement('span');
            discountPill.className = 'ref-code-discount';
            const lock = badge.querySelector('.ref-code-lock');
            badge.insertBefore(discountPill, lock);
        }
        discountPill.textContent = 'خصم ' + discount + '%';
    } else {
        if (discountPill) discountPill.remove();
    }
}

/**
 * عرض تحذير للكود غير النشط (inline تحت الحقل)
 */
function showRefWarning(message) {
    const marketerField = document.getElementById('marketerIdInput');
    if (!marketerField) return;
    const formGroup = marketerField.closest('.form-group');
    if (!formGroup) return;

    const old = document.getElementById('refCodeWarning');
    if (old) old.remove();

    const warning = document.createElement('div');
    warning.id = 'refCodeWarning';
    warning.className = 'ref-code-warning';
    warning.innerHTML = '<span class="ref-warning-icon">⚠️</span><span>' + message + '</span>';
    formGroup.appendChild(warning);
}

/**
 * Modal كود غير موجود — يمنع المتابعة إلا بزر
 */
function showInvalidRefModal(code) {
    const old = document.getElementById('invalidRefOverlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'invalidRefOverlay';
    overlay.className = 'invalid-ref-overlay';
    overlay.innerHTML =
        '<div class="invalid-ref-modal">' +
            '<div class="invalid-ref-icon">❌</div>' +
            '<h3>كود المسوق غير صحيح</h3>' +
            '<p>الكود <strong style="direction:ltr; display:inline-block;">' + code + '</strong> غير موجود في النظام أو تم حذفه.</p>' +
            '<p>يمكنك المتابعة والتسجيل بدون كود مسوق.</p>' +
            '<a href="/reg.html" class="btn-ref-continue">' +
                '🔄 المتابعة بدون كود مسوق' +
            '</a>' +
        '</div>';

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
}

// ============================================================
//  ربط أحداث التحقق والإعدادات
// ============================================================
function bindFormValidation() {
    console.log('🔄 bindFormValidation بدأت');
    try {
        // دالة مساعدة لفحص شرط "رقم هاتف واحد على الأقل" عند الخروج من حقول الهواتف
        const checkPhoneRequirement = () => {
            const fPhone = document.getElementById('fatherPhone').value.trim();
            const mPhone = document.getElementById('motherPhone').value.trim();
            if (fPhone === '' && mPhone === '') {
                Utils.showFieldError('motherPhone', '📱 يجب إدخال رقم هاتف الأب أو الأم على الأقل');
            } else {
                Utils.hideFieldError('motherPhone');
                if (fPhone !== '') validateField('fatherPhone');
                if (mPhone !== '') validateField('motherPhone');
            }
        };

        document.getElementById('childImage').addEventListener('change', () => { validateField('childImage'); updateSubmitState(); });
        
        // تم تغيير input إلى blur للتحقق فقط عند الخروج من الحقل
        document.getElementById('childName').addEventListener('blur', () => { validateField('childName'); });
        document.getElementById('childName').addEventListener('input', updateSubmitState);

        document.getElementById('birthDate').addEventListener('change', () => { validateField('birthDate'); updateSubmitState(); });
        document.getElementById('birthDate').addEventListener('blur', () => { validateField('birthDate'); });

        document.getElementById('googleMapsAddress').addEventListener('blur', () => { validateField('googleMapsAddress'); });
        document.getElementById('googleMapsAddress').addEventListener('input', updateSubmitState);

        document.getElementById('detailedAddress').addEventListener('blur', () => { validateField('detailedAddress'); });
        document.getElementById('detailedAddress').addEventListener('input', updateSubmitState);

        document.getElementById('fatherPhone').addEventListener('blur', checkPhoneRequirement);
        document.getElementById('fatherPhone').addEventListener('input', updateSubmitState);

        document.getElementById('motherPhone').addEventListener('blur', checkPhoneRequirement);
        document.getElementById('motherPhone').addEventListener('input', updateSubmitState);

        document.getElementById('emailCode').addEventListener('blur', () => { validateField('emailCode'); });
        document.getElementById('emailCode').addEventListener('input', updateSubmitState);

        document.getElementById('childPassword').addEventListener('blur', () => { validateField('childPassword'); });
        document.getElementById('childPassword').addEventListener('input', updateSubmitState);

        document.getElementById('noteInput').addEventListener('blur', () => { validateField('notes'); });
        document.getElementById('noteInput').addEventListener('input', updateSubmitState);
        
        document.getElementById('planSelect').addEventListener('change', () => {
            validateField('planSelect');
            const val = document.getElementById('planSelect').value;
            const offerNotice = document.getElementById('offerNotice');
            const freeNotice = document.getElementById('freeNotice');
            const priceDiv = document.getElementById('priceDisplay');
            const marketerField = document.getElementById('marketerIdInput');
            
            let price = 0;
            if (val === '6months') price = 250;
            else if (val === '1year') price = 500;
            
            if (val === 'launch') {
                offerNotice.classList.add('show');
                freeNotice.classList.add('show');
                priceDiv.style.display = 'none';
                // ✅ احترم قفل الحقل من الـ ref
                if (!marketerField.readOnly) {
                    marketerField.style.borderColor = 'var(--border-color)';
                }
            } else if (val === '6months' || val === '1year') {
                offerNotice.classList.remove('show');
                freeNotice.classList.remove('show');
                priceDiv.textContent = `السعر: ${price} جنيه مصري`;
                priceDiv.style.display = 'block';
                priceDiv.style.color = 'var(--text-secondary)';
                const code = marketerField.value.trim().toUpperCase();
                if (code && code.length >= 2) {
                    validateMarketerCode(code);
                }
            } else {
                // 👈 التعديل هنا: إخفاء إشعارات العرض المجاني والسعر
                offerNotice.classList.remove('show');
                freeNotice.classList.remove('show');
                priceDiv.style.display = 'none';
            }
            // ✅ حدّث الـ badge حسب الخطة
            updateRefBadgeForPlan();
            updateSubmitState();
        });
        
        document.getElementById('addNoteBtn').addEventListener('click', () => {
            const val = document.getElementById('noteInput').value.trim();
            if (val) {
                notesArray.push(val);
                document.getElementById('noteInput').value = '';
                renderNotes();
                Utils.hideFieldError('notes');
                updateSubmitState();
            }
        });
        
        ['acknowledgement', 'privacyPolicy', 'termsConditions'].forEach(id => {
            document.getElementById(id).addEventListener('change', updateSubmitState);
        });
        
        document.getElementById('childImage').addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const preview = document.getElementById('imagePreview');
                    preview.innerHTML = `<img src="${ev.target.result}" alt="معاينة">`;
                };
                reader.readAsDataURL(file);
            }
            validateField('childImage');
            updateSubmitState();
        });

        const marketerField = document.getElementById('marketerIdInput');
        if (marketerField) {
            marketerField.addEventListener('input', function(e) {
                Utils.restrictMarketerId(e);
                clearTimeout(marketerValidationTimeout);
                const code = this.value.trim().toUpperCase();
                marketerValidationTimeout = setTimeout(() => {
                    validateMarketerCode(code);
                }, 500);
            });
        }
        
        // ❌ تم إزالة سطر الاستدعاء الجماعي الذي كان يظهر الأخطاء فور تحميل الصفحة:
        // ['childImage', 'childName', ...].forEach(id => validateField(id));
        
        updateSubmitState();
        console.log('✅ bindFormValidation اكتملت');
    } catch (e) {
        console.error('❌ خطأ في bindFormValidation:', e);
    }
}

// ============================================================
//  متغيرات المودال الجديد
// ============================================================
let modalState = {
    childID: '',
    notificationMethod: 'email',
    currentParentType: 'father',
    currentToken: null,
    currentLinkExpiry: null,
    pollingInterval: null,
    countdownInterval: null,
    linkedParent: null // 'father' | 'mother' | null
};

// ============================================================
//  عرض المودال الجديد
// ============================================================
function showSuccessModal(childID, plan, childLink, customMessage, notificationMethod, email, paymentRequired, paymentLink) {
    const modal = document.getElementById('successModal');
    const modalChildID = document.getElementById('modalChildID');
    const paymentSection = document.getElementById('modalPaymentSection');
    const goToPaymentBtn = document.getElementById('goToPaymentBtn');
    const telegramSection = document.getElementById('modalTelegramSection');
    const emailSection = document.getElementById('modalEmailSection');
    const emailAddressEl = document.getElementById('modalEmailAddress');
    const afterLinkSection = document.getElementById('afterLinkSuccessSection');

    // إعادة تعيين الحالة
    modalState = {
        childID: childID,
        notificationMethod: notificationMethod || 'email',
        currentParentType: 'father',
        currentToken: null,
        currentLinkExpiry: null,
        pollingInterval: null,
        countdownInterval: null,
        linkedParent: null
    };

    modalChildID.textContent = childID;
    afterLinkSection.style.display = 'none';

    // 🆕 الخطة المدفوعة → عرض قسم الدفع فقط
    if (paymentRequired) {
        if (paymentSection) paymentSection.style.display = 'block';
        if (goToPaymentBtn) goToPaymentBtn.href = paymentLink || '#';

        // إخفاء أقسام الربط
        telegramSection.style.display = 'none';
        emailSection.style.display = 'none';

        modal.style.display = 'flex';
        modal.classList.add('show');
        return;
    }

    // ✅ الخطة المجانية → السلوك القديم
    if (paymentSection) paymentSection.style.display = 'none';

    if (notificationMethod === 'telegram') {
        telegramSection.style.display = 'block';
        emailSection.style.display = 'none';

        const fatherRadio = document.querySelector('input[name="parentType"][value="father"]');
        const motherRadio = document.querySelector('input[name="parentType"][value="mother"]');
        if (fatherRadio) fatherRadio.checked = true;
        if (motherRadio) motherRadio.checked = false;

        setTimeout(() => {
            generateParentQR('father');
        }, 300);
    } else {
        telegramSection.style.display = 'none';
        emailSection.style.display = 'block';
        emailAddressEl.textContent = email || '--';
    }

    modal.style.display = 'flex';
    modal.classList.add('show');
}

// ============================================================
//  توليد QR للطرف المحدد
// ============================================================
async function generateParentQR(parentType) {
    const qrLoading = document.getElementById('qrLoadingText');
    const qrImage = document.getElementById('qrCodeImageNew');
    const openTelegramBtn = document.getElementById('openTelegramBtnNew');
    const linkingStatusText = document.getElementById('linkingStatusTextNew');
    const countdownEl = document.getElementById('countdownTextNew');

    // إيقاف أي polling قديم
    stopParentQRPolling();

    modalState.currentParentType = parentType;

    // إعادة تعيين العرض
    qrImage.style.display = 'none';
    qrLoading.style.display = 'block';
    linkingStatusText.innerHTML = '<i class="fas fa-spinner fa-spin"></i> في انتظار الربط...';
    openTelegramBtn.style.display = 'flex';
    countdownEl.textContent = '05:00';

    try {
        const res = await fetch('/api?action=telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                innerAction: 'generateLinkToken',
                childID: modalState.childID,
                parentType: parentType
            })
        });

        const data = await res.json();
        console.log('📩 generateLinkToken:', data);

        if (!data.success) {
            qrLoading.innerHTML = `<p style="color: var(--danger-color);">❌ ${data.message || data.error || 'فشل توليد الرابط'}</p>`;
            return;
        }

        modalState.currentToken = data.token;
        modalState.currentLinkExpiry = new Date(data.expiresAt).getTime();

        console.log('⏱️ [generateParentQR] expiresAt raw:', data.expiresAt);
        console.log('⏱️ [generateParentQR] parsed:', new Date(data.expiresAt).toString());
        console.log('⏱️ [generateParentQR] remaining (sec):',
                    Math.round((modalState.currentLinkExpiry - Date.now()) / 1000));

        // QR
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(data.deepLink)}`;
        qrImage.onload = () => {
            qrLoading.style.display = 'none';
            qrImage.style.display = 'block';
        };
        qrImage.onerror = () => {
            qrLoading.innerHTML = '<p style="color: var(--danger-color);">⚠️ فشل تحميل QR</p>';
        };
        qrImage.src = qrUrl;

        openTelegramBtn.href = data.deepLink;

        // بدء العد التنازلي + Polling
        startParentQRCountdown();
        startParentQRPolling();

    } catch (err) {
        console.error('❌ generateParentQR:', err);
        qrLoading.innerHTML = '<p style="color: var(--danger-color);">⚠️ خطأ في الاتصال</p>';
    }
}

// ============================================================
//  العد التنازلي
// ============================================================
function startParentQRCountdown() {
    if (modalState.countdownInterval) clearInterval(modalState.countdownInterval);

    function tick() {
        const remaining = modalState.currentLinkExpiry - Date.now();
        const countdownEl = document.getElementById('countdownTextNew');
        if (!countdownEl) return;

        if (remaining <= 0) {
            countdownEl.textContent = '00:00';
            clearInterval(modalState.countdownInterval);
            modalState.countdownInterval = null;
            stopParentQRPolling();
            const linkingStatusText = document.getElementById('linkingStatusTextNew');
            if (linkingStatusText) {
                linkingStatusText.innerHTML = '<span style="color: var(--danger-color);">⏰ انتهت صلاحية الرابط</span>';
            }
            return;
        }
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        countdownEl.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    }
    tick();
    modalState.countdownInterval = setInterval(tick, 1000);
}

// ============================================================
//  Polling للكشف عن الربط
// ============================================================
function startParentQRPolling() {
    // ✅ إيقاف الـ polling القديم فقط — بدون لمس الـ countdown
    if (modalState.pollingInterval) {
        clearInterval(modalState.pollingInterval);
        modalState.pollingInterval = null;
    }

    modalState.pollingInterval = setInterval(async () => {
        try {
            const res = await fetch('/api?action=telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    innerAction: 'getTelegramStatus',
                    childID: modalState.childID
                })
            });

            const data = await res.json();
            const targetParent = modalState.currentParentType;
            const targetData = data[targetParent];

            if (data.success && targetData && targetData.isLinked) {
                handleParentLinked(targetParent);
            }
        } catch (err) {
            console.warn('⚠️ polling error:', err);
        }
    }, 3000);
}

function stopParentQRPolling() {
    if (modalState.pollingInterval) {
        clearInterval(modalState.pollingInterval);
        modalState.pollingInterval = null;
    }
    if (modalState.countdownInterval) {
        clearInterval(modalState.countdownInterval);
        modalState.countdownInterval = null;
    }
}

// ============================================================
//  معالجة نجاح الربط
// ============================================================
function handleParentLinked(parentType) {
    stopParentQRPolling();

    const linkingStatusText = document.getElementById('linkingStatusTextNew');
    const afterLinkSection = document.getElementById('afterLinkSuccessSection');
    const linkedSuccessText = document.getElementById('linkedSuccessText');
    const linkOtherParentText = document.getElementById('linkOtherParentText');
    const otherParent = parentType === 'father' ? 'mother' : 'father';
    const parentLabel = parentType === 'father' ? 'الأب' : 'الأم';
    const otherLabel = otherParent === 'father' ? 'الأب' : 'الأم';

    // تحديث حالة النص
    if (linkingStatusText) {
        linkingStatusText.innerHTML = `<span style="color: var(--secondary-color); font-size: 1rem;">✅ تم ربط ${parentLabel} بنجاح!</span>`;
    }

    // إظهار قسم ما بعد الربط
    modalState.linkedParent = parentType;
    if (linkedSuccessText) linkedSuccessText.textContent = `تم ربط ${parentLabel} بنجاح!`;
    if (linkOtherParentText) linkOtherParentText.textContent = `ربط ${otherLabel} أيضاً`;
    if (afterLinkSection) afterLinkSection.style.display = 'block';
}

// ============================================================
//  ربط الطرف الآخر - Deep Link
// ============================================================
function linkOtherParentFromModal() {
    const otherParent = modalState.linkedParent === 'father' ? 'mother' : 'father';
    window.location.href = `/dashboard?open=notifications&type=${otherParent}`;
}

// ============================================================
//  ربط أحداث المودال الجديد
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    // Radio تغيير نوع الوالد
    document.querySelectorAll('input[name="parentType"]').forEach(radio => {
        radio.addEventListener('change', function() {
            if (this.checked) {
                // إخفاء قسم ما بعد الربط عند التغيير
                const afterLinkSection = document.getElementById('afterLinkSuccessSection');
                if (afterLinkSection) afterLinkSection.style.display = 'none';

                generateParentQR(this.value);
            }
        });
    });

    // زر ربط الطرف الآخر
    const linkOtherBtn = document.getElementById('linkOtherParentBtn');
    if (linkOtherBtn) {
        linkOtherBtn.addEventListener('click', linkOtherParentFromModal);
    }
});

// ============================================================
//  نسخ رقم المحفظة
// ============================================================
function copyWalletNumber() {
    const walletSpan = document.getElementById('merchantWallet');
    if (!walletSpan) {
        console.error('عنصر merchantWallet غير موجود');
        return;
    }
    const walletText = walletSpan.innerText;
    if (!walletText) {
        alert('⚠️ رقم المحفظة غير موجود');
        return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(walletText)
            .then(() => alert('✅ تم نسخ رقم المحفظة: ' + walletText))
            .catch(() => fallbackCopy(walletText));
    } else {
        fallbackCopy(walletText);
    }
}

function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        alert('✅ تم نسخ رقم المحفظة: ' + text);
    } catch (err) {
        alert('❌ فشل النسخ، يرجى نسخ الرقم بنفسك');
    }
    document.body.removeChild(textarea);
}

// ============================================================
//  دوال صورة الوجه (مع إصلاح مشكلة إعادة الاختيار)
// ============================================================

let faceStream = null;
let faceImageBase64 = '';

/**
 * إعادة تعيين حالة صورة الوجه بالكامل (UI + متغيرات) - تستخدم فقط عند الإلغاء
 */
function resetFaceState() {
    // إعادة تعيين المتغيرات
    faceImageBase64 = '';
    window.faceImageBase64 = '';
    
    // إعادة تعيين حقل الملف
    const input = document.getElementById('faceImageInput');
    if (input) input.value = '';
    
    // إعادة تعيين المعاينة إلى الحالة الافتراضية
    const preview = document.getElementById('facePreview');
    if (preview) {
        preview.innerHTML = `
            <div class="placeholder">
                <i class="fas fa-user-circle"></i>
                <span>انقر لرفع أو التقاط صورة وجه واضحة</span>
            </div>
        `;
        preview.style.display = 'flex';
    }
    
    // إخفاء زر الإلغاء
    const cancelBtn = document.getElementById('cancelFaceBtn');
    if (cancelBtn) cancelBtn.style.display = 'none';
    
    // إعادة تعيين الحالة والرسائل
    const statusEl = document.getElementById('faceStatus');
    if (statusEl) {
        statusEl.className = 'face-status';
        statusEl.textContent = '';
    }
    
    const guidelines = document.getElementById('faceGuidelines');
    if (guidelines) guidelines.style.display = 'none';
    
    const consentCheck = document.getElementById('faceConsentCheck');
    if (consentCheck) {
        consentCheck.checked = false;
    }
    
    const consentError = document.getElementById('faceConsentError');
    if (consentError) consentError.classList.remove('show');
    
    // إظهار أزرار الإجراءات
    const uploadBtn = document.getElementById('uploadFaceBtn');
    const cameraBtn = document.getElementById('cameraFaceBtn');
    if (uploadBtn) uploadBtn.style.display = 'inline-flex';
    if (cameraBtn) cameraBtn.style.display = 'inline-flex';
    
    // إغلاق الكاميرا إذا كانت مفتوحة
    stopFaceCamera();
    
    // تحديث حالة زر الإرسال
    updateSubmitState();
    
    console.log('🔄 تم إعادة تعيين حالة صورة الوجه (بسبب الإلغاء)');
}

/**
 * فتح الكاميرا
 */
async function startFaceCamera() {
    try {
        faceStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
        });
        const video = document.getElementById('cameraVideo');
        video.srcObject = faceStream;
        document.getElementById('cameraContainer').style.display = 'block';
        document.getElementById('uploadFaceBtn').style.display = 'none';
        document.getElementById('cameraFaceBtn').style.display = 'none';
        document.getElementById('facePreview').style.display = 'none';
        document.getElementById('cancelFaceBtn').style.display = 'none';
    } catch (err) {
        console.error('❌ فشل فتح الكاميرا:', err);
        alert('⚠️ تعذر فتح الكاميرا. يرجى استخدام زر "رفع صورة من الجهاز".');
    }
}

/**
 * إغلاق الكاميرا
 */
function stopFaceCamera() {
    if (faceStream) {
        faceStream.getTracks().forEach(track => track.stop());
        faceStream = null;
    }
    const video = document.getElementById('cameraVideo');
    if (video) video.srcObject = null;
    const container = document.getElementById('cameraContainer');
    if (container) container.style.display = 'none';
    
    // إظهار الأزرار فقط إذا لم تكن هناك صورة
    const uploadBtn = document.getElementById('uploadFaceBtn');
    const cameraBtn = document.getElementById('cameraFaceBtn');
    const preview = document.getElementById('facePreview');
    const cancelBtn = document.getElementById('cancelFaceBtn');
    
    // إذا كانت المعاينة فارغة (placeholder) أو لا توجد صورة، نظهر الأزرار
    if (!preview || preview.querySelector('.placeholder')) {
        if (uploadBtn) uploadBtn.style.display = 'inline-flex';
        if (cameraBtn) cameraBtn.style.display = 'inline-flex';
        if (cancelBtn) cancelBtn.style.display = 'none';
    } else {
        // إذا كانت هناك صورة، نظهر الأزرار أيضاً (عدا الكاميرا)
        if (uploadBtn) uploadBtn.style.display = 'inline-flex';
        if (cameraBtn) cameraBtn.style.display = 'inline-flex';
        if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    }
}

/**
 * التقاط صورة من الكاميرا
 */
function captureFacePhoto() {
    const video = document.getElementById('cameraVideo');
    if (!video || !video.videoWidth || !video.videoHeight) {
        alert('⚠️ الكاميرا غير جاهزة. يرجى المحاولة مرة أخرى.');
        return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    
    // تخزين الصورة في المتغير العام
    faceImageBase64 = imageData;
    window.faceImageBase64 = imageData;
    
    // عرض المعاينة
    const preview = document.getElementById('facePreview');
    if (preview) {
        preview.innerHTML = `<img src="${imageData}" alt="صورة الوجه" style="width:100%; height:100%; object-fit:cover;">`;
        preview.style.display = 'flex';
    }
    
    const cancelBtn = document.getElementById('cancelFaceBtn');
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';

    // إغلاق الكاميرا
    stopFaceCamera();

    // تحليل الصورة (مع الاحتفاظ بالصورة في حالة الفشل)
    analyzeFaceImage(imageData);
}

/**
 * تحليل صورة الوجه (مع الاحتفاظ بالصورة في حالة الفشل)
 */
async function analyzeFaceImage(base64) {
    const statusEl = document.getElementById('faceStatus');
    const guidelines = document.getElementById('faceGuidelines');
    const consentCheck = document.getElementById('faceConsentCheck');
    const consentError = document.getElementById('faceConsentError');

    // إعادة تعيين الحالة السابقة (وليس الصورة)
    if (statusEl) {
        statusEl.className = 'face-status';
        statusEl.textContent = '⏳ جاري تحليل الصورة...';
        statusEl.style.display = 'block';
    }
    guidelines.style.display = 'none';
    
    consentCheck.checked = false;
    if (consentError) consentError.classList.remove('show');

    try {
        const response = await fetch('/api/analyze-face', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64 })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            let errorMsg = result.error || 'فشل تحليل الصورة';
            if (result.error === 'no_face_detected') errorMsg = '⚠️ لم يتم التعرف على وجه. حاول بصورة أخرى.';
            if (result.error === 'multiple_faces') errorMsg = '⚠️ تم اكتشاف أكثر من وجه. اختر صورة بها وجه واحد فقط.';
            
            statusEl.textContent = '❌ ' + errorMsg;
            statusEl.className = 'face-status error';
            
            // ✅ لا نقوم بحذف الصورة، بل نتركها مع رسالة خطأ
            // نضيف رسالة إضافية لتوجيه المستخدم
            statusEl.textContent += ' (يمكنك اختيار صورة أخرى)';
            // التأكد من ظهور أزرار الإجراءات لتحديد صورة جديدة
            document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
            document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
            // إعادة تعيين حقل الملف للسماح باختيار نفس الملف مرة أخرى
            document.getElementById('faceImageInput').value = '';
            return;
        }

        // فحص عدد الوجوه
        if (result.faceCount === 0) {
            statusEl.textContent = '⚠️ لم يتم التعرف على وجه. حاول بصورة أخرى. (يمكنك اختيار صورة أخرى)';
            statusEl.className = 'face-status error';
            document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
            document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
            document.getElementById('faceImageInput').value = '';
            return;
        }

        if (result.faceCount > 1) {
            statusEl.textContent = `⚠️ تم اكتشاف ${result.faceCount} وجوه. يرجى اختيار صورة تحتوي على وجه واحد فقط. (يمكنك اختيار صورة أخرى)`;
            statusEl.className = 'face-status error';
            document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
            document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
            document.getElementById('faceImageInput').value = '';
            return;
        }

        // فحص جودة الصورة
        if (result.detectionConfidence < 0.7) {
            statusEl.textContent = `⚠️ ثقة الكشف منخفضة (${Math.round(result.detectionConfidence * 100)}%). حاول بصورة أوضح. (يمكنك اختيار صورة أخرى)`;
            statusEl.className = 'face-status error';
            document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
            document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
            document.getElementById('faceImageInput').value = '';
            return;
        }

        if (result.landmarkingConfidence < 0.5) {
            statusEl.textContent = '⚠️ معالم الوجه غير واضحة. حاول بصورة أفضل. (يمكنك اختيار صورة أخرى)';
            statusEl.className = 'face-status error';
            document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
            document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
            document.getElementById('faceImageInput').value = '';
            return;
        }

        // فحص زوايا الوجه
        const isFrontal = Math.abs(result.rollAngle || 0) < 25 &&
                          Math.abs(result.panAngle || 0) < 25 &&
                          Math.abs(result.tiltAngle || 0) < 25;

        if (!isFrontal) {
            statusEl.textContent = '⚠️ وجه الطفل غير مواجه للكاميرا. حاول مرة أخرى. (يمكنك اختيار صورة أخرى)';
            statusEl.className = 'face-status error';
            document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
            document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
            document.getElementById('faceImageInput').value = '';
            return;
        }

        // فحص العوائق
        const hasHeadwear = result.headwearLikelihood === 'VERY_LIKELY' || result.headwearLikelihood === 'LIKELY';
        const isBlurred = result.blurredLikelihood === 'VERY_LIKELY' || result.blurredLikelihood === 'LIKELY';
        const isUnderExposed = result.underExposedLikelihood === 'VERY_LIKELY' || result.underExposedLikelihood === 'LIKELY';

        if (hasHeadwear) {
            statusEl.textContent = '⚠️ يرجى إزالة أي غطاء للرأس أو نظارة شمس. (يمكنك اختيار صورة أخرى)';
            statusEl.className = 'face-status error';
            document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
            document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
            document.getElementById('faceImageInput').value = '';
            return;
        }

        if (isBlurred) {
            statusEl.textContent = '⚠️ الصورة غير واضحة. يرجى التأكد من ثبات الكاميرا. (يمكنك اختيار صورة أخرى)';
            statusEl.className = 'face-status error';
            document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
            document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
            document.getElementById('faceImageInput').value = '';
            return;
        }

        if (isUnderExposed) {
            statusEl.textContent = '⚠️ الإضاءة ضعيفة جداً. حاول في مكان أكثر إضاءة. (يمكنك اختيار صورة أخرى)';
            statusEl.className = 'face-status error';
            document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
            document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
            document.getElementById('faceImageInput').value = '';
            return;
        }

        // فحص حجم الوجه
        const bbox = result.faceBoundingBox || { width: 0, height: 0 };
        const faceArea = bbox.width * bbox.height;
        const imageArea = 800 * 600;
        const faceRatio = faceArea / imageArea;

        if (faceRatio < 0.06) {
            statusEl.textContent = '⚠️ الوجه صغير جداً. يرجى التقاط صورة أقرب. (يمكنك اختيار صورة أخرى)';
            statusEl.className = 'face-status error';
            document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
            document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
            document.getElementById('faceImageInput').value = '';
            return;
        }

        // ✅ جميع الفحوصات نجحت
        statusEl.textContent = '✅ صورة الوجه واضحة ومناسبة. يمكنك المتابعة.';
        statusEl.className = 'face-status success';
        
        // إظهار الإرشادات
        guidelines.style.display = 'block';
        
        // تحديث الإرشادات بناءً على النتائج الفعلية
        updateGuidelines(result);
        
        // تفعيل مربع الموافقة
        consentCheck.disabled = false;
        if (consentError) consentError.classList.remove('show');
        
        // إخفاء أزرار الإجراءات (لأن الصورة أصبحت جيدة)
        document.getElementById('uploadFaceBtn').style.display = 'none';
        document.getElementById('cameraFaceBtn').style.display = 'none';
        // إظهار زر الإلغاء فقط
        document.getElementById('cancelFaceBtn').style.display = 'inline-flex';
        
        console.log('✅ تم تحليل صورة الوجه بنجاح');

    } catch (err) {
        console.error('❌ فشل تحليل الوجه:', err);
        statusEl.textContent = '⚠️ حدث خطأ أثناء التحليل. يرجى المحاولة مرة أخرى. (يمكنك اختيار صورة أخرى)';
        statusEl.className = 'face-status error';
        document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
        document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
        document.getElementById('faceImageInput').value = '';
    }
}

/**
 * تحديث الإرشادات بناءً على نتائج التحليل
 */
function updateGuidelines(result) {
    const items = document.querySelectorAll('.guideline-item');
    if (items.length < 4) return;

    const isFrontal = Math.abs(result.rollAngle || 0) < 25 &&
                      Math.abs(result.panAngle || 0) < 25 &&
                      Math.abs(result.tiltAngle || 0) < 25;
    items[0].style.color = isFrontal ? 'var(--secondary-color)' : 'var(--danger-color)';
    items[0].querySelector('i').style.color = isFrontal ? 'var(--secondary-color)' : 'var(--danger-color)';

    const isWellLit = result.underExposedLikelihood !== 'VERY_LIKELY' &&
                      result.underExposedLikelihood !== 'LIKELY';
    items[1].style.color = isWellLit ? 'var(--secondary-color)' : 'var(--danger-color)';
    items[1].querySelector('i').style.color = isWellLit ? 'var(--secondary-color)' : 'var(--danger-color)';

    const hasHeadwear = result.headwearLikelihood === 'VERY_LIKELY' ||
                        result.headwearLikelihood === 'LIKELY';
    items[2].style.color = !hasHeadwear ? 'var(--secondary-color)' : 'var(--danger-color)';
    items[2].querySelector('i').style.color = !hasHeadwear ? 'var(--secondary-color)' : 'var(--danger-color)';

    const bbox = result.faceBoundingBox || { width: 0, height: 0 };
    const faceRatio = (bbox.width * bbox.height) / (800 * 600);
    const isLargeEnough = faceRatio > 0.06;
    items[3].style.color = isLargeEnough ? 'var(--secondary-color)' : 'var(--danger-color)';
    items[3].querySelector('i').style.color = isLargeEnough ? 'var(--secondary-color)' : 'var(--danger-color)';
}

// ============================================================
//  ربط أحداث صورة الوجه (الجديدة)
// ============================================================

// زر رفع صورة من الجهاز
document.getElementById('uploadFaceBtn')?.addEventListener('click', function() {
    // لا نقوم بإعادة تعيين الصورة، بل نفتح الملف مباشرة
    // سيتم استبدال الصورة الحالية بأخرى جديدة
    document.getElementById('faceImageInput').click();
});

// زر فتح الكاميرا
document.getElementById('cameraFaceBtn')?.addEventListener('click', startFaceCamera);

// زر التقاط الصورة
document.getElementById('capturePhotoBtn')?.addEventListener('click', captureFacePhoto);

// زر إغلاق الكاميرا
document.getElementById('closeCameraBtn')?.addEventListener('click', function() {
    stopFaceCamera();
});

// زر إلغاء الصورة (حذف يدوي)
document.getElementById('cancelFaceBtn')?.addEventListener('click', function() {
    resetFaceState();
});

// ===== معالجة رفع الملف (مع إعادة التعيين للسماح باختيار نفس الملف) =====
document.getElementById('faceImageInput')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    // التحقق من نوع الملف
    if (!file.type.startsWith('image/')) {
        alert('⚠️ يرجى اختيار ملف صورة صالح (JPG أو PNG)');
        this.value = '';
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        alert('⚠️ حجم الصورة كبير جداً (الحد الأقصى 5 ميجابايت)');
        this.value = '';
        return;
    }

    // قراءة الملف
    const reader = new FileReader();
    reader.onload = async function(ev) {
        const base64 = ev.target.result;
        faceImageBase64 = base64;
        window.faceImageBase64 = base64;
        
        // عرض المعاينة (استبدال الصورة السابقة)
        const preview = document.getElementById('facePreview');
        if (preview) {
            preview.innerHTML = `<img src="${base64}" alt="صورة الوجه" style="width:100%; height:100%; object-fit:cover;">`;
            preview.style.display = 'flex';
        }
        const cancelBtn = document.getElementById('cancelFaceBtn');
        if (cancelBtn) cancelBtn.style.display = 'inline-flex';
        
        // إخفاء أزرار الإجراءات مؤقتاً أثناء التحليل
        document.getElementById('uploadFaceBtn').style.display = 'none';
        document.getElementById('cameraFaceBtn').style.display = 'none';
        
        // تحليل الصورة
        await analyzeFaceImage(base64);
        
        // إعادة تعيين حقل الملف للسماح باختيار نفس الملف مرة أخرى
        document.getElementById('faceImageInput').value = '';
    };
    reader.readAsDataURL(file);
});

// ===== إضافة دالة getFaceImageBase64 للتوافق مع الكود القديم =====
window.getFaceImageBase64 = function() {
    return faceImageBase64;
};

// ===== دالة validateFaceConsent (تُستدعى من reg.js قبل الإرسال) =====
window.validateFaceConsent = function() {
    // إذا لم تكن هناك صورة، لا نحتاج للموافقة
    if (!faceImageBase64) {
        return true;
    }
    const consentCheck = document.getElementById('faceConsentCheck');
    if (!consentCheck.checked) {
        const errorEl = document.getElementById('faceConsentError');
        if (errorEl) errorEl.classList.add('show');
        return false;
    }
    const errorEl = document.getElementById('faceConsentError');
    if (errorEl) errorEl.classList.remove('show');
    return true;
};

// ============================================================
//  💳 Payment Redirect Overlay
// ============================================================
function showPaymentRedirectOverlay(planName) {
    // احذف أي overlay قديم
    const old = document.getElementById('paymentRedirectOverlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'paymentRedirectOverlay';
    overlay.className = 'payment-redirect-overlay';
    overlay.innerHTML =
        '<div class="payment-redirect-box">' +
            '<div class="payment-redirect-spinner"></div>' +
            '<h3>جاري تحويلك لصفحة الدفع</h3>' +
            '<p>الباقة: <strong>' + planName + '</strong></p>' +
            '<p class="payment-redirect-note">سيتم فتح صفحة Paymob خلال لحظات...</p>' +
            '<p class="payment-redirect-warn">⚠️ لا تغلق الصفحة</p>' +
        '</div>';

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // ✅ animation
    setTimeout(function() { overlay.classList.add('show'); }, 10);
}

function hidePaymentRedirectOverlay() {
    const overlay = document.getElementById('paymentRedirectOverlay');
    if (!overlay) return;
    overlay.classList.remove('show');
    document.body.style.overflow = '';
    setTimeout(function() { overlay.remove(); }, 300);
}

// ============================================================
//  إرسال النموذج (مع ضغط الصور وإرسال مباشر)
// ============================================================
async function submitData(e) {
    console.log('🔄 submitData تم استدعاؤها (إصدار نهائي)');
    e.preventDefault();

    const submitBtn = document.getElementById('submitBtn');
    const loading = document.getElementById('loading');
    const resultBox = document.getElementById('resultBox');

    try {

        if (window.validateFaceConsent && !window.validateFaceConsent()) {
        alert('⚠️ يجب الموافقة على استخدام بيانات الوجه');
        return;
        }

        if (!validateForm()) {
            alert('❌ يرجى استكمال جميع البيانات المطلوبة بشكل صحيح');
            return;
        }
        if (isSubmitting) return;
        
        const planValue = document.getElementById('planSelect').value;
        const isPaidPlan = (planValue === '6months' || planValue === '1year');
        resultBox.classList.remove('show', 'error');

        isSubmitting = true;
        submitBtn.disabled = true;
        loading.classList.add('show');

        let planName = '', planPrice = 0;
        if (planValue === 'launch') { planName = 'عرض بداية الإطلاق'; planPrice = 0; }
        else if (planValue === '6months') { planName = '6 أشهر'; planPrice = 250; }
        else if (planValue === '1year') { planName = 'عام واحد'; planPrice = 500; }

        const fatherPhoneObj = Utils.normalizeEgyptPhone(document.getElementById('fatherPhone').value);
        const motherPhoneObj = Utils.normalizeEgyptPhone(document.getElementById('motherPhone').value);
        
        let imageBase64 = '';
        const imageFile = document.getElementById('childImage').files[0];
        if (imageFile) {
            // الحد الأقصى: 5 ميجا
            if (imageFile.size > 5 * 1024 * 1024) {
                throw new Error('حجم الصورة كبير جداً (الحد الأقصى 5 ميجابايت)');
            }

            // الضغط الذكي: ضغط لو الصورة أكبر من 3 ميجا
            const COMPRESS_THRESHOLD = 3 * 1024 * 1024; // 3MB

            if (imageFile.size > COMPRESS_THRESHOLD) {
                console.log(`📸 ضغط الصورة الشخصية: ${(imageFile.size / 1024 / 1024).toFixed(2)}MB`);
                const compressedBlob = await Utils.compressImage(imageFile, 1920, 1920, 0.88);
                imageBase64 = await Utils.fileToBase64(compressedBlob);
                console.log(`✅ تم الضغط → ${(compressedBlob.size / 1024).toFixed(1)} KB`);
            } else {
                console.log(`📸 الصورة الشخصية صغيرة (${(imageFile.size / 1024 / 1024).toFixed(2)}MB) — بدون ضغط`);
                imageBase64 = await Utils.fileToBase64(imageFile);
            }
        }
        
                // ✅ قراءة طريقة الإشعارات
        const notificationMethodChecked = document.querySelector('input[name="notificationMethod"]:checked');
        const notificationMethod = notificationMethodChecked ? notificationMethodChecked.value : 'email';
        const marketerId = document.getElementById('marketerIdInput').value.trim().toUpperCase();

        // ✅ قراءة صورة الوجه (من المتغير العام)
        const faceImg = window.getFaceImageBase64 ? window.getFaceImageBase64() : '';

        const params = new URLSearchParams();
        params.append('action', 'register');
        params.append('childName', Utils.processAbdName(document.getElementById('childName').value).join(' '));
        params.append('birthDate', document.getElementById('birthDate').value);
        params.append('googleMapsAddress', document.getElementById('googleMapsAddress').value);
        params.append('detailedAddress', document.getElementById('detailedAddress').value);
        params.append('fatherPhone', fatherPhoneObj ? fatherPhoneObj.international : '');
        params.append('motherName', document.getElementById('motherName').value);
        params.append('motherPhone', motherPhoneObj ? motherPhoneObj.international : '');
        params.append('notes', JSON.stringify(notesArray));
        params.append('emailCode', document.getElementById('emailCode').value);
        params.append('familyPassword', document.getElementById('childPassword').value);
        params.append('plan', planName);
        params.append('planPrice', planPrice.toString());
        params.append('imageBase64', imageBase64);
        params.append('marketerId', marketerId || '');
        params.append('notificationMethod', notificationMethod);
        if (faceImg) {
            params.append('faceImageBase64', faceImg);
        }

        console.log('📤 إرسال البيانات إلى Vercel');
        const payload = {};
        params.forEach((value, key) => { payload[key] = value; });

        // ✅ حد زمني لطلب التسجيل (90 ثانية)
        const REGISTRATION_TIMEOUT_MS = 90 * 1000;
        const abortController = new AbortController();
        const timeoutId = setTimeout(function() {
            console.warn('⏰ [submitData] انتهت المهلة — إلغاء الطلب');
            abortController.abort();
        }, REGISTRATION_TIMEOUT_MS);

        let res;
        try {
            res = await fetch('/api?action=register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: abortController.signal
            });
        } finally {
            clearTimeout(timeoutId);
        }

        let result;
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            result = await res.json();
        } else {
            const text = await res.text();
            console.warn('⚠️ استجابة غير JSON:', text);
            throw new Error('حدث خطأ في الخادم. يرجى المحاولة مرة أخرى.');
        }

        console.log('📩 استجابة Vercel:', result);
        loading.classList.remove('show');

        if (result.success) {
            if (result.remainingOffers !== undefined) {
                const remaining = result.remainingOffers;
                document.getElementById('remainingCount').textContent = remaining;
                console.log('🔄 تم تحديث العروض المتبقية من الخادم:', remaining);
                
                const launchOption = document.querySelector('#planSelect option[value="launch"]');
                if (launchOption) {
                    if (remaining <= 0) {
                        launchOption.style.display = 'none';
                        if (document.getElementById('planSelect').value === 'launch') {
                            document.getElementById('planSelect').value = '';
                        }
                    } else {
                        launchOption.style.display = '';
                    }
                }
            }

            // 🆕 الخطة المجانية → successModal عادي
            if (planName === 'عرض بداية الإطلاق') {
                let modalMessage = 'سيتم تفعيل حسابك وإرسال رمز المتابعة خلال 24 ساعة.';
                showSuccessModal(
                    result.childID,
                    result.plan,
                    result.childLink,
                    modalMessage,
                    notificationMethod,
                    document.getElementById('emailCode').value.trim()
                );
                isSubmitting = false;
                submitBtn.disabled = false;
                return;
            }

            // 🆕 الخطة المدفوعة → تحويل مباشر لـ Paymob
            console.log('💳 [reg] Redirecting to Paymob for:', planName, '| childID:', result.childID);
            
            // إظهار overlay التحويل
            showPaymentRedirectOverlay(planName);
            
            try {
                const intentionRes = await fetch('/api?action=createPaymobIntention', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        childID: result.childID,
                        plan: planName
                    })
                });
                const intention = await intentionRes.json();

                console.log('📩 createPaymobIntention:', intention);

                if (intention.success && intention.checkoutUrl) {
                    // ✅ تحويل فوري لـ Paymob Checkout
                    window.location.href = intention.checkoutUrl;
                    return;
                }

                // فشل → نرجع الـ successModal كخيار احتياطي
                hidePaymentRedirectOverlay();
                isSubmitting = false;
                submitBtn.disabled = false;

                let modalMessage = 'تم حفظ بيانات طفلك بنجاح. لكن تعذر فتح صفحة الدفع تلقائياً.\n\n' +
                                   'يمكنك إتمام الدفع لاحقاً من لوحة الأسرة.';
                showSuccessModal(
                    result.childID,
                    result.plan,
                    result.childLink,
                    modalMessage,
                    notificationMethod,
                    document.getElementById('emailCode').value.trim()
                );

                // تنبيه واضح
                setTimeout(function() {
                    alert('⚠️ تم حفظ بيانات الطفل بنجاح، لكن تعذر فتح صفحة الدفع.\n\n' +
                          'يمكنك إتمام الدفع من لوحة الأسرة عبر زر "شراء اشتراك".');
                }, 300);

            } catch (e) {
                console.error('❌ [reg] Payment redirect failed:', e);
                hidePaymentRedirectOverlay();
                isSubmitting = false;
                submitBtn.disabled = false;

                let modalMessage = 'تم حفظ بيانات طفلك بنجاح. لكن تعذر الاتصال بخدمة الدفع.';
                showSuccessModal(
                    result.childID,
                    result.plan,
                    result.childLink,
                    modalMessage,
                    notificationMethod,
                    document.getElementById('emailCode').value.trim()
                );

                setTimeout(function() {
                    alert('⚠️ تعذر الاتصال بخدمة الدفع. يمكنك المحاولة من لوحة الأسرة.');
                }, 300);
            }
            return;
        } else {
            let errorMsg = result.error || result.message || 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.';

            if (errorMsg.includes('مسجل بالفعل') || errorMsg.includes('تم تسجيل هذا الطفل مسبقاً')) {
                errorMsg = '⚠️ هذا الطفل مسجل بالفعل في النظام.<br><br>لا يمكن تسجيل نفس الطفل أكثر من مرة. إذا كنت بحاجة إلى تحديث البيانات، يرجى استخدام <a href="/dashboard" target="_blank" style="color:#22559f; font-weight:bold; text-decoration:underline;">لوحة تحكم الأسرة</a> أو التواصل مع الدعم عبر واتساب.';
            }

            resultBox.className = 'result-box error show';
            document.getElementById('resultTitle').textContent = '❌ فشل التسجيل';
            document.getElementById('resultMessage').innerHTML = errorMsg;

            isSubmitting = false;
            submitBtn.disabled = false;
        }

    } catch (err) {
        console.error('❌ خطأ في submitData:', err);

        // ✅ معالجة خاصة لانتهاء المهلة الزمنية
        let safeMessage;
        if (err && err.name === 'AbortError') {
            safeMessage =
                '⏰ <strong>انتهت المهلة الزمنية للطلب</strong><br>' +
                '<span style="font-size:0.9rem; display:block; margin-top:8px;">' +
                'استغرق الطلب وقتًا أطول من المتوقع. يرجى التحقق من اتصالك بالإنترنت، ' +
                'ثم المحاولة مرة أخرى.' +
                '</span>';
        } else {
            safeMessage = Utils.getSafeErrorMessage(err);
        }

        loading.classList.remove('show');
        resultBox.className = 'result-box error show';
        document.getElementById('resultTitle').textContent = '❌ فشل التسجيل';
        document.getElementById('resultMessage').innerHTML = safeMessage;

        isSubmitting = false;
        submitBtn.disabled = false;
    }
}

// ============================================================
//  بدء التشغيل
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    console.log('📌 DOMContentLoaded في reg.js (إصدار نهائي)');
    const resultBox = document.getElementById('resultBox');
    if (resultBox) resultBox.classList.remove('show');
    
    loadConfig();
    bindFormValidation();
    
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) {
        submitBtn.addEventListener('click', submitData);
        console.log('✅ submitBtn مرتبط');
    } else {
        console.error('❌ submitBtn غير موجود');
    }
    
    const copyBtn = document.getElementById('copyWalletBtn');
    if (copyBtn) copyBtn.addEventListener('click', copyWalletNumber);

    const motherNameField = document.getElementById('motherName');
    if (motherNameField) {
        motherNameField.addEventListener('input', function (e) {
            e.target.value = e.target.value.replace(/[^\u0600-\u06FFa-zA-Z\s]/g, '');
        });
    }
    
    const childNameField = document.getElementById('childName');
    if (childNameField) {
        childNameField.addEventListener('input', Utils.autoMergeAbd);
    }

    const marketerField = document.getElementById('marketerIdInput');
    if (marketerField) {
        marketerField.addEventListener('input', Utils.restrictMarketerId);
    }
    
    // إعادة تعيين حالة الوجه عند تحميل الصفحة (للتأكد من البداية النظيفة)
    resetFaceState();

    // 🚫 منع الحروف العربية في حقل كلمة السر
    guardPasswordFieldAgainstArabic('childPassword');

    // 📱 حقول الهواتف — أرقام فقط + LTR
    guardPhoneFieldDigitsOnly('fatherPhone');
    guardPhoneFieldDigitsOnly('motherPhone');

    // ✅ معالجة رابط المسوق (ref=MA0001)
    applyRefCode();

    // ============================================================
    //  🪗 Accordion Logic (فتح كارت واحد وإغلاق الباقي)
    // ============================================================
    const cards = document.querySelectorAll('.neo-card');
    
    // فتح أول كارت افتراضياً
    if (cards.length > 0) {
        cards[0].classList.add('active');
    }

    // إضافة حدث الضغط على الهيدر
    document.querySelectorAll('.neo-card-header').forEach(header => {
        header.addEventListener('click', function() {
            const card = this.closest('.neo-card');
            
            // لو الكارت مفتوح أصلاً، مفيش داعي نعمله حاجة
            if (card.classList.contains('active')) return;

            // نقفل كل الكروت (هتتقفل بنعومة بسبب الـ CSS)
            cards.forEach(c => c.classList.remove('active'));
            
            // نفتح الكارت اللي اتضغط عليه (هيفتح بنعومة)
            card.classList.add('active');
        });
    });
});
