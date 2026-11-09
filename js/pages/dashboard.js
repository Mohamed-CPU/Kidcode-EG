// ================================================================
//  dashboard.js - لوحة تحكم الأسرة (إصدار نهائي - مُبسط)
//  استخدام Utils مباشرة مع رسائل خطأ صحيحة
//  ✅ تم إضافة دعم التحقق الرقمي بالوجه (إضافة + حذف)
//  ✅ تنسيق التاريخ والوقت بشكل مفهوم
//  ✅ إضافة تاريخ التعديل
// ================================================================

const APP_URL = CONFIG.API_URL;

let currentChildID = '';
let originalData = {};
let notesArray = [];

// ============================================================
//  متغيرات تليجرام
// ============================================================
let telegramStatus = {
    isLinked: false,
    chatId: null,
    linkedAt: null,
    notificationMethod: 'email'
};
let telegramPollingInterval = null;
let telegramCountdownInterval = null;
let telegramLinkExpiry = null;

// ============================================================
//  التحقق من وجود Utils واستخدامه مباشرة
// ============================================================
const Utils = window.Utils || {};

if (!window.Utils) {
    console.error('❌ utils.js لم يتم تحميله!');
    window.Utils = {
        normalizeEgyptPhone: function(raw) { return null; },
        internationalToLocal: function(phone) { return ''; },
        validateFullName: function(name) { return false; },
        normalizeAbdName: function(name) { return ''; },
        preventNonArabic: function(e) {},
        preventSpaceAfterAbd: function(e) {},
        fileToBase64: function(file) { return Promise.resolve(''); },
        validateGoogleMaps: function(url) { return true; },
        showFieldError: function(id, msg) {
            const el = document.getElementById(id + 'Error');
            if (el) { el.textContent = msg; el.classList.add('show'); }
        },
        hideFieldError: function(id) {
            const el = document.getElementById(id + 'Error');
            if (el) { el.textContent = ''; el.classList.remove('show'); }
        },
        restrictMarketerInput: function(e) {},
        calculateAgeFromBirthDate: function(date) { return 'غير محدد'; },
        formatDuration: function(days) { return 'غير متاح'; }
    };
    Utils = window.Utils;
}

// ============================================================
//  📅 formatDate
// ============================================================
function formatDate(dateString) {
    if (!dateString) return 'غير معروف';
    try {
        // ✅ نستخدم Utils.getCairoTimeParts — تحويل من UTC لتوقيت القاهرة
        const parts = Utils.getCairoTimeParts(dateString);
        if (!parts) return String(dateString);

        const monthNames = [
            'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
            'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
        ];

        const d = parseInt(parts.day, 10);
        const m = parseInt(parts.month, 10) - 1;
        const y = parts.year;

        // الوقت بصيغة 12 ساعة مع ص/م
        let hour = parseInt(parts.hour, 10);
        let ampm = 'ص';
        if (hour >= 12) {
            ampm = 'م';
            if (hour > 12) hour -= 12;
        }
        if (hour === 0) hour = 12;
        const hourStr = String(hour).padStart(2, '0');
        const minuteStr = parts.minute;

        return `${d} ${monthNames[m]} ${y}، ${hourStr}:${minuteStr} ${ampm}`;
    } catch (e) {
        console.warn('⚠️ فشل تنسيق التاريخ:', e);
        return String(dateString);
    }
}

// ============================================================
//  دوال الواجهة الأساسية
// ============================================================
function validateForm() {
    let valid = true;
    let childName = document.getElementById('childName').value.trim();
    childName = Utils.normalizeAbdName(childName);
    if (!Utils.validateFullName(childName)) {
        Utils.showFieldError('childName', 'يجب أن يكون الاسم رباعياً');
        valid = false;
    } else {
        Utils.hideFieldError('childName');
    }

    if (!document.getElementById('birthDate').value) {
        Utils.showFieldError('birthDate', 'يرجى اختيار تاريخ الميلاد');
        valid = false;
    } else {
        Utils.hideFieldError('birthDate');
    }

    const maps = document.getElementById('googleMapsAddress').value.trim();
    if (!Utils.validateGoogleMaps(maps)) {
        Utils.showFieldError('googleMaps', 'رابط غير صحيح (يجب أن يبدأ بـ https://maps.app.goo.gl/)');
        valid = false;
    } else {
        Utils.hideFieldError('googleMaps');
    }

    if (!document.getElementById('detailedAddress').value.trim()) {
        Utils.showFieldError('detailed', 'العنوان مطلوب');
        valid = false;
    } else {
        Utils.hideFieldError('detailed');
    }

    const father = document.getElementById('fatherPhone').value.trim();
    if (father && !Utils.normalizeEgyptPhone(father)) {
        Utils.showFieldError('fatherPhone', 'رقم غير صحيح');
        valid = false;
    } else {
        Utils.hideFieldError('fatherPhone');
    }

    const mother = document.getElementById('motherPhone').value.trim();
    if (mother && !Utils.normalizeEgyptPhone(mother)) {
        Utils.showFieldError('motherPhone', 'رقم غير صحيح');
        valid = false;
    } else {
        Utils.hideFieldError('motherPhone');
    }

    return valid;
}

function attachLiveValidation() {
    const childName = document.getElementById('childName');
    const birthDate = document.getElementById('birthDate');
    const maps = document.getElementById('googleMapsAddress');
    const detailed = document.getElementById('detailedAddress');
    const father = document.getElementById('fatherPhone');
    const mother = document.getElementById('motherPhone');

    const validateName = () => {
        let val = childName.value.trim();
        val = Utils.normalizeAbdName(val);
        if (!Utils.validateFullName(val) && val !== '') {
            Utils.showFieldError('childName', 'يجب أن يكون الاسم رباعياً');
        } else {
            Utils.hideFieldError('childName');
        }
    };
    const validateBirth = () => {
        if (!birthDate.value) {
            Utils.showFieldError('birthDate', 'يرجى اختيار تاريخ الميلاد');
        } else {
            Utils.hideFieldError('birthDate');
        }
    };
    const validateMaps = () => {
        const val = maps.value.trim();
        if (val !== '' && !Utils.validateGoogleMaps(val)) {
            Utils.showFieldError('googleMaps', 'رابط غير صحيح (يجب أن يبدأ بـ https://maps.app.goo.gl/)');
        } else {
            Utils.hideFieldError('googleMaps');
        }
    };
    const validateDetailed = () => {
        if (!detailed.value.trim()) {
            Utils.showFieldError('detailed', 'العنوان مطلوب');
        } else {
            Utils.hideFieldError('detailed');
        }
    };
    const validateFather = () => {
        const val = father.value.trim();
        if (val && !Utils.normalizeEgyptPhone(val)) {
            Utils.showFieldError('fatherPhone', 'رقم غير صحيح');
        } else {
            Utils.hideFieldError('fatherPhone');
        }
    };
    const validateMother = () => {
        const val = mother.value.trim();
        if (val && !Utils.normalizeEgyptPhone(val)) {
            Utils.showFieldError('motherPhone', 'رقم غير صحيح');
        } else {
            Utils.hideFieldError('motherPhone');
        }
    };

    childName.addEventListener('input', validateName);
    childName.addEventListener('input', Utils.preventNonArabic);
    childName.addEventListener('blur', function() {
        let val = this.value;
        val = val.replace(/عبد\s+/g, 'عبد');
        val = val.trim().replace(/\s+/g, ' ');
        this.value = val;
        validateName();
    });
    childName.addEventListener('input', Utils.preventSpaceAfterAbd);
    birthDate.addEventListener('change', validateBirth);
    maps.addEventListener('input', validateMaps);
    detailed.addEventListener('input', validateDetailed);
    father.addEventListener('input', validateFather);
    mother.addEventListener('input', validateMother);

    validateName(); validateBirth(); validateMaps(); validateDetailed(); validateFather(); validateMother();
    console.log('✅ التحقق اللحظي مفعل');
}

function protectChildNameField() {
    const nameField = document.getElementById('childName');
    if (!nameField) return;
    let originalValue = nameField.value;
    setInterval(function() {
        if (nameField.value !== originalValue) {
            nameField.value = originalValue;
        }
    }, 200);
}

function renderNotes() {
    const list = document.getElementById('notesList');
    list.innerHTML = '';
    notesArray.forEach((note, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>📌 ${note}</span><button class="delete-note" data-index="${idx}">🗑️</button>`;
        list.appendChild(li);
    });
    document.querySelectorAll('.delete-note').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(btn.dataset.index);
            notesArray.splice(idx, 1);
            renderNotes();
        });
    });
}

function getFullID() {
    let numbers = document.getElementById('loginChildNumber').value.trim();
    if (numbers === '') return '';
    return 'KC-' + numbers;
}

function switchToLogin() {
    document.getElementById('dashboardCard').style.display = 'none';
    document.getElementById('loginCard').style.display = 'block';
    currentChildID = '';
    originalData = {};
    notesArray = [];
    document.getElementById('loginChildNumber').value = '';
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginError').classList.remove('show');
}

// ============================================================
//  جلب وعرض تقرير المسحات
// ============================================================
async function loadScanReport() {
    if (!currentChildID) return;
    
    const container = document.getElementById('scanReportContainer');
    const loading = document.getElementById('scanReportLoading');
    
    if (!container || !loading) return;
    
    try {
        loading.classList.add('show');
        container.style.display = 'none';
        
        const res = await fetch(`${APP_URL}?action=getScanReport&childID=${encodeURIComponent(currentChildID)}`);
        const result = await res.json();
        
        loading.classList.remove('show');
        
        if (result.success) {
            const data = result.data;
            
            document.getElementById('scanCountDisplay').textContent = data.scanCount || '0';
            document.getElementById('lastScanDisplay').textContent = data.lastScan || 'لا يوجد';
            
            const daysRemaining = data.daysRemaining;
            let daysText = '--';
            let daysColor = 'var(--text-secondary)';
            
            if (daysRemaining !== null) {
                if (daysRemaining <= 0) {
                    daysText = '⛔ منتهي';
                    daysColor = 'var(--danger-color)';
                } else {
                    daysText = Utils.formatDuration(daysRemaining);
                    daysColor = 'var(--secondary-color)';
                }
            }
            
            document.getElementById('daysRemainingDisplay').textContent = daysText;
            document.getElementById('daysRemainingDisplay').style.color = daysColor;
            
            const status = data.status || 'غير معروف';
            const statusMap = {
                'active': '✅ نشط',
                'pending': '⏳ قيد المراجعة',
                'expired': '⛔ منتهي',
                'inactive': '⛔ غير نشط'
            };
            document.getElementById('expiryStatusDisplay').textContent = statusMap[status] || status;
            
            const logsBody = document.getElementById('scanLogsBody');
            if (data.scanLogs && data.scanLogs.length > 0) {
                let html = '';
                data.scanLogs.forEach(log => {
                    const locationLink = (log.lat && log.lng && log.lat !== 'REFUSED' && log.lng !== 'REFUSED') 
                        ? `<a href="https://maps.google.com/?q=${log.lat},${log.lng}" target="_blank" style="color:var(--primary-color);">📍 عرض</a>`
                        : '❌ غير متاح';
                    html += `
                        <tr style="border-bottom:1px solid var(--border-color);">
                            <td style="padding:8px 12px; font-size:0.85rem;">${log.timestamp || '--'}</td>
                            <td style="padding:8px 12px; font-size:0.85rem;">${log.source || 'غير معروف'}</td>
                            <td style="padding:8px 12px; font-size:0.85rem;">${locationLink}</td>
                        </tr>
                    `;
                });
                logsBody.innerHTML = html;
            } else {
                logsBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--text-light);">لا توجد عمليات مسح حتى الآن</td></tr>';
            }
            
            container.style.display = 'block';
            
        } else {
            container.innerHTML = `<p style="color:var(--danger-color);">❌ ${result.error || 'فشل تحميل التقرير'}</p>`;
        }
        
    } catch (err) {
        loading.classList.remove('show');
        console.error('❌ خطأ في loadScanReport:', err);
        container.innerHTML = `<p style="color:var(--danger-color);">❌ خطأ في الاتصال: ${err.message}</p>`;
    }
}

// ============================================================
//  دوال الإبلاغ عن الاختفاء
// ============================================================
function openMissingReportModal() {
    const childName = document.getElementById('childName').value || 'غير معروف';
    const birthDate = document.getElementById('birthDate').value;
    const age = birthDate ? Utils.calculateAgeFromBirthDate(birthDate) : 'غير محدد';
    const notes = notesArray.length > 0 ? notesArray.join('، ') : 'لا توجد ملاحظات مسجلة';

    document.getElementById('modalChildName').textContent = childName;
    document.getElementById('modalChildAge').textContent = age;
    document.getElementById('modalChildNotes').textContent = notes;

    document.getElementById('missingClothes').value = '';
    document.getElementById('missingGovernorate').value = '';
    document.getElementById('missingDistrict').value = '';
    document.getElementById('missingLandmark').value = '';
    document.getElementById('missingReportMessage').className = 'message';
    document.getElementById('missingReportMessage').textContent = '';

    document.getElementById('missingReportModal').classList.add('show');
    document.getElementById('missingReportModal').style.display = 'flex';
}

function closeMissingReportModal() {
    document.getElementById('missingReportModal').classList.remove('show');
    document.getElementById('missingReportModal').style.display = 'none';
}

async function submitMissingReport() {
    const messageDiv = document.getElementById('missingReportMessage');
    const submitBtn = document.getElementById('submitMissingReportBtn');

    const clothes = document.getElementById('missingClothes').value.trim();
    const governorate = document.getElementById('missingGovernorate').value;
    const district = document.getElementById('missingDistrict').value.trim();
    const landmark = document.getElementById('missingLandmark').value.trim();

    if (!clothes) {
        messageDiv.className = 'message error';
        messageDiv.textContent = '⚠️ يرجى إدخال الملابس التي كان يرتديها.';
        document.getElementById('missingClothes').focus();
        return;
    }
    if (!governorate) {
        messageDiv.className = 'message error';
        messageDiv.textContent = '⚠️ يرجى اختيار المحافظة.';
        document.getElementById('missingGovernorate').focus();
        return;
    }
    if (!district) {
        messageDiv.className = 'message error';
        messageDiv.textContent = '⚠️ يرجى إدخال الحي أو المنطقة.';
        document.getElementById('missingDistrict').focus();
        return;
    }
    if (!landmark) {
        messageDiv.className = 'message error';
        messageDiv.textContent = '⚠️ يرجى إدخال أقرب علامة مميزة.';
        document.getElementById('missingLandmark').focus();
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';
    messageDiv.className = 'message';
    messageDiv.textContent = '';

    try {
        const payload = new URLSearchParams();
        payload.append('action', 'reportMissing');
        payload.append('childID', currentChildID);
        payload.append('clothes', clothes);
        payload.append('governorate', governorate);
        payload.append('district', district);
        payload.append('landmark', landmark);

        const response = await fetch(APP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: payload.toString()
        });

        const result = await response.json();

        if (result.success) {
            messageDiv.className = 'message success';
            messageDiv.innerHTML = '✅ ' + (result.message || 'تم إرسال البلاغ بنجاح! سيتم إشعار المتطوعين فوراً.');
            setTimeout(() => {
                closeMissingReportModal();
            }, 3000);
        } else {
            messageDiv.className = 'message error';
            messageDiv.textContent = '❌ ' + (result.error || 'حدث خطأ أثناء إرسال البلاغ. يرجى المحاولة مرة أخرى.');
        }

    } catch (err) {
        console.error('❌ خطأ في submitMissingReport:', err);
        messageDiv.className = 'message error';
        messageDiv.textContent = '⚠️ حدث خطأ في الاتصال. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.';
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> إرسال البلاغ';
    }
}

// ============================================================
//  دوال البيانات الإقليدية (التحقق الرقمي بالوجه) - نسخة مبسطة
// ============================================================

let faceImageBase64 = null;
let faceStream = null;
let isSavingFace = false;

/**
 * تحميل حالة بيانات الوجه من الخادم
 * مع تنسيق التاريخ والوقت بشكل مفهوم
 */
async function loadFaceDataStatus() {
    if (!currentChildID) {
        console.warn('⚠️ loadFaceDataStatus: currentChildID فارغ');
        return;
    }

    const statusText = document.getElementById('faceDataStatusText');
    const statusDetail = document.getElementById('faceDataStatusDetail');
    const badge = document.getElementById('faceStatusBadge');
    const deleteBtn = document.getElementById('deleteFaceBtn');
    const deleteMsg = document.getElementById('faceDeleteMessage');

    console.log(`🔍 جلب حالة الوجه للطفل: ${currentChildID}`);

    try {
        const res = await fetch(`${CONFIG.API_URL}?action=getFaceStatus&childID=${encodeURIComponent(currentChildID)}`);
        const data = await res.json();
        console.log('📩 استجابة getFaceStatus:', data);

        if (data.success) {
            if (data.hasFaceData) {
                // ✅ تنسيق التواريخ
                const createdAt = formatDate(data.createdAt);
                const updatedAt = data.updatedAt ? formatDate(data.updatedAt) : 'لم يُحدث بعد';
                
                statusText.innerHTML = '<i class="fas fa-check-circle" style="color: var(--secondary-color);"></i> ✅ بيانات الوجه مسجلة';
                statusText.style.color = 'var(--secondary-color)';
                statusDetail.innerHTML = `
                    <strong>📅 تاريخ التسجيل:</strong> ${createdAt}<br>
                    <strong>🔄 آخر تعديل:</strong> ${updatedAt}
                `;
                badge.innerHTML = '<i class="fas fa-check-circle" style="color: var(--secondary-color);"></i> مسجل';
                badge.style.background = '#e8f5ee';
                badge.style.color = 'var(--secondary-dark)';
                
                // إظهار زر الحذف
                if (deleteBtn) {
                    deleteBtn.style.display = 'flex';
                    deleteBtn.disabled = false;
                }
                if (deleteMsg) {
                    deleteMsg.style.display = 'none';
                    deleteMsg.textContent = '';
                }
            } else {
                statusText.innerHTML = '<i class="fas fa-exclamation-circle" style="color: var(--warning-color);"></i> ⚠️ لا توجد بيانات وجه مسجلة';
                statusText.style.color = 'var(--warning-color)';
                statusDetail.textContent = 'يمكنك إضافة صورة وجه الآن لتمكين التحقق الرقمي';
                badge.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: var(--warning-color);"></i> غير مسجل';
                badge.style.background = '#fef3c7';
                badge.style.color = '#92400e';
                
                if (deleteBtn) {
                    deleteBtn.style.display = 'none';
                    deleteBtn.disabled = true;
                }
                if (deleteMsg) {
                    deleteMsg.style.display = 'none';
                    deleteMsg.textContent = '';
                }
            }
        } else {
            console.warn('⚠️ فشل تحميل حالة الوجه:', data.error);
            statusText.textContent = '⚠️ ' + (data.error || 'فشل تحميل الحالة');
            statusText.style.color = 'var(--danger-color)';
            statusDetail.textContent = '';
            badge.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: var(--danger-color);"></i> خطأ';
            badge.style.background = '#fee2e2';
            badge.style.color = 'var(--danger-color)';
            if (deleteBtn) {
                deleteBtn.style.display = 'none';
                deleteBtn.disabled = true;
            }
            if (deleteMsg) {
                deleteMsg.style.display = 'none';
                deleteMsg.textContent = '';
            }
        }
    } catch (err) {
        console.error('❌ فشل تحميل حالة الوجه:', err);
        statusText.textContent = '⚠️ خطأ في الاتصال';
        statusText.style.color = 'var(--danger-color)';
        statusDetail.textContent = err.message;
        badge.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: var(--danger-color);"></i> خطأ';
        badge.style.background = '#fee2e2';
        badge.style.color = 'var(--danger-color)';
        if (deleteBtn) {
            deleteBtn.style.display = 'none';
            deleteBtn.disabled = true;
        }
        if (deleteMsg) {
            deleteMsg.style.display = 'none';
            deleteMsg.textContent = '';
        }
    }
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
    video.srcObject = null;
    document.getElementById('cameraContainer').style.display = 'none';
    document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
    document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
}

/**
 * التقاط صورة من الكاميرا
 */
function captureFacePhoto() {
    const video = document.getElementById('cameraVideo');
    if (!video.videoWidth || !video.videoHeight) {
        alert('⚠️ الكاميرا غير جاهزة. يرجى المحاولة مرة أخرى.');
        return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    faceImageBase64 = imageData;

    // عرض رسالة (بدون معاينة)
    const statusText = document.getElementById('faceDataStatusText');
    const statusDetail = document.getElementById('faceDataStatusDetail');
    if (statusText) {
        statusText.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 📸 جاري تحليل الصورة...';
        statusText.style.color = 'var(--primary-color)';
    }
    if (statusDetail) {
        statusDetail.textContent = 'جاري التحقق من جودة الصورة...';
    }

    // إغلاق الكاميرا
    stopFaceCamera();

    // تحليل الصورة
    analyzeFaceImage(imageData);
}

/**
 * تحليل صورة الوجه (تأكيد الجودة قبل الحفظ) - مع تحديث حالة البيانات مباشرة
 */
async function analyzeFaceImage(base64) {
    const statusText = document.getElementById('faceDataStatusText');
    const statusDetail = document.getElementById('faceDataStatusDetail');

    try {
        const response = await fetch('/api/analyze-face', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64 })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            statusText.innerHTML = '❌ فشل تحليل الصورة';
            statusText.style.color = 'var(--danger-color)';
            statusDetail.textContent = result.error || 'يرجى اختيار صورة أخرى';
            // إعادة إظهار أزرار الرفع والكاميرا
            document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
            document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
            return;
        }

        // فحص جودة الصورة
        if (result.faceCount === 0) {
            statusText.innerHTML = '❌ لم يتم التعرف على وجه';
            statusText.style.color = 'var(--danger-color)';
            statusDetail.textContent = 'يرجى اختيار صورة واضحة تحتوي على وجه واحد';
            document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
            document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
            return;
        }

        if (result.faceCount > 1) {
            statusText.innerHTML = `❌ تم اكتشاف ${result.faceCount} وجوه`;
            statusText.style.color = 'var(--danger-color)';
            statusDetail.textContent = 'يرجى اختيار صورة تحتوي على وجه واحد فقط';
            document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
            document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
            return;
        }

        if (result.detectionConfidence < 0.7) {
            statusText.innerHTML = '⚠️ ثقة الكشف منخفضة';
            statusText.style.color = 'var(--warning-color)';
            statusDetail.textContent = `نسبة الثقة: ${Math.round(result.detectionConfidence * 100)}%. يرجى استخدام صورة أوضح.`;
            document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
            document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
            return;
        }

        // التحقق من زوايا الوجه
        const isFrontal = Math.abs(result.rollAngle || 0) < 25 &&
                          Math.abs(result.panAngle || 0) < 25 &&
                          Math.abs(result.tiltAngle || 0) < 25;

        if (!isFrontal) {
            statusText.innerHTML = '⚠️ الوجه غير مواجه للكاميرا';
            statusText.style.color = 'var(--warning-color)';
            statusDetail.textContent = 'يرجى توجيه الوجه مباشرة للكاميرا';
            document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
            document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
            return;
        }

        // الصورة صالحة - حفظ البيانات تلقائياً
        statusText.innerHTML = '✅ صورة الوجه صالحة للتحقق الرقمي';
        statusText.style.color = 'var(--secondary-color)';
        statusDetail.textContent = `الثقة: ${Math.round(result.detectionConfidence * 100)}% | الوجه مواجه للكاميرا`;
        
        // حفظ البيانات تلقائياً بعد نجاح التحليل
        await saveFaceData();

    } catch (err) {
        console.error('❌ فشل تحليل الصورة:', err);
        statusText.innerHTML = '❌ حدث خطأ أثناء التحليل';
        statusText.style.color = 'var(--danger-color)';
        statusDetail.textContent = err.message || 'يرجى المحاولة مرة أخرى';
        document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
        document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
    }
}

/**
 * حفظ بيانات الوجه (يتم استدعاؤها تلقائياً بعد نجاح التحليل)
 */
async function saveFaceData() {
    if (isSavingFace) return;
    if (!faceImageBase64) {
        alert('⚠️ يرجى اختيار صورة وجه أولاً.');
        return;
    }

    isSavingFace = true;
    const statusText = document.getElementById('faceDataStatusText');
    const statusDetail = document.getElementById('faceDataStatusDetail');

    statusText.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ⏳ جاري حفظ البيانات...';
    statusText.style.color = 'var(--text-secondary)';
    statusDetail.textContent = '';

    try {
        const payload = new URLSearchParams();
        payload.append('action', 'saveFaceFeatures');
        payload.append('childID', currentChildID);
        payload.append('faceImage', faceImageBase64);

        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: payload.toString()
        });

        const result = await response.json();

        if (result.success) {
            statusText.innerHTML = '✅ ' + (result.message || 'تم حفظ بيانات الوجه بنجاح!');
            statusText.style.color = 'var(--secondary-color)';
            statusDetail.textContent = '';

            // إعادة تحميل الحالة لتحديث التواريخ وزر الحذف
            setTimeout(() => {
                loadFaceDataStatus();
                // إعادة أزرار الرفع والكاميرا
                document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
                document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
                faceImageBase64 = null;
            }, 1500);
        } else {
            statusText.innerHTML = '❌ ' + (result.error || 'فشل حفظ البيانات');
            statusText.style.color = 'var(--danger-color)';
            statusDetail.textContent = 'يرجى المحاولة مرة أخرى';
            document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
            document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
        }

    } catch (err) {
        console.error('❌ فشل حفظ بيانات الوجه:', err);
        statusText.innerHTML = '⚠️ خطأ في الاتصال: ' + err.message;
        statusText.style.color = 'var(--danger-color)';
        statusDetail.textContent = '';
        document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
        document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
    } finally {
        isSavingFace = false;
    }
}

/**
 * حذف بيانات الوجه من الخادم
 */
async function deleteFaceData() {
    if (!currentChildID) {
        alert('⚠️ لم يتم العثور على معرف الطفل.');
        return;
    }

    // طلب تأكيد من المستخدم
    const confirmDelete = confirm(
        '⚠️ هل أنت متأكد من حذف بيانات الوجه؟\n\n' +
        'سيؤدي هذا إلى إلغاء إمكانية التحقق الرقمي بالوجه لهذا الطفل.\n' +
        'يمكنك إعادة إضافة البيانات في أي وقت.'
    );

    if (!confirmDelete) return;

    const deleteBtn = document.getElementById('deleteFaceBtn');
    const deleteMsg = document.getElementById('faceDeleteMessage');
    const statusText = document.getElementById('faceDataStatusText');

    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحذف...';
    deleteMsg.style.display = 'block';
    deleteMsg.textContent = '⏳ جاري حذف البيانات...';
    deleteMsg.style.color = 'var(--text-secondary)';

    try {
        const payload = new URLSearchParams();
        payload.append('action', 'deleteFaceFeatures');
        payload.append('childID', currentChildID);

        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: payload.toString()
        });

        const result = await response.json();

        if (result.success) {
            deleteMsg.textContent = '✅ ' + (result.message || 'تم حذف بيانات الوجه بنجاح!');
            deleteMsg.style.color = 'var(--secondary-color)';
            deleteBtn.innerHTML = '<i class="fas fa-check"></i> تم الحذف';
            deleteBtn.disabled = true;

            setTimeout(() => {
                loadFaceDataStatus();
                deleteBtn.style.display = 'none';
                deleteBtn.disabled = false;
                deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i> حذف بيانات الوجه';
                deleteMsg.style.display = 'none';
                deleteMsg.textContent = '';
            }, 2000);
        } else {
            deleteMsg.textContent = '❌ ' + (result.error || 'فشل حذف البيانات');
            deleteMsg.style.color = 'var(--danger-color)';
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i> حذف بيانات الوجه';
        }

    } catch (err) {
        console.error('❌ فشل حذف بيانات الوجه:', err);
        deleteMsg.textContent = '⚠️ خطأ في الاتصال: ' + err.message;
        deleteMsg.style.color = 'var(--danger-color)';
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i> حذف بيانات الوجه';
    }
}

// ============================================================
//  ربط أحداث البيانات الإقليدية
// ============================================================

// رفع صورة من الجهاز
document.getElementById('uploadFaceBtn')?.addEventListener('click', function() {
    document.getElementById('faceImageUpload').click();
});

// معالجة رفع الملف
document.getElementById('faceImageUpload')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

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

    const reader = new FileReader();
    reader.onload = function(ev) {
        faceImageBase64 = ev.target.result;
        // تحديث حالة النص
        const statusText = document.getElementById('faceDataStatusText');
        const statusDetail = document.getElementById('faceDataStatusDetail');
        if (statusText) {
            statusText.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 📸 جاري تحليل الصورة...';
            statusText.style.color = 'var(--primary-color)';
        }
        if (statusDetail) {
            statusDetail.textContent = 'جاري التحقق من جودة الصورة...';
        }
        // إخفاء أزرار الرفع والكاميرا مؤقتاً
        document.getElementById('uploadFaceBtn').style.display = 'none';
        document.getElementById('cameraFaceBtn').style.display = 'none';

        analyzeFaceImage(faceImageBase64);
    };
    reader.readAsDataURL(file);
});

// زر الكاميرا
document.getElementById('cameraFaceBtn')?.addEventListener('click', startFaceCamera);

// زر التقاط الصورة
document.getElementById('capturePhotoBtn')?.addEventListener('click', captureFacePhoto);

// زر إغلاق الكاميرا
document.getElementById('closeCameraBtn')?.addEventListener('click', function() {
    stopFaceCamera();
    document.getElementById('uploadFaceBtn').style.display = 'inline-flex';
    document.getElementById('cameraFaceBtn').style.display = 'inline-flex';
});

// ✅ زر حذف بيانات الوجه
document.getElementById('deleteFaceBtn')?.addEventListener('click', deleteFaceData);

// ============================================================
//  تسجيل الدخول وجلب البيانات
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    // تسجيل الدخول
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const childID = getFullID();
            const email = document.getElementById('loginEmail').value.trim();
            if (!childID || !email) {
                document.getElementById('loginError').textContent = 'الرجاء إدخال رقم الطفل والبريد الإلكتروني';
                document.getElementById('loginError').classList.add('show');
                return;
            }
            document.getElementById('loginLoading').classList.add('show');
            document.getElementById('loginError').classList.remove('show');
            try {
                const res = await fetch(`/api?action=family&innerAction=verifyFamilyAccess&childID=${encodeURIComponent(childID)}&email=${encodeURIComponent(email)}`);
                const data = await res.json();
                if (data.success) {
                    currentChildID = childID;
                    await loadChildData();
                    document.getElementById('loginCard').style.display = 'none';
                    document.getElementById('dashboardCard').style.display = 'block';
                } else {
                    document.getElementById('loginError').textContent = data.error || 'فشل التحقق';
                    document.getElementById('loginError').classList.add('show');
                }
            } catch (err) {
                document.getElementById('loginError').textContent = 'خطأ في الاتصال: ' + err.message;
                document.getElementById('loginError').classList.add('show');
            } finally {
                document.getElementById('loginLoading').classList.remove('show');
            }
        });
    }

    const childNumberInput = document.getElementById('loginChildNumber');
    if (childNumberInput) {
        childNumberInput.addEventListener('input', function(e) {
            this.value = this.value.replace(/[^0-9]/g, '');
        });
    }

    const reloadBtn = document.getElementById('reloadPageBtn');
    if (reloadBtn) {
        reloadBtn.addEventListener('click', function() {
            location.reload();
        });
    }

    // إدارة الملاحظات
    const addNoteBtn = document.getElementById('addNoteBtn');
    if (addNoteBtn) {
        addNoteBtn.addEventListener('click', () => {
            const note = document.getElementById('noteInput').value.trim();
            if (note) {
                notesArray.push(note);
                renderNotes();
                document.getElementById('noteInput').value = '';
            }
        });
    }

    const childImage = document.getElementById('childImage');
    if (childImage) {
        childImage.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    document.getElementById('imagePreview').innerHTML = `<img src="${ev.target.result}">`;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // تحديث البيانات
    const updateBtn = document.getElementById('updateBtn');
    if (updateBtn) {
        updateBtn.addEventListener('click', async () => {
            if (!document.getElementById('acknowledgeCheckbox').checked) {
                alert('يجب الموافقة على صحة البيانات قبل الحفظ.');
                return;
            }
            if (!validateForm()) {
                alert('الرجاء تصحيح الأخطاء في النموذج.');
                return;
            }

            const updatedFields = {};
            let newChildName = document.getElementById('childName').value.trim();
            newChildName = Utils.normalizeAbdName(newChildName);
            if (newChildName !== originalData.childName) updatedFields.CHILD_NAME = newChildName;

            const newBirth = document.getElementById('birthDate').value;
            if (newBirth !== originalData.birthDate) updatedFields.BIRTH_DATE = newBirth;

            const newMaps = document.getElementById('googleMapsAddress').value.trim();
            if (newMaps !== originalData.googleMapsAddress) updatedFields.GOOGLE_MAPS = newMaps;

            const newDetailed = document.getElementById('detailedAddress').value.trim();
            if (newDetailed !== originalData.detailedAddress) updatedFields.DETAILED_ADDRESS = newDetailed;

            const newFatherLocal = document.getElementById('fatherPhone').value.trim();
            let newFatherIntl = '';
            if (newFatherLocal !== '') {
                const norm = Utils.normalizeEgyptPhone(newFatherLocal);
                newFatherIntl = norm ? norm.international : newFatherLocal;
            }
            if (newFatherIntl !== originalData.fatherPhone) updatedFields.FATHER_PHONE = newFatherIntl;

            const newMotherName = document.getElementById('motherName').value.trim();
            if (newMotherName !== originalData.motherName) updatedFields.MOTHER_NAME = newMotherName;

            const newMotherLocal = document.getElementById('motherPhone').value.trim();
            let newMotherIntl = '';
            if (newMotherLocal !== '') {
                const norm = Utils.normalizeEgyptPhone(newMotherLocal);
                newMotherIntl = norm ? norm.international : newMotherLocal;
            }
            if (newMotherIntl !== originalData.motherPhone) updatedFields.MOTHER_PHONE = newMotherIntl;

            const newMarketer = document.getElementById('marketerId').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (newMarketer !== originalData.marketerId) updatedFields.MARKETER_ID = newMarketer;

            const newNotes = JSON.stringify(notesArray);
            if (newNotes !== originalData.notes) updatedFields.NOTES = newNotes;

            let imageBase64 = null;
            const imageFile = document.getElementById('childImage').files[0];
            if (imageFile) imageBase64 = await Utils.fileToBase64(imageFile);

            if (Object.keys(updatedFields).length === 0 && !imageBase64) {
                alert('لم تقم بتغيير أي بيانات.');
                return;
            }

            document.getElementById('updateLoading').classList.add('show');
            document.getElementById('updateMessage').classList.remove('show');

            try {
                const formData = new FormData();
                formData.append('action', 'updateChildData');
                formData.append('childID', currentChildID);
                formData.append('updatedFields', JSON.stringify(updatedFields));
                if (imageBase64) formData.append('imageBase64', imageBase64);
                const res = await fetch(APP_URL, { method: 'POST', body: formData });
                const result = await res.json();
                if (result.success) {
                    document.getElementById('updateMessage').textContent = '✅ ' + (result.message || 'تم تحديث البيانات بنجاح');
                    document.getElementById('updateMessage').classList.add('show');
                    await loadChildData();
                    document.getElementById('childImage').value = '';
                } else {
                    alert('فشل التحديث: ' + result.error);
                }
            } catch (err) {
                alert('خطأ: ' + err.message);
            } finally {
                document.getElementById('updateLoading').classList.remove('show');
            }
        });
    }

    // أزرار الإبلاغ عن الاختفاء
    const reportBtn = document.getElementById('reportMissingBtn');
    if (reportBtn) {
        reportBtn.addEventListener('click', openMissingReportModal);
    }

    const closeModalBtn = document.getElementById('closeMissingModalBtn');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeMissingReportModal);
    }

    const modal = document.getElementById('missingReportModal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeMissingReportModal();
            }
        });
    }

    const submitReportBtn = document.getElementById('submitMissingReportBtn');
    if (submitReportBtn) {
        submitReportBtn.addEventListener('click', submitMissingReport);
    }

        // تحميل حالة الوجه + تليجرام بعد تحميل بيانات الطفل
    const originalLoadChildData = window.loadChildData;
    window.loadChildData = async function() {
        if (typeof originalLoadChildData === 'function') {
            await originalLoadChildData();
        }
        if (currentChildID) {
            setTimeout(loadFaceDataStatus, 500);
            setTimeout(loadTelegramStatus, 700);
        }
    };

    
});

// ============================================================
//  تحميل بيانات الطفل الأساسية
// ============================================================
async function loadChildData() {
    try {
        const res = await fetch(`${APP_URL}?action=getChildDataForFamily&childID=${encodeURIComponent(currentChildID)}`);
        const data = await res.json();
        if (data.success) {
            const child = data.data;
            originalData = {
                childName: child.childName,
                birthDate: child.birthDate,
                googleMapsAddress: child.googleMapsAddress,
                detailedAddress: child.detailedAddress,
                fatherPhone: child.fatherPhone,
                motherName: child.motherName,
                motherPhone: child.motherPhone,
                notes: child.notes,
                imageFileId: child.imageFileId,
                marketerId: child.marketerId || ''
            };
            document.getElementById('childName').value = child.childName || '';
            protectChildNameField();

            function formatBirthDateForInput(dateStr) {
                if (!dateStr) return '';
                if (dateStr.includes('T') && dateStr.includes('Z')) return dateStr.split('T')[0];
                if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
                if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
                    let parts = dateStr.split('-');
                    return `${parts[2]}-${parts[1]}-${parts[0]}`;
                }
                if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
                    let parts = dateStr.split('/');
                    return `${parts[2]}-${parts[1]}-${parts[0]}`;
                }
                let d = new Date(dateStr);
                if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
                return '';
            }
            document.getElementById('birthDate').value = formatBirthDateForInput(child.birthDate);
            document.getElementById('googleMapsAddress').value = child.googleMapsAddress || '';
            document.getElementById('detailedAddress').value = child.detailedAddress || '';
            document.getElementById('fatherPhone').value = Utils.internationalToLocal(child.fatherPhone);
            document.getElementById('motherName').value = child.motherName || '';
            document.getElementById('motherPhone').value = Utils.internationalToLocal(child.motherPhone);
            document.getElementById('marketerId').value = child.marketerId || '';
            
            const marketerId = document.getElementById('marketerId');
            if (marketerId) {
                marketerId.addEventListener('input', Utils.restrictMarketerInput);
            }
            
            try { notesArray = JSON.parse(child.notes || '[]'); } catch(e) { notesArray = []; }
            renderNotes();
            attachLiveValidation();

            if (child.imageFileId) {
                const imgUrl = `https://drive.google.com/thumbnail?id=${child.imageFileId}&sz=s200`;
                document.getElementById('imagePreview').innerHTML = `<img src="${imgUrl}">`;
            } else {
                document.getElementById('imagePreview').innerHTML = '<div class="placeholder">📸 اضغط لاختيار صورة جديدة</div>';
            }

            await loadScanReport();

        } else {
            alert('فشل تحميل البيانات: ' + data.error);
        }
    } catch (err) {
        alert('خطأ: ' + err.message);
    }
}

// ============================================================
//  🟦 قسم تليجرام — إعدادات الإشعارات (الأب + الأم)
// ============================================================

/**
 * تحميل حالة ربط الأب والأم
 */
async function loadTelegramStatus() {
    if (!currentChildID) return;

    const badge = document.getElementById('telegramStatusBadge');
    const methodBox = document.getElementById('notificationMethodBox');
    if (!badge) return;

    try {
        const res = await fetch('/api?action=telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                innerAction: 'getTelegramStatus',
                childID: currentChildID
            })
        });

        const data = await res.json();
        console.log('📩 getTelegramStatus:', data);

        if (!data.success) {
            badge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> خطأ';
            badge.style.background = '#fee2e2';
            badge.style.color = 'var(--danger-color)';
            return;
        }

        telegramStatus = {
            father: data.father || { isLinked: false },
            mother: data.mother || { isLinked: false },
            anyLinked: !!data.anyLinked,
            notificationMethod: data.notificationMethod || 'email'
        };

        // تحديث واجهة الأب
        renderParentCard('father', telegramStatus.father);
        // تحديث واجهة الأم
        renderParentCard('mother', telegramStatus.mother);

        // الـ badge العام
        if (data.anyLinked) {
            badge.innerHTML = '<i class="fas fa-check-circle"></i> مربوط';
            badge.style.background = '#e8f5ee';
            badge.style.color = 'var(--secondary-dark)';
        } else {
            badge.innerHTML = '<i class="fas fa-exclamation-circle"></i> غير مربوط';
            badge.style.background = '#fef3c7';
            badge.style.color = '#92400e';
        }

                // اختيار طريقة الإشعارات
        if (methodBox) {
            if (data.anyLinked) {
                // ✅ في parent مربوط → نعرض الـ radio
                methodBox.style.display = 'block';
                if (data.notificationMethod === 'telegram') {
                    document.getElementById('methodTelegramRadio').checked = true;
                } else {
                    document.getElementById('methodEmailRadio').checked = true;
                }
            } else {
                // ❌ مفيش أي parent مربوط → نخفيه
                methodBox.style.display = 'none';
            }
        }

        // رسالة تحفيزية
        const noLinkMsg = document.getElementById('noLinkMessage');
        if (noLinkMsg) {
            noLinkMsg.style.display = data.anyLinked ? 'none' : 'block';
        }

    } catch (err) {
        console.error('❌ loadTelegramStatus:', err);
        badge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> خطأ';
        badge.style.background = '#fee2e2';
        badge.style.color = 'var(--danger-color)';
    }
}

/**
 * رسم بطاقة parent (father / mother)
 */
function renderParentCard(parentType, parentData) {
    const notLinkedView = document.getElementById(parentType + 'NotLinked');
    const linkedView = document.getElementById(parentType + 'Linked');
    const statusBadge = document.getElementById(parentType + 'StatusBadge');

    if (!notLinkedView || !linkedView || !statusBadge) return;

    if (parentData.isLinked) {
        notLinkedView.style.display = 'none';
        linkedView.style.display = 'flex';

        statusBadge.className = 'badge-small linked';
        statusBadge.innerHTML = '<i class="fas fa-check-circle"></i> مربوط';

        // إخفاء chat_id بالكامل
        const maskedChat = parentData.chatId
            ? parentData.chatId.toString().replace(/(\d{4})\d+(\d{3})/, '$1***$2')
            : '*******';
        document.getElementById(parentType + 'ChatDetail').textContent = 'Chat ID: ' + maskedChat;

        if (parentData.linkedAt) {
            document.getElementById(parentType + 'SinceDetail').textContent = 'منذ: ' + formatDate(parentData.linkedAt);
        }
    } else {
        notLinkedView.style.display = 'block';
        linkedView.style.display = 'none';

        statusBadge.className = 'badge-small not-linked';
        statusBadge.innerHTML = '<i class="fas fa-times-circle"></i> غير مربوط';
    }
}

/**
 * بدء عملية الربط
 */
async function startTelegramLink(parentType) {
    const btn = document.getElementById(parentType + 'LinkBtn');
    const originalHTML = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التحضير...';

    try {
        const res = await fetch('/api?action=telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                innerAction: 'generateLinkToken',
                childID: currentChildID,
                parentType: parentType
            })
        });

        const data = await res.json();
        console.log('📩 generateLinkToken:', data);

        if (!data.success) {
            if (data.error === 'already_linked') {
                alert('⚠️ ' + (data.message || 'هذا الحساب مربوط بالفعل'));
                await loadTelegramStatus();
            } else {
                alert('❌ ' + (data.message || data.error || 'فشل توليد الرابط'));
            }
            return;
        }

        showTelegramModal(data.deepLink, data.expiresAt, parentType);

    } catch (err) {
        console.error('❌ startTelegramLink:', err);
        alert('⚠️ خطأ في الاتصال');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

/**
 * عرض مودال الربط
 */
let currentLinkParentType = 'father';

function showTelegramModal(deepLink, expiresAt, parentType) {
    currentLinkParentType = parentType || 'father';

    const modal = document.getElementById('telegramLinkModal');
    const qrImg = document.getElementById('qrCodeImage');
    const qrLoading = document.getElementById('qrCodeLoading');
    const openLink = document.getElementById('openTelegramLink');
    const errorBox = document.getElementById('telegramLinkError');
    const statusText = document.getElementById('linkingStatusText');

    errorBox.style.display = 'none';
    qrImg.style.display = 'none';
    qrLoading.style.display = 'block';

    const parentLabel = currentLinkParentType === 'father' ? 'الأب' : 'الأم';
    statusText.innerHTML = `<i class="fas fa-spinner fa-spin"></i> في انتظار ربط ${parentLabel}...`;

    openLink.href = deepLink;
    openLink.style.display = 'flex';

    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(deepLink)}`;
    qrImg.onload = () => {
        qrLoading.style.display = 'none';
        qrImg.style.display = 'block';
    };
    qrImg.onerror = () => {
        qrLoading.innerHTML = '<p style="color: var(--danger-color);">⚠️ فشل تحميل QR</p>';
    };
    qrImg.src = qrUrl;

    modal.classList.add('show');
    modal.style.display = 'flex';

    telegramLinkExpiry = new Date(expiresAt).getTime();
    startCountdown();
    startTelegramPolling();
}

/**
 * عدّاد تنازلي
 */
function startCountdown() {
    const countdownEl = document.getElementById('linkCountdown');
    if (telegramCountdownInterval) clearInterval(telegramCountdownInterval);

    function tick() {
        const remaining = telegramLinkExpiry - Date.now();
        if (remaining <= 0) {
            countdownEl.textContent = '00:00';
            clearInterval(telegramCountdownInterval);
            telegramCountdownInterval = null;
            stopTelegramPolling();
            const statusText = document.getElementById('linkingStatusText');
            if (statusText) {
                statusText.innerHTML = '<span style="color: var(--danger-color);">⏰ انتهت صلاحية الرابط</span>';
            }
            return;
        }
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        countdownEl.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    }
    tick();
    telegramCountdownInterval = setInterval(tick, 1000);
}

/**
 * polling لحالة الربط
 */
function startTelegramPolling() {
    stopTelegramPolling();

    telegramPollingInterval = setInterval(async () => {
        try {
            const res = await fetch('/api?action=telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    innerAction: 'getTelegramStatus',
                    childID: currentChildID
                })
            });

            const data = await res.json();
            const targetParent = currentLinkParentType;
            const targetData = data[targetParent];

            if (data.success && targetData && targetData.isLinked) {
                stopTelegramPolling();
                clearInterval(telegramCountdownInterval);

                const statusText = document.getElementById('linkingStatusText');
                const parentLabel = targetParent === 'father' ? 'الأب' : 'الأم';
                if (statusText) {
                    statusText.innerHTML = `<span style="color: var(--secondary-color); font-size: 1.1rem;">✅ تم ربط ${parentLabel} بنجاح!</span>`;
                }

                setTimeout(async () => {
                    closeTelegramModal();
                    await loadTelegramStatus();

                    const msg = document.getElementById('telegramUpdateMessage');
                    if (msg) {
                        msg.className = 'message success';
                        msg.innerHTML = `✅ تم ربط ${parentLabel} بتليجرام بنجاح!`;
                        msg.style.display = 'block';
                        setTimeout(() => { msg.style.display = 'none'; }, 5000);
                    }
                }, 1200);
            }
        } catch (err) {
            console.warn('⚠️ polling error:', err);
        }
    }, 3000);
}

function stopTelegramPolling() {
    if (telegramPollingInterval) {
        clearInterval(telegramPollingInterval);
        telegramPollingInterval = null;
    }
}

function closeTelegramModal() {
    const modal = document.getElementById('telegramLinkModal');
    modal.classList.remove('show');
    modal.style.display = 'none';

    stopTelegramPolling();
    if (telegramCountdownInterval) {
        clearInterval(telegramCountdownInterval);
        telegramCountdownInterval = null;
    }
}

/**
 * فك الربط
 */
async function unlinkTelegramAccount(parentType) {
    const parentLabel = parentType === 'father' ? 'الأب' : 'الأم';
    const confirmed = confirm(
        `⚠️ هل أنت متأكد من فك ربط ${parentLabel}؟\n\n` +
        `لن يتمكن ${parentLabel} من استقبال الإشعارات عبر تليجرام.`
    );
    if (!confirmed) return;

    const btn = document.getElementById(parentType + 'UnlinkBtn');
    const originalHTML = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري فك الربط...';

    try {
        const res = await fetch('/api?action=telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                innerAction: 'unlinkTelegram',
                childID: currentChildID,
                parentType: parentType
            })
        });

        const data = await res.json();

        if (data.success) {
            const msg = document.getElementById('telegramUpdateMessage');
            msg.className = 'message success';
            msg.textContent = '✅ ' + (data.message || 'تم فك الربط');
            msg.style.display = 'block';
            await loadTelegramStatus();
            setTimeout(() => { msg.style.display = 'none'; }, 5000);
        } else {
            alert('❌ ' + (data.error || 'فشل فك الربط'));
        }
    } catch (err) {
        console.error('❌ unlinkTelegramAccount:', err);
        alert('⚠️ خطأ في الاتصال');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

/**
 * تغيير طريقة الإشعارات
 */
async function changeNotificationMethod(newMethod) {
    const msg = document.getElementById('telegramUpdateMessage');
    msg.style.display = 'none';

    try {
        const res = await fetch('/api?action=telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                innerAction: 'setNotificationMethod',
                childID: currentChildID,
                method: newMethod
            })
        });

        const data = await res.json();

        if (data.success) {
            telegramStatus.notificationMethod = newMethod;
            msg.className = 'message success';
            msg.textContent = newMethod === 'telegram'
                ? '✅ سيتم استقبال الإشعارات عبر تليجرام'
                : '✅ سيتم استقبال الإشعارات عبر البريد الإلكتروني';
            msg.style.display = 'block';
            setTimeout(() => { msg.style.display = 'none'; }, 4000);
        } else {
            msg.className = 'message error';
            msg.textContent = '❌ ' + (data.error || 'فشل التحديث');
            msg.style.display = 'block';
            if (telegramStatus.notificationMethod === 'telegram') {
                document.getElementById('methodTelegramRadio').checked = true;
            } else {
                document.getElementById('methodEmailRadio').checked = true;
            }
        }
    } catch (err) {
        console.error('❌ changeNotificationMethod:', err);
        msg.className = 'message error';
        msg.textContent = '⚠️ خطأ في الاتصال';
        msg.style.display = 'block';
    }
}

// ============================================================
//  ربط أحداث تليجرام
// ============================================================

document.getElementById('fatherLinkBtn')?.addEventListener('click', () => startTelegramLink('father'));
document.getElementById('motherLinkBtn')?.addEventListener('click', () => startTelegramLink('mother'));
document.getElementById('fatherUnlinkBtn')?.addEventListener('click', () => unlinkTelegramAccount('father'));
document.getElementById('motherUnlinkBtn')?.addEventListener('click', () => unlinkTelegramAccount('mother'));
document.getElementById('closeTelegramModalBtn')?.addEventListener('click', closeTelegramModal);

document.getElementById('telegramLinkModal')?.addEventListener('click', function(e) {
    if (e.target === this) closeTelegramModal();
});

document.getElementById('methodTelegramRadio')?.addEventListener('change', function() {
    if (this.checked) changeNotificationMethod('telegram');
});
document.getElementById('methodEmailRadio')?.addEventListener('change', function() {
    if (this.checked) changeNotificationMethod('email');
});

// ============================================================
//  🔗 Deep Link Support
//  ?open=notifications  → فتح قسم الإشعارات + Modal
//  ?type=father|mother  → تحديد الطرف المستهدف
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    const openSection = urlParams.get('open');
    const targetType = urlParams.get('type');

    if (openSection === 'notifications') {
        // ننتظر قليلاً حتى يُحمّل كل شيء
        setTimeout(() => {
            const section = document.getElementById('telegramSection');
            if (section) {
                section.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            // فتح Modal الربط للطرف المحدد
            if (targetType === 'father' || targetType === 'mother') {
                setTimeout(() => {
                    startTelegramLink(targetType);
                }, 500);
            }
        }, 1200);
    }
});