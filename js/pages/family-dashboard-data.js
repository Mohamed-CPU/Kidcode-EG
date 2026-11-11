// ================================================================
//  family-dashboard-data.js - منطق تبويب بيانات الطفل
//  - تحميل + تعديل بيانات الطفل
//  - رفع صورة
//  - بصمة الوجه (رفع/حذف)
//  - حذف الحساب
// ================================================================

(function() {
    'use strict';

    // ============================================================
    //  State
    // ============================================================
    const state = {
        childData: null,
        notes: [],
        originalNotes: [],
        newPhotoBase64: null,
        isSaving: false,
        isInitialized: false,
        isDisableSubmitting: false,
        isEnableSubmitting: false
    };

    // ============================================================
    //  DOM References
    // ============================================================
    const els = {
        // Header
        reloadDataBtn: document.getElementById('reloadDataBtn'),

        // Photo
        photoPreview: document.getElementById('photoPreview'),
        changePhotoBtn: document.getElementById('changePhotoBtn'),
        photoInput: document.getElementById('photoInput'),

        // Fields
        childName: document.getElementById('fdChildName'),
        birthDate: document.getElementById('fdBirthDate'),
        googleMaps: document.getElementById('fdGoogleMaps'),
        detailedAddress: document.getElementById('fdDetailedAddress'),
        fatherPhone: document.getElementById('fdFatherPhone'),
        motherPhone: document.getElementById('fdMotherPhone'),
        motherName: document.getElementById('fdMotherName'),
        marketerId: document.getElementById('fdMarketerId'),

        // Notes
        notesList: document.getElementById('fdNotesList'),
        noteInput: document.getElementById('fdNoteInput'),
        addNoteBtn: document.getElementById('addNoteBtn'),

        // Save
        acknowledge: document.getElementById('fdAcknowledge'),
        saveDataBtn: document.getElementById('saveDataBtn'),
        saveDataMessage: document.getElementById('saveDataMessage'),

        // Delete Modal
        openDeleteModalBtn: document.getElementById('openDeleteModalBtn'),
        deleteAccountModal: document.getElementById('deleteAccountModal'),
        closeDeleteModalBtn: document.getElementById('closeDeleteModalBtn'),
        cancelDeleteBtn: document.getElementById('cancelDeleteBtn'),
        deletePasswordInput: document.getElementById('deletePasswordInput'),
        deletePasswordError: document.getElementById('deletePasswordError'),
        deleteConfirmCheck: document.getElementById('deleteConfirmCheck'),
        confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),

        // ✅ Disable Modal
        openDisableModalBtn: document.getElementById('openDisableModalBtn'),
        disableAccountModal: document.getElementById('disableAccountModal'),
        closeDisableModalBtn: document.getElementById('closeDisableModalBtn'),
        cancelDisableBtn: document.getElementById('cancelDisableBtn'),
        disablePasswordInput: document.getElementById('disablePasswordInput'),
        disablePasswordError: document.getElementById('disablePasswordError'),
        confirmDisableBtn: document.getElementById('confirmDisableBtn'),

        // ✅ Enable Modal
        openEnableModalBtn: document.getElementById('openEnableModalBtn'),
        enableAccountModal: document.getElementById('enableAccountModal'),
        closeEnableModalBtn: document.getElementById('closeEnableModalBtn'),
        cancelEnableBtn: document.getElementById('cancelEnableBtn'),
        confirmEnableBtn: document.getElementById('confirmEnableBtn'),

        // ✅ Court Warning
        courtWarningBox: document.getElementById('courtWarningBox'),
        deleteModalActions: document.getElementById('deleteModalActions'),
        deleteFormSection: document.getElementById('deleteFormSection'),
        courtDisableInsteadBtn: document.getElementById('courtDisableInsteadBtn'),

        // 🆕 Payment Card
        paymentCard: document.getElementById('fdPaymentCard'),
        paymentStatusBox: document.getElementById('fdPaymentStatusBox'),
        retryPaymentBtn: document.getElementById('fdRetryPaymentBtn'),
        renewSubscriptionBtn: document.getElementById('fdRenewSubscriptionBtn')
    };

    // ============================================================
    //  Helpers
    // ============================================================
    function getFD() { return window.FD; }
    function getChildID() {
        return (getFD() && getFD().getChildID && getFD().getChildID()) || '';
    }
    function getSession() {
        return (getFD() && getFD().getSession && getFD().getSession()) || '';
    }
    function apiCall(innerAction, payload, method) {
        return getFD().apiCall(innerAction, payload, method);
    }
    function escapeHtml(str) {
        return (getFD() && getFD().escapeHtml) ? getFD().escapeHtml(str) : String(str || '');
    }
    function showLoader(show) {
        if (getFD() && getFD().showLoader) getFD().showLoader(show);
    }

    function showMessage(el, type, icon, text) {
        if (!el) return;
        const iconClass = {
            success: 'fa-circle-check',
            error: 'fa-circle-exclamation',
            info: 'fa-circle-info',
            warning: 'fa-triangle-exclamation'
        }[type] || 'fa-circle-info';

        el.className = 'fd-message ' + type + ' show';
        el.innerHTML = '<i class="fas ' + iconClass + '"></i><span>' + text + '</span>';
    }

    function hideMessage(el) {
        if (el) el.classList.remove('show');
    }

    function showFieldError(fieldId, message) {
        const el = document.getElementById(fieldId + 'Error');
        if (el) {
            el.textContent = message;
            el.classList.add('show');
        }
    }

    function hideFieldError(fieldId) {
        const el = document.getElementById(fieldId + 'Error');
        if (el) el.classList.remove('show');
    }

    function hideAllFieldErrors() {
        ['fdBirthDate', 'fdGoogleMaps', 'fdDetailedAddress', 'fdFatherPhone', 'fdMotherPhone', 'fdNoteInput'].forEach(hideFieldError);
    }

    // ============================================================
    //  Load Data
    // ============================================================
    async function loadData(options) {
        options = options || {};

        try {
            console.log('🔄 [DataTab] Loading child data...');

            // ✅ دايماً اطلب من الخادم
            const result = await apiCall('getChildDataForFamily', {
                childID: getChildID()
            }, 'GET');

            console.log('📩 getChildDataForFamily:', result);

            if (!result.success) {
                showMessage(els.saveDataMessage, 'error', 'error',
                    result.error || 'فشل تحميل البيانات');
                hideInitialLoaderIfExists();
                return;
            }

            state.childData = result.data;

            // ✅ خزّن في FD بس (in-memory)
            try {
                const fdStateRef = getFD().getState();
                if (fdStateRef) fdStateRef.childData = result.data;
            } catch (e) {}

            populateForm(result.data);

            setTimeout(function() {
                hideInitialLoaderIfExists();
            }, 100);

        } catch (err) {
            console.error('❌ loadData error:', err);
            showMessage(els.saveDataMessage, 'error', 'error',
                'تعذر الاتصال بالخادم. حاول مرة أخرى.');
            hideInitialLoaderIfExists();
        }
    }

    // ✅ Helper: أخفي الـ initial loader بأمان
    function hideInitialLoaderIfExists() {
        if (getFD() && typeof getFD().hideInitialLoader === 'function') {
            getFD().hideInitialLoader();
        }
    }

    // ============================================================
    //  🧹 Helper: امسح Cache بيانات الطفل
    //  - يُستخدم بعد Disable / Enable / Update
    //  - يجبر الـ Reload على جلب بيانات جديدة من Supabase
    // ============================================================
    function invalidateChildDataCache() {
        try {
            // 1. امسح من FD state
            const fdState = getFD().getState();
            if (fdState) fdState.childData = null;

            // 2. امسح من sessionStorage
            sessionStorage.removeItem('family_child_data');

            console.log('🧹 [Cache] تم مسح cache بيانات الطفل');
        } catch (e) {
            console.warn('⚠️ [Cache] فشل المسح:', e);
        }
    }

    function populateForm(data) {
        if (!data) return;

        // Photo
        renderPhoto(data.imageFileId);

        // Fields
        if (els.childName) els.childName.value = data.childName || '';
        if (els.birthDate) {
            els.birthDate.value = formatBirthDateForDisplay(data.birthDate);
            els.birthDate.readOnly = true; // ✅ readonly دايماً
        }
        if (els.googleMaps) els.googleMaps.value = data.googleMapsAddress || '';
        if (els.detailedAddress) els.detailedAddress.value = data.detailedAddress || '';

        // ✅ الهواتف: تحويل من دولي لمحلي
        if (els.fatherPhone) els.fatherPhone.value = toLocalPhone(data.fatherPhone || '');
        if (els.motherPhone) els.motherPhone.value = toLocalPhone(data.motherPhone || '');
        if (els.motherName) els.motherName.value = data.motherName || '';

        // ✅ كود المسوق: readonly لو مش فاضي
        if (els.marketerId) {
            const mk = (data.marketerId || '').toString().trim();
            els.marketerId.value = mk;
            if (mk) {
                els.marketerId.readOnly = true;
                els.marketerId.title = 'كود المسوق مسجل بالفعل';
                if (els.marketerHint) {
                    els.marketerHint.innerHTML = '🔒 الكود محفوظ ومسجل مسبقاً';
                    els.marketerHint.style.color = 'var(--secondary-dark)';
                }
            } else {
                els.marketerId.readOnly = false;
                els.marketerId.title = '';
                if (els.marketerHint) {
                    els.marketerHint.innerHTML = '';
                    els.marketerHint.style.color = '';
                }
            }
        }

        // Notes
        let notes = [];
        try {
            notes = JSON.parse(data.notes || '[]');
            if (!Array.isArray(notes)) notes = [];
        } catch (e) {
            notes = [];
        }
        state.notes = notes.slice();
        state.originalNotes = notes.slice();
        renderNotes();

        // ✅ إجبار المتصفح على تفريغ حقل الملاحظة الجديدة
        if (els.noteInput) {
            els.noteInput.value = '';
        }

                // Reset acknowledge
        if (els.acknowledge) els.acknowledge.checked = false;
        updateSaveButtonState();

        // 🆕 تحديث كارت الدفع
        updatePaymentCard(data);

        // ✅ تحديث أزرار Danger Zone حسب الحالة
        updateDangerZoneUI(data);
    }

    // ============================================================
    //  💳 Payment Card Logic
    // ============================================================
    function updatePaymentCard(data) {
        if (!els.paymentCard) {
            console.warn('[PaymentCard] fdPaymentCard not found in DOM');
            return;
        }

        const status = (data.status || '').toLowerCase();
        const cancelRefundBtn = document.getElementById('cancelRefundRequestBtn');
        const renewPlanGroup = document.getElementById('fdRenewPlanGroup');
        const lastStatus = data.lastPaymentStatus;
        const hasPaid = data.hasPaidHistory === true;
        const expiryRaw = data.expiryDate;
        const currentPlan = data.plan || '';
        const lastPaymentAmount = data.lastPaymentAmount;
        const childID = getChildID();

        // إخفاء البطاقة فقط للحسابات المحذوفة
        if (status === 'deleted') {
            els.paymentCard.style.display = 'none';
            return;
        }

        // ============================================================
        //  حساب الأيام المتبقية
        // ============================================================
        let daysLeft = null;
        if (expiryRaw) {
            const exp = new Date(expiryRaw);
            if (!isNaN(exp.getTime())) {
                daysLeft = Math.ceil((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            }
        }

        // ============================================================
        //  تحديد الـ Actions المتاحة
        // ============================================================
        const showRetry = (lastStatus === 'failed') && (status === 'pending' || status === 'expired');
        const showPurchase = (status === 'pending' && lastStatus !== 'failed' && lastStatus !== 'pending');
        const showRenew = (status === 'expired') ||
                          (status === 'active' && hasPaid && daysLeft !== null && daysLeft > 0 && daysLeft <= 30);
        const showUpgrade = (status === 'active' && !hasPaid);

        // ============================================================
        //  بناء رسالة الحالة
        // ============================================================
        let statusHtml = '';

        if (status === 'pending') {
            if (lastStatus === 'failed') {
                statusHtml = statusItem('error', 'fa-circle-exclamation',
                    'آخر عملية دفع لم تكتمل',
                    'يمكنك المحاولة مرة أخرى بأمان.');
            } else if (lastStatus === 'pending') {
                statusHtml = statusItem('warning', 'fa-hourglass-half',
                    'عملية دفع قيد المعالجة',
                    'إذا كنت قد أكملت الدفع، سيتم التفعيل خلال دقائق.');
            } else {
                statusHtml = statusItem('warning', 'fa-clock',
                    'الاشتراك قيد التفعيل',
                    'أكمل الدفع لتفعيل الحساب فوراً.');
            }
        } else if (status === 'expired') {
            statusHtml = statusItem('error', 'fa-clock',
                'انتهى الاشتراك',
                'جدّد الاشتراك للاستمرار في حماية طفلك.');
        } else if (status === 'disabled') {
            statusHtml = statusItem('warning', 'fa-power-off',
                'الحساب معطَّل',
                'فعّل الحساب أولاً من تبويب بيانات الطفل.');
        } else if (status === 'active') {
            if (!hasPaid) {
                statusHtml = statusItem('info', 'fa-gift',
                    'أنت على خطة الإطلاق المجانية',
                    'يمكنك الترقية إلى باقة مدفوعة للاستمرار بعد انتهاء الشهر.');
            } else if (daysLeft !== null && daysLeft > 30) {
                // ✅ نشط + مدفوع + باقي وقت طويل → نعرض معلومات الاشتراك
                statusHtml =
                    statusItem('success', 'fa-check-circle',
                        'اشتراكك نشط',
                        'متبقي ' + daysLeft + ' يوم على انتهاء الاشتراك.') +
                    '<div class="fd-payment-meta">' +
                        '<div class="meta-row"><span class="label">الباقة الحالية:</span><span class="value">' + escapeHtml(currentPlan) + '</span></div>' +
                        '<div class="meta-row"><span class="label">تاريخ الانتهاء:</span><span class="value">' + escapeHtml(formatShortDate(expiryRaw)) + '</span></div>' +
                        (lastPaymentAmount ? '<div class="meta-row"><span class="label">آخر دفعة:</span><span class="value">' + lastPaymentAmount + ' ج.م</span></div>' : '') +
                    '</div>';
            } else if (daysLeft !== null && daysLeft > 0) {
                statusHtml = statusItem('warning', 'fa-hourglass-half',
                    'اشتراكك على وشك الانتهاء',
                    'متبقي ' + daysLeft + ' يوم. جدّد الآن للاستمرار.');
            } else if (daysLeft !== null && daysLeft <= 0) {
                statusHtml = statusItem('error', 'fa-clock',
                    'انتهى الاشتراك',
                    'جدّد الآن للاستمرار.');
            } else {
                statusHtml = statusItem('success', 'fa-check-circle',
                    'اشتراكك نشط',
                    'الباقة: ' + escapeHtml(currentPlan));
            }
        } else {
            statusHtml = statusItem('info', 'fa-info-circle',
                'حالة غير معروفة',
                'الحالة الحالية: ' + escapeHtml(status));
        }

        if (els.paymentStatusBox) els.paymentStatusBox.innerHTML = statusHtml;

        // ============================================================
        //  تكوين الأزرار (شرطياً)
        // ============================================================
        
        // إظهار/إخفاء اختيار الخطة
        if (renewPlanGroup) {
            renewPlanGroup.style.display = (showPurchase || showRenew || showUpgrade) ? 'block' : 'none';
        }

        if (els.retryPaymentBtn) {
            els.retryPaymentBtn.style.display = showRetry ? 'flex' : 'none';
            els.retryPaymentBtn.onclick = () => {
                const selectedPlan = document.getElementById('fdRenewPlanSelect') ? document.getElementById('fdRenewPlanSelect').value : currentPlan;
                openPaymentPage(childID, selectedPlan);
            };
        }

        if (els.renewSubscriptionBtn) {
            const anyAction = showPurchase || showRenew || showUpgrade;

            if (anyAction) {
                let btnText = '', btnIcon = '';
                if (showPurchase) {
                    btnText = 'إتمام الدفع';
                    btnIcon = 'fa-credit-card';
                } else if (showRenew) {
                    btnText = 'تجديد الاشتراك';
                    btnIcon = 'fa-calendar-plus';
                } else if (showUpgrade) {
                    btnText = 'ترقية إلى باقة مدفوعة';
                    btnIcon = 'fa-arrow-up';
                }
                els.renewSubscriptionBtn.innerHTML = '<i class="fas ' + btnIcon + '"></i> ' + btnText;
                els.renewSubscriptionBtn.style.display = 'flex';
                els.renewSubscriptionBtn.onclick = () => {
                    const selectedPlan = document.getElementById('fdRenewPlanSelect') ? document.getElementById('fdRenewPlanSelect').value : currentPlan;
                    openPaymentPage(childID, selectedPlan);
                };
            } else {
                els.renewSubscriptionBtn.style.display = 'none';
            }
        }

        // زر إلغاء طلب الاسترداد
        if (cancelRefundBtn) {
            if (status === 'refunding') {
                cancelRefundBtn.style.display = 'flex';
                cancelRefundBtn.onclick = cancelRefundRequest;
            } else {
                cancelRefundBtn.style.display = 'none';
            }
        }

        // ✅ إظهار البطاقة دايمًا (إلا للحذف)
        els.paymentCard.style.display = 'block';
    }

    // ============================================================
    //  🔙 إلغاء طلب الاسترداد
    // ============================================================
    async function cancelRefundRequest() {
        if (!confirm('هل أنت متأكد من إلغاء طلب الاسترداد؟ سيعود حساب طفلك للعمل بشكل طبيعي.')) return;
        
        showLoader(true);
        try {
            const result = await apiCall('cancelRefundRequest', {
                childID: getChildID(),
                session: getSession()
            }, 'POST');

            if (result.success) {
                alert('✅ تم إلغاء طلب الاسترداد بنجاح. تم إعادة تفعيل الحساب.');
                window.location.reload();
            } else {
                alert('❌ ' + (result.error || 'فشل إلغاء الطلب'));
            }
        } catch (e) {
            alert('تعذر الاتصال بالخادم. حاول مرة أخرى.');
        } finally {
            showLoader(false);
        }
    }

    // ============================================================
    //  Helper: بناء عنصر حالة
    // ============================================================
    function statusItem(type, icon, title, desc) {
        return '<div class="fd-payment-status-item ' + type + '">' +
            '<i class="fas ' + icon + '"></i>' +
            '<div><strong>' + title + '</strong><p>' + desc + '</p></div>' +
        '</div>';
    }

    // ============================================================
    //  Helper: تنسيق تاريخ قصير بتوقيت القاهرة
    //  ✅ يستخدم Utils.formatCairoDate للعرض العربي الموحد
    // ============================================================
    function formatShortDate(value) {
        if (!value) return '—';

        // ✅ الأولوية للعرض العربي الموحد (زي باقي الصفحات)
        if (window.Utils && typeof Utils.formatCairoDate === 'function') {
            try {
                const result = Utils.formatCairoDate(value);
                if (result && result !== String(value)) return result;
            } catch (e) {}
        }

        // Fallback: النسخة القديمة
        try {
            const d = new Date(value);
            if (isNaN(d.getTime())) return String(value).split(' ')[0];
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return yyyy + '-' + mm + '-' + dd;
        } catch (e) {
            return '—';
        }
    }

    function openPaymentPage(childID, currentPlan) {
        // ✅ تحويل مباشر بدون صفحة وسيطة
        const plan = (currentPlan === 'عام واحد') ? 'عام واحد' : '6 أشهر';
        startDirectPayment(childID, plan);
    }

    // ============================================================
    //  💳 Direct Payment (بدون صفحة وسيطة)
    // ============================================================
    async function startDirectPayment(childID, plan) {
        const btn = document.getElementById('fdRenewSubscriptionBtn')
                 || document.getElementById('fdRetryPaymentBtn');
        const originalHTML = btn ? btn.innerHTML : '';

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التحويل...';
        }

        try {
            const res = await fetch('/api?action=createPaymobIntention', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ childID, plan })
            });
            const data = await res.json();

            if (data.success && data.checkoutUrl) {
                window.location.href = data.checkoutUrl;
                return;
            }

            // معالجة الأخطاء
            let msg = data.message || 'تعذر إنشاء عملية الدفع.';
            let toastType = 'error';

            if (data.error === 'payment_in_progress') {
                const waitMin = data.retryAfterMinutes || 2;
                msg = '⏸️ لديك عملية دفع قيد المعالجة. يرجى الانتظار ' + waitMin + ' دقيقة.';
                toastType = 'warning';
                console.warn('[FamilyDashboard] Payment in progress:', data);
            } else {
                console.error('[FamilyDashboard] Intention failed:', data);
            }

            if (window.UI && window.UI.toast) {
                if (toastType === 'warning' && window.UI.toast.warning) {
                    window.UI.toast.warning(msg);
                } else if (window.UI.toast.error) {
                    window.UI.toast.error(msg);
                }
            } else {
                alert(msg);
            }

        } catch (e) {
            console.error('[FamilyDashboard] startDirectPayment error:', e);
            const msg = '⚠️ تعذر الاتصال بالخادم. حاول مرة أخرى.';
            if (window.UI && window.UI.toast) {
                window.UI.toast.error(msg);
            } else {
                alert(msg);
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }
    }

    // ============================================================
    //  ✅ Danger Zone UI (Disable / Enable buttons)
    // ============================================================
    function updateDangerZoneUI(data) {
        if (!data) return;

        const status = (data.status || '').toLowerCase();
        const isDisabled = (status === 'disabled');
        const isDeleted = (status === 'deleted' || status === 'refunded');
        const isPending = (status === 'pending');
        const isRefunding = (status === 'refunding');

        // ===== محذوف أو مسترد — كل الأزرار معطلة =====
        if (isDeleted) {
            if (els.openDisableModalBtn) els.openDisableModalBtn.style.display = 'none';
            if (els.openEnableModalBtn) els.openEnableModalBtn.style.display = 'none';
            if (els.openDeleteModalBtn) els.openDeleteModalBtn.disabled = true;
            return;
        }

        // ===== طلب استرداد قيد المراجعة — الزر معطل =====
        if (isRefunding) {
            if (els.openDisableModalBtn) els.openDisableModalBtn.style.display = 'none';
            if (els.openEnableModalBtn) els.openEnableModalBtn.style.display = 'none';
            if (els.openDeleteModalBtn) {
                els.openDeleteModalBtn.disabled = true;
                els.openDeleteModalBtn.innerHTML = '<i class="fas fa-clock"></i> طلب الاسترداد قيد المراجعة';
            }
            return;
        }

        // ===== قيد التفعيل — زر التعطيل معطّل (لكن ظاهر) =====
        if (isPending) {
            if (els.openDisableModalBtn) {
                els.openDisableModalBtn.style.display = 'flex';
                els.openDisableModalBtn.disabled = true;
                els.openDisableModalBtn.title = 'الحساب قيد التفعيل — لا يمكن تعطيله الآن';
                els.openDisableModalBtn.innerHTML =
                    '<i class="fas fa-lock"></i> التعطيل غير متاح (الحساب قيد التفعيل)';
            }
            if (els.openEnableModalBtn) els.openEnableModalBtn.style.display = 'none';
            return;
        }

        // ===== معطّل — نعرض زر التفعيل =====
        if (isDisabled) {
            if (els.openDisableModalBtn) els.openDisableModalBtn.style.display = 'none';
            if (els.openEnableModalBtn) els.openEnableModalBtn.style.display = 'flex';
            return;
        }

        // ===== الوضع العادي (active) — زر التعطيل شغّال =====
        if (els.openDisableModalBtn) {
            els.openDisableModalBtn.style.display = 'flex';
            els.openDisableModalBtn.disabled = false;
            els.openDisableModalBtn.title = '';
            els.openDisableModalBtn.innerHTML =
                '<i class="fas fa-power-off"></i> تعطيل الحساب';
        }
        if (els.openEnableModalBtn) els.openEnableModalBtn.style.display = 'none';
        
        // إعادة تفعيل زر الحذف/الاسترداد
        if (els.openDeleteModalBtn) {
            els.openDeleteModalBtn.disabled = false;
            els.openDeleteModalBtn.innerHTML = '<i class="fas fa-trash-alt"></i> إلغاء الاشتراك واسترداد المدفوعات وحذف البيانات نهائياً';
        }
    }

    // ✅ تحويل من دولي (201xxx) لمحلي (01xxx)
    function toLocalPhone(phone) {
        if (!phone) return '';
        let digits = String(phone).replace(/\D/g, '');
        if (digits.startsWith('20') && digits.length === 12) {
            return '0' + digits.substring(2);
        }
        if (digits.startsWith('20') && digits.length === 11) {
            return '0' + digits.substring(2);
        }
        if (digits.startsWith('01') && digits.length === 11) return digits;
        if (digits.length === 10) return '0' + digits;
        return digits;
    }

    function normalizeDateForInput(dateStr) {
        if (!dateStr) return '';
        const str = String(dateStr).trim();

        // Already yyyy-mm-dd
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

        // dd-mm-yyyy or dd/mm/yyyy
        const m = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
        if (m) {
            const d = String(m[1]).padStart(2, '0');
            const mo = String(m[2]).padStart(2, '0');
            return m[3] + '-' + mo + '-' + d;
        }

        // Try Date parse
        const dt = new Date(str);
        if (!isNaN(dt.getTime())) {
            const yyyy = dt.getFullYear();
            const mm = String(dt.getMonth() + 1).padStart(2, '0');
            const dd = String(dt.getDate()).padStart(2, '0');
            return yyyy + '-' + mm + '-' + dd;
        }

        return '';
    }

    // ============================================================
    //  📅 formatBirthDateForDisplay
    //  يحوّل من أي صيغة (YYYY-MM-DD من Supabase) لـ DD/MM/YYYY
    // ============================================================
    function formatBirthDateForDisplay(dateStr) {
        if (!dateStr) return '';
        const str = String(dateStr).trim();

        // YYYY-MM-DD → DD/MM/YYYY
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
            const parts = str.split('-');
            return parts[2] + '/' + parts[1] + '/' + parts[0];
        }

        // DD/MM/YYYY → كما هو
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
            const parts = str.split('/');
            const d = String(parts[0]).padStart(2, '0');
            const m = String(parts[1]).padStart(2, '0');
            return d + '/' + m + '/' + parts[2];
        }

        // محاولة أخيرة: Date parse
        const dt = new Date(str);
        if (!isNaN(dt.getTime())) {
            const yyyy = dt.getFullYear();
            const mm = String(dt.getMonth() + 1).padStart(2, '0');
            const dd = String(dt.getDate()).padStart(2, '0');
            return dd + '/' + mm + '/' + yyyy;
        }

        return str;
    }

    function renderPhoto(fileId) {
        if (!els.photoPreview) return;

        const strFileId = String(fileId || '').trim();
        
        // ✅ Cloudinary بس
        if (strFileId.startsWith('http')) {
            els.photoPreview.innerHTML = '<img src="' + strFileId + '" alt="صورة الطفل" onerror="this.parentNode.innerHTML=\'<i class=&quot;fas fa-child&quot;></i>\'">';
        } else {
            els.photoPreview.innerHTML = '<i class="fas fa-child"></i>';
        }
    }

    function renderNotes() {
        if (!els.notesList) return;

        els.notesList.innerHTML = '';

        if (state.notes.length === 0) return;

        state.notes.forEach(function(note, index) {
            const li = document.createElement('li');
            li.innerHTML =
                '<span class="note-text">' + escapeHtml(note) + '</span>' +
                '<button type="button" class="delete-note-btn" data-index="' + index + '" title="حذف">' +
                '<i class="fas fa-trash-alt"></i>' +
                '</button>';
            els.notesList.appendChild(li);
        });

        // Bind delete buttons
        els.notesList.querySelectorAll('.delete-note-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                const idx = parseInt(btn.getAttribute('data-index'), 10);
                if (!isNaN(idx)) {
                    state.notes.splice(idx, 1);
                    renderNotes();
                    updateSaveButtonState();
                }
            });
        });
    }

    // ============================================================
    //  Save Data
    // ============================================================
        // ============================================================
    //  Validation — Silent (للزر)
    // ============================================================
    function isFormValid() {
        // Birth Date (مطلوب)
        if (!els.birthDate.value) return false;

        // Detailed Address (مطلوب)
        if (!els.detailedAddress.value.trim()) return false;

        // Google Maps (اختياري)
        const gm = els.googleMaps.value.trim();
        if (gm && !Utils.validateGoogleMaps(gm)) return false;

        // Phones (واحد على الأقل + القيم صحيحة)
        const fp = els.fatherPhone.value.trim();
        const mp = els.motherPhone.value.trim();
        if (!fp && !mp) return false;
        if (fp && !Utils.normalizeEgyptPhone(fp)) return false;
        if (mp && !Utils.normalizeEgyptPhone(mp)) return false;

        // Notes Pending (مفيش ملاحظة معلقة)
        if (els.noteInput.value.trim()) return false;

        return true;
    }

    // ============================================================
    //  Validation — Per Field (يعرض الأخطاء)
    // ============================================================
    function displayFieldError(fieldId) {
        switch (fieldId) {
            case 'fdBirthDate':
                if (!els.birthDate.value) {
                    showFieldError('fdBirthDate', '📅 يرجى اختيار تاريخ الميلاد');
                    return;
                }
                hideFieldError('fdBirthDate');
                break;

            case 'fdDetailedAddress':
                if (!els.detailedAddress.value.trim()) {
                    showFieldError('fdDetailedAddress', '🏠 يرجى إدخال العنوان التفصيلي');
                    return;
                }
                hideFieldError('fdDetailedAddress');
                break;

            case 'fdGoogleMaps': {
                const gm = els.googleMaps.value.trim();
                if (gm !== '' && !Utils.validateGoogleMaps(gm)) {
                    showFieldError('fdGoogleMaps', '🗺️ رابط غير صحيح (يجب أن يبدأ بـ https://maps.app.goo.gl/)');
                    return;
                }
                hideFieldError('fdGoogleMaps');
                break;
            }

            case 'fdFatherPhone': {
                const f = els.fatherPhone.value.trim();
                if (f && !Utils.normalizeEgyptPhone(f)) {
                    showFieldError('fdFatherPhone', '📱 رقم غير صحيح');
                    return;
                }
                hideFieldError('fdFatherPhone');
                break;
            }

            case 'fdMotherPhone': {
                const m = els.motherPhone.value.trim();
                if (m && !Utils.normalizeEgyptPhone(m)) {
                    showFieldError('fdMotherPhone', '📱 رقم غير صحيح');
                    return;
                }
                hideFieldError('fdMotherPhone');
                break;
            }

            case 'fdNoteInput':
                if (els.noteInput.value.trim()) {
                    showFieldError('fdNoteInput', '📝 لديك ملاحظة غير مضافة! اضغط على زر "إضافة" أولاً.');
                    return;
                }
                hideFieldError('fdNoteInput');
                break;
        }

        // ✅ At-least-one-phone (خاص بحقول الهاتف)
        if (fieldId === 'fdFatherPhone' || fieldId === 'fdMotherPhone') {
            const fp = els.fatherPhone.value.trim();
            const mp = els.motherPhone.value.trim();
            if (!fp && !mp) {
                showFieldError('fdFatherPhone', '📱 يجب إدخال رقم هاتف الأب أو الأم على الأقل');
            }
        }
    }

    // ============================================================
    //  Update Save Button
    // ============================================================
    function updateSaveButtonState() {
        if (!els.saveDataBtn) return;
        const acknowledged = els.acknowledge && els.acknowledge.checked;
        els.saveDataBtn.disabled = !isFormValid() || !acknowledged || state.isSaving;
    }

    function normalizeToInternational(localPhone) {
        if (!localPhone) return '';
        let digits = String(localPhone).replace(/\D/g, '');
        if (digits.startsWith('20') && digits.length === 12) return digits;
        if (digits.startsWith('0') && digits.length === 11) return '20' + digits.substring(1);
        if (digits.length === 10) return '20' + digits;
        return digits;
    }

    async function handleSaveData() {
        if (state.isSaving) return;

        if (!isFormValid()) {
            ['fdBirthDate', 'fdDetailedAddress', 'fdGoogleMaps', 'fdFatherPhone', 'fdMotherPhone', 'fdNoteInput'].forEach(displayFieldError);
            showMessage(els.saveDataMessage, 'error', 'error', '❌ يرجى استكمال البيانات المطلوبة بشكل صحيح');
            return;
        }

        if (!els.acknowledge.checked) {
            showMessage(els.saveDataMessage, 'error', 'error', 'يجب الموافقة على الإقرار أولاً');
            return;
        }

        state.isSaving = true;
        els.saveDataBtn.disabled = true;
        hideMessage(els.saveDataMessage);
        showLoader(true);

                // ✅ فحص كود المسوق (لو جديد)
        const marketerCode = els.marketerId.value.trim().toUpperCase();
        const isMarketerReadonly = els.marketerId.readOnly;

        // لو المسوق مش readonly (يعني فاضي أو قابل للتعديل) + فيه كود جديد
        if (!isMarketerReadonly && marketerCode && marketerCode !== (state.childData && state.childData.marketerId || '')) {
            // تحقق من الكود
        try {
            const validateRes = await fetch(
                (window.CONFIG && window.CONFIG.API_URL ? window.CONFIG.API_URL : '') +
                '?action=validateMarketerCode&code=' + encodeURIComponent(marketerCode)
            );

            if (!validateRes.ok) {
                throw new Error('HTTP ' + validateRes.status);
            }

            const validation = await validateRes.json();
            console.log('🔍 validateMarketerCode:', validation);

            if (!validation.success || !validation.valid) {
                showFieldError('fdMarketerId', 'كود المسوق غير صحيح أو غير نشط');
                showMessage(els.saveDataMessage, 'error', 'error',
                    '❌ كود المسوق غير صحيح. تأكد من الكود أو اتركه فارغاً.');
                state.isSaving = false;
                showLoader(false);
                updateSaveButtonState();
                return;
            }
        } catch (e) {
            // ❌ فشل الاتصال → نوقف الحفظ
            console.error('❌ فشل التحقق من كود المسوق:', e);
            showFieldError('fdMarketerId', 'تعذر التحقق من الكود');
            showMessage(els.saveDataMessage, 'error', 'error',
                '⚠️ تعذر التحقق من كود المسوق. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.');
            state.isSaving = false;
            showLoader(false);
            updateSaveButtonState();
            return;
            }
        }

        try {
            // Build updated fields
            const updatedFields = {
                BIRTH_DATE: els.birthDate.value,
                GOOGLE_MAPS: els.googleMaps.value.trim(),
                DETAILED_ADDRESS: els.detailedAddress.value.trim(),
                FATHER_PHONE: normalizeToInternational(els.fatherPhone.value.trim()),
                MOTHER_PHONE: normalizeToInternational(els.motherPhone.value.trim()),
                MOTHER_NAME: els.motherName.value.trim(),
                MARKETER_ID: els.marketerId.value.trim().toUpperCase(),
                NOTES: JSON.stringify(state.notes)
            };

            // Prepare payload
            const payload = {
                childID: getChildID(),
                updatedFields: JSON.stringify(updatedFields),
                imageBase64: state.newPhotoBase64 || null
            };

            const result = await apiCall('updateChildData', payload, 'POST');
            console.log('📩 updateChildData:', result);

            if (result.success) {
                showMessage(els.saveDataMessage, 'success', 'success',
                    '✅ تم حفظ التغييرات بنجاح');

                // Reset state
                state.newPhotoBase64 = null;
                els.acknowledge.checked = false;

                // ✅ امسح الـ in-memory cache
                try {
                    const fdState = getFD().getState();
                    if (fdState) fdState.childData = null;
                } catch (e) {}

                // Reload data (force)
                setTimeout(function() {
                    loadData({ forceRefresh: true });
                }, 800);
            } else {
                showMessage(els.saveDataMessage, 'error', 'error',
                    result.error || 'فشل الحفظ');
            }

        } catch (err) {
            console.error('❌ handleSaveData error:', err);
            showMessage(els.saveDataMessage, 'error', 'error',
                'تعذر الاتصال بالخادم. حاول مرة أخرى.');
        } finally {
            state.isSaving = false;
            showLoader(false);
            updateSaveButtonState();
        }
    }

    // ============================================================
    //  Photo Upload
    // ============================================================
    function handlePhotoChange(file) {
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert('⚠️ يرجى اختيار ملف صورة صالح');
            return;
        }

        // ✅ الحد الجديد: 5 ميجا
        const MAX_SIZE = 5 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            alert('⚠️ حجم الصورة كبير جداً (الحد الأقصى 5 ميجابايت)');
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            const dataUrl = e.target.result;

            // ✅ Smart Compression: ضغط بس لو الصورة > 3 ميجا
            const COMPRESS_THRESHOLD = 3 * 1024 * 1024; // 3MB

            if (file.size > COMPRESS_THRESHOLD) {
                console.log(`📸 ضغط الصورة: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
                compressImage(dataUrl, function(compressed) {
                    state.newPhotoBase64 = compressed;
                    updatePhotoPreview(compressed);
                    updateSaveButtonState();
                    console.log(`✅ تم الضغط بنجاح`);
                });
            } else {
                console.log(`📸 الصورة صغيرة (${(file.size / 1024 / 1024).toFixed(2)}MB) — بدون ضغط`);
                state.newPhotoBase64 = dataUrl;
                updatePhotoPreview(dataUrl);
                updateSaveButtonState();
            }
        };
        reader.readAsDataURL(file);
    }

    // ============================================================
    //  🗜️ Smart Compression — ضغط ذكي بجودة عالية
    //  - أقصى بُعد: 2400px (يكفي لـ HD)
    //  - جودة: 0.88 (شبه غير ملحوظة)
    // ============================================================
    function compressImage(dataUrl, callback) {
        const img = new Image();
        img.onload = function() {
            let width = img.width;
            let height = img.height;

            const MAX_DIM = 2400;

            // تصغير لو أبعاد كبيرة
            if (width > MAX_DIM || height > MAX_DIM) {
                const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const compressed = canvas.toDataURL('image/jpeg', 0.88);
            callback(compressed);
        };
        img.onerror = function() {
            console.error('❌ فشل تحميل الصورة للضغط');
            callback(dataUrl); // fallback: نرجّع الأصلية
        };
        img.src = dataUrl;
    }

    // ============================================================
    //  🖼️ تحديث معاينة الصورة
    // ============================================================
    function updatePhotoPreview(dataUrl) {
        if (els.photoPreview) {
            els.photoPreview.innerHTML = '<img src="' + dataUrl + '" alt="معاينة">';
        }
    }

    // ============================================================
    //  Delete Account
    // ============================================================
    function openDeleteModal() {
        if (!els.deleteAccountModal) return;

        // ✅ فحص COURT_REQUESTED
        const isCourt = state.childData && state.childData.courtRequested;

        if (isCourt) {
            showCourtWarning();
        } else {
            showDeleteForm();
        }

        els.deleteAccountModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    // ✅ عرض Court Warning
        function showCourtWarning() {
        // ✅ ضيف كلاس court-mode للـ modal كله
        if (els.deleteAccountModal) {
            els.deleteAccountModal.classList.add('court-mode');
        }

        if (els.courtWarningBox) els.courtWarningBox.style.display = 'block';
        if (els.deleteModalActions) els.deleteModalActions.style.display = 'none';
        if (els.deleteFormSection) els.deleteFormSection.style.display = 'none';
    }

    // ✅ عرض فورم الحذف العادي
        function showDeleteForm() {
        // ✅ شيل كلاس court-mode
        if (els.deleteAccountModal) {
            els.deleteAccountModal.classList.remove('court-mode');
        }

        if (els.courtWarningBox) els.courtWarningBox.style.display = 'none';
        if (els.deleteModalActions) els.deleteModalActions.style.display = 'flex';
        if (els.deleteFormSection) els.deleteFormSection.style.display = 'block';

        // Reset فورم الحذف
        if (els.deletePasswordInput) els.deletePasswordInput.value = '';
        if (els.deleteConfirmCheck) els.deleteConfirmCheck.checked = false;
        if (els.confirmDeleteBtn) els.confirmDeleteBtn.disabled = true;
        hideFieldError('deletePassword');
    }

    function closeDeleteModal() {
        if (!els.deleteAccountModal) return;
        els.deleteAccountModal.style.display = 'none';
        document.body.style.overflow = '';
    }

    function updateDeleteButtonState() {
        if (!els.confirmDeleteBtn) return;
        const pwd = els.deletePasswordInput.value.trim();
        const checked = els.deleteConfirmCheck.checked;
        els.confirmDeleteBtn.disabled = !(pwd.length >= 8 && checked);
    }

    async function handleDeleteAccount() {
        const password = els.deletePasswordInput.value.trim();

        if (password.length < 8) {
            showFieldError('deletePassword', 'كلمة السر مطلوبة');
            return;
        }

        if (!els.deleteConfirmCheck.checked) {
            return;
        }

        // Final confirmation
        if (!confirm('🚨 سيتم تقديم طلب استرداد وإلغاء اشتراك الطفل. هل أنت متأكد؟')) {
            return;
        }

        showLoader(true);
        els.confirmDeleteBtn.disabled = true;

        try {
            const result = await apiCall('requestRefund', {
                childID: getChildID(),
                password: password,
                session: getSession(),
                reason: "طلب استرداد من لوحة الأسرة"
            }, 'POST');

            console.log('📩 requestRefund:', result);

            if (result.success) {
                closeDeleteModal();
                alert('✅ تم تقديم طلب الاسترداد بنجاح. سيتم مراجعته وحذف البيانات.');
                window.location.reload();

            } else {
                showLoader(false);
                els.confirmDeleteBtn.disabled = false;

                // Handle errors
                if (result.error && result.error.indexOf('كلمة السر') !== -1) {
                    showFieldError('deletePassword', 'كلمة السر غير صحيحة');
                } else if (result.error === 'service_used' || result.error === 'beyond_14_days') {
                    alert('❌ غير مؤهل للاسترداد: ' + (result.message || 'تجاوزت الشروط.'));
                } else {
                    alert('❌ ' + (result.error || 'فشل تقديم الطلب'));
                }
            }

        } catch (err) {
            console.error('❌ requestRefund error:', err);
            showLoader(false);
            els.confirmDeleteBtn.disabled = false;
            alert('تعذر الاتصال بالخادم. حاول مرة أخرى.');
        }
    }

        // ============================================================
    //  🚫 Disable Account
    // ============================================================
    function openDisableModal() {
        if (!els.disableAccountModal) return;

        // Reset
        if (els.disablePasswordInput) els.disablePasswordInput.value = '';
        if (els.confirmDisableBtn) els.confirmDisableBtn.disabled = true;
        hideFieldError('disablePassword');

        els.disableAccountModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function closeDisableModal() {
        if (!els.disableAccountModal) return;
        els.disableAccountModal.style.display = 'none';
        document.body.style.overflow = '';
    }

    function updateDisableButtonState() {
        if (!els.confirmDisableBtn || !els.disablePasswordInput) return;
        const pwd = els.disablePasswordInput.value.trim();
        els.confirmDisableBtn.disabled = pwd.length < 8;
    }

    async function handleDisableAccount() {
        if (state.isDisableSubmitting) return;

        const password = (els.disablePasswordInput.value || '').trim();

        if (password.length < 8) {
            showFieldError('disablePassword', 'كلمة السر مطلوبة (8 أحرف على الأقل)');
            return;
        }

        state.isDisableSubmitting = true;
        if (els.confirmDisableBtn) els.confirmDisableBtn.disabled = true;
        showLoader(true);

        try {
            const result = await apiCall('disableChildAccount', {
                childID: getChildID(),
                password: password,
                session: getSession()
            }, 'POST');

            console.log('📩 disableChildAccount:', result);

                if (result.success) {
                    closeDisableModal();

                    // 📡 بث فوري للتانات التانية في نفس المتصفح
                    if (window.FD && window.FD.broadcastSessionTerminated) {
                        window.FD.broadcastSessionTerminated();
                    }

                    showMessage(els.saveDataMessage, 'success', 'success',
                        '✅ تم تعطيل الحساب بنجاح. البيانات محفوظة، والميزات متوقفة مؤقتاً.');

                    // ✅ امسح الـ cache قبل الـ reload
                    try {
                        sessionStorage.removeItem('family_child_data');
                        const fdState = getFD().getState();
                        if (fdState) fdState.childData = null;
                    } catch (e) {}

                    setTimeout(function() {
                        window.location.reload();
                    }, 800);
                } else {
                if (result.error && result.error.indexOf('كلمة السر') !== -1) {
                    showFieldError('disablePassword', 'كلمة السر غير صحيحة');
                } else {
                    alert('❌ ' + (result.error || 'فشل التعطيل'));
                }
            }
        } catch (err) {
            console.error('❌ handleDisableAccount error:', err);
            alert('تعذر الاتصال بالخادم. حاول مرة أخرى.');
        } finally {
            state.isDisableSubmitting = false;
            if (els.confirmDisableBtn) els.confirmDisableBtn.disabled = false;
            showLoader(false);
        }
    }

    // ============================================================
    //  ✅ Enable Account
    // ============================================================
    function openEnableModal() {
        if (!els.enableAccountModal) return;
        els.enableAccountModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function closeEnableModal() {
        if (!els.enableAccountModal) return;
        els.enableAccountModal.style.display = 'none';
        document.body.style.overflow = '';
    }

    async function handleEnableAccount() {
        if (state.isEnableSubmitting) return;

        state.isEnableSubmitting = true;
        if (els.confirmEnableBtn) els.confirmEnableBtn.disabled = true;
        showLoader(true);

        try {
            const result = await apiCall('enableChildAccount', {
                childID: getChildID(),
                session: getSession()
            }, 'POST');

            console.log('📩 enableChildAccount:', result);

            if (result.success) {
                closeEnableModal();
                showMessage(els.saveDataMessage, 'success', 'success',
                    '✅ تم تفعيل الحساب بنجاح. تم إعادة تفعيل ميزات الحماية.');

                // ✅ امسح الـ cache قبل الـ reload
                try {
                    sessionStorage.removeItem('family_child_data');
                    const fdState = getFD().getState();
                    if (fdState) fdState.childData = null;
                } catch (e) {}

                // ✅ Full Page Reload
                setTimeout(function() {
                    window.location.reload();
                }, 800);
            } else {
                alert('❌ ' + (result.error || 'فشل التفعيل'));
            }
        } catch (err) {
            console.error('❌ handleEnableAccount error:', err);
            alert('تعذر الاتصال بالخادم. حاول مرة أخرى.');
        } finally {
            state.isEnableSubmitting = false;
            if (els.confirmEnableBtn) els.confirmEnableBtn.disabled = false;
            showLoader(false);
        }
    }

    // ============================================================
    //  ⚖️ Court Warning → Disable Instead
    // ============================================================
    function handleCourtDisableInstead() {
        // اقفل modal الحذف الأول
        closeDeleteModal();

        // افتح modal التعطيل بعد ثانية (عشان transition ناعم)
        setTimeout(function() {
            openDisableModal();
        }, 250);
    }

    // ============================================================
    //  Password Toggle
    // ============================================================
    function bindPasswordToggles() {
        document.querySelectorAll('.toggle-password').forEach(function(btn) {
            // ✅ منع الربط المزدوج
            if (btn.dataset.toggleBound === 'true') return;
            btn.dataset.toggleBound = 'true';

            btn.addEventListener('click', function(e) {
                e.preventDefault();
                const targetId = btn.getAttribute('data-target');
                const input = document.getElementById(targetId);
                if (!input) return;

                const icon = btn.querySelector('i');
                if (input.type === 'password') {
                    input.type = 'text';
                    if (icon) icon.className = 'fas fa-eye-slash';
                } else {
                    input.type = 'password';
                    if (icon) icon.className = 'fas fa-eye';
                }
            });
        });
    }

    // ============================================================
    //  Event Binding
    // ============================================================
    function bindEvents() {
        // Reload button
        if (els.reloadDataBtn) {
            els.reloadDataBtn.addEventListener('click', async function() {
                hideMessage(els.saveDataMessage);
                showLoader(true);

                // ✅ امسح الـ cache ونعمل force refresh
                try {
                    const fdState = getFD().getState();
                    if (fdState) fdState.childData = null;
                    sessionStorage.removeItem('family_child_data');
                } catch (e) {}

                try {
                    await loadData({ forceRefresh: true });
                } finally {
                    showLoader(false);
                }
            });
        }

        // Photo
        if (els.changePhotoBtn) {
            els.changePhotoBtn.addEventListener('click', function() {
                els.photoInput.click();
            });
        }
        if (els.photoInput) {
            els.photoInput.addEventListener('change', function(e) {
                if (e.target.files[0]) handlePhotoChange(e.target.files[0]);
                e.target.value = '';
            });
        }

                // ============================================================
        //  Phone Inputs (numbers only + per-field validation)
        // ============================================================
        [els.fatherPhone, els.motherPhone].forEach(function(input) {
            if (!input) return;
            input.addEventListener('input', function(e) {
                e.target.value = e.target.value.replace(/[^\d]/g, '').slice(0, 11);
                displayFieldError(e.target.id);
                updateSaveButtonState();
            });
            input.addEventListener('blur', function(e) {
                displayFieldError(e.target.id);
            });
        });

        // ============================================================
        //  Google Maps (per-field validation)
        // ============================================================
        if (els.googleMaps) {
            els.googleMaps.addEventListener('input', function() {
                displayFieldError('fdGoogleMaps');
                updateSaveButtonState();
            });
            els.googleMaps.addEventListener('blur', function() {
                displayFieldError('fdGoogleMaps');
            });
        }

        // ============================================================
        //  Detailed Address (per-field validation)
        // ============================================================
        if (els.detailedAddress) {
            els.detailedAddress.addEventListener('input', function() {
                displayFieldError('fdDetailedAddress');
                updateSaveButtonState();
            });
            els.detailedAddress.addEventListener('blur', function() {
                displayFieldError('fdDetailedAddress');
            });
        }

        // ============================================================
        //  Birth Date (readonly — مش محتاج validation)
        // ============================================================
        if (els.birthDate) {
            els.birthDate.addEventListener('change', updateSaveButtonState);
        }

        // ============================================================
        //  Mother Name (Arabic + Latin only)
        // ============================================================
        if (els.motherName) {
            els.motherName.addEventListener('input', function(e) {
                e.target.value = e.target.value.replace(/[^\u0600-\u06FFa-zA-Z\s]/g, '');
                updateSaveButtonState();
            });
        }

        // ============================================================
        //  Marketer ID (MA + digits, readonly-safe)
        // ============================================================
        if (els.marketerId) {
            els.marketerId.addEventListener('input', function(e) {
                if (e.target.readOnly) return;
                Utils.restrictMarketerId(e);
                updateSaveButtonState();
            });
        }

        // ============================================================
        //  Notes Input (pending check)
        // ============================================================
        if (els.noteInput) {
            els.noteInput.addEventListener('input', function() {
                displayFieldError('fdNoteInput');
                updateSaveButtonState();
            });
        }

                // Notes — Add button
        if (els.addNoteBtn) {
            els.addNoteBtn.addEventListener('click', function() {
                const val = els.noteInput.value.trim();
                if (!val) return;
                if (val.length > 200) {
                    alert('⚠️ الملاحظة طويلة جداً (الحد الأقصى 200 حرف)');
                    return;
                }
                state.notes.push(val);
                els.noteInput.value = '';
                renderNotes();
                hideFieldError('fdNoteInput');
                updateSaveButtonState();
            });
        }

        // Notes — Enter key
        if (els.noteInput) {
            els.noteInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    els.addNoteBtn.click();
                }
            });
        }

        // Acknowledge
        if (els.acknowledge) {
            els.acknowledge.addEventListener('change', updateSaveButtonState);
        }

        // Save
        if (els.saveDataBtn) {
            els.saveDataBtn.addEventListener('click', handleSaveData);
        }

        // Delete Account Modal
        if (els.openDeleteModalBtn) {
            els.openDeleteModalBtn.addEventListener('click', openDeleteModal);
        }
        if (els.closeDeleteModalBtn) {
            els.closeDeleteModalBtn.addEventListener('click', closeDeleteModal);
        }
        if (els.cancelDeleteBtn) {
            els.cancelDeleteBtn.addEventListener('click', closeDeleteModal);
        }
        if (els.deletePasswordInput) {
            els.deletePasswordInput.addEventListener('input', updateDeleteButtonState);
        }
        if (els.deleteConfirmCheck) {
            els.deleteConfirmCheck.addEventListener('change', updateDeleteButtonState);
        }
        if (els.confirmDeleteBtn) {
            els.confirmDeleteBtn.addEventListener('click', handleDeleteAccount);
        }

        // Click outside modal to close
        if (els.deleteAccountModal) {
            els.deleteAccountModal.addEventListener('click', function(e) {
                if (e.target === els.deleteAccountModal) closeDeleteModal();
            });
        }

        // ============================================================
        //  🚫 Disable / Enable Events
        // ============================================================

        if (els.openDisableModalBtn) {
            els.openDisableModalBtn.addEventListener('click', openDisableModal);
        }
        if (els.closeDisableModalBtn) {
            els.closeDisableModalBtn.addEventListener('click', closeDisableModal);
        }
        if (els.cancelDisableBtn) {
            els.cancelDisableBtn.addEventListener('click', closeDisableModal);
        }
        if (els.disablePasswordInput) {
            els.disablePasswordInput.addEventListener('input', updateDisableButtonState);
        }
        if (els.confirmDisableBtn) {
            els.confirmDisableBtn.addEventListener('click', handleDisableAccount);
        }
        if (els.disableAccountModal) {
            els.disableAccountModal.addEventListener('click', function(e) {
                if (e.target === els.disableAccountModal) closeDisableModal();
            });
        }

        if (els.openEnableModalBtn) {
            els.openEnableModalBtn.addEventListener('click', openEnableModal);
        }
        if (els.closeEnableModalBtn) {
            els.closeEnableModalBtn.addEventListener('click', closeEnableModal);
        }
        if (els.cancelEnableBtn) {
            els.cancelEnableBtn.addEventListener('click', closeEnableModal);
        }
        if (els.confirmEnableBtn) {
            els.confirmEnableBtn.addEventListener('click', handleEnableAccount);
        }
        if (els.enableAccountModal) {
            els.enableAccountModal.addEventListener('click', function(e) {
                if (e.target === els.enableAccountModal) closeEnableModal();
            });
        }

        // ⚖️ Court warning — disable instead
        if (els.courtDisableInsteadBtn) {
            els.courtDisableInsteadBtn.addEventListener('click', handleCourtDisableInstead);
        }

        // Escape closes modal
        document.addEventListener('keydown', function(e) {
            if (e.key !== 'Escape') return;

            if (els.deleteAccountModal && els.deleteAccountModal.style.display === 'flex') {
                closeDeleteModal();
            }
            if (els.disableAccountModal && els.disableAccountModal.style.display === 'flex') {
                closeDisableModal();
            }
            if (els.enableAccountModal && els.enableAccountModal.style.display === 'flex') {
                closeEnableModal();
            }
        });

        // Password toggles
        bindPasswordToggles();
    }

    // ============================================================
    //  Public Hook (called by family-dashboard.js on tab activation)
    // ============================================================
    window.onTabActivate = function(tabName, data) {
        if (tabName !== 'data') return;

        // First time
        if (!state.isInitialized) {
            state.isInitialized = true;
            bindEvents();
            loadData();
        }
    };

    console.log('✅ family-dashboard-data.js loaded');

})();