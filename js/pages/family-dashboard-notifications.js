// ================================================================
//  family-dashboard-notifications.js
//  - إدارة ربط تليجرام (الأب + الأم)
//  - QR Modal + Polling + Countdown
//  - طريقة الإشعارات (تليجرام / إيميل)
// ================================================================

(function() {
    'use strict';

    // ============================================================
    //  State
    // ============================================================
    const state = {
        isInitialized: false,
        currentParentType: null,
        currentToken: null,
        currentLinkExpiry: null,
        pollingInterval: null,
        countdownInterval: null,
        unlinkOTPParentType: null,
        unlinkOTPExpiry: null,
        unlinkOTPCountdownInterval: null,
        isUnlinking: false
    };

    // ============================================================
    //  DOM References
    // ============================================================
    const els = {
        // Badge + Benefits
        notifStatusBadge: document.getElementById('notifStatusBadge'),
        notifBenefits: document.getElementById('notifBenefits'),
        notifMessage: document.getElementById('notifMessage'),

        // Father
        fatherStatusBadge: document.getElementById('fatherStatusBadge'),
        fatherNotLinked: document.getElementById('fatherNotLinked'),
        fatherLinked: document.getElementById('fatherLinked'),
        fatherLinkBtn: document.getElementById('fatherLinkBtn'),
        fatherUnlinkBtn: document.getElementById('fatherUnlinkBtn'),
        fatherChatDetail: document.getElementById('fatherChatDetail'),
        fatherSinceDetail: document.getElementById('fatherSinceDetail'),

        // Mother
        motherStatusBadge: document.getElementById('motherStatusBadge'),
        motherNotLinked: document.getElementById('motherNotLinked'),
        motherLinked: document.getElementById('motherLinked'),
        motherLinkBtn: document.getElementById('motherLinkBtn'),
        motherUnlinkBtn: document.getElementById('motherUnlinkBtn'),
        motherChatDetail: document.getElementById('motherChatDetail'),
        motherSinceDetail: document.getElementById('motherSinceDetail'),

        // Method Box
        notifMethodBox: document.getElementById('notifMethodBox'),
        methodTelegramRadio: document.getElementById('methodTelegramRadio'),
        methodEmailRadio: document.getElementById('methodEmailRadio'),

        // QR Modal
        telegramQRModal: document.getElementById('telegramQRModal'),
        closeQRModalBtn: document.getElementById('closeQRModalBtn'),
        qrModalSubtitle: document.getElementById('qrModalSubtitle'),
        qrLoading: document.getElementById('qrLoading'),
        qrCodeImage: document.getElementById('qrCodeImage'),
        openTelegramBtn: document.getElementById('openTelegramBtn'),
        qrLinkingStatus: document.getElementById('qrLinkingStatus'),
        qrCountdown: document.getElementById('qrCountdown'),
        qrError: document.getElementById('qrError'),

        // ✅ Unlink OTP Modal
        unlinkOTPModal: document.getElementById('unlinkOTPModal'),
        unlinkOTPSubtitle: document.getElementById('unlinkOTPSubtitle'),
        unlinkOTPInput: document.getElementById('unlinkOTPInput'),
        unlinkOTPError: document.getElementById('unlinkOTPError'),
        unlinkOTPCountdown: document.getElementById('unlinkOTPCountdown'),
        unlinkOTPMessage: document.getElementById('unlinkOTPMessage'),
        closeUnlinkOTPBtn: document.getElementById('closeUnlinkOTPBtn'),
        cancelUnlinkOTPBtn: document.getElementById('cancelUnlinkOTPBtn'),
        confirmUnlinkOTPBtn: document.getElementById('confirmUnlinkOTPBtn')
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

    function showMessage(el, type, text) {
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
    //  Load Status
    // ============================================================
    async function loadStatus() {
        try {
            const result = await apiCall('getTelegramStatus', {
                childID: getChildID()
            }, 'GET');

            console.log('📩 getTelegramStatus:', result);

            if (!result.success) {
                renderError();
                return;
            }

            renderParent('father', result.father);
            renderParent('mother', result.mother);
            renderMethodBox(result);
            renderOverallBadge(result);

        } catch (err) {
            console.error('❌ loadStatus error:', err);
            renderError();
        }
    }

    function renderParent(type, data) {
        const statusBadge = type === 'father' ? els.fatherStatusBadge : els.motherStatusBadge;
        const notLinked = type === 'father' ? els.fatherNotLinked : els.motherNotLinked;
        const linked = type === 'father' ? els.fatherLinked : els.motherLinked;
        const chatDetail = type === 'father' ? els.fatherChatDetail : els.motherChatDetail;
        const sinceDetail = type === 'father' ? els.fatherSinceDetail : els.motherSinceDetail;

        if (data && data.isLinked) {
            statusBadge.className = 'fd-parent-badge linked';
            statusBadge.innerHTML = '✅ مربوط';
            notLinked.style.display = 'none';
            linked.style.display = 'flex';
            chatDetail.textContent = 'Chat ID: ' + (data.chatId || '---');
            // ✅ الصيغة العربية الكاملة: "منذ: الأربعاء، 11 نوفمبر 2026"
            sinceDetail.textContent = 'منذ: ' + (
                (window.Utils && typeof Utils.formatCairoDate === 'function')
                    ? (Utils.formatCairoDate(data.linkedAt) || '---')
                    : (Utils.formatDateOnly(data.linkedAt) || '---')
            );
        } else {
            statusBadge.className = 'fd-parent-badge not-linked';
            statusBadge.innerHTML = '⏳ غير مربوط';
            notLinked.style.display = 'block';
            linked.style.display = 'none';
        }
    }

    function renderMethodBox(status) {
        const anyLinked = status.father.isLinked || status.mother.isLinked;

        if (!anyLinked) {
            els.notifMethodBox.style.display = 'none';
            els.notifBenefits.style.display = 'block';
            return;
        }

        els.notifBenefits.style.display = 'none';
        els.notifMethodBox.style.display = 'block';

        const method = status.notificationMethod || 'email';
        if (method === 'telegram') {
            els.methodTelegramRadio.checked = true;
        } else {
            els.methodEmailRadio.checked = true;
        }
    }

    function renderOverallBadge(status) {
        const anyLinked = status.father.isLinked || status.mother.isLinked;

        if (anyLinked) {
            els.notifStatusBadge.className = 'fd-badge badge-active';
            const count = (status.father.isLinked ? 1 : 0) + (status.mother.isLinked ? 1 : 0);
            els.notifStatusBadge.innerHTML = '✅ مربوط (' + count + '/2)';
        } else {
            els.notifStatusBadge.className = 'fd-badge badge-inactive';
            els.notifStatusBadge.innerHTML = '⏳ غير مربوط';
        }
    }

    function renderError() {
        els.notifStatusBadge.className = 'fd-badge badge-inactive';
        els.notifStatusBadge.innerHTML = '⚠️ خطأ';
        showMessage(els.notifMessage, 'error', 'تعذر تحميل حالة الإشعارات');
    }

    // ============================================================
    //  Link Handler (Open Modal + Generate QR)
    // ============================================================
    async function handleLink(parentType) {
        state.currentParentType = parentType;

        // Set modal subtitle
        const label = parentType === 'father' ? 'الأب' : 'الأم';
        els.qrModalSubtitle.textContent = 'امسح الرمز بكاميرا تليجرام لربط حساب ' + label;

        // Open modal
        els.telegramQRModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        // Reset modal
        hideMessage(els.qrError);
        els.qrCodeImage.style.display = 'none';
        els.qrCodeImage.src = '';
        els.qrLoading.style.display = 'block';
        els.openTelegramBtn.style.display = 'none';
        els.qrLinkingStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> في انتظار الربط...';
        els.qrCountdown.textContent = '--:--';

        try {
            const result = await apiCall('generateLinkToken', {
                childID: getChildID(),
                parentType: parentType
            });

            console.log('📩 generateLinkToken:', result);

            if (!result.success) {
                els.qrLoading.style.display = 'none';
                showMessage(els.qrError, 'error',
                    result.message || result.error || 'فشل توليد الرابط');
                return;
            }

            state.currentToken = result.token;
            state.currentLinkExpiry = new Date(result.expiresAt).getTime();

            // Set QR
            const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' +
                encodeURIComponent(result.deepLink);

            els.qrCodeImage.onload = function() {
                els.qrLoading.style.display = 'none';
                els.qrCodeImage.style.display = 'block';
            };
            els.qrCodeImage.onerror = function() {
                els.qrLoading.innerHTML = '<p style="color: var(--danger-color);">⚠️ فشل تحميل QR</p>';
            };
            els.qrCodeImage.src = qrUrl;

            // Set Open Telegram button
            els.openTelegramBtn.href = result.deepLink;
            els.openTelegramBtn.style.display = 'flex';

            // Start countdown + polling
            startCountdown();
            startPolling();

        } catch (err) {
            console.error('❌ handleLink error:', err);
            els.qrLoading.style.display = 'none';
            showMessage(els.qrError, 'error', 'تعذر الاتصال بالخادم');
        }
    }

    // ============================================================
    //  Unlink Handler — OTP Flow
    // ============================================================
    async function handleUnlink(parentType) {
        const label = parentType === 'father' ? 'الأب' : 'الأم';

        if (!confirm('هل أنت متأكد من فك ربط ' + label + '؟\n\nسيتم إرسال رمز تحقق على تليجرام ' + label + ' لتأكيد العملية.')) {
            return;
        }

        hideMessage(els.notifMessage);
        showLoader(true);

        try {
            // ✅ 1. اطلب OTP من الخادم
            const result = await apiCall('requestUnlinkOTP', {
                childID: getChildID(),
                parentType: parentType
            });

            console.log('📩 requestUnlinkOTP:', result);

            if (!result.success) {
                showMessage(els.notifMessage, 'error',
                    result.error || 'فشل إرسال رمز التحقق');
                showLoader(false);
                return;
            }

            // ✅ 2. افتح مودال OTP
            openUnlinkOTPModal(parentType, result.expiresAt, result.expiryMinutes);

        } catch (err) {
            console.error('❌ handleUnlink error:', err);
            showMessage(els.notifMessage, 'error', 'تعذر الاتصال بالخادم');
        } finally {
            showLoader(false);
        }
    }

    // ============================================================
    //  OTP Modal — Open
    // ============================================================
    function openUnlinkOTPModal(parentType, expiresAt, expiryMinutes) {
        state.unlinkOTPParentType = parentType;
        state.unlinkOTPExpiry = new Date(expiresAt).getTime();

        const label = parentType === 'father' ? 'الأب' : 'الأم';
        els.unlinkOTPSubtitle.textContent = 'تم إرسال رمز تحقق على تليجرام ' + label;

        // Reset
        if (els.unlinkOTPInput) {
            els.unlinkOTPInput.value = '';
            els.unlinkOTPInput.disabled = false;
        }
        if (els.unlinkOTPError) els.unlinkOTPError.classList.remove('show');
        hideMessage(els.unlinkOTPMessage);
        if (els.confirmUnlinkOTPBtn) els.confirmUnlinkOTPBtn.disabled = true;

        // Show modal
        els.unlinkOTPModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        // Focus input
        setTimeout(function() {
            if (els.unlinkOTPInput) els.unlinkOTPInput.focus();
        }, 200);

        // Start countdown
        startUnlinkOTPCountdown(expiryMinutes || 5);
    }

    // ============================================================
    //  OTP Modal — Countdown
    // ============================================================
    function startUnlinkOTPCountdown(minutes) {
        stopUnlinkOTPCountdown();

        function tick() {
            const remaining = state.unlinkOTPExpiry - Date.now();

            if (remaining <= 0) {
                if (els.unlinkOTPCountdown) els.unlinkOTPCountdown.textContent = '00:00';
                stopUnlinkOTPCountdown();
                if (els.unlinkOTPInput) els.unlinkOTPInput.disabled = true;
                if (els.confirmUnlinkOTPBtn) els.confirmUnlinkOTPBtn.disabled = true;
                showMessage(els.unlinkOTPMessage, 'error', '⏰ انتهت صلاحية الرمز. يرجى غلق النافذة وإعادة طلب رمز جديد.');
                return;
            }

            const mins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            if (els.unlinkOTPCountdown) {
                els.unlinkOTPCountdown.textContent =
                    String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
            }
        }

        tick();
        state.unlinkOTPCountdownInterval = setInterval(tick, 1000);
    }

    function stopUnlinkOTPCountdown() {
        if (state.unlinkOTPCountdownInterval) {
            clearInterval(state.unlinkOTPCountdownInterval);
            state.unlinkOTPCountdownInterval = null;
        }
    }

    // ============================================================
    //  OTP Modal — Close
    // ============================================================
    function closeUnlinkOTPModal() {
        els.unlinkOTPModal.style.display = 'none';
        document.body.style.overflow = '';
        stopUnlinkOTPCountdown();
        state.unlinkOTPParentType = null;
        state.unlinkOTPExpiry = null;
        state.isUnlinking = false;
    }

    // ============================================================
    //  OTP Modal — Confirm (unlink with OTP)
    // ============================================================
    async function handleConfirmUnlink() {
        if (state.isUnlinking) return;

        const otp = (els.unlinkOTPInput.value || '').trim();
        if (!/^\d{6}$/.test(otp)) {
            if (els.unlinkOTPError) {
                els.unlinkOTPError.textContent = 'يجب أن يتكون الرمز من 6 أرقام';
                els.unlinkOTPError.classList.add('show');
            }
            return;
        }

        state.isUnlinking = true;
        if (els.confirmUnlinkOTPBtn) els.confirmUnlinkOTPBtn.disabled = true;
        showLoader(true);
        hideMessage(els.unlinkOTPMessage);

        try {
            const result = await apiCall('unlinkTelegram', {
                childID: getChildID(),
                parentType: state.unlinkOTPParentType,
                otp: otp
            });

            console.log('📩 unlinkTelegram (with OTP):', result);

            if (result.success) {
                const label = state.unlinkOTPParentType === 'father' ? 'الأب' : 'الأم';
                closeUnlinkOTPModal();
                showMessage(els.notifMessage, 'success',
                    '✅ تم فك ربط ' + label + ' بنجاح');
                await loadStatus();
            } else {
                // فشل
                if (els.unlinkOTPError) {
                    els.unlinkOTPError.textContent = result.error || 'فشل التحقق';
                    els.unlinkOTPError.classList.add('show');
                }
                if (els.unlinkOTPInput) {
                    els.unlinkOTPInput.value = '';
                    els.unlinkOTPInput.focus();
                }

                // لو انتهى / تجاوز المحاولات → اقفل الإدخال
                if (result.reason === 'too_many_attempts' || result.reason === 'expired' || result.reason === 'no_otp') {
                    if (els.unlinkOTPInput) els.unlinkOTPInput.disabled = true;
                    showMessage(els.unlinkOTPMessage, 'error', result.error);
                }
            }
        } catch (err) {
            console.error('❌ handleConfirmUnlink error:', err);
            showMessage(els.unlinkOTPMessage, 'error', 'تعذر الاتصال بالخادم');
        } finally {
            state.isUnlinking = false;
            if (els.confirmUnlinkOTPBtn && els.unlinkOTPInput && !els.unlinkOTPInput.disabled) {
                els.confirmUnlinkOTPBtn.disabled = els.unlinkOTPInput.value.length !== 6;
            }
            showLoader(false);
        }
    }

    // ============================================================
    //  OTP Input Validation
    // ============================================================
    function handleUnlinkOTPInput() {
        if (!els.unlinkOTPInput) return;

        // أرقام بس
        els.unlinkOTPInput.value = els.unlinkOTPInput.value.replace(/\D/g, '').slice(0, 6);

        // تفعيل الزر
        if (els.confirmUnlinkOTPBtn) {
            els.confirmUnlinkOTPBtn.disabled = els.unlinkOTPInput.value.length !== 6;
        }

        // إخفاء الخطأ
        if (els.unlinkOTPError) els.unlinkOTPError.classList.remove('show');
    }

    // ============================================================
    //  Method Change Handler
    // ============================================================
    async function handleMethodChange(method) {
        hideMessage(els.notifMessage);

        try {
            const result = await apiCall('setNotificationMethod', {
                childID: getChildID(),
                method: method
            });

            console.log('📩 setNotificationMethod:', result);

            if (result.success) {
                showMessage(els.notifMessage, 'success',
                    '✅ تم تحديث طريقة الإشعارات إلى ' +
                    (method === 'telegram' ? 'تليجرام' : 'البريد الإلكتروني'));
            } else {
                showMessage(els.notifMessage, 'error',
                    result.error || 'فشل التحديث');
            }
        } catch (err) {
            console.error('❌ handleMethodChange error:', err);
            showMessage(els.notifMessage, 'error', 'تعذر الاتصال بالخادم');
        }
    }

    // ============================================================
    //  Countdown + Polling
    // ============================================================
    function startCountdown() {
        stopCountdown();

        function tick() {
            const remaining = state.currentLinkExpiry - Date.now();

            if (remaining <= 0) {
                els.qrCountdown.textContent = '00:00';
                stopCountdown();
                stopPolling();
                els.qrLinkingStatus.innerHTML =
                    '<span style="color: var(--danger-color);">⏰ انتهت صلاحية الرابط</span>';
                return;
            }

            const mins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            els.qrCountdown.textContent =
                String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
        }

        tick();
        state.countdownInterval = setInterval(tick, 1000);
    }

    function stopCountdown() {
        if (state.countdownInterval) {
            clearInterval(state.countdownInterval);
            state.countdownInterval = null;
        }
    }

    function startPolling() {
        stopPolling();

        state.pollingInterval = setInterval(async function() {
            try {
                const result = await apiCall('getTelegramStatus', {
                    childID: getChildID()
                }, 'GET');

                if (!result.success) return;

                const targetData = result[state.currentParentType];
                if (targetData && targetData.isLinked) {
                    handleLinkSuccess();
                }
            } catch (e) {
                console.warn('⚠️ polling error:', e);
            }
        }, 3000);
    }

    function stopPolling() {
        if (state.pollingInterval) {
            clearInterval(state.pollingInterval);
            state.pollingInterval = null;
        }
    }

    function handleLinkSuccess() {
        stopPolling();
        stopCountdown();

        const label = state.currentParentType === 'father' ? 'الأب' : 'الأم';

        els.qrLinkingStatus.innerHTML =
            '<span style="color: var(--secondary-color); font-size: 1rem;">✅ تم ربط ' + label + ' بنجاح!</span>';

        // Close modal + reload after 1.5s
        setTimeout(function() {
            closeQRModal();
            showMessage(els.notifMessage, 'success', '✅ تم ربط ' + label + ' بنجاح');
            loadStatus();
        }, 1500);
    }

    // ============================================================
    //  Modal Close
    // ============================================================
    function closeQRModal() {
        els.telegramQRModal.style.display = 'none';
        document.body.style.overflow = '';
        stopPolling();
        stopCountdown();
        state.currentParentType = null;
        state.currentToken = null;
        state.currentLinkExpiry = null;
    }

    // ============================================================
    //  Event Binding
    // ============================================================
    function bindEvents() {
        if (els.fatherLinkBtn) {
            els.fatherLinkBtn.addEventListener('click', function() {
                handleLink('father');
            });
        }
        if (els.motherLinkBtn) {
            els.motherLinkBtn.addEventListener('click', function() {
                handleLink('mother');
            });
        }

        if (els.fatherUnlinkBtn) {
            els.fatherUnlinkBtn.addEventListener('click', function() {
                handleUnlink('father');
            });
        }
        if (els.motherUnlinkBtn) {
            els.motherUnlinkBtn.addEventListener('click', function() {
                handleUnlink('mother');
            });
        }

        if (els.methodTelegramRadio) {
            els.methodTelegramRadio.addEventListener('change', function() {
                if (this.checked) handleMethodChange('telegram');
            });
        }
        if (els.methodEmailRadio) {
            els.methodEmailRadio.addEventListener('change', function() {
                if (this.checked) handleMethodChange('email');
            });
        }

        // Modal close
        if (els.closeQRModalBtn) {
            els.closeQRModalBtn.addEventListener('click', closeQRModal);
        }

        if (els.telegramQRModal) {
            els.telegramQRModal.addEventListener('click', function(e) {
                if (e.target === els.telegramQRModal) closeQRModal();
            });
        }

                // ✅ OTP Unlink Modal
        if (els.closeUnlinkOTPBtn) {
            els.closeUnlinkOTPBtn.addEventListener('click', closeUnlinkOTPModal);
        }
        if (els.cancelUnlinkOTPBtn) {
            els.cancelUnlinkOTPBtn.addEventListener('click', closeUnlinkOTPModal);
        }
        if (els.unlinkOTPModal) {
            els.unlinkOTPModal.addEventListener('click', function(e) {
                if (e.target === els.unlinkOTPModal) closeUnlinkOTPModal();
            });
        }
        if (els.unlinkOTPInput) {
            els.unlinkOTPInput.addEventListener('input', handleUnlinkOTPInput);
        }
        if (els.confirmUnlinkOTPBtn) {
            els.confirmUnlinkOTPBtn.addEventListener('click', handleConfirmUnlink);
        }

        document.addEventListener('keydown', function(e) {
            if (e.key !== 'Escape') return;

            if (els.telegramQRModal && els.telegramQRModal.style.display === 'flex') {
                closeQRModal();
            }
            if (els.unlinkOTPModal && els.unlinkOTPModal.style.display === 'flex') {
                closeUnlinkOTPModal();
            }
        });
    }

    // ============================================================
    //  Tab Activation
    // ============================================================
    const originalOnTabActivate = window.onTabActivate;

    window.onTabActivate = function(tabName, data) {
        if (typeof originalOnTabActivate === 'function') {
            originalOnTabActivate(tabName, data);
        }

        if (tabName !== 'notifications') return;

        if (!state.isInitialized) {
            state.isInitialized = true;
            bindEvents();
            loadStatus();
        } else {
            loadStatus();
        }
    };

    console.log('✅ family-dashboard-notifications.js loaded');

})();