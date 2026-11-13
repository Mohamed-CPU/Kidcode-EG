// ================================================================
//  marketer-dashboard.js - لوحة تحكم المسوق (2026-09-19)
//  مع دعم إشعارات تليجرام (QR + Open Telegram) زي الأسرة
// ================================================================

const Utils = window.Utils || {};

if (!window.Utils) {
    console.warn('⚠️ utils.js لم يتم تحميله، استخدام دوال احتياطية');
    window.Utils = {
        checkMarketerSession: function() {
            const code = localStorage.getItem('marketerCode');
            if (!code) {
                window.location.href = '/marketer-login';
                return null;
            }
            // ✅ فحص expiry — ساعة
            let expiryTime = null;
            try {
                const s = sessionStorage.getItem('marketer_session_expiry')
                       || localStorage.getItem('marketer_session_expiry');
                if (s) {
                    const t = new Date(s).getTime();
                    if (!isNaN(t)) expiryTime = t;
                }
            } catch (e) {}
            if (!expiryTime || Date.now() >= expiryTime) {
                try {
                    localStorage.removeItem('marketerCode');
                    localStorage.removeItem('marketerName');
                    localStorage.removeItem('marketer_session_expiry');
                    sessionStorage.removeItem('marketer_session_expiry');
                } catch (e) {}
                window.location.href = '/marketer-login?reason=session_expired';
                return null;
            }
            return code;
        },
        updateMarketerName: function() {
            const name = localStorage.getItem('marketerName');
            const nameEl = document.getElementById('marketerName');
            if (nameEl) {
                const code = localStorage.getItem('marketerCode') || '';
                nameEl.textContent = name ? 'مرحباً، ' + name : 'مرحباً، مسوق ' + code;
            }
        }
    };
}

// ============================================================
//  Marketer Telegram State
// ============================================================
let marketerTelegramStatus = {
    isLinked: false,
    chatId: null,
    linkedAt: null,
    notificationMethod: 'email'
};
let marketerTelegramPollingInterval = null;
let marketerCountdownInterval = null;
let marketerLinkExpiry = null;

document.addEventListener('DOMContentLoaded', function() {
    console.log('📌 marketer-dashboard.js تم تحميله');

    // ============================================================
    //  1. Session Check
    // ============================================================
    const code = (typeof Utils.checkMarketerSession === 'function')
        ? Utils.checkMarketerSession()
        : window.Utils.checkMarketerSession();

    if (!code) return;

    if (typeof Utils.updateMarketerName === 'function') {
        Utils.updateMarketerName();
    } else {
        window.Utils.updateMarketerName();
    }

    // ============================================================
    //  2. Logout
    // ============================================================
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            try {
                if (window.MarketerSession && typeof window.MarketerSession.stop === 'function') {
                    window.MarketerSession.stop();
                }
            } catch (e) {}
            localStorage.removeItem('marketerCode');
            localStorage.removeItem('marketerName');
            localStorage.removeItem('marketer_session_expiry');
            sessionStorage.removeItem('marketer_session_expiry');
            window.location.href = '/marketer-login';
        });
    }

    // ============================================================
    //  3. Load Dashboard
    // ============================================================
    const loadingScreen = document.getElementById('loadingScreen');
    const statsGrid = document.getElementById('statsGrid');
    const ordersSection = document.getElementById('ordersSection');
    const totalChildrenEl = document.getElementById('totalChildren');
    const earnedCommissionEl = document.getElementById('earnedCommission');
    const pendingCommissionEl = document.getElementById('pendingCommission');
    const availableBalanceEl = document.getElementById('availableBalance');
    const ordersBody = document.getElementById('ordersBody');

    async function loadDashboard() {
        try {
            const response = await fetch(`/api?action=marketer&innerAction=getMarketerStats&code=${encodeURIComponent(code)}`);
            const result = await response.json();

            loadingScreen.style.display = 'none';

            if (result.success) {
                const stats = result.stats;
                totalChildrenEl.textContent = stats.totalChildren;
                earnedCommissionEl.textContent = stats.totalEarnedCommission + ' ج.م';
                pendingCommissionEl.textContent = stats.totalPendingCommission + ' ج.م';
                if (availableBalanceEl) {
                    availableBalanceEl.textContent = (stats.availableBalance || 0) + ' ج.م';
                }

                // 🆕 hint: مبلغ محجوز في طلبات نشطة
                const hintEl = document.getElementById('availableBalanceHint');
                if (hintEl) {
                    const withdrawn = stats.totalWithdrawn || 0;
                    if (withdrawn > 0) {
                        hintEl.textContent = 'محجوز في طلبات نشطة: ' + withdrawn + ' ج.م';
                        hintEl.style.display = 'block';
                    } else {
                        hintEl.style.display = 'none';
                    }
                }
                statsGrid.style.display = 'grid';
                ordersSection.style.display = 'block';

                if (stats.orders && stats.orders.length > 0) {
                    let html = '';
                    stats.orders.forEach(order => {
                        const badgeClass = order.isEarned ? 'badge-earned' : 'badge-pending';
                        const badgeText = order.isEarned ? '✅ مستحق' : '⏳ معلق';
                        html += `
                            <tr>
                                <td><strong>${order.childID}</strong></td>
                                <td>${order.childName}</td>
                                <td>${order.plan}</td>
                                <td>${order.originalPrice}</td>
                                <td>${order.finalPrice}</td>
                                <td><strong>${order.commission}</strong></td>
                                <td>${order.registrationDate}</td>
                                <td>${order.daysAgo} يوم</td>
                                <td><span class="${badgeClass}">${badgeText}</span></td>
                            </tr>
                        `;
                    });
                    ordersBody.innerHTML = html;
                } else {
                    ordersBody.innerHTML = '<tr><td colspan="9" class="no-orders">لا توجد طلبات حتى الآن</td></tr>';
                }
            } else {
                alert('❌ فشل تحميل البيانات: ' + (result.error || 'خطأ غير معروف'));
            }
        } catch (err) {
            console.error('❌ خطأ في تحميل لوحة المسوق:', err);
            loadingScreen.style.display = 'none';
            statsGrid.style.display = 'grid';
            ordersSection.style.display = 'block';
            totalChildrenEl.textContent = '⚠️';
            earnedCommissionEl.textContent = '⚠️';
            pendingCommissionEl.textContent = '⚠️';
            ordersBody.innerHTML = '<tr><td colspan="9" class="no-orders">حدث خطأ في الاتصال</td></tr>';
        }
    }

    // ============================================================
    //  4. Delete Account
    // ============================================================
    const deleteBtn = document.getElementById('deleteAccountBtn');
    const deleteModal = document.getElementById('deleteConfirmModal');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    const deleteInput = document.getElementById('deleteConfirmInput');
    const deleteMessage = document.getElementById('deleteMessage');

    if (deleteBtn) {
        deleteBtn.addEventListener('click', function() {
            deleteModal.style.display = 'flex';
            deleteInput.value = '';
            deleteMessage.className = 'message-box';
            deleteMessage.textContent = '';
            deleteMessage.style.display = 'none';
            confirmDeleteBtn.disabled = false;
            confirmDeleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i> تأكيد الحذف';
        });
    }

    if (cancelDeleteBtn) {
        cancelDeleteBtn.addEventListener('click', function() {
            deleteModal.style.display = 'none';
        });
    }

    if (deleteModal) {
        deleteModal.addEventListener('click', function(e) {
            if (e.target === deleteModal) deleteModal.style.display = 'none';
        });
    }

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async function() {
            const codeLS = localStorage.getItem('marketerCode');
            const confirmText = deleteInput.value.trim().toUpperCase();

            if (confirmText !== 'DELETE') {
                deleteMessage.className = 'message-box error';
                deleteMessage.textContent = '⚠️ يرجى كتابة DELETE (أحرف كبيرة) للتأكيد.';
                deleteMessage.style.display = 'block';
                return;
            }

            confirmDeleteBtn.disabled = true;
            confirmDeleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحذف...';
            deleteMessage.style.display = 'none';

            try {
            const response = await fetch('/api', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'marketerDeleteAccount',
                    code: codeLS,
                    confirm: 'DELETE'
                })
            });

                const result = await response.json();

                if (result.success) {
                    deleteMessage.className = 'message-box success';
                    deleteMessage.textContent = '✅ ' + result.message;
                    deleteMessage.style.display = 'block';
                    confirmDeleteBtn.innerHTML = '✅ تم الحذف';

                    setTimeout(() => {
                        localStorage.removeItem('marketerCode');
                        localStorage.removeItem('marketerName');
                        localStorage.removeItem('marketer_session_expiry');
                        sessionStorage.removeItem('marketer_session_expiry');
                        window.location.href = '/marketer-login';
                    }, 2500);
                } else {
                    deleteMessage.className = 'message-box error';
                    deleteMessage.textContent = '❌ ' + (result.error || 'حدث خطأ.');
                    deleteMessage.style.display = 'block';
                    confirmDeleteBtn.disabled = false;
                    confirmDeleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i> تأكيد الحذف';
                }
            } catch (err) {
                deleteMessage.className = 'message-box error';
                deleteMessage.textContent = '⚠️ حدث خطأ في الاتصال.';
                deleteMessage.style.display = 'block';
                confirmDeleteBtn.disabled = false;
                confirmDeleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i> تأكيد الحذف';
            }
        });
    }

    // ============================================================
    //  5. Telegram Functions
    // ============================================================

    const telegramBadge = document.getElementById('marketerTelegramBadge');
    const notLinkedView = document.getElementById('marketerNotLinkedView');
    const linkedView = document.getElementById('marketerLinkedView');
    const startLinkBtn = document.getElementById('marketerStartLinkBtn');
    const emailOnlyBtn = document.getElementById('marketerEmailOnlyBtn');
    const unlinkBtn = document.getElementById('marketerUnlinkBtn');
    const telegramMsg = document.getElementById('marketerTelegramMessage');
    const chatDetail = document.getElementById('marketerChatDetail');
    const sinceDetail = document.getElementById('marketerSinceDetail');
    const methodTelegramRadio = document.getElementById('marketerMethodTelegram');
    const methodEmailRadio = document.getElementById('marketerMethodEmail');

    // Modal elements
    const linkModal = document.getElementById('marketerTelegramLinkModal');
    const closeLinkModalBtn = document.getElementById('marketerCloseLinkModalBtn');
    const qrImage = document.getElementById('marketerQrImage');
    const qrLoading = document.getElementById('marketerQrLoading');
    const openTelegramLink = document.getElementById('marketerOpenTelegramLink');
    const linkingStatusText = document.getElementById('marketerLinkingStatusText');
    const countdownEl = document.getElementById('marketerLinkCountdown');
    const linkErrorBox = document.getElementById('marketerTelegramLinkError');

    // ✅ تحميل حالة الربط
    async function loadMarketerTelegramStatus() {
        try {
            const response = await fetch('/api?action=telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    innerAction: 'getMarketerTelegramStatus',
                    marketerCode: code
                })
            });

            const data = await response.json();
            console.log('📩 getMarketerTelegramStatus:', data);

            if (!data.success) {
                telegramBadge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> خطأ';
                telegramBadge.style.background = '#fee2e2';
                telegramBadge.style.color = 'var(--danger-color)';
                return;
            }

            marketerTelegramStatus = {
                isLinked: data.isLinked,
                chatId: data.chatId,
                linkedAt: data.linkedAt,
                notificationMethod: data.notificationMethod || 'email'
            };

            if (data.isLinked) {
                // ===== مربوط =====
                telegramBadge.innerHTML = '<i class="fas fa-check-circle"></i> مربوط';
                telegramBadge.style.background = '#e8f5ee';
                telegramBadge.style.color = 'var(--secondary-dark)';

                notLinkedView.style.display = 'none';
                linkedView.style.display = 'block';

                const masked = data.chatId
                    ? data.chatId.toString().replace(/(\d{4})\d+(\d{3})/, '$1***$2')
                    : '*******';
                chatDetail.textContent = 'Chat ID: ' + masked;

                if (data.linkedAt) {
                    sinceDetail.textContent = 'منذ: ' + formatShortDate(data.linkedAt);
                }

                if (data.notificationMethod === 'telegram') methodTelegramRadio.checked = true;
                else methodEmailRadio.checked = true;
            } else {
                // ===== غير مربوط =====
                if (data.notificationMethod === 'telegram') {
                    telegramBadge.innerHTML = '<i class="fas fa-hourglass-half"></i> بانتظار الربط';
                    telegramBadge.style.background = '#fef3c7';
                    telegramBadge.style.color = '#92400e';
                } else {
                    telegramBadge.innerHTML = '<i class="fas fa-envelope"></i> البريد';
                    telegramBadge.style.background = '#f3f4f6';
                    telegramBadge.style.color = 'var(--text-secondary)';
                }

                notLinkedView.style.display = 'block';
                linkedView.style.display = 'none';
            }
        } catch (err) {
            console.error('❌ loadMarketerTelegramStatus:', err);
            telegramBadge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> خطأ';
        }
    }

function formatShortDate(dateStr) {
    if (!dateStr) return '--';

    // ✅ صيغة عربية موحدة: "الأربعاء، 11 نوفمبر 2026"
    if (window.Utils && typeof Utils.formatCairoDate === 'function') {
        try {
            const formatted = Utils.formatCairoDate(dateStr);
            if (formatted && formatted !== String(dateStr)) return formatted;
        } catch (e) {}
    }

    // Fallback: صيغة مختصرة (بدون يوم الأسبوع)
    try {
        const parts = Utils.getCairoTimeParts(dateStr);
        if (!parts) return String(dateStr);

        // ✅ نفس قائمة Utils (بدون همزات)
        const months = ['يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو',
                        'يوليو', 'اغسطس', 'سبتمبر', 'اكتوبر', 'نوفمبر', 'ديسمبر'];
        const d = parseInt(parts.day, 10);
        const m = parseInt(parts.month, 10) - 1;
        const y = parts.year;
        return `${d} ${months[m]} ${y}`;
    } catch (e) {}
    return String(dateStr);
}

    // ✅ بدء الربط
    async function startMarketerTelegramLink() {
        if (startLinkBtn) {
            startLinkBtn.disabled = true;
            startLinkBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التحضير...';
        }

        try {
            const response = await fetch('/api?action=telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    innerAction: 'generateMarketerLinkToken',
                    marketerCode: code
                })
            });

            const data = await response.json();
            console.log('📩 generateMarketerLinkToken:', data);

            if (!data.success) {
                if (data.error === 'already_linked') {
                    alert('⚠️ ' + (data.message || 'حسابك مربوط بالفعل'));
                    await loadMarketerTelegramStatus();
                } else {
                    alert('❌ ' + (data.message || data.error || 'فشل توليد الرابط'));
                }
                return;
            }

            showMarketerTelegramModal(data.deepLink, data.expiresAt);
        } catch (err) {
            console.error('❌ startMarketerTelegramLink:', err);
            alert('⚠️ خطأ في الاتصال');
        } finally {
            if (startLinkBtn) {
                startLinkBtn.disabled = false;
                startLinkBtn.innerHTML = '<i class="fab fa-telegram"></i> ربط تليجرام الآن';
            }
        }
    }

    // ✅ عرض Modal
    function showMarketerTelegramModal(deepLink, expiresAt) {
        if (!linkModal) return;

        linkErrorBox.style.display = 'none';
        qrImage.style.display = 'none';
        qrLoading.style.display = 'block';
        linkingStatusText.innerHTML = '<i class="fas fa-spinner fa-spin"></i> في انتظار الربط...';

        openTelegramLink.href = deepLink;
        openTelegramLink.style.display = 'flex';

        // QR Code
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(deepLink)}`;
        qrImage.onload = () => {
            qrLoading.style.display = 'none';
            qrImage.style.display = 'block';
        };
        qrImage.onerror = () => {
            qrLoading.innerHTML = '<p style="color: var(--danger-color);">⚠️ فشل تحميل QR</p>';
        };
        qrImage.src = qrUrl;

        linkModal.style.display = 'flex';
        linkModal.classList.add('show');

        marketerLinkExpiry = new Date(expiresAt).getTime();
        startMarketerCountdown();
        startMarketerPolling();
    }

    // ✅ العد التنازلي
    function startMarketerCountdown() {
        if (marketerCountdownInterval) clearInterval(marketerCountdownInterval);

        function tick() {
            const remaining = marketerLinkExpiry - Date.now();
            if (remaining <= 0) {
                countdownEl.textContent = '00:00';
                clearInterval(marketerCountdownInterval);
                marketerCountdownInterval = null;
                stopMarketerPolling();
                linkingStatusText.innerHTML = '<span style="color: var(--danger-color);">⏰ انتهت صلاحية الرابط</span>';
                return;
            }
            const mins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            countdownEl.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
        }
        tick();
        marketerCountdownInterval = setInterval(tick, 1000);
    }

    // ✅ Polling
    function startMarketerPolling() {
        stopMarketerPolling();
        marketerTelegramPollingInterval = setInterval(async () => {
            try {
                const response = await fetch('/api?action=telegram', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        innerAction: 'getMarketerTelegramStatus',
                        marketerCode: code
                    })
                });
                const data = await response.json();

                if (data.success && data.isLinked) {
                    stopMarketerPolling();
                    if (marketerCountdownInterval) clearInterval(marketerCountdownInterval);

                    linkingStatusText.innerHTML = '<span style="color: var(--secondary-color); font-size: 1.1rem;">✅ تم الربط بنجاح!</span>';

                    setTimeout(async () => {
                        closeMarketerTelegramModal();
                        await loadMarketerTelegramStatus();

                        if (telegramMsg) {
                            telegramMsg.className = 'message success';
                            telegramMsg.textContent = '✅ تم ربط حسابك بتليجرام بنجاح!';
                            telegramMsg.style.display = 'block';
                            setTimeout(() => { telegramMsg.style.display = 'none'; }, 5000);
                        }
                    }, 1200);
                }
            } catch (err) {
                console.warn('⚠️ polling error:', err);
            }
        }, 3000);
    }

    function stopMarketerPolling() {
        if (marketerTelegramPollingInterval) {
            clearInterval(marketerTelegramPollingInterval);
            marketerTelegramPollingInterval = null;
        }
    }

    function closeMarketerTelegramModal() {
        if (linkModal) {
            linkModal.classList.remove('show');
            linkModal.style.display = 'none';
        }
        stopMarketerPolling();
        if (marketerCountdownInterval) {
            clearInterval(marketerCountdownInterval);
            marketerCountdownInterval = null;
        }
    }

    // ✅ فك الربط
    async function unlinkMarketerTelegram() {
        const confirmed = confirm(
            '⚠️ هل أنت متأكد من فك الربط؟\n\n' +
            'لن تتمكن من استقبال الإشعارات عبر تليجرام حتى تعيد الربط.\n' +
            'ستستمر في استقبال الإشعارات عبر البريد الإلكتروني.'
        );
        if (!confirmed) return;

        if (unlinkBtn) {
            unlinkBtn.disabled = true;
            unlinkBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري فك الربط...';
        }

        try {
            const response = await fetch('/api?action=telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    innerAction: 'unlinkMarketerTelegram',
                    marketerCode: code
                })
            });

            const data = await response.json();

            if (data.success) {
                if (telegramMsg) {
                    telegramMsg.className = 'message success';
                    telegramMsg.textContent = '✅ ' + (data.message || 'تم فك الربط');
                    telegramMsg.style.display = 'block';
                }
                await loadMarketerTelegramStatus();
                setTimeout(() => { if (telegramMsg) telegramMsg.style.display = 'none'; }, 5000);
            } else {
                alert('❌ ' + (data.error || 'فشل فك الربط'));
            }
        } catch (err) {
            console.error('❌ unlinkMarketerTelegram:', err);
            alert('⚠️ خطأ في الاتصال');
        } finally {
            if (unlinkBtn) {
                unlinkBtn.disabled = false;
                unlinkBtn.innerHTML = '<i class="fas fa-unlink"></i> فك الربط';
            }
        }
    }

    // ✅ تغيير طريقة الإشعارات
    async function changeMarketerNotificationMethod(newMethod) {
        try {
            const response = await fetch('/api?action=telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    innerAction: 'setMarketerNotificationMethod',
                    marketerCode: code,
                    method: newMethod
                })
            });

            const data = await response.json();

            if (data.success) {
                marketerTelegramStatus.notificationMethod = newMethod;
                if (telegramMsg) {
                    telegramMsg.className = 'message success';
                    telegramMsg.textContent = newMethod === 'telegram'
                        ? '✅ سيتم استقبال الإشعارات عبر تليجرام'
                        : '✅ سيتم استقبال الإشعارات عبر البريد الإلكتروني';
                    telegramMsg.style.display = 'block';
                    setTimeout(() => { telegramMsg.style.display = 'none'; }, 4000);
                }
            } else {
                if (telegramMsg) {
                    telegramMsg.className = 'message error';
                    telegramMsg.textContent = '❌ ' + (data.error || 'فشل التحديث');
                    telegramMsg.style.display = 'block';
                }
                // رجع الاختيار
                if (marketerTelegramStatus.notificationMethod === 'telegram') methodTelegramRadio.checked = true;
                else methodEmailRadio.checked = true;
            }
        } catch (err) {
            console.error('❌ changeMarketerNotificationMethod:', err);
        }
    }

    // "المتابعة بالإيميل فقط"
    function switchToEmailOnly() {
        const confirmed = confirm(
            'سيتم استقبال الإشعارات على بريدك الإلكتروني.\n\n' +
            'يمكنك تفعيل تليجرام لاحقاً من هذه الصفحة في أي وقت.\n\n' +
            'هل تريد المتابعة؟'
        );
        if (!confirmed) return;

        if (notLinkedView) {
            notLinkedView.innerHTML = `
                <div class="telegram-benefits-box" style="background: #f3f4f6; border-right-color: var(--text-secondary);">
                    <p class="benefits-title" style="color: var(--text-primary);">✉️ وضع البريد الإلكتروني مفعّل</p>
                    <ul>
                        <li>ستصلك الإشعارات على بريدك المسجل</li>
                        <li>يمكنك تفعيل تليجرام في أي وقت</li>
                    </ul>
                </div>
                <button id="marketerReenableBtn" class="btn btn-primary btn-block" style="margin-top: 12px;">
                    <i class="fab fa-telegram"></i> تفعيل الإشعارات عبر تليجرام
                </button>
            `;
            document.getElementById('marketerReenableBtn').addEventListener('click', () => location.reload());
        }
        if (telegramBadge) {
            telegramBadge.innerHTML = '<i class="fas fa-envelope"></i> البريد';
            telegramBadge.style.background = '#f3f4f6';
            telegramBadge.style.color = 'var(--text-secondary)';
        }
    }

    // ============================================================
    //  Event Listeners — Telegram
    // ============================================================
    if (startLinkBtn) startLinkBtn.addEventListener('click', startMarketerTelegramLink);
    if (unlinkBtn) unlinkBtn.addEventListener('click', unlinkMarketerTelegram);
    if (emailOnlyBtn) emailOnlyBtn.addEventListener('click', switchToEmailOnly);
    if (closeLinkModalBtn) closeLinkModalBtn.addEventListener('click', closeMarketerTelegramModal);

    if (linkModal) {
        linkModal.addEventListener('click', function(e) {
            if (e.target === this) closeMarketerTelegramModal();
        });
    }

    if (methodTelegramRadio) {
        methodTelegramRadio.addEventListener('change', function() {
            if (this.checked) changeMarketerNotificationMethod('telegram');
        });
    }
    if (methodEmailRadio) {
        methodEmailRadio.addEventListener('change', function() {
            if (this.checked) changeMarketerNotificationMethod('email');
        });
    }

    // ============================================================
    //  6. Load All Data
    // ============================================================
    loadDashboard();
    loadMarketerTelegramStatus();

    // 🆕 Expose functions for reload buttons (IIFE #2)
    window.MD = {
        loadDashboard: loadDashboard,
        loadMarketerTelegramStatus: loadMarketerTelegramStatus
    };

    // ============================================================
    //  7. Deep Link: ?open=notifications
    // ============================================================
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('open') === 'notifications') {
        setTimeout(() => {
            const telegramSection = document.getElementById('telegramSection');
            if (telegramSection) {
                telegramSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            // فتح Modal الربط تلقائياً
            setTimeout(() => {
                startMarketerTelegramLink();
            }, 800);
        }, 500);
    }

        // ============================================================
    //  8. Referral Link + QR
    // ============================================================
    initReferralLink();

    function initReferralLink() {
        const marketerCode = localStorage.getItem('marketerCode');
        if (!marketerCode) return;

        const refLink = window.location.origin + '/reg.html?ref=' + encodeURIComponent(marketerCode);
        const refLinkInput = document.getElementById('marketerRefLink');
        const copyBtn = document.getElementById('copyRefLinkBtn');
        const shareBtn = document.getElementById('shareRefLinkBtn');
        const showQrBtn = document.getElementById('showRefQrBtn');
        const qrModal = document.getElementById('refQrModal');
        const closeQrBtn = document.getElementById('closeRefQrBtn');
        const qrImageContainer = document.getElementById('refQrImage');
        const qrCodeText = document.getElementById('refQrCodeText');
        const downloadQrBtn = document.getElementById('downloadRefQrBtn');

        if (refLinkInput) refLinkInput.value = refLink;
        if (qrCodeText) qrCodeText.textContent = marketerCode;

        // نسخ
        if (copyBtn) {
            copyBtn.addEventListener('click', function() {
                copyToClipboardSimple(refLink);
                copyBtn.innerHTML = '<i class="fas fa-check"></i>';
                copyBtn.style.background = '#10B981';
                copyBtn.style.color = '#FFFFFF';
                setTimeout(function() {
                    copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
                    copyBtn.style.background = '';
                    copyBtn.style.color = '';
                }, 2000);
            });
        }

        // مشاركة
        if (shareBtn) {
            shareBtn.addEventListener('click', async function() {
                const shareText = 'سجل طفلك في KidCode-EG واحصل على خصم مع كودي: ' + marketerCode + '\n' + refLink;

                if (navigator.share) {
                    try {
                        await navigator.share({
                            title: 'KidCode-EG',
                            text: 'سجل طفلك في KidCode-EG واحصل على خصم',
                            url: refLink
                        });
                    } catch (e) {
                        // المستخدم ألغى — صامت
                    }
                } else {
                    copyToClipboardSimple(shareText);
                    alert('✅ تم نسخ الرابط والنص — شاركهما على واتساب أو فيسبوك أو أي تطبيق');
                }
            });
        }

        // عرض QR
        if (showQrBtn) {
            showQrBtn.addEventListener('click', function() {
                const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(refLink);

                qrImageContainer.innerHTML = '<img src="' + qrUrl + '" alt="QR Code" style="max-width: 280px; width: 100%; border-radius: 12px; border: 2px solid var(--secondary-color); padding: 8px; background: white;">';
                qrModal.style.display = 'flex';
                qrModal.classList.add('show');
            });
        }

        // إغلاق QR
        if (closeQrBtn) {
            closeQrBtn.addEventListener('click', function() {
                qrModal.style.display = 'none';
                qrModal.classList.remove('show');
            });
        }
        if (qrModal) {
            qrModal.addEventListener('click', function(e) {
                if (e.target === qrModal) {
                    qrModal.style.display = 'none';
                    qrModal.classList.remove('show');
                }
            });
        }

        // تحميل QR
        if (downloadQrBtn) {
            downloadQrBtn.addEventListener('click', async function() {
                const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=' + encodeURIComponent(refLink);
                try {
                    const response = await fetch(qrUrl);
                    const blob = await response.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = marketerCode + '_qr.png';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (e) {
                    alert('⚠️ تعذر تحميل QR. يمكنك أخذ لقطة شاشة بدلاً من ذلك.');
                }
            });
        }
    }

    // نسخ بسيط
    function copyToClipboardSimple(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function() { fallbackCopySimple(text); });
        } else {
            fallbackCopySimple(text);
        }
    }
    function fallbackCopySimple(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
    }

    console.log('✅ marketer-dashboard.js جاهز');
});

// ================================================================
//  🆕 TABS + WITHDRAW + CHANGE PASSWORD + DELETE WARNINGS
//  (يُضاف بعد نهاية كود الملف الحالي — لا يحذف أي شيء)
// ================================================================

(function() {
    'use strict';

    // ============================================================
    //  Helpers
    // ============================================================
    function getMarketerCode() {
        try { return localStorage.getItem('marketerCode') || ''; } catch (e) { return ''; }
    }
    function getMarketerName() {
        try { return localStorage.getItem('marketerName') || ''; } catch (e) { return ''; }
    }
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
    function readNumberFromEl(id) {
        const el = document.getElementById(id);
        if (!el) return 0;
        const raw = (el.textContent || '').replace(/[^\d.]/g, '');
        const num = parseFloat(raw);
        return isNaN(num) ? 0 : num;
    }
    function showMessage(el, type, text) {
        if (!el) return;
        el.className = 'md-message ' + type;
        el.textContent = text;
        el.style.display = 'block';
    }
    function hideMessage(el) {
        if (!el) return;
        el.style.display = 'none';
        el.textContent = '';
    }

    // ============================================================
    //  1. Tabs + Sidebar
    // ============================================================
    const VALID_TABS = ['children', 'notifications', 'referral', 'withdraw', 'withdrawals', 'settings'];

    function openSidebar() {
        const sidebar = document.getElementById('mdSidebar');
        const overlay = document.getElementById('mdOverlay');
        if (sidebar) sidebar.classList.add('open');
        if (overlay) overlay.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
        const sidebar = document.getElementById('mdSidebar');
        const overlay = document.getElementById('mdOverlay');
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
        document.body.style.overflow = '';
    }

    function switchTab(tabName, updateHash) {
        if (VALID_TABS.indexOf(tabName) === -1) tabName = 'children';

        // Nav buttons
        document.querySelectorAll('.md-tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
        });

        // Panels
        document.querySelectorAll('.md-tab-panel').forEach(function(panel) {
            panel.classList.toggle('active', panel.getAttribute('data-tab') === tabName);
        });

        // Mobile title
        const currentBtn = document.querySelector('.md-tab-btn[data-tab="' + tabName + '"]');
        const mobileTitle = document.getElementById('mdMobileTitle');
        if (mobileTitle && currentBtn) {
            const span = currentBtn.querySelector('span');
            if (span) mobileTitle.textContent = span.textContent;
        }

        // Hash
        if (updateHash !== false) {
            try { history.replaceState(null, '', '#' + tabName); } catch (e) {}
        }

        // Close sidebar (mobile)
        closeSidebar();

        // Per-tab hooks
        if (tabName === 'withdraw') {
            setTimeout(refreshWithdrawData, 50);
        } else if (tabName === 'withdrawals') {
            setTimeout(loadWithdrawalHistory, 50);
        } else if (tabName === 'settings') {
            setTimeout(refreshChannelInfo, 50);
        }
    }

    function initTabs() {
        document.querySelectorAll('.md-tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                switchTab(btn.getAttribute('data-tab'));
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        });

        const initialTab = (window.location.hash || '').replace('#', '');
        if (initialTab && VALID_TABS.indexOf(initialTab) !== -1) {
            switchTab(initialTab, false);
        }

        window.addEventListener('hashchange', function() {
            const hashTab = (window.location.hash || '').replace('#', '');
            if (hashTab && VALID_TABS.indexOf(hashTab) !== -1) {
                switchTab(hashTab, false);
            }
        });
    }

    function initSidebarToggle() {
        const hamburger = document.getElementById('mdHamburgerBtn');
        const overlay = document.getElementById('mdOverlay');

        if (hamburger) {
            hamburger.addEventListener('click', function() {
                const sidebar = document.getElementById('mdSidebar');
                if (sidebar && sidebar.classList.contains('open')) {
                    closeSidebar();
                } else {
                    openSidebar();
                }
            });
        }

        if (overlay) {
            overlay.addEventListener('click', closeSidebar);
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') closeSidebar();
        });

        window.addEventListener('resize', function() {
            if (window.innerWidth > 768) closeSidebar();
        });
    }

    function initReloadButtons() {
        const handlers = {
            reloadChildrenBtn: async function() {
                if (window.MD && window.MD.loadDashboard) {
                    await window.MD.loadDashboard();
                }
            },
            reloadNotificationsBtn: async function() {
                if (window.MD && window.MD.loadMarketerTelegramStatus) {
                    await window.MD.loadMarketerTelegramStatus();
                }
            },
            reloadReferralBtn: async function() {
                const refInput = document.getElementById('marketerRefLink');
                const code = getMarketerCode();
                if (refInput && code) {
                    refInput.value = window.location.origin + '/reg.html?ref=' + encodeURIComponent(code);
                }
            },
            reloadWithdrawBtn: async function() {
                refreshWithdrawData();
            },
            reloadHistoryBtn: async function() {
                await loadWithdrawalHistory();
            },
            reloadSettingsBtn: async function() {
                await refreshChannelInfo();
            }
        };

        Object.keys(handlers).forEach(function(id) {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('click', async function() {
                if (btn.disabled) return;
                btn.disabled = true;
                btn.classList.add('loading');
                try {
                    await handlers[id]();
                } catch (e) {
                    console.warn('⚠️ Reload error:', e);
                } finally {
                    setTimeout(function() {
                        btn.disabled = false;
                        btn.classList.remove('loading');
                    }, 400);
                }
            });
        });
    }

    // ============================================================
    //  2. Withdraw
    // ============================================================
    function refreshWithdrawData() {
        const code = getMarketerCode();
        const name = getMarketerName();

        const codeInput = document.getElementById('withdrawCode');
        const nameInput = document.getElementById('withdrawName');
        if (codeInput) codeInput.value = code;
        if (nameInput) nameInput.value = name;

        // Max = available balance (بعد خصم الطلبات النشطة)
        const max = readNumberFromEl('availableBalance');

        const balanceEl = document.getElementById('withdrawAvailableBalance');
        if (balanceEl) balanceEl.textContent = max + ' ج.م';

        const hintEl = document.getElementById('withdrawAmountHint');
        if (hintEl) hintEl.textContent = 'الرصيد المتاح: ' + max + ' ج.م';

        const amountInput = document.getElementById('withdrawAmount');
        if (amountInput) {
            amountInput.max = String(Math.max(0, max));
        }
    }

    function initWithdraw() {
        const form = document.getElementById('withdrawForm');
        if (!form) return;

        const statsGrid = document.getElementById('statsGrid');
        if (statsGrid && typeof MutationObserver !== 'undefined') {
            const obs = new MutationObserver(function() {
                if (statsGrid.style.display !== 'none') {
                    refreshWithdrawData();
                }
            });
            obs.observe(statsGrid, { attributes: true, attributeFilter: ['style'] });
        }

        const amountInput = document.getElementById('withdrawAmount');
        const transferInput = document.getElementById('withdrawTransferNumber');
        const transferHint = document.getElementById('withdrawTransferNumberHint');
        const amountError = document.getElementById('withdrawAmountError');
        const transferError = document.getElementById('withdrawTransferNumberError');
        const methodError = document.getElementById('withdrawMethodError');
        const messageEl = document.getElementById('withdrawMessage');

        function clearError(el) {
            if (el) el.classList.remove('show');
        }

        function showError(el, text) {
            if (!el) return;
            el.textContent = text;
            el.classList.add('show');
        }

        if (amountInput) {
            amountInput.addEventListener('input', function() {
                clearError(amountError);
            });
        }

        if (transferInput) {
            transferInput.addEventListener('input', function(e) {
                e.target.value = e.target.value.replace(/[^\d]/g, '').slice(0, 11);
                clearError(transferError);
            });
        }

        form.querySelectorAll('input[name="withdrawMethod"]').forEach(function(radio) {
            radio.addEventListener('change', function() {
                clearError(methodError);
                if (transferHint) {
                    transferHint.textContent = radio.value === 'instapay'
                        ? 'رقم الهاتف المسجل على حساب انستاباي'
                        : 'رقم الهاتف المسجل على المحفظة الإلكترونية';
                }
            });
        });

        form.addEventListener('submit', async function(e) {
            e.preventDefault();

            const code = getMarketerCode();
            const max = readNumberFromEl('availableBalance');
            const amount = parseInt(amountInput ? amountInput.value : '0', 10);
            const methodRadio = form.querySelector('input[name="withdrawMethod"]:checked');
            const method = methodRadio ? methodRadio.value : '';
            const transferNumber = (transferInput ? transferInput.value : '').trim();

            hideMessage(messageEl);
            clearError(amountError);
            clearError(methodError);
            clearError(transferError);

            // 1. Validate amount
            if (!amount || amount < 1) {
                showError(amountError, 'أدخل مبلغاً صحيحاً (رقم أكبر من 0)');
                return;
            }
            if (max <= 0) {
                showError(amountError, 'لا يوجد رصيد متاح للسحب حالياً');
                return;
            }
            if (amount > max) {
                showError(amountError, 'المبلغ يتجاوز الرصيد المتاح (' + max + ' ج.م)');
                return;
            }

            // 2. Validate method
            if (!method) {
                showError(methodError, 'اختر طريقة الاستلام');
                return;
            }

            // 3. Validate transfer number (Egyptian mobile)
            if (!transferNumber) {
                showError(transferError, 'رقم التحويل مطلوب');
                return;
            }
            if (!/^01[0125]\d{8}$/.test(transferNumber)) {
                showError(transferError, 'رقم هاتف غير صحيح (11 رقم يبدأ بـ 010/011/012/015)');
                return;
            }

            // 4. Submit
            const btn = document.getElementById('submitWithdrawBtn');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';
            }

            try {
                const res = await fetch('/api?action=marketer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        innerAction: 'submitWithdrawRequest',
                        marketerCode: code,
                        amount: amount,
                        method: method,
                        transferNumber: transferNumber
                    })
                });
                const data = await res.json();

                if (data.success) {
                    showMessage(messageEl, 'success',
                        '✅ تم إرسال طلبك بنجاح. رقم الطلب: ' + (data.requestId || '—') +
                        ' — سيتم التواصل معك خلال 48 ساعة عبر البريد أو الهاتف.');

                    // Reset form fields (except readonly)
                    if (amountInput) amountInput.value = '';
                    if (transferInput) transferInput.value = '';
                    form.querySelectorAll('input[name="withdrawMethod"]').forEach(function(r) {
                        r.checked = false;
                    });
                    if (transferHint) {
                        transferHint.textContent = 'رقم الهاتف المسجل على وسيلة الاستلام';
                    }
                    refreshWithdrawData();
                } else {
                    const errMsg = data.message || data.error || 'فشل إرسال الطلب';
                    showMessage(messageEl, 'error', '❌ ' + errMsg);
                }
            } catch (err) {
                console.error('withdraw submit error:', err);
                showMessage(messageEl, 'error', '⚠️ تعذر الاتصال بالخادم. حاول مرة أخرى.');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-paper-plane"></i> إرسال طلب السحب';
                }
            }
        });

        refreshWithdrawData();
    }

    // ============================================================
    //  3. Change Password (OTP flow)
    // ============================================================
    let otpCountdownInterval = null;
    let currentChannelMethod = 'email';

    async function refreshChannelInfo() {
        const code = getMarketerCode();
        if (!code) return;

        try {
            const res = await fetch('/api?action=telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    innerAction: 'getMarketerTelegramStatus',
                    marketerCode: code
                })
            });
            const data = await res.json();

            const method = data.notificationMethod || 'email';
            const isLinked = !!data.isLinked;
            currentChannelMethod = method;

            const warningBox = document.getElementById('channelWarningBox');
            const infoBox = document.getElementById('channelInfoBox');
            const channelDisplay = document.getElementById('currentChannelDisplay');
            const sendBtn = document.getElementById('sendOtpBtn');

            if (method === 'telegram' && !isLinked) {
                // Warning: Telegram chosen but not linked
                if (warningBox) warningBox.style.display = 'flex';
                if (infoBox) infoBox.style.display = 'none';
                if (sendBtn) sendBtn.disabled = true;
            } else {
                if (warningBox) warningBox.style.display = 'none';
                if (infoBox) infoBox.style.display = 'flex';
                if (channelDisplay) {
                    channelDisplay.textContent = (method === 'telegram') ? 'تليجرام' : 'البريد الإلكتروني';
                }
                if (sendBtn) sendBtn.disabled = false;
            }
        } catch (err) {
            console.warn('⚠️ refreshChannelInfo:', err);
        }
    }

    function validatePassword(pwd) {
        return pwd.length >= 8
            && /[A-Za-z]/.test(pwd)
            && /[0-9]/.test(pwd)
            && /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(pwd)
            && !/[\u0600-\u06FF]/.test(pwd);
    }

    function startOtpCountdown(seconds) {
        const countdownEl = document.getElementById('otpCountdown');
        if (!countdownEl) return;

        if (otpCountdownInterval) clearInterval(otpCountdownInterval);

        let remaining = seconds || 300;
        function tick() {
            if (remaining <= 0) {
                countdownEl.textContent = '00:00';
                clearInterval(otpCountdownInterval);
                otpCountdownInterval = null;
                return;
            }
            const m = Math.floor(remaining / 60);
            const s = remaining % 60;
            countdownEl.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
            remaining--;
        }
        tick();
        otpCountdownInterval = setInterval(tick, 1000);
    }

    function initChangePassword() {
        const sendBtn = document.getElementById('sendOtpBtn');
        const confirmBtn = document.getElementById('confirmChangePasswordBtn');
        const otpInput = document.getElementById('otpInput');

        // Link: go to telegram tab
        const goTelegramLink = document.getElementById('goToTelegramLink');
        if (goTelegramLink) {
            goTelegramLink.addEventListener('click', function(e) {
                e.preventDefault();
                switchTab('notifications');
            });
        }

        // Link: switch to email
        const switchEmailLink = document.getElementById('switchToEmailChannel');
        if (switchEmailLink) {
            switchEmailLink.addEventListener('click', async function(e) {
                e.preventDefault();
                const code = getMarketerCode();
                try {
                    const res = await fetch('/api?action=telegram', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            innerAction: 'setMarketerNotificationMethod',
                            marketerCode: code,
                            method: 'email'
                        })
                    });
                    const data = await res.json();
                    if (data.success) {
                        await refreshChannelInfo();
                    } else {
                        alert('❌ ' + (data.error || 'فشل التحويل للبريد'));
                    }
                } catch (err) {
                    alert('⚠️ خطأ في الاتصال');
                }
            });
        }

        if (sendBtn) {
            sendBtn.addEventListener('click', async function() {
                const current = (document.getElementById('mdCurrentPassword').value || '').trim();
                const newPwd = (document.getElementById('mdNewPassword').value || '').trim();
                const confirm = (document.getElementById('mdConfirmPassword').value || '').trim();

                // Reset errors
                ['mdCurrentPasswordError', 'mdNewPasswordError', 'mdConfirmPasswordError'].forEach(function(id) {
                    const el = document.getElementById(id);
                    if (el) el.classList.remove('show');
                });
                hideMessage(document.getElementById('changePasswordMessage'));

                let hasError = false;
                if (!current) {
                    const el = document.getElementById('mdCurrentPasswordError');
                    if (el) { el.textContent = 'كلمة السر الحالية مطلوبة'; el.classList.add('show'); }
                    hasError = true;
                }
                if (!newPwd) {
                    const el = document.getElementById('mdNewPasswordError');
                    if (el) { el.textContent = 'كلمة السر الجديدة مطلوبة'; el.classList.add('show'); }
                    hasError = true;
                } else if (!validatePassword(newPwd)) {
                    const el = document.getElementById('mdNewPasswordError');
                    if (el) { el.textContent = 'كلمة السر لا تحقق الشروط (8+ أحرف، حرف + رقم + رمز)'; el.classList.add('show'); }
                    hasError = true;
                } else if (newPwd === current) {
                    const el = document.getElementById('mdNewPasswordError');
                    if (el) { el.textContent = 'كلمة السر الجديدة يجب أن تكون مختلفة'; el.classList.add('show'); }
                    hasError = true;
                }
                if (confirm !== newPwd) {
                    const el = document.getElementById('mdConfirmPasswordError');
                    if (el) { el.textContent = 'كلمة السر غير متطابقة'; el.classList.add('show'); }
                    hasError = true;
                }
                if (hasError) return;

                const code = getMarketerCode();
                sendBtn.disabled = true;
                sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';

                try {
                    const res = await fetch('/api?action=marketer', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            innerAction: 'requestPasswordChangeOTP',
                            marketerCode: code,
                            currentPassword: current,
                            newPassword: newPwd
                        })
                    });
                    const data = await res.json();

                    if (data.success) {
                        const otpSection = document.getElementById('otpSection');
                        if (otpSection) otpSection.style.display = 'block';
                        startOtpCountdown(data.expiresInSeconds || 300);
                        if (otpInput) { otpInput.value = ''; otpInput.focus(); }

                        showMessage(document.getElementById('changePasswordMessage'),
                            'success',
                            '✅ تم إرسال رمز التحقق عبر ' +
                            (currentChannelMethod === 'telegram' ? 'تليجرام' : 'البريد الإلكتروني'));
                    } else {
                        showMessage(document.getElementById('changePasswordMessage'),
                            'error',
                            '❌ ' + (data.error || data.message || 'فشل إرسال رمز التحقق'));
                    }
                } catch (err) {
                    showMessage(document.getElementById('changePasswordMessage'),
                        'error',
                        '⚠️ تعذر الاتصال بالخادم');
                } finally {
                    sendBtn.disabled = false;
                    sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> إعادة إرسال رمز التحقق';
                }
            });
        }

        if (otpInput) {
            otpInput.addEventListener('input', function() {
                this.value = this.value.replace(/[^\d]/g, '').slice(0, 6);
                const err = document.getElementById('otpError');
                if (err) err.classList.remove('show');
            });
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('click', async function() {
                const code = getMarketerCode();
                const otp = (otpInput ? otpInput.value : '').trim();
                const newPwd = (document.getElementById('mdNewPassword').value || '').trim();
                const errEl = document.getElementById('otpError');
                const msgEl = document.getElementById('changePasswordMessage');

                if (otp.length !== 6) {
                    if (errEl) { errEl.textContent = 'أدخل 6 أرقام'; errEl.classList.add('show'); }
                    return;
                }

                confirmBtn.disabled = true;
                confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التأكيد...';
                hideMessage(msgEl);

                try {
                    const res = await fetch('/api?action=marketer', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            innerAction: 'confirmPasswordChange',
                            marketerCode: code,
                            otp: otp,
                            newPassword: newPwd
                        })
                    });
                    const data = await res.json();

                    if (data.success) {
                        showMessage(msgEl, 'success',
                            '✅ تم تغيير كلمة السر بنجاح. سيتم تسجيل الخروج...');
                        if (otpCountdownInterval) clearInterval(otpCountdownInterval);
                        setTimeout(function() {
                            localStorage.removeItem('marketerCode');
                            localStorage.removeItem('marketerName');
                            localStorage.removeItem('marketer_session_expiry');
                            sessionStorage.removeItem('marketer_session_expiry');
                            window.location.href = '/marketer-login';
                        }, 2000);
                    } else {
                        showMessage(msgEl, 'error',
                            '❌ ' + (data.error || data.message || 'فشل التأكيد'));
                    }
                } catch (err) {
                    showMessage(msgEl, 'error', '⚠️ تعذر الاتصال بالخادم');
                } finally {
                    confirmBtn.disabled = false;
                    confirmBtn.innerHTML = '<i class="fas fa-check"></i> تأكيد تغيير كلمة السر';
                }
            });
        }
    }

    // ============================================================
    //  4. Delete Warnings
    // ============================================================
    function populateDeleteWarnings() {
        const box = document.getElementById('deleteWarningsBox');
        if (!box) return;

        const earned = readNumberFromEl('earnedCommission');
        const pending = readNumberFromEl('pendingCommission');

        const lines = [];
        if (earned > 0) {
            lines.push('لديك <strong>' + earned + ' ج.م</strong> عمولات مستحقة — ستفقدها نهائياً عند الحذف.');
        }
        if (pending > 0) {
            lines.push('لديك <strong>' + pending + ' ج.م</strong> عمولات معلقة — لن تحصل عليها بعد الحذف.');
        }

        if (lines.length === 0) {
            box.style.display = 'none';
            box.innerHTML = '';
            return;
        }

        box.innerHTML =
            '<p class="dw-title"><i class="fas fa-triangle-exclamation"></i> تحذير هام</p>' +
            '<ul class="dw-list">' +
                lines.map(function(l) { return '<li>• ' + l + '</li>'; }).join('') +
            '</ul>';
        box.style.display = 'block';
    }

    function initDeleteWarnings() {
        const deleteBtn = document.getElementById('deleteAccountBtn');
        if (!deleteBtn) return;

        // Fire AFTER existing handler (which shows the modal)
        deleteBtn.addEventListener('click', function() {
            setTimeout(populateDeleteWarnings, 0);
        });

        // Also update when statsGrid changes
        const statsGrid = document.getElementById('statsGrid');
        if (statsGrid && typeof MutationObserver !== 'undefined') {
            const obs = new MutationObserver(function() {
                if (statsGrid.style.display !== 'none') {
                    // If modal is open, refresh
                    const modal = document.getElementById('deleteConfirmModal');
                    if (modal && modal.style.display === 'flex') {
                        populateDeleteWarnings();
                    }
                }
            });
            obs.observe(statsGrid, { attributes: true, attributeFilter: ['style'] });
        }
    }

        // ============================================================
    //  5. Withdrawal History + Modals
    // ============================================================
    let stateHistory = [];
    let currentCancelRequestId = null;

    function formatDateShort(value) {
        if (!value) return '—';
        if (window.Utils && typeof window.Utils.formatCairoDate === 'function') {
            try {
                const r = window.Utils.formatCairoDate(value);
                if (r && r !== String(value)) return r;
            } catch (e) {}
        }
        try {
            const d = new Date(value);
            if (isNaN(d.getTime())) return '—';
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Africa/Cairo',
                year: 'numeric', month: '2-digit', day: '2-digit'
            }).formatToParts(d);
            const y = parts.find(p => p.type === 'year').value;
            const m = parts.find(p => p.type === 'month').value;
            const dd = parts.find(p => p.type === 'day').value;
            return dd + '/' + m + '/' + y;
        } catch (e) { return '—'; }
    }

    async function loadWithdrawalHistory() {
        const loader = document.getElementById('mdHistoryLoader');
        const empty = document.getElementById('mdHistoryEmpty');
        const table = document.getElementById('mdHistoryTable');
        const body = document.getElementById('mdHistoryBody');
        if (!body) return;

        if (loader) loader.style.display = 'block';
        if (empty) empty.style.display = 'none';
        if (table) table.style.display = 'none';

        const code = getMarketerCode();
        if (!code) {
            if (loader) loader.style.display = 'none';
            if (empty) empty.style.display = 'block';
            return;
        }

        try {
            const res = await fetch('/api?action=marketer&innerAction=getWithdrawHistory&code=' + encodeURIComponent(code));
            const data = await res.json();

            if (loader) loader.style.display = 'none';

            if (!data.success) {
                if (empty) empty.style.display = 'block';
                console.warn('⚠️ [loadWithdrawalHistory]', data.error);
                return;
            }

            stateHistory = data.requests || [];
            renderWithdrawalHistory(stateHistory);

        } catch (err) {
            console.error('❌ [loadWithdrawalHistory]', err);
            if (loader) loader.style.display = 'none';
            if (empty) empty.style.display = 'block';
        }
    }

    function renderWithdrawalHistory(requests) {
        const body = document.getElementById('mdHistoryBody');
        const empty = document.getElementById('mdHistoryEmpty');
        const table = document.getElementById('mdHistoryTable');
        if (!body) return;

        if (!requests || requests.length === 0) {
            if (table) table.style.display = 'none';
            if (empty) empty.style.display = 'block';
            return;
        }

        if (empty) empty.style.display = 'none';
        if (table) table.style.display = 'block';

        const statusLabels = {
            submitted:    { label: '📤 تم إرسال طلب', cls: 'submitted' },
            under_review: { label: '🔍 قيد المراجعة', cls: 'under_review' },
            sending:      { label: '💸 قيد الإرسال', cls: 'sending' },
            sent:         { label: '✅ تم الإرسال', cls: 'sent' },
            rejected:     { label: '❌ مرفوض', cls: 'rejected' },
            cancelled:    { label: '⚪ ملغى', cls: 'cancelled' },
            failed:       { label: '⚠️ فشل', cls: 'failed' },
            expired:      { label: '⏰ منتهي الصلاحية', cls: 'expired' }
        };

        let html = '';
        requests.forEach(function(r) {
            const st = statusLabels[r.status] || { label: r.status, cls: 'cancelled' };
            const dateStr = formatDateShort(r.createdAt);
            const amountStr = r.amount + ' ج.م';

            let actions = '<span style="color: var(--text-light); font-size: 0.8rem;">—</span>';

            if (r.status === 'submitted' || r.status === 'under_review') {
                actions = '<button type="button" class="md-action-btn danger" data-action="cancel" data-request-id="' + escapeHtml(r.requestId) + '">' +
                            '<i class="fas fa-times"></i> إلغاء' +
                          '</button>';
            } else if (r.status === 'rejected' && r.rejectionReason) {
                actions = '<button type="button" class="md-action-btn danger" data-action="reason" data-type="rejected" data-request-id="' + escapeHtml(r.requestId) + '">' +
                            '<i class="fas fa-info-circle"></i> عرض السبب' +
                          '</button>';
            } else if (r.status === 'cancelled' && r.cancellationReason) {
                actions = '<button type="button" class="md-action-btn muted" data-action="reason" data-type="cancelled" data-request-id="' + escapeHtml(r.requestId) + '">' +
                            '<i class="fas fa-info-circle"></i> عرض السبب' +
                          '</button>';
            } else if (r.status === 'sent' && r.screenshotUrl) {
                actions = '<button type="button" class="md-action-btn success" data-action="screenshot" data-url="' + escapeHtml(r.screenshotUrl) + '" data-request-id="' + escapeHtml(r.requestId) + '">' +
                            '<i class="fas fa-receipt"></i> عرض الإيصال' +
                          '</button>';
            }

            html += '<tr data-request-id="' + escapeHtml(r.requestId) + '">' +
                '<td class="cell-request-id">' + escapeHtml(r.requestId) + '</td>' +
                '<td class="cell-date">' + escapeHtml(dateStr) + '</td>' +
                '<td class="cell-amount">' + amountStr + '</td>' +
                '<td class="cell-method">' +
                    '<div class="method-label">' + escapeHtml(r.methodLabel) + '</div>' +
                    '<div class="method-number">' + escapeHtml(r.transferNumber) + '</div>' +
                '</td>' +
                '<td><span class="md-status-badge ' + st.cls + '">' + st.label + '</span></td>' +
                '<td>' + actions + '</td>' +
            '</tr>';
        });

        body.innerHTML = html;
    }

    function findHistoryRequest(requestId) {
        for (let i = 0; i < stateHistory.length; i++) {
            if (stateHistory[i].requestId === requestId) return stateHistory[i];
        }
        return null;
    }

    function openCancelModal(requestId, amount) {
        currentCancelRequestId = requestId;
        const idEl = document.getElementById('mdCancelRequestId');
        const amountEl = document.getElementById('mdCancelAmount');
        if (idEl) idEl.textContent = requestId;
        if (amountEl) amountEl.textContent = amount + ' ج.م';
        const modal = document.getElementById('mdCancelWithdrawModal');
        if (modal) modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function closeCancelModal() {
        const modal = document.getElementById('mdCancelWithdrawModal');
        if (modal) modal.style.display = 'none';
        document.body.style.overflow = '';
        currentCancelRequestId = null;
    }

    async function confirmCancelWithdraw() {
        if (!currentCancelRequestId) return;
        const requestId = currentCancelRequestId;
        const code = getMarketerCode();
        const btn = document.getElementById('mdCancelConfirmBtn');

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإلغاء...';
        }

        try {
            const res = await fetch('/api?action=marketer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    innerAction: 'cancelWithdrawRequest',
                    marketerCode: code,
                    requestId: requestId
                })
            });
            const data = await res.json();

            if (data.success) {
                closeCancelModal();
                // تحديث الجدول
                await loadWithdrawalHistory();
                // تحديث الأرصدة
                if (window.MD && window.MD.loadDashboard) {
                    await window.MD.loadDashboard();
                }
                // إشعار
                const msgEl = document.getElementById('withdrawMessage');
                if (msgEl) {
                    msgEl.className = 'md-message success';
                    msgEl.textContent = '✅ تم إلغاء الطلب بنجاح';
                    msgEl.style.display = 'block';
                    setTimeout(function() { msgEl.style.display = 'none'; }, 4000);
                }
            } else {
                alert('❌ ' + (data.message || data.error || 'فشل إلغاء الطلب'));
            }
        } catch (err) {
            console.error('❌ confirmCancelWithdraw:', err);
            alert('⚠️ تعذر الاتصال بالخادم');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-times"></i> تأكيد الإلغاء';
            }
        }
    }

    function openReasonModal(type, requestId, reason) {
        const iconBox = document.getElementById('mdReasonIconBox');
        const icon = document.getElementById('mdReasonIcon');
        const title = document.getElementById('mdReasonTitle');
        const bodyEl = document.getElementById('mdReasonBody');

        if (type === 'rejected') {
            if (iconBox) iconBox.style.background = '#FEE2E2';
            if (icon) { icon.style.color = '#DC2626'; icon.className = 'fas fa-times-circle'; }
            if (title) { title.textContent = 'سبب الرفض'; title.style.color = '#991B1B'; }
        } else {
            if (iconBox) iconBox.style.background = '#F1F5F9';
            if (icon) { icon.style.color = '#64748B'; icon.className = 'fas fa-info-circle'; }
            if (title) { title.textContent = 'سبب الإلغاء'; title.style.color = '#334155'; }
        }

        if (bodyEl) bodyEl.textContent = reason || 'لم يتم تسجيل سبب.';

        const modal = document.getElementById('mdReasonModal');
        if (modal) modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function closeReasonModal() {
        const modal = document.getElementById('mdReasonModal');
        if (modal) modal.style.display = 'none';
        document.body.style.overflow = '';
    }

    function openScreenshotModal(requestId, url) {
        const idEl = document.getElementById('mdScreenshotRequestId');
        if (idEl) idEl.textContent = requestId;

        const img = document.getElementById('mdScreenshotImage');
        const loader = document.getElementById('mdScreenshotLoader');

        if (img) {
            img.style.display = 'none';
            img.src = '';
            img.onload = function() {
                if (loader) loader.style.display = 'none';
                img.style.display = 'block';
            };
            img.onerror = function() {
                if (loader) {
                    loader.innerHTML = '<p style="color: var(--danger-color); padding: 20px;">⚠️ تعذر تحميل الصورة</p>';
                    loader.style.display = 'block';
                }
                img.style.display = 'none';
            };
            img.src = url;
        }
        if (loader) {
            loader.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 2rem;"></i><p style="margin-top: 12px;">جاري تحميل الصورة...</p>';
            loader.style.display = 'block';
        }

        const modal = document.getElementById('mdScreenshotModal');
        if (modal) modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function closeScreenshotModal() {
        const modal = document.getElementById('mdScreenshotModal');
        if (modal) modal.style.display = 'none';
        document.body.style.overflow = '';
        const img = document.getElementById('mdScreenshotImage');
        if (img) img.src = '';
    }

    function initWithdrawalHistory() {
        // Cancel modal
        const cancelConfirmBtn = document.getElementById('mdCancelConfirmBtn');
        if (cancelConfirmBtn) cancelConfirmBtn.addEventListener('click', confirmCancelWithdraw);

        const cancelBackBtn = document.getElementById('mdCancelCancelBtn');
        if (cancelBackBtn) cancelBackBtn.addEventListener('click', closeCancelModal);

        const cancelModal = document.getElementById('mdCancelWithdrawModal');
        if (cancelModal) {
            cancelModal.addEventListener('click', function(e) {
                if (e.target === cancelModal) closeCancelModal();
            });
        }

        // Reason modal
        const reasonOkBtn = document.getElementById('mdReasonOkBtn');
        if (reasonOkBtn) reasonOkBtn.addEventListener('click', closeReasonModal);

        const reasonCloseBtn = document.getElementById('mdReasonCloseBtn');
        if (reasonCloseBtn) reasonCloseBtn.addEventListener('click', closeReasonModal);

        const reasonModal = document.getElementById('mdReasonModal');
        if (reasonModal) {
            reasonModal.addEventListener('click', function(e) {
                if (e.target === reasonModal) closeReasonModal();
            });
        }

        // Screenshot modal
        const ssCloseBtn = document.getElementById('mdScreenshotCloseBtn');
        if (ssCloseBtn) ssCloseBtn.addEventListener('click', closeScreenshotModal);

        const ssModal = document.getElementById('mdScreenshotModal');
        if (ssModal) {
            ssModal.addEventListener('click', function(e) {
                if (e.target === ssModal) closeScreenshotModal();
            });
        }

        // Escape
        document.addEventListener('keydown', function(e) {
            if (e.key !== 'Escape') return;
            closeCancelModal();
            closeReasonModal();
            closeScreenshotModal();
        });

        // Event delegation for action buttons
        const historyBody = document.getElementById('mdHistoryBody');
        if (historyBody && !historyBody.dataset.bound) {
            historyBody.dataset.bound = 'true';
            historyBody.addEventListener('click', function(e) {
                const btn = e.target.closest('.md-action-btn');
                if (!btn) return;

                const action = btn.getAttribute('data-action');
                const requestId = btn.getAttribute('data-request-id');

                if (action === 'cancel') {
                    const req = findHistoryRequest(requestId);
                    if (req) openCancelModal(requestId, req.amount);
                } else if (action === 'reason') {
                    const req = findHistoryRequest(requestId);
                    if (req) {
                        const type = btn.getAttribute('data-type');
                        const reason = type === 'rejected' ? req.rejectionReason : req.cancellationReason;
                        openReasonModal(type, requestId, reason);
                    }
                } else if (action === 'screenshot') {
                    openScreenshotModal(requestId, btn.getAttribute('data-url'));
                }
            });
        }
    }

    // ============================================================
    //  Init
    // ============================================================
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(function() {
            initSidebarToggle();
            initTabs();
            initWithdraw();
            initWithdrawalHistory();
            initChangePassword();
            initDeleteWarnings();
            initReloadButtons();
            console.log('✅ marketer-dashboard extras loaded (sidebar + tabs + withdraw + withdrawal-history + password + warnings + reload)');
        }, 0);
    });

})();

// ================================================================
//  ⏱️ Session Expiry Timer — 60 دقيقة
//  - يحسب المتبقي من expiry
//  - ينهي الجلسة تلقائياً عند انتهاء الوقت
//  - فحص فوري عند رجوع التاب/الـ focus
// ================================================================
(function() {
    'use strict';

    const SESSION_EXPIRY_KEY = 'marketer_session_expiry';
    let expiryTimerId = null;
    let isRedirecting = false;

    function getExpiryTime() {
        try {
            const stored = sessionStorage.getItem(SESSION_EXPIRY_KEY)
                         || localStorage.getItem(SESSION_EXPIRY_KEY);
            if (!stored) return null;
            const t = new Date(stored).getTime();
            return isNaN(t) ? null : t;
        } catch (e) {
            return null;
        }
    }

    function clearMarketerStorage() {
        try {
            localStorage.removeItem('marketerCode');
            localStorage.removeItem('marketerName');
            localStorage.removeItem(SESSION_EXPIRY_KEY);
            sessionStorage.removeItem(SESSION_EXPIRY_KEY);
        } catch (e) {}
    }

    function handleExpired() {
        if (isRedirecting) return;
        isRedirecting = true;
        console.warn('🚫 [Marketer Expiry] انتهت الجلسة — redirect');
        stopTimer();
        clearMarketerStorage();
        window.location.replace('/marketer-login.html?reason=session_expired');
    }

    function startTimer() {
        stopTimer();

        const expiryTime = getExpiryTime();

        // ✅ لو مفيش expiry → خروج فوري (مش تمديد)
        if (!expiryTime) {
            console.warn('🚫 [Marketer Expiry] مفيش expiry → خروج فوري');
            handleExpired();
            return;
        }

        const remaining = expiryTime - Date.now();
        const remainingMin = Math.max(0, Math.round(remaining / 1000 / 60));

        console.log('⏱️ [Marketer Expiry] الجلسة تنتهي خلال ' + remainingMin + ' دقيقة');

        if (remaining <= 0) {
            handleExpired();
            return;
        }

        expiryTimerId = setTimeout(function() {
            console.warn('🚫 [Marketer Expiry] انتهت مدة الجلسة');
            handleExpired();
        }, remaining);
    }

    function stopTimer() {
        if (expiryTimerId) {
            clearTimeout(expiryTimerId);
            expiryTimerId = null;
        }
    }

    function checkOnReturn() {
        if (isRedirecting) return;
        const expiryTime = getExpiryTime();
        if (!expiryTime || Date.now() >= expiryTime) {
            handleExpired();
        } else {
            startTimer(); // إعادة ضبط الـ timer
        }
    }

    document.addEventListener('DOMContentLoaded', function() {
        // لو مفيش جلسة → اخرج (main IIFE هيعالج)
        if (!localStorage.getItem('marketerCode')) return;

        // ابدأ الـ timer
        startTimer();

        // فحص عند رجوع التاب
        document.addEventListener('visibilitychange', function() {
            if (!document.hidden) {
                console.log('👁️ [Marketer Expiry] التاب رجع — فحص فوري');
                checkOnReturn();
            }
        });

        // فحص عند focus
        window.addEventListener('focus', function() {
            if (document.hidden) return;
            console.log('🖱️ [Marketer Expiry] focus — فحص فوري');
            checkOnReturn();
        });

        console.log('✅ [Marketer Expiry] Session timer started (60 min)');
    });

    // API عام — للـ logout اليدوي
    window.MarketerSession = {
        stop: stopTimer,
        clear: clearMarketerStorage,
        handleExpired: handleExpired
    };
})();