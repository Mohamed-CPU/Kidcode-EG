// ================================================================
//  family-dashboard-security.js - منطق تبويب "الأمان الرقمي"
//  - التحقق الرقمي بالوجه
//  - رفع صورة (من الجهاز / الكاميرا)
//  - حذف بصمة الوجه (IS_ACTIVE = "لا")
// ================================================================

(function() {
    'use strict';

    // ============================================================
    //  State
    // ============================================================
    const state = {
        isInitialized: false,
        faceStream: null,
        isSaving: false
    };

    // ============================================================
    //  DOM References
    // ============================================================
    const els = {
        faceStatusBadge: document.getElementById('faceStatusBadge'),
        faceDataStatusText: document.getElementById('faceDataStatusText'),
        faceDataStatusDetail: document.getElementById('faceDataStatusDetail'),
        uploadFaceBtn: document.getElementById('uploadFaceBtn'),
        cameraFaceBtn: document.getElementById('cameraFaceBtn'),
        deleteFaceBtn: document.getElementById('deleteFaceBtn'),
        faceMessage: document.getElementById('faceMessage'),
        faceImageInput: document.getElementById('faceImageInput'),
        fdCameraContainer: document.getElementById('fdCameraContainer'),
        fdCameraVideo: document.getElementById('fdCameraVideo'),
        fdCaptureBtn: document.getElementById('fdCaptureBtn'),
        fdCloseCameraBtn: document.getElementById('fdCloseCameraBtn')
    };

    // ============================================================
    //  Helpers
    // ============================================================
    function getFD() { return window.FD; }
    function getChildID() {
        return (getFD() && getFD().getChildID && getFD().getChildID()) || '';
    }
    function apiCall(innerAction, payload, method) {
        return getFD().apiCall(innerAction, payload, method);
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

    // ============================================================
    //  ✅ فحص إذا كان الحساب معطّل
    // ============================================================
    function isAccountDisabled() {
        const childData = (getFD().getState && getFD().getState().childData) || {};
        return (childData.status || '').toLowerCase() === 'disabled';
    }

    // ============================================================
    //  Load Face Status
    // ============================================================
    async function loadFaceStatus() {
        try {
            // ✅ فحص الحالة أولاً
            if (isAccountDisabled()) {
                if (els.faceStatusBadge) {
                    els.faceStatusBadge.className = 'fd-badge badge-inactive';
                    els.faceStatusBadge.innerHTML = '🚫 معطّل';
                }
                if (els.faceDataStatusText) {
                    els.faceDataStatusText.innerHTML =
                        '<i class="fas fa-power-off" style="color:var(--warning-color);"></i> ' +
                        'التحقق بالوجه متوقف (الحساب معطّل)';
                }
                if (els.faceDataStatusDetail) {
                    els.faceDataStatusDetail.textContent =
                        'فعّل الحساب أولاً للتحقق من بيانات الوجه';
                }
                if (els.uploadFaceBtn) els.uploadFaceBtn.style.display = 'none';
                if (els.cameraFaceBtn) els.cameraFaceBtn.style.display = 'none';
                if (els.deleteFaceBtn) els.deleteFaceBtn.style.display = 'none';
                return;
            }

            // ── المسار العادي ──
            if (els.faceStatusBadge) {
                els.faceStatusBadge.className = 'fd-badge';
                els.faceStatusBadge.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التحميل...';
            }

            const result = await apiCall('getFaceStatus', {
                childID: getChildID()
            }, 'GET');

            console.log('📩 getFaceStatus:', result);

            if (!result.success) {
                if (els.faceStatusBadge) {
                    els.faceStatusBadge.className = 'fd-badge badge-inactive';
                    els.faceStatusBadge.innerHTML = '⚠️ خطأ';
                }
                return;
            }

            if (result.hasFaceData) {
                if (els.faceStatusBadge) {
                    els.faceStatusBadge.className = 'fd-badge badge-active';
                    els.faceStatusBadge.innerHTML = '✅ مفعّل';
                }
                if (els.faceDataStatusText) {
                    els.faceDataStatusText.innerHTML =
                        '<i class="fas fa-check-circle" style="color:var(--secondary-color);"></i> ' +
                        'بيانات الوجه مسجّلة';
                }
                if (els.faceDataStatusDetail) {
                    els.faceDataStatusDetail.innerHTML =
                        '📅 آخر تحديث: ' + (Utils.formatDateOnly(result.updatedAt) || '--');
                }
                if (els.deleteFaceBtn) els.deleteFaceBtn.style.display = 'flex';
                if (els.uploadFaceBtn) {
                    els.uploadFaceBtn.innerHTML = '<i class="fas fa-sync"></i> تحديث صورة الوجه';
                }
            } else {
                if (els.faceStatusBadge) {
                    els.faceStatusBadge.className = 'fd-badge badge-inactive';
                    els.faceStatusBadge.innerHTML = '⏳ غير مسجّل';
                }
                if (els.faceDataStatusText) {
                    els.faceDataStatusText.innerHTML =
                        '<i class="fas fa-info-circle" style="color:var(--warning-color);"></i> ' +
                        'لا توجد بيانات وجه مسجّلة';
                }
                if (els.faceDataStatusDetail) {
                    els.faceDataStatusDetail.textContent =
                        'أضف صورة وجه لتفعيل التحقق الرقمي';
                }
                if (els.deleteFaceBtn) els.deleteFaceBtn.style.display = 'none';
                if (els.uploadFaceBtn) {
                    els.uploadFaceBtn.innerHTML = '<i class="fas fa-upload"></i> رفع صورة من الجهاز';
                }
            }

        } catch (err) {
            console.error('❌ loadFaceStatus error:', err);
        }
    }

    // ============================================================
    //  Upload Face
    // ============================================================
    async function handleFaceUpload(file) {
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert('⚠️ يرجى اختيار صورة صالحة');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            alert('⚠️ حجم الصورة كبير جداً (الحد الأقصى 5 ميجابايت)');
            return;
        }

        const reader = new FileReader();
        reader.onload = async function(e) {
            await saveFaceImage(e.target.result);
        };
        reader.readAsDataURL(file);
    }

    async function saveFaceImage(base64) {
        if (state.isSaving) return;
        state.isSaving = true;

        showLoader(true);
        hideMessage(els.faceMessage);

        try {
            const result = await apiCall('saveFaceFeatures', {
                childID: getChildID(),
                faceImage: base64
            }, 'POST');

            console.log('📩 saveFaceFeatures:', result);

            if (result.success) {
                showMessage(els.faceMessage, 'success', 'success',
                    '✅ تم حفظ صورة الوجه بنجاح');
                await loadFaceStatus();
            } else {
                showMessage(els.faceMessage, 'error', 'error',
                    result.error || 'فشل حفظ صورة الوجه');
            }
        } catch (err) {
            if (window.kcReportError) {
                window.kcReportError('saveFaceImage: ' + (err && err.message ? err.message : String(err)), {
                    innerAction: 'saveFaceFeatures',
                    childID: getChildID()
                });
            }
            showMessage(els.faceMessage, 'error', 'error',
                'تعذر الاتصال بالخادم. حاول مرة أخرى.');
        } finally {
            state.isSaving = false;
            showLoader(false);
        }
    }

    // ============================================================
    //  Delete Face
    // ============================================================
    async function handleFaceDelete() {
        if (!confirm('هل أنت متأكد من حذف بيانات الوجه؟ لن يمكنك استخدام التحقق الرقمي حتى ترفع صورة جديدة.')) {
            return;
        }

        showLoader(true);
        hideMessage(els.faceMessage);

        try {
            const result = await apiCall('deleteFaceFeatures', {
                childID: getChildID()
            }, 'POST');

            console.log('📩 deleteFaceFeatures:', result);

            if (result.success) {
                showMessage(els.faceMessage, 'success', 'success',
                    '✅ تم حذف بيانات الوجه بنجاح');
                await loadFaceStatus();
            } else {
                showMessage(els.faceMessage, 'error', 'error',
                    result.error || 'فشل الحذف');
            }
        } catch (err) {
            if (window.kcReportError) {
                window.kcReportError('handleFaceDelete: ' + (err && err.message ? err.message : String(err)), {
                    innerAction: 'deleteFaceFeatures',
                    childID: getChildID()
                });
            }
            showMessage(els.faceMessage, 'error', 'error',
                'تعذر الاتصال بالخادم. حاول مرة أخرى.');
        } finally {
            showLoader(false);
        }
    }

    // ============================================================
    //  Camera
    // ============================================================
    async function openCamera() {
        try {
            state.faceStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
            });

            if (els.fdCameraVideo) {
                els.fdCameraVideo.srcObject = state.faceStream;
                els.fdCameraContainer.style.display = 'block';
                els.uploadFaceBtn.style.display = 'none';
                els.cameraFaceBtn.style.display = 'none';
            }
        } catch (err) {
            console.error('❌ openCamera error:', err);
            alert('⚠️ تعذر فتح الكاميرا. يرجى استخدام زر "رفع صورة".');
        }
    }

    function closeCamera() {
        if (state.faceStream) {
            state.faceStream.getTracks().forEach(function(t) { t.stop(); });
            state.faceStream = null;
        }
        if (els.fdCameraVideo) els.fdCameraVideo.srcObject = null;
        if (els.fdCameraContainer) els.fdCameraContainer.style.display = 'none';
        if (els.uploadFaceBtn) els.uploadFaceBtn.style.display = 'flex';
        if (els.cameraFaceBtn) els.cameraFaceBtn.style.display = 'flex';
    }

    function captureFacePhoto() {
        const video = els.fdCameraVideo;
        if (!video || !video.videoWidth) {
            alert('⚠️ الكاميرا غير جاهزة');
            return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);

        const base64 = canvas.toDataURL('image/jpeg', 0.85);
        closeCamera();
        saveFaceImage(base64);
    }

    // ============================================================
    //  Event Binding
    // ============================================================
    function bindEvents() {
        if (els.uploadFaceBtn) {
            els.uploadFaceBtn.addEventListener('click', function() {
                els.faceImageInput.click();
            });
        }
        if (els.faceImageInput) {
            els.faceImageInput.addEventListener('change', function(e) {
                if (e.target.files[0]) handleFaceUpload(e.target.files[0]);
                e.target.value = '';
            });
        }
        if (els.cameraFaceBtn) {
            els.cameraFaceBtn.addEventListener('click', openCamera);
        }
        if (els.fdCaptureBtn) {
            els.fdCaptureBtn.addEventListener('click', captureFacePhoto);
        }
        if (els.fdCloseCameraBtn) {
            els.fdCloseCameraBtn.addEventListener('click', closeCamera);
        }
        if (els.deleteFaceBtn) {
            els.deleteFaceBtn.addEventListener('click', handleFaceDelete);
        }
    }

    // ============================================================
    //  Public Hook
    // ============================================================
    window.onTabActivate = window.onTabActivate || function() {};

    const originalOnTabActivate = window.onTabActivate;

    window.onTabActivate = function(tabName, data) {
        // Call original if exists
        if (typeof originalOnTabActivate === 'function') {
            originalOnTabActivate(tabName, data);
        }

        if (tabName !== 'security') return;

        // First time only
        if (!state.isInitialized) {
            state.isInitialized = true;
            bindEvents();
            loadFaceStatus();
        } else {
            // Refresh on each activation
            loadFaceStatus();
        }
    };

    console.log('✅ family-dashboard-security.js loaded');

})();